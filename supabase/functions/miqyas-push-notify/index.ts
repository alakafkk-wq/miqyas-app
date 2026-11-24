import webpush from "npm:web-push";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-miqyas-webhook-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const expected = Deno.env.get("MIQYAS_PUSH_WEBHOOK_SECRET") || "";
  const supplied = req.headers.get("x-miqyas-webhook-secret") || "";
  if (!expected || supplied !== expected) return json({ error: "Unauthorized" }, 401);

  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY") || "";
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY") || "";
  const subject = Deno.env.get("VAPID_SUBJECT") || "mailto:miqyassupport@gmail.com";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!publicKey || !privateKey || !supabaseUrl || !serviceKey) {
    return json({ error: "Push service is not configured" }, 503);
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const record = (body.record && typeof body.record === "object" ? body.record : body) as Record<string, unknown>;
  const eventType = String(body.type || body.eventType || "INSERT").toUpperCase();
  if (eventType !== "INSERT") return json({ ok: true, skipped: "unsupported event" });

  const plan = String(record.plan_code || "اشتراك");
  const amount = Number(record.amount_sar || 0);
  const message = `وصل طلب اشتراك جديد: ${plan} بقيمة ${amount.toLocaleString("ar-SA-u-ca-gregory")} ريال.`;
  const payload = JSON.stringify({
    title: "طلب اشتراك جديد في مقياس",
    body: message,
    tag: `miqyas-sub-${String(record.id || crypto.randomUUID())}`,
    url: "./",
  });

  webpush.setVapidDetails(subject, publicKey, privateKey);
  const endpoint = `${supabaseUrl}/rest/v1/miqyas_push_subscriptions?select=id,endpoint,subscription`;
  const response = await fetch(endpoint, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  if (!response.ok) return json({ error: "Could not load push subscriptions" }, 502);
  const subscriptions = await response.json() as Array<{ id: string; endpoint: string; subscription: Record<string, unknown> }>;

  const results = await Promise.allSettled(subscriptions.map(async (item) => {
    try {
      await webpush.sendNotification(item.subscription as any, payload);
      return "sent";
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        await fetch(`${supabaseUrl}/rest/v1/miqyas_push_subscriptions?id=eq.${item.id}`, {
          method: "DELETE",
          headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
        });
      }
      throw error;
    }
  }));
  const sent = results.filter((r) => r.status === "fulfilled").length;
  return json({ ok: true, sent, failed: results.length - sent });
});

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
