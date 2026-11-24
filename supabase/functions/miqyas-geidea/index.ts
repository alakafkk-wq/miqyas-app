import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function cleanCredential(value: string | undefined) {
  return (value || "").replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "").trim();
}
async function createSignature(publicKey: string, amount: string, currency: string, reference: string, password: string, timestamp: string) {
  const data = `${publicKey}${amount}${currency}${reference}${timestamp}`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("sign", key, new TextEncoder().encode(data)));
  return toBase64(digest);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "يجب تسجيل الدخول أولاً." }, 401);
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const publicKey = cleanCredential(Deno.env.get("GEIDEA_PUBLIC_KEY"));
    const apiPassword = cleanCredential(Deno.env.get("GEIDEA_API_PASSWORD"));
    const appUrl = Deno.env.get("MIQYAS_APP_URL") || "https://tuhaysh01.sa/app.html";
    if (!supabaseUrl || !anonKey || !serviceKey || !publicKey || !apiPassword) return json({ error: "إعدادات Supabase أو أسرار Geidea غير مكتملة." }, 500);

    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    if (userError || !userData.user) return json({ error: "جلسة الدخول غير صالحة." }, 401);

    const body = await req.json();
    if (body?.action !== "create_session") return json({ error: "الإجراء غير مدعوم." }, 400);
    const organizationId = String(body.organization_id || "");
    const planCode = String(body.plan_code || "");
    const couponCode = String(body.coupon_code || "").trim().toUpperCase();
    if (!organizationId || !planCode) return json({ error: "المنشأة والباقة مطلوبتان." }, 400);

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const { data: membership } = await admin.from("organization_members").select("id").eq("organization_id", organizationId).eq("user_id", userData.user.id).maybeSingle();
    if (!membership) return json({ error: "ليس لديك صلاحية طلب الدفع لهذه المنشأة." }, 403);

    const { data: plan, error: planError } = await admin.from("subscription_plans").select("code,name,price_sar,is_active,business_type").eq("code", planCode).eq("is_active", true).maybeSingle();
    if (planError || !plan) return json({ error: "الباقة غير متاحة." }, 404);
    const { data: org, error: orgError } = await admin.from("organizations").select("id,business_type").eq("id", organizationId).maybeSingle();
    if (orgError || !org) return json({ error: "المنشأة غير موجودة." }, 404);
    if (plan.business_type && org.business_type && plan.business_type !== org.business_type) return json({ error: "هذه الباقة لا تتوافق مع نوع المنشأة." }, 400);

    const originalAmount = Number(plan.price_sar);
    if (!Number.isFinite(originalAmount) || originalAmount <= 0) return json({ error: "قيمة الباقة غير صحيحة." }, 400);
    let coupon: { code: string; discount_percent: number } | null = null;
    if (couponCode) {
      const { data: row, error: couponError } = await admin.from("subscription_coupons").select("code,discount_percent,max_redemptions,redemption_count,is_active,expires_at").eq("code", couponCode).maybeSingle();
      if (couponError || !row || !row.is_active || Number(row.redemption_count) >= Number(row.max_redemptions) || (row.expires_at && new Date(row.expires_at).getTime() <= Date.now())) {
        return json({ error: "كود الخصم غير صالح أو منتهي أو استنفد عدد استخداماته." }, 400);
      }
      coupon = { code: row.code, discount_percent: Number(row.discount_percent) };
    }
    const amount = Number((originalAmount * (1 - (coupon?.discount_percent || 0) / 100)).toFixed(2));
    if (!Number.isFinite(amount) || amount <= 0) return json({ error: "المبلغ بعد الخصم غير صالح." }, 400);
    const amountText = amount.toFixed(2);
    const currency = "SAR";

    const { data: paymentRequest, error: insertError } = await admin.from("subscription_payment_requests").insert({
      organization_id: organizationId,
      user_id: userData.user.id,
      plan_code: planCode,
      amount_sar: amountText,
      original_amount_sar: originalAmount.toFixed(2),
      coupon_code: coupon?.code || null,
      payment_method: "online",
      status: "awaiting_gateway",
    }).select("id").single();
    if (insertError || !paymentRequest) {
      console.error("Payment request error:", insertError);
      return json({ error: "تعذر إنشاء طلب الاشتراك." }, 500);
    }

    const timestamp = new Date().toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "");
    const merchantReferenceId = paymentRequest.id;
    const signature = await createSignature(publicKey, amountText, currency, merchantReferenceId, apiPassword, timestamp);
    const callbackUrl = `${supabaseUrl}/functions/v1/miqyas-geidea-callback`;
    const returnUrl = `${appUrl}?payment=geidea`;
    const auth = toBase64(new TextEncoder().encode(`${publicKey}:${apiPassword}`));
    const gatewayResponse = await fetch("https://api.ksamerchant.geidea.net/payment-intent/api/v2/direct/session", {
      method: "POST",
      headers: { "Authorization": `Basic ${auth}`, "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ amount: amountText, currency, timestamp, merchantReferenceId, signature, callbackUrl, returnUrl, language: "ar", paymentOperation: "Pay", initiatedBy: "Internet" }),
    });
    const gatewayData = await gatewayResponse.json().catch(() => ({}));
    const sessionId = gatewayData?.session?.id;
    if (!gatewayResponse.ok || gatewayData?.responseCode !== "000" || gatewayData?.detailedResponseCode !== "000" || !sessionId) {
      console.error("Geidea response:", gatewayData);
      await admin.from("subscription_payment_requests").update({ status: "rejected" }).eq("id", paymentRequest.id);
      return json({ error: gatewayData?.detailedResponseMessage || gatewayData?.responseMessage || "تعذر إنشاء جلسة الدفع من جيديا." }, 502);
    }
    const { error: updateError } = await admin.from("subscription_payment_requests").update({ gateway_checkout_id: sessionId }).eq("id", paymentRequest.id);
    if (updateError) {
      console.error("Session save error:", updateError);
      return json({ error: "تم إنشاء جلسة الدفع لكن تعذر حفظ مرجعها." }, 500);
    }
    return json({ session_id: sessionId, payment_request_id: paymentRequest.id, status: "awaiting_gateway", original_amount: originalAmount, amount, coupon_applied: !!coupon, coupon_code: coupon?.code || null });
  } catch (error) {
    console.error("MIQYAS Geidea error:", error);
    return json({ error: "حدث خطأ أثناء تجهيز عملية الدفع." }, 500);
  }
});
