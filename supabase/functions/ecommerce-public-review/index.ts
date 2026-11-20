import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store"
};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: cors });
const sha256 = async (value: string) => {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes)).map(x => x.toString(16).padStart(2, "0")).join("");
};
const db = () => {
  const url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Server configuration missing");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
};
const cancelled = (status: unknown) => /cancel|refund|ملغ|مسترد/i.test(String(status ?? ""));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (!["GET", "POST"].includes(req.method)) return json({ error: "Method not allowed" }, 405);
  try {
    const token = new URL(req.url).searchParams.get("token") || (req.method === "POST" ? (await req.clone().json().catch(() => ({}))).token : null);
    if (!token || typeof token !== "string" || token.length < 24 || token.length > 200) return json({ error: "رابط التقييم غير صالح." }, 400);
    const hash = await sha256(token);
    const supabase = db();
    const { data: invite, error } = await supabase.from("ecommerce_review_invites")
      .select("id,organization_id,store_id,order_id,invite_status,expires_at,ecommerce_orders(order_status),ecommerce_stores(store_name)")
      .eq("token_hash", hash).maybeSingle();
    if (error || !invite) return json({ error: "رابط التقييم غير موجود أو غير صالح." }, 404);
    if (invite.invite_status !== "sent" || new Date(invite.expires_at) <= new Date()) return json({ error: "انتهت صلاحية رابط التقييم أو تم استخدامه." }, 410);
    const order = Array.isArray(invite.ecommerce_orders) ? invite.ecommerce_orders[0] : invite.ecommerce_orders;
    if (cancelled(order?.order_status)) return json({ error: "لا يمكن تقييم طلب ملغى أو مسترد." }, 409);
    const store = Array.isArray(invite.ecommerce_stores) ? invite.ecommerce_stores[0] : invite.ecommerce_stores;
    if (req.method === "GET") return json({ success: true, store_name: store?.store_name || "المتجر", expires_at: invite.expires_at });

    const body = await req.json();
    const fields = ["product_quality","delivery_rating","packaging_rating","checkout_rating","support_rating","overall_rating"];
    const ratings: Record<string, number> = {};
    for (const field of fields) {
      const value = Number(body[field]);
      if (!Number.isInteger(value) || value < 1 || value > 5) return json({ error: "يرجى اختيار تقييم من 1 إلى 5 لكل محور." }, 400);
      ratings[field] = value;
    }
    const comment = typeof body.comment === "string" ? body.comment.trim() : "";
    if (comment.length > 1500) return json({ error: "التعليق أطول من الحد المسموح." }, 400);
    const { error: insertError } = await supabase.from("ecommerce_reviews").insert({
      organization_id: invite.organization_id, store_id: invite.store_id, order_id: invite.order_id,
      ...ratings, comment: comment || null
    });
    if (insertError) {
      if (insertError.code === "23505") return json({ error: "تم استلام تقييم هذا الطلب مسبقاً." }, 409);
      return json({ error: "تعذر حفظ التقييم. حاول مرة أخرى." }, 500);
    }
    await supabase.from("ecommerce_review_invites").update({ invite_status: "completed" }).eq("id", invite.id).eq("invite_status", "sent");
    await supabase.from("ecommerce_review_invite_logs").insert({
      organization_id: invite.organization_id, store_id: invite.store_id, order_id: invite.order_id,
      invite_id: invite.id, event_type: "completed", message: "Customer submitted ecommerce review"
    });
    return json({ success: true, message: "شكراً لك! تم استلام تقييمك بنجاح." });
  } catch {
    return json({ error: "حدث خطأ أثناء معالجة التقييم." }, 500);
  }
});
