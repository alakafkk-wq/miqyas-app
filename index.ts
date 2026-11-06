import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "يجب تسجيل الدخول أولاً." }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const googleKey = Deno.env.get("GOOGLE_MAPS_API_KEY")!;
    if (!googleKey) return json({ error: "لم يتم إعداد مفتاح Google Maps API على الخادم." }, 500);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    if (userError || !userData.user) return json({ error: "جلسة الدخول غير صالحة." }, 401);

    const { branch_id } = await req.json();
    if (!branch_id) return json({ error: "معرّف الفرع مطلوب." }, 400);

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const { data: branch, error: branchError } = await admin
      .from("branches")
      .select("id,organization_id,name,city,area,google_maps_url")
      .eq("id", branch_id).maybeSingle();
    if (branchError || !branch) return json({ error: "الفرع غير موجود." }, 404);

    const { data: membership } = await admin
      .from("organization_members")
      .select("id")
      .eq("organization_id", branch.organization_id)
      .eq("user_id", userData.user.id)
      .maybeSingle();
    if (!membership) return json({ error: "ليس لديك صلاحية الوصول إلى هذا الفرع." }, 403);
    if (!branch.google_maps_url) return json({ error: "لا يوجد رابط Google Maps مسجل لهذا الفرع." }, 400);

    // Resolve short Maps links and extract a human-readable location hint from the final URL.
    let mapUrlHint = "";
    try {
      const mapResponse = await fetch(branch.google_maps_url, { method: "GET", redirect: "follow" });
      const finalUrl = new URL(mapResponse.url || branch.google_maps_url);
      const queryHint = finalUrl.searchParams.get("q") || finalUrl.searchParams.get("query") ||
        finalUrl.searchParams.get("destination") || "";
      const pathHint = decodeURIComponent(finalUrl.pathname).replace(/[+_]/g, " ").replace(/\\//g, " ");
      mapUrlHint = `${queryHint} ${pathHint}`.replace(/\\s+/g, " ").slice(0, 300);
      await mapResponse.body?.cancel();
    } catch (_) {
      mapUrlHint = branch.google_maps_url;
    }

    // Search using both the registered branch details and the actual Maps URL hint.
    const textQuery = [mapUrlHint, branch.name, branch.area, branch.city, "Saudi Arabia"].filter(Boolean).join(", ");
    const searchResponse = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": googleKey,
        "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.reviews",
      },
      body: JSON.stringify({ textQuery, languageCode: "ar", regionCode: "SA", pageSize: 5 }),
    });
    const searchData = await searchResponse.json();
    if (!searchResponse.ok) {
      return json({ error: searchData.error?.message || "تعذر البحث عن الموقع في Google Places." }, 502);
    }

    const candidates = searchData.places || [];
    if (!candidates.length) return json({ error: "لم يتم العثور على موقع مطابق. تحقق من اسم الفرع ورابط Google Maps والمدينة." }, 404);

    // Prefer a candidate whose name appears in the registered Maps URL; otherwise use the top text-search match.
    const urlText = decodeURIComponent(branch.google_maps_url).toLowerCase();
    const matched = candidates.find((p: any) =>
      (p.displayName?.text || "").toLowerCase().split(/\s+/).some((w: string) => w.length > 3 && urlText.includes(w))
    ) || candidates[0];

    const reviews = (matched.reviews || []).map((r: any) => ({
      author_name: r.authorAttribution?.displayName || "مستخدم Google",
      rating: r.rating || null,
      text: r.text?.text || r.originalText?.text || "",
      relative_time_description: r.relativePublishTimeDescription || "",
      publish_time: r.publishTime || null,
      google_maps_uri: r.googleMapsUri || null,
    }));

    const payload = {
      organization_id: branch.organization_id,
      branch_id: branch.id,
      place_id: matched.id,
      place_name: matched.displayName?.text || null,
      rating: matched.rating ?? null,
      user_rating_count: matched.userRatingCount || 0,
      reviews,
      fetched_at: new Date().toISOString(),
    };

    const { error: saveError } = await admin
      .from("google_maps_review_snapshots")
      .upsert(payload, { onConflict: "branch_id" });
    if (saveError) return json({ error: saveError.message }, 500);

    return json({
      ok: true,
      place_id: payload.place_id,
      place_name: payload.place_name,
      rating: payload.rating,
      user_rating_count: payload.user_rating_count,
      reviews_count: reviews.length,
      reviews,
    });
  } catch (error) {
    return json({ error: error?.message || "حدث خطأ غير متوقع." }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
