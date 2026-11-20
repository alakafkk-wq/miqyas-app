import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
});
const sha256 = async (value: string) => {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes)).map(x => x.toString(16).padStart(2, "0")).join("");
};
const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, c =>
  ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]!)
);

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const expected = Deno.env.get("REVIEW_SCHEDULER_SECRET") ?? "";
  const supplied = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!expected || supplied !== expected) return json({ error: "Unauthorized" }, 401);

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("RESEND_FROM_EMAIL");
  if (!url || !key || !resendKey || !from) return json({ error: "Server configuration missing" }, 500);

  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const reviewPageBase = Deno.env.get("PUBLIC_REVIEW_BASE_URL") || "https://tuhaysh01.sa/?ecommerce-review=";
  const now = new Date();
  const dueBefore = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const { data: orders, error } = await db.from("ecommerce_orders")
    .select("id,organization_id,store_id,external_order_id,order_status,customer_email,delivered_at,ecommerce_stores(store_name)")
    .not("delivered_at", "is", null).lte("delivered_at", dueBefore)
    .not("order_status", "ilike", "%cancel%").not("order_status", "ilike", "%refund%")
    .limit(100);
  if (error) return json({ error: "Could not load delivered orders" }, 500);

  let created = 0, sent = 0, skipped = 0, failed = 0;
  for (const order of orders ?? []) {
    // Defensively exclude Arabic and English cancellation/refund statuses.
    // SQL filters below are only an optimization; this check is authoritative.
    const normalizedStatus = String(order.order_status ?? "").trim().toLowerCase();
    const ineligibleStatus = /cancel|cancell?ed|refund|refunded|ملغ|إلغاء|الغاء|مسترد|استرداد/.test(normalizedStatus);
    if (ineligibleStatus) {
      skipped++;
      continue;
    }
    if (!order.customer_email || !order.delivered_at) { skipped++; continue; }
    const { data: existing } = await db.from("ecommerce_review_invites").select("id,invite_status")
      .eq("order_id", order.id).maybeSingle();
    if (existing) { skipped++; continue; }

    const rawToken = crypto.randomUUID() + crypto.randomUUID().replaceAll("-", "");
    const tokenHash = await sha256(rawToken);
    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: invite, error: insertError } = await db.from("ecommerce_review_invites").insert({
      organization_id: order.organization_id, store_id: order.store_id, order_id: order.id,
      token_hash: tokenHash, invite_status: "created", expires_at: expiresAt,
      scheduled_for: new Date(new Date(order.delivered_at).getTime() + 24 * 60 * 60 * 1000).toISOString(),
      send_attempts: 1
    }).select("id").single();
    if (insertError || !invite) { failed++; continue; }
    created++;

    const storeName = Array.isArray(order.ecommerce_stores) ? order.ecommerce_stores[0]?.store_name : order.ecommerce_stores?.store_name;
    const reviewUrl = `${reviewPageBase}${encodeURIComponent(rawToken)}`;
    const html = `<div dir="rtl" style="font-family:Arial,sans-serif;line-height:1.9;color:#183b3a"><h2>يسعدنا تقييم تجربتك مع ${escapeHtml(storeName || "المتجر")}</h2><p>نرغب في معرفة رأيك بكل شفافية لتحسين تجربتك.</p><p><a href="${reviewUrl}" style="display:inline-block;background:#16b89a;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none">قيّم تجربتك</a></p><p style="color:#667">رابط التقييم صالح لمدة 30 يوماً.</p></div>`;
    let sendResponse: Response;
    try {
      sendResponse = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [order.customer_email], subject: `شاركنا رأيك في تجربتك مع ${storeName || "المتجر"}`, html })
      });
    } catch {
      sendResponse = new Response(null, { status: 599 });
    }
    if (sendResponse.ok) {
      await db.from("ecommerce_review_invites").update({ invite_status: "sent", sent_at: new Date().toISOString() }).eq("id", invite.id);
      await db.from("ecommerce_review_invite_logs").insert({
        organization_id: order.organization_id, store_id: order.store_id, order_id: order.id,
        invite_id: invite.id, event_type: "sent", message: "Review invitation sent through MIQYAS"
      });
      sent++;
    } else {
      const details = await sendResponse.text().catch(() => "");
      await db.from("ecommerce_review_invite_logs").insert({
        organization_id: order.organization_id, store_id: order.store_id, order_id: order.id,
        invite_id: invite.id, event_type: "failed", message: `Resend error ${sendResponse.status}: ${details.slice(0, 400)}`
      });
      // The raw token is intentionally never stored. Remove the unsent invite so a later run can issue a fresh token.
      await db.from("ecommerce_review_invites").delete().eq("id", invite.id).eq("invite_status", "created");
      failed++;
    }
  }
  return json({ success: true, scanned: orders?.length ?? 0, created, sent, skipped, failed });
});
