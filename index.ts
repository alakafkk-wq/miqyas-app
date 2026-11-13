import { createClient } from "https://esm.sh/@supabase/supabase-js@2";


const corsHeaders = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders });
}

function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const out = String(value).trim();
  return out.length ? out.slice(0, 500) : null;
}

function first(...values: unknown[]): string | null {
  for (const value of values) {
    const found = text(value);
    if (found) return found;
  }
  return null;
}

function validIso(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function isCancelled(eventName: string, status: string): boolean {
  const value = `${eventName} ${status}`.toLowerCase();
  return /cancel|refund|م取消|ملغ|مسترد/.test(value);
}

function normalizeStoreUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const u = new URL(value.trim().startsWith("http") ? value.trim() : `https://${value.trim()}`);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const path = u.pathname.replace(/\/+$/, "").toLowerCase();
    // Salla demo URLs may use different hosts for the same store slug.
    if (host === "salla.sa" || host.endsWith(".salla.sa")) {
      const slug = path.split("/").filter(Boolean).pop() || host.replace(/\.salla\.sa$/, "");
      return `salla:${slug}`;
    }
    return `${host}${path}`;
  } catch { return null; }
}
async function hmacSha256(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const webhookSecret = Deno.env.get("SALLA_WEBHOOK_TOKEN");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if ((!webhookSecret && !Deno.env.get("SALLA_WEBHOOK_SECRET")) || !supabaseUrl || !serviceKey) {
      return json({ error: "Server configuration missing" }, 500);
    }

    const rawBody = await req.text();
    const signatureSecret = Deno.env.get("SALLA_WEBHOOK_SECRET") ?? "";
    const signature = req.headers.get("x-salla-signature") ?? "";
    const authorization = req.headers.get("authorization") ?? "";
    const suppliedToken = authorization.replace(/^Bearer\s+/i, "").trim();
    const signatureValid = Boolean(signatureSecret && signature && safeEqual(await hmacSha256(signatureSecret, rawBody), signature.toLowerCase()));
    const legacyTokenValid = Boolean(webhookSecret && suppliedToken && safeEqual(suppliedToken, webhookSecret.trim()));
    if (!signatureValid && !legacyTokenValid) return json({ error: "Unauthorized" }, 401);
    let payload: any;
    try { payload = JSON.parse(rawBody); } catch { return json({ error: "Invalid JSON" }, 400); }

    const eventName = first(payload?.event);
    const merchantId = first(payload?.merchant);
    if (!eventName || !merchantId) return json({ error: "Missing event or merchant" }, 400);

    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const eventHash = await sha256(rawBody);

    // Idempotency: successful deliveries are ignored; failed deliveries may be retried.
    let eventRow: any = null;
    const { data: insertedEvent, error: eventInsertError } = await supabase.from("ecommerce_webhook_events")
      .insert({ provider: "salla", event_name: eventName, event_hash: eventHash, payload: { event: eventName, merchant: merchantId }, processing_status: "received" })
      .select("id").single();
    if (!eventInsertError) eventRow = insertedEvent;
    else if (eventInsertError.code === "23505") {
      const { data: prior } = await supabase.from("ecommerce_webhook_events").select("id,processing_status").eq("event_hash", eventHash).maybeSingle();
      if (!prior) return json({ error: "Could not inspect duplicate event" }, 500);
      if (["processed", "ignored"].includes(prior.processing_status)) return json({ success: true, duplicate: true });
      eventRow = prior;
      await supabase.from("ecommerce_webhook_events").update({ processing_status: "received", error_message: null, processed_at: null }).eq("id", prior.id);
    } else return json({ error: "Could not record webhook event" }, 500);
    const finish = async (status: "processed" | "ignored" | "failed", details: Record<string, unknown> = {}, error?: string) => {
      await supabase.from("ecommerce_webhook_events").update({ processing_status: status, payload: { event: eventName, merchant: merchantId, ...details }, error_message: error || null, processed_at: new Date().toISOString() }).eq("id", eventRow.id);
    };

    if (eventName === "app.store.authorize") {
      const accessToken = payload?.data?.access_token;
      const refreshToken = payload?.data?.refresh_token ?? null;
      const expires = Number(payload?.data?.expires);
      if (!accessToken || !Number.isFinite(expires)) { await finish("failed", {}, "Invalid authorization payload"); return json({ error: "Invalid authorization payload" }, 400); }

      // Verify the merchant and canonical store domain with Salla before linking any MIQYAS row.
      const infoResponse = await fetch("https://api.salla.dev/admin/v2/store/info", { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
      if (!infoResponse.ok) { await finish("failed", {}, `Salla store/info returned ${infoResponse.status}`); return json({ error: "Could not verify Salla store identity" }, 502); }
      const info = await infoResponse.json();
      const verifiedMerchant = String(info?.data?.id ?? "");
      const verifiedDomain = normalizeStoreUrl(info?.data?.domain);
      if (!verifiedMerchant || verifiedMerchant !== merchantId || !verifiedDomain) { await finish("failed", {}, "Salla merchant/domain verification mismatch"); return json({ error: "Salla identity verification failed" }, 409); }

      let store: any = null;
      const { data: linked, error: linkedError } = await supabase.from("ecommerce_stores")
        .select("id,organization_id,store_url,platform,salla_merchant_id,connection_status")
        .eq("platform", "salla").eq("salla_merchant_id", merchantId).limit(2);
      if (linkedError) { await finish("failed", {}, "Merchant mapping lookup failed"); return json({ error: "Store mapping lookup failed" }, 500); }
      if ((linked ?? []).length > 1) { await finish("failed", {}, "Duplicate merchant mapping"); return json({ error: "Merchant is mapped to multiple MIQYAS stores" }, 409); }
      if ((linked ?? []).length === 1) store = linked[0];
      else {
        const { data: pending, error: pendingError } = await supabase.from("ecommerce_stores")
          .select("id,organization_id,store_url,platform,salla_merchant_id,connection_status")
          .eq("platform", "salla").in("connection_status", ["pending", "error"]);
        if (pendingError) { await finish("failed", {}, "Pending store lookup failed"); return json({ error: "Pending store lookup failed" }, 500); }
        const matches = (pending ?? []).filter((row: any) => normalizeStoreUrl(row.store_url) === verifiedDomain);
        if (matches.length !== 1) {
          await finish("failed", { verified_domain: verifiedDomain, matching_pending_stores: matches.length }, matches.length ? "Ambiguous pending store match" : "No pending store matches verified Salla domain");
          return json({ error: matches.length ? "More than one pending store matches this Salla store" : "No pending MIQYAS store matches this Salla store URL. Check the store URL entered in MIQYAS.", matching_pending_stores: matches.length }, 409);
        }
        store = matches[0];
      }
      const { data: conflict } = await supabase.from("ecommerce_stores").select("id").eq("platform", "salla").eq("salla_merchant_id", merchantId).neq("id", store.id).limit(1).maybeSingle();
      if (conflict) { await finish("failed", {}, "Merchant already linked to another store"); return json({ error: "This Salla merchant is already linked to another MIQYAS store" }, 409); }
      const expiresAt = expires > 0 ? new Date(expires * 1000).toISOString() : null;
      const { error: credentialsError } = await supabase.from("ecommerce_store_credentials").upsert({ store_id: store.id, provider: "salla", access_token: accessToken, refresh_token: refreshToken, token_expires_at: expiresAt, updated_at: new Date().toISOString() }, { onConflict: "store_id" });
      if (credentialsError) { await finish("failed", {}, "Could not save credentials"); return json({ error: "Could not save Salla credentials" }, 500); }
      const { error: updateError } = await supabase.from("ecommerce_stores").update({ salla_merchant_id: merchantId, connection_status: "connected" }).eq("id", store.id);
      if (updateError) { await finish("failed", {}, "Could not update store connection"); return json({ error: "Could not update store connection" }, 500); }
      await finish("processed", { store_id: store.id, verified_domain: verifiedDomain });
      return json({ success: true, message: "Salla store securely connected", store_id: store.id });
    }

    // Only order-related events are handled here. Other Salla events are safely logged as ignored.
    const orderEvents = new Set([
      "order.created", "order.updated", "order.status.updated", "order.cancelled", "order.refunded",
      "shipment.created", "shipment.updated", "shipment.cancelled",
      "order.create", "order.update", "order.status_update", "order.cancel",
    ]);
    if (!orderEvents.has(eventName)) { await finish("ignored"); return json({ success: true, message: "Event ignored" }); }

    const { data: mappedStores, error: storeError } = await supabase.from("ecommerce_stores")
      .select("id, organization_id, connection_status")
      .eq("platform", "salla").eq("salla_merchant_id", merchantId).limit(2);
    if (storeError || !mappedStores?.length) {
      await finish("failed", {}, "No store mapped to merchant");
      return json({ error: "No MIQYAS store is linked to this Salla merchant" }, 404);
    }
    if (mappedStores.length !== 1) {
      await finish("failed", {}, "Duplicate merchant mapping");
      return json({ error: "Merchant mapping is ambiguous" }, 409);
    }
    const store = mappedStores[0];
    if (store.connection_status !== "connected") { await finish("failed", {}, "Store is not connected"); return json({ error: "Store is not connected" }, 409); }

    const data = payload?.data ?? {};
    const shipment = data?.shipment ?? data;
    const externalOrderId = first(data?.order_id, data?.order?.id, data?.id, shipment?.order_id, data?.reference_id);
    if (!externalOrderId) { await finish("failed", {}, "Order ID missing"); return json({ error: "Order ID missing" }, 400); }

    const status = first(data?.status?.slug, data?.status?.name, data?.status, payload?.status, eventName) ?? "unknown";
    const cancelled = isCancelled(eventName, status);
    // Do not infer delivery from shipment-created/ready/shipped statuses.
    // delivered_at is set only when Salla explicitly provides actual_delivered_at.
    const deliveredAt = validIso(
      data?.actual_delivered_at ?? data?.delivered_at ?? data?.shipment?.actual_delivered_at ??
      data?.shipment?.delivered_at ?? data?.shipping?.actual_delivered_at
    );
    const customerEmail = first(data?.customer?.email, data?.customer?.email_address);
    const customerPhone = first(data?.customer?.mobile, data?.customer?.phone, data?.customer?.mobile_code ? `${data.customer.mobile_code}${data.customer.mobile ?? ""}` : null);

    const { data: priorOrder } = await supabase.from("ecommerce_orders")
      .select("id, delivered_at, customer_email, customer_phone")
      .eq("store_id", store.id).eq("external_order_id", externalOrderId).maybeSingle();
    const previousIneligible = /(cancel|refund|ملغ|مسترد)/.test(String(priorOrder?.order_status ?? "").toLowerCase());
    const finalIneligible = cancelled || previousIneligible;
    const finalStatus = finalIneligible ? (/(refund|مسترد)/.test(`${eventName} ${status}`.toLowerCase()) ? "refunded" : "cancelled") : status;
    const effectiveDeliveredAt = finalIneligible ? null : (deliveredAt ?? priorOrder?.delivered_at ?? null);

    const { error: orderError } = await supabase.from("ecommerce_orders").upsert({
      organization_id: store.organization_id,
      store_id: store.id,
      external_order_id: externalOrderId,
      order_status: finalStatus,
      customer_email: customerEmail ?? priorOrder?.customer_email ?? null,
      customer_phone: customerPhone ?? priorOrder?.customer_phone ?? null,
      delivered_at: effectiveDeliveredAt,
    }, { onConflict: "store_id,external_order_id" });
    if (orderError) {
      await finish("failed", { order_id: externalOrderId }, "Order upsert failed");
      return json({ error: "Could not save order" }, 500);
    }

    await finish("processed", { order_id: externalOrderId, status, delivered_at: effectiveDeliveredAt });

    return json({
      success: true,
      order_saved: true,
      delivered_at_recorded: Boolean(effectiveDeliveredAt && !finalIneligible),
      invite_scheduled: false,
      message: effectiveDeliveredAt ? "Delivery timestamp recorded; invite scheduler must process it after 24 hours" : "Order saved; awaiting confirmed delivery timestamp",
    });
  } catch (_error) {
    return json({ error: "Webhook processing failed" }, 500);
  }
});
