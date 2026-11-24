import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const reply = (body: unknown, status=200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const clean = (v: unknown) => String(v ?? "").replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "").trim();
const pick = (o: Record<string, unknown>, ...keys: string[]) => { for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k]; return undefined; };
function safeEqual(a: string, b: string) { if (a.length !== b.length) return false; let x=0; for(let i=0;i<a.length;i++) x |= a.charCodeAt(i)^b.charCodeAt(i); return x===0; }
async function signature(publicKey: string, password: string, amount: string, currency: string, orderId: string, status: string, merchantRef: string, timestamp: string) {
  const data = `${publicKey}${amount}${currency}${orderId}${status}${merchantRef}${timestamp}`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), {name:"HMAC",hash:"SHA-256"}, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
  let binary=""; for(const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", {headers:corsHeaders});
  if (req.method !== "POST") return reply({error:"Method not allowed"},405);
  try {
    const raw = await req.text();
    let parsed: Record<string, unknown>;
    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("application/x-www-form-urlencoded")) {
      parsed = Object.fromEntries(new URLSearchParams(raw).entries());
    } else {
      parsed = JSON.parse(raw);
    }
    const nestedData = parsed.data && typeof parsed.data === "object" ? parsed.data as Record<string, unknown> : {};
    const nestedOrder = parsed.order && typeof parsed.order === "object" ? parsed.order as Record<string, unknown> : {};
    const p = { ...parsed, ...nestedOrder, ...nestedData } as Record<string, unknown>;
    const publicKey = clean(Deno.env.get("GEIDEA_PUBLIC_KEY"));
    const password = clean(Deno.env.get("GEIDEA_API_PASSWORD"));
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!publicKey || !password || !supabaseUrl || !serviceKey) return reply({error:"Server configuration incomplete"},500);

    const amountRaw = clean(pick(p,"OrderAmount","orderAmount","amount"));
    const amount = Number(amountRaw).toFixed(2);
    const currency = clean(pick(p,"OrderCurrency","orderCurrency","currency")).toUpperCase();
    const orderId = clean(pick(p,"Orderid","OrderId","orderId","orderid"));
    const paymentStatus = clean(pick(p,"Status","status","orderStatus"));
    const merchantRef = clean(pick(p,"MerchantReferenceId","MerchantRefrenceId","merchantReferenceId","merchantRefrenceId"));
    const timestamp = clean(pick(p,"timeStamp","timestamp","TimeStamp"));
    const receivedSignature = clean(pick(p,"signature","Signature"));
    const responseCode = clean(pick(p,"responseCode","ResponseCode"));
    const responseMessage = clean(pick(p,"responseMessage","ResponseMessage"));
    const detailedCode = clean(pick(p,"detailedResponseCode","DetailedResponseCode"));
    const detailedMessage = clean(pick(p,"detailedResponseMessage","DetailedResponseMessage","detailResponseMessage"));
    if (!amountRaw || !Number.isFinite(Number(amountRaw)) || !currency || !orderId || !merchantRef || !timestamp || !receivedSignature) return reply({error:"Missing callback fields"},400);
    const expected = await signature(publicKey,password,amountRaw,currency,orderId,paymentStatus,merchantRef,timestamp);
    if (!safeEqual(expected,receivedSignature)) return reply({error:"Invalid callback signature"},401);
    const success = responseCode === "000" && detailedCode === "000" && responseMessage.toLowerCase() === "success" && detailedMessage.toLowerCase() === "the operation was successful";
    if (!success) return reply({received:true,paid:false,message:"Payment not confirmed; subscription unchanged"},200);

    const admin = createClient(supabaseUrl,serviceKey,{auth:{persistSession:false}});
    const {data,error} = await admin.rpc("finalize_geidea_subscription_payment", {
      p_request_id: merchantRef,
      p_gateway_order_id: orderId,
      p_amount_sar: amount,
      p_currency: currency
    });
    if (error) { console.error("Geidea finalize RPC error",error); return reply({error:"Could not finalize subscription"},500); }
    return reply({received:true,paid:true,invoice_id:data,order_id:orderId});
  } catch (e) {
    console.error("Geidea callback error",e);
    return reply({error:"Invalid callback payload"},400);
  }
});
