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
let googleMapsSnapshots = [];
let activeFeedbackToken = null;
let activeFeedbackUrl = "";
let activeQrUrl = "";
let activeQrPurpose = "feedback";
let subscriptionPlans = [];
let currentSubscription = null;
let subscriptionRequests = [];
let adminSubscriptions = [];
let isPlatformAdmin = false;
let adminRequestsChannel = null;
let subscriptionAccessActive = false;
let subscriptionAccessError = false;
let pendingSignupBusinessType = null;
let currentMembershipRole = null;
let currentUserLimit = null;

function toast(msg) {
  const el = $("#toast"); el.textContent = msg; el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2600);
}
function message(id, msg, error=false) {
  const el=$(id); el.textContent=msg; el.className="message "+(error?"error":"success");
}
function show(view) {
  ["#authView","#orgView","#appView","#passwordRecoveryView"].forEach(s=>$(s).classList.add("hidden"));
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


// MIQYAS v1.18.8: isolate the workspace by the business type selected at signup.
function getBusinessType(){
  const value=currentUser?.user_metadata?.business_type;
  return value==="ecommerce"?"ecommerce":"branches";
}
function applyBusinessTypeView(){
  const type=getBusinessType(), ecommerce=type==="ecommerce";
  const optionMap={dashboard:!ecommerce,branches:!ecommerce,ecommerce,reports:!ecommerce,subscription:true};
  document.querySelectorAll("#serviceSelect option").forEach(option=>{
    option.hidden=optionMap[option.value]===false;
    option.disabled=option.hidden;
  });
  ["#stats","#serviceStatusPanel","#workspaceFeatures"].forEach(sel=>{
    const el=$(sel); if(el) el.classList.toggle("hidden",ecommerce);
  });
  // The app header contains branch-only controls outside the statistics panel.
  const addBranch=$("#addBranchBtn"); if(addBranch) addBranch.classList.toggle("hidden",ecommerce);
  const home=$("#homeButton"); if(home) home.classList.toggle("hidden",ecommerce);
  const headerDescription=document.querySelector("#appView .apphead .muted");
  if(headerDescription) headerDescription.textContent=ecommerce?"إدارة المتجر الإلكتروني وقياس تجربة العملاء":"متابعة مؤشرات الجودة وأداء الفروع";
  const ecommercePage=$("#ecommerceService");
  if(ecommercePage) ecommercePage.classList.add("hidden");
  const title=$("#orgTitle");
  if(title){
    title.dataset.businessType=type;
    title.title=ecommerce?"نوع النشاط: متجر إلكتروني":"نوع النشاط: فروع";
  }
  const select=$("#serviceSelect");
  if(select){ select.value=ecommerce?"ecommerce":"dashboard"; }
}
function setServiceView(name){
  const ecommerce=getBusinessType()==="ecommerce";
  if(ecommerce && !["ecommerce","subscription"].includes(name)) name="ecommerce";
  if(!ecommerce && name==="ecommerce") name="dashboard";
  const map={dashboard:["#stats","#subscriptionGate","#serviceStatusPanel"],branches:["#workspaceFeatures"],ecommerce:["#ecommerceService"],reports:["#workspaceFeatures"],subscription:["#subscriptionPanel"]};
  const all=["#stats","#subscriptionGate","#serviceStatusPanel","#workspaceFeatures","#ecommerceService","#subscriptionPanel"];
  all.forEach(sel=>{const el=$(sel);if(el)el.classList.add("hidden");});
  (map[name]||map.dashboard).forEach(sel=>{const el=$(sel);if(el)el.classList.remove("hidden");});
  if(name==="ecommerce"){loadEcommerceStores();loadEcommerceReports();}
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

// MIQYAS v1.19: ecommerce reporting reads existing tables only; no schema or RLS changes.
let ecommerceReportCache={stores:[],orders:[],invites:[],reviews:[]};
function reportDateOk(value,start,end){
  if(!value)return !start&&!end;
  const d=String(value).slice(0,10);return (!start||d>=start)&&(!end||d<=end);
}
function renderEcommerceBars(targetId,items){
  const el=$(targetId);if(!el)return;
  if(!items.length){el.innerHTML='<p class="muted">لا توجد تقييمات مسجلة حتى الآن</p>';return;}
  el.innerHTML=items.map(x=>{const v=Number(x.value)||0;const pct=Math.max(0,Math.min(100,v/5*100));return `<div class="ecom-bar-row"><span>${escapeHtml(x.label)}</span><div class="ecom-bar-track"><div class="ecom-bar-fill" style="width:${pct}%"></div></div><b>${v.toFixed(1)} / 5</b></div>`;}).join('');
}
function renderEcommerceReports(){
  const start=$("#ecomReportStart")?.value||"",end=$("#ecomReportEnd")?.value||"",storeId=$("#ecomReportStore")?.value||"";
  const pick=a=>a.filter(x=>(!storeId||x.store_id===storeId)&&reportDateOk(x.created_at||x.sent_at,start,end));
  const orders=pick(ecommerceReportCache.orders),invites=pick(ecommerceReportCache.invites),reviews=pick(ecommerceReportCache.reviews);
  const avgKey=k=>reviews.length?reviews.reduce((a,x)=>a+Number(x[k]||0),0)/reviews.length:null;
  const avg=avgKey('overall_rating');
  const set=(id,v)=>{const el=$(id);if(el)el.textContent=v;};
  set('#ecomOrdersKpi',orders.length.toLocaleString('en-US'));set('#ecomInvitesKpi',invites.length.toLocaleString('en-US'));set('#ecomReviewsKpi',reviews.length.toLocaleString('en-US'));
  set('#ecomSatisfactionKpi',avg===null?'—':`${(avg/5*100).toFixed(1)}%`);
  set('#ecomResponseKpi',invites.length?`${(reviews.length/invites.length*100).toFixed(1)}%`:'—');
  set('#ecomReportPeriod',`الفترة: ${start||'البداية'} — ${end||'حتى الآن'}`);
  renderEcommerceBars('#ecomQualityBars',[['جودة المنتج','product_quality'],['التوصيل','delivery_rating'],['التغليف','packaging_rating'],['سهولة الدفع','checkout_rating'],['خدمة العملاء','support_rating']].map(([label,key])=>({label,value:avgKey(key)})).filter(x=>x.value!==null));
  const storeRows=ecommerceReportCache.stores.map(st=>{const rr=reviews.filter(r=>r.store_id===st.id&&reportDateOk(r.created_at,start,end));return {label:st.store_name,value:rr.length?rr.reduce((a,r)=>a+Number(r.overall_rating||0),0)/rr.length:null};}).filter(x=>x.value!==null);
  renderEcommerceBars('#ecomStoreComparison',storeRows);
}
async function loadEcommerceReports(){
  if(!currentOrg)return;const msg=$("#ecomReportMessage");if(msg)msg.textContent='جارٍ تحميل بيانات التقارير...';
  try{
    const [o,i,r,s]=await Promise.all([
      supabase.from('ecommerce_orders').select('id,store_id,order_status,created_at,delivered_at').eq('organization_id',currentOrg.id).order('created_at',{ascending:false}).limit(5000),
      supabase.from('ecommerce_review_invites').select('id,store_id,invite_status,sent_at,created_at').eq('organization_id',currentOrg.id).order('created_at',{ascending:false}).limit(5000),
      supabase.from('ecommerce_reviews').select('id,store_id,product_quality,delivery_rating,packaging_rating,checkout_rating,support_rating,overall_rating,created_at').eq('organization_id',currentOrg.id).order('created_at',{ascending:false}).limit(5000),
      supabase.from('ecommerce_stores').select('id,store_name,platform,connection_status,created_at').eq('organization_id',currentOrg.id).order('created_at',{ascending:false})
    ]);
    const err=[o.error,i.error,r.error,s.error].find(Boolean);if(err)throw err;
    ecommerceReportCache={orders:o.data||[],invites:i.data||[],reviews:r.data||[],stores:s.data||[]};
    const select=$("#ecomReportStore"),prior=select?.value||'';
    if(select){select.innerHTML='<option value="">جميع المتاجر</option>'+ecommerceReportCache.stores.map(x=>`<option value="${escapeHtml(x.id)}">${escapeHtml(x.store_name)}</option>`).join('');if(ecommerceReportCache.stores.some(x=>x.id===prior))select.value=prior;}
    renderEcommerceReports();if(msg)msg.textContent='تم تحديث التقارير من البيانات المسجلة فعلياً. الأرقام صفر عند عدم وجود سجلات.';
  }catch(err){if(msg){msg.textContent=`تعذر تحميل التقارير: ${err.message||'خطأ غير معروف'}`;msg.className='message error';}}
}
function exportEcommerceExcel(){
  if(!window.XLSX){toast('مكتبة Excel غير متاحة حالياً');return;}
  const start=$("#ecomReportStart").value,end=$("#ecomReportEnd").value,storeId=$("#ecomReportStore").value;
  const filter=a=>a.filter(x=>(!storeId||x.store_id===storeId)&&reportDateOk(x.created_at||x.sent_at,start,end));
  const orders=filter(ecommerceReportCache.orders),invites=filter(ecommerceReportCache.invites),reviews=filter(ecommerceReportCache.reviews);
  const storeName=id=>ecommerceReportCache.stores.find(s=>s.id===id)?.store_name||'';
  const wb=XLSX.utils.book_new();
  const add=(name,rows)=>XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),name);
  add('الملخص',[['المؤشر','القيمة'],['إجمالي الطلبات',orders.length],['دعوات التقييم',invites.length],['التقييمات المستلمة',reviews.length],['متوسط الرضا من 5',reviews.length?reviews.reduce((a,x)=>a+Number(x.overall_rating||0),0)/reviews.length:0],['نسبة الاستجابة',invites.length?reviews.length/invites.length:0],['من تاريخ',start||'كل الفترات'],['إلى تاريخ',end||'حتى الآن']]);
  add('تقييمات العملاء',[['المتجر','جودة المنتج','التوصيل','التغليف','سهولة الدفع','خدمة العملاء','الرضا العام','التاريخ'],...reviews.map(x=>[storeName(x.store_id),x.product_quality,x.delivery_rating,x.packaging_rating,x.checkout_rating,x.support_rating,x.overall_rating,x.created_at||''])]);
  add('الطلبات',[['المتجر','رقم داخلي','الحالة','تاريخ الإنشاء','تاريخ التسليم'],...orders.map(x=>[storeName(x.store_id),x.id,x.order_status,x.created_at||'',x.delivered_at||''])]);
  add('دعوات التقييم',[['المتجر','الحالة','تاريخ الإنشاء','تاريخ الإرسال'],...invites.map(x=>[storeName(x.store_id),x.invite_status,x.created_at||'',x.sent_at||''])]);
  XLSX.writeFile(wb,`MIQYAS_Ecommerce_Report_${new Date().toISOString().slice(0,10)}.xlsx`);toast('تم تجهيز تقرير Excel');
}
$("#ecomReportStore")?.addEventListener('change',renderEcommerceReports);$("#ecomReportStart")?.addEventListener('change',renderEcommerceReports);$("#ecomReportEnd")?.addEventListener('change',renderEcommerceReports);
$("#refreshEcommerceReports")?.addEventListener('click',loadEcommerceReports);$("#exportEcommerceExcel")?.addEventListener('click',exportEcommerceExcel);
$("#clearEcomReportFilters")?.addEventListener('click',()=>{$("#ecomReportStore").value='';$("#ecomReportStart").value='';$("#ecomReportEnd").value='';renderEcommerceReports();});
$("#serviceSelect")?.addEventListener("change",e=>setServiceView(e.target.value));
$("#homeButton")?.addEventListener("click",()=>{const s=$("#serviceSelect");if(s){s.value="dashboard";setServiceView("dashboard");}window.scrollTo({top:0,behavior:"smooth"});});
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
  const email=String(cfg.CONTACT_EMAIL||"miqyassupport@gmail.com").trim();
  const whatsapp=String(cfg.WHATSAPP_NUMBER||"966530561303").replace(/[^0-9]/g,"");
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
  const businessTypePanel=$("#signupBusinessType");
  if(businessTypePanel){
    if(authMode==="signup"){
      businessTypePanel.classList.remove("hidden");
      businessTypePanel.style.setProperty("display","block","important");
    }else{
      businessTypePanel.style.setProperty("display","none","important");
      businessTypePanel.classList.add("hidden");
    }
  }
  message("#authMessage","");
}));
$("#forgotPasswordBtn")?.addEventListener("click",async()=>{
 const email=$("#email").value.trim(); if(!email){message("#authMessage","أدخل بريدك الإلكتروني أولاً ثم اضغط نسيت كلمة المرور.",true);$("#email").focus();return;}
 const btn=$("#forgotPasswordBtn");setBusy(btn,true,"جارٍ إرسال الرابط...");
 try{const redirectTo=`${location.origin}${location.pathname}?reset-password=1`;const {error}=await supabase.auth.resetPasswordForEmail(email,{redirectTo});if(error)throw error;message("#authMessage","إذا كان البريد مسجلاً، فسيصلك رابط استعادة كلمة المرور. تحقق من الوارد والرسائل غير المرغوب فيها.");}
 catch(err){message("#authMessage",err.message||"تعذر إرسال رابط الاستعادة.",true);}finally{setBusy(btn,false);}
});
$("#passwordRecoveryForm")?.addEventListener("submit",async e=>{e.preventDefault();const p=$("#newPassword").value,c=$("#confirmNewPassword").value;if(p.length<8){message("#recoveryMessage","كلمة المرور يجب ألا تقل عن 8 أحرف.",true);return;}if(p!==c){message("#recoveryMessage","كلمتا المرور غير متطابقتين.",true);return;}const btn=$("#saveNewPasswordBtn");setBusy(btn,true,"جارٍ الحفظ...");try{const {error}=await supabase.auth.updateUser({password:p});if(error)throw error;message("#recoveryMessage","تم تحديث كلمة المرور بنجاح.");$("#passwordRecoveryForm").classList.add("hidden");setTimeout(()=>{show("#authView");history.replaceState({},document.title,location.pathname);},1800);}catch(err){message("#recoveryMessage",err.message||"تعذر تحديث كلمة المرور. افتح رابط الاستعادة من البريد مرة أخرى.",true);}finally{setBusy(btn,false);}});
supabase.auth.onAuthStateChange((event)=>{if(event==="PASSWORD_RECOVERY")show("#passwordRecoveryView");});
if(new URLSearchParams(location.search).has("reset-password"))show("#passwordRecoveryView");
$("#googleSignInBtn")?.addEventListener("click",async()=>{
  const btn=$("#googleSignInBtn");
  setBusy(btn,true,"جارٍ التحويل إلى Google...");
  try{
    const selectedType=document.querySelector('input[name="businessType"]:checked')?.value||"branches";
    const redirectTo=new URL(location.pathname,location.origin);
    redirectTo.searchParams.set("oauth_business_type",selectedType);
    const {error}=await supabase.auth.signInWithOAuth({
      provider:"google",
      options:{redirectTo:redirectTo.toString(),queryParams:{prompt:"select_account"}}
    });
    if(error)throw error;
  }catch(err){
    message("#authMessage",err.message||"تعذر بدء تسجيل الدخول باستخدام Google.",true);
    setBusy(btn,false);
  }
});
$("#authForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const btn=$("#authSubmit"); setBusy(btn,true);
  const email=$("#email").value.trim(), password=$("#password").value;
  try {
    if(authMode==="signup"){
      const businessType=document.querySelector('input[name="businessType"]:checked')?.value||"branches";
      pendingSignupBusinessType=businessType;
      const {data,error}=await supabase.auth.signUp({email,password,options:{data:{business_type:businessType}}});
      if(error) throw error;
      // Supabase may return a success-shaped response for an existing email
      // when email confirmations are enabled. An empty identities array
      // indicates that the account already exists; do not show a false success.
      if(data.user && Array.isArray(data.user.identities) && data.user.identities.length===0){
        message("#authMessage","هذا البريد الإلكتروني مسجل مسبقاً. يرجى تسجيل الدخول أو استخدام خيار نسيت كلمة المرور.",true);
        return;
      }
      if(!data.session) message("#authMessage","تم إرسال رسالة تأكيد إلى بريدك الإلكتروني إذا كان التسجيل جديداً. تحقق من بريدك، ثم ارجع وسجّل الدخول.");
      else {
        // Re-assert the selected activity on the authenticated profile before creating the workspace.
        const {error:metaError}=await supabase.auth.updateUser({data:{business_type:businessType}});
        if(metaError) throw metaError;
        const {data:refreshed}=await supabase.auth.getUser();
        if(refreshed?.user) data.session.user=refreshed.user;
        message("#authMessage","تم إنشاء الحساب بنجاح."); await handleSession(data.session);
      }
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
  const oauthType=new URLSearchParams(location.search).get("oauth_business_type");
  if(oauthType==="branches"||oauthType==="ecommerce"){
    if(!currentUser?.user_metadata?.business_type) pendingSignupBusinessType=oauthType;
    const cleanUrl=new URL(location.href);cleanUrl.searchParams.delete("oauth_business_type");
    history.replaceState({},document.title,cleanUrl.pathname+cleanUrl.search+cleanUrl.hash);
  }
  if(!currentUser){show("#authView");return;}
  // Fetch the authoritative Supabase user metadata rather than relying on a stale session snapshot.
  try {
    const {data}=await supabase.auth.getUser();
    if(data?.user) currentUser=data.user;
  } catch(e) { console.warn("Could not refresh user profile metadata",e); }
  if(pendingSignupBusinessType && currentUser.user_metadata?.business_type!==pendingSignupBusinessType){
    const {data,error}=await supabase.auth.updateUser({data:{business_type:pendingSignupBusinessType}});
    if(!error && data?.user) currentUser=data.user;
  }
  pendingSignupBusinessType=null;
  // Record a successful sign-in without exposing credentials or tokens.
  try { await supabase.rpc("log_platform_login"); } catch (auditError) { console.warn("Activity audit login event was not recorded", auditError); }
  $("#connection").textContent="متصل";
  $("#connection").classList.add("online");
  $("#signOut").classList.remove("hidden");
  await loadOrganizations();
}
async function loadOrganizations() {
  const {data,error}=await supabase.from("organizations").select("id,name,industry,business_type,created_at").order("created_at",{ascending:true});
  if(error) throw error;
  if(!data?.length){
    const preferredType=currentUser?.user_metadata?.business_type==="ecommerce"?"ecommerce":"branches";
    const orgTypeRadio=document.querySelector(`input[name="orgBusinessType"][value="${preferredType}"]`);
    if(orgTypeRadio) orgTypeRadio.checked=true;
    show("#orgView");return;
  }
  currentOrg=data[0];
  await loadWorkspace();
}
$("#orgForm").addEventListener("submit",async e=>{
  e.preventDefault(); const btn=e.submitter; setBusy(btn,true);
  try {
    const phoneRaw=$("#ownerPhone").value.trim().replace(/[^\d+]/g,"");
    let phoneDigits=phoneRaw.replace(/\D/g,"");
    let phone="";
    if(phoneDigits.startsWith("00966")) phoneDigits=phoneDigits.slice(2);
    if(phoneDigits.startsWith("966")) phone="+"+phoneDigits;
    else if(phoneDigits.startsWith("05") && phoneDigits.length===10) phone="+966"+phoneDigits.slice(1);
    else if(phoneDigits.startsWith("5") && phoneDigits.length===9) phone="+966"+phoneDigits;
    if(!/^\+9665\d{8}$/.test(phone)) throw new Error("أدخل رقم جوال سعودي صحيحاً مثل 05XXXXXXXX أو +9665XXXXXXXX.");
    const selectedBusinessType=document.querySelector('input[name="orgBusinessType"]:checked')?.value||currentUser?.user_metadata?.business_type||"branches";
    const {error:phoneError}=await supabase.auth.updateUser({data:{contact_phone:phone,business_type:selectedBusinessType}});
    if(phoneError) throw phoneError;
    const {data:refreshData,error:refreshError}=await supabase.auth.refreshSession();
    if(refreshError) throw refreshError;
    if(refreshData?.user) currentUser=refreshData.user;
    const {data,error}=await supabase.rpc("create_organization",{org_name:$("#orgName").value.trim(),org_industry:$("#industry").value});
    if(error) throw error;
    const {data:org,error:readError}=await supabase.from("organizations").select("id,name,industry,business_type").eq("id",data).single();
    if(readError) throw readError;
    currentOrg=org; await loadWorkspace(); toast("تم إنشاء مساحة المنشأة");
  } catch(err){
    const raw=String(err?.message||"");
    const friendly=raw.includes("لديه منشأة مسجلة بالفعل")
      ? "هذا البريد الإلكتروني مرتبط بمنشأة مسجلة بالفعل. يرجى تسجيل الدخول إلى حسابك الحالي. لإنشاء منشأة إضافية، يرجى التواصل مع مدير المنصة."
      : (raw||"تعذر إنشاء المنشأة.");
    message("#orgMessage",friendly,true);
  }
  finally{setBusy(btn,false);}
});
$("#adminFreeGrantForm")?.addEventListener("submit",async e=>{
  e.preventDefault();
  if(!isPlatformAdmin){message("#adminGrantMessage","هذه الصلاحية لمدير المنصة فقط.",true);return;}
  const btn=e.submitter;setBusy(btn,true);
  try{
    const {data,error}=await supabase.rpc("platform_grant_free_subscription",{
      p_organization_id:$("#adminGrantOrg").value,
      p_plan_code:$("#adminGrantPlan").value,
      p_duration_days:Number($("#adminGrantDays").value),
      p_reason:$("#adminGrantReason").value.trim()||null
    });
    if(error)throw error;
    message("#adminGrantMessage","تم منح الاشتراك المجاني بنجاح. رقم الاشتراك: "+data,false);
    await loadAdminSubscriptions();await loadAdminSubscriptionAudit();
  }catch(err){message("#adminGrantMessage",err.message||"تعذر منح الاشتراك.",true);}
  finally{setBusy(btn,false);}
});

async function loadOwnerMembers(){
  const panel=$("#ownerMembersPanel"); if(!panel||!currentOrg||!currentUser) return;
  try{
    const {data:membership,error:membershipError}=await supabase.from("organization_members").select("role").eq("organization_id",currentOrg.id).eq("user_id",currentUser.id).maybeSingle();
    if(membershipError) throw membershipError;
    currentMembershipRole=membership?.role||null;
    if(currentMembershipRole!=="owner"){panel.classList.add("hidden");return;}
    panel.classList.remove("hidden");
    const [membersRes,planRes]=await Promise.all([
      supabase.from("organization_members").select("user_id,role,created_at").eq("organization_id",currentOrg.id).order("created_at",{ascending:true}),
      supabase.from("subscription_plans").select("max_users").eq("code",currentSubscription?.plan_code|| (getBusinessType()==="ecommerce"?"ecom_basic":"basic")).maybeSingle()
    ]);
    if(membersRes.error) throw membersRes.error;
    if(planRes.error) throw planRes.error;
    const members=membersRes.data||[]; currentUserLimit=Number(planRes.data?.max_users||3);
    $("#ownerMemberUsage").textContent=`${members.length} من ${currentUserLimit} مستخدمين`;
    $("#ownerInviteSubmit").disabled=members.length>=currentUserLimit;
    $("#ownerMemberRows").innerHTML=members.map(m=>`<tr><td>${m.user_id===currentUser.id?"أنت (مالك المنشأة)":"مستخدم المنشأة"}</td><td>${escapeHtml(String(m.user_id||"").slice(0,8))}…</td><td>${({owner:"مالك المنشأة",manager:"مدير",supervisor:"مشرف",user:"مستخدم"}[m.role]||escapeHtml(m.role))}</td><td>${adminDate(m.created_at)}</td></tr>`).join("")||'<tr><td colspan="4">لا يوجد مستخدمون</td></tr>';
  }catch(err){panel.classList.add("hidden");console.warn("Owner members panel:",err);}
}
$("#ownerInviteForm")?.addEventListener("submit",async e=>{
  e.preventDefault(); const btn=$("#ownerInviteSubmit");
  if(currentMembershipRole!=="owner"){message("#ownerInviteMessage","إضافة المستخدمين متاحة لمالك المنشأة فقط.",true);return;}
  setBusy(btn,true,"جارٍ إرسال الدعوة…");
  try{
    const {data:{session}}=await supabase.auth.getSession();
    if(!session?.access_token) throw new Error("انتهت جلسة الدخول. سجل الدخول مجدداً.");
    const response=await fetch(`${cfg.SUPABASE_URL}/functions/v1/owner-manage-members`,{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${session.access_token}`,"apikey":cfg.SUPABASE_PUBLISHABLE_KEY},body:JSON.stringify({organization_id:currentOrg.id,email:$("#ownerInviteEmail").value.trim(),full_name:$("#ownerInviteName").value.trim(),role:$("#ownerInviteRole").value})});
    const result=await response.json().catch(()=>({}));
    if(!response.ok) throw new Error(result.error||"تعذر إرسال الدعوة.");
    message("#ownerInviteMessage","تم إرسال دعوة المستخدم إلى البريد الإلكتروني.",false);
    $("#ownerInviteForm").reset(); await loadOwnerMembers();
  }catch(err){message("#ownerInviteMessage",err.message||"تعذر إرسال الدعوة.",true);}
  finally{setBusy(btn,false);}
});

async function loadWorkspace() {
  $("#orgTitle").textContent=currentOrg.name;
  show("#appView");
  await loadSubscriptionData();
  await loadOwnerMembers();
  applySubscriptionGate();
  if(subscriptionAccessActive){
    await refreshData();
  }else{
    branches=[]; assessments=[]; customerFeedback=[];
    render();
  }
  const serviceSelect=$("#serviceSelect");
  applyBusinessTypeView();
  if(serviceSelect){const initialView=getBusinessType()==="ecommerce"?"ecommerce":"dashboard";serviceSelect.value=initialView;setServiceView(initialView);}
}
async function refreshData() {
  const [b,e,f,g]=await Promise.all([
    supabase.from("branches").select("id,name,city,area,google_maps_url,public_token,created_at").eq("organization_id",currentOrg.id).order("created_at",{ascending:false}),
    supabase.from("quality_assessments").select("id,branch_id,assessment_type,positive_count,neutral_count,negative_count,score,notes,created_at").eq("organization_id",currentOrg.id).order("created_at",{ascending:false}).limit(100),
    supabase.from("customer_feedback").select("id,branch_id,rating,comment,created_at").eq("organization_id",currentOrg.id).order("created_at",{ascending:false}).limit(500),
    supabase.from("google_maps_review_snapshots").select("id,branch_id,place_id,place_name,rating,user_rating_count,reviews,fetched_at").eq("organization_id",currentOrg.id).order("fetched_at",{ascending:false}).limit(100)
  ]);
  if(b.error) throw b.error;
  if(e.error) throw e.error;
  if(f.error) throw f.error;
  branches=b.data||[]; assessments=e.data||[]; customerFeedback=f.data||[];
  googleMapsSnapshots=g.error?[]:(g.data||[]);
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
      supabase.from("subscription_plans").select("code,name,price_sar,billing_period_months,branch_limit,max_users,features,business_type").eq("is_active",true).order("price_sar"),
      supabase.from("organization_subscriptions").select("id,plan_code,status,starts_at,ends_at,payment_method").eq("organization_id",currentOrg.id).order("created_at",{ascending:false}).limit(1),
      supabase.from("subscription_payment_requests").select("id,plan_code,amount_sar,payment_method,status,transfer_reference,created_at").eq("organization_id",currentOrg.id).order("created_at",{ascending:false}).limit(20),
      supabase.rpc("is_platform_admin")
    ]);
    if(plansRes.error) throw plansRes.error;
    if(subRes.error) throw subRes.error;
    if(reqRes.error) throw reqRes.error;
    if(adminRes.error) throw adminRes.error;
    subscriptionPlans=(plansRes.data||[]).filter(p=>(p.business_type||"branches")===(currentOrg.business_type||getBusinessType()));
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
      await loadActivityAudit();
      await loadPlatformInsights();
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
  if(!currentSubscription||!["active","trial"].includes(currentSubscription.status)) return false;
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
  $("#subscriptionStatus").textContent=active?(currentSubscription.status==="trial"?"فترة تجريبية":"اشتراك نشط"):"لا يوجد اشتراك نشط";
  $("#subscriptionStatus").classList.toggle("active",!!active);
  $("#currentPlanName").textContent=active?`باقة ${planLabels[currentSubscription.plan_code]||currentSubscription.plan_code}`:"لا يوجد اشتراك نشط";
  $("#currentPlanDates").textContent=active?`بدأ في ${new Date(currentSubscription.starts_at).toLocaleDateString("ar-SA-u-ca-gregory")}`:"اختر الباقة المناسبة للبدء";
  $("#subscriptionExpiry").textContent=active&&currentSubscription.ends_at?`ينتهي ${new Date(currentSubscription.ends_at).toLocaleDateString("ar-SA-u-ca-gregory")}`:"—";

  $("#subscriptionPlans").innerHTML=subscriptionPlans.map(p=>`<article class="plan-card ${p.code==="professional"?"featured":""}" data-plan-card="${escapeHtml(p.code)}"><h3>${escapeHtml(p.name)}</h3><strong>${Number(p.price_sar)>0?`${Number(p.price_sar).toLocaleString("ar-SA-u-ca-gregory")} ر.س <small>/ شهرياً</small>`:"حسب الاتفاق"}</strong><p>حتى ${Number(p.branch_limit||0)} ${p.business_type==="ecommerce"?(Number(p.branch_limit)===1?"متجر":"متاجر"):(Number(p.branch_limit)===1?"فرع":"فروع")} · ${Number(p.max_users||0)} مستخدمين</p><small>${escapeHtml(Array.isArray(p.features)?p.features.join(" • "):"")}</small><button type="button" class="outline plan-select-btn" data-select-plan="${escapeHtml(p.code)}">اختيار هذه الباقة</button></article>`).join("");
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
  $("#subscriptionRequestRows").innerHTML=subscriptionRequests.length?subscriptionRequests.map(r=>`<tr><td>${new Date(r.created_at).toLocaleDateString("ar-SA-u-ca-gregory")}</td><td>${planLabels[r.plan_code]||escapeHtml(r.plan_code)}</td><td>${Number(r.amount_sar).toLocaleString("ar-SA-u-ca-gregory")} ر.س</td><td>${r.payment_method==="bank_transfer"?"تحويل بنكي":"إلكتروني"}</td><td>${requestStatusLabels[r.status]||escapeHtml(r.status)}</td></tr>`).join(""):'<tr><td colspan="5" class="muted">لا توجد طلبات بعد</td></tr>';
  $("#platformAdminPanel").classList.toggle("hidden",!isPlatformAdmin);
}
$("#subscriptionRequestForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const submitButton=$("#submitSubscriptionRequest");
  const planCode=$("#subscriptionPlan")?.value;
  if(!currentUser || !currentOrg?.id){
    message("#subscriptionMessage","يرجى تسجيل الدخول واختيار المنشأة قبل متابعة الدفع.",true);
    return;
  }
  if(!planCode || !subscriptionPlans.some(p=>p.code===planCode)){
    message("#subscriptionMessage","يرجى اختيار باقة صحيحة.",true);
    return;
  }
  const originalText=submitButton?.textContent||"المتابعة إلى الدفع الإلكتروني";
  if(submitButton){submitButton.disabled=true;submitButton.textContent="جارٍ تجهيز فاتورة الدفع...";}
  message("#subscriptionMessage","جارٍ تحويلك إلى بوابة ميسر الآمنة لإتمام الدفع.",false);
  try{
    const {data,error}=await supabase.functions.invoke("miqyas-moyasar",{
      body:{
        action:"create_invoice",
        organization_id:currentOrg.id,
        plan_code:planCode
      }
    });
    if(error) throw error;
    if(!data?.checkout_url) throw new Error(data?.error||data?.message||"لم يتم استلام رابط الدفع من بوابة ميسر.");
    window.location.assign(data.checkout_url);
  }catch(err){
    console.error("MIQYAS Moyasar checkout error:",err);
    message("#subscriptionMessage",err?.message||"تعذر إنشاء فاتورة الدفع. حاول مرة أخرى أو تواصل مع إدارة مقياس.",true);
    if(submitButton){submitButton.disabled=false;submitButton.textContent=originalText;}
  }
});
$("#refreshSubscriptionRequests").addEventListener("click",async()=>{await loadAdminSubscriptionRequests();toast("تم تحديث الطلبات");});
async function loadAdminSubscriptionRequests(){
  if(!isPlatformAdmin)return;
  const {data,error}=await supabase.from("subscription_payment_requests").select("id,organization_id,plan_code,amount_sar,payment_method,status,created_at,organizations(name)").eq("status","pending").order("created_at",{ascending:true});
  if(error){$("#adminSubscriptionRows").innerHTML=`<tr><td colspan="5">${escapeHtml(error.message)}</td></tr>`;return;}
  $("#adminSubscriptionRows").innerHTML=(data||[]).length?data.map(r=>`<tr><td>${escapeHtml(r.organizations?.name||"منشأة")}</td><td>${planLabels[r.plan_code]||r.plan_code}</td><td>${Number(r.amount_sar).toLocaleString("ar-SA-u-ca-gregory")} ر.س</td><td>${escapeHtml(requestStatusLabels[r.status]||r.status)}</td><td><button class="primary" data-approve-sub="${r.id}">اعتماد</button> <button class="outline" data-reject-sub="${r.id}">رفض</button></td></tr>`).join(""):'<tr><td colspan="5">لا توجد طلبات معلقة</td></tr>';
}
function startAdminRequestNotifications(){
  if(!isPlatformAdmin || adminRequestsChannel) return;
  adminRequestsChannel=supabase.channel("miqyas-admin-subscription-requests")
    .on("postgres_changes",{event:"INSERT",schema:"public",table:"subscription_payment_requests"},payload=>{
      const request=payload.new||{};
      if(!request.id) return;
      const plan=planLabels[request.plan_code]||"باقة جديدة";
      const amount=Number(request.amount_sar||0).toLocaleString("ar-SA-u-ca-gregory");
      const notice=`وصل طلب اشتراك جديد: ${plan} بقيمة ${amount} ريال.`;
      toast(notice);
      if("Notification" in window && Notification.permission==="granted"){
        try{if("serviceWorker" in navigator){navigator.serviceWorker.ready.then(reg=>reg.showNotification("طلب اشتراك جديد في مقياس",{body:notice,icon:"./icon.svg",badge:"./icon.svg",tag:`miqyas-sub-${request.id}`,data:{url:"./"}})).catch(()=>{});}else new Notification("طلب اشتراك جديد في مقياس",{body:notice,icon:"./icon.svg",tag:`miqyas-sub-${request.id}`});}catch(e){}
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
  const d=new Date(value); return Number.isNaN(d.getTime())?"—":d.toLocaleDateString("ar-SA-u-ca-gregory");
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
  const {data,error}=await supabase.from("organizations").select("id,name,industry,business_type,created_at").order("created_at",{ascending:false});
  if(error){body.innerHTML=`<tr><td colspan="5">${escapeHtml(error.message)}</td></tr>`;return;}
  const rows=data||[];
  const grantOrg=$("#adminGrantOrg");
  if(grantOrg) grantOrg.innerHTML='<option value="">اختر المنشأة</option>'+rows.map(o=>`<option value="${o.id}" data-type="${o.business_type||"branches"}">${escapeHtml(o.name||"منشأة")}</option>`).join("");
  const grantPlan=$("#adminGrantPlan");
  if(grantPlan){
    const {data:allGrantPlans,error:grantPlansError}=await supabase.from("subscription_plans").select("code,name,price_sar,business_type").eq("is_active",true).order("price_sar");
    if(grantPlansError){grantPlan.innerHTML='<option value="">تعذر تحميل الباقات</option>';}
    else grantPlan.dataset.allPlans=JSON.stringify(allGrantPlans||[]);
    grantPlan.innerHTML='<option value="">اختر المنشأة أولاً</option>';
  }
  if(grantOrg&&!grantOrg.dataset.bound){
    grantOrg.dataset.bound="1";
    grantOrg.addEventListener("change",()=>{
      const type=grantOrg.selectedOptions[0]?.dataset.type||"branches";
      const allPlans=JSON.parse(grantPlan?.dataset.allPlans||"[]");
      const opts=allPlans.filter(p=>(p.business_type||"branches")===type);
      if(grantPlan) grantPlan.innerHTML='<option value="">اختر الباقة</option>'+opts.map(p=>`<option value="${escapeHtml(p.code)}">${escapeHtml(p.name)} – ${Number(p.price_sar)} ريال</option>`).join("");
    });
  }
  body.innerHTML=rows.length?rows.map(o=>`<tr>
    <td>${escapeHtml(o.name||"—")}</td><td>${escapeHtml(o.industry||"—")}</td>
    <td>${adminDate(o.created_at)}</td><td>${o.id===currentOrg?.id?"المنشأة الحالية":"—"}</td>
    <td><button type="button" class="danger" data-delete-organization="${o.id}" data-org-name="${escapeHtml(o.name||"")}">حذف نهائي</button></td>
  </tr>`).join(""):'<tr><td colspan="5">لا توجد منشآت مسجلة</td></tr>';
}
async function loadActivityAudit(){
  if(!isPlatformAdmin)return;
  const body=$("#activityAuditRows");
  if(!body)return;
  body.innerHTML='<tr><td colspan="6">جارٍ تحميل سجل الحركة...</td></tr>';
  const {data,error}=await supabase.from("platform_activity_audit")
    .select("created_at,actor_email,organization_name,action,table_name,record_id,details")
    .order("created_at",{ascending:false}).limit(200);
  if(error){body.innerHTML=`<tr><td colspan="6">${escapeHtml(error.message)} — تأكد من تنفيذ ملف MIQYAS_ACTIVITY_AUDIT.sql</td></tr>`;return;}
  const labels={INSERT:"إضافة",UPDATE:"تعديل",DELETE:"حذف",LOGIN:"تسجيل دخول"};
  body.innerHTML=(data||[]).length?data.map(a=>{
    const details=a.details?JSON.stringify(a.details):"—";
    return `<tr><td>${adminDate(a.created_at)}</td><td>${escapeHtml(a.actor_email||"غير معروف")}</td><td>${escapeHtml(a.organization_name||"—")}</td><td>${labels[a.action]||escapeHtml(a.action)}</td><td>${escapeHtml(a.table_name||"—")}</td><td>${escapeHtml(details.slice(0,500))}</td></tr>`;
  }).join(""):'<tr><td colspan="6">لا توجد عمليات مسجلة بعد تفعيل السجل</td></tr>';
}
$("#refreshActivityAudit")?.addEventListener("click",loadActivityAudit);

async function loadAdminSubscriptionAudit(){
  if(!isPlatformAdmin)return;
  const body=$("#adminSubscriptionAuditRows");
  if(!body)return;
  body.innerHTML='<tr><td colspan="5">جارٍ تحميل عمليات الاشتراكات...</td></tr>';
  const [requestsRes,subscriptionsRes]=await Promise.all([
    supabase.from("subscription_payment_requests")
      .select("id,organization_id,user_id,plan_code,amount_sar,payment_method,status,transfer_reference,gateway_checkout_id,reviewed_by,reviewed_at,created_at,organizations(name)")
      .order("created_at",{ascending:false}).limit(100),
    supabase.from("organization_subscriptions")
      .select("id,organization_id,plan_code,status,starts_at,ends_at,payment_method,created_at,organizations(name)")
      .order("created_at",{ascending:false}).limit(100)
  ]);
  if(requestsRes.error || subscriptionsRes.error){
    const err=requestsRes.error||subscriptionsRes.error;
    body.innerHTML=`<tr><td colspan="5">${escapeHtml(err.message||"تعذر تحميل سجل الاشتراكات")}</td></tr>`;
    return;
  }
  const paymentLabels={bank_transfer:"تحويل بنكي",online:"دفع إلكتروني",cash:"نقدي"};
  const statusLabels={pending:"بانتظار المراجعة",awaiting_gateway:"بانتظار الدفع",paid:"مدفوع",approved:"معتمد",rejected:"مرفوض",cancelled:"ملغي",failed:"فشل الدفع",active:"نشط",paused:"موقوف مؤقتاً",expired:"منتهي",past_due:"متأخر السداد",trial:"تجريبي"};
  const planName=code=>planLabels[code]||code||"—";
  const requestRows=(requestsRes.data||[]).map(r=>{
    const details=[
      `الباقة: ${planName(r.plan_code)}`,
      `المبلغ: ${Number(r.amount_sar||0).toLocaleString("ar-SA-u-ca-gregory")} ر.س`,
      `الدفع: ${paymentLabels[r.payment_method]||r.payment_method||"—"}`,
      `الحالة: ${statusLabels[r.status]||r.status||"—"}`,
      r.transfer_reference?`مرجع التحويل: ${r.transfer_reference}`:"",
      r.gateway_checkout_id?`رقم العملية: ${r.gateway_checkout_id}`:""
    ].filter(Boolean).join(" — ");
    return {created_at:r.created_at,organization_name:r.organizations?.name||"—",
      action:"طلب اشتراك",details,actor:r.reviewed_by?"مراجع الطلب":r.user_id?"مقدم الطلب":"—"};
  });
  const subscriptionRows=(subscriptionsRes.data||[]).map(s=>{
    const details=[
      `الباقة: ${planName(s.plan_code)}`,
      `الحالة: ${statusLabels[s.status]||s.status||"—"}`,
      `طريقة الدفع: ${paymentLabels[s.payment_method]||s.payment_method||"—"}`,
      s.starts_at?`البداية: ${adminDate(s.starts_at)}`:"",
      s.ends_at?`الانتهاء: ${adminDate(s.ends_at)}`:""
    ].filter(Boolean).join(" — ");
    return {created_at:s.created_at,organization_name:s.organizations?.name||"—",
      action:"تسجيل اشتراك",details,actor:"النظام"};
  });
  const rows=[...requestRows,...subscriptionRows].sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0)).slice(0,100);
  body.innerHTML=rows.length?rows.map(r=>`<tr>
    <td>${adminDate(r.created_at)}</td>
    <td>${escapeHtml(r.organization_name)}</td>
    <td>${escapeHtml(r.action)}</td>
    <td>${escapeHtml(r.details)}</td>
    <td>${escapeHtml(r.actor)}</td>
  </tr>`).join(""):'<tr><td colspan="5">لا توجد عمليات اشتراك مسجلة بعد</td></tr>';
}

function adminDateRangeQuery(query, column="created_at"){
  const start=$("#adminExportStart")?.value;
  const end=$("#adminExportEnd")?.value;
  if(start) query=query.gte(column,`${start}T00:00:00`);
  if(end) query=query.lte(column,`${end}T23:59:59.999`);
  return query;
}
function exportAdminRows(rows, sheetName, fileName){
  if(!window.XLSX){message("#adminExportMessage","تعذر تحميل مكتبة Excel. حدّث الصفحة وحاول مجدداً.",true);return;}
  const ws=XLSX.utils.json_to_sheet(rows.length?rows:[{ملاحظة:"لا توجد بيانات ضمن الفترة المحددة"}]);
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,sheetName.slice(0,31));
  XLSX.writeFile(wb,fileName);
  message("#adminExportMessage",`تم تجهيز ملف ${fileName}`,false);
}
function adminRangeFileSuffix(){
  const start=$("#adminExportStart")?.value||"";
  const end=$("#adminExportEnd")?.value||"";
  if(start&&end&&start>end)throw new Error("تاريخ البداية يجب أن يسبق تاريخ النهاية.");
  return `${start||"من_البداية"}_${end||"حتى_الآن"}`;
}
async function exportAdminSubscribers(){
  if(!isPlatformAdmin)return;
  try{adminRangeFileSuffix();}catch(e){message("#adminExportMessage",e.message,true);return;}
  message("#adminExportMessage","جارٍ تجهيز تقرير المشتركين...",false);
  let q=supabase.from("organization_subscriptions")
    .select("organization_id,plan_code,status,starts_at,ends_at,payment_method,created_at,organizations(name,business_type),subscription_plans(name,price_sar,max_users,branch_limit)")
    .order("created_at",{ascending:false});
  q=adminDateRangeQuery(q);
  const {data,error}=await q;
  if(error){message("#adminExportMessage",error.message,true);return;}
  const rows=(data||[]).map(x=>({
    "المنشأة":x.organizations?.name||"",
    "نوع النشاط":x.organizations?.business_type==="ecommerce"?"متجر إلكتروني":"فروع",
    "الباقة":x.subscription_plans?.name||x.plan_code,
    "السعر الشهري":x.subscription_plans?.price_sar??"",
    "حد الفروع/المتاجر":x.subscription_plans?.branch_limit??"",
    "حد المستخدمين":x.subscription_plans?.max_users??"",
    "الحالة":subscriptionStatusLabels[x.status]||x.status,
    "تاريخ البداية":adminDate(x.starts_at),
    "تاريخ النهاية":adminDate(x.ends_at),
    "طريقة الدفع":x.payment_method||"",
    "تاريخ التسجيل":adminDate(x.created_at)
  }));
  exportAdminRows(rows,"المشتركون",`MIQYAS_Subscribers_${adminRangeFileSuffix()}.xlsx`);
}
async function exportAdminSubscriptionOps(){
  if(!isPlatformAdmin)return;
  try{adminRangeFileSuffix();}catch(e){message("#adminExportMessage",e.message,true);return;}
  message("#adminExportMessage","جارٍ تجهيز سجل عمليات الاشتراكات...",false);
  let q1=supabase.from("subscription_payment_requests")
    .select("created_at,organization_id,plan_code,amount_sar,payment_method,status,gateway_checkout_id,transfer_reference,reviewed_at,reviewed_by,organizations(name)")
    .order("created_at",{ascending:false});
  let q2=supabase.from("organization_subscriptions")
    .select("created_at,organization_id,plan_code,status,starts_at,ends_at,payment_method,organizations(name)")
    .order("created_at",{ascending:false});
  q1=adminDateRangeQuery(q1);q2=adminDateRangeQuery(q2);
  const [a,b]=await Promise.all([q1,q2]);
  if(a.error||b.error){message("#adminExportMessage",(a.error||b.error).message,true);return;}
  const rows=[
    ...(a.data||[]).map(x=>({"التاريخ":adminDate(x.created_at),"المنشأة":x.organizations?.name||"","نوع العملية":"طلب دفع/اشتراك","الباقة":planLabels[x.plan_code]||x.plan_code,"المبلغ":Number(x.amount_sar||0),"الحالة":requestStatusLabels[x.status]||x.status,"طريقة الدفع":x.payment_method||"","رقم العملية":x.gateway_checkout_id||x.transfer_reference||"","تاريخ المراجعة":adminDate(x.reviewed_at)})),
    ...(b.data||[]).map(x=>({"التاريخ":adminDate(x.created_at),"المنشأة":x.organizations?.name||"","نوع العملية":"تسجيل اشتراك","الباقة":planLabels[x.plan_code]||x.plan_code,"المبلغ":"","الحالة":subscriptionStatusLabels[x.status]||x.status,"طريقة الدفع":x.payment_method||"","رقم العملية":"","تاريخ المراجعة":""}))
  ].sort((x,y)=>String(y["التاريخ"]).localeCompare(String(x["التاريخ"])));
  exportAdminRows(rows,"عمليات الاشتراكات",`MIQYAS_Subscription_Operations_${adminRangeFileSuffix()}.xlsx`);
}
async function exportAdminUserActivity(){
  if(!isPlatformAdmin)return;
  try{adminRangeFileSuffix();}catch(e){message("#adminExportMessage",e.message,true);return;}
  message("#adminExportMessage","جارٍ تجهيز سجل حركة المستخدمين...",false);
  let q=supabase.from("platform_activity_audit")
    .select("created_at,actor_email,organization_name,action,table_name,record_id,details")
    .order("created_at",{ascending:false});
  q=adminDateRangeQuery(q);
  const {data,error}=await q;
  if(error){message("#adminExportMessage",`${error.message} — تحقق من تنفيذ MIQYAS_ACTIVITY_AUDIT.sql`,true);return;}
  const labels={INSERT:"إضافة",UPDATE:"تعديل",DELETE:"حذف",LOGIN:"تسجيل دخول"};
  const rows=(data||[]).map(x=>({
    "التاريخ والوقت":x.created_at?new Date(x.created_at).toLocaleString("ar-SA-u-ca-gregory"):"",
    "المستخدم":x.actor_email||"غير معروف",
    "المنشأة":x.organization_name||"",
    "العملية":labels[x.action]||x.action,
    "الجدول":x.table_name||"",
    "رقم السجل":x.record_id||"",
    "التفاصيل":x.details?JSON.stringify(x.details):""
  }));
  exportAdminRows(rows,"حركة المستخدمين",`MIQYAS_User_Activity_${adminRangeFileSuffix()}.xlsx`);
}
async function loadPlatformInsights(){
  if(!isPlatformAdmin)return;
  const set=(id,value)=>{const el=$("#"+id);if(el)el.textContent=value;};
  const body=$("#platformBranchMonitoringRows");
  if(body)body.innerHTML='<tr><td colspan="8">جارٍ تحميل بيانات الفروع والتقييمات...</td></tr>';
  const [orgs,subs,payments,branches,feedback]=await Promise.all([
    supabase.from("organizations").select("id,name,business_type"),
    supabase.from("organization_subscriptions").select("id,status"),
    supabase.from("subscription_payment_requests").select("amount_sar,status"),
    supabase.from("branches").select("id,organization_id,name,city"),
    supabase.from("customer_feedback").select("branch_id,rating,created_at")
  ]);
  const err=[orgs,subs,payments,branches,feedback].find(x=>x.error);
  if(err){if(body)body.innerHTML=`<tr><td colspan="8">${escapeHtml(err.error.message)}</td></tr>`;return;}
  const orgRows=orgs.data||[], subRows=subs.data||[], payRows=payments.data||[], branchRows=branches.data||[], fbRows=feedback.data||[];
  set("platformOrgCount",orgRows.length.toLocaleString("ar-SA-u-ca-gregory"));
  set("platformActiveCount",subRows.filter(x=>x.status==="active").length.toLocaleString("ar-SA-u-ca-gregory"));
  set("platformTrialCount",subRows.filter(x=>x.status==="trial").length.toLocaleString("ar-SA-u-ca-gregory"));
  const collected=payRows.filter(x=>["paid","approved"].includes(x.status)).reduce((n,x)=>n+Number(x.amount_sar||0),0);
  set("platformRevenue",`${collected.toLocaleString("ar-SA-u-ca-gregory")} ريال`);
  set("platformBranchCount",branchRows.length.toLocaleString("ar-SA-u-ca-gregory"));
  set("platformFeedbackCount",fbRows.length.toLocaleString("ar-SA-u-ca-gregory"));
  const orgMap=new Map(orgRows.map(x=>[x.id,x.name||"منشأة"]));
  const rows=branchRows.map(b=>{
    const fs=fbRows.filter(f=>f.branch_id===b.id);
    return `<tr><td>${escapeHtml(orgMap.get(b.organization_id)||"—")}</td><td>${escapeHtml(b.name||"—")}</td><td>${escapeHtml(b.city||"—")}</td><td>${fs.length}</td><td>${fs.filter(x=>x.rating==="positive").length}</td><td>${fs.filter(x=>x.rating==="neutral").length}</td><td>${fs.filter(x=>x.rating==="negative").length}</td><td>${fs.length?adminDate(fs.reduce((a,x)=>new Date(x.created_at)>new Date(a.created_at)?x:a).created_at):"—"}</td></tr>`;
  });
  if(body)body.innerHTML=rows.length?rows.join(""):'<tr><td colspan="8">لا توجد فروع مسجلة</td></tr>';
}
$("#exportSubscribersExcel")?.addEventListener("click",exportAdminSubscribers);
$("#exportSubscriptionOpsExcel")?.addEventListener("click",exportAdminSubscriptionOps);
$("#exportUserActivityExcel")?.addEventListener("click",exportAdminUserActivity);
$("#refreshPlatformInsights")?.addEventListener("click",loadPlatformInsights);

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
    return `<div class="branchitem"><div><b>${escapeHtml(b.name)}</b><small>${escapeHtml([b.area,b.city].filter(Boolean).join(" · ")||"لم تحدد المنطقة")}</small></div><div class="branch-tools"><span class="count">${count} صوت عميل</span>${validGoogleMapsUrl(b.google_maps_url)&&b.google_maps_url?`<a class="maps-link" href="${escapeHtml(b.google_maps_url)}" target="_blank" rel="noopener noreferrer">فتح موقع الفرع على Google Maps ↗</a><button class="outline" data-mapqr="${escapeHtml(b.id)}">QR موقع Google Maps</button><button class="outline" data-google-reviews="${escapeHtml(b.id)}">تحديث تقييمات Google Maps</button>`:""}<button class="outline" data-qr="${escapeHtml(b.id)}">QR التقييم</button><button class="danger" type="button" data-delete-branch="${escapeHtml(b.id)}">حذف الفرع</button></div></div>`;
  }).join(""):"لا توجد فروع مطابقة للتصفية";
  const latestGoogleSnapshots=new Map();
  googleMapsSnapshots.forEach(s=>{if(!latestGoogleSnapshots.has(s.branch_id))latestGoogleSnapshots.set(s.branch_id,s);});
  $("#googleMapsReports").innerHTML=branches.filter(b=>b.google_maps_url).map(b=>{
    const s=latestGoogleSnapshots.get(b.id);
    const reviews=Array.isArray(s?.reviews)?s.reviews:[];
    const rating=Number(s?.rating||0);
    const stars=Array.from({length:5},(_,i)=>`<span class="${i<Math.round(rating)?"is-filled":""}">★</span>`).join("");
    const count=Number(s?.user_rating_count||0);
    const updated=s?.fetched_at?new Date(s.fetched_at).toLocaleString("ar-SA-u-ca-gregory"):"لم يتم السحب بعد";
    return `<article class="gm-card">
      <div class="gm-card-head"><div><span class="gm-eyebrow">GOOGLE MAPS · MIQYAS</span><h3>${escapeHtml(b.name)}</h3><small>${escapeHtml([b.city,b.area].filter(Boolean).join(" · "))}</small></div><span class="gm-pin">📍</span></div>
      ${s?`<div class="gm-score-row"><div class="gm-score">${rating.toFixed(1)}<small>/ 5</small></div><div class="gm-score-meta"><div class="gm-stars" aria-label="التقييم ${rating} من 5">${stars}</div><b>${count.toLocaleString("ar-SA-u-ca-gregory")} تقييماً</b><small>آخر تحديث: ${escapeHtml(updated)}</small></div></div>
      <div class="gm-progress"><span style="width:${Math.max(0,Math.min(100,rating/5*100))}%"></span></div>
      <div class="gm-review-summary"><span>💬 ${reviews.length} تعليقات متاحة</span><span class="gm-live">● تم جلب البيانات</span></div>
      <details class="gm-reviews"><summary>عرض التعليقات والتفاصيل</summary>${reviews.length?reviews.map(r=>`<div class="review-item"><div class="gm-review-head"><b>${"★".repeat(Math.max(0,Math.min(5,Number(r.rating)||0)))}</b><span>${escapeHtml(r.author_name||"مستخدم Google")}</span></div><small>${escapeHtml(r.relative_time_description||"")}</small><p>${escapeHtml(r.text||"لا يوجد نص للتعليق")}</p></div>`).join(""):`<p class="gm-no-reviews">لا توجد تعليقات متاحة في هذه اللقطة.</p>`}</details>`:`<div class="gm-empty">لم يتم سحب بيانات التقييم لهذا الفرع بعد.</div>`}
      <div class="gm-card-actions"><a class="maps-link" href="${escapeHtml(b.google_maps_url)}" target="_blank" rel="noopener noreferrer">فتح الموقع ↗</a><button class="outline" data-google-export="${escapeHtml(b.id)}" ${s?"":"disabled"}>تصدير Excel</button></div>
    </article>`;
  }).join("")||"لا توجد فروع مرتبطة بروابط Google Maps.";
  $("#evalBranch").innerHTML=branches.map(b=>`<option value="${escapeHtml(b.id)}">${escapeHtml(b.name)}</option>`).join("");
  $("#saveEval").disabled=!branches.length;

  const qualityRows=filteredAssessments.map(x=>{
    const b=branches.find(z=>z.id===x.branch_id);
    const types={voc:"صوت العميل (يدوي)",mystery_shopper:"سجل تاريخي غير متاح",internal:"تقييم داخلي"};
    return {created_at:x.created_at,html:`<tr><td>${x.created_at?new Date(x.created_at).toLocaleString("ar-SA-u-ca-gregory"):"—"}</td><td>${escapeHtml(b?.name||"فرع")}</td><td>${types[x.assessment_type]||escapeHtml(x.assessment_type)}</td><td>${Number(x.positive_count||0)}</td><td>${Number(x.neutral_count||0)}</td><td>${Number(x.negative_count||0)}</td><td>${Math.round(Number(x.score)||0)}%</td><td>${escapeHtml(x.notes||"—")}</td></tr>`};
  });
  const feedbackRows=filteredFeedback.map(x=>{
    const b=branches.find(z=>z.id===x.branch_id);
    const ratingLabel={positive:"إيجابي",neutral:"محايد",negative:"سلبي"};
    return {created_at:x.created_at,html:`<tr><td>${x.created_at?new Date(x.created_at).toLocaleString("ar-SA-u-ca-gregory"):"—"}</td><td>${escapeHtml(b?.name||"فرع")}</td><td>QR</td><td>${x.rating==="positive"?1:0}</td><td>${x.rating==="neutral"?1:0}</td><td>${x.rating==="negative"?1:0}</td><td>${ratingLabel[x.rating]||"—"}</td><td>${escapeHtml(x.comment||"—")}</td></tr>`};
  });
  qualityRows.sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
  feedbackRows.sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
  $("#qualityRows").innerHTML=qualityRows.length?qualityRows.map(x=>x.html).join(""):'<tr><td colspan="8" class="muted">لا توجد سجلات جودة مطابقة للتصفية</td></tr>';
  $("#feedbackRows").innerHTML=feedbackRows.length?feedbackRows.map(x=>x.html).join(""):'<tr><td colspan="8" class="muted">لا توجد مشاركات QR مطابقة للتصفية</td></tr>';
}
function openBranchQr(branch, purpose){
  let url="";
  if(purpose==="maps"){
    if(!validGoogleMapsUrl(branch.google_maps_url)||!branch.google_maps_url){toast("أضف رابط Google Maps صحيحاً لهذا الفرع أولاً.");return;}
    url=branch.google_maps_url;
    $("#qrDialogTitle").textContent="رمز تقييم الفرع على Google Maps";
    $("#qrPromoTitle").textContent="يسعدنا تقييمك على Google 💚";
    $("#qrPromoText").textContent="هل زرتنا اليوم؟ شاركنا رأيك على Google Maps وساعد الآخرين على التعرف على تجربتك.";
    $("#qrHint").textContent="امسح الرمز لفتح صفحة الفرع على Google Maps وإضافة تقييمك.";
    $("#copyFeedbackLink").textContent="نسخ رابط Google Maps";
  }else{
    if(!branch.public_token){toast("رمز الفرع غير متاح. نفّذ تحديث قاعدة البيانات أولاً.");return;}
    const feedbackUrl=new URL(window.location.href); feedbackUrl.search=""; feedbackUrl.searchParams.set("feedback",branch.public_token);
    url=feedbackUrl.toString();
    $("#qrDialogTitle").textContent="رمز تقييم الفرع";
    $("#qrPromoTitle").textContent="رأيك يصنع الفرق 💚";
    $("#qrPromoText").textContent="نسعد بخدمتك، ونطمح دائماً للأفضل. امسح الرمز وشاركنا تجربتك؛ لن يستغرق التقييم سوى دقيقة.";
    $("#qrHint").textContent="امسح الرمز وشاركنا رأيك بكل صراحة. شكراً لمساعدتنا على التطور.";
    $("#copyFeedbackLink").textContent="نسخ رابط التقييم";
  }
  activeQrUrl=url; activeQrPurpose=purpose;
  $("#qrBranchTitle").textContent=branch.name;
  $("#qrUrlText").textContent=url;
  $("#qrCanvas").innerHTML="";
  if(window.QRCode) new QRCode($("#qrCanvas"),{text:url,width:220,height:220,correctLevel:QRCode.CorrectLevel.M});
  else $("#qrCanvas").textContent="تعذر تحميل مولّد QR؛ استخدم الرابط الظاهر أدناه.";
  $("#qrDialog").showModal();
}
$("#branchList").addEventListener("click",e=>{
  const mapBtn=e.target.closest("[data-mapqr]");
  const feedbackBtn=e.target.closest("[data-qr]");
  if(!mapBtn&&!feedbackBtn)return;
  const id=mapBtn?mapBtn.dataset.mapqr:feedbackBtn.dataset.qr;
  const branch=branches.find(x=>x.id===id); if(!branch)return;
  openBranchQr(branch,mapBtn?"maps":"feedback");
});
$("#closeQr").addEventListener("click",()=>$("#qrDialog").close());
$("#printQrCard").addEventListener("click",()=>{
  if(!$("#qrCanvas").querySelector("canvas,#qrCanvas img") && !$("#qrCanvas").querySelector("img")){toast("رمز QR غير جاهز للطباعة بعد.");return;}
  window.print();
});
$("#copyFeedbackLink").addEventListener("click",async()=>{try{await navigator.clipboard.writeText(activeQrUrl);toast(activeQrPurpose==="maps"?"تم نسخ رابط Google Maps":"تم نسخ رابط التقييم");}catch(e){toast("انسخ الرابط يدوياً من النص الظاهر");}});
function exportGoogleMapsBranchExcel(branchId){
  const branch=branches.find(b=>b.id===branchId);
  const snapshot=googleMapsSnapshots.find(s=>s.branch_id===branchId);
  if(!branch||!snapshot){toast("لا توجد بيانات Google Maps لهذا الفرع بعد.");return;}
  if(!window.XLSX){toast("تعذر تحميل مكتبة Excel. أعد تحميل الصفحة.");return;}
  const reviews=Array.isArray(snapshot.reviews)?snapshot.reviews:[];
  const summary=[["تقرير تقييمات Google Maps - MIQYAS"],["اسم الفرع",branch.name],["المدينة",branch.city||""],["المنطقة",branch.area||""],["رابط Google Maps",branch.google_maps_url||""],["اسم الموقع في Google",snapshot.place_name||""],["متوسط التقييم",snapshot.rating??""],["عدد تقييمات Google",snapshot.user_rating_count??0],["عدد التعليقات المرفقة",reviews.length],["تاريخ ووقت السحب",snapshot.fetched_at?new Date(snapshot.fetched_at).toLocaleString("ar-SA-u-ca-gregory"):""],["ملاحظة","تعرض Google Places API مجموعة محدودة من المراجعات المختارة (حتى 5)، ولا تمثل كامل سجل التعليقات."]];
  const comments=[["اسم صاحب التعليق","التقييم من 5","وقت النشر النسبي","تاريخ النشر","نص التعليق","رابط Google Maps"]];
  reviews.forEach(r=>comments.push([r.author_name||"مستخدم Google",r.rating??"",r.relative_time_description||"",r.publish_time||"",r.text||"",r.google_maps_uri||branch.google_maps_url||""]));
  const wb=XLSX.utils.book_new();
  const ws1=XLSX.utils.aoa_to_sheet(summary); ws1["!cols"]=[{wch:28},{wch:65}];
  const ws2=XLSX.utils.aoa_to_sheet(comments); ws2["!cols"]=[{wch:25},{wch:15},{wch:22},{wch:28},{wch:80},{wch:55}];
  XLSX.utils.book_append_sheet(wb,ws1,"ملخص الفرع");
  XLSX.utils.book_append_sheet(wb,ws2,"التعليقات المتاحة");
  const safeName=String(branch.name||"branch").replace(/[\\/:*?"<>|]/g,"-").slice(0,40);
  XLSX.writeFile(wb,`MIQYAS_Google_Maps_${safeName}.xlsx`);
  toast("تم تجهيز تقرير Excel للفرع.");
}
$("#googleMapsReports").addEventListener("click",e=>{
  const btn=e.target.closest("[data-google-export]");
  if(btn) exportGoogleMapsBranchExcel(btn.dataset.googleExport);
});
$("#branchList").addEventListener("click",async e=>{
  const reviewBtn=e.target.closest("[data-google-reviews]");
  if(reviewBtn){
    const branch=branches.find(b=>b.id===reviewBtn.dataset.googleReviews);
    if(!branch)return;
    if(!branch.google_maps_url){toast("أضف رابط Google Maps لهذا الفرع أولاً.");return;}
    setBusy(reviewBtn,true,"جارٍ جلب التقييمات...");
    try{
      const {data,error}=await supabase.functions.invoke("google-maps-reviews",{body:{branch_id:branch.id}});
      if(error)throw error;
      if(data?.error)throw new Error(data.error);
      toast(`تم تحديث تقييمات ${branch.name}`);
      await refreshData();
    }catch(err){
      toast(err.message||"تعذر جلب تقييمات Google Maps. تحقق من إعداد الخدمة.");
    }finally{setBusy(reviewBtn,false);}
    return;
  }
  const btn=e.target.closest("[data-delete-branch]");
  if(!btn)return;
  const branch=branches.find(b=>b.id===btn.dataset.deleteBranch);
  if(!branch)return;
  const ok=confirm(`هل تريد حذف الفرع «${branch.name}»؟\\n\\nلن يتم الحذف إذا كان للفرع تقييمات أو آراء عملاء، حفاظاً على سجلاتك.`);
  if(!ok)return;
  setBusy(btn,true,"جارٍ التحقق...");
  try{
    const [quality,feedback]=await Promise.all([
      supabase.from("quality_assessments").select("id",{count:"exact",head:true}).eq("organization_id",currentOrg.id).eq("branch_id",branch.id),
      supabase.from("customer_feedback").select("id",{count:"exact",head:true}).eq("organization_id",currentOrg.id).eq("branch_id",branch.id)
    ]);
    if(quality.error)throw quality.error;
    if(feedback.error)throw feedback.error;
    const linked=(quality.count||0)+(feedback.count||0);
    if(linked>0){
      toast(`لا يمكن حذف الفرع حالياً لوجود ${linked} سجلاً مرتبطاً به. حفاظاً على بيانات التقييمات، نحتاج أرشفة الفرع بدلاً من الحذف.`);
      return;
    }
    const {error}=await supabase.from("branches").delete().eq("id",branch.id).eq("organization_id",currentOrg.id);
    if(error)throw error;
    await refreshData();
    toast("تم حذف الفرع بنجاح.");
  }catch(err){toast(err.message||"تعذر حذف الفرع.");}
  finally{setBusy(btn,false);}
});

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
    qualityRows.push([x.created_at?new Date(x.created_at):"",b?.name||"",b?.area||"",({voc:"صوت العميل (يدوي)",mystery_shopper:"سجل تاريخي غير متاح",internal:"تقييم داخلي"})[x.assessment_type]||x.assessment_type,Number(x.positive_count||0),Number(x.neutral_count||0),Number(x.negative_count||0),`${Number(x.score||0)}%`,x.notes||""]);
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

// Public legal/about pages
document.addEventListener("click",(event)=>{
  const openLink=event.target.closest("[data-open-legal]");
  if(openLink){
    event.preventDefault();
    document.getElementById(openLink.dataset.openLegal)?.showModal();
    return;
  }
  if(event.target.closest("[data-close-legal]")){
    event.target.closest("dialog")?.close();
  }
});
document.querySelectorAll(".legal-dialog").forEach(dialog=>{
  dialog.addEventListener("click",event=>{
    if(event.target===dialog) dialog.close();
  });
});
