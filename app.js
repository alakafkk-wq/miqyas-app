import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cfg = window.MIQYAS_CONFIG || {};
const $ = (s) => document.querySelector(s);
const supabase = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY);
let authMode = "login";
let currentUser = null;
let currentOrg = null;
let branches = [];
let assessments = [];\nlet activeFeedbackToken = null;\nlet activeFeedbackUrl = "";

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
async function loadWorkspace() {
  $("#orgTitle").textContent=currentOrg.name;
  show("#appView");
  await refreshData();
}
async function refreshData() {
  const [b,e]=await Promise.all([
    supabase.from("branches").select("id,name,city,area,public_token,created_at").eq("organization_id",currentOrg.id).order("created_at",{ascending:false}),
    supabase.from("quality_assessments").select("id,branch_id,assessment_type,positive_count,neutral_count,negative_count,score,notes,created_at").eq("organization_id",currentOrg.id).order("created_at",{ascending:false}).limit(100)
  ]);
  if(b.error) throw b.error; if(e.error) throw e.error;
  branches=b.data||[]; assessments=e.data||[];
  render();
}
function render() {
  $("#branchCount").textContent=branches.length;
  $("#evalCount").textContent=assessments.length;
  const scores=assessments.map(x=>Number(x.score));
  $("#avgScore").textContent=avg(scores)===null?"—":avg(scores)+"%";
  const voc=assessments.filter(x=>x.assessment_type==="voc");
  const pos=voc.reduce((s,x)=>s+x.positive_count,0), neu=voc.reduce((s,x)=>s+x.neutral_count,0), neg=voc.reduce((s,x)=>s+x.negative_count,0);
  $("#vocScore").textContent=(pos+neu+neg)?Math.round(pos/(pos+neu+neg)*100)+"%":"—";
  $("#branchList").classList.toggle("empty",!branches.length);
  $("#branchList").innerHTML=branches.length?branches.map(b=>{
    const es=assessments.filter(x=>x.branch_id===b.id);
    return `<div class="branchitem"><div><b>${escapeHtml(b.name)}</b><small>${escapeHtml([b.area,b.city].filter(Boolean).join(" · ")||"لم تحدد المنطقة")}</small></div><div class="branch-tools"><span class="count">${es.length} تقييم</span><button class="outline" data-qr="${escapeHtml(b.id)}">QR التقييم</button></div></div>`;
  }).join(""):"لا توجد فروع بعد";
  $("#evalBranch").innerHTML=branches.map(b=>`<option value="${b.id}">${escapeHtml(b.name)}</option>`).join("");
  $("#saveEval").disabled=!branches.length;
  $("#evalRows").innerHTML=assessments.length?assessments.map(x=>{
    const b=branches.find(z=>z.id===x.branch_id);
    const types={voc:"صوت العميل",mystery_shopper:"المتسوق السري",internal:"تقييم داخلي"};
    return `<tr><td>${new Date(x.created_at).toLocaleDateString("ar-SA")}</td><td>${escapeHtml(b?.name||"فرع")}</td><td>${types[x.assessment_type]||x.assessment_type}</td><td>${x.positive_count}</td><td>${x.neutral_count}</td><td>${x.negative_count}</td><td>${Math.round(Number(x.score))}%</td></tr>`;
  }).join(""):'<tr><td colspan="7" class="muted">لا توجد سجلات بعد</td></tr>';
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
    const {error}=await supabase.from("branches").insert({organization_id:currentOrg.id,name:$("#branchName").value.trim(),city:$("#branchCity").value.trim()||null,area:$("#branchArea").value.trim()||null});
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
