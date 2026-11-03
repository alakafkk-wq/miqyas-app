import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cfg = window.MIQYAS_CONFIG || {};
const $ = (s) => document.querySelector(s);
const supabase = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY);

let authMode = "login";
let currentUser = null;
let currentOrg = null;
let branches = [];
let assessments = [];
let customerFeedback = [];
let activeFeedbackToken = null;
let activeFeedbackUrl = "";
let subscriptionPlans = [];
let currentSubscription = null;
let subscriptionRequests = [];
let adminSubscriptions = [];
let isPlatformAdmin = false;
let adminRequestsChannel = null;
let subscriptionAccessActive = false;
let subscriptionAccessError = false;

function toast(msg) {
  const el = $("#toast"); el.textContent = msg; el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2600);
}
function message(id, msg, error=false) {
  const el=$(id); el.textContent=msg; el.className="message "+(error?"error":"success");
}
function show(view) {
  ["#authView","#orgView","#appView"].forEach(s=>$(s).classList.add("hidden"));
  $(view).classList.remove("hidden");
}
function setBusy(button, busy, text) {
  button.disabled=busy; if (busy) {button.dataset.old=button.textContent;button.textContent=text||"جارٍ التنفيذ...";}
  else if(button.dataset.old){button.textContent=button.dataset.old;delete button.dataset.old;}
}
function escapeHtml(s) {
  return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function score(row) {
  const total=row.positive_count+row.neutral_count+row.negative_count;
  return total ? Math.round(row.positive_count/total*100) : 0;
}
function avg(a) { return a.length ? Math.round(a.reduce((s,x)=>s+x,0)/a.length) : null; }


// MIQYAS v1.13: service navigation and ecommerce store registry.
function setServiceView(name){
  const map={dashboard:["#stats","#subscriptionGate","#serviceStatusPanel"],branches:["#workspaceFeatures"],ecommerce:["#ecommerceService"],reports:["#workspaceFeatures"],subscription:["#subscriptionPanel"]};
  const all=["#stats","#subscriptionGate","#serviceStatusPanel","#workspaceFeatures","#ecommerceService","#subscriptionPanel"];
  all.forEach(sel=>{const el=$(sel);if(el)el.classList.add("hidden");});
  (map[name]||map.dashboard).forEach(sel=>{const el=$(sel);if(el)el.classList.remove("hidden");});
  if(name==="ecommerce") loadEcommerceStores();
}
async function loadEcommerceStores(){
  const body=$("#ecommerceStoreRows"); if(!body||!currentOrg)return;
  body.innerHTML='<tr><td colspan="4">جارٍ تحميل المتاجر...</td></tr>';
  const {data,error}=await supabase.from("ecommerce_stores")
    .select("id,store_name,platform,store_url,connection_status,created_at")
    .eq("organization_id",currentOrg.id).order("created_at",{ascending:false});
  if(error){body.innerHTML=`<tr><td colspan="4">${escapeHtml(error.message)}</td></tr>`;return;}
  body.innerHTML=(data||[]).length?data.map(s=>`<tr><td>${escapeHtml(s.store_name)}</td><td>${escapeHtml(({salla:"سلة",zid:"زد",shopify:"Shopify",woocommerce:"WooCommerce",custom:"متجر خاص"})[s.platform]||s.platform)}</td><td>${s.connection_status==="connected"?"متصل":"بانتظار اختبار الربط"}</td><td>${adminDate(s.created_at)}</td></tr>`).join(""):'<tr><td colspan="4">لم تتم إضافة متاجر بعد</td></tr>';
}
$("#serviceSelect")?.addEventListener("change",e=>setServiceView(e.target.value));
$("#refreshStores")?.addEventListener("click",loadEcommerceStores);
$("#storeConnectForm")?.addEventListener("submit",async e=>{
  e.preventDefault();
  if(!isPlatformAdmin&&!subscriptionAccessActive){message("#storeMessage","إضافة متجر إلكتروني تتطلب اشتراكاً فعالاً.",true);return;}
  const btn=$("#addStoreBtn");setBusy(btn,true,"جارٍ إضافة المتجر...");
  try{
    const url=$("#storeUrl").value.trim();
    const parsed=new URL(url);if(parsed.protocol!=="https:")throw new Error("يجب أن يبدأ رابط المتجر بـ https://");
    const {error}=await supabase.from("ecommerce_stores").insert({
      organization_id:currentOrg.id,store_name:$("#storeName").value.trim(),
      platform:$("#storePlatform").value,store_url:url,connection_status:"pending"
    });
    if(error)throw error;
    e.target.reset();message("#storeMessage","تم تسجيل المتجر. يلزم إعداد Webhook ونشر نقطة الاستقبال ثم اختبار الربط.");
    await loadEcommerceStores();
  }catch(err){message("#storeMessage",err.message||"تعذرت إضافة المتجر.",true);}
  finally{setBusy(btn,false);}
});

function renderContactInfo(){
  const email=String(cfg.CONTACT_EMAIL||"").trim();
  const whatsapp=String(cfg.WHATSAPP_NUMBER||"").replace(/[^0-9]/g,"");
  const emailLink=$("#contactEmailLink"), waLink=$("#contactWhatsAppLink");
  if(email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
    emailLink.href=`mailto:${email}`; emailLink.classList.remove("hidden");
  } else emailLink.classList.add("hidden");
  if(whatsapp.length>=8){
    waLink.href=`https://wa.me/${whatsapp}`; waLink.classList.remove("hidden");
  } else waLink.classList.add("hidden");
  $("#contactInfoPending").classList.toggle("hidden",Boolean(email||whatsapp));
  $("#contactStrip").classList.toggle("hidden",!email&&!whatsapp);
}
function validGoogleMapsUrl(value){
  if(!value) return true;
  try{
    const u=new URL(value);
    return u.protocol==="https:" && (
      u.hostname==="maps.google.com" ||
      u.hostname==="www.google.com" ||
      u.hostname==="google.com" ||
      u.hostname==="maps.app.goo.gl" ||
      u.hostname==="goo.gl"
    );
  }catch(e){return false;}
}

async function initPublicFeedback(){
  const token=new URLSearchParams(location.search).get("feedback");
  if(!token) return false;
  activeFeedbackToken=token;
  show("#publicFeedbackView");
  $("#publicFeedbackForm").addEventListener("submit",async e=>{
    e.preventDefault();
    const btn=$("#publicFeedbackSubmit"); setBusy(btn,true,"جارٍ إرسال رأيك...");
    try{
      const rating=document.querySelector('input[name="publicRating"]:checked')?.value;
      if(!rating) throw new Error("اختر تقييمك أولاً.");
      const {error}=await supabase.rpc("submit_public_feedback",{
        p_token:activeFeedbackToken,p_rating:rating,p_comment:$("#publicComment").value.trim()||null
      });
      if(error) throw error;
      $("#publicFeedbackForm").classList.add("hidden");
      message("#publicFeedbackMessage","شكراً لك! تم استلام تقييمك بنجاح.");
    }catch(err){message("#publicFeedbackMessage",err.message||"تعذر إرسال التقييم. حاول مرة أخرى.",true);}
    finally{setBusy(btn,false);}
  });
  try{
    const {data,error}=await supabase.rpc("get_public_branch_name",{p_token:token});
    if(!error && data) $("#publicBranchName").textContent=`قيّم تجربتك في ${data}`;
  }catch(e){}
  return true;
}
document.querySelectorAll("[data-auth]").forEach(btn=>btn.addEventListener("click",()=>{
  authMode=btn.dataset.auth;
  document.querySelectorAll("[data-auth]").forEach(b=>b.classList.toggle("active",b===btn));
  $("#authSubmit").textContent=authMode==="login"?"تسجيل الدخول":"إنشاء الحساب";
  $("#password").autocomplete=authMode==="login"?"current-password":"new-password";
  message("#authMessage","");
}));
$("#authForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const btn=$("#authSubmit"); setBusy(btn,true);
  const email=$("#email").value.trim(), password=$("#password").value;
  try {
    if(authMode==="signup"){
      const {data,error}=await supabase.auth.signUp({email,password});
      if(error) throw error;
      if(!data.session) message("#authMessage","تم إنشاء الحساب. تحقق من بريدك الإلكتروني لتأكيد الحساب، ثم ارجع وسجّل الدخول.");
      else {message("#authMessage","تم إنشاء الحساب بنجاح."); await handleSession(data.session);}
    } else {
      const {data,error}=await supabase.auth.signInWithPassword({email,password});
      if(error) throw error;
      await handleSession(data.session);
    }
  } catch(err){message("#authMessage",err.message||"تعذر إتمام العملية.",true);}
  finally{setBusy(btn,false);}
});
async function handleSession(session) {
  currentUser=session?.user||null;
  if(!currentUser){show("#authView");return;}
  $("#connection").textContent="متصل";
  $("#connection").classList.add("online");
  $("#signOut").classList.remove("hidden");
  await loadOrganizations();
}
async function loadOrganizations() {
  const {data,error}=await supabase.from("organizations").select("id,name,industry,created_at").order("created_at",{ascending:true});
  if(error) throw error;
  if(!data?.length){show("#orgView");return;}
  currentOrg=data[0];
  await loadWorkspace();
}
$("#orgForm").addEventListener("submit",async e=>{
  e.preventDefault(); const btn=e.submitter; setBusy(btn,true);
  try {
    const {data,error}=await supabase.rpc("create_organization",{org_name:$("#orgName").value.trim(),org_industry:$("#industry").value});
    if(error) throw error;
    const {data:org,error:readError}=await supabase.from("organizations").select("id,name,industry").eq("id",data).single();
    if(readError) throw readError;
    currentOrg=org; await loadWorkspace(); toast("تم إنشاء مساحة المنشأة");
  } catch(err){message("#orgMessage",err.message||"تعذر إنشاء المنشأة.",true);}
  finally{setBusy(btn,false);}
});
async function loadWorkspace() {
  $("#orgTitle").textContent=currentOrg.name;
  show("#appView");
  await loadSubscriptionData();
  applySubscriptionGate();
  if(subscriptionAccessActive){
    await refreshData();
  }else{
    branches=[]; assessments=[]; customerFeedback=[];
    render();
  }
  const serviceSelect=$("#serviceSelect");
  if(serviceSelect){serviceSelect.value="dashboard";setServiceView("dashboard");}
}
async function refreshData() {
  const [b,e,f]=await Promise.all([
    supabase.from("branches").select("id,name,city,area,google_maps_url,public_token,created_at").eq("organization_id",currentOrg.id).order("created_at",{ascending:false}),
    supabase.from("quality_assessments").select("id,branch_id,assessment_type,positive_count,neutral_count,negative_count,score,notes,created_at").eq("organization_id",currentOrg.id).order("created_at",{ascending:false}).limit(100),
    supabase.from("customer_feedback").select("id,branch_id,rating,comment,created_at").eq("organization_id",currentOrg.id).order("created_at",{ascending:false}).limit(500)
  ]);
  if(b.error) throw b.error;
  if(e.error) throw e.error;
  if(f.error) throw f.error;
  branches=b.data||[]; assessments=e.data||[]; customerFeedback=f.data||[];
  render();
}

const planLabels={basic:"الأساسية",professional:"الاحترافية",enterprise:"المؤسسات"};
const requestStatusLabels={pending:"بانتظار المراجعة",awaiting_gateway:"بانتظار الدفع الإلكتروني",approved:"معتمد",rejected:"مرفوض",cancelled:"ملغي"};
function showSubscriptionSetupError(err){
  $("#subscriptionStatus").textContent="يتطلب إعداد قاعدة البيانات";
  $("#currentPlanName").textContent="لم يتم إعداد الاشتراكات بعد";
  $("#currentPlanDates").textContent="نفّذ ملف MIQYAS_SUBSCRIPTIONS.sql في Supabase لتفعيل هذه الميزة.";
  $("#subscriptionMessage").textContent=err?.message||"ميزة الاشتراكات غير مفعلة بعد.";
  $("#subscriptionMessage").className="message error";
}
async function loadSubscriptionData(){
  try{
    const [plansRes,subRes,reqRes,adminRes]=await Promise.all([
      supabase.from("subscription_plans").select("code,name,price_sar,billing_period_months,branch_limit,max_users,features").eq("is_active",true).order("price_sar"),
      supabase.from("organization_subscriptions").select("id,plan_code,status,starts_at,ends_at,payment_method").eq("organization_id",currentOrg.id).order("created_at",{ascending:false}).limit(1),
      supabase.from("subscription_payment_requests").select("id,plan_code,amount_sar,payment_method,status,transfer_reference,created_at").eq("organization_id",currentOrg.id).order("created_at",{ascending:false}).limit(20),
      supabase.rpc("is_platform_admin")
    ]);
    if(plansRes.error) throw plansRes.error;
    if(subRes.error) throw subRes.error;
    if(reqRes.error) throw reqRes.error;
    if(adminRes.error) throw adminRes.error;
    subscriptionPlans=plansRes.data||[];
    currentSubscription=subRes.data?.[0]||null;
    subscriptionRequests=reqRes.data||[];
    isPlatformAdmin=adminRes.data===true;
    subscriptionAccessError=false;
    subscriptionAccessActive=isPlatformAdmin||isCurrentSubscriptionActive();
    renderSubscription();
    applySubscriptionGate();
    if(isPlatformAdmin){
      await loadAdminSubscriptionRequests();
      await loadAdminSubscriptions();
      await loadAdminOrganizations();
      startAdminRequestNotifications();
    }
    return subscriptionAccessActive;
  }catch(err){
    subscriptionAccessError=true;
    subscriptionAccessActive=false;
    showSubscriptionSetupError(err);
    applySubscriptionGate();
    return false;
  }
}
function highlightSelectedPlan(){
  const selected=$("#subscriptionPlan")?.value;
  document.querySelectorAll("[data-plan-card]").forEach(card=>{
    const active=card.dataset.planCard===selected;
    card.classList.toggle("selected",active);
    const button=card.querySelector("[data-select-plan]");
    if(button){button.textContent=active?"تم اختيار هذه الباقة":"اختيار هذه الباقة";button.setAttribute("aria-pressed",String(active));}
  });
}
function isCurrentSubscriptionActive(){
  if(!currentSubscription||currentSubscription.status!=="active") return false;
  const now=Date.now();
  const starts=currentSubscription.starts_at?new Date(currentSubscription.starts_at).getTime():0;
  const ends=currentSubscription.ends_at?new Date(currentSubscription.ends_at).getTime():Infinity;
  return starts<=now && ends>now;
}
function applySubscriptionGate(){
  const allowed=!!(isPlatformAdmin||subscriptionAccessActive);
  const gate=$("#subscriptionGate");
  if(gate){
    gate.classList.toggle("hidden",allowed);
    gate.textContent=subscriptionAccessError
      ?"تعذر التحقق من حالة الاشتراك. تم إيقاف الخدمات المدفوعة مؤقتاً لحماية بياناتك. حدّث الصفحة أو تواصل مع إدارة مقياس."
      :"منشأتك غير مشتركة حالياً أو أن الاشتراك منتهي/موقوف. اختر باقة وأرسل طلب الاشتراك، وستُفتح الفروع والتقارير بعد اعتماد الاشتراك من إدارة مقياس.";
  }
  const add=$("#addBranchBtn");
  if(add){add.disabled=!allowed;add.title=allowed?"إضافة فرع":"يتطلب اشتراكاً فعالاً";}
  const features=$("#workspaceFeatures");
  if(features) features.classList.toggle("hidden",!allowed);
}
function renderSubscription(){
  const active=isCurrentSubscriptionActive();
  $("#subscriptionStatus").textContent=active?"اشتراك نشط":"لا يوجد اشتراك نشط";
  $("#subscriptionStatus").classList.toggle("active",!!active);
  $("#currentPlanName").textContent=active?`باقة ${planLabels[currentSubscription.plan_code]||currentSubscription.plan_code}`:"لا يوجد اشتراك نشط";
  $("#currentPlanDates").textContent=active?`بدأ في ${new Date(currentSubscription.starts_at).toLocaleDateString("ar-SA")}`:"اختر الباقة المناسبة للبدء";
  $("#subscriptionExpiry").textContent=active&&currentSubscription.ends_at?`ينتهي ${new Date(currentSubscription.ends_at).toLocaleDateString("ar-SA")}`:"—";

  $("#subscriptionPlans").innerHTML=subscriptionPlans.map(p=>`<article class="plan-card ${p.code==="professional"?"featured":""}" data-plan-card="${escapeHtml(p.code)}"><h3>${escapeHtml(p.name)}</h3><strong>${Number(p.price_sar)>0?`${Number(p.price_sar).toLocaleString("ar-SA")} ر.س <small>/ شهرياً</small>`:"حسب الاتفاق"}</strong><p>حتى ${Number(p.branch_limit||0)} ${Number(p.branch_limit)===1?"فرع":"فروع"} · ${Number(p.max_users||0)} مستخدمين</p><small>${escapeHtml(Array.isArray(p.features)?p.features.join(" • "):"")}</small><button type="button" class="outline plan-select-btn" data-select-plan="${escapeHtml(p.code)}">اختيار هذه الباقة</button></article>`).join("");
  const planSelect=$("#subscriptionPlan");
  if(planSelect && !planSelect.dataset.selectionBound){
    planSelect.dataset.selectionBound="1";
    planSelect.addEventListener("change",()=>highlightSelectedPlan());
    $("#subscriptionPlans").addEventListener("click",e=>{
      const button=e.target.closest("[data-select-plan]");
      if(!button)return;
      planSelect.value=button.dataset.selectPlan;
      planSelect.dispatchEvent(new Event("change",{bubbles:true}));
      $("#subscriptionRequestForm").scrollIntoView({behavior:"smooth",block:"center"});
    });
  }
  highlightSelectedPlan();
  $("#subscriptionRequestRows").innerHTML=subscriptionRequests.length?subscriptionRequests.map(r=>`<tr><td>${new Date(r.created_at).toLocaleDateString("ar-SA")}</td><td>${planLabels[r.plan_code]||escapeHtml(r.plan_code)}</td><td>${Number(r.amount_sar).toLocaleString("ar-SA")} ر.س</td><td>${r.payment_method==="bank_transfer"?"تحويل بنكي":"إلكتروني"}</td><td>${requestStatusLabels[r.status]||escapeHtml(r.status)}</td></tr>`).join(""):'<tr><td colspan="5" class="muted">لا توجد طلبات بعد</td></tr>';
  $("#platformAdminPanel").classList.toggle("hidden",!isPlatformAdmin);
}
$("#subscriptionRequestForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const btn=$("#submitSubscriptionRequest");
  if(!currentOrg?.id){message("#subscriptionMessage","تعذر تحديد المنشأة الحالية. أعد تسجيل الدخول وحاول مرة أخرى.",true);return;}
  const planCode=$("#subscriptionPlan").value;
  if(!planCode){message("#subscriptionMessage","اختر الباقة أولاً.",true);return;}
  if($("#subscriptionPaymentMethod").value!=="online"){
    message("#subscriptionMessage","طريقة الدفع المتاحة حالياً هي الدفع الإلكتروني عبر ميسر.",true);return;
  }
  setBusy(btn,true,"جارٍ تجهيز فاتورة الدفع...");
  message("#subscriptionMessage","يتم إنشاء فاتورة آمنة عبر ميسر. يرجى الانتظار...");
  try{
    const {data,error}=await supabase.functions.invoke("miqyas-moyasar",{
      body:{action:"create_invoice",organization_id:currentOrg.id,plan_code:planCode}
    });
    if(error) throw error;
    if(!data?.checkout_url) throw new Error(data?.error||"لم يصل رابط الدفع من ميسر.");
    message("#subscriptionMessage","تم إنشاء الفاتورة. سيتم تحويلك إلى صفحة الدفع...");
    window.location.assign(data.checkout_url);
  }catch(err){
    console.error("MIQYAS checkout error",err);
    const detail=err?.context?.error||err?.message||"تعذر إنشاء فاتورة الدفع.";
    message("#subscriptionMessage",detail,true);
    setBusy(btn,false);
  }
});
$("#refreshSubscriptionRequests").addEventListener("click",async()=>{await loadAdminSubscriptionRequests();toast("تم تحديث الطلبات");});
async function loadAdminSubscriptionRequests(){
  if(!isPlatformAdmin)return;
  const {data,error}=await supabase.from("subscription_payment_requests").select("id,organization_id,plan_code,amount_sar,payment_method,status,created_at,organizations(name)").eq("status","pending").order("created_at",{ascending:true});
  if(error){$("#adminSubscriptionRows").innerHTML=`<tr><td colspan="5">${escapeHtml(error.message)}</td></tr>`;return;}
  $("#adminSubscriptionRows").innerHTML=(data||[]).length?data.map(r=>`<tr><td>${escapeHtml(r.organizations?.name||"منشأة")}</td><td>${planLabels[r.plan_code]||r.plan_code}</td><td>${Number(r.amount_sar).toLocaleString("ar-SA")} ر.س</td><td>${escapeHtml(requestStatusLabels[r.status]||r.status)}</td><td><button class="primary" data-approve-sub="${r.id}">اعتماد</button> <button class="outline" data-reject-sub="${r.id}">رفض</button></td></tr>`).join(""):'<tr><td colspan="5">لا توجد طلبات معلقة</td></tr>';
}
function startAdminRequestNotifications(){
  if(!isPlatformAdmin || adminRequestsChannel) return;
  adminRequestsChannel=supabase.channel("miqyas-admin-subscription-requests")
    .on("postgres_changes",{event:"INSERT",schema:"public",table:"subscription_payment_requests"},payload=>{
      const request=payload.new||{};
      if(!request.id) return;
      const plan=planLabels[request.plan_code]||"باقة جديدة";
      const amount=Number(request.amount_sar||0).toLocaleString("ar-SA");
      const notice=`وصل طلب اشتراك جديد: ${plan} بقيمة ${amount} ريال.`;
      toast(notice);
      if("Notification" in window && Notification.permission==="granted"){
        try{new Notification("طلب اشتراك جديد في مقياس",{body:notice,icon:"./icon.svg",tag:`miqyas-sub-${request.id}`});}catch(e){}
      }
      loadAdminSubscriptionRequests();
    })
    .subscribe();
}
$("#enableAdminNotifications")?.addEventListener("click",async()=>{
  if(!isPlatformAdmin){toast("هذه الميزة متاحة لمدير المنصة فقط.");return;}
  if(!("Notification" in window)){toast("المتصفح لا يدعم إشعارات النظام؛ ستظهر التنبيهات داخل المنصة عند فتحها.");return;}
  try{
    const permission=await Notification.requestPermission();
    toast(permission==="granted"?"تم تفعيل إشعارات طلبات الاشتراك.":"لم يتم السماح بالإشعارات؛ ستظل التنبيهات داخل المنصة متاحة عند فتحها.");
  }catch(e){toast("تعذر طلب إذن الإشعارات من المتصفح.");}
});
function adminDate(value){
  if(!value)return "—";
  const d=new Date(value); return Number.isNaN(d.getTime())?"—":d.toLocaleDateString("ar-SA");
}
function toDateInput(value){
  if(!value)return "";
  const d=new Date(value); if(Number.isNaN(d.getTime()))return "";
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
const subscriptionStatusLabels={trial:"تجريبي",active:"نشط",paused:"موقوف مؤقتاً",past_due:"متأخر السداد",expired:"منتهي",cancelled:"ملغي"};
const subscriptionActionLabels={update:"تعديل",pause:"إيقاف مؤقت",reactivate:"إعادة تفعيل",delete:"حذف الاشتراك"};
async function loadAdminSubscriptions(){
  if(!isPlatformAdmin)return;
  const body=$("#adminSubscribersRows");
  if(!body)return;
  body.innerHTML='<tr><td colspan="6">جارٍ تحميل المشتركين...</td></tr>';
  let timeoutId;
  try{
    const query=supabase.from("organization_subscriptions")
      .select("id,organization_id,plan_code,status,starts_at,ends_at,payment_method,created_at,organizations(name),subscription_plans(name,price_sar)")
      .order("created_at",{ascending:false});
    const result=await Promise.race([
      query,
      new Promise((_,reject)=>{timeoutId=setTimeout(()=>reject(new Error("انتهت مهلة تحميل المشتركين. تحقق من الاتصال ثم أعد المحاولة.")),15000);})
    ]);
    clearTimeout(timeoutId);
    const {data,error}=result;
    if(error)throw error;
    adminSubscriptions=data||[];
    body.innerHTML=adminSubscriptions.length?adminSubscriptions.map(s=>`<tr>
      <td>${escapeHtml(s.organizations?.name||"منشأة")}</td>
      <td>${escapeHtml(s.subscription_plans?.name||planLabels[s.plan_code]||s.plan_code)}</td>
      <td>${escapeHtml(subscriptionStatusLabels[s.status]||s.status)}</td>
      <td>${adminDate(s.starts_at)}</td><td>${adminDate(s.ends_at)}</td>
      <td><button type="button" class="outline" data-admin-sub-edit="${s.id}">تعديل</button>
      ${s.status==="paused"||s.status==="cancelled"||s.status==="expired"?`<button type="button" class="primary" data-admin-sub-action="reactivate" data-id="${s.id}">تفعيل</button>`:`<button type="button" class="outline" data-admin-sub-action="pause" data-id="${s.id}">إيقاف</button>`}
      <button type="button" class="danger" data-admin-sub-action="delete" data-id="${s.id}">حذف</button></td></tr>`).join(""):'<tr><td colspan="6">لا توجد اشتراكات مسجلة حالياً</td></tr>';
    await loadAdminSubscriptionAudit();
  }catch(err){
    if(timeoutId)clearTimeout(timeoutId);
    body.innerHTML=`<tr><td colspan="6">${escapeHtml(err?.message||"تعذر تحميل المشتركين. أعد المحاولة.")}</td></tr>`;
  }
}
async function loadAdminOrganizations(){
  if(!isPlatformAdmin)return;
  const body=$("#adminOrganizationsRows");
  if(!body)return;
  body.innerHTML='<tr><td colspan="5">جارٍ تحميل المنشآت...</td></tr>';
  const {data,error}=await supabase.from("organizations").select("id,name,industry,created_at").order("created_at",{ascending:false});
  if(error){body.innerHTML=`<tr><td colspan="5">${escapeHtml(error.message)}</td></tr>`;return;}
  const rows=data||[];
  body.innerHTML=rows.length?rows.map(o=>`<tr>
    <td>${escapeHtml(o.name||"—")}</td><td>${escapeHtml(o.industry||"—")}</td>
    <td>${adminDate(o.created_at)}</td><td>${o.id===currentOrg?.id?"المنشأة الحالية":"—"}</td>
    <td><button type="button" class="danger" data-delete-organization="${o.id}" data-org-name="${escapeHtml(o.name||"")}">حذف نهائي</button></td>
  </tr>`).join(""):'<tr><td colspan="5">لا توجد منشآت مسجلة</td></tr>';
}
async function loadAdminSubscriptionAudit(){
  if(!isPlatformAdmin)return;
  const {data,error}=await supabase.from("platform_subscription_audit")
    .select("created_at,organization_name,action,reason,actor_email,old_data,new_data")
    .order("created_at",{ascending:false}).limit(50);
  const body=$("#adminSubscriptionAuditRows");
  if(error){body.innerHTML=`<tr><td colspan="5">${escapeHtml(error.message)}</td></tr>`;return;}
  body.innerHTML=(data||[]).length?data.map(a=>{
    const details=a.reason|| (a.new_data?JSON.stringify(a.new_data):a.old_data?JSON.stringify(a.old_data):"—");
    return `<tr><td>${adminDate(a.created_at)}</td><td>${escapeHtml(a.organization_name||"—")}</td><td>${escapeHtml(subscriptionActionLabels[a.action]||a.action)}</td><td>${escapeHtml(details)}</td><td>${escapeHtml(a.actor_email||"مدير المنصة")}</td></tr>`;
  }).join(""):'<tr><td colspan="5">لا توجد عمليات مسجلة بعد</td></tr>';
}
function openAdminSubscriptionEdit(id){
  if(!isPlatformAdmin)return;
  const s=adminSubscriptions.find(x=>x.id===id); if(!s)return;
  $("#adminSubscriptionEditTitle").textContent=`تعديل اشتراك ${s.organizations?.name||"المنشأة"}`;
  $("#adminEditSubscriptionId").value=s.id;
  $("#adminEditPlan").innerHTML=subscriptionPlans.map(p=>`<option value="${escapeHtml(p.code)}">${escapeHtml(p.name)}</option>`).join("");
  $("#adminEditPlan").value=s.plan_code;
  $("#adminEditStatus").value=s.status;
  $("#adminEditStart").value=toDateInput(s.starts_at);
  $("#adminEditEnd").value=toDateInput(s.ends_at);
  $("#adminEditReason").value="";
  message("#adminSubscriptionEditMessage","");
  $("#adminSubscriptionEditForm").classList.remove("hidden");
  $("#adminSubscriptionEditForm").scrollIntoView({behavior:"smooth",block:"center"});
}
$("#refreshAdminSubscriptions").addEventListener("click",async()=>{await loadAdminSubscriptions();toast("تم تحديث قائمة المشتركين");});
$("#refreshAdminOrganizations").addEventListener("click",async()=>{await loadAdminOrganizations();toast("تم تحديث قائمة المنشآت");});
$("#cancelAdminSubscriptionEdit").addEventListener("click",()=>$("#adminSubscriptionEditForm").classList.add("hidden"));
$("#adminSubscriptionEditForm").addEventListener("submit",async e=>{
  e.preventDefault(); if(!isPlatformAdmin)return;
  const btn=$("#saveAdminSubscription");setBusy(btn,true,"جارٍ الحفظ...");
  try{
    const start=$("#adminEditStart").value, end=$("#adminEditEnd").value;
    if(!start)throw new Error("حدد تاريخ بداية الاشتراك.");
    if(end&&new Date(end)<new Date(start))throw new Error("تاريخ نهاية الاشتراك لا يمكن أن يسبق تاريخ البداية.");
    const {error}=await supabase.rpc("platform_manage_subscription",{
      p_subscription_id:$("#adminEditSubscriptionId").value,p_action:"update",
      p_plan_code:$("#adminEditPlan").value,p_status:$("#adminEditStatus").value,
      p_starts_at:new Date(`${start}T00:00:00`).toISOString(),
      p_ends_at:end?new Date(`${end}T23:59:59`).toISOString():null,
      p_reason:$("#adminEditReason").value.trim()||null
    });
    if(error)throw error;
    message("#adminSubscriptionEditMessage","تم تحديث الاشتراك بنجاح.");
    $("#adminSubscriptionEditForm").classList.add("hidden");
    await loadAdminSubscriptions(); await loadSubscriptionData();
    toast("تم حفظ التعديلات");
  }catch(err){message("#adminSubscriptionEditMessage",err.message||"تعذر تعديل الاشتراك.",true);}
  finally{setBusy(btn,false);}
});

$("#platformAdminPanel").addEventListener("click",async e=>{
  const deleteOrg=e.target.closest("[data-delete-organization]");
  if(deleteOrg){
    if(!isPlatformAdmin)return;
    const orgId=deleteOrg.dataset.deleteOrganization, orgName=deleteOrg.dataset.orgName||"";
    if(!confirm(`تنبيه: سيتم حذف المنشأة "${orgName}" نهائياً مع الفروع والتقييمات وآراء العملاء والاشتراكات وطلبات الدفع. لا يمكن التراجع. هل تريد المتابعة؟`))return;
    const typed=prompt(`للتأكيد، اكتب اسم المنشأة كما هو تماماً:\n${orgName}`);
    if(typed===null)return;
    if(typed.trim()!==orgName){toast("اسم المنشأة غير مطابق. لم يتم الحذف.");return;}
    deleteOrg.disabled=true;
    const {data,error}=await supabase.rpc("platform_delete_organization",{p_organization_id:orgId,p_confirm_name:typed.trim()});
    deleteOrg.disabled=false;
    if(error){toast(error.message||"تعذر حذف المنشأة");return;}
    toast(data||"تم حذف المنشأة نهائياً");
    await loadAdminOrganizations(); await loadAdminSubscriptionRequests(); await loadAdminSubscriptions(); await loadAdminSubscriptionAudit();
    return;
  }

  const edit=e.target.closest("[data-admin-sub-edit]");
  if(edit){openAdminSubscriptionEdit(edit.dataset.adminSubEdit);return;}
  const actionBtn=e.target.closest("[data-admin-sub-action]");
  if(actionBtn){
    if(!isPlatformAdmin)return;
    const action=actionBtn.dataset.adminSubAction,id=actionBtn.dataset.id;
    const prompts={pause:"هل تريد إيقاف الاشتراك مؤقتاً؟ ستبقى بيانات المنشأة محفوظة.",reactivate:"هل تريد إعادة تفعيل الاشتراك؟",delete:"سيتم حذف سجل الاشتراك فقط. لن تُحذف المنشأة أو الفروع أو المستخدمون أو التقييمات. هل تريد المتابعة؟"};
    if(!confirm(prompts[action]||"تأكيد العملية؟"))return;
    const reason=prompt("يمكنك كتابة ملاحظة للعملية (اختياري):")||null;
    const {error}=await supabase.rpc("platform_manage_subscription",{
      p_subscription_id:id,p_action:action,p_plan_code:null,p_status:null,p_starts_at:null,p_ends_at:null,p_reason:reason
    });
    if(error){toast(error.message);return;}
    toast(action==="delete"?"تم حذف سجل الاشتراك مع الاحتفاظ ببيانات المنشأة":action==="pause"?"تم إيقاف الاشتراك مؤقتاً":"تمت إعادة تفعيل الاشتراك");
    await loadAdminSubscriptions(); await loadSubscriptionData(); return;
  }
  const approve=e.target.closest("[data-approve-sub]"),reject=e.target.closest("[data-reject-sub]");
  if(!approve&&!reject)return;
  const id=(approve||reject).dataset.approveSub||(approve||reject).dataset.rejectSub;
  const rpc=approve?"approve_subscription_payment_request":"reject_subscription_payment_request";
  const {error}=await supabase.rpc(rpc,{p_request_id:id});
  if(error){toast(error.message);return;}
  toast(approve?"تم اعتماد الاشتراك":"تم رفض الطلب");
  await loadAdminSubscriptionRequests();
  await loadSubscriptionData();
});
function getFilteredData() {
  const area=$("#filterArea")?.value||"";
  const branchId=$("#filterBranch")?.value||"";
  const startDate=$("#filterStartDate")?.value||"";
  const endDate=$("#filterEndDate")?.value||"";
  const inDateRange=(row)=>{
    if(!row.created_at) return !startDate&&!endDate;
    const d=new Date(row.created_at);
    if(Number.isNaN(d.getTime())) return false;
    const day=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    return (!startDate||day>=startDate)&&(!endDate||day<=endDate);
  };
  const selectedBranches=branches.filter(b=>(!area||String(b.area||"")===area)&&(!branchId||b.id===branchId));
  const ids=new Set(selectedBranches.map(b=>b.id));
  const filteredAssessments=assessments.filter(x=>ids.has(x.branch_id)&&inDateRange(x));
  const filteredFeedback=customerFeedback.filter(x=>ids.has(x.branch_id)&&inDateRange(x));
  return {selectedBranches,filteredAssessments,filteredFeedback};
}
function updateFilterOptions() {
  const areaEl=$("#filterArea"), branchEl=$("#filterBranch");
  if(!areaEl||!branchEl) return;
  const oldArea=areaEl.value, oldBranch=branchEl.value;
  const areas=[...new Set(branches.map(b=>String(b.area||"").trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"ar"));
  areaEl.innerHTML='<option value="">كل المناطق</option>'+areas.map(a=>`<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`).join("");
  if(areas.includes(oldArea)) areaEl.value=oldArea;
  const visible=branches.filter(b=>!areaEl.value||String(b.area||"")===areaEl.value);
  branchEl.innerHTML='<option value="">كل الفروع</option>'+visible.map(b=>`<option value="${escapeHtml(b.id)}">${escapeHtml(b.name)}</option>`).join("");
  if(visible.some(b=>b.id===oldBranch)) branchEl.value=oldBranch;
}
function renderSentiment(pos,neu,neg) {
  const total=pos+neu+neg;
  $("#voiceTotalLabel").textContent=`${total} صوت`;
  const items=[
    {label:"إيجابي",value:pos,cls:"positive"},
    {label:"محايد",value:neu,cls:"neutral"},
    {label:"سلبي",value:neg,cls:"negative"}
  ];
  $("#sentimentChart").innerHTML=items.map(x=>{
    const pct=total?Math.round(x.value/total*100):0;
    return `<div class="sentiment-row"><div class="sentiment-label"><span>${x.label}</span><b>${x.value}</b></div><div class="sentiment-track"><span class="${x.cls}" style="width:${pct}%"></span></div><small>${pct}%</small></div>`;
  }).join("");
  $("#sentimentLegend").innerHTML=items.map(x=>`<span><i class="${x.cls}"></i>${x.label}: ${x.value}</span>`).join("");
}
function render() {
  updateFilterOptions();
  const {selectedBranches,filteredAssessments,filteredFeedback}=getFilteredData();
  $("#branchCount").textContent=selectedBranches.length;
  // Quality records are kept separate from customer QR feedback.
  $("#evalCount").textContent=filteredAssessments.length;
  // Average quality is based on formal quality assessments, not individual QR responses.
  const scores=filteredAssessments.map(x=>Number(x.score)).filter(Number.isFinite);
  $("#avgScore").textContent=avg(scores)===null?"—":avg(scores)+"%";
  // Customer voice is based ONLY on individual QR feedback records.
  const pos=filteredFeedback.filter(x=>x.rating==="positive").length;
  const neu=filteredFeedback.filter(x=>x.rating==="neutral").length;
  const neg=filteredFeedback.filter(x=>x.rating==="negative").length;
  const voiceTotal=filteredFeedback.length;
  $("#voiceCount").textContent=voiceTotal;
  $("#vocScore").textContent=voiceTotal?Math.round(pos/voiceTotal*100)+"%":"—";
  renderSentiment(pos,neu,neg);

  $("#branchList").classList.toggle("empty",!selectedBranches.length);
  $("#branchList").innerHTML=selectedBranches.length?selectedBranches.map(b=>{
    const count=filteredFeedback.filter(x=>x.branch_id===b.id).length;
    return `<div class="branchitem"><div><b>${escapeHtml(b.name)}</b><small>${escapeHtml([b.area,b.city].filter(Boolean).join(" · ")||"لم تحدد المنطقة")}</small></div><div class="branch-tools"><span class="count">${count} صوت عميل</span>${validGoogleMapsUrl(b.google_maps_url)?(b.google_maps_url?`<a class="maps-link" href="${escapeHtml(b.google_maps_url)}" target="_blank" rel="noopener noreferrer">فتح موقع الفرع على Google Maps ↗</a>`:""):""}<button class="outline" data-qr="${escapeHtml(b.id)}">QR التقييم</button></div></div>`;
  }).join(""):"لا توجد فروع مطابقة للتصفية";
  $("#evalBranch").innerHTML=branches.map(b=>`<option value="${escapeHtml(b.id)}">${escapeHtml(b.name)}</option>`).join("");
  $("#saveEval").disabled=!branches.length;

  const qualityRows=filteredAssessments.map(x=>{
    const b=branches.find(z=>z.id===x.branch_id);
    const types={voc:"صوت العميل (يدوي)",mystery_shopper:"المتسوق السري",internal:"تقييم داخلي"};
    return {created_at:x.created_at,html:`<tr><td>${x.created_at?new Date(x.created_at).toLocaleString("ar-SA"):"—"}</td><td>${escapeHtml(b?.name||"فرع")}</td><td>${types[x.assessment_type]||escapeHtml(x.assessment_type)}</td><td>${Number(x.positive_count||0)}</td><td>${Number(x.neutral_count||0)}</td><td>${Number(x.negative_count||0)}</td><td>${Math.round(Number(x.score)||0)}%</td><td>${escapeHtml(x.notes||"—")}</td></tr>`};
  });
  const feedbackRows=filteredFeedback.map(x=>{
    const b=branches.find(z=>z.id===x.branch_id);
    const ratingLabel={positive:"إيجابي",neutral:"محايد",negative:"سلبي"};
    return {created_at:x.created_at,html:`<tr><td>${x.created_at?new Date(x.created_at).toLocaleString("ar-SA"):"—"}</td><td>${escapeHtml(b?.name||"فرع")}</td><td>QR</td><td>${x.rating==="positive"?1:0}</td><td>${x.rating==="neutral"?1:0}</td><td>${x.rating==="negative"?1:0}</td><td>${ratingLabel[x.rating]||"—"}</td><td>${escapeHtml(x.comment||"—")}</td></tr>`};
  });
  qualityRows.sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
  feedbackRows.sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
  $("#qualityRows").innerHTML=qualityRows.length?qualityRows.map(x=>x.html).join(""):'<tr><td colspan="8" class="muted">لا توجد سجلات جودة مطابقة للتصفية</td></tr>';
  $("#feedbackRows").innerHTML=feedbackRows.length?feedbackRows.map(x=>x.html).join(""):'<tr><td colspan="8" class="muted">لا توجد مشاركات QR مطابقة للتصفية</td></tr>';
}
$("#branchList").addEventListener("click",e=>{
  const btn=e.target.closest("[data-qr]"); if(!btn) return;
  const branch=branches.find(x=>x.id===btn.dataset.qr); if(!branch?.public_token){toast("رمز الفرع غير متاح. نفّذ تحديث قاعدة البيانات أولاً.");return;}
  const url=new URL(window.location.href); url.search=""; url.searchParams.set("feedback",branch.public_token);
  activeFeedbackUrl=url.toString();
  $("#qrBranchTitle").textContent=branch.name;
  $("#qrUrlText").textContent=activeFeedbackUrl;
  $("#qrCanvas").innerHTML="";
  if(window.QRCode) new QRCode($("#qrCanvas"),{text:activeFeedbackUrl,width:210,height:210});
  else $("#qrCanvas").textContent="تعذر تحميل مولّد QR؛ استخدم رابط التقييم أدناه.";
  $("#qrDialog").showModal();
});
$("#closeQr").addEventListener("click",()=>$("#qrDialog").close());
$("#copyFeedbackLink").addEventListener("click",async()=>{try{await navigator.clipboard.writeText(activeFeedbackUrl);toast("تم نسخ رابط التقييم");}catch(e){toast("انسخ الرابط يدوياً من النص الظاهر");}});
$("#addBranchBtn").addEventListener("click",()=>{
  if(!isPlatformAdmin&&!subscriptionAccessActive){toast("إضافة الفروع تتطلب اشتراكاً فعالاً.");return;}
  $("#branchDialog").showModal();
});
$("#closeBranch").addEventListener("click",()=>$("#branchDialog").close());
$("#branchForm").addEventListener("submit",async e=>{
  e.preventDefault(); const btn=e.submitter; setBusy(btn,true);
  try{
    if(!isPlatformAdmin&&!subscriptionAccessActive) throw new Error("إضافة الفروع تتطلب اشتراكاً فعالاً.");
    const mapsUrl=$("#branchGoogleMaps").value.trim();
    if(!validGoogleMapsUrl(mapsUrl)) throw new Error("أدخل رابط Google Maps صحيحاً يبدأ بـ https://");
    const {error}=await supabase.from("branches").insert({organization_id:currentOrg.id,name:$("#branchName").value.trim(),city:$("#branchCity").value.trim()||null,area:$("#branchArea").value.trim()||null,google_maps_url:mapsUrl||null});
    if(error) throw error;
    e.target.reset(); $("#branchDialog").close(); await refreshData(); toast("تم حفظ الفرع في قاعدة البيانات");
  }catch(err){message("#branchMessage",err.message||"تعذر حفظ الفرع.",true);}
  finally{setBusy(btn,false);}
});
$("#evalForm").addEventListener("submit",async e=>{
  e.preventDefault(); const btn=$("#saveEval"); setBusy(btn,true);
  try{
    if(!isPlatformAdmin&&!subscriptionAccessActive) throw new Error("إضافة التقييمات تتطلب اشتراكاً فعالاً.");
    if($("#evalType") && $("#evalType").value!=="voc") throw new Error("الخدمة المتاحة حالياً هي صوت العميل فقط.");
    const positive=Number($("#positive").value), neutral=Number($("#neutral").value), negative=Number($("#negative").value);
    const total=positive+neutral+negative;
    if(total<=0) throw new Error("أدخل عدداً واحداً على الأقل في التقييم.");
    const scoreValue=Math.round(positive/total*100);
    const {error}=await supabase.from("quality_assessments").insert({
      organization_id:currentOrg.id,branch_id:$("#evalBranch").value,
      assessment_type:$("#evalType").value,positive_count:positive,neutral_count:neutral,
      negative_count:negative,score:scoreValue,notes:$("#notes").value.trim()||null
    });
    if(error) throw error;
    e.target.reset(); await refreshData(); toast("تم حفظ التقييم سحابياً");
  }catch(err){toast(err.message||"تعذر حفظ التقييم");}
  finally{setBusy(btn,false);}
});

function exportExcelReport() {
  if(!isPlatformAdmin&&!subscriptionAccessActive){toast("تحميل التقارير يتطلب اشتراكاً فعالاً.");return;}
  if(!window.XLSX){toast("تعذر تحميل أداة Excel. تحقق من الاتصال بالإنترنت ثم أعد المحاولة.");return;}
  const {selectedBranches,filteredAssessments,filteredFeedback}=getFilteredData();
  const positive=filteredFeedback.filter(x=>x.rating==="positive").length;
  const neutral=filteredFeedback.filter(x=>x.rating==="neutral").length;
  const negative=filteredFeedback.filter(x=>x.rating==="negative").length;
  const voiceTotal=filteredFeedback.length;
  const qualityScores=filteredAssessments.map(x=>Number(x.score)).filter(Number.isFinite);
  const selectedArea=$("#filterArea").value||"كل المناطق";
  const selectedBranch=$("#filterBranch").value?selectedBranches[0]?.name||"فرع محدد":"كل الفروع";
  const summary=[
    ["تقرير منصة مقياس - مؤشرات الجودة وصوت العميل"],
    ["تاريخ استخراج التقرير",new Date()],
    ["التصفية - المنطقة",selectedArea],
    ["التصفية - الفرع",selectedBranch],
    ["عدد الفروع",selectedBranches.length],
    ["عدد سجلات الجودة",filteredAssessments.length],
    ["عدد تقييمات العملاء عبر QR",voiceTotal],
    ["الأصوات الإيجابية",positive],
    ["الأصوات المحايدة",neutral],
    ["الأصوات السلبية",negative],
    ["رضا العملاء",voiceTotal?positive/voiceTotal:0],
    ["متوسط الجودة",qualityScores.length?qualityScores.reduce((a,b)=>a+b,0)/qualityScores.length/100:0],
    ["الفترة - من",$("#filterStartDate").value||"كل الفترات"],
    ["الفترة - إلى",$("#filterEndDate").value||"حتى تاريخ استخراج التقرير"]
  ];
  const branchRows=[["الفرع","المنطقة / الحي","المدينة","سجلات الجودة","تقييمات QR","إيجابي","محايد","سلبي","رضا العملاء","متوسط الجودة"]];
  selectedBranches.forEach(b=>{
    const ba=filteredAssessments.filter(x=>x.branch_id===b.id);
    const bf=filteredFeedback.filter(x=>x.branch_id===b.id);
    const p=bf.filter(x=>x.rating==="positive").length;
    const n=bf.filter(x=>x.rating==="neutral").length;
    const ng=bf.filter(x=>x.rating==="negative").length;
    const t=bf.length, qs=ba.map(x=>Number(x.score)).filter(Number.isFinite);
    branchRows.push([b.name,b.area||"",b.city||"",ba.length,t,p,n,ng,t?p/t:0,qs.length?qs.reduce((a,c)=>a+c,0)/qs.length/100:0]);
  });
  const voiceRows=[["التاريخ","الفرع","المنطقة / الحي","نوع المصدر","التقييم","الملاحظات"]];
  filteredFeedback.forEach(x=>{
    const b=branches.find(y=>y.id===x.branch_id);
    voiceRows.push([x.created_at?new Date(x.created_at):"",b?.name||"",b?.area||"","QR",({positive:"إيجابي",neutral:"محايد",negative:"سلبي"})[x.rating]||x.rating,x.comment||""]);
  });
  const qualityRows=[["التاريخ","الفرع","المنطقة / الحي","نوع سجل الجودة","إيجابي","محايد","سلبي","النتيجة / التصنيف","الملاحظات"]];
  filteredAssessments.forEach(x=>{
    const b=branches.find(y=>y.id===x.branch_id);
    qualityRows.push([x.created_at?new Date(x.created_at):"",b?.name||"",b?.area||"",({voc:"صوت العميل (يدوي)",mystery_shopper:"المتسوق السري",internal:"تقييم داخلي"})[x.assessment_type]||x.assessment_type,Number(x.positive_count||0),Number(x.neutral_count||0),Number(x.negative_count||0),`${Number(x.score||0)}%`,x.notes||""]);
  });
  const wb=XLSX.utils.book_new();
  const addSheet=(rows,name)=>{const ws=XLSX.utils.aoa_to_sheet(rows);ws["!cols"]=rows[0].map((_,i)=>({wch:Math.min(38,Math.max(14,...rows.slice(0,80).map(r=>String(r[i]??"").length+2)))}));XLSX.utils.book_append_sheet(wb,ws,name);};
  addSheet(summary,"الملخص");
  if(wb.Sheets["الملخص"]["B11"]) wb.Sheets["الملخص"]["B11"].z="0.0%";
  if(wb.Sheets["الملخص"]["B12"]) wb.Sheets["الملخص"]["B12"].z="0.0%";
  addSheet(branchRows,"أداء الفروع");
  const branchSheet=wb.Sheets["أداء الفروع"];
  for(let r=2;r<=branchRows.length;r++){if(branchSheet[`I${r}`])branchSheet[`I${r}`].z="0.0%";if(branchSheet[`J${r}`])branchSheet[`J${r}`].z="0.0%";}
  addSheet(voiceRows,"صوت العميل");
  addSheet(qualityRows,"سجلات الجودة");
  const safeDate=new Date().toISOString().slice(0,10);
  XLSX.writeFile(wb,`MIQYAS_Report_${safeDate}.xlsx`);
  toast("تم تجهيز تقرير Excel");
}
$("#filterArea").addEventListener("change",()=>{
  const currentBranch=$("#filterBranch").value;
  const allowed=branches.filter(b=>!$("#filterArea").value||String(b.area||"")===$("#filterArea").value);
  $("#filterBranch").innerHTML='<option value="">كل الفروع</option>'+allowed.map(b=>`<option value="${escapeHtml(b.id)}">${escapeHtml(b.name)}</option>`).join("");
  if(allowed.some(b=>b.id===currentBranch)) $("#filterBranch").value=currentBranch;
  render();
});
$("#filterBranch").addEventListener("change",render);
$("#filterStartDate").addEventListener("change",()=>{if($("#filterEndDate").value&&$("#filterStartDate").value>$("#filterEndDate").value){toast("تاريخ البداية يجب أن يسبق تاريخ النهاية");$("#filterStartDate").value="";return;}render();});
$("#filterEndDate").addEventListener("change",()=>{if($("#filterStartDate").value&&$("#filterEndDate").value<$("#filterStartDate").value){toast("تاريخ النهاية يجب أن يلي تاريخ البداية");$("#filterEndDate").value="";return;}render();});
$("#clearFilters").addEventListener("click",()=>{$("#filterArea").value="";$("#filterBranch").value="";$("#filterStartDate").value="";$("#filterEndDate").value="";render();});
$("#exportExcel").addEventListener("click",exportExcelReport);

$("#refresh").addEventListener("click",async()=>{try{await refreshData();toast("تم تحديث البيانات");}catch(e){toast(e.message);}});
$("#signOut").addEventListener("click",async()=>{
  const {error}=await supabase.auth.signOut();
  if(error){toast(error.message);return;}
  currentUser=null;currentOrg=null;branches=[];assessments=[];
  if(adminRequestsChannel){supabase.removeChannel(adminRequestsChannel);adminRequestsChannel=null;}
  $("#signOut").classList.add("hidden");$("#connection").textContent="غير متصل";$("#connection").classList.remove("online");show("#authView");
});
supabase.auth.onAuthStateChange(async(event,session)=>{
  if(event==="INITIAL_SESSION" && session) return;
  if(event==="SIGNED_IN" && session && !currentUser){try{await handleSession(session);}catch(e){toast(e.message);}}
  if(event==="SIGNED_OUT"){currentUser=null;show("#authView");}
});
renderContactInfo();
(async()=>{
  if(!cfg.SUPABASE_URL||!cfg.SUPABASE_PUBLISHABLE_KEY||cfg.SUPABASE_PUBLISHABLE_KEY.includes("PASTE_")){
    message("#authMessage","أكمل إعداد config.js بإضافة Publishable Key الخاص بمشروعك.",true);return;
  }
  if(await initPublicFeedback()) return;
  const {data:{session}}=await supabase.auth.getSession();
  if(session){try{await handleSession(session);}catch(e){message("#authMessage",e.message,true);}}
})();
if("serviceWorker" in navigator) window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(()=>{}));
