import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const headers = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
const jsonHeaders = { "Content-Type": "application/json", "Cache-Control": "no-store" };
function page(title: string, body: string, status = 200) { return new Response(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>*{box-sizing:border-box}body{margin:0;background:#f4f7f5;font-family:Arial,sans-serif;color:#17372c}.wrap{max-width:650px;margin:28px auto;padding:18px}.card{background:#fff;border:1px solid #e2ebe6;border-radius:18px;padding:24px;box-shadow:0 8px 28px #17372c0d}h1{font-size:24px;margin:0 0 8px}.muted{color:#687a72}.field{padding:14px 0;border-bottom:1px solid #edf1ef}.field:last-of-type{border:0}label{display:block;font-weight:700;margin-bottom:9px}.stars{display:flex;gap:9px;flex-wrap:wrap}.stars label{font-weight:400;margin:0;cursor:pointer}.stars input{accent-color:#087a50;width:18px;height:18px;vertical-align:middle}textarea{width:100%;min-height:100px;border:1px solid #ccd9d2;border-radius:10px;padding:12px;font:inherit}button{border:0;background:#087a50;color:white;padding:14px 22px;border-radius:10px;font-size:16px;font-weight:700;cursor:pointer;width:100%;margin-top:18px}button:disabled{opacity:.6}.notice{padding:13px;border-radius:10px;background:#f1f7f3;margin-top:14px}.brand{font-size:13px;color:#718178;margin-bottom:16px}</style></head><body><main class="wrap"><section class="card">${body}</section></main></body></html>`, { status, headers }); }
function json(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status, headers: jsonHeaders }); }
async function sha256(value: string): Promise<string> { const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)); return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join(""); }
function esc(value: unknown): string { return String(value ?? "").replace(/[&<>\"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)); }
const fields: Array<[string, string]> = [["product_quality","جودة المنتج"],["delivery_rating","سرعة وجودة التوصيل"],["packaging_rating","التغليف"],["checkout_rating","سهولة إتمام الشراء"],["support_rating","خدمة العملاء"],["overall_rating","رضاك العام"]];

Deno.serve(async (req) => {
  try {
    const url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return req.method === "GET" ? page("تعذر فتح التقييم", "<h1>تعذر فتح الصفحة</h1><p class='muted'>يرجى المحاولة لاحقاً.</p>", 500) : json({ error: "Server configuration missing" }, 500);
    const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const requestUrl = new URL(req.url);
    const token = requestUrl.searchParams.get("token") || (req.method === "POST" ? (await req.clone().json().catch(() => ({}))).token : null);
    if (!token || typeof token !== "string" || token.length < 32 || token.length > 200) return req.method === "GET" ? page("رابط غير صالح", "<h1>الرابط غير صالح</h1><p class='muted'>يرجى استخدام رابط الدعوة المرسل إليك.</p>", 400) : json({ error: "Invalid token" }, 400);
    const tokenHash = await sha256(token);
    const { data: invite, error } = await supabase.from("ecommerce_review_invites")
      .select("id,organization_id,store_id,order_id,invite_status,expires_at,ecommerce_stores(store_name),ecommerce_orders(order_status)")
      .eq("token_hash", tokenHash).maybeSingle();
    const linkedOrder = invite ? (Array.isArray(invite.ecommerce_orders) ? invite.ecommerce_orders[0] : invite.ecommerce_orders) : null;
    const isCancelled = /(cancel|refund|ملغ|مسترد)/.test(String(linkedOrder?.order_status ?? "").toLowerCase());
    if (error || !invite || isCancelled || new Date(invite.expires_at).getTime() < Date.now() || !["sent", "completed"].includes(invite.invite_status)) {
      return req.method === "GET" ? page("انتهت صلاحية الرابط", "<h1>الرابط غير متاح</h1><p class='muted'>قد يكون الرابط منتهياً أو مستخدماً أو غير صحيح.</p>", 404) : json({ error: "Invite expired or invalid" }, 404);
    }
    if (invite.invite_status === "completed") return req.method === "GET" ? page("شكراً لك", "<h1>شكراً لمشاركتك!</h1><p class='muted'>تم استلام تقييمك مسبقاً. نقدر وقتك.</p>") : json({ error: "Review already submitted" }, 409);

    if (req.method === "GET") {
      const store = Array.isArray(invite.ecommerce_stores) ? invite.ecommerce_stores[0] : invite.ecommerce_stores;
      const inputs = fields.map(([name, label]) => `<div class="field"><label>${label}</label><div class="stars">${[1,2,3,4,5].map((n) => `<label><input type="radio" name="${name}" value="${n}" ${n === 5 ? "checked" : ""} required> ${n} ★</label>`).join("")}</div></div>`).join("");
      const body = `<div class="brand">MIQYAS مقياس</div><h1>قيّم تجربتك مع ${esc(store?.store_name || "المتجر")}</h1><p class="muted">رأيك يساعد المتجر على تحسين خدماته. اختر تقييماً من 1 إلى 5 لكل بند.</p><form id="review"><input type="hidden" name="token" value="${esc(token)}">${inputs}<div class="field"><label for="comment">ملاحظات إضافية (اختياري)</label><textarea id="comment" name="comment" maxlength="1500" placeholder="اكتب ملاحظتك هنا..."></textarea></div><button id="send" type="submit">إرسال التقييم</button><div id="msg" class="notice" hidden></div></form><script>const f=document.getElementById('review'),b=document.getElementById('send'),m=document.getElementById('msg');f.addEventListener('submit',async e=>{e.preventDefault();b.disabled=true;b.textContent='جارٍ إرسال تقييمك...';try{const d=Object.fromEntries(new FormData(f).entries());for(const k of ['product_quality','delivery_rating','packaging_rating','checkout_rating','support_rating','overall_rating'])d[k]=Number(d[k]);const r=await fetch(location.href,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)});const j=await r.json();if(!r.ok)throw new Error(j.error||'تعذر الإرسال');f.innerHTML='<h1>شكراً لك!</h1><p class="muted">تم استلام تقييمك بنجاح.</p>'; }catch(x){m.hidden=false;m.textContent=x.message||'حدث خطأ، حاول مرة أخرى.';b.disabled=false;b.textContent='إرسال التقييم';}});</script>`;
      return page("تقييم تجربة المتجر", body);
    }
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const body = await req.json().catch(() => null);
    if (!body) return json({ error: "Invalid JSON" }, 400);
    const ratings: Record<string, number> = {};
    for (const [name] of fields) { const value = Number(body[name]); if (!Number.isInteger(value) || value < 1 || value > 5) return json({ error: `Invalid ${name}` }, 400); ratings[name] = value; }
    const comment = typeof body.comment === "string" ? body.comment.trim().slice(0, 1500) : null;
    const { error: insertError } = await supabase.from("ecommerce_reviews").insert({
      organization_id: invite.organization_id, store_id: invite.store_id, order_id: invite.order_id,
      product_quality: ratings.product_quality, delivery_rating: ratings.delivery_rating,
      packaging_rating: ratings.packaging_rating, checkout_rating: ratings.checkout_rating,
      support_rating: ratings.support_rating, overall_rating: ratings.overall_rating, comment: comment || null,
    });
    if (insertError) {
      if (insertError.code === "23505") return json({ error: "Review already submitted" }, 409);
      return json({ error: "Could not save review" }, 500);
    }
    await supabase.from("ecommerce_review_invites").update({ invite_status: "completed" }).eq("id", invite.id).eq("invite_status", "sent");
    await supabase.from("ecommerce_review_invite_logs").insert({ organization_id: invite.organization_id, store_id: invite.store_id, order_id: invite.order_id, invite_id: invite.id, event_type: "completed", message: "Customer submitted a review" });
    return json({ success: true });
  } catch (_error) {
    return req.method === "GET" ? page("حدث خطأ", "<h1>حدث خطأ</h1><p class='muted'>يرجى المحاولة لاحقاً.</p>", 500) : json({ error: "Request failed" }, 500);
  }
});
