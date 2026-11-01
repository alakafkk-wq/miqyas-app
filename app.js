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
let isPlatformAdmin = false;
let subscriptionBankSettings = null;

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
function renderRegisteredAccount(){
  const user=currentUser||{};
  const meta=user.user_metadata||{};
  $("#registeredUserName").textContent=meta.full_name||meta.name||"غير محدد";
  $("#registeredUserEmail").textContent=user.email||"—";
  $("#registeredUserId").textContent=user.id||"—";
  $("#registeredOrgName").textContent=currentOrg?.name||"—";
  $("#registeredAt").textContent=user.created_at?new Date(user.created_at).toLocaleDateString("ar-SA"):"—";
  $("#registeredBranchCount").textContent=String(branches.length);
}
async function loadWorkspace() {
  $("#orgTitle").textContent=currentOrg.name;
  renderRegisteredAccount();
  show("#appView");
  await refreshData();
  await loadSubscriptionData();
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
  if(currentUser&&currentOrg) renderRegisteredAccount();
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
    const [plansRes,subRes,reqRes,adminRes,bankRes]=await Promise.all([
      supabase.from("subscription_plans").select("code,name,price_sar,billing_period_months,branch_limit,features").eq("is_active",true).order("price_sar"),
      supabase.from("organization_subscriptions").select("id,plan_code,status,starts_at,ends_at,payment_method").eq("organization_id",currentOrg.id).order("created_at",{ascending:false}).limit(1),
      supabase.from("subscription_payment_requests").select("id,plan_code,amount_sar,payment_method,status,transfer_reference,created_at").eq("organization_id",currentOrg.id).order("created_at",{ascending:false}).limit(20),
      supabase.rpc("is_platform_admin"),
      supabase.from("subscription_bank_settings").select("bank_name,beneficiary_name,iban,instructions").eq("id",true).maybeSingle()
    ]);
    if(plansRes.error) throw plansRes.error;
    if(subRes.error) throw subRes.error;
    if(reqRes.error) throw reqRes.error;
    if(adminRes.error) throw adminRes.error;
    if(bankRes.error) throw bankRes.error;
    subscriptionBankSettings=bankRes.data||null;
    subscriptionPlans=plansRes.data||[];
    currentSubscription=subRes.data?.[0]||null;
    subscriptionRequests=reqRes.data||[];
    isPlatformAdmin=adminRes.data===true;
    renderSubscription();
    if(isPlatformAdmin) await loadAdminSubscriptionRequests();
  }catch(err){showSubscriptionSetupError(err);}
}
function renderSubscription(){
  const active=currentSubscription&&currentSubscription.status==="active"&&(!currentSubscription.ends_at||new Date(currentSubscription.ends_at)>new Date());
  $("#subscriptionStatus").textContent=active?"اشتراك نشط":"لا يوجد اشتراك نشط";
  $("#subscriptionStatus").classList.toggle("active",!!active);
  $("#currentPlanName").textContent=active?`باقة ${planLabels[currentSubscription.plan_code]||currentSubscription.plan_code}`:"لا يوجد اشتراك نشط";
  $("#currentPlanDates").textContent=active?`بدأ في ${new Date(currentSubscription.starts_at).toLocaleDateString("ar-SA")}`:"اختر الباقة المناسبة للبدء";
  $("#subscriptionExpiry").textContent=active&&currentSubscription.ends_at?`ينتهي ${new Date(currentSubscription.ends_at).toLocaleDateString("ar-SA")}`:"—";
  const bank=subscriptionBankSettings;
  $("#bankDetailsText").innerHTML=bank?.iban&&bank?.beneficiary_name
    ? `<b>البنك:</b> ${escapeHtml(bank.bank_name||"—")}<br><b>اسم المستفيد:</b> ${escapeHtml(bank.beneficiary_name)}<br><b>الآيبان:</b> <span dir="ltr">${escapeHtml(bank.iban)}</span><br>${escapeHtml(bank.instructions||"حوّل قيمة الباقة ثم أدخل رقم مرجع التحويل.")}`
    : "بيانات الحساب البنكي لم تعتمد بعد. لا تحوّل أي مبلغ قبل ظهور اسم المستفيد والآيبان الرسميين.";
  $("#subscriptionPlans").innerHTML=subscriptionPlans.map(p=>`<article class="plan-card ${p.code==="professional"?"featured":""}"><h3>${escapeHtml(p.name)}</h3><strong>${Number(p.price_sar)>0?`${Number(p.price_sar).toLocaleString("ar-SA")} ر.س <small>/ شهرياً</small>`:"حسب الاتفاق"}</strong><p>${p.branch_limit?`حتى ${p.branch_limit} فروع`:"عدد فروع مخصص"}</p><small>${escapeHtml(Array.isArray(p.features)?p.features.join(" • "):"")}</small></article>`).join("");
  $("#subscriptionRequestRows").innerHTML=subscriptionRequests.length?subscriptionRequests.map(r=>`<tr><td>${new Date(r.created_at).toLocaleDateString("ar-SA")}</td><td>${planLabels[r.plan_code]||escapeHtml(r.plan_code)}</td><td>${Number(r.amount_sar).toLocaleString("ar-SA")} ر.س</td><td>${r.payment_method==="bank_transfer"?"تحويل بنكي":"إلكتروني"}</td><td>${requestStatusLabels[r.status]||escapeHtml(r.status)}</td></tr>`).join(""):'<tr><td colspan="5" class="muted">لا توجد طلبات بعد</td></tr>';
  $("#platformAdminPanel").classList.toggle("hidden",!isPlatformAdmin);
}
$("#subscriptionRequestForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const btn=$("#submitSubscriptionRequest");setBusy(btn,true,"جارٍ إرسال الطلب...");
  try{
    const planCode=$("#subscriptionPlan").value;
    const paymentMethod=$("#subscriptionPaymentMethod").value;
    if(paymentMethod==="online") throw new Error("الدفع الإلكتروني غير متاح حتى يتم ربط بوابة الدفع واعتماد مفاتيحها.");
    const reference=$("#transferReference").value.trim();
    if(!reference) throw new Error("أدخل رقم مرجع التحويل بعد إتمام التحويل البنكي.");
    if(!subscriptionBankSettings?.iban||!subscriptionBankSettings?.beneficiary_name) throw new Error("بيانات التحويل البنكي لم تعتمد بعد. تواصل مع إدارة مقياس قبل التحويل.");
    const {data,error}=await supabase.rpc("create_subscription_payment_request",{
      p_organization_id:currentOrg.id,p_plan_code:planCode,p_payment_method:paymentMethod,p_transfer_reference:reference
    });
    if(error) throw error;
    $("#transferReference").value="";
    message("#subscriptionMessage","تم إرسال طلب الاشتراك بنجاح. سيظهر الاشتراك بعد مراجعة التحويل واعتماده.");
    await loadSubscriptionData();
  }catch(err){message("#subscriptionMessage",err.message||"تعذر إرسال طلب الاشتراك.",true);}
  finally{setBusy(btn,false);}
});
$("#refreshSubscriptionRequests").addEventListener("click",async()=>{await loadAdminSubscriptionRequests();toast("تم تحديث الطلبات");});
async function loadAdminSubscriptionRequests(){
  if(!isPlatformAdmin)return;
  const {data,error}=await supabase.from("subscription_payment_requests").select("id,organization_id,plan_code,amount_sar,transfer_reference,created_at,organizations(name)").eq("status","pending").order("created_at",{ascending:true});
  if(error){$("#adminSubscriptionRows").innerHTML=`<tr><td colspan="5">${escapeHtml(error.message)}</td></tr>`;return;}
  $("#adminSubscriptionRows").innerHTML=(data||[]).length?data.map(r=>`<tr><td>${escapeHtml(r.organizations?.name||"منشأة")}</td><td>${planLabels[r.plan_code]||r.plan_code}</td><td>${Number(r.amount_sar).toLocaleString("ar-SA")} ر.س</td><td>${escapeHtml(r.transfer_reference||"—")}</td><td><button class="primary" data-approve-sub="${r.id}">اعتماد</button> <button class="outline" data-reject-sub="${r.id}">رفض</button></td></tr>`).join(""):'<tr><td colspan="5">لا توجد طلبات معلقة</td></tr>';
}
$("#platformAdminPanel").addEventListener("click",async e=>{
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
  const selectedBranches=branches.filter(b=>(!area||String(b.area||"")===area)&&(!branchId||b.id===branchId));
  const ids=new Set(selectedBranches.map(b=>b.id));
  const filteredAssessments=assessments.filter(x=>ids.has(x.branch_id));
  const filteredFeedback=customerFeedback.filter(x=>ids.has(x.branch_id));
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
  const totalEvaluations=filteredAssessments.length+filteredFeedback.length;
  $("#branchCount").textContent=selectedBranches.length;
  $("#evalCount").textContent=totalEvaluations;
  // Average quality is based on formal quality assessments, not individual QR responses.
  const scores=filteredAssessments.map(x=>Number(x.score)).filter(Number.isFinite);
  $("#avgScore").textContent=avg(scores)===null?"—":avg(scores)+"%";
  // VOC counts combine manually entered VOC assessments and individual QR feedback.
  const voc=filteredAssessments.filter(x=>x.assessment_type==="voc");
  const pos=voc.reduce((s,x)=>s+Number(x.positive_count||0),0)+filteredFeedback.filter(x=>x.rating==="positive").length;
  const neu=voc.reduce((s,x)=>s+Number(x.neutral_count||0),0)+filteredFeedback.filter(x=>x.rating==="neutral").length;
  const neg=voc.reduce((s,x)=>s+Number(x.negative_count||0),0)+filteredFeedback.filter(x=>x.rating==="negative").length;
  const voiceTotal=pos+neu+neg;
  $("#voiceCount").textContent=voiceTotal;
  $("#vocScore").textContent=voiceTotal?Math.round(pos/voiceTotal*100)+"%":"—";
  renderSentiment(pos,neu,neg);

  $("#branchList").classList.toggle("empty",!selectedBranches.length);
  $("#branchList").innerHTML=selectedBranches.length?selectedBranches.map(b=>{
    const count=filteredAssessments.filter(x=>x.branch_id===b.id).length+filteredFeedback.filter(x=>x.branch_id===b.id).length;
    return `<div class="branchitem"><div><b>${escapeHtml(b.name)}</b><small>${escapeHtml([b.area,b.city].filter(Boolean).join(" · ")||"لم تحدد المنطقة")}</small></div><div class="branch-tools"><span class="count">${count} تقييم</span>${b.google_maps_url?`<a href="${escapeHtml(b.google_maps_url)}" target="_blank" rel="noopener">تقييم Google Maps</a>`:""}<button class="outline" data-qr="${escapeHtml(b.id)}">QR التقييم</button></div></div>`;
  }).join(""):"لا توجد فروع مطابقة للتصفية";
  $("#evalBranch").innerHTML=branches.map(b=>`<option value="${escapeHtml(b.id)}">${escapeHtml(b.name)}</option>`).join("");
  $("#saveEval").disabled=!branches.length;

  const assessmentRows=filteredAssessments.map(x=>{
    const b=branches.find(z=>z.id===x.branch_id);
    const types={voc:"صوت العميل",mystery_shopper:"المتسوق السري",internal:"تقييم داخلي"};
    return {created_at:x.created_at,html:`<tr><td>${new Date(x.created_at).toLocaleDateString("ar-SA")}</td><td>${escapeHtml(b?.name||"فرع")}</td><td>${types[x.assessment_type]||escapeHtml(x.assessment_type)}</td><td>${Number(x.positive_count||0)}</td><td>${Number(x.neutral_count||0)}</td><td>${Number(x.negative_count||0)}</td><td>${Math.round(Number(x.score)||0)}%</td></tr>`};
  });
  const feedbackRows=filteredFeedback.map(x=>{
    const b=branches.find(z=>z.id===x.branch_id);
    const ratingLabel={positive:"إيجابي",neutral:"محايد",negative:"سلبي"};
    return {created_at:x.created_at,html:`<tr><td>${new Date(x.created_at).toLocaleDateString("ar-SA")}</td><td>${escapeHtml(b?.name||"فرع")}</td><td>صوت العميل (QR)</td><td>${x.rating==="positive"?1:0}</td><td>${x.rating==="neutral"?1:0}</td><td>${x.rating==="negative"?1:0}</td><td>${ratingLabel[x.rating]||"—"}</td></tr>`};
  });
  const rows=[...assessmentRows,...feedbackRows].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
  $("#evalRows").innerHTML=rows.length?rows.map(x=>x.html).join(""):'<tr><td colspan="7" class="muted">لا توجد سجلات مطابقة للتصفية</td></tr>';
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
$("#addBranchBtn").addEventListener("click",()=>$("#branchDialog").showModal());
$("#closeBranch").addEventListener("click",()=>$("#branchDialog").close());
$("#branchForm").addEventListener("submit",async e=>{
  e.preventDefault(); const btn=e.submitter; setBusy(btn,true);
  try{
    const {error}=await supabase.from("branches").insert({organization_id:currentOrg.id,name:$("#branchName").value.trim(),city:$("#branchCity").value.trim()||null,area:$("#branchArea").value.trim()||null,google_maps_url:$("#branchGoogleMaps").value.trim()||null});
    if(error) throw error;
    e.target.reset(); $("#branchDialog").close(); await refreshData(); toast("تم حفظ الفرع في قاعدة البيانات");
  }catch(err){message("#branchMessage",err.message||"تعذر حفظ الفرع.",true);}
  finally{setBusy(btn,false);}
});
$("#evalForm").addEventListener("submit",async e=>{
  e.preventDefault(); const btn=$("#saveEval"); setBusy(btn,true);
  try{
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
  if(!window.XLSX){toast("تعذر تحميل أداة Excel. تحقق من الاتصال بالإنترنت ثم أعد المحاولة.");return;}
  const {selectedBranches,filteredAssessments,filteredFeedback}=getFilteredData();
  const voc=filteredAssessments.filter(x=>x.assessment_type==="voc");
  const positive=voc.reduce((s,x)=>s+Number(x.positive_count||0),0)+filteredFeedback.filter(x=>x.rating==="positive").length;
  const neutral=voc.reduce((s,x)=>s+Number(x.neutral_count||0),0)+filteredFeedback.filter(x=>x.rating==="neutral").length;
  const negative=voc.reduce((s,x)=>s+Number(x.negative_count||0),0)+filteredFeedback.filter(x=>x.rating==="negative").length;
  const voiceTotal=positive+neutral+negative;
  const qualityScores=filteredAssessments.map(x=>Number(x.score)).filter(Number.isFinite);
  const selectedArea=$("#filterArea").value||"كل المناطق";
  const selectedBranch=$("#filterBranch").value?selectedBranches[0]?.name||"فرع محدد":"كل الفروع";
  const summary=[
    ["تقرير منصة مقياس - مؤشرات الجودة وصوت العميل"],
    ["تاريخ استخراج التقرير",new Date()],
    ["التصفية - المنطقة",selectedArea],
    ["التصفية - الفرع",selectedBranch],
    ["عدد الفروع",selectedBranches.length],
    ["عدد سجلات التقييم",filteredAssessments.length+filteredFeedback.length],
    ["عدد أصوات العملاء",voiceTotal],
    ["الأصوات الإيجابية",positive],
    ["الأصوات المحايدة",neutral],
    ["الأصوات السلبية",negative],
    ["رضا العملاء",voiceTotal?positive/voiceTotal:0],
    ["متوسط الجودة",qualityScores.length?qualityScores.reduce((a,b)=>a+b,0)/qualityScores.length/100:0]
  ];
  const branchRows=[["الفرع","المنطقة / الحي","المدينة","سجلات التقييم","أصوات العملاء","إيجابي","محايد","سلبي","رضا العملاء","متوسط الجودة"]];
  selectedBranches.forEach(b=>{
    const ba=filteredAssessments.filter(x=>x.branch_id===b.id);
    const bf=filteredFeedback.filter(x=>x.branch_id===b.id);
    const bv=ba.filter(x=>x.assessment_type==="voc");
    const p=bv.reduce((s,x)=>s+Number(x.positive_count||0),0)+bf.filter(x=>x.rating==="positive").length;
    const n=bv.reduce((s,x)=>s+Number(x.neutral_count||0),0)+bf.filter(x=>x.rating==="neutral").length;
    const ng=bv.reduce((s,x)=>s+Number(x.negative_count||0),0)+bf.filter(x=>x.rating==="negative").length;
    const t=p+n+ng, qs=ba.map(x=>Number(x.score)).filter(Number.isFinite);
    branchRows.push([b.name,b.area||"",b.city||"",ba.length+bf.length,t,p,n,ng,t?p/t:0,qs.length?qs.reduce((a,c)=>a+c,0)/qs.length/100:0]);
  });
  const voiceRows=[["التاريخ","الفرع","المنطقة / الحي","نوع المصدر","التقييم","الملاحظات"]];
  filteredFeedback.forEach(x=>{
    const b=branches.find(y=>y.id===x.branch_id);
    voiceRows.push([x.created_at?new Date(x.created_at):"",b?.name||"",b?.area||"","QR",({positive:"إيجابي",neutral:"محايد",negative:"سلبي"})[x.rating]||x.rating,x.comment||""]);
  });
  filteredAssessments.filter(x=>x.assessment_type==="voc").forEach(x=>{
    const b=branches.find(y=>y.id===x.branch_id);
    voiceRows.push([x.created_at?new Date(x.created_at):"",b?.name||"",b?.area||"","يدوي - VOC","ملخص أصوات",`إيجابي: ${x.positive_count||0}، محايد: ${x.neutral_count||0}، سلبي: ${x.negative_count||0} ${x.notes||""}`]);
  });
  const recordRows=[["التاريخ","الفرع","المنطقة / الحي","نوع التقييم","إيجابي","محايد","سلبي","النتيجة / التصنيف","الملاحظات"]];
  filteredAssessments.forEach(x=>{
    const b=branches.find(y=>y.id===x.branch_id);
    recordRows.push([x.created_at?new Date(x.created_at):"",b?.name||"",b?.area||"",({voc:"صوت العميل VOC",mystery_shopper:"المتسوق السري",internal:"تقييم داخلي"})[x.assessment_type]||x.assessment_type,Number(x.positive_count||0),Number(x.neutral_count||0),Number(x.negative_count||0),`${Number(x.score||0)}%`,x.notes||""]);
  });
  filteredFeedback.forEach(x=>{
    const b=branches.find(y=>y.id===x.branch_id);
    recordRows.push([x.created_at?new Date(x.created_at):"",b?.name||"",b?.area||"","صوت العميل (QR)",x.rating==="positive"?1:0,x.rating==="neutral"?1:0,x.rating==="negative"?1:0,({positive:"إيجابي",neutral:"محايد",negative:"سلبي"})[x.rating]||x.rating,x.comment||""]);
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
  addSheet(recordRows,"سجل التقييمات");
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
$("#clearFilters").addEventListener("click",()=>{$("#filterArea").value="";$("#filterBranch").value="";render();});
$("#exportExcel").addEventListener("click",exportExcelReport);

$("#refresh").addEventListener("click",async()=>{try{await refreshData();toast("تم تحديث البيانات");}catch(e){toast(e.message);}});
$("#signOut").addEventListener("click",async()=>{
  const {error}=await supabase.auth.signOut();
  if(error){toast(error.message);return;}
  currentUser=null;currentOrg=null;branches=[];assessments=[];
  $("#signOut").classList.add("hidden");$("#connection").textContent="غير متصل";$("#connection").classList.remove("online");show("#authView");
});
supabase.auth.onAuthStateChange(async(event,session)=>{
  if(event==="INITIAL_SESSION" && session) return;
  if(event==="SIGNED_IN" && session && !currentUser){try{await handleSession(session);}catch(e){toast(e.message);}}
  if(event==="SIGNED_OUT"){currentUser=null;show("#authView");}
});
(async()=>{
  if(!cfg.SUPABASE_URL||!cfg.SUPABASE_PUBLISHABLE_KEY||cfg.SUPABASE_PUBLISHABLE_KEY.includes("PASTE_")){
    message("#authMessage","أكمل إعداد config.js بإضافة Publishable Key الخاص بمشروعك.",true);return;
  }
  if(await initPublicFeedback()) return;
  const {data:{session}}=await supabase.auth.getSession();
  if(session){try{await handleSession(session);}catch(e){message("#authMessage",e.message,true);}}
})();
if("serviceWorker" in navigator) window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(()=>{}));
