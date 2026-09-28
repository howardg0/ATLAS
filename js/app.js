/* ATLAS · app: state, screens and rendering. Depends on js/data.js and
   js/core.js being loaded first (classic scripts share one global scope). */

/* ================= STATE ================= */
/* Storage key predates the ATLAS rename and must never change — it is the
   address of every logged set on the device. */
const KEY="block-log-v2";
/* Keep in step with CACHE in sw.js and the ?v= stamps in index.html (tests/version.test.js checks) */
const APP_VERSION="8.1";
let restEnd=0,restTick=null,restDur=1,restLabel="",restHintTxt="";
let S=null;
const migrateDb=d=>migrate(d,DEFAULT_DAYS,DEFAULT_SETTINGS,DEFAULT_PLAN,PHASES);
let db,BOOT_ERR=null;
try{db=migrateDb(load())}
catch(e){   /* a corrupt save must never brick the app: stash it beside the live key and boot clean */
  BOOT_ERR=e;try{localStorage.setItem(KEY+"-broken-"+Date.now(),localStorage.getItem(KEY)||"")}catch(_){}
  db=migrateDb({});
}
try{applyTheme()}catch(e){}   /* before first paint, so light-theme users don't get a dark flash */
/* the installed app and a browser tab share localStorage: adopt what the other context wrote */
addEventListener("storage",e=>{
  if(e.key!==KEY||!e.newValue||S)return;
  try{const d=JSON.parse(e.newValue);if((d.updatedAt||0)>(db.updatedAt||0)){db=migrateDb(mergeDb(db,d));DAYS=db.programme;PV=null;const cur=document.querySelector(".screen.active");if(cur)showNow(["preview","done","session"].includes(cur.id.slice(4))?"home":cur.id.slice(4))}}catch(_){}
});
let SAVE_ERR=null;
/* The live programme is db.programme (editable); DAYS points at it after init. */
let DAYS=DEFAULT_DAYS;
const dayIds=()=>Object.keys(DAYS);
/* the plan: weeks, phases, set counts, RIR (db.plan; archived blocks carry their own).
   Block plans have a fixed length. Open plans count calendar weeks from startDate
   forever, so "WEEKS" is a horizon: the later of this week and the last logged
   week, plus one to look ahead. */
const isOpen=()=>!!db.plan.open;
const WEEKDAYS=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const todayISO=()=>isoDate(new Date());
function curWeek(){return isOpen()?calendarWeek(db.plan.startDate,todayISO()):db.selWeek}
const WEEKS=()=>isOpen()?Math.max(curWeek(),maxLoggedWeek(db.logs),1)+1:db.plan.weeks.length;
const wk=w=>planWeek(db.plan,w);
const phaseOf=w=>wk(w).phase,rirOf=w=>wk(w).rir,deloadWeek=w=>phaseOf(w)==="Deload";
const rampWeek=w=>isRampWeek(db.plan,w);
const phaseLabel=w=>isOpen()?(deloadWeek(w)?"Light week":rampWeek(w)?"Ramp-in week":"Hard week"):phaseOf(w);
const weekNums=()=>Array.from({length:WEEKS()},(_,i)=>i+1);
const blockComplete=()=>!isOpen()&&weekNums().every(weekComplete);
/* the weeks a strip or chart shows: everything for a block, a rolling window for an open plan */
function weekWindow(focus){
  if(!isOpen())return weekNums();
  const hi=Math.max(focus||0,curWeek())+1,lo=Math.max(1,hi-7);
  return Array.from({length:hi-lo+1},(_,i)=>lo+i);
}
/* weekday for a day slot in an open plan (fixed days, Monday first) */
function dayWeekday(d){const i=dayIds().indexOf(d);return isOpen()&&dayIds().length<=7&&i>=0?WEEKDAYS[i]:""}
const todayIdx=()=>(new Date().getDay()+6)%7;
/* rough pacing: compounds are slower than accessories */
function estMinutes(w,d){
  let m=6;
  DAYS[d].ex.forEach((e,i)=>{m+=slotMinutes(slotSets(w,d,i),e[2])});
  return Math.round(m/5)*5;
}
/* Slots skipped for time in one session live on that day's log entry, like today-only swaps */
function skipList(w,d){const L=db.logs[logKey(w,d)];return (L&&L.skip)||[]}
function isSkipped(w,d,i){return skipList(w,d).includes(i)}
function load(){
  try{
    const d=JSON.parse(localStorage.getItem(KEY));
    if(d)return d;
  }catch(e){}
  // migrate from v1 if present
  try{
    const v1=JSON.parse(localStorage.getItem("block1-log-v1"));
    if(v1)return{block:1,logs:v1.logs||{},selWeek:v1.selWeek||1};
  }catch(e){}
  return{};
}
/* every archived block carries the programme and swaps it was run under, so
   history resolves names against the programme in force at the time */
function blockCtx(){return{programme:db.programme,swaps:db.swaps,block:db.block,plan:db.plan}}
/* how many weeks an archived or current block spans (open plans: as far as was logged) */
function blockWeeks(B){const p=B.plan||DEFAULT_PLAN;return p.open?maxLoggedWeek(B.logs):planWeeks(p)}
function allBlocks(){return db.archive.concat([{block:db.block,logs:db.logs,programme:db.programme,swaps:db.swaps,plan:db.plan}])}
/* localStorage is the working copy; IndexedDB is a durable mirror that survives
   most storage evictions, so years of logs don't hinge on one fragile store */
const IDB={
  _p:null,
  open(){if(this._p)return this._p;this._p=new Promise((res,rej)=>{
    const r=indexedDB.open("blocklog",1);
    r.onupgradeneeded=()=>r.result.createObjectStore("kv");
    r.onsuccess=()=>{r.result.onversionchange=()=>{r.result.close();IDB._p=null};res(r.result)};r.onerror=()=>rej(r.error)});
    this._p.catch(()=>{this._p=null});return this._p},
  async set(k,v){try{const d=await this.open();d.transaction("kv","readwrite").objectStore("kv").put(v,k)}catch(e){}},
  async get(k){try{const d=await this.open();return new Promise(res=>{
    const q=d.transaction("kv").objectStore("kv").get(k);
    q.onsuccess=()=>res(q.result);q.onerror=()=>res(null)})}catch(e){return null}},
  async del(k){try{const d=await this.open();d.transaction("kv","readwrite").objectStore("kv").delete(k)}catch(e){}},
  async keys(){try{const d=await this.open();return new Promise(res=>{
    const q=d.transaction("kv").objectStore("kv").getAllKeys();
    q.onsuccess=()=>res(q.result||[]);q.onerror=()=>res([])})}catch(e){return []}}
};
function save(opts){
  if(!(opts&&opts.quiet))db.updatedAt=Date.now();   /* what Drive sync compares; quiet saves are bookkeeping only */
  /* snapshot the live session and rest clock so a kill mid-workout is recoverable */
  db.session=S?{w:S.w,d:S.d,exIdx:S.exIdx,setIdx:S.setIdx,t:Date.now()}:null;
  db.rest=(restEnd>Date.now())
    ?{end:restEnd,label:restLabel,dur:restDur,hint:restHintTxt}:null;
  const json=JSON.stringify(db);
  try{localStorage.setItem(KEY,json);SAVE_ERR=null}catch(e){SAVE_ERR=String(e&&e.name||e);toast("Storage unavailable — back up now")}
  /* the IndexedDB mirror stores the same string, written at most once a second */
  MIRROR_JSON=json;clearTimeout(MIRROR_T);MIRROR_T=setTimeout(flushMirror,800);
}
let MIRROR_JSON=null,MIRROR_T=null;
function flushMirror(){clearTimeout(MIRROR_T);MIRROR_T=null;if(MIRROR_JSON!=null){IDB.set("db",MIRROR_JSON);MIRROR_JSON=null}}
document.addEventListener("visibilitychange",()=>{if(document.hidden)flushMirror()});
addEventListener("pagehide",flushMirror);

/* ================= HELPERS ================= */
/* keep the last few runtime errors so a problem report carries something useful */
function logErr(msg){
  try{if(!db||!Array.isArray(db.errors))return;db.errors.push({t:new Date().toISOString().slice(0,16),m:String(msg).slice(0,200)});db.errors=db.errors.slice(-5);save({quiet:true})}catch(e){}
}
addEventListener("error",e=>logErr((e.message||"error")+" @ "+String(e.filename||"").split("/").pop()+":"+(e.lineno||"")));
addEventListener("unhandledrejection",e=>logErr("promise: "+((e.reason&&e.reason.message)||e.reason)));
const $=id=>document.getElementById(id);
function toast(m,actionLabel,actionFn){
  const t=$("toast");
  t.innerHTML=m+(actionLabel?` <button id="toast-act" tabindex="-1">${actionLabel}</button>`:"");
  t.classList.toggle("act",!!actionLabel);
  const hide=()=>t.classList.remove("show");
  t.onclick=actionLabel?()=>{hide();actionFn()}:null;
  const arm=ms=>{clearTimeout(t._h);t._h=setTimeout(hide,ms)};
  t.onpointerdown=()=>clearTimeout(t._h);t.onpointerup=t.onpointercancel=()=>arm(1500);
  t.classList.add("show");arm(actionLabel?4500:2000);
}
function bumpEl(id,step){
  const el=$(id);let v=parseFloat(el.value)||0;
  v=Math.max(0,Math.round((v+step)*10)/10);
  if(Math.abs(step)===1)v=Math.round(v);
  el.value=v;
}
function setsFor(w,isComp){return isComp?wk(w).comp:wk(w).acc}
/* a slot can pin its own set count ({sets:n}); light weeks scale it to about 60% */
function plannedSets(w,d,i){
  const e=DAYS[d].ex[i];const o=exOpt(e,"sets");
  const n=o?(deloadWeek(w)?Math.max(1,Math.round(o*0.6)):o):setsFor(w,e[2]);
  return rampWeek(w)?rampSets(n):n;
}
/* what this session actually asks for: the plan, unless the slot was skipped for time today */
function slotSets(w,d,i){return isSkipped(w,d,i)?0:plannedSets(w,d,i)}
function totalSets(w,d){return DAYS[d].ex.reduce((a,e,i)=>a+slotSets(w,d,i),0)}
function loggedSets(w,d,logs){logs=logs||db.logs;const L=logs[logKey(w,d)];if(!L)return 0;let n=0;for(const ex of Object.values(L.ex||{}))n+=ex.filter(s=>s&&s.kg!=null).length;return n}
function sessionTonnage(w,d,logs){logs=logs||db.logs;const L=logs[logKey(w,d)];if(!L)return 0;let t=0;for(const ex of Object.values(L.ex||{}))for(const s of ex)if(s&&s.kg!=null)t+=setTonnage(s);return Math.round(t)}
function ytLink(name){return "https://www.youtube.com/results?search_query="+encodeURIComponent(name+" proper form")}
function exName(d,i){return (db.swaps&&db.swaps[d+"-"+i])||(DAYS[d].ex[i]||["—"])[0]}
/* Name in a specific session: a "just today" swap on that day's log wins over the programme/permanent swap */
function onceName(w,d,i){const L=db.logs[logKey(w,d)];return (L&&L.once&&L.once[i])||null}
function sessName(w,d,i){return onceName(w,d,i)||exName(d,i)}
/* ---------- per-lift settings (Lift screen) over global defaults (Settings) ---------- */
function increment(name){return incrementFor(name,db.lifts,BIG_INC)}
function isUni(name){return isUnilateral(name,db.lifts,EXDB)}
/* seconds instead of reps: encyclopedia default, per-lift override wins */
function isTimed(name){const o=db.lifts[name];if(o&&o.timed!=null)return !!o.timed;return !!(EXDB[name]&&EXDB[name].timed)}
/* on an assisted machine the weight is help, so "lighter" is harder: the coach's drop-offs and resets skip these */
const isAssisted=name=>/^Assisted /.test(name);
/* The slot's rep range, unless the lift now in it is timed and the planned one wasn't (or vice versa):
   "45–60" seconds makes no sense for Machine Crunch, so a swap across that line gets a default range. */
function slotRange(w,d,i){
  const e=DAYS[d].ex[i],name=sessName(w,d,i);
  if(onceName(w,d,i)&&isTimed(name)!==isTimed(exName(d,i)))return isTimed(name)?"30–45":"10–15";   /* today-only swap across the seconds/reps line */
  return e[1];
}
function restSecs(w,d,i){const e=DAYS[d].ex[i];return restFor(sessName(w,d,i),e[2],db.lifts,db.settings.rest)}
function liftOpt(name){return db.lifts[name]||{}}
/* v===null clears the override; an explicit 0 is kept (e.g. uni:0 = "not per side") */
function setLiftOpt(name,k,v){
  const o=db.lifts[name]||{};
  if(v==null)delete o[k];else o[k]=v;
  if(Object.keys(o).length)db.lifts[name]=o;else delete db.lifts[name];
  save();
}
const COMP_PATTERNS=["Squat","Hinge","Horizontal Push","Vertical Push","Horizontal Pull","Vertical Pull"];
const isCompPattern=name=>!!(EXDB[name]&&COMP_PATTERNS.includes(EXDB[name].pat));
function weekComplete(w){const ds=dayIds().filter(d=>totalSets(w,d)>0);return ds.length>0&&ds.every(d=>sessionDone(db.logs[logKey(w,d)],loggedSets(w,d),totalSets(w,d)))}
const programmeEmpty=()=>!dayIds().some(d=>DAYS[d].ex.length>0);

/* ---------- in-app confirm (replaces native confirm dialogs) ---------- */
let CONFIRM=null;
function ask(o){
  return new Promise(res=>{
    CONFIRM=res;
    $("cf-title").textContent=o.title;
    $("cf-body").innerHTML=o.body||"";
    const b=$("cf-ok");
    b.textContent=o.ok||"Confirm";
    b.className="bigbtn "+(o.danger?"danger":"primary");
    $("cfsheet").classList.add("active");
    tap(8);
  });
}
function closeAsk(v){
  $("cfsheet").classList.remove("active");
  if(CONFIRM){const f=CONFIRM;CONFIRM=null;f(v)}
}
/* haptics: one vocabulary so every kind of moment feels different in the hand */
const HAPTIC={tap:[8],select:[6],log:[14],pr:[40,60,40,60,120],restEnd:[200,100,200],error:[30,40,30]};
function haptic(k){try{if(navigator.vibrate)navigator.vibrate(HAPTIC[k]||HAPTIC.tap)}catch(e){}}
function tap(ms){haptic(ms>=10?"log":"tap")}
const reduceMotion=()=>matchMedia("(prefers-reduced-motion: reduce)").matches;
function go(name){tap(8);show(name)}

/* ================= NAV =================
   Screens are wired into the History API so the Android back
   gesture walks session → preview → home instead of exiting. */
const SCROLL={};
function show(name,push=true,dir){
  const cur=document.querySelector(".screen.active");
  if(cur)SCROLL[cur.id]=window.scrollY;
  /* View Transitions: shared elements (nav, dock, the tapped day's title) hold still while the rest crossfades */
  const swap=()=>showNow(name,dir);
  if(document.startViewTransition&&!reduceMotion()&&!document.hidden)document.startViewTransition(swap);else swap();
  if(push&&!(history.state&&history.state.scr===name))history.pushState({scr:name},"");
}
function showNow(name,dir){
  document.querySelectorAll(".screen").forEach(s=>s.classList.remove("active","in-fwd","in-back"));
  const el=$("scr-"+name);
  el.classList.add("active");
  void el.offsetWidth;                       /* restart the animation */
  el.classList.add(dir==="back"?"in-back":"in-fwd");
  document.body.classList.toggle("in-session",name==="session");   /* no nav mid-set: fewer mis-taps, more room */
  $("nav-home").classList.toggle("active",name==="home"||name==="preview"||name==="settings"||name==="prog"||name==="nutri");
  $("nav-lib").classList.toggle("active",name==="lib"||name==="lift");
  $("nav-stats").classList.toggle("active",name==="stats");
  $("nav-progress").classList.toggle("active",name==="progress");
  if(name==="home")renderHome();
  if(name==="preview"&&PV)renderPreview();
  if(name==="lib")renderLib();
  if(name==="stats")renderStats();
  if(name==="progress")renderProgress();
  if(name==="settings")renderSettings();
  if(name==="prog")renderProg();
  if(name==="nutri")renderNutri();
  if(name==="done")renderDone(DONE.w,DONE.d);
  if(name==="session"){if(S)renderSet();measureDock()}   /* the dock only has a height once the screen is displayed */
  /* coming back should land where you left, going forward starts at the top.
     Wait a frame: the screen was just re-rendered, so scrollTo would otherwise
     be clamped against the previous screen's height. */
  const y=dir==="back"?(SCROLL["scr-"+name]||0):0;
  if(y)requestAnimationFrame(()=>window.scrollTo(0,y));
  else window.scrollTo(0,0);
}
addEventListener("popstate",e=>{
  /* back closes any overlay first, consuming the gesture */
  const veil=$("restveil").classList.contains("active");
  const sw=$("swapsheet").classList.contains("active");
  const ed=$("editsheet").classList.contains("active");
  const pk=$("picksheet").classList.contains("active");
  const cf=$("cfsheet").classList.contains("active");
  const pd=$("padsheet").classList.contains("active");
  const ch=$("choosesheet").classList.contains("active");
  const bk=$("bulksheet").classList.contains("active");
  const ci=$("cisheet").classList.contains("active"),pvw=$("photoview").classList.contains("active");
  if(veil||sw||ed||pk||cf||pd||ch||bk||ci||pvw){
    if(veil)endRest();if(sw)closeSwap();if(ed)closeEdit();if(pk)closePick();if(cf)closeAsk(false);if(pd)closePad();if(ch)closeChoose();if(bk)closeBulk();if(ci)closeCheckin();if(pvw)closePhoto();
    history.pushState({scr:document.querySelector(".screen.active").id.slice(4)},"");
    return;
  }
  let scr=(e.state&&e.state.scr)||"home";
  const leavingSession=document.querySelector(".screen.active").id==="scr-session"&&scr!=="session";
  if(leavingSession&&S){S=null;unlockScreen();save()}   /* same as the back button in the session topbar */
  if(scr==="session"&&!S)scr=PV?"preview":"home";
  if(scr==="preview"&&!PV)scr="home";
  show(scr,false,"back");
});

/* ---------- screen wake lock during sessions ---------- */
let wakeLock=null;
async function lockScreen(){try{wakeLock=await navigator.wakeLock.request("screen")}catch(e){}}
function unlockScreen(){if(wakeLock){wakeLock.release().catch(()=>{});wakeLock=null}}
document.addEventListener("visibilitychange",()=>{if(!document.hidden&&S)lockScreen()});

/* ================= HOME ================= */
function ringSVG(n,of){
  const C=2*Math.PI*20,pct=Math.min(1,n/of);
  /* drawn empty, then eased to its value once it's on screen (see animateRings) */
  return `<svg viewBox="0 0 48 48" width="54" height="54" role="img" aria-label="${n} of ${of} sessions complete">
    <circle cx="24" cy="24" r="20" fill="none" stroke="var(--surface2)" stroke-width="5"/>
    <circle class="rfgc" cx="24" cy="24" r="20" fill="none" stroke="var(--plate-green)" stroke-width="5" stroke-linecap="round"
      stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${C.toFixed(1)}" data-to="${(C*(1-pct)).toFixed(1)}" transform="rotate(-90 24 24)"/>
    <text x="24" y="28" text-anchor="middle" font-size="11" font-weight="700" fill="var(--ink)">${n}/${of}</text></svg>`;
}
function renderHero(){
  const w=db.selWeek;
  let sessDone=0;
  /* ring: the block for block plans; this week for an open plan */
  const ringWeeks=isOpen()?[w]:weekNums();
  const totalSess=dayIds().filter(d=>DAYS[d].ex.length).length*ringWeeks.length;
  for(const ww of ringWeeks)for(const dd of dayIds())if(totalSets(ww,dd)>0&&loggedSets(ww,dd)>=totalSets(ww,dd))sessDone++;
  const q=db.session;
  if(q&&Date.now()-q.t<6*3600e3&&DAYS[q.d]&&loggedSets(q.w,q.d)<totalSets(q.w,q.d)){
    const mins=Math.round((Date.now()-q.t)/60000);
    $("hero").innerHTML=`<button class="hero d${q.d}" onclick="resumeSession()">
      <div class="hinfo"><div class="hkick" style="color:var(--plate-yellow)">Session in progress</div>
      <div class="hname">Day ${q.d} · ${esc(DAYS[q.d].title)}</div>
      <div class="hmeta">Left off at ${sessName(q.w,q.d,Math.min(q.exIdx,DAYS[q.d].ex.length-1))} · ${mins<60?mins+" min":Math.round(mins/60)+" h"} ago</div></div>
      <div class="hring">${ringSVG(sessDone,totalSess)}</div></button>`;
    return;
  }
  if(programmeEmpty()){
    $("hero").innerHTML=`<button class="hero" onclick="go('prog')">
      <div class="hinfo"><div class="hkick" style="color:var(--plate-blue)">Your programme is empty</div>
      <div class="hname">Build your first training day</div>
      <div class="hmeta">Add lifts from the library, set rep ranges, pair supersets. Then come back here to train.</div></div>
      <div class="hring"><svg viewBox="0 0 24 24" class="gico" style="width:34px;height:34px;color:var(--ink-dim)"><path d="M3.5 8h9M17 8h3.5M3.5 16h3M11 16h9.5"/><circle cx="14.6" cy="8" r="2.4"/><circle cx="7.8" cy="16" r="2.4"/></svg></div></button>`;
    return;
  }
  let nd=null;
  /* open plan, this week: today's session first if it's still open */
  if(isOpen()&&w===curWeek()){const td=dayIds()[todayIdx()];if(td&&totalSets(w,td)>0&&loggedSets(w,td)<totalSets(w,td))nd=td}
  if(!nd)for(const d of dayIds())if(totalSets(w,d)>0&&loggedSets(w,d)<totalSets(w,d)){nd=d;break}
  if(nd){
    const started=loggedSets(w,nd)>0;
    const first=sessName(w,nd,0),h0=prevSession(w,nd,0);
    const firstTxt=DAYS[nd].ex.length
      ?`Starts with <b>${first}</b>${h0?` · last <b>${fmtSet(h0.sets[0])}</b>`:""}`
      :"No lifts on this day yet";
    $("hero").innerHTML=`<button class="hero d${nd}" onclick="shareTitle(this.querySelector('.hname'));showPreview(${w},'${nd}')">
      <div class="hinfo"><div class="hkick">${started?"Continue":isOpen()&&w<curWeek()?"Missed":isOpen()&&w>curWeek()?"Upcoming":(isOpen()&&w===curWeek()&&dayIds()[todayIdx()]===nd?"Today":"Next up")} · Week ${w}${isOpen()&&deloadWeek(w)?" · light":""}</div>
      <div class="hname">${dayWeekday(nd)?dayWeekday(nd)+" · ":"Day "+nd+" · "}${esc(DAYS[nd].title)}</div>
      <div class="hmeta">${started?loggedSets(w,nd)+"/"+totalSets(w,nd)+" sets logged — pick it back up":firstTxt}</div>
      <div class="hmeta2">${DAYS[nd].ex.length} lifts · ${totalSets(w,nd)} sets · ~${estMinutes(w,nd)} min</div></div>
      <div class="hring">${ringSVG(sessDone,totalSess)}</div></button>`;
  }else{
    $("hero").innerHTML=`<div class="hero">
      <div class="hinfo"><div class="hkick" style="color:var(--plate-green)">Week ${w} complete</div>
      <div class="hname">Every session done ✓</div>
      <div class="hmeta">${isOpen()?"Next week starts Monday"+(isLightWeek(db.plan,w+1)?" — and it's a light one":""):w<WEEKS()?"Select week "+(w+1)+" below to keep rolling":"Block finished — roll over in Settings"}</div></div>
      <div class="hring">${ringSVG(sessDone,totalSess)}</div></div>`;
  }
}
const PHASE_COLOR={"Re-groove":"var(--plate-blue)","Build":"var(--plate-red)",
  "Peak":"var(--plate-yellow)","Deload":"var(--plate-green)"};
/* the element an outgoing screen hands to the incoming title (View Transitions shared element) */
function shareTitle(el){if(!el)return;el.style.viewTransitionName="pv-title"}
function animateRings(){requestAnimationFrame(()=>requestAnimationFrame(()=>
  document.querySelectorAll(".rfgc").forEach(c=>c.style.strokeDashoffset=c.dataset.to)))}
const INSTALL={prompt:null};
const isStandalone=()=>matchMedia("(display-mode: standalone)").matches||navigator.standalone===true;
function templateRowsHTML(onpick){
  return PROGRAMME_TEMPLATES.map(t=>`<button class="librow" onclick="${onpick}('${t.id}')">
    <div class="linfo"><div class="lname">${t.name}</div><div class="lmeta">${t.tag}</div>
    <div class="lmeta" style="margin-top:5px;line-height:1.45">${t.desc}</div></div>
    <svg viewBox="0 0 24 24" class="chev"><path d="M9.6 5.4 16.2 12l-6.6 6.6"/></svg></button>`).join("");
}
function applyTemplate(id){
  const t=PROGRAMME_TEMPLATES.find(x=>x.id===id);if(!t)return;
  db.programme=clone(t.programme);db.swaps={};db.programmeName=t.name;db.templateChosen=1;
  DAYS=db.programme;for(const d of dayIds())normaliseSupersets(DAYS[d].ex);
  if(t.plan){
    db.plan=validatePlan(clone(t.plan),DEFAULT_PLAN,PHASES);
    if(db.plan.open){
      const t0=todayISO(),sunday=new Date(t0+"T12:00:00").getDay()===0;
      const from=sunday?nextMonday(t0):t0;   /* switching on a Sunday: tomorrow starts week 1, not the week ending today */
      db.plan.startDate=isoDate(mondayOf(from));db.startedOn=from;db.autoWeekFor=null;
    }
  }else if(isOpen())db.plan=clone(DEFAULT_PLAN);   /* a block template replaces an open plan with the default block */
  db.selWeek=isOpen()?curWeek():1;
  save();
}
/* first run: pick a starting point */
function chooseTemplate(id){
  applyTemplate(id);tap(8);
  if(id==="blank"){go("prog");toast("Add your first lift with + Add exercise")}
  else{renderHome();toast(db.programmeName+" loaded")}
}
/* later: Settings → Start from a template */
async function pickTemplate(){
  chooseSheet("Start from a template","Replaces every day and lift in the programme. Sets you've logged stay in your history and records.",
    PROGRAMME_TEMPLATES.map(t=>({label:`${t.name} · ${t.tag}`,value:t.id})),async id=>{
      const t=PROGRAMME_TEMPLATES.find(x=>x.id===id);
      const hasLogs=Object.keys(db.logs).length>0;
      if(!hasLogs&&!db.archive.length){
        if(db.programmeName==="Custom programme"&&!await ask({title:"Replace your programme?",body:`Every day and lift you built is replaced by <b>${esc(t.name)}</b>.`,ok:"Replace"}))return;
        applyTemplate(id);renderSettings();toast(db.programmeName+" loaded");if(id==="blank")go("prog");return}
      /* what carries over: every lift in the new plan that already has history */
      const names=[...new Set(Object.values(t.programme||{}).flatMap(day=>day.ex.map(e=>e[0])))];
      const known=names.filter(n=>liftStats(n,null));
      const carry=names.length?`<b>${known.length} of ${names.length}</b> lifts in ${esc(t.name)} already have history, so the coach suggests your last weights from day one${known.length<names.length?"; the rest get a find-your-weight first session":""}. Records, progression charts, streaks and per-lift settings all carry across.`:"";
      const mon=nextMonday(todayISO()),monTxt=new Date(mon+"T12:00:00").toLocaleDateString(undefined,{weekday:"long",day:"numeric",month:"short"});
      const opts=[];
      if(t.plan&&t.plan.open)opts.push({label:`Start on ${monTxt}`,value:"monday"});
      opts.push({label:hasLogs?"Switch now (archive this block)":"Switch now",value:"now"});
      chooseSheet("Switch to "+t.name,carry+(t.plan&&t.plan.open?" Starting on a Monday keeps calendar weeks clean: you finish this week on the current plan and the app switches itself that morning.":""),opts,async when=>{
        if(when==="monday"){db.pending={template:id,startOn:mon};save();renderSettings();renderHome();toast(t.name+" starts "+monTxt);return}
        performSwitch(id,null);renderSettings();toast(db.programmeName+" loaded");
        if(id==="blank")go("prog");
      });
    });
}
/* Archive the current block (if anything is logged), carry the streaks, apply the template.
   startOn: the Monday a scheduled switch was due (so days missed since then count), or null for now. */
function performSwitch(id,startOn){
  const list=sessionList();
  const carry={s:sessionStreakNow(list),w:weekStreakNow()};
  if(Object.keys(db.logs).length)archiveCurrent();
  applyTemplate(id);
  if(isOpen()&&startOn){db.plan.startDate=isoDate(mondayOf(startOn));db.startedOn=startOn;db.selWeek=curWeek()}
  db.streakCarry=(carry.s||carry.w)?carry:null;
  db.pending=null;save();
}
/* a scheduled switch fires the first time the app opens on or after its Monday */
function checkPending(){
  const p=db.pending;if(!p||todayISO()<p.startOn)return false;
  const t=PROGRAMME_TEMPLATES.find(x=>x.id===p.template);
  if(!t){db.pending=null;save();return false}
  performSwitch(p.template,p.startOn);
  PV=null;DONE={w:1,d:dayIds()[0]};   /* a preview or summary of the old plan's day must not survive the switch */
  toast(t.name+" has started — week 1");
  return true;
}
async function switchNow(){const p=db.pending;if(!p)return;const t=PROGRAMME_TEMPLATES.find(x=>x.id===p.template);
  if(Object.keys(db.logs).length&&!await ask({title:"Switch now?",body:`This block is archived and <b>${esc(t?t.name:"the new plan")}</b> starts today instead of Monday.`,ok:"Switch now"}))return;
  performSwitch(p.template,null);PV=null;renderHome();toast((t?t.name:"Plan")+" loaded")}
function cancelPending(){db.pending=null;save();renderHome();toast("Scheduled switch cancelled")}
const isIOS=()=>/iPhone|iPad|iPod/.test(navigator.userAgent)&&!window.MSStream;
function homeCards(){
  let html="";
  const fresh=!Object.keys(db.logs).length&&!db.archive.length;
  if(fresh&&!db.templateChosen){
    $("home-cards").innerHTML=`<div class="introcard"><h3>Choose a starting point</h3>
      <p class="hsets" style="margin:-4px 0 12px">Every one of these can be edited afterwards: days, lifts, rep ranges, block length.</p>
      ${templateRowsHTML("chooseTemplate")}</div>`;
    return;
  }
  if(!db.seenIntro&&fresh)
    html+=`<div class="introcard"><h3>How ATLAS works</h3>
      ${isOpen()
        ?`<div class="introstep"><span class="n">1</span><div><b>An open-ended plan</b><p>Weeks count up from this Monday and never reset.${db.plan.rampWeeks?` The first ${db.plan.rampWeeks===1?"week runs":db.plan.rampWeeks+" weeks run"} at about two-thirds of the sets while you settle in.`:""} Hard weeks are every set to ${esc(rirOf(db.plan.rampWeeks+1||1))} RIR; every ${db.plan.every}th week is light: same weights, fewer sets. Postpone it from the Plan screen if you're flying.</p></div></div>`
        :`<div class="introstep"><span class="n">1</span><div><b>Training in blocks</b><p>Sets and intensity climb week by week, then a deload. The default block is six weeks; change the length and phases under Programme → Block structure.</p></div></div>`}
      <div class="introstep"><span class="n">2</span><div><b>RIR is your effort dial</b><p>Reps in reserve. ${isOpen()?"0 to 1 RIR means every set ends at, or one rep before, failure. Stop a heavy compound at 1 when form goes, not muscle.":"3 RIR means stop three reps short of failure. The target tightens as the block goes on."}</p></div></div>
      <div class="introstep"><span class="n">3</span><div><b>The coach picks the weight</b><p>Hit the top of the rep range on every set and it tells you to add load. Miss it and you chase reps at the same weight.</p></div></div>
      <button class="bigbtn ghost" onclick="db.seenIntro=1;save();renderHome()">Got it</button></div>`;
  if(db.pending){
    const t=PROGRAMME_TEMPLATES.find(x=>x.id===db.pending.template);
    const when=new Date(db.pending.startOn+"T12:00:00").toLocaleDateString(undefined,{weekday:"long",day:"numeric",month:"short"});
    html+=`<div class="nudge" style="border-left-color:var(--blue)"><svg viewBox="0 0 24 24" class="gico" style="color:var(--blue)"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>
      <div style="flex:1"><b>${esc(t?t.name:"New plan")}</b> starts ${when}. Carry on with the current plan until then; the app switches itself that morning and your streaks carry over.
      <div class="libchips wrap" style="margin-top:10px"><button class="libchip" onclick="switchNow()">Switch now</button><button class="libchip" onclick="cancelPending()">Cancel</button></div></div></div>`;
  }
  if(isIOS()&&!isStandalone()&&!db.hideInstall)
    html+=`<div class="nudge install"><svg viewBox="0 0 24 24" class="gico"><path d="M12 3.5v11M7.5 8 12 3.5 16.5 8M4 14.5v3.2a2.3 2.3 0 0 0 2.3 2.3h11.4a2.3 2.3 0 0 0 2.3-2.3v-3.2"/></svg>
      <span style="flex:1">Install ATLAS so it works offline and keeps your log safe: tap Safari's <b>Share</b> button, then <b>Add to Home Screen</b>. A plain Safari tab can lose its data after a week unused.
      <button class="libchip" style="margin-top:8px" onclick="db.hideInstall=1;save();renderHome()">Got it</button></span></div>`;
  if(INSTALL.prompt&&!db.hideInstall&&!isStandalone())
    html+=`<button class="nudge tap install" onclick="installApp()"><svg viewBox="0 0 24 24" class="gico"><path d="M12 3.5v11M7.5 10.5 12 15l4.5-4.5M4 16.5v2.2a1.8 1.8 0 0 0 1.8 1.8h12.4a1.8 1.8 0 0 0 1.8-1.8v-2.2"/></svg>
      <span>Install ATLAS for a full-screen app that works offline. <b>Install</b></span></button>`;
  $("home-cards").innerHTML=html;
}
async function installApp(){
  const e=INSTALL.prompt;if(!e)return;
  INSTALL.prompt=null;e.prompt();
  try{const r=await e.userChoice;if(r&&r.outcome!=="accepted")db.hideInstall=1}catch(x){}
  save();renderHome();
}
addEventListener("beforeinstallprompt",e=>{e.preventDefault();INSTALL.prompt=e;if($("scr-home").classList.contains("active"))homeCards()});
function backupNudgeHTML(minDays){
  const hasData=Object.keys(db.logs).length>0||db.archive.length;
  const days=db.lastBackup?Math.floor((Date.now()-db.lastBackup)/86400000):null;
  if(!hasData||(days!==null&&days<=minDays))return "";
  return `<button class="nudge tap" onclick="backupJSON(false)"><svg viewBox="0 0 24 24" class="gico"><path d="M12 3.6 21.2 20H2.8z"/><path d="M12 10v4.2M12 17v.4"/></svg>
    <span>${days===null?"No backup yet":"Last backup "+days+" days ago"}${driveOn()?" — Drive sync is on, but a file you hold is the safety net.":" — your history lives only on this phone. Google Drive sync (Settings) keeps a copy for you."} <b>Back up now</b></span></button>`;
}
/* every planned session up to now, in order, with whether it is done and whether it was due */
function sessionList(){
  const out=[];
  if(isOpen()&&db.startedOn&&todayISO()<db.startedOn)return out;   /* scheduled to start later this week: nothing due yet */
  const cw=isOpen()?curWeek():Math.max(1,maxLoggedWeek(db.logs));   /* block plans: browsing the strip must not change the streak */
  const ti=todayIdx();
  /* an open plan started mid-week: the days before the start were never due */
  const startIdx=isOpen()&&db.startedOn&&calendarWeek(db.plan.startDate,db.startedOn)===1?(new Date(db.startedOn+"T12:00:00").getDay()+6)%7:0;
  for(let w=1;w<=cw;w++)dayIds().forEach((d,i)=>{
    const total=totalSets(w,d);if(!total)return;
    const done=sessionDone(db.logs[logKey(w,d)],loggedSets(w,d),total);
    let due;
    if(isOpen())due=(w<cw||i<ti||done)&&!(w===1&&i<startIdx&&!done);   /* today counts only once it's finished */
    else due=done||w<cw;                           /* block plans have no calendar: earlier weeks are due */
    out.push({done,due,w,d});
  });
  /* block plans: within the latest week, a session is due once a later one has been logged */
  if(!isOpen()){let seen=false;for(let i=out.length-1;i>=0;i--){if(out[i].w!==cw)break;if(out[i].done)seen=true;else if(seen)out[i].due=true}}
  return out;
}
function weekStreak(){
  let n=0;const last=isOpen()?curWeek()-1:Math.max(1,maxLoggedWeek(db.logs));
  for(let w=last;w>=1;w--){if(weekComplete(w))n++;else if(isOpen()||w<last)break;}
  return n;
}
/* streaks including anything carried over a plan switch */
function sessionStreakNow(list){
  list=list||sessionList();const c=db.streakCarry;
  return carriedStreak(sessionStreak(list),c&&c.s,list.some(x=>x.due&&!x.done));
}
function weekStreakNow(){
  const base=weekStreak(),c=db.streakCarry;
  if(!c)return base;
  const cw=isOpen()?curWeek():Math.max(1,maxLoggedWeek(db.logs));
  const broken=sessionList().some(x=>x.w<cw&&x.due&&!x.done);   /* a missed session in a past week of the new plan ends the carry */
  return carriedStreak(base,c.w,broken);
}
function renderStreaks(){
  const el=$("streaks");if(!el)return;
  const list=sessionList();
  if(!list.some(x=>x.due)&&!db.streakCarry){el.innerHTML="";return}
  const ss=sessionStreakNow(list),ws=weekStreakNow(),ad=adherence(list);
  const flame='<svg viewBox="0 0 24 24" class="gico"><path d="M12 3c1 3.5 4.5 5 4.5 9.2A4.6 4.6 0 0 1 12 17a4.6 4.6 0 0 1-4.5-4.8C7.5 9 10 8.5 9.5 5.5 11 6.4 11.6 7.6 12 9c.6-1.6.4-3.5 0-6z"/></svg>';
  el.innerHTML=`<div class="streaks">
    <div class="stk ${ss>=3?"hot":""}"><b>${flame}${ss}</b><span>session streak</span></div>
    <div class="stk"><b>${ws}</b><span>week streak</span></div>
    <div class="stk"><b>${ad==null?"—":Math.round(ad*100)+"%"}</b><span>sessions kept</span></div></div>`;
}
function renderHome(){
  /* open plan: follow the calendar once a day, but let a manual week choice stand for the rest of that day */
  if(isOpen()&&db.autoWeekFor!==todayISO()){db.selWeek=curWeek();db.autoWeekFor=todayISO();save({quiet:true})}
  $("home-eyebrow").textContent=isOpen()?"Ongoing · Week "+curWeek():"Block "+db.block+" · "+WEEKS()+" Weeks";
  const nd=dayIds().length;
  $("brand-sub").textContent=`${db.programmeName||"Custom programme"} · ${nd} day${nd===1?"":"s"} a week · double progression`;
  homeCards();
  /* the wordmark earns its space once, then gets out of the way */
  const training=Object.keys(db.logs).length>0||db.archive.length>0;
  $("brand").classList.toggle("compact",training);
  if(db.selWeek>WEEKS()){db.selWeek=WEEKS();save()}
  renderHero();
  const wr=$("weekrow");wr.innerHTML="";
  const ws=weekWindow(db.selWeek);
  wr.style.gridTemplateColumns=`repeat(${ws.length},1fr)`;
  for(const w of ws){
    const c=document.createElement("button");c.className="weekcell";
    if(weekComplete(w))c.classList.add("done");
    if(w===db.selWeek)c.classList.add("sel");
    if(isOpen()&&w>curWeek())c.classList.add("future");
    if(isOpen()&&w===curWeek())c.classList.add("now");
    c.title="Week "+w+" · "+phaseLabel(w);
    c.setAttribute("aria-label","Week "+w+", "+phaseLabel(w)+(weekComplete(w)?", complete":""));
    c.setAttribute("aria-pressed",w===db.selWeek);
    c.innerHTML=`<div class="wnum">${w}</div><div class="wbar" style="background:${PHASE_COLOR[phaseOf(w)]}"></div>`;
    c.onclick=()=>{tap(6);db.selWeek=w;save();renderHome()};
    wr.appendChild(c);
  }
  const w=db.selWeek;
  const nl=isOpen()?nextLightWeek(db.plan,curWeek()):0;
  const canPostpone=isOpen()&&!weekHasLogs(nl)&&(w===curWeek()||(deloadWeek(w)&&w>=curWeek()));
  $("weekmeta").innerHTML=(isOpen()
      ?`Week ${w}${w===curWeek()?" · this week":w<curWeek()?" · past":" · upcoming"} · <b>${phaseLabel(w)}</b> · target <b>${rirOf(w)} RIR</b> · ${deloadWeek(w)?"same weights, fewer sets":rampWeek(w)?"about two-thirds of the sets while you settle in":"compounds "+wk(w).comp+" sets, accessories "+wk(w).acc}`
       +(!deloadWeek(w)?` · next light week <b>W${nextLightWeek(db.plan,w+1)}</b>`:"")
      :`Week ${w} of ${WEEKS()} · <b>${phaseOf(w)}</b> · target <b>${rirOf(w)} RIR</b> · compounds ${wk(w).comp} sets, accessories ${wk(w).acc}`)
    +(canPostpone?` <button class="pill ss" style="margin-left:6px;vertical-align:middle" onclick="postponeLight()">Postpone${deloadWeek(w)?"":" W"+nl}</button>`:"");
  const dl=$("daylist");dl.innerHTML="";
  for(const d of dayIds()){
    const total=totalSets(w,d),done=loggedSets(w,d);
    const card=document.createElement("button");card.className="daycard d"+d;
    let state="",cls="";
    const isToday=isOpen()&&w===curWeek()&&dayIds()[todayIdx()]===d;
    if(total===0)state="No lifts yet";
    else if(done>=total){state="Done ✓";cls="done"}
    else if(done>0){state=done+"/"+total+" sets";cls="part"}
    else if(isOpen()&&w<curWeek()){state="Missed";cls="missed"}
    else if(isToday){state="Today · "+total+" sets";cls="today"}
    else if(isOpen()&&w>curWeek())state="Upcoming · "+total+" sets";
    else state=total+" sets";
    const pct=total?Math.round(100*done/total):0;
    card.innerHTML=`<div class="dayrow"><div class="dayletter">${d}</div>
      <div class="dayinfo"><div class="dtitle">${esc(DAYS[d].title)}</div>
      <div class="dsub">${dayWeekday(d)?dayWeekday(d)+" · ":""}${DAYS[d].ex.length} exercises · ~${estMinutes(w,d)} min</div></div>
      <div class="daystate ${cls}">${state}</div></div>
      <div class="dayprog"><i class="${cls}" style="width:${pct}%"></i></div>`;
    card.onclick=()=>{tap(8);if(total===0){go("prog");return}shareTitle(card.querySelector(".dtitle"));done>=total?showDone(w,d):showPreview(w,d)};
    dl.appendChild(card);
  }
  animateRings();renderStreaks();
}
function postponeLight(){
  if(!isOpen())return;
  db.plan.lightOffset=(db.plan.lightOffset||0)+1;save();renderHome();
  toast("Light week moved to week "+nextLightWeek(db.plan,curWeek()));
}

/* ================= SESSION PREVIEW ================= */
let PV=null;
function showPreview(w,d){PV={w,d};show("preview")}
function renderPreview(){
  const {w,d}=PV;
  $("pv-title").textContent=(dayWeekday(d)?dayWeekday(d)+" · ":"")+"Day "+d+" · Week "+w;
  $("pv-sub").textContent=DAYS[d].title+" · "+phaseLabel(w);
  const total=totalSets(w,d),done=loggedSets(w,d);
  $("pv-stats").innerHTML=
    `<div class="pvstat"><div class="v">${DAYS[d].ex.length}</div><div class="k">Lifts</div></div>
     <div class="pvstat"><div class="v">${total}</div><div class="k">Sets</div></div>
     <div class="pvstat"><div class="v">~${estMinutes(w,d)}</div><div class="k">Min</div></div>
     <div class="pvstat"><div class="v">${rirOf(w)}</div><div class="k">RIR</div></div>`;
  renderTimebox(w,d);
  const L=(db.logs[logKey(w,d)]||{}).ex||{};
  let nextFound=false,html="";
  DAYS[d].ex.forEach((e,i)=>{
    const [,,isComp]=e,range=slotRange(w,d,i);
    const name=sessName(w,d,i);
    const skipped=isSkipped(w,d,i);
    const need=skipped?plannedSets(w,d,i):slotSets(w,d,i);
    const have=(L[i]||[]).filter(s=>s&&s.kg!=null).length;
    const isDone=!skipped&&have>=need;
    const isNext=!skipped&&!isDone&&!nextFound;
    if(isNext)nextFound=true;
    const hist=prevSession(w,d,i);
    const todaySets=(L[i]||[]).filter(s=>s&&s.kg!=null);
    const lastTxt=todaySets.length?fmtKg(Math.max(...todaySets.map(s=>s.kg)))+" kg today"
      :hist?"last "+fmtSet(hist.sets[0]):"find weight";
    const state=skipped?`<span class="rstate skip">SKIPPED</span>`
      :isDone?`<span class="rstate done">✓</span>`
      :have>0?`<span class="rstate part">${have}/${need}</span>`
      :`<span class="rstate">›</span>`;
    html+=`<button class="rstep${isDone?" done":""}${isNext?" next":""}${skipped?" skipped":""}${i===DAYS[d].ex.length-1?" last":""}"
      onclick="${skipped?`unskipSlot(${w},'${d}',${i})`:`openLift('${name.replace(/'/g,"\\'")}','preview')`}">
      <div class="rrail"><div class="rnode">${isDone?"✓":i+1}</div><div class="rline"></div></div>
      <div class="rbody"><div class="rinfo">
        ${isNext&&done>0?'<div class="nextlabel">Up next</div>':""}
        <div class="rname">${name}</div>
        <div class="rmeta"><span class="rdot" style="background:var(--plate-${isComp?"red":"blue"})"></span>${need} × ${range}${isTimed(name)?" s":""}${isUni(name)?"/side":""}${pairOf(DAYS[d].ex,i)>=0?" · ⇄ superset":""} · ${lastTxt}</div>
      </div>${state}</div></button>`;
  });
  $("pv-route").innerHTML=html;
  $("pv-start").textContent=done>0?`Continue — ${done}/${total} sets done →`:"Start session →";
  $("pv-move").style.display=done>0?"":"none";
}

function unskipHere(j){const {w,d}=S;unskipSlot(w,d,j);renderSet()}
/* ---------- time budget ---------- */
const TIME_BUDGETS=[30,45,60];
function renderTimebox(w,d){
  const skip=skipList(w,d),est=estMinutes(w,d);
  const full=!skip.length;
  const hasAcc=DAYS[d].ex.some((e,i)=>!e[2]&&!isSkipped(w,d,i));
  const budgets=TIME_BUDGETS.filter(b=>b<est||skip.length);
  if(!budgets.length&&full){$("pv-time").innerHTML="";return}
  $("pv-time").innerHTML=`<span class="tlabel">Short on time?</span><div class="libchips">
    <button class="libchip ${full?"sel":""}" onclick="setTimeBudget(${w},'${d}',0)">Full session</button>
    ${budgets.map(b=>`<button class="libchip" onclick="setTimeBudget(${w},'${d}',${b})">${b} min</button>`).join("")}</div>
    ${skip.length?`<div class="nnote" style="flex:1 1 100%;margin:0">${skip.length} lift${skip.length>1?"s":""} skipped for today · ~${est} min. Tap a skipped lift to bring it back.</div>`:""}`;
}
function setTimeBudget(w,d,budget){
  const k=logKey(w,d);
  if(!db.logs[k])db.logs[k]={date:todayISO(),ex:{}};
  const L=db.logs[k];
  delete L.skip;
  if(!budget){save();renderPreview();toast("Full session restored");return}
  const slots=DAYS[d].ex.map((e,i)=>({i,comp:!!e[2],min:slotMinutes(plannedSets(w,d,i),e[2]),
    locked:((L.ex[i])||[]).some(s=>s&&s.kg!=null)}));
  const r=trimForTime(slots,budget,6);
  if(!r.skip.length){save();renderPreview();toast("Nothing to trim — the compounds alone need ~"+Math.round(r.min/5)*5+" min");return}
  L.skip=r.skip;save();haptic("select");renderPreview();
  toast(`${r.skip.length} accessor${r.skip.length>1?"ies":"y"} skipped · ~${Math.round(r.min/5)*5} min${r.min>budget+2?" (compounds alone run over)":""}`);
}
function unskipSlot(w,d,i){
  const L=db.logs[logKey(w,d)];if(!L||!L.skip)return;
  L.skip=L.skip.filter(x=>x!==i);if(!L.skip.length)delete L.skip;
  save();haptic("select");if(document.querySelector(".screen.active").id==="scr-preview")renderPreview();toast(sessName(w,d,i)+" is back in");
}

/* ================= SESSION ================= */
function startSession(w,d){
  const k=logKey(w,d);
  if(!db.logs[k])db.logs[k]={date:todayISO(),ex:{}};
  let exIdx=0,setIdx=0,found=false;
  const exs=DAYS[d].ex;
  for(let i=0;i<exs.length&&!found;i++){
    const need=slotSets(w,d,i);
    const have=(db.logs[k].ex[i]||[]).filter(s=>s&&s.kg!=null).length;
    if(have<need){exIdx=i;setIdx=have;found=true}
  }
  if(!found){showDone(w,d,true);return}   /* everything logged: just show the summary */
  S={w,d,exIdx,setIdx};save();
  lockScreen();TON_SHOWN=0;LAST_EX=null;
  renderSet();show("session");
}
function exitSession(){if(restEnd>Date.now())endRest();pruneLog(logKey(S.w,S.d));S=null;unlockScreen();save();history.back()}
/* an entry with no sets, no today-only swap and no time skip is noise: drop it so it never reads as a logged week */
function pruneLog(k){const L=db.logs[k];if(L&&!hasSets(L)&&!L.once&&!L.skip&&!L.done)delete db.logs[k]}
function resumeSession(){
  const q=db.session;
  if(!q||!DAYS[q.d]){toast("That session is no longer in the plan");db.session=null;save();renderHome();return}
  const k=logKey(q.w,q.d);
  if(!db.logs[k])db.logs[k]={date:todayISO(),ex:{}};
  S={w:q.w,d:q.d,exIdx:Math.min(q.exIdx,DAYS[q.d].ex.length-1),setIdx:0};
  S.setIdx=Math.min(q.setIdx,firstOpenSet());
  lockScreen();TON_SHOWN=0;LAST_EX=null;renderSet();show("session");
  /* pick the rest clock back up if it was still running */
  if(db.rest&&db.rest.end>Date.now())
    startRest(Math.round((db.rest.end-Date.now())/1000),db.rest.label,db.rest.hint);
}

/* Most recent earlier data for the lift currently in this slot: current block
   first, then archived blocks newest-first (peak week preferred).
   Matches on the LIFT, not the slot — so swapping an exercise no longer makes
   the coach compare your hack squats against your back squats. */
function prevSession(w,d,exIdx){
  const target=sessName(w,d,exIdx);
  /* same slot first (the common case), then any slot on that day, then any other day —
     so a template switch or a reorder doesn't reset the coach to "first time on this lift" */
  const pick=(logs,pw,ctx)=>{
    const days=Object.keys(ctx.programme||{});
    for(const dd of [d,...days.filter(x=>x!==d)]){
      const L=logs[logKey(pw,dd)];if(!L||!L.ex)continue;
      const idxs=dd===d?[exIdx,...Object.keys(L.ex).map(Number).filter(i=>i!==exIdx)]:Object.keys(L.ex).map(Number);
      for(const i of idxs){
        const sets=(L.ex[i]||[]).filter(s=>s&&s.kg!=null);
        if(sets.length&&setName(sets[0],ctx,dd,i)===target)return sets;
      }
    }
    return null;
  };
  const cur=blockCtx();
  for(let pw=w-1;pw>=1;pw--){
    const sets=pick(db.logs,pw,cur);
    if(sets)return{w:pw,block:db.block,sets};
  }
  for(let a=db.archive.length-1;a>=0;a--){
    const B=db.archive[a];
    for(const pw of historyOrder(B.plan||DEFAULT_PLAN,B.logs)){
      const sets=pick(B.logs,pw,B);
      if(sets)return{w:pw,block:B.block,sets};
    }
  }
  return null;
}

/* ---------- progression coach ---------- */
const CO={
  up:'<svg viewBox="0 0 24 24" class="gico"><path d="M12 19.5V5M5.6 11.4 12 5l6.4 6.4"/></svg>',
  hold:'<svg viewBox="0 0 24 24" class="gico"><path d="M4.5 9h15M4.5 15h15"/></svg>',
  deload:'<svg viewBox="0 0 24 24" class="gico"><circle cx="12" cy="12" r="8.4"/><path d="M12 3.6a8.4 8.4 0 0 0 0 16.8z" fill="currentColor" stroke="none"/></svg>',
  fresh:'<svg viewBox="0 0 24 24" class="gico"><circle cx="12" cy="12" r="8.4"/><circle cx="12" cy="12" r="3.1"/></svg>'
};
function coachAdvice(w,d,exIdx){
  const [,,isComp]=DAYS[d].ex[exIdx],range=slotRange(w,d,exIdx);
  const name=sessName(w,d,exIdx);
  const hist=prevSession(w,d,exIdx);
  const timed=isTimed(name),unit=timed?"seconds":"reps",u=timed?" s":"";
  if(deloadWeek(w))return{cls:"hold",ico:CO.deload,txt:`<b>Deload.</b> Same weights as last week, fewer sets, ${rirOf(w)} RIR. Leave the gym feeling fresh.`};
  if(!hist)return{cls:"fresh",ico:CO.fresh,txt:`<b>First time on this lift.</b> Pick a weight you could do ~twice the reps with. Week 1 is for finding numbers, not testing them.`};
  const top=repTop(range),bottom=repBottom(range),reps=hist.sets.map(s=>s.reps);
  const ref=hist.block<db.block?`Block ${hist.block} wk ${hist.w}`:`Wk ${hist.w}`;
  const planned=slotSets(w,d,exIdx),cutShort=hist.sets.length<Math.min(2,planned);   /* one set logged last time proves nothing */
  if(!cutShort&&hitTop(reps,top,bottom)){
    const inc=increment(name);
    const newKg=hist.sets[0].kg+inc;
    return{cls:"",ico:CO.up,rec:newKg,recReps:bottom,
      txt:`<b>Add ${timed&&hist.sets[0].kg===0?"load":"weight"}: ${fmtKg(newKg)} kg.</b> ${reps.every(r=>r>=top)?"Top of the range on every set":"Top of the range on all but one set"} (${ref}). Drop back to ${bottom}${u} and build up again.`};
  }
  if(!cutShort&&underRange(reps,bottom)&&hist.sets[0].kg>0){
    const inc=increment(name),backKg=Math.max(inc,snapStep(hist.sets[0].kg*0.95,inc));
    return{cls:"hold",ico:CO.hold,rec:backKg,recReps:bottom,
      txt:`<b>Back off to ${fmtKg(backKg)} kg.</b> ${ref} most sets fell under ${bottom}${u} (${reps.map(r=>r+u).join(", ")}). About 5% lighter puts you back in the range where the reps do the work.`};
  }
  /* stuck at one weight for weeks: offer the reset instead of more of the same */
  if(!cutShort&&!timed&&!isAssisted(name)&&hist.block===db.block&&w>1){
    const WK=allWeekLifts(),n=stallStreak(name,w-1,WK,deloadWeek);
    let peak=null;for(let x=w-1;x>=1&&!peak;x--)if(!deloadWeek(x)){const m=WK[x]&&WK[x].get(name);if(m)peak=m.top}
    if(n>=2&&peak&&peak.kg>0&&Math.max(...hist.sets.map(s=>s.kg))>=peak.kg){   /* not when the last session already came in lighter */
      const r=resetKg(peak.kg,increment(name));
      return{cls:"hold",ico:CO.hold,rec:r,recReps:top,
        txt:`<b>Reset to ${fmtKg(r)} kg.</b> Stuck at ${fmtSet(peak)} for ${n} weeks. Take about 10% off, aim for ${top} reps, then build back up from there.`};
    }
  }
  return{cls:"hold",ico:CO.hold,txt:`<b>Same weight, chase ${unit}.</b> ${ref} you got ${reps.map(r=>r+u).join(", ")} — get to ${top}${u} on all but one set and it's time to add load.`};
}

function renderSet(){
  const {w,d,exIdx,setIdx}=S;
  const [,,isComp]=DAYS[d].ex[exIdx],reps=slotRange(w,d,exIdx);
  const name=sessName(w,d,exIdx);
  const nsets=slotSets(w,d,exIdx);
  $("ss-title").textContent=(dayWeekday(d)?dayWeekday(d)+" · ":"")+"Day "+d+" · Week "+w;
  $("ss-sub").textContent=DAYS[d].title+" · "+phaseLabel(w);
  $("ss-exnum").textContent="Exercise "+(exIdx+1)+" of "+DAYS[d].ex.length;
  $("ss-exname").textContent=name;
  const pair=pairOf(DAYS[d].ex,exIdx),uni=isUni(name),timed=isTimed(name);
  resetTimer();
  $("lbl-reps").textContent=timed?"Seconds":"Reps";
  $("ss-timer").style.display=timed?"":"none";
  $("ss-tags").innerHTML=`<span class="tag ${isComp?"comp":"acc"}">${isComp?"Compound":"Accessory"}</span>
    <span class="tag">${reps}${timed?" s":" reps"}${uni?" / side":""}</span><span class="tag">${rirOf(w)} RIR</span>`
    +(pair>=0?`<span class="tag ss">⇄ Superset · ${sessName(w,d,pair)}</span>`:"")
    +(onceName(w,d,exIdx)?`<span class="tag once">Today only</span>`:"");
  const ak=exIdx+"|"+name;S.adv=S.adv||{};
  const adv=S.adv[ak]||(S.adv[ak]=coachAdvice(w,d,exIdx));   /* once per lift per session: it walks the history */
  const co=$("ss-coach");co.className="coach "+adv.cls;
  $("ss-coachico").innerHTML=adv.ico;$("ss-coachtxt").innerHTML=adv.txt;
  $("ss-cuelist").innerHTML=((EXDB[name]&&EXDB[name].form)||["No cues stored for this variant — watch the video below before your first set."]).map(c=>"<li>"+c+"</li>").join("");
  $("ss-vid").href=ytLink(name);
  if(CUES_EX!==d+"-"+exIdx){$("ss-cues").open=false;CUES_EX=d+"-"+exIdx}   /* collapse only when the lift changes */
  const pips=$("ss-pips");pips.innerHTML="";
  for(let i=0;i<nsets;i++){const p=document.createElement("div");p.className="pip"+(i<setIdx?" done":i===setIdx?" cur":"");
    if(FX&&FX.ex===exIdx&&FX.pip===i)p.classList.add("just");pips.appendChild(p)}
  FX=null;
  $("ss-setlabel").textContent="Set "+(setIdx+1)+" of "+nsets+(uni?" · per side":"");
  /* the coach card slides in when the lift changes, not on every set */
  const exKey=d+"-"+exIdx;
  if(LAST_EX!==exKey){co.classList.remove("anim");void co.offsetWidth;co.classList.add("anim");LAST_EX=exKey}
  const L=db.logs[logKey(w,d)].ex[exIdx]||[];
  /* persistent "last set" row: tap to edit or delete without leaving the session */
  let li=-1;for(let i=L.length-1;i>=0;i--)if(L[i]&&L[i].kg!=null){li=i;break}
  const lr=$("ss-lastrow");
  if(li>=0){lr.style.display="flex";lr.innerHTML=`<span>Logged set ${li+1} · <b>${fmtSet(L[li])}</b></span><span class="act">Edit</span>`;
    lr.onclick=()=>openEdit(w,d,exIdx,li,"session")}
  else lr.style.display="none";
  const prevSet=setIdx>0?L[setIdx-1]:null;
  /* the set before came in under the range: offer a lighter one rather than the same again */
  const bottom=repBottom(reps);
  const drop=prevSet&&!timed&&!isAssisted(name)?dropOffKg(prevSet.kg,prevSet.reps,bottom,increment(name)):null;
  if(drop!=null){
    co.className="coach hold"+(co.classList.contains("anim")?" anim":"");$("ss-coachico").innerHTML=CO.hold;
    $("ss-coachtxt").innerHTML=`<b>Set ${setIdx} fell under ${bottom}.</b> ${fmtKg(drop)} kg for this one should put you back in the range. Stay at ${fmtKg(prevSet.kg)} if that set was a one-off.`;
  }
  const hist=prevSession(w,d,exIdx);
  let lastTxt="First time — start light";
  if(hist){const ref=hist.block<db.block?"B"+hist.block+" wk"+hist.w:"Wk "+hist.w;
    lastTxt=`${ref}: <b>${hist.sets.map(x=>fmtSet(x,true)).join(", ")}</b>`}
  $("ss-last").innerHTML=lastTxt;
  /* seed priority: earlier set today > coach's add-weight recommendation > last session */
  const seed=prevSet||(hist?hist.sets[Math.min(setIdx,hist.sets.length-1)]:null);
  $("in-kg").value=drop!=null?drop:prevSet?prevSet.kg:(adv.rec!=null?adv.rec:(seed?seed.kg:""));
  $("in-reps").value=drop!=null?bottom:prevSet?prevSet.reps:(adv.rec!=null?adv.recReps:(seed?seed.reps:""));
  const note=db.notes&&db.notes[name];
  $("ss-note").style.display=note?"block":"none";
  if(note)$("ss-note").innerHTML='<svg viewBox="0 0 24 24" class="gico"><path d="M4.5 5.5h15M4.5 10h15M4.5 14.5h9"/></svg> '+esc(note);
  $("ss-prog").style.width=Math.round(100*loggedSets(w,d)/totalSets(w,d))+"%";
  $("ss-setcount").textContent=loggedSets(w,d)+"/"+totalSets(w,d)+" sets";
  tickTon(sessionTonnage(w,d));
  $("ss-upnext").innerHTML=DAYS[d].ex.map((e2,j)=>{
    const need2=slotSets(w,d,j);
    const have2=((db.logs[logKey(w,d)].ex[j])||[]).filter(s=>s&&s.kg!=null).length;
    const st=isSkipped(w,d,j)?"skip":have2>=need2?"done":j===exIdx?"cur":"";
    const link=j>0&&exOpt(DAYS[d].ex[j-1],"ss")?"⇄ ":"";
    return `<button class="upchip ${st}" onclick="${st==="done"?"editLift("+j+")":st==="skip"?"unskipHere("+j+")":"jumpTo("+j+")"}" aria-label="${st==="done"?"Edit sets for ":st==="skip"?"Skipped for time, tap to add back: ":""}${sessName(w,d,j)}">${st==="done"?"✓ ":(j+1)+". "}${link}${sessName(w,d,j)}</button>`;
  }).join("");
  {const c=$("ss-upnext"),cur=c.querySelector(".upchip.cur");if(cur)c.scrollLeft=Math.max(0,cur.offsetLeft-c.clientWidth/2+cur.offsetWidth/2)}   /* keep the current lift in view */
  renderPlates();
  renderWarmup();
  measureDock();
}
let LAST_EX=null,FX=null,TON_SHOWN=0;
/* ---------- stopwatch for timed lifts ---------- */
let TIMER=null;
function toggleTimer(){if(TIMER)stopTimer();else startTimer()}
function startTimer(){
  TIMER={t0:Date.now(),h:setInterval(()=>{$("in-reps").value=Math.round((Date.now()-TIMER.t0)/1000)},200)};
  $("in-reps").value=0;$("ss-timer").textContent="■ Stop";$("ss-timer").classList.add("running");haptic("log");
}
function stopTimer(){
  if(!TIMER)return;clearInterval(TIMER.h);
  $("in-reps").value=Math.max(1,Math.round((Date.now()-TIMER.t0)/1000));
  TIMER=null;$("ss-timer").textContent="⏱ Start";$("ss-timer").classList.remove("running");haptic("log");
}
function resetTimer(){if(TIMER){clearInterval(TIMER.h);TIMER=null}const b=$("ss-timer");if(b){b.textContent="⏱ Start";b.classList.remove("running")}}
/* the dock is fixed, so the page needs exactly its height as bottom padding */
function measureDock(){requestAnimationFrame(()=>{const d=$("setdock");if(d)document.documentElement.style.setProperty("--dock-h",d.offsetHeight+"px")})}
addEventListener("resize",measureDock);
/* session tonnage counts up rather than jumping */
let TON_RAF=0;
function tickTon(to){
  const el=$("ss-ton"),from=TON_SHOWN;if(from===to){el.textContent=to.toLocaleString();return}
  cancelAnimationFrame(TON_RAF);
  const t0=performance.now(),dur=reduceMotion()?0:520;
  const step=t=>{const p=dur?Math.min(1,(t-t0)/dur):1,e=1-Math.pow(1-p,3);
    el.textContent=Math.round(from+(to-from)*e).toLocaleString();
    if(p<1)TON_RAF=requestAnimationFrame(step);else TON_SHOWN=to};
  TON_RAF=requestAnimationFrame(step);
}
let CUES_EX=null;
function jumpTo(i){S.exIdx=i;S.setIdx=firstOpenSet();renderSet();save()}
/* a finished lift in the session map: pick one of its sets to change or delete */
function editLift(j){
  const {w,d}=S;const arr=db.logs[logKey(w,d)].ex[j]||[];
  const opts=arr.map((s,si)=>s&&s.kg!=null?{label:`Set ${si+1} · ${fmtSet(s)}`,value:si}:null).filter(Boolean);
  if(!opts.length){jumpTo(j);return}
  opts.push({label:"+ Log another set",value:"more"});
  chooseSheet(sessName(w,d,j),"Tap a set to change or delete it, or add one beyond the plan.",opts,si=>{
    if(si==="more"){S.exIdx=j;S.setIdx=arr.filter(s=>s&&s.kg!=null).length;renderSet();save();return}
    openEdit(w,d,j,si,"session")});
}
async function endEarly(){
  const {w,d}=S;
  const left=totalSets(w,d)-loggedSets(w,d);
  if(await ask({title:"Finish this session?",
    body:"<b>"+left+" set"+(left===1?"":"s")+"</b> will stay unlogged. You can come back to them any time this week.",
    ok:"Finish"}))showDone(w,d);
}

/* ---------- warm-up ramp (first exercise, first set only) ---------- */
function renderWarmup(){
  const box=$("ss-warmup");
  if(!S||S.setIdx!==0||!(S.exIdx===0||DAYS[S.d].ex[S.exIdx][2])){box.style.display="none";return}   /* first set of the day, or of any compound */
  const kg=parseFloat($("in-kg").value);
  if(isNaN(kg)||kg<=0){box.style.display="none";return}
  const name=sessName(S.w,S.d,S.exIdx);
  const isBar=isBarbellLift(name),bar=db.settings.bar;
  const round=v=>Math.max(isBar?bar:2.5,Math.round(v/2.5)*2.5);
  const steps=isBar
    ?[["Empty bar ×10",bar],["50% ×5",round(kg*0.5)],["75% ×3",round(kg*0.75)]]
    :[["~50% ×10",round(kg*0.5)],["~75% ×5",round(kg*0.75)]];
  $("ss-warmupbody").innerHTML="<ul>"+steps.map(([l,v])=>`<li>${l} — <b style="color:var(--ink)">${v} kg</b></li>`).join("")
    +`</ul><div style="margin-top:8px;font-size:.78rem;color:var(--ink-faint)">Then straight into working sets. Warm-up sets aren't logged.</div>`;
  box.style.display="block";
}

/* ---------- plate calculator ---------- */
function renderPlates(){
  const bar=$("platebar");
  if(!S){bar.textContent="";return}
  const name=sessName(S.w,S.d,S.exIdx);
  if(!isBarbellLift(name)){bar.textContent="";return}
  const kg=parseFloat($("in-kg").value)||0,barKg=db.settings.bar;
  const r=plateBreakdown(kg,barKg,db.settings.plates);
  const avail=[...db.settings.plates].sort((a,b)=>b-a);
  const addRow=avail.map(p=>`<button class="pchip add" onclick="addPlate(${p})" aria-label="Add a ${p} kg plate each side">+${p}</button>`).join("");
  let head;
  if(kg<barKg)head=kg?`Below bar weight (${barKg} kg) · tap a plate to load`:`Tap plates to load the ${barKg} kg bar`;
  else if(!r.ok)head=`No clean load for ${fmtKg(kg)} kg — nearest <b>${fmtKg(r.nearest)} kg</b>`;
  else head=r.perSide.length?`Per side · ${barKg} kg bar · tap a plate to take it off`:`Empty bar (${barKg} kg)`;
  const loaded=(kg>=barKg?r.perSide:[]).map((p,i)=>`<button class="pchip" data-p="${p}" onclick="removePlate(${i})" aria-label="Remove the ${p} kg plate">${p}</button>`).join("");
  bar.innerHTML=`${head}<div class="plates">${loaded}${loaded?`<span class="pdiv"></span>`:""}${addRow}</div>`;
  measureDock();
}
/* one plate on each side */
function addPlate(p){
  const el=$("in-kg"),barKg=db.settings.bar;
  let kg=parseFloat(el.value)||0;if(kg<barKg)kg=barKg;
  el.value=fmtKg(kg+2*p);haptic("select");renderPlates();renderWarmup();
}
function removePlate(i){
  const el=$("in-kg"),barKg=db.settings.bar;
  const r=plateBreakdown(parseFloat(el.value)||0,barKg,db.settings.plates);
  const p=r.perSide[i];if(p==null)return;
  el.value=fmtKg(Math.max(barKg,(parseFloat(el.value)||0)-2*p));haptic("select");renderPlates();renderWarmup();
}

function bump(f,dir){
  const el=f==="kg"?$("in-kg"):$("in-reps");
  const step=f==="kg"?increment(sessName(S.w,S.d,S.exIdx)):1;
  let v=parseFloat(el.value)||0;
  if(f==="kg"&&!v&&dir>0&&isBarbellLift(sessName(S.w,S.d,S.exIdx)))v=db.settings.bar;   /* + on an empty barbell lift starts at the bar */
  else v=stepValue(v,step,dir);
  el.value=f==="kg"?fmtKg(v):Math.round(v);
  haptic("select");
  if(f==="kg"){renderPlates();renderWarmup()}
  if(restEnd>Date.now())restTarget();   /* peeking at the rest bar while adjusting: keep the readout honest */
}
/* edit-set sheet steppers: the lift's own increment, kept to two decimals */
function edBump(f,dir){
  if(!ED)return;
  const el=$(f==="kg"?"in-ed-kg":"in-ed-reps");
  const step=f==="kg"?increment(sessName(ED.w,ED.d,ED.ex)):1;
  const v=stepValue(parseFloat(el.value)||0,step,dir);
  el.value=f==="kg"?fmtKg(v):Math.round(v);
}

function logSet(){
  if(TIMER)stopTimer();
  let kg=parseFloat($("in-kg").value);const reps=parseInt($("in-reps").value);
  const {w,d,exIdx,setIdx}=S;
  const name=sessName(w,d,exIdx);
  const timed=isTimed(name);
  if(isNaN(kg)&&EXDB[name]&&EXDB[name].eq==="Bodyweight")kg=0;   /* push-ups, planks, hangs: no weight to type */
  if(isNaN(kg)||isNaN(reps)||reps<=0){haptic("error");toast(timed?"Enter weight and seconds":"Enter weight and reps");return}
  const k=logKey(w,d);
  const prevBest=liftStats(name,k);   /* best before today's session */
  if(!hasSets(db.logs[k]))db.logs[k].date=todayISO();   /* the session's date is the day of its first set, not when Start was tapped */
  if(!db.logs[k].ex[exIdx])db.logs[k].ex[exIdx]=[];
  const set={kg,reps,t:Date.now(),name};
  if(isUni(name))set.uni=1;   /* stamped so history stays honest if the flag changes later */
  if(timed)set.timed=1;
  db.logs[k].ex[exIdx][setIdx]=set;
  const pos={w,d,exIdx,setIdx};
  const isPR=!!prevBest&&betterSet(set,prevBest.best);
  FX={ex:exIdx,pip:setIdx};
  const b=$("logbtn");b.classList.add("pressed");setTimeout(()=>b.classList.remove("pressed"),140);
  if(isPR){haptic("pr");const f=$("prflash");f.classList.remove("go");void f.offsetWidth;f.classList.add("go")}
  else haptic("log");
  const e1=!isPR&&prevBest&&!timed&&setScore(set)>prevBest.bestE.e+0.05;   /* a rep PR at a lighter weight still beats your best estimated 1RM */
  toast((isPR?"🏆 New PR — ":e1?"🏆 Best e1RM — ":"Logged ")+fmtSet(set),"Undo",()=>undoSet(pos));
  advance(true);   /* advance saves once for both */
}
function undoSet(pos){
  endRest();
  const arr=db.logs[logKey(pos.w,pos.d)].ex[pos.exIdx];
  if(arr){arr[pos.setIdx]=null;while(arr.length&&!arr[arr.length-1])arr.pop()}
  save();
  S={w:pos.w,d:pos.d,exIdx:pos.exIdx,setIdx:pos.setIdx};
  renderSet();save();
  if(document.querySelector(".screen.active").id!=="scr-session")show("session");
}
function skipExercise(){
  const {w,d,exIdx}=S;
  const open=j=>(db.logs[logKey(w,d)].ex[j]||[]).filter(s=>s&&s.kg!=null).length;
  let j=exIdx+1;while(j<DAYS[d].ex.length&&open(j)>=slotSets(w,d,j))j++;   /* past finished and time-skipped slots */
  if(j<DAYS[d].ex.length){S.exIdx=j;S.setIdx=open(j);renderSet();save();toast("Skipped "+sessName(w,d,exIdx))}
  else endEarly();   /* nothing left after this lift: finishing is a decision, not a side effect */
}
function firstOpenSet(){
  const {w,d,exIdx}=S;
  return (db.logs[logKey(w,d)].ex[exIdx]||[]).filter(s=>s&&s.kg!=null).length;
}
/* Where the session goes after a logged set. Paired (superset) slots alternate:
   first set 1 → short rest → second set 1 → full rest → first set 2 … until
   both are done, then on to the next slot. Returns null when the day is over. */
function nextTarget(){
  const {w,d,exIdx,setIdx}=S,exs=DAYS[d].ex;
  const open=j=>(db.logs[logKey(w,d)].ex[j]||[]).filter(s=>s&&s.kg!=null).length;
  const pair=pairOf(exs,exIdx);
  let after;
  if(pair>=0){
    const first=Math.min(pair,exIdx),second=Math.max(pair,exIdx);
    for(const j of [pair,exIdx]){
      if(open(j)<slotSets(w,d,j))
        return{exIdx:j,setIdx:open(j),rest:(exIdx===first&&j===second)?db.settings.rest.super:restSecs(w,d,exIdx)};
    }
    after=second+1;
  }else{
    if(setIdx+1<slotSets(w,d,exIdx))return{exIdx,setIdx:setIdx+1,rest:restSecs(w,d,exIdx)};
    after=exIdx+1;
  }
  while(after<exs.length&&open(after)>=slotSets(w,d,after))after++;   /* skipped for time, or already finished */
  if(after<exs.length)return{exIdx:after,setIdx:open(after),rest:restSecs(w,d,exIdx)};
  return null;
}
function advance(withRest){
  const {w,d,exIdx}=S;
  const nx=nextTarget();
  if(!nx){showDone(w,d);return}
  const nextLabel=nx.exIdx===exIdx?"Next: set "+(nx.setIdx+1)+" — "+sessName(w,d,exIdx):"Next: "+sessName(w,d,nx.exIdx);
  const hint=restHint(nx);
  S.exIdx=nx.exIdx;S.setIdx=nx.setIdx;
  renderSet();save();
  if(withRest&&nx.rest>0)startRest(nx.rest,nextLabel,hint);   /* after renderSet: the veil reads the prefilled target */
}
/* what to load while resting: today's previous set on that lift, else last session's */
function restHint(nx){
  const {w,d}=S;
  const L=db.logs[logKey(w,d)].ex[nx.exIdx]||[];
  const prev=nx.setIdx>0?L[nx.setIdx-1]:null;
  if(prev)return `Last set <b>${fmtSet(prev)}</b>`;
  const h=prevSession(w,d,nx.exIdx);
  if(h)return `Last time <b>${fmtSet(h.sets[0])}</b> — load up while you rest`;
  return "";
}

/* ---------- numeric pad (replaces the system keyboard in the session) ---------- */
let PAD=null;
function openPad(f){
  if(!S)return;
  const el=$(f==="kg"?"in-kg":"in-reps");
  PAD={f,val:String(el.value||""),fresh:true};
  $("pad-label").textContent=f==="kg"?"Weight kg":(isTimed(sessName(S.w,S.d,S.exIdx))?"Seconds":"Reps");
  $("pad-dot").style.visibility=f==="kg"?"visible":"hidden";
  const {w,d,exIdx,setIdx}=S,name=sessName(w,d,exIdx);
  const L=db.logs[logKey(w,d)].ex[exIdx]||[],prev=setIdx>0?L[setIdx-1]:null,hist=prevSession(w,d,exIdx);
  const ref=prev||(hist?hist.sets[Math.min(setIdx,hist.sets.length-1)]:null);
  const q=[];
  if(f==="kg"){
    if(ref)q.push([`${prev?"Same as last set":"Last time"} · ${fmtKg(ref.kg)}`,ref.kg]);
    if(isBarbellLift(name))q.push([`Empty bar · ${fmtKg(db.settings.bar)}`,db.settings.bar]);
  }else{
    if(ref)q.push([`${prev?"Same as last set":"Last time"} · ${ref.reps}`,ref.reps]);
    const range=slotRange(w,d,exIdx);   /* the slot's effective range, not the raw programme entry */
    q.push([`Top of range · ${repTop(range)}`,repTop(range)]);
  }
  $("pad-quick").innerHTML=q.map(([l,v])=>`<button onclick="padSet(${v})">${l}</button>`).join("");
  padRender();
  $("padsheet").classList.add("active");tap(6);
}
function padRender(){$("pad-val").textContent=PAD.val===""?"0":PAD.val}
function padApply(){
  const el=$(PAD.f==="kg"?"in-kg":"in-reps");
  el.value=PAD.val;
  if(PAD.f==="kg"){renderPlates();renderWarmup()}
}
function padKey(k){
  if(!PAD)return;haptic("select");
  if(k==="del"){PAD.val=PAD.fresh?"":PAD.val.slice(0,-1);PAD.fresh=false}
  else if(k==="."){if(PAD.f!=="kg")return;if(PAD.fresh||PAD.val==="")PAD.val="0";if(!PAD.val.includes("."))PAD.val+=".";PAD.fresh=false}
  else{
    if(PAD.fresh){PAD.val="";PAD.fresh=false}
    if(PAD.val.replace(".","").length>=5)return;
    if(PAD.val==="0")PAD.val="";
    PAD.val+=k;
  }
  padRender();padApply();
}
function padSet(v){if(!PAD)return;PAD.val=String(v);PAD.fresh=true;padRender();padApply();haptic("select")}
function closePad(){
  if(PAD){const n=parseFloat(PAD.val);const el=$(PAD.f==="kg"?"in-kg":"in-reps");
    el.value=isNaN(n)?"":(PAD.f==="kg"?fmtKg(n):Math.round(n));padApply();PAD=null;if(restEnd>Date.now())restTarget()}
  $("padsheet").classList.remove("active");measureDock();
}

/* ---------- generic chooser sheet ---------- */
let CHOOSE=null;
function chooseSheet(title,hint,options,cb){
  CHOOSE=cb;
  $("ch-title").textContent=title;$("ch-hint").textContent=hint||"";
  $("ch-list").innerHTML=options.map((o,i)=>`<button class="subopt" onclick="pickChoice(${i})">${o.label}</button>`).join("");
  $("ch-list")._opts=options;
  $("choosesheet").classList.add("active");tap(6);
}
function pickChoice(i){const o=$("ch-list")._opts[i];const cb=CHOOSE;closeChoose();if(cb)cb(o.value)}
let CHOOSE_DISMISS=null;
/* chooseSheet as a promise: resolves the chosen value, or null if the sheet is dismissed */
function chooseAsync(title,hint,opts){return new Promise(res=>{CHOOSE_DISMISS=()=>res(null);chooseSheet(title,hint,opts,v=>{CHOOSE_DISMISS=null;res(v)})})}
function closeChoose(){if(CHOOSE_DISMISS){const f=CHOOSE_DISMISS;CHOOSE_DISMISS=null;f()}CHOOSE=null;$("choosesheet").classList.remove("active")}

/* ---------- gestures ---------- */
function onSwipe(el,fn){
  let x0=0,y0=0,t0=0;
  el.addEventListener("touchstart",e=>{const t=e.touches[0];x0=t.clientX;y0=t.clientY;t0=Date.now()},{passive:true});
  el.addEventListener("touchend",e=>{const t=e.changedTouches[0],dx=t.clientX-x0,dy=t.clientY-y0;
    if(x0<32||x0>innerWidth-32)return;   /* edge swipes belong to the system back gesture */
    if(Date.now()-t0<600&&Math.abs(dx)>70&&Math.abs(dy)<45)fn(dx<0?1:-1)},{passive:true});
}
/* long-press on any descendant matching `selector`; the follow-up click is swallowed */
function onLongPress(container,selector,fn){
  let timer=null,target=null,x0=0,y0=0;
  const cancel=()=>{if(timer){clearTimeout(timer);timer=null}};
  container.addEventListener("pointerdown",e=>{target=e.target.closest(selector);if(!target)return;x0=e.clientX;y0=e.clientY;
    timer=setTimeout(()=>{timer=null;haptic("log");target.dataset.lp="1";fn(target)},480)});
  container.addEventListener("pointermove",e=>{if(Math.hypot(e.clientX-x0,e.clientY-y0)>8)cancel()});   /* finger jitter must not cancel the hold */
  container.addEventListener("pointerup",cancel);
  container.addEventListener("pointercancel",cancel);
  container.addEventListener("click",e=>{const t=e.target.closest(selector);if(t&&t.dataset.lp){delete t.dataset.lp;e.stopPropagation();e.preventDefault()}},true);
  container.addEventListener("contextmenu",e=>{if(e.target.closest(selector))e.preventDefault()});
}

/* ================= SWAP ================= */
let SWAP_MODE="once";
function openSwap(){SWAP_MODE="once";renderSwap();$("swapsheet").classList.add("active")}
function setSwapMode(m){SWAP_MODE=m;haptic("select");renderSwap()}
function renderSwap(){
  const {w,d,exIdx}=S;
  const orig=DAYS[d].ex[exIdx][0],planned=exName(d,exIdx),cur=sessName(w,d,exIdx);
  $("swap-once").classList.toggle("sel",SWAP_MODE==="once");$("swap-perm").classList.toggle("sel",SWAP_MODE==="perm");
  const q=s=>s.replace(/'/g,"\\'");
  const meta=n=>{const e=EXDB[n];return e?`<span class="pemeta" style="flex-shrink:0">${e.eq} · ${e.pri.map(m=>MUSCLE_NAMES[m]).join(", ")}</span>`:""};
  const mark=SWAP_MODE==="once"?cur:planned;
  const row=(n,fn,note)=>`<button class="subopt bulkrow ${n===mark?"current":""}" onclick="${fn}('${q(n)}')"><span style="flex:1;min-width:0">${n}${note?` <span style='color:var(--ink-faint);font-weight:400'>${note}</span>`:""}</span>${meta(n)}</button>`;
  let html;
  if(SWAP_MODE==="once"){
    $("swap-hint").textContent="Machine busy? Pick something that works the same muscles for this session only. Your plan and progression on "+planned+" are untouched.";
    html=row(planned,"doSwapOnce","(planned)")+sameMuscleLifts(EXDB,planned,SUBS).map(n=>row(n,"doSwapOnce")).join("");
  }else{
    $("swap-hint").textContent="Same movement pattern and muscles, different tool. The swap sticks until you change it back, so your progression stays comparable.";
    html=[orig,...similarLifts(orig)].map(o=>row(o,"doSwap",o===orig?"(programme default)":"")).join("");
  }
  $("swaplist").innerHTML=html;
}
function doSwapOnce(name){
  const {w,d,exIdx}=S,k=logKey(w,d);
  if(!db.logs[k])db.logs[k]={date:todayISO(),ex:{}};
  const L=db.logs[k];if(!L.once)L.once={};
  if(name===exName(d,exIdx))delete L.once[exIdx];else L.once[exIdx]=name;
  if(!Object.keys(L.once).length)delete L.once;
  save();closeSwap();renderSet();
  toast(L.once&&L.once[exIdx]?name+" for today only":"Back to "+exName(d,exIdx));
}
function doSwap(name){
  const {w,d,exIdx}=S;
  const orig=DAYS[d].ex[exIdx][0];
  if(!db.swaps)db.swaps={};
  const before=exName(d,exIdx);
  if(name===orig)delete db.swaps[d+"-"+exIdx];
  else db.swaps[d+"-"+exIdx]=name;
  if(isTimed(name)!==isTimed(before))DAYS[d].ex[exIdx][1]=isTimed(name)?"30–45":"10–15";   /* seconds ↔ reps: give the slot a range that makes sense and can be edited */
  const L=db.logs[logKey(w,d)];if(L&&L.once){delete L.once[exIdx];if(!Object.keys(L.once).length)delete L.once}
  save();closeSwap();renderSet();
  toast(name===orig?"Back to default":"Swapped to "+name);
}
function closeSwap(){$("swapsheet").classList.remove("active")}

/* Curated swaps first, then anything else in the same group with the same
   movement pattern — so every slot has options, not just the default programme's */
function similarLifts(name){
  const e=EXDB[name];
  const same=e?Object.keys(EXDB).filter(n=>n!==name&&EXDB[n].g===e.g&&EXDB[n].pat===e.pat&&EXDB[n].pri.some(m=>e.pri.includes(m))):[];   /* a lateral raise must not offer a rear-delt fly */
  return [...new Set([...(SUBS[name]||[]),...same])].filter(n=>EXDB[n]);
}
/* ================= LIFT LIBRARY ================= */
const LIB={q:"",grp:"All",eq:"All",current:null,src:"lib"};
const EQUIPMENT=["Barbell","Dumbbell","Cable","Machine","Smith","EZ-Bar","Bodyweight"];
function planDays(name){
  const days=[];
  for(const d of dayIds())DAYS[d].ex.forEach((e,i)=>{if(exName(d,i)===name&&!days.includes(d))days.push(d)});
  return days;
}
function renderLib(){
  $("libchips").innerHTML=["All",...GROUPS].map(g=>
    `<button class="libchip ${g===LIB.grp?"sel":""}" aria-pressed="${g===LIB.grp}" onclick="LIB.grp='${g.replace(/&/g,"&amp;")}';renderLib()">${g}</button>`).join("");
  $("libeq").innerHTML=["All",...EQUIPMENT].map(g=>
    `<button class="libchip eq ${g===LIB.eq?"sel":""}" aria-pressed="${g===LIB.eq}" onclick="LIB.eq='${g}';renderLib()">${g}</button>`).join("");
  const q=LIB.q.trim().toLowerCase();
  let html="";
  for(const g of GROUPS){
    if(LIB.grp!=="All"&&LIB.grp!==g)continue;
    const words=q.split(/\s+/).filter(Boolean);
    const items=Object.entries(EXDB).filter(([,e])=>e.g===g).filter(([,e])=>LIB.eq==="All"||e.eq===LIB.eq).filter(([n,e])=>{
      if(!words.length)return true;
      const hay=(n+" "+e.eq+" "+e.pat+" "+g+" "+[...e.pri,...e.sec].map(m=>MUSCLE_NAMES[m]).join(" ")).toLowerCase();
      return words.every(t=>hay.includes(t));   /* "incline dumbbell" finds Incline Dumbbell Press */
    });
    if(!items.length)continue;
    html+=`<div class="sectlabel">${g}</div>`;
    for(const [n,e] of items){
      const days=planDays(n);
      html+=`<button class="librow" data-name="${esc(n)}" onclick="openLift('${n.replace(/'/g,"\\'")}','lib')">
        <div class="linfo"><div class="lname">${n}</div>
        <div class="lmeta">${e.pri.map(m=>MUSCLE_NAMES[m]).slice(0,2).join(", ")} · ${e.eq}</div></div>
        ${days.length?`<span class="daybadge">${days.join("·")}</span>`:""}<svg viewBox="0 0 24 24" class="chev"><path d="M9.6 5.4 16.2 12l-6.6 6.6"/></svg></button>`;
    }
  }
  $("liblist").innerHTML=html||`<div class="emptymsg">No ${LIB.eq==="All"?"":LIB.eq.toLowerCase()+" "}lifts match${LIB.q?` "${esc(LIB.q)}"`:""}.<br>Try a muscle — "hamstrings", "rear delts", "abs"…</div>`;
  $("lib-sub").textContent=Object.keys(EXDB).length+" lifts · every movement in the plan and its swaps";
}
function openLift(name,src){
  const e=EXDB[name];
  if(!e){toast("No guide for this lift yet");return}
  LIB.current=name;LIB.src=src||"lib";
  $("lift-name").textContent=name;
  $("lift-sub").textContent=e.g+" · "+e.pat;
  const days=planDays(name);
  $("lift-tags").innerHTML=`<span class="tag comp">${e.pat}</span><span class="tag">${e.eq}</span>`
    +(days.length?`<span class="tag" style="color:var(--plate-green)">In plan · Day ${days.join(", ")}</span>`
                 :`<span class="tag">Swap option</span>`);
  /* muscle diagram: mark the regions, then face whichever side carries the primaries */
  document.querySelectorAll(".anat .mus").forEach(m=>m.classList.remove("pri","sec"));
  const mark=(keys,cls)=>keys.forEach(k=>(MUSCLE_MAP[k]||[]).forEach(id=>{
    const el=$(id);if(el&&!(cls==="sec"&&el.classList.contains("pri")))el.classList.add(cls)}));
  mark(e.pri,"pri");mark(e.sec,"sec");
  const ids=e.pri.flatMap(k=>MUSCLE_MAP[k]||[]);
  const backCount=ids.filter(id=>id.startsWith("m-bk")).length,frontCount=ids.length-backCount;
  anatTurn(backCount>frontCount?180:0,true);
  $("lift-muscles").innerHTML=
    e.pri.map(m=>`<span class="mchip pri">${MUSCLE_NAMES[m]}</span>`).join("")
    +e.sec.map(m=>`<span class="mchip">${MUSCLE_NAMES[m]}</span>`).join("");
  $("lift-about").textContent=e.about;
  $("lift-form").innerHTML=e.form.map(c=>"<li>"+c+"</li>").join("");
  $("lift-vid").href=ytLink(name);
  const st=liftStats(name);
  $("lift-stats").style.display=st?"grid":"none";
  if(st){$("lift-best").textContent=fmtSet(st.best);$("lift-setcount").textContent=st.count}
  $("lift-hist").innerHTML=liftHistHTML(name);
  $("lift-notes").value=(db.notes&&db.notes[name])||"";
  renderLiftSettings(name);
  const sim=similarLifts(name);
  $("lift-similar").innerHTML=sim.length?sim.map(n=>`<button class="librow" onclick="openLift('${n.replace(/'/g,"\\'")}','lift')">
      <div class="linfo"><div class="lname">${n}</div><div class="lmeta">${EXDB[n].pri.map(m=>MUSCLE_NAMES[m]).slice(0,2).join(", ")} · ${EXDB[n].eq}</div></div>
      <svg viewBox="0 0 24 24" class="chev"><path d="M9.6 5.4 16.2 12l-6.6 6.6"/></svg></button>`).join("")
    :`<div class="hsets" style="padding:6px 4px;color:var(--ink-faint)">Nothing else in the library shares this pattern.</div>`;
  show("lift");
}
/* ---------- recent sessions of one lift, newest first, across every block ---------- */
function liftHistory(name,n){
  const out=[];
  allBlocks().forEach((B,bi)=>{
    const cur=B.logs===db.logs;
    for(const [key,L] of Object.entries(B.logs||{})){
      const [w,d]=key.split("-");
      for(const [i,arr] of Object.entries(L.ex||{})){
        const sets=(arr||[]).filter(s=>s&&s.kg!=null&&setName(s,B,d,i)===name);
        if(!sets.length)continue;
        out.push({w:+w,d,key,bi,cur,block:B.block,date:sessionDate(L)||"",t:Math.max(...sets.map(s=>s.t||0)),sets,e:Math.max(...sets.map(setScore))});
      }
    }
  });
  return out.sort((a,b)=>b.date.localeCompare(a.date)||b.t-a.t).slice(0,n);
}
function liftHistHTML(name){
  const H=liftHistory(name,6);LIB.hist=H;
  if(!H.length)return "";
  const timed=!!H[0].sets[0].timed,unit=timed?"":" kg";
  const tap=!S;   /* mid-session, opening another day's summary could hijack the live one */
  return `<div class="sectlabel">Recent sessions</div>`+H.map((h,k)=>{
    const prev=H[k+1],dl=prev?Math.round((h.e-prev.e)*10)/10:null;
    const when=h.date?new Date(h.date+"T12:00:00").toLocaleDateString(undefined,{weekday:"short",day:"numeric",month:"short"}):"—";
    const delta=dl==null?(timed?"score":"e1RM"):dl>0?`▲ +${dl}${unit}`:dl<0?`▼ ${dl}${unit}`:"● same";
    return `<${tap?"button":"div"} class="recrow"${tap?` onclick="openSession(LIB.hist[${k}],'lift')"`:""}>
      <div class="rinfo2"><div class="rn">${when} <span class="lhmeta">Wk ${h.w} · Day ${h.d}${h.cur?"":" · block "+h.block}</span></div>
        <div class="rd">${h.sets.map(s=>fmtSet(s,true)).join(" · ")}</div></div>
      <div class="rv"><b>${h.e}${unit}</b><span class="${dl>0?"up":dl<0?"down":""}">${delta}</span></div></${tap?"button":"div"}>`;
  }).join("");
}
/* ---------- per-lift settings: weight step, rest, per side ---------- */
function stepperHTML(fn,val,step,label,unit,mode){
  return `<div class="stepper small"><button onclick="${fn}(-${step})" aria-label="Decrease ${label}">−</button><input type="number" inputmode="${mode||"decimal"}" value="${val}" onchange="${fn}(0,this.value)" aria-label="${label}"><button onclick="${fn}(${step})" aria-label="Increase ${label}">+</button></div><span class="sunit">${unit}</span>`;
}
function renderLiftSettings(name){
  const o=liftOpt(name),inc=increment(name),uni=isUni(name),timed=isTimed(name);
  const defInc=incrementFor(name,{},BIG_INC);
  let slotComp=null;for(const d of dayIds())DAYS[d].ex.forEach((e,i)=>{if(slotComp===null&&exName(d,i)===name)slotComp=!!e[2]});
  const defRest=(slotComp===null?isCompPattern(name):slotComp)?db.settings.rest.comp:db.settings.rest.acc;   /* the session rests by the slot's compound flag */
  $("lift-settings").innerHTML=
    `<div class="setrow"><div class="lrtext"><b>Weight step</b><i>${o.inc?"Custom · default "+defInc+" kg":"Used by the +/− buttons and the coach"}</i></div>${stepperHTML("liftInc",inc,0.5,"weight step","kg")}</div>
     <div class="setrow"><div class="lrtext"><b>Rest after a set</b><i>${o.rest?"Custom · default "+defRest+" s":"Default · "+defRest+" s (Settings)"}</i></div>${stepperHTML("liftRest",o.rest||defRest,15,"rest","s","numeric")}</div>
     <div class="setrow"><div class="lrtext"><b>Per side</b><i>${uni?"Logged once, tonnage counts both sides":"Both sides move together"}</i></div>
      <button class="pill ${uni?"comp":""}" role="switch" aria-checked="${uni}" onclick="liftToggleUni()">${uni?"UNILATERAL":"BILATERAL"}</button></div>
     <div class="setrow"><div class="lrtext"><b>Measure</b><i>${timed?"Seconds held, with a stopwatch in the session":"Repetitions"}</i></div>
      <button class="pill ${timed?"comp":""}" role="switch" aria-checked="${timed}" onclick="liftToggleTimed()">${timed?"SECONDS":"REPS"}</button></div>`
    +(Object.keys(o).length?`<button class="quietbtn" onclick="liftResetOpts()">Reset this lift to defaults</button>`:"");
}
function liftInc(d,typed){
  const n=LIB.current;
  let v=typed!=null&&typed!==""?parseFloat(typed):increment(n)+d;
  if(isNaN(v)||v<=0)v=increment(n);
  v=Math.round(v*100)/100;
  setLiftOpt(n,"inc",v===incrementFor(n,{},BIG_INC)?null:v);renderLiftSettings(n);
}
function liftRest(d,typed){
  const n=LIB.current,def=isCompPattern(n)?db.settings.rest.comp:db.settings.rest.acc;
  let v=typed!=null&&typed!==""?parseFloat(typed):(liftOpt(n).rest||def)+d;
  if(isNaN(v)||v<5)v=5;
  v=Math.round(v/5)*5;
  setLiftOpt(n,"rest",v===def?null:v);renderLiftSettings(n);
}
function liftToggleUni(){
  const n=LIB.current,def=!!(EXDB[n]&&EXDB[n].uni),next=!isUni(n);
  setLiftOpt(n,"uni",next===def?null:(next?1:0));renderLiftSettings(n);
}
function liftToggleTimed(){
  const n=LIB.current,def=!!(EXDB[n]&&EXDB[n].timed),next=!isTimed(n);
  setLiftOpt(n,"timed",next===def?null:(next?1:0));renderLiftSettings(n);
}
function liftResetOpts(){delete db.lifts[LIB.current];save();renderLiftSettings(LIB.current);toast("Defaults restored")}
function backFromLift(){history.back()}

/* ---------- 3D muscle card: drag to spin, snaps to a face, sways when idle ---------- */
const ANAT={rot:0,tilt:0,drag:null,idleT:null};
function anatApply(){
  const el=$("anatflip");if(!el)return;
  el.style.transform=`rotateX(${ANAT.tilt.toFixed(2)}deg) rotateY(${ANAT.rot.toFixed(2)}deg)`;
  const back=((Math.round(ANAT.rot/180)%2)+2)%2===1;
  $("anat-btn-front").classList.toggle("sel",!back);$("anat-btn-back").classList.toggle("sel",back);
}
function anatIdle(on){
  const el=$("anatflip");if(!el)return;
  clearTimeout(ANAT.idleT);
  if(on&&!reduceMotion()){ANAT.idleT=setTimeout(()=>{if(!ANAT.drag&&Math.abs(ANAT.rot%180)<1){el.style.setProperty("--face",(Math.round(ANAT.rot/180)*180)+"deg");el.classList.add("idle")}},900)}
  else el.classList.remove("idle");
}
/* turn to a face (0 = front, 180 = back). `snap` jumps without animating, for a fresh screen. */
function anatTurn(deg,snap){
  const el=$("anatflip");if(!el)return;
  anatIdle(false);
  if(snap){el.classList.add("dragging");ANAT.rot=deg;ANAT.tilt=0;anatApply();void el.offsetWidth;el.classList.remove("dragging")}
  else{
    /* rotate the short way round to the requested face */
    const cur=ANAT.rot,base=Math.round(cur/360)*360;
    const cands=[base+deg,base+deg-360,base+deg+360];
    ANAT.rot=cands.reduce((a,b)=>Math.abs(b-cur)<Math.abs(a-cur)?b:a);ANAT.tilt=0;anatApply();tap(6);
  }
  anatIdle(true);
}
function anatBind(){
  const host=$("anat3d"),el=$("anatflip");if(!host||!el)return;
  host.addEventListener("pointerdown",e=>{
    ANAT.drag={x:e.clientX,y:e.clientY,rot:ANAT.rot,moved:false};
    anatIdle(false);el.classList.add("dragging");host.setPointerCapture(e.pointerId);
  });
  host.addEventListener("pointermove",e=>{
    if(!ANAT.drag)return;
    const dx=e.clientX-ANAT.drag.x,dy=e.clientY-ANAT.drag.y;
    if(Math.abs(dx)>4)ANAT.drag.moved=true;
    ANAT.rot=ANAT.drag.rot+dx*0.7;
    ANAT.tilt=Math.max(-9,Math.min(9,-dy*0.06));
    anatApply();
  });
  const end=e=>{
    if(!ANAT.drag)return;
    const moved=ANAT.drag.moved;ANAT.drag=null;el.classList.remove("dragging");
    if(!moved){anatTurn(Math.abs(ANAT.rot%360)<90||Math.abs(ANAT.rot%360)>270?180:0);return}   /* a tap flips */
    ANAT.rot=Math.round(ANAT.rot/180)*180;ANAT.tilt=0;anatApply();haptic("select");anatIdle(true);
  };
  host.addEventListener("pointerup",end);host.addEventListener("pointercancel",end);
}
function openLiftFromSession(){if(S)openLift(sessName(S.w,S.d,S.exIdx),"session")}
function saveNote(val){
  clearTimeout(window._noteT);
  window._noteT=setTimeout(()=>{
    if(!db.notes)db.notes={};
    const v=val.trim();
    if(v)db.notes[LIB.current]=v;else delete db.notes[LIB.current];
    save();
  },400);
}
/* excludeKey: leave out one session (today's) so PRs compare against real history */
function liftStats(name,excludeKey){
  let best=null,bestE=null,count=0,last=null;
  for(const B of allBlocks()){
    const isCur=B.logs===db.logs;
    for(const [k,L] of Object.entries(B.logs||{})){
      if(isCur&&excludeKey&&k===excludeKey)continue;
      const [,d]=k.split("-");
      for(const [i,sets] of Object.entries(L.ex||{})){
        for(const s of sets){
          if(!s||s.kg==null)continue;
          if(setName(s,B,d,i)!==name)continue;
          count++;
          const rec={kg:s.kg,reps:s.reps,timed:s.timed,uni:s.uni,date:L.date,block:B.block,e:setScore(s)};
          if(betterSet(s,best))best=rec;
          if(!bestE||rec.e>bestE.e)bestE=rec;
          if(!last||(s.t||0)>(last.t||0))last=Object.assign({t:s.t||0},rec);
        }
      }
    }
  }
  return count?{best,bestE,count,last}:null;
}

/* ================= REST ================= */
const RING_C=339.3;
function startRest(sec,nextLabel,hint){
  clearInterval(restTick);   /* logging while peeked must not leave the old clock ticking */
  restEnd=Date.now()+sec*1000;restDur=sec;restLabel=nextLabel;restHintTxt=hint||"";
  $("rest-next").textContent=nextLabel;
  $("rest-hint").innerHTML=restHintTxt;
  restTarget();
  peekRest(false,true);
  $("restveil").classList.add("active");document.body.classList.add("resting");
  tickRest();restTick=setInterval(tickRest,250);
}
/* what the next set is going to be, big enough to read from the bench */
function restTarget(){
  const el=$("rest-target");if(!S){el.textContent="";return}
  const kg=parseFloat($("in-kg").value)||0,reps=parseInt($("in-reps").value)||0;
  const timed=isTimed(sessName(S.w,S.d,S.exIdx)),uni=isUni(sessName(S.w,S.d,S.exIdx));
  el.innerHTML=kg?`${fmtKg(kg)} kg × ${reps||"?"}${timed?" s":""}<small>${uni?"per side":"target"}</small>`:"";
  /* the hint ("Last set 70 kg × 8") is redundant when it is exactly the target on screen */
  const h=$("rest-hint");if(h)h.style.display=(kg&&restHintTxt.includes(`${fmtKg(kg)} kg × ${reps}`))?"none":"";
}
/* peek: collapse the veil to a bar at the top so cues and the map are readable while resting */
function peekRest(on,silent){
  const v=$("restveil"),was=v.classList.contains("peek");
  v.classList.toggle("peek",!!on);
  document.body.classList.toggle("peeking",!!on);
  document.body.classList.toggle("resting",!on&&restEnd>Date.now());
  if(on&&!was&&!silent)haptic("select");
  tickRest();
}
function tickRest(){
  const left=Math.max(0,Math.ceil((restEnd-Date.now())/1000));
  const txt=Math.floor(left/60)+":"+String(left%60).padStart(2,"0");
  $("rest-time").textContent=txt;
  const peek=$("restveil").classList.contains("peek");
  if(peek){const t=$("rest-target");if(!t.dataset.base)t.dataset.base=t.innerHTML;t.innerHTML=`${txt}<small>${restLabel.replace(/^Next: /,"")}</small>`}
  else{const t=$("rest-target");if(t.dataset.base){t.innerHTML=t.dataset.base;delete t.dataset.base}}
  $("rest-ring").style.strokeDashoffset=(RING_C*(1-Math.min(1,left/restDur))).toFixed(1);
  if(left<=0){
    endRest();
    haptic("restEnd");
    if(document.hidden)notifyRestDone();
    else{toast("Rest over — "+(restLabel||"back to work").replace(/^Next: /,""));if(!navigator.vibrate)restBeep()}   /* iPhone has no vibration: a short tone and a toast */
  }
}
let AUDIO=null;
function restBeep(){
  try{
    AUDIO=AUDIO||new (window.AudioContext||window.webkitAudioContext)();
    const o=AUDIO.createOscillator(),g=AUDIO.createGain();o.type="sine";o.frequency.value=880;
    g.gain.setValueAtTime(0.0001,AUDIO.currentTime);g.gain.exponentialRampToValueAtTime(0.25,AUDIO.currentTime+0.02);g.gain.exponentialRampToValueAtTime(0.0001,AUDIO.currentTime+0.35);
    o.connect(g).connect(AUDIO.destination);o.start();o.stop(AUDIO.currentTime+0.4);
  }catch(e){}
}
function notifyRestDone(){
  try{
    if(db.settings.restNotify&&window.Notification&&Notification.permission==="granted"&&navigator.serviceWorker)
      navigator.serviceWorker.getRegistration().then(r=>r&&r.showNotification("Rest over",
        {body:restLabel||"Back to work",icon:"icon-192.png",tag:"rest",vibrate:[200,100,200]}));
  }catch(e){}
}
function addRest(s){restEnd+=s*1000;restDur=Math.max(5,restDur+s);tickRest()}
function endRest(){clearInterval(restTick);$("restveil").classList.remove("active","peek");document.body.classList.remove("resting","peeking");const t=$("rest-target");if(t.dataset.base){t.innerHTML=t.dataset.base;delete t.dataset.base}}

/* ================= DONE ================= */
let DONE={w:1,d:"A"};
/* Finish the live session (view=false) or just look at a finished one (view=true).
   Only finishing stamps the entry done, saves and syncs — reviewing a day from Home does none of that.
   `from` (calendar, lift history) sends the back arrow back there rather than to the plan. */
function showDone(w,d,view,from){
  if(!view){
    const L=db.logs[logKey(w,d)];if(L&&hasSets(L))L.done=Date.now();
    if(restEnd>Date.now())endRest();
    S=null;unlockScreen();pruneLog(logKey(w,d));save();
  }
  DONE={w,d,from:from||(view&&!DONE.past&&DONE.w===w&&DONE.d===d?DONE.from:null)};   /* an edit re-renders: keep where we came from */
  renderDone(w,d);
  if(document.querySelector(".screen.active").id!=="scr-done")show("done");
  if(!view&&driveOn())setTimeout(()=>driveSync({quiet:true}),800);
}
function doneBack(){if(DONE.from)history.back();else go("home")}
/* An archived block's session, read-only. Keys like "3-A" exist in the archive and the current
   block alike, so nothing on this view may edit, resume or delete. */
function showPast(bi,key,from){
  DONE={past:{bi,key},from};
  renderPast();
  if(document.querySelector(".screen.active").id!=="scr-done")show("done");
}
function renderPast(){
  const B=db.archive[DONE.past.bi],L=B&&B.logs&&B.logs[DONE.past.key];
  if(!L){showNow("home");return}
  const [w,d]=DONE.past.key.split("-"),day=(B.programme||{})[d];
  $("done-title").textContent="Past session";
  $("done-sub").textContent=`Day ${d} · Week ${w} · Block ${B.block}${day?" · "+day.title:""}`;
  let sets=0,ton=0;
  const rows=Object.entries(L.ex||{}).sort((a,b)=>a[0]-b[0]).map(([i,arr])=>{
    const done=(arr||[]).filter(s=>s&&s.kg!=null);if(!done.length)return "";
    sets+=done.length;done.forEach(s=>{ton+=setTonnage(s)});
    return `<div class="histrow"><div class="hname">${esc(setName(done[0],B,d,i))}</div><div class="setchips">${done.map(s=>`<span class="setchip ro">${fmtSet(s)}</span>`).join("")}</div></div>`;
  }).join("");
  $("done-tonnage").textContent=Math.round(ton).toLocaleString();
  $("done-sets").textContent=sets;
  $("done-dur").textContent=sessionDuration(L)||"—";
  $("done-durbtn").disabled=true;
  $("done-list").innerHTML=rows+`<div class="hsets" style="padding:2px 4px;color:var(--ink-faint)">From an archived block, so it's read-only.</div>`;
  for(const id of ["done-acts","done-move","done-nudge"])$(id).style.display="none";
}
/* Session length on the summary: worked out from the set times, or typed when those are wrong */
async function editDuration(){
  if(DONE.past)return;
  const {w,d}=DONE,L=db.logs[logKey(w,d)];if(!L||!hasSets(L))return;
  const auto=sessionDuration(Object.assign({},L,{mins:0}));
  if(!await ask({title:"Session length",ok:"Save",
    body:`<div class="stepper" style="margin:4px 0 12px"><button onclick="bumpEl('in-mins',-5)" aria-label="5 minutes less">−</button><input id="in-mins" type="number" inputmode="numeric" value="${sessionDuration(L)||""}" aria-label="Minutes"><button onclick="bumpEl('in-mins',5)" aria-label="5 minutes more">+</button></div>From your set times: <b>${auto||"—"} min</b>. If that's wrong, type the real length. Clear the box to go back to the timed figure.`}))return;
  const v=parseInt($("in-mins").value);
  if(isNaN(v)||v<=0||v===auto)delete L.mins;else L.mins=Math.min(600,v);
  save();renderDone(w,d);
}
function renderDone(w,d){
  if(DONE.past)return renderPast();
  if(!DAYS[d]){showNow("home");return}
  $("done-title").textContent="Session complete";
  for(const id of ["done-acts","done-move","done-nudge"])$(id).style.display="";
  $("done-durbtn").disabled=false;
  $("done-sub").textContent="Day "+d+" · Week "+w+" · "+DAYS[d].title;
  const L=db.logs[logKey(w,d)]||{ex:{}};
  const dur=sessionDuration(L);
  $("done-tonnage").textContent=sessionTonnage(w,d).toLocaleString();
  $("done-sets").textContent=loggedSets(w,d);
  $("done-dur").textContent=dur||"—";
  let html=DAYS[d].ex.map((e,i)=>{
    const arr=L.ex[i]||[];
    const chips=arr.map((s,si)=>s&&s.kg!=null
      ?`<button class="setchip" data-w="${w}" data-d="${d}" data-ex="${i}" data-si="${si}" onclick="openEdit(${w},'${d}',${i},${si})">${fmtSet(s)}</button>`:"").join("");
    if(!chips)return "";
    return `<div class="histrow"><div class="hname">${setName(arr.find(x=>x&&x.kg!=null),blockCtx(),d,i)}</div><div class="setchips">${chips}</div></div>`;
  }).join("");
  const undone=DAYS[d].ex.map((e,i)=>({n:sessName(w,d,i),i,has:(L.ex[i]||[]).some(s=>s&&s.kg!=null),skip:isSkipped(w,d,i)})).filter(x=>!x.has);
  const chip=x=>`<button class="setchip" onclick="resumeAt(${w},'${d}',${x.i})">${esc(x.n)} →</button>`;
  const forTime=undone.filter(x=>x.skip),notDone=undone.filter(x=>!x.skip);
  if(forTime.length)html+=`<div class="histrow"><div class="hname" style="color:var(--ink-faint)">Skipped for time · tap to do one now</div><div class="setchips">${forTime.map(chip).join("")}</div></div>`;
  if(notDone.length)html+=`<div class="histrow"><div class="hname" style="color:var(--ink-faint)">Not done · tap to pick one up</div><div class="setchips">${notDone.map(chip).join("")}</div></div>`;
  html+=`<div class="hsets" style="padding:2px 4px;color:var(--ink-faint)">Tap a set to edit it, hold to delete.</div>`;
  $("done-list").innerHTML=html;
  $("done-nudge").innerHTML=backupNudgeHTML(7);
  $("done-share").onclick=()=>shareSession(w,d);
}
/* pick a lift up from the summary: back into the session at that slot */
function resumeAt(w,d,i){
  const L=db.logs[logKey(w,d)];if(L&&L.skip){L.skip=L.skip.filter(x=>x!==i);if(!L.skip.length)delete L.skip}
  if(L)delete L.done;
  S={w,d,exIdx:i,setIdx:0};S.setIdx=firstOpenSet();save();lockScreen();TON_SHOWN=0;
  renderSet();show("session");
}

/* ---------- edit a logged set ---------- */
let ED=null;
function openEdit(w,d,ex,si,src){
  ED={w,d,ex,si,src};
  const s=db.logs[logKey(w,d)].ex[ex][si];
  $("ed-sub").textContent=sessName(w,d,ex)+" · set "+(si+1);
  $("ed-lbl-reps").textContent=s.timed?"Seconds":"Reps";
  $("in-ed-kg").value=s.kg;$("in-ed-reps").value=s.reps;
  $("editsheet").classList.add("active");
}
function closeEdit(){$("editsheet").classList.remove("active")}
function saveEditSet(){
  const kg=parseFloat($("in-ed-kg").value),reps=parseInt($("in-ed-reps").value);
  if(isNaN(kg)||isNaN(reps)||reps<=0){toast("Enter weight and reps");return}
  const s=db.logs[logKey(ED.w,ED.d)].ex[ED.ex][ED.si];
  s.kg=kg;s.reps=reps;save();
  closeEdit();editReturn();toast("Set updated");
}
/* after an edit: back to the session if that's where we came from, else re-render the summary */
function editReturn(){
  if(ED.src==="session"&&S){S.setIdx=firstOpenSet();renderSet()}
  else showDone(ED.w,ED.d,true);
}
async function deleteEditSet(){
  const arr=db.logs[logKey(ED.w,ED.d)].ex[ED.ex],st=arr[ED.si];
  closeEdit();
  if(!await ask({title:"Delete this set?",body:`<b>${fmtSet(st)}</b> is removed from your history.`,ok:"Delete",danger:1})){$("editsheet").classList.add("active");return}
  arr.splice(ED.si,1);   /* a null hole here would be overwritten by the next logged set */
  save();
  editReturn();toast("Set deleted");
}

/* ================= STATS ================= */
let ST={tab:"volume"};
function sparkSVG(series,w2,h2,color){
  if(series.length<2)return "";
  const W=w2||96,H=h2||32,p=4;
  let min=Math.min(...series),max=Math.max(...series);
  const span=Math.max(max-min,Math.abs(max)*0.08||1);   /* at least ±4%, so noise reads as flat */
  const mid=(max+min)/2;min=mid-span/2;max=mid+span/2;const r=max-min||1;
  const pts=series.map((v,i)=>[
    +(p+(W-2*p)*i/(series.length-1)).toFixed(1),
    +(H-p-(H-2*p)*(v-min)/r).toFixed(1)]);
  const col=color||(series[series.length-1]>=series[0]?"var(--plate-green)":"var(--plate-yellow)");
  const last=pts[pts.length-1];
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="flex-shrink:0" role="img" aria-label="${series.length} sessions, ${series[0]} to ${series[series.length-1]}">
    <polyline points="${pts.map(pt=>pt.join(",")).join(" ")}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round"/>
    <circle cx="${last[0]}" cy="${last[1]}" r="2.5" fill="${col}"/></svg>`;
}
function tonChartHTML(){
  const vals=[],proj=[],ws=weekWindow(db.selWeek).filter(w=>!isOpen()||w<=curWeek()),N=ws.length;
  for(const w of ws){
    const v=dayIds().reduce((a,d)=>a+sessionTonnage(w,d),0);
    const done=dayIds().reduce((a,d)=>a+loggedSets(w,d),0),plan=dayIds().reduce((a,d)=>a+totalSets(w,d),0);
    vals.push(v);
    /* a week that's underway would read as a crash — show where it's heading instead */
    proj.push(v&&done<plan?Math.round(v*plan/done):null);
  }
  const max=Math.max(...vals,...proj.filter(Boolean),1);
  const W=320,bw=Math.min(36,Math.floor((W-16-6*(N-1))/N)),gap=N>1?(W-N*bw-16)/(N-1):0;
  let s=`<defs>
    <linearGradient id="tgPast" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#4A5470"/><stop offset="100%" stop-color="#2B3346"/></linearGradient>
    <linearGradient id="tgCur" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#FF7A6E"/><stop offset="100%" stop-color="#D93B38"/></linearGradient>
  </defs>`;
  vals.forEach((v,i)=>{
    const h=v?Math.max(6,Math.round(100*v/max)):3;
    const x=8+i*(bw+gap),y=118-h;
    const wn=ws[i],cur=wn===db.selWeek,pj=proj[i];
    if(pj){const ph=Math.max(h,Math.round(100*pj/max));
      s+=`<rect x="${x}" y="${118-ph}" width="${bw}" height="${ph}" rx="6" fill="none" stroke="var(--ink-faint)" stroke-dasharray="3 3" stroke-width="1"/>`}
    s+=`<rect class="tonbar${pj?" partial":""}" x="${x}" y="${y}" width="${bw}" height="${h}" rx="6" fill="${v?(cur?"url(#tgCur)":"url(#tgPast)"):"var(--surface3)"}"/>`;
    const lbl=n=>n>=10000?(n/1000).toFixed(1)+"k":n.toLocaleString();
    if(v)s+=`<text x="${x+bw/2}" y="${(pj?118-Math.max(h,Math.round(100*pj/max)):y)-7}" text-anchor="middle" font-size="10.5" font-weight="700" fill="${cur?"var(--ember)":"var(--ink-dim)"}">${pj?"~"+lbl(pj):lbl(v)}</text>`;
    s+=`<text x="${x+bw/2}" y="133" text-anchor="middle" font-size="9.5" font-weight="700" fill="${cur?"var(--ink)":"var(--ink-faint)"}">W${wn}</text>`;
    s+=`<text x="${x+bw/2}" y="144" text-anchor="middle" font-size="${N>6?6.5:8}" fill="var(--ink-faint)">${isOpen()?(deloadWeek(wn)?"Light":"Hard"):phaseOf(wn)}</text>`;
  });
  const anyProj=proj.some(Boolean);
  return `<div class="chartcard"><div class="sectlabel" style="margin:0 0 10px">Weekly tonnage · kg · ${isOpen()?"last "+N+" weeks":"block "+db.block}</div>
    <svg viewBox="0 0 ${W} 150" style="width:100%;display:block">${s}</svg>
    ${anyProj?`<div class="hsets" style="margin-top:8px;color:var(--ink-faint)">Dashed outline = where an unfinished week is heading at its current pace.</div>`:""}</div>`;
}

/* ---------- weekly sets per muscle ----------
   Standard hypertrophy accounting: a primary muscle scores a full set, a
   secondary scores half. Uses the encyclopedia's muscle data, so a swap that
   quietly starves your rear delts shows up here. */
const MINOR_MUSCLES=["hip_flexors","obliques","adductors","lower_back","forearms","traps"];
function muscleVolume(w){
  const out={};
  for(const [m,g] of Object.entries(MUSCLE_NAMES))out[g]={logged:0,planned:0,minor:MINOR_MUSCLES.includes(m)};   /* every muscle listed, trained or not */
  const bump=(name,sets,key)=>{
    const e=EXDB[name];if(!e)return;
    const put=(m,amt)=>{const g=MUSCLE_NAMES[m];if(!g)return;
      (out[g]=out[g]||{logged:0,planned:0})[key]+=amt};
    e.pri.forEach(m=>put(m,sets));
    e.sec.forEach(m=>put(m,sets*0.5));
  };
  const ctx=blockCtx();
  for(const d of dayIds()){
    const L=db.logs[logKey(w,d)];
    DAYS[d].ex.forEach((e,i)=>{
      bump(sessName(w,d,i),slotSets(w,d,i),"planned");
      const done=((L&&L.ex[i])||[]).filter(s=>s&&s.kg!=null);
      if(!done.length)return;
      const byName={};
      done.forEach(s=>{const n=setName(s,ctx,d,i);byName[n]=(byName[n]||0)+1});
      for(const[n,c]of Object.entries(byName))bump(n,c,"logged");
    });
  }
  return out;
}
function volumeHTML(){
  const w=db.selWeek;
  const vol=muscleVolume(w);
  const all=Object.entries(vol);
  const majors=all.filter(([,v])=>!v.minor).sort((a,b)=>b[1].planned-a[1].planned);
  const minors=all.filter(([,v])=>v.minor&&(v.planned>0||v.logged>0)).sort((a,b)=>b[1].planned-a[1].planned);
  const max=Math.max(24,...all.map(r=>Math.max(r[1].planned,r[1].logged)));
  const bar=([g,v],minor)=>{
    const n=Math.round(v.logged*10)/10,pl=Math.round(v.planned*10)/10;
    /* colour by what the week PLANS to deliver, so an unstarted week still
       tells you whether the programme covers this muscle at all */
    const cls=minor?"minor":pl===0?"none":pl<8?"low":pl<=22?"ok":"high";
    return `<div class="musrow${minor?" minor":""}">
      <div class="muslabel">${g}</div>
      <div class="mustrack">
        ${minor?"":`<div class="musband" style="left:${100*8/max}%;width:${100*12/max}%"></div>`}
        <div class="musghost" style="width:${Math.min(100,100*pl/max)}%"></div>
        <div class="musfill ${cls}" style="width:${Math.min(100,100*n/max)}%"></div>
        ${minor?"":`<div class="musmark" style="left:${100*8/max}%"></div><div class="musmark" style="left:${100*20/max}%"></div>`}
      </div>
      <div class="musval">${n}<span>/${pl}</span></div></div>`;
  };
  const bars=majors.map(r=>bar(r,false)).join("")+(minors.length?`<div class="hsets" style="margin:12px 0 6px;color:var(--ink-faint)">Smaller muscles · trained mostly through the lifts above, no target band</div>`+minors.map(r=>bar(r,true)).join(""):"");
  const thin=majors.filter(([,v])=>v.planned>0&&v.planned<8).map(([g])=>g);
  const none=majors.filter(([,v])=>v.planned===0).map(([g])=>g);
  let verdict="";
  if(thin.length||none.length){
    verdict=`<div class="nudge" style="margin:12px 0 0">`+
      (none.length?`<b>Not in this week's plan:</b> ${none.join(", ")}. `:"")+
      (thin.length?`<b>Under 8 sets:</b> ${thin.join(", ")}.`:"")+
      `</div>`;
  }else if(majors.length){
    verdict=`<div class="nudge" style="margin:12px 0 0;border-left-color:var(--plate-green)">Every major muscle is planned for 8+ sets this week. Balanced.</div>`;
  }
  return tonChartHTML()+
    `<div class="chartcard">
      <div class="sectlabel" style="margin:0 0 4px">Sets per muscle · week ${w}</div>
      <div class="hsets" style="margin-bottom:12px">The shaded band, 8 to 20 sets a week, is the productive range for the major muscles. Solid = logged, faint = planned. A primary muscle counts 1 set, a secondary ½.</div>
      ${bars||'<div class="emptymsg">No exercises in the programme yet.</div>'}
      ${verdict}
    </div>`;
}

/* ---------- all-time records ---------- */
function allRecords(){
  const map={};
  for(const B of allBlocks())for(const[k,L]of Object.entries(B.logs||{})){
    const[,d]=k.split("-");
    for(const[i,sets]of Object.entries(L.ex||{}))for(const s of sets||[]){
      if(!s||s.kg==null)continue;
      const n=setName(s,B,d,i),e=setScore(s);
      const r=map[n]||(map[n]={name:n,sets:0,best:null,bestE:null,timed:!!s.timed});
      r.sets++;
      if(betterSet(s,r.best))r.best={kg:s.kg,reps:s.reps,timed:s.timed,uni:s.uni,date:L.date,block:B.block};
      if(!r.bestE||e>r.bestE.e)r.bestE={e,kg:s.kg,reps:s.reps,date:L.date,block:B.block};
    }
  }
  return Object.values(map).sort((a,b)=>b.bestE.e-a.bestE.e);
}
function recordsHTML(){
  const recs=allRecords();
  if(!recs.length)return `<div class="emptymsg">No records yet.<br>Log your first session and this fills up.</div>`;
  const weekAgo=isoDate(new Date(Date.now()-7*86400e3));
  const byG={};recs.forEach(r=>{const g=(EXDB[r.name]||{}).g||"Other";(byG[g]=byG[g]||[]).push(r)});
  const row=r=>`<button class="recrow" onclick="openLift('${r.name.replace(/'/g,"\\'")}','stats')">
      <div class="rinfo2"><div class="rn">${r.name}${r.best.date&&r.best.date>=weekAgo?'<span class="prbadge">NEW PR</span>':""}</div>
      <div class="rd">${r.best.date||"—"} · block ${r.best.block} · ${r.sets} sets logged</div></div>
      <div class="rv"><b>${fmtSet(r.best)}</b><span>${r.timed?"score "+r.bestE.e:"e1RM "+r.bestE.e+" kg"}</span></div></button>`;
  const fresh=recs.filter(r=>r.best.date&&r.best.date>=weekAgo);
  return `<div class="hsets" style="padding:0 4px 4px;color:var(--ink-faint)">Heaviest set ever, and the estimated 1RM it implies. Tap a lift for its guide.</div>`+
    (fresh.length?`<div class="sectlabel" style="margin-top:14px">This week's PRs</div>`+fresh.map(row).join(""):"")+
    [...GROUPS,"Other"].filter(g=>byG[g]).map(g=>`<div class="sectlabel">${g}</div>`+byG[g].map(row).join("")).join("");
}

/* ---------- per-lift progression (estimated 1RM) ---------- */
function liftSeries(name){
  const pts=[];
  for(const B of allBlocks())for(let w=1;w<=blockWeeks(B);w++)for(const d of Object.keys(B.programme||{})){
    const L=(B.logs||{})[logKey(w,d)];if(!L)continue;
    for(const[i,sets]of Object.entries(L.ex||{})){
      const done=(sets||[]).filter(s=>s&&s.kg!=null);
      if(!done.length||setName(done[0],B,d,i)!==name)continue;
      pts.push(Math.max(...done.map(setScore)));
    }
  }
  return pts;
}
function progressHTML(){
  const recs=allRecords();
  if(!recs.length)return `<div class="emptymsg">Nothing logged yet.<br>Pick a day on the Plan tab and get under something heavy.</div>`;
  const rows=recs.map(r=>{
    const series=liftSeries(r.name);
    if(series.length<2)return "";
    const delta=Math.round((series[series.length-1]-series[0])*10)/10;
    const col=delta>=0?"var(--plate-green)":"var(--plate-yellow)";
    return `<div class="histrow" style="display:flex;justify-content:space-between;align-items:center;gap:10px">
      <div style="min-width:0"><div class="hname">${r.name}</div>
      <div class="hsets">${r.timed?"score":"e1RM"} ${series[series.length-1]}${r.timed?"":" kg"} · <span style="color:${col}">${delta>=0?"+":""}${delta}${r.timed?"":" kg"}</span> over ${series.length} sessions</div></div>
      ${sparkSVG(series)}</div>`;
  }).filter(Boolean).join("");
  return `<div class="hsets" style="padding:0 4px 10px;color:var(--ink-faint)">Estimated 1RM per session — weight and reps combined, so rep-chasing weeks still show progress.</div>`+
    (rows||`<div class="emptymsg">Need at least two sessions on a lift before a trend appears.</div>`);
}

/* ---------- calendar ----------
   Real dates rather than plan weeks: every session with sets, from every block,
   on the day of its first set. */
function sessionsByDate(){
  const out={};
  allBlocks().forEach((B,bi)=>{
    const cur=B.logs===db.logs;
    for(const [key,L] of Object.entries(B.logs||{})){
      if(!hasSets(L))continue;
      const date=sessionDate(L);if(!date)continue;
      const [w,d]=key.split("-");
      (out[date]=out[date]||[]).push({w:+w,d,key,bi,cur,block:B.block,title:((B.programme||{})[d]||{}).title||""});
    }
  });
  return out;
}
/* current block: the normal summary (sets editable); archived: the read-only one */
function openSession(s,from){if(s.cur)showDone(s.w,s.d,true,from);else showPast(s.bi,s.key,from)}
const sessLabel=s=>`Day ${s.d}${s.title?" · "+esc(s.title):""} · Week ${s.w}${s.cur?"":" · block "+s.block}`;
const monthOf=(y,m)=>y+"-"+String(m).padStart(2,"0");
function calendarHTML(){
  const byDate=sessionsByDate(),today=todayISO(),thisMonth=today.slice(0,7);
  const first=Object.keys(byDate).sort()[0];
  const m=ST.cal||thisMonth;ST.cal=m;
  const [y,mo]=m.split("-").map(Number);
  const lead=(new Date(y,mo-1,1).getDay()+6)%7,days=new Date(y,mo,0).getDate();   /* Monday first */
  let cells=["M","T","W","T","F","S","S"].map(x=>`<div class="calwd" aria-hidden="true">${x}</div>`).join("")+`<div class="calcell empty"></div>`.repeat(lead);
  let n=0;
  for(let day=1;day<=days;day++){
    const iso=m+"-"+String(day).padStart(2,"0"),ss=byDate[iso]||[],cls=(iso===today?" today":"")+(iso>today?" future":"");
    n+=ss.length;
    if(!ss.length){cells+=`<div class="calcell${cls}"><b>${day}</b></div>`;continue}
    const when=new Date(iso+"T12:00:00").toLocaleDateString(undefined,{weekday:"long",day:"numeric",month:"long"});
    cells+=`<button class="calcell has${cls}" onclick="openCalDay('${iso}')" aria-label="${when}: ${ss.map(s=>"Day "+s.d).join(" and ")}"><b>${day}</b><span class="caldots">${ss.map(s=>`<i class="d${s.d}"></i>`).join("")}</span></button>`;
  }
  const name=new Date(y,mo-1,1).toLocaleDateString(undefined,{month:"long",year:"numeric"});
  const legend=dayIds().map(d=>`<span><i class="d${d}"></i>${d}${DAYS[d].title?" "+esc(DAYS[d].title):""}</span>`).join("");
  return `<div class="chartcard calcard">
    <div class="calhead">
      <button class="calnav" onclick="calStep(-1)" aria-label="Previous month"${!first||m<=first.slice(0,7)?" disabled":""}><svg viewBox="0 0 24 24" class="gico"><path d="M15 4.5 8 12l7 7.5"/></svg></button>
      <div class="calmonth">${name}</div>
      <button class="calnav" onclick="calStep(1)" aria-label="Next month"${m>=thisMonth?" disabled":""}><svg viewBox="0 0 24 24" class="gico"><path d="M9 4.5 16 12l-7 7.5"/></svg></button>
    </div>
    <div class="calgrid">${cells}</div>
    <div class="hsets calsum">${n?`${n} session${n===1?"":"s"} this month · tap a day to open it`:"Nothing logged this month"}</div>
    <div class="callegend">${legend}</div>
  </div>`;
}
function calStep(dir){
  const [y,m]=(ST.cal||todayISO().slice(0,7)).split("-").map(Number),d=new Date(y,m-1+dir,1);
  ST.cal=monthOf(d.getFullYear(),d.getMonth()+1);haptic("select");renderStats();
}
function openCalDay(iso){
  const ss=sessionsByDate()[iso]||[];
  if(ss.length===1)return openSession(ss[0],"cal");
  chooseSheet(new Date(iso+"T12:00:00").toLocaleDateString(undefined,{weekday:"long",day:"numeric",month:"long"}),
    "More than one session on this day.",ss.map((s,i)=>({label:sessLabel(s),value:i})),i=>openSession(ss[i],"cal"));
}

function renderStats(){
  const total=allBlocks().reduce((a,B)=>a+Object.keys(B.logs||{}).length,0);
  $("stats-sub").textContent=db.archive.length
    ? (db.archive.length+1)+" blocks · "+total+" sessions on record"
    : "Volume, balance and every record you've set";
  const tabs=[["volume","Volume"],["records","Records"],["progress","Per lift"],["calendar","Calendar"]];
  $("stats-tabs").innerHTML=tabs.map(([k,l])=>
    `<button class="seg ${ST.tab===k?"sel":""}" aria-pressed="${ST.tab===k}" onclick="ST.tab='${k}';renderStats()">${l}</button>`).join("");
  $("stats-body").innerHTML=
    ST.tab==="volume"?volumeHTML():ST.tab==="records"?recordsHTML():ST.tab==="calendar"?calendarHTML():progressHTML();
  $("backup-nudge").innerHTML=backupNudgeHTML(14);
}

/* ================= PROGRESSION =================
   Week-over-week reading of the log, plus coaching drawn from it.
   Load (best e1RM per lift) and volume (tonnage) are reported separately:
   the programme changes set counts week to week and week 6 is a deload, so
   tonnage alone would call a planned drop a regression. */
let PG={week:null,filter:null,tab:"train"};

/* Best set + volume per lift for one week of one block */
function weekLifts(w,B){
  B=B||blockCtx();
  const logs=B.logs||db.logs;
  const out=new Map();
  for(const d of Object.keys(B.programme||{})){
    const L=logs[logKey(w,d)];
    if(!L)continue;
    for(const [i,sets] of Object.entries(L.ex||{})){
      const done=(sets||[]).filter(s=>s&&s.kg!=null);
      if(!done.length)continue;
      const name=setName(done[0],B,d,i);
      let top=null,vol=0,reps=0;
      for(const s of done){
        const e=setScore(s);
        vol+=setTonnage(s);reps+=s.reps;
        if(!top||e>top.e)top={kg:s.kg,reps:s.reps,timed:s.timed,uni:s.uni,e};
      }
      const prev=out.get(name);
      if(prev){prev.vol+=vol;prev.sets+=done.length;prev.reps+=reps;if(top.e>prev.top.e)prev.top=top}
      else out.set(name,{top,vol,sets:done.length,reps});
    }
  }
  return out;
}
function allWeekLifts(){
  const WK={};
  for(const w of weekNums())WK[w]=weekLifts(w);
  return WK;
}
/* What this week is measured against: the last week with data in this block,
   otherwise the last week with data in the most recent archived block. */
function baselineFor(w,WK){
  for(let pw=w-1;pw>=1;pw--)
    if(WK[pw]&&WK[pw].size&&!deloadWeek(pw))return{w:pw,block:db.block,lifts:WK[pw],label:"week "+pw,sameBlock:true};   /* a light week is not a baseline */
  for(let pw=w-1;pw>=1;pw--)
    if(WK[pw]&&WK[pw].size)return{w:pw,block:db.block,lifts:WK[pw],label:"week "+pw+" (light)",sameBlock:true};
  for(let a=db.archive.length-1;a>=0;a--){
    const B=db.archive[a];
    for(let pw=blockWeeks(B);pw>=1;pw--){
      const m=weekLifts(pw,B);
      if(m.size)return{w:pw,block:B.block,lifts:m,label:"block "+B.block+" wk "+pw,sameBlock:false};
    }
  }
  return null;
}
function weekSummary(w,WK){
  const cur=WK[w];
  const base=baselineFor(w,WK);
  const rows=[];
  let up=0,down=0,hold=0,pctSum=0,pctN=0;
  for(const [name,c] of cur){
    const p=base&&base.lifts.get(name);
    if(!p){rows.push({name,c,p:null,status:"new"});continue}
    const pct=p.top.e?((c.top.e-p.top.e)/p.top.e)*100:0;
    /* double progression: more weight for fewer reps is the plan working, not a regression */
    const loadJump=c.top.kg>p.top.kg&&pct<0&&pct>-12;
    const status=loadJump?"hold":pct>1?"up":pct<-1?"down":"hold";
    if(status==="up")up++;else if(status==="down")down++;else hold++;
    const wgt=Math.max(1,c.vol||1);pctSum+=pct*wgt;pctN+=wgt;   /* weight by tonnage so a cable move can't outvote the squat */
    rows.push({name,c,p,pct,d:Math.round((c.top.e-p.top.e)*10)/10,status});
  }
  /* anything needing a decision goes first — the verdict card up top already
     delivers the overall good news, so the list is for acting on */
  const order={down:0,hold:1,new:2,up:3};
  rows.sort((a,b)=>order[a.status]-order[b.status]||(a.pct||0)-(b.pct||0));
  const ton=dayIds().reduce((a,d)=>a+sessionTonnage(w,d),0);
  const baseTon=base&&base.sameBlock?dayIds().reduce((a,d)=>a+sessionTonnage(base.w,d),0):null;
  return {w,cur,base,rows,up,down,hold,
    avgPct:pctN?pctSum/pctN:null,ton,baseTon,
    doneSets:dayIds().reduce((a,d)=>a+loggedSets(w,d),0),
    planSets:dayIds().reduce((a,d)=>a+totalSets(w,d),0)};
}
/* Lifts where every working set reached the top of its rep range */
function readyToAddLoad(w){
  const out=[];
  for(const d of dayIds()){
    const L=db.logs[logKey(w,d)];if(!L)continue;
    DAYS[d].ex.forEach((e,i)=>{
      const done=(L.ex[i]||[]).filter(s=>s&&s.kg!=null);
      if(!done.length||done.length<slotSets(w,d,i))return;
      const rng=slotRange(w,d,i),top=repTop(rng);
      if(hitTop(done.map(s=>s.reps),top,repBottom(rng))){
        const name=sessName(w,d,i);
        out.push({name,kg:Math.max(...done.map(s=>s.kg)),inc:increment(name),low:repBottom(rng)});
      }
    });
  }
  return out;
}

/* ---------- verdict ---------- */
function weekVerdict(S){
  const deload=deloadWeek(S.w);
  if(!S.cur.size)
    return{tone:"none",title:"Nothing logged yet",body:"Train a session in week "+S.w+" and this fills in."};
  if(!S.base)
    return{tone:"info",title:"Baseline week",body:"Your first logged week — there's nothing to compare against yet. These numbers become the bar week 2 has to beat."};
  const p=S.avgPct;
  const ref=S.base.label;
  if(deload){
    const held=p==null||p>-6;
    return held
      ? {tone:"info",title:"Deload — going to plan",
         body:`Load is within ${Math.abs(Math.round((p||0)*10)/10)}% of ${ref} on half the sets. That's exactly what a deload should look like: keep the weight, cut the work, arrive fresh.`}
      : {tone:"warn",title:"Deload — load dropped hard",
         body:`Load is down ${Math.abs(Math.round(p*10)/10)}% on ${ref}. A deload should keep the weights and cut the sets, not lighten everything — otherwise week 1 of the next block starts from further back.`};
  }
  if(p==null)return{tone:"info",title:"New lifts this week",body:"Nothing overlaps with "+ref+" yet, so there's no like-for-like comparison."};
  const r=Math.round(p*10)/10;
  const counts=`${S.up} up, ${S.hold} held, ${S.down} down`;
  if(r>=2.5)return{tone:"up",title:"Strong week",body:`Load up <b>${r}%</b> on average against ${ref} — ${counts}. This is what the middle of a block should look like.`};
  if(r>=0.8)return{tone:"up",title:"Steady progress",body:`Load up <b>${r}%</b> on ${ref} — ${counts}. Small and repeatable beats big and occasional.`};
  if(r>-0.8)return{tone:"hold",title:"Holding steady",body:`Load essentially level with ${ref} (${r>=0?"+":""}${r}%) — ${counts}. A flat week mid-block is normal; two in a row is a signal.`};
  if(r>-3)return{tone:"warn",title:"Slightly down",body:`Load down <b>${Math.abs(r)}%</b> on ${ref} — ${counts}. Usually sleep, food or a rushed session rather than lost strength.`};
  return{tone:"warn",title:"Down week",body:`Load down <b>${Math.abs(r)}%</b> on ${ref} — ${counts}. Worth looking at recovery before you look at the programme.`};
}

/* ---------- coaching ---------- */
function weekTips(S,WK){
  const t=[],w=S.w;
  if(!S.cur.size)return t;

  if(deloadWeek(w))
    t.push({k:"info",title:"How to run the deload",
      body:`Same weights as last week, fewer sets, <b>${rirOf(w)} RIR</b>. You should leave every session feeling like you could have done far more — that's the point. Resist adding load.`});

  const stalled=S.rows.filter(r=>r.p&&stallStreak(r.name,w,WK,deloadWeek)>=2)
    .map(r=>({name:r.name,n:stallStreak(r.name,w,WK,deloadWeek),kg:r.c.top.kg,reps:r.c.top.reps,timed:r.c.top.timed}));
  if(stalled.length){
    const s0=stalled[0],reset=s0.kg>0&&!s0.timed&&!isAssisted(s0.name)?resetKg(s0.kg,increment(s0.name)):null;
    t.push({k:"warn",title:`${s0.name} has stalled ${s0.n} weeks`,
      body:`Stuck at <b>${fmtSet({kg:s0.kg,reps:s0.reps,timed:s0.timed})}</b>. Three things worth trying, in order: make sure you're genuinely near failure (target is ${rirOf(w)} RIR this week), ${reset?`reset to <b>${fmtKg(reset)} kg</b> (about 90%) and build back up`:"drop to about 90% for one week and rebuild"}, or swap to a close variation for the rest of the block — the Lifts tab lists alternatives.`
      +(stalled.length>1?`<br><br>Also stalled: ${stalled.slice(1,4).map(x=>x.name).join(", ")}.`:"")});
  }

  const big=S.rows.filter(r=>r.status==="down"&&r.pct<-4);
  if(big.length)
    t.push({k:"warn",title:`${big[0].name} dropped ${Math.abs(Math.round(big[0].pct))}%`,
      body:`${big[0].p.top.kg} kg × ${big[0].p.top.reps} → ${big[0].c.top.kg} kg × ${big[0].c.top.reps}. One session is noise, not a trend — but if it repeats next week, look at sleep and food around this day before changing the programme.`});

  /* only judge a week's completeness once it's behind you — mid-week gaps
     just mean the week isn't finished, which isn't worth a warning */
  const weekIsPast=weekNums().some(x=>x>w&&WK[x]&&WK[x].size);
  const missing=S.planSets-S.doneSets;
  if(weekIsPast&&missing>0&&S.doneSets>0){
    const missed=dayIds().filter(d=>DAYS[d].ex.length&&loggedSets(w,d)===0);
    const joinAnd=a=>a.length<=1?a.join(""):a.slice(0,-1).join(", ")+" and "+a[a.length-1];
    t.push({k:"warn",title:missed.length
        ?`Day${missed.length>1?"s":""} ${joinAnd(missed)} never got logged`
        :`${missing} set${missing===1?"":"s"} short this week`,
      body:missed.length
        ?`Week ${w} ran ${S.doneSets} of ${S.planSets} sets. A missed session costs more than a light one — if the week is tight, a short version of every day beats skipping one entirely.`
        :`${S.doneSets} of ${S.planSets} done. Accessories are the usual casualty. When time is short, trim a set from the last exercise rather than dropping a whole lift.`});
  }

  /* adding load contradicts the deload brief, so don't suggest it there */
  const ready=deloadWeek(w)?[]:readyToAddLoad(w);
  if(ready.length){
    const names=ready.slice(0,3).map(r=>`<b>${r.name}</b> → ${r.kg+r.inc} kg`).join(", ");
    t.push({k:"good",title:"Ready for more weight",
      body:`${names}${ready.length>3?` and ${ready.length-3} more`:""}. You hit the top of the rep range on all but one set, so add the increment and drop back to the bottom of the range next time.`});
  }

  const vol=muscleVolume(w);
  const thin=Object.entries(vol).filter(([,v])=>v.planned>0&&v.planned<8).map(([g])=>g);
  if(thin.length&&!deloadWeek(w))
    t.push({k:"info",title:"Light coverage this week",
      body:`${thin.join(", ")} ${thin.length===1?"gets":"get"} under 8 sets. Fine if it's deliberate — otherwise the Stats tab shows the full breakdown and the programme editor lets you add a lift.`});

  if(!t.length)
    t.push({k:"good",title:"Nothing to fix",
      body:`Everything either moved forward or held, the week is fully logged, and no lift has stalled. Keep the weights climbing at ${rirOf(w)} RIR and let the block do its work.`});

  return t.slice(0,4);
}

/* ---------- render ---------- */
function pgDelta(r){
  if(r.status==="new")return `<div class="pgdelta new">new</div>`;
  const sign=r.d>0?"+":"",glyph={up:"▲",down:"▼",hold:"●"}[r.status]||"";
  return `<div class="pgdelta ${r.status}" aria-label="${r.status}, ${sign}${r.d}">${glyph} ${sign}${r.d}<span>${r.c.top.timed?"score":"e1RM"}</span></div>`;
}
function renderProgress(){
  $("pg-tabs").innerHTML=[["train","Training"],["body","Body"]].map(([k,l])=>
    `<button class="seg ${PG.tab===k?"sel":""}" aria-pressed="${PG.tab===k}" onclick="PG.tab='${k}';haptic('select');renderProgress()">${l}</button>`).join("");
  const body=PG.tab==="body";
  $("pg-weeks").style.display=body?"none":"";
  $("pg-title").textContent=body?"Body":"Progression";
  if(body){renderBody();return}
  const WK=allWeekLifts();
  let w=PG.week;
  if(!w||!WK[w]||!WK[w].size){
    w=null;
    for(let x=WEEKS();x>=1;x--)if(WK[x]&&WK[x].size){w=x;break}
    if(!w)w=db.selWeek;
  }
  PG.week=w;
  const logged=weekNums().filter(x=>WK[x]&&WK[x].size).length;
  $("pg-sub").textContent=logged?(isOpen()?`Week ${curWeek()} · ongoing · ${logged} week${logged===1?"":"s"} logged`:`Block ${db.block} · ${logged} week${logged===1?"":"s"} logged`)
    :"Log a session and this fills in";
  const wr=$("pg-weeks");wr.innerHTML="";
  const ws=weekWindow(w).filter(x=>!isOpen()||x<=curWeek());
  wr.style.gridTemplateColumns=`repeat(${ws.length},1fr)`;
  for(const x of ws){
    const c=document.createElement("button");
    c.className="weekcell"+(x===w?" sel":"")+((WK[x]&&WK[x].size)?"":" nodata");
    c.setAttribute("aria-label","Week "+x+", "+phaseLabel(x)+((WK[x]&&WK[x].size)?"":", no data"));
    c.setAttribute("aria-pressed",x===w);
    c.innerHTML=`<div class="wnum">${x}</div><div class="wbar" style="background:${PHASE_COLOR[phaseOf(x)]}"></div>`;
    c.onclick=()=>{tap(6);PG.week=x;renderProgress()};
    wr.appendChild(c);
  }
  const SM=weekSummary(w,WK);
  const V=weekVerdict(SM);
  let html=`<div class="verdict ${V.tone}">
    <div class="vkick">Week ${w} · ${phaseLabel(w)}${SM.base?" vs "+SM.base.label:""}</div>
    <h2>${V.title}</h2><p>${V.body}</p></div>`;

  if(SM.cur.size){
    const loadTxt=SM.avgPct==null?"—":(SM.avgPct>=0?"+":"")+Math.round(SM.avgPct*10)/10+"%";
    const volTxt=SM.baseTon?((SM.ton-SM.baseTon)>=0?"+":"")+Math.round(100*(SM.ton-SM.baseTon)/SM.baseTon)+"%":SM.ton.toLocaleString();
    html+=`<div class="statgrid three">
      <div class="stat"><div class="v" style="color:${SM.avgPct==null?"var(--ink)":SM.avgPct>=0?"var(--plate-green)":"var(--plate-yellow)"}">${loadTxt}</div><div class="k">Load</div></div>
      <div class="stat"><div class="v">${volTxt}</div><div class="k">${SM.baseTon?"Volume":"Tonnage"}</div></div>
      <div class="stat"><div class="v">${SM.doneSets}/${SM.planSets}</div><div class="k">Sets</div></div>
    </div>`;
    /* load and volume can move opposite ways for good reasons — say which */
    if(SM.baseTon&&SM.avgPct!=null){
      const volPct=100*(SM.ton-SM.baseTon)/SM.baseTon;
      let note="";
      if(SM.avgPct>0.8&&volPct<-8)
        note=`Volume is down because you logged fewer sets, not because you lifted lighter — the weights went <b>up</b>.`;
      else if(SM.avgPct<-0.8&&volPct>8)
        note=`More total work than ${SM.base.label}, but at lighter loads. Fine for a pump week; watch it doesn't become the pattern.`;
      else if(deloadWeek(w)&&volPct<-15)
        note=`Volume down <b>${Math.abs(Math.round(volPct))}%</b> on half the sets — that's the deload working as intended.`;
      if(note)html+=`<div class="pgnote">${note}</div>`;
    }

    html+=`<div class="sectlabel">Lift by lift</div>`;
    const cnt={up:SM.up,hold:SM.hold,down:SM.down,new:SM.rows.filter(r=>r.status==="new").length};
    html+=`<div class="pgsum">${[["up","▲","up"],["hold","●","held"],["down","▼","down"],["new","+","new"]].map(([k,g,l])=>
      `<button class="${k}${PG.filter===k?" sel":""}" aria-pressed="${PG.filter===k}" onclick="PG.filter=PG.filter==='${k}'?null:'${k}';renderProgress()"><b>${g} ${cnt[k]}</b>${l}</button>`).join("")}</div>`;
    const rows=PG.filter?SM.rows.filter(r=>r.status===PG.filter):SM.rows;
    html+=rows.map(r=>`<button class="pgrow" onclick="openLift('${r.name.replace(/'/g,"\\'")}','progress')">
      <span class="pgbar ${r.status}"></span>
      <div class="pginfo"><div class="pgname">${r.name}</div>
        <div class="pgcmp">${r.p?`${fmtSet(r.p.top,true)} <span class="arr">→</span> ${fmtSet(r.c.top,true)}`
          :`${fmtSet(r.c.top)} · first time`}</div></div>
      ${pgDelta(r)}</button>`).join("")||`<div class="emptymsg">No lifts in this group.</div>`;
  }

  const tips=weekTips(SM,WK);
  if(tips.length){
    html+=`<div class="sectlabel">Coaching</div>`;
    html+=tips.map(t=>`<div class="tip ${t.k}">
      <span class="tipico">${TIPICO[t.k]}</span>
      <div class="tiptext"><b>${t.title}</b><p>${t.body}</p></div></div>`).join("");
  }
  $("pg-body").innerHTML=html;
}
const TIPICO={
  good:'<svg viewBox="0 0 24 24" class="gico"><path d="M4.5 12.5 9.5 17.5 19.5 7"/></svg>',
  warn:'<svg viewBox="0 0 24 24" class="gico"><path d="M12 3.6 21.2 20H2.8z"/><path d="M12 10v4.2M12 17v.4"/></svg>',
  info:'<svg viewBox="0 0 24 24" class="gico"><circle cx="12" cy="12" r="8.6"/><path d="M12 11.2v5M12 7.7v.5"/></svg>'
};

/* ================= BODY =================
   Check-ins: bodyweight, waist and progress photos. The numbers sync with the rest of the log;
   photo data stays in IndexedDB on this phone and only "Back up everything" carries it. */
const fmtDay=(iso,o)=>new Date(iso+"T12:00:00").toLocaleDateString(undefined,o||{weekday:"short",day:"numeric",month:"short"});
const dayNo=iso=>Math.round(new Date(iso+"T12:00:00").getTime()/86400e3);
const cap=s=>s.charAt(0).toUpperCase()+s.slice(1);
function checkins(){return (db.metrics||[]).filter(m=>m&&m.date).sort((a,b)=>b.date.localeCompare(a.date))}   /* newest first */
/* The scale against the nutrition goal. The shown rate uses the last four weeks; the calorie
   nudge only counts weigh-ins since the last change, so it waits two weeks after each one. */
function scaleStatus(){
  const n=db.settings.nutri,all=weightTrend(db.metrics,todayISO());
  if(!all)return null;
  const t=nutritionTargets(Object.assign({days:dayIds().length},n)),tr=weightTrend(db.metrics,todayISO(),n.adjAt);
  return{all,tr,t,n,nudge:t&&tr?calorieNudge(tr.rate,n.goal,t.kgLo,t.kgHi):null};
}
const rateTxt=r=>Math.abs(r)<0.05?"holding steady":(r>0?"gaining ":"losing ")+fmtKg(Math.abs(r))+" kg a week";
function scaleHTML(){
  const st=scaleStatus(),n=db.settings.nutri;
  const adj=n.adj?`<div class="scaleadj">Target includes ${n.adj>0?"+":""}${n.adj} kcal from your weigh-ins (${fmtDay(n.adjAt)}). <button class="linkbtn" onclick="resetAdj()">Undo</button></div>`:"";
  if(!st)return `<div class="scalecard"><b>No weigh-ins yet.</b> Log a few check-ins and this compares your scale with the goal. <button class="linkbtn" onclick="openCheckin()">Log one</button>${adj}</div>`;
  const {all,tr,t,nudge}=st;
  if(!t)return "";
  const band=n.goal==="maintain"?"steady weight":`${t.kgLo} to ${t.kgHi} kg a week ${n.goal==="cut"?"down":"up"}`;
  let msg;
  if(all.rate==null)msg=`<b>${fmtKg(all.avg)} kg</b> on average this week. Two weeks of weigh-ins (four or more) and this checks your rate against the ${band} target.`;
  else if(tr.rate==null)msg=`<b>${cap(rateTxt(all.rate))}</b> over the last ${Math.max(1,Math.round(all.days/7))} weeks. Calories changed on ${fmtDay(n.adjAt)}, so give the new number two weeks before judging it.`;
  else if(!nudge)msg=`<b>${cap(rateTxt(tr.rate))}</b>, inside the ${band} target. Keep the number.`;
  else{
    const rel=n.goal==="maintain"?"away from":(nudge>0)===(n.goal==="gain")?"slower than":"faster than";
    msg=`<b>${cap(rateTxt(tr.rate))}</b>, ${rel} the ${band} target.
      <button class="bigbtn ghost scalebtn" onclick="applyNudge(${nudge})">${nudge>0?"Add":"Take off"} ${Math.abs(nudge)} kcal a day</button>
      <span class="scalehint">Then give it two weeks. Your target would be ${(t.kcal+nudge).toLocaleString()} kcal.</span>`;
  }
  return `<div class="scalecard${nudge?" act":""}">${msg}${adj}</div>`;
}
function applyNudge(v){
  const n=db.settings.nutri;n.adj=(n.adj||0)+v;n.adjAt=todayISO();
  if(!n.adj)delete n.adj;
  save();haptic("select");rerenderBody();toast("Calorie target updated");
}
function resetAdj(){const n=db.settings.nutri;delete n.adj;delete n.adjAt;save();rerenderBody();toast("Back to the estimate")}
function rerenderBody(){const id=document.querySelector(".screen.active").id;if(id==="scr-progress")renderProgress();else if(id==="scr-nutri")renderNutri()}
/* weigh-ins or waist over the last 12 weeks: dots per check-in, a line through the 7-day average */
function bodyChart(rows,key,label,unit){
  const from=dayNo(todayISO())-84;
  const pts=rows.filter(m=>m[key]>0).map(m=>({x:dayNo(m.date),y:+m[key],date:m.date})).filter(p=>p.x>=from).sort((a,b)=>a.x-b.x);
  if(pts.length<2)return "";
  const W=320,H=130,L=30,R=8,T=10,B=22;
  const x0=pts[0].x,x1=Math.max(pts[pts.length-1].x,x0+1);
  let y0=Math.min(...pts.map(p=>p.y)),y1=Math.max(...pts.map(p=>p.y));
  const pad=Math.max(0.2,(y1-y0)*0.12);y0-=pad;y1+=pad;
  const X=x=>(L+(W-L-R)*(x-x0)/(x1-x0)).toFixed(1),Y=y=>(T+(H-T-B)*(1-(y-y0)/(y1-y0))).toFixed(1);
  const avg=pts.map(p=>{const w=pts.filter(q=>q.x>p.x-7&&q.x<=p.x);return [p.x,w.reduce((a,q)=>a+q.y,0)/w.length]});
  const grid=[y0+pad,(y0+y1)/2,y1-pad].map(v=>`<line x1="${L}" x2="${W-R}" y1="${Y(v)}" y2="${Y(v)}" class="bgrid"/><text x="${L-5}" y="${+Y(v)+3}" text-anchor="end" class="baxis">${fmtKg(Math.round(v*10)/10)}</text>`).join("");
  const first=pts[0],last=pts[pts.length-1],d=Math.round((avg[avg.length-1][1]-avg[0][1])*10)/10;
  return `<div class="chartcard"><div class="sectlabel" style="margin:0 0 4px">${label} · last 12 weeks</div>
    <div class="hsets" style="margin-bottom:8px">${d>0?"+":""}${fmtKg(d)} ${unit} on the 7-day average since ${fmtDay(first.date,{day:"numeric",month:"short"})}</div>
    <svg viewBox="0 0 ${W} ${H}" style="width:100%;display:block" role="img" aria-label="${label} from ${fmtKg(first.y)} to ${fmtKg(last.y)} ${unit}">
      ${grid}
      ${pts.map(p=>`<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="2.6" class="bdot"/>`).join("")}
      <polyline points="${avg.map(([x,y])=>X(x)+","+Y(y)).join(" ")}" class="bline"/>
      <text x="${L}" y="${H-6}" class="baxis">${fmtDay(first.date,{day:"numeric",month:"short"})}</text>
      <text x="${W-R}" y="${H-6}" text-anchor="end" class="baxis">${fmtDay(last.date,{day:"numeric",month:"short"})}</text>
    </svg></div>`;
}
function renderBody(){
  const M=checkins(),st=scaleStatus();
  const kgs=M.filter(m=>m.kg>0),ws=M.filter(m=>m.waist>0),nPh=M.reduce((a,m)=>a+(m.photos||[]).length,0);
  $("pg-sub").textContent=M.length?`${M.length} check-in${M.length===1?"":"s"}${kgs.length?" · last weigh-in "+fmtDay(kgs[0].date):""}`:"Bodyweight, waist and progress photos";
  const btn=`<button class="bigbtn primary" style="margin:0 0 14px" onclick="openCheckin()">Log a check-in</button>`;
  if(!M.length){
    $("pg-body").innerHTML=btn+`<div class="emptymsg">Weigh in two or three mornings a week. Measure your waist and take photos every couple of weeks.<br><br>The weekly trend tells you whether the calories are right far better than any single morning on the scale.</div>`;
    return;
  }
  const rate=st&&st.all.rate,wd=ws.length>1?Math.round((ws[0].waist-ws[ws.length-1].waist)*10)/10:null;
  let html=`<div class="statgrid three">
      <div class="stat"><div class="v">${st?fmtKg(st.all.avg):"—"}</div><div class="k">Avg kg</div></div>
      <div class="stat"><div class="v">${rate==null?"—":(rate>0?"+":"")+fmtKg(rate)}</div><div class="k">kg a week</div></div>
      <div class="stat"><div class="v">${ws.length?fmtKg(ws[0].waist):"—"}</div><div class="k">${wd==null?"Waist cm":"Waist "+(wd>0?"+":"")+fmtKg(wd)}</div></div>
    </div>`+scaleHTML()+btn+bodyChart(M,"kg","Bodyweight","kg")+bodyChart(M,"waist","Waist","cm");
  if(nPh)html+=`<div class="sectlabel">Photos</div><div class="phgrid">${M.flatMap(m=>(m.photos||[]).map(id=>
    `<button class="ph" onclick="openPhoto('${id}')"><img data-pid="${id}" alt="Progress photo, ${fmtDay(m.date)}"><span>${fmtDay(m.date,{day:"numeric",month:"short"})}</span></button>`)).join("")}</div>`;
  html+=`<div class="sectlabel">Check-ins</div>`+M.slice(0,40).map(m=>{
    const bits=[m.waist>0?"waist "+fmtKg(m.waist)+" cm":"",(m.photos||[]).length?m.photos.length+" photo"+(m.photos.length>1?"s":""):""].filter(Boolean);
    return `<button class="recrow" onclick="openCheckin('${m.id}')"><div class="rinfo2"><div class="rn">${fmtDay(m.date)}</div><div class="rd">${bits.join(" · ")||"weigh-in"}</div></div>
      <div class="rv"><b>${m.kg>0?fmtKg(m.kg)+" kg":"—"}</b></div></button>`}).join("");
  $("pg-body").innerHTML=html;
  fillPhotos($("pg-body"));
}

/* ---------- photos: data URLs in IndexedDB under photo:<id>, read once per session ---------- */
const PHOTO={};
async function photoData(id){if(!(id in PHOTO))PHOTO[id]=await IDB.get("photo:"+id);return PHOTO[id]}
function fillPhotos(root){
  root.querySelectorAll("img[data-pid]").forEach(async el=>{
    const d=await photoData(el.dataset.pid);
    if(d)el.src=d;else el.parentElement.classList.add("missing");   /* synced from another phone: the picture stays there */
  });
}
/* downscale on the way in: a 12 MP photo becomes ~1280 px JPEG, a few hundred KB */
function readPhoto(file){
  return new Promise((res,rej)=>{
    const url=URL.createObjectURL(file),img=new Image();
    img.onload=()=>{
      const s=Math.min(1,1280/Math.max(img.naturalWidth,img.naturalHeight)),c=document.createElement("canvas");
      c.width=Math.round(img.naturalWidth*s);c.height=Math.round(img.naturalHeight*s);
      c.getContext("2d").drawImage(img,0,0,c.width,c.height);URL.revokeObjectURL(url);
      res(c.toDataURL("image/jpeg",0.82));
    };
    img.onerror=()=>{URL.revokeObjectURL(url);rej()};
    img.src=url;
  });
}

/* ---------- check-in sheet ---------- */
let CI=null;   /* {id, photos:[{id, fresh}], orig:[ids]} */
function openCheckin(id){
  const today=todayISO();
  const m=(db.metrics||[]).find(x=>id?x.id===id:x.date===today)||null;   /* "Log a check-in" twice in a day opens the same one */
  const lastKg=checkins().find(x=>x.kg>0),lastW=checkins().find(x=>x.waist>0);
  CI={id:m?m.id:null,photos:((m&&m.photos)||[]).map(pid=>({id:pid})),orig:((m&&m.photos)||[]).slice()};
  $("ci-title").textContent=m?"Check-in · "+fmtDay(m.date):"Check-in";
  $("ci-date").value=m?m.date:today;$("ci-date").max=today;
  $("ci-kg").value=m&&m.kg?m.kg:"";$("ci-kg").placeholder=lastKg?fmtKg(lastKg.kg):(db.settings.nutri.kg||"");
  $("ci-waist").value=m&&m.waist?m.waist:"";$("ci-waist").placeholder=lastW?fmtKg(lastW.waist):"";
  $("ci-del").style.display=m?"":"none";
  renderCiPhotos();
  $("cisheet").classList.add("active");tap(8);
}
function closeCheckin(){$("cisheet").classList.remove("active");if(CI)for(const p of CI.photos)if(p.fresh)delete PHOTO[p.id];CI=null}
/* +/− from an empty box starts at your last figure */
function ciBump(f,dir){
  const el=$(f==="kg"?"ci-kg":"ci-waist"),step=f==="kg"?0.1:0.5;
  const v=(parseFloat(el.value)||parseFloat(el.placeholder)||0)+dir*step;
  el.value=fmtKg(Math.max(0,Math.round(v*10)/10));
}
function renderCiPhotos(){
  const box=$("ci-photos");
  box.innerHTML=CI.photos.map((p,i)=>`<div class="thumb"><img data-pid="${p.id}" alt="Photo ${i+1}"><span>${["Front","Side","Back"][i]||""}</span>
      <button onclick="ciRemovePhoto(${i})" aria-label="Remove photo ${i+1}"><svg viewBox="0 0 24 24" class="gico"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>`).join("")
    +(CI.photos.length<4?`<button class="thumb add" onclick="$('ci-file').click()" aria-label="Add a photo"><svg viewBox="0 0 24 24" class="gico"><path d="M12 5v14M5 12h14"/></svg></button>`:"");
  fillPhotos(box);
}
async function ciAddPhoto(input){
  const f=input.files&&input.files[0];input.value="";
  if(!f||!CI)return;
  try{
    const id="p"+Date.now().toString(36)+Math.random().toString(36).slice(2,6);
    PHOTO[id]=await readPhoto(f);CI.photos.push({id,fresh:1});renderCiPhotos();
  }catch(e){toast("That photo couldn't be read")}
}
function ciRemovePhoto(i){const p=CI.photos.splice(i,1)[0];if(p&&p.fresh)delete PHOTO[p.id];renderCiPhotos()}
async function saveCheckin(){
  if(!CI)return;
  const date=$("ci-date").value,kg=parseFloat($("ci-kg").value),waist=parseFloat($("ci-waist").value);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date>todayISO()){toast("Pick a date up to today");return}
  if(!isNaN(kg)&&(kg<30||kg>300)){toast("Bodyweight is in kg");return}
  if(!isNaN(waist)&&(waist<40||waist>200)){toast("Waist is in cm");return}
  if(isNaN(kg)&&isNaN(waist)&&!CI.photos.length){toast("Add a weight, a waist or a photo");return}
  /* pictures go to IndexedDB only; the check-in keeps their ids */
  for(const p of CI.photos)if(p.fresh){await IDB.set("photo:"+p.id,PHOTO[p.id]);if(!await IDB.get("photo:"+p.id)){toast("Photo couldn't be stored: the phone may be out of space");return}}
  const ids=CI.photos.map(p=>p.id);
  for(const id of CI.orig)if(!ids.includes(id)){await IDB.del("photo:"+id);delete PHOTO[id]}
  let m=CI.id&&db.metrics.find(x=>x.id===CI.id);
  if(!m){m={id:"c"+Date.now().toString(36)};db.metrics.push(m)}
  Object.assign(m,{date,kg:isNaN(kg)?null:Math.round(kg*10)/10,waist:isNaN(waist)?null:Math.round(waist*10)/10,photos:ids,t:Date.now()});
  const tr=weightTrend(db.metrics,todayISO());
  if(!isNaN(kg)&&tr)db.settings.nutri.kg=tr.avg;   /* the nutrition guide's bodyweight follows the scale */
  CI.photos.forEach(p=>{delete p.fresh});
  $("cisheet").classList.remove("active");CI=null;
  save();haptic("log");toast("Check-in saved");rerenderBody();
}
async function deleteCheckin(){
  const m=CI&&CI.id&&db.metrics.find(x=>x.id===CI.id);if(!m)return;
  $("cisheet").classList.remove("active");
  if(!await ask({title:"Delete this check-in?",body:`<b>${fmtDay(m.date)}</b>${(m.photos||[]).length?" and its photos":""} will be removed from this phone.`,ok:"Delete",danger:1})){$("cisheet").classList.add("active");return}
  for(const id of m.photos||[]){await IDB.del("photo:"+id);delete PHOTO[id]}
  db.metrics=db.metrics.filter(x=>x!==m);closeCheckin();
  save();toast("Check-in deleted");rerenderBody();
}

/* ---------- photo viewer: step through by date, or side by side with the first ---------- */
let PVW=null;
function openPhoto(id){
  const list=[];for(const m of checkins().reverse())(m.photos||[]).forEach((pid,idx)=>list.push({id:pid,idx,date:m.date}));   /* oldest first */
  PVW={list,i:Math.max(0,list.findIndex(p=>p.id===id)),cmp:false};
  renderPhotoView();$("photoview").classList.add("active");tap(6);
}
function closePhoto(){$("photoview").classList.remove("active");PVW=null}
function stepPhoto(dir){if(!PVW)return;const i=Math.max(0,Math.min(PVW.list.length-1,PVW.i+dir));if(i!==PVW.i){PVW.i=i;haptic("select");renderPhotoView()}}
function toggleCompare(){if(!PVW)return;PVW.cmp=!PVW.cmp;haptic("select");renderPhotoView()}
function renderPhotoView(){
  const p=PVW.list[PVW.i];if(!p){closePhoto();return}
  const base=PVW.cmp?(PVW.list.find(q=>q.idx===p.idx)||PVW.list[0]):null,two=!!(base&&base.id!==p.id);   /* the earliest photo in the same position */
  const fig=q=>`<figure><img data-pid="${q.id}" alt="Progress photo, ${fmtDay(q.date)}"><figcaption>${fmtDay(q.date,{day:"numeric",month:"short",year:"numeric"})}</figcaption></figure>`;
  $("pv-imgs").innerHTML=(two?fig(base):"")+fig(p);
  $("pv-imgs").classList.toggle("two",two);
  $("pv-count").textContent=(PVW.i+1)+" of "+PVW.list.length;
  $("pv-prev").disabled=PVW.i===0;$("pv-next").disabled=PVW.i===PVW.list.length-1;
  $("pv-cmp").textContent=PVW.cmp?"Show one":"Compare with first";$("pv-cmp").disabled=PVW.list.length<2;
  fillPhotos($("pv-imgs"));
}

/* ================= SETTINGS ================= */
function renderSettings(){
  $("set-sub").textContent=isOpen()?`${db.plan.name} · week ${curWeek()} · ${db.archive.length} archived block${db.archive.length===1?"":"s"}`:"Block "+db.block+" · "+(db.archive.length+1)+" block"+(db.archive.length?"s":"")+" on record";
  $("set-ver").textContent="ATLAS "+APP_VERSION;
  const nEx=dayIds().reduce((a,d)=>a+DAYS[d].ex.length,0);
  $("set-progsub").textContent=(db.programmeName||"Custom programme")+" · "+dayIds().length+" day"+(dayIds().length===1?"":"s")+" · "+nEx+" exercises";
  const days=db.lastBackup?Math.floor((Date.now()-db.lastBackup)/86400000):null;
  $("set-backupsub").textContent=db.lastBackup
    ?(days===0?"Last backed up today":"Last backed up "+days+" day"+(days===1?"":"s")+" ago")
    :"Never backed up";
  $("rollover-btn").style.display=isOpen()?"none":"";
  $("set-rollsub").textContent=blockComplete()
    ?`Week ${WEEKS()} complete — ready to roll over`
    :`Week ${WEEKS()} isn't finished yet`;
  renderTrainSettings();renderDrive();renderReminders();
  renderOled();renderTextSize();
  $("set-theme").innerHTML=[["auto","Auto"],["dark","Dark"],["light","Light"]].map(([k,l])=>
    `<button class="seg ${db.settings.theme===k?"sel":""}" aria-pressed="${db.settings.theme===k}" onclick="setTheme('${k}')">${l}</button>`).join("");
}
/* ---------- reminders: a recurring calendar event per training day ---------- */
function renderReminders(){
  const el=$("set-remind");if(!el)return;
  const days=dayIds().filter(d=>DAYS[d].ex.length);
  const fixed=days.length<=7;
  if(!days.length){el.innerHTML=`<div class="setrow"><div class="lrtext"><b>Training reminders</b><i>Add some lifts to your programme first.</i></div></div>`;return}
  const wd=remindWeekdays(days);
  const pickable=!isOpen()&&fixed;   /* block plans have no fixed weekdays: choose them */
  el.innerHTML=`<div class="setrow col">
    <div class="lrtext"><b>Training reminders</b><i>${fixed
      ?`Adds one repeating event per training day (${wd.map(i=>WEEKDAYS[i]).join(", ")}) to your calendar, with an alert. Reliable on every phone, unlike web notifications, and it keeps working when the app is closed.`
      :"Your programme has more than seven days, so it can't map onto weekdays."}</i></div>
    ${pickable?`<div class="libchips wrap" aria-label="Training weekdays">${WEEKDAYS.map((n,i)=>`<button class="libchip ${wd.includes(i)?"sel":""}" aria-pressed="${wd.includes(i)}" onclick="toggleRemindDay(${i})">${n}</button>`).join("")}</div>
      <div class="hsets" style="color:var(--ink-faint)">Pick ${days.length} day${days.length>1?"s":""} for your ${days.length} training day${days.length>1?"s":""}.</div>`:""}
    ${fixed?`<div style="display:flex;gap:8px;align-items:center">
      <input type="time" id="remind-time" class="searchbar" style="margin:0;flex:1" value="${esc(db.settings.remindTime||"17:30")}" aria-label="Reminder time" onchange="db.settings.remindTime=this.value;save()">
      <button class="bigbtn primary" style="flex:1.3;padding:13px" onclick="addReminders()">Add to calendar</button></div>`:""}
  </div>`;
}
/* which weekday each training day lands on: open plans are fixed Mon→, block plans use the chosen days (default Mon→) */
function remindWeekdays(days){
  const chosen=Array.isArray(db.settings.remindDays)?db.settings.remindDays.filter(i=>i>=0&&i<7).sort((a,b)=>a-b):[];
  if(!isOpen()&&chosen.length===days.length)return chosen;
  return days.map((d,i)=>i);
}
function toggleRemindDay(i){
  const days=dayIds().filter(d=>DAYS[d].ex.length);
  let cur=Array.isArray(db.settings.remindDays)?db.settings.remindDays.slice():remindWeekdays(days);
  cur=cur.includes(i)?cur.filter(x=>x!==i):[...cur,i].sort((a,b)=>a-b);
  if(cur.length>days.length)cur=cur.slice(-days.length);
  db.settings.remindDays=cur;save();haptic("select");renderReminders();
}
async function addReminders(){
  const t=($("remind-time")&&$("remind-time").value)||"17:30";
  db.settings.remindTime=t;save();
  const days=dayIds().filter(d=>DAYS[d].ex.length),wd=remindWeekdays(days);
  if(!days.length){toast("Add some lifts first");return}
  const evs=days.map((d,i)=>({weekday:wd[i],title:`ATLAS · Day ${d} · ${DAYS[d].title}`,desc:`${DAYS[d].ex.length} lifts. Open ATLAS to start.`}));
  const ics=buildICS(evs,t,todayISO(),0);
  const res=await shareOrDownload("atlas-training.ics",ics,"text/calendar");
  if(res!=="cancelled")toast(res==="shared"?"Calendar file shared — open it with Google Calendar":"Calendar file saved — open it to add the events");
}

/* ---------- report a problem ---------- */
function buildReport(){
  const ua=navigator.userAgent.replace(/\)\s.*$/,")");
  const lines=[`ATLAS ${APP_VERSION}`,`Device: ${ua}`,`Screen: ${screen.width}×${screen.height} @${Math.round(devicePixelRatio*100)/100} · ${matchMedia("(display-mode: standalone)").matches?"installed":"browser tab"}`,
    `Theme: ${db.settings.theme} · Plan: ${db.plan.name}${isOpen()?" (open, week "+curWeek()+")":" ("+WEEKS()+" weeks, week "+db.selWeek+")"}`,
    `Programme: ${db.programmeName} · ${dayIds().length} days · ${Object.keys(db.logs).length} sessions this block · ${db.archive.length} archived`,
    `Drive sync: ${driveOn()?"on"+(db.sync.error?" · last error "+db.sync.error:"")+(db.sync.lastSync?" · last sync "+new Date(db.sync.lastSync).toISOString().slice(0,16):" · never synced"):"off"} · Last backup: ${db.lastBackup?new Date(db.lastBackup).toISOString().slice(0,10):"never"}`,
    `Storage: ${Math.round((localStorage.getItem(KEY)||"").length/1024)} KB saved · updatedAt ${db.updatedAt?new Date(db.updatedAt).toISOString().slice(0,16):"0"}${SAVE_ERR?" · LAST SAVE FAILED: "+SAVE_ERR:""}`,
    `Recent errors: ${db.errors&&db.errors.length?"\n  "+db.errors.map(e=>e.t+" "+e.m).join("\n  "):"none"}`,
    "","What happened:","","What I expected:",""];
  return lines.join("\n");
}
function reportProblem(){
  const txt=buildReport();
  const opts=[{label:"Share the report…",value:"share"},{label:"Copy to clipboard",value:"copy"}];
  if(typeof REPORT_URL!=="undefined"&&REPORT_URL)opts.push({label:"Open a GitHub issue",value:"gh"});
  chooseSheet("Report a problem","The report has the app version, phone, screen and the last few errors. No sets or personal data.",opts,async v=>{
    if(v==="share"){try{if(navigator.share){await navigator.share({title:"ATLAS problem report",text:txt});return}}catch(e){if(e&&e.name==="AbortError")return}v="copy"}
    if(v==="copy"){try{await navigator.clipboard.writeText(txt);toast("Report copied — paste it into a message to whoever gave you ATLAS")}catch(e){toast("Couldn't copy on this browser")}return}
    if(v==="gh")open(REPORT_URL+(REPORT_URL.includes("?")?"&":"?")+"title="+encodeURIComponent("Problem in ATLAS "+APP_VERSION)+"&body="+encodeURIComponent(txt),"_blank","noopener");
  });
}

/* ---------- appearance ---------- */
function applyTheme(){
  const pref=db.settings.theme||"dark";
  const light=pref==="light"||(pref==="auto"&&matchMedia("(prefers-color-scheme: light)").matches);
  document.documentElement.dataset.theme=light?"light":"dark";
  document.documentElement.dataset.oled=(!light&&db.settings.oled)?"1":"0";
  document.documentElement.style.fontSize=(16*((db.settings.textScale||100)/100))+"px";   /* zoom stays locked; this is the text-size control */
  const m=document.querySelector('meta[name="theme-color"]');if(m)m.content=light?"#F3F4F8":(db.settings.oled?"#000000":"#0A0B0F");
}
function setTheme(k){db.settings.theme=k;save();applyTheme();renderSettings();tap(6)}
function setOled(on){db.settings.oled=!!on;save();applyTheme();renderSettings();tap(6)}
function setTextSize(pct){db.settings.textScale=pct;save();applyTheme();renderSettings();tap(6)}
function renderTextSize(){
  const cur=db.settings.textScale||100;
  $("set-textsize").innerHTML=[[90,"Smaller"],[100,"Default"],[110,"Larger"],[120,"Largest"]].map(([k,l])=>
    `<button class="seg ${cur===k?"sel":""}" aria-pressed="${cur===k}" onclick="setTextSize(${k})">${l}</button>`).join("");
}
function renderOled(){
  const on=!!db.settings.oled;
  $("set-oled").innerHTML=`<div class="setrow"><div class="lrtext"><b>True black</b><i>Pure black background in the dark theme. Saves battery on OLED screens.</i></div>
    <button class="pill ${on?"ss":""}" role="switch" aria-checked="${on}" aria-label="True black" onclick="setOled(${!on})">${on?"ON":"OFF"}</button></div>`;
}
matchMedia("(prefers-color-scheme: light)").addEventListener("change",()=>{if(db.settings.theme==="auto")applyTheme()});
/* ---------- bar, plates and rest defaults ---------- */
function renderTrainSettings(){
  const st=db.settings;
  const row=(label,sub,fn,val,step,unit,mode)=>`<div class="setrow"><div class="lrtext"><b>${label}</b><i>${sub}</i></div>${stepperHTML(fn,val,step,label,unit,mode)}</div>`;
  $("set-train").innerHTML=
    row("Bar weight","What the plate calculator and warm-up load onto","setBar",st.bar,2.5,"kg")+
    `<div class="setrow col"><div class="lrtext"><b>Plates available</b><i>Per side, in kg. Tap to match what your gym has.</i></div>
     <div class="libchips wrap">${PLATE_OPTIONS.map(p=>`<button class="libchip ${st.plates.includes(p)?"sel":""}" aria-pressed="${st.plates.includes(p)}" onclick="togglePlate(${p})">${p}</button>`).join("")}</div></div>`+
    row("Rest · compounds","After a compound set","setRestComp",st.rest.comp,15,"s","numeric")+
    row("Rest · accessories","After an accessory set","setRestAcc",st.rest.acc,15,"s","numeric")+
    row("Rest · superset","Between the two paired lifts (0 = none)","setRestSuper",st.rest.super,5,"s","numeric")+
    `<div class="setrow"><div class="lrtext"><b>Rest alerts when the screen is off</b><i>${notifyState()}</i></div>
      <button class="pill ${db.settings.restNotify?"ss":""}" role="switch" aria-checked="${!!db.settings.restNotify}" aria-label="Rest alerts" onclick="toggleRestNotify()">${db.settings.restNotify?"ON":"OFF"}</button></div>`;
}
function notifyState(){
  if(!window.Notification)return "This phone's browser can't show notifications from a web app.";
  if(Notification.permission==="denied")return "Blocked in the browser's site settings.";
  return db.settings.restNotify?"A notification when the rest timer ends while ATLAS is in the background.":"Off. The in-app timer, vibration and tone still work while the screen is on.";
}
async function toggleRestNotify(){
  if(db.settings.restNotify){db.settings.restNotify=false;save();renderTrainSettings();return}
  if(!window.Notification){toast("Notifications aren't available here");return}
  try{const p=await Notification.requestPermission();db.settings.restNotify=p==="granted";if(p!=="granted")toast("Permission wasn't granted")}catch(e){}
  save();renderTrainSettings();
}
function setNum(get,put,delta,typed,min,roundTo){
  let v=typed!=null&&typed!==""?parseFloat(typed):get()+delta;
  if(isNaN(v))v=get();
  v=Math.max(min,Math.round(v/roundTo)*roundTo);
  put(Math.round(v*100)/100);save();renderTrainSettings();
}
function setBar(d,t){setNum(()=>db.settings.bar,v=>db.settings.bar=v,d,t,0,0.5)}
function setRestComp(d,t){setNum(()=>db.settings.rest.comp,v=>db.settings.rest.comp=v,d,t,5,5)}
function setRestAcc(d,t){setNum(()=>db.settings.rest.acc,v=>db.settings.rest.acc=v,d,t,5,5)}
function setRestSuper(d,t){setNum(()=>db.settings.rest.super,v=>db.settings.rest.super=v,d,t,0,5)}
function togglePlate(p){
  const pl=db.settings.plates;
  if(pl.includes(p)){if(pl.length===1){toast("Keep at least one plate");return}pl.splice(pl.indexOf(p),1)}
  else pl.push(p);
  pl.sort((a,b)=>b-a);save();renderTrainSettings();
}

/* ================= NUTRITION GUIDE ================= */
function setNutri(k,v){
  const n=db.settings.nutri;
  if(["kg","cm","age"].includes(k)){const x=parseFloat(v);if(isNaN(x))return renderNutri();n[k]=Math.round(x*10)/10}
  else{if(k==="goal"&&n.goal!==v){delete n.adj;delete n.adjAt}n[k]=v}   /* a scale adjustment belongs to the goal it was made for */
  save();haptic("select");renderNutri();
}
function renderNutri(){
  const n=db.settings.nutri,days=dayIds().length;
  const t=nutritionTargets(Object.assign({days},n));
  const chip=(k,v,label)=>`<button class="libchip ${n[k]===v?"sel":""}" aria-pressed="${n[k]===v}" onclick="setNutri('${k}','${v}')">${label}</button>`;
  const num=(k,label,sub,unit)=>`<div class="nrow"><div class="lrtext"><b>${label}</b><i>${sub}</i></div><div style="display:flex;align-items:center;gap:6px"><input class="nin" type="number" inputmode="decimal" value="${n[k]}" onchange="setNutri('${k}',this.value)" aria-label="${label}"><span class="sunit">${unit}</span></div></div>`;
  const goalTxt={cut:"Lose fat, keep muscle",maintain:"Hold weight, build slowly",gain:"Lean gain"}[n.goal];
  const weighed=(db.metrics||[]).some(m=>m&&m.kg>0);
  let html=`<div class="ncalc">
    ${num("kg","Bodyweight",weighed?"Your 7-day average, updated each time you log a weigh-in":"Weigh in the morning, after the loo, before food","kg")}
    ${num("cm","Height","","cm")}
    ${num("age","Age","","yrs")}
    <div class="nrow"><div class="lrtext"><b>Sex</b><i>Changes the resting estimate</i></div><div class="libchips wrap">${chip("sex","m","Male")}${chip("sex","f","Female")}</div></div>
    <div class="nrow"><div class="lrtext"><b>Daily steps</b><i>Outside the gym</i></div><div class="libchips wrap">${chip("steps","low","Under 5k")}${chip("steps","mid","5 to 8k")}${chip("steps","high","8k+")}</div></div>
    <div class="nrow"><div class="lrtext"><b>Training days</b><i>From your programme</i></div><span class="sunit" style="font-weight:700;color:var(--ink)">${days} / week</span></div>
    <div class="nrow"><div class="lrtext"><b>Goal</b><i>${goalTxt}</i></div><div class="libchips wrap">${chip("goal","cut","Cut")}${chip("goal","maintain","Maintain")}${chip("goal","gain","Gain")}</div></div>`;
  if(t){
    html+=`<div class="nout">
      <div class="pvstat main"><div class="v">${t.kcal}</div><div class="k">kcal / day</div></div>
      <div class="pvstat"><div class="v">${t.protein}g</div><div class="k">Protein</div></div>
      <div class="pvstat"><div class="v">${t.carbs}g</div><div class="k">Carbs</div></div>
      <div class="pvstat"><div class="v">${t.fat}g</div><div class="k">Fat</div></div></div>
    <div class="nnote">Estimated maintenance <b>~${t.maint} kcal</b>. Aim for ${t.lo} to ${t.hi} and expect <b>${t.rate}</b>${n.goal==="maintain"?"":` (about ${t.kgLo} to ${t.kgHi} kg a week)`}. Hit the protein every day; carbs and fat can flex around it.</div>`
      +scaleHTML();
  }else html+=`<div class="nnote">Fill in weight, height and age to get numbers.</div>`;
  html+=`</div>`;
  const sect=(title,items)=>`<div class="nsect">${title}</div><div class="formcard"><ul>${items.map(i=>"<li>"+i+"</li>").join("")}</ul></div>`;
  html+=sect("How to use the number",[
    "Treat it as a starting point, not a verdict. Formulas are typically within 10% of reality, which is 250 kcal either way.",
    "Weigh yourself most mornings and compare <b>weekly averages</b>, never single days. Water, salt and carbs swing the scale by a kilo overnight.",
    "Give a number two full weeks. If the weekly average is moving the wrong way or too fast, change intake by 100 to 150 kcal and wait another two weeks.",
    "Training six days a week burns more than three. If your programme changes, come back and check the estimate."]);
  html+=sect("Protein",[
    "1.6 to 2.2 g per kg of bodyweight a day covers everyone who lifts. More than that has no measurable benefit for muscle.",
    "Spread it over three or four meals of 30 to 50 g. Timing around the session matters far less than the daily total.",
    "Cheapest reliable sources: chicken thigh, eggs, Greek yoghurt, skimmed milk, tinned tuna, lean mince, whey."]);
  html+=sect("Carbs and fat",[
    "Fat at roughly 0.8 to 1 g per kg keeps hormones and joints happy. Below about 50 g a day most people feel it.",
    "Carbs fill the rest and fuel hard sets. On a 0 to 1 RIR programme, under-eating carbs shows up as reps dropping set to set.",
    "A meal with carbs one to three hours before training is worth more than anything you eat after."]);
  html+=sect("Gaining muscle",[
    "A surplus of 200 to 300 kcal is enough. Bigger surpluses build fat faster than muscle once you are past the beginner stage.",
    "0.25 to 0.5% of bodyweight a week is the target rate. For 75 kg that is 0.2 to 0.4 kg a week, 1 to 1.5 kg a month.",
    "If the scale is flat for three weeks and your lifts are stalling, eat more. If it is moving faster than the range, pull 100 kcal."]);
  html+=sect("Cutting",[
    "0.5 to 1% of bodyweight a week. Faster than that and strength drops and muscle goes with the fat.",
    "Keep protein at the top of the range and keep the heavy lifting in. Cardio is optional; steps are the easiest lever.",
    "Take a week at maintenance every 6 to 8 weeks of dieting. It lines up nicely with the programme's light week."]);
  html+=sect("Small things that help",[
    "Creatine monohydrate, 3 to 5 g every day, is the only supplement with strong evidence for strength and size. Everything else is optional.",
    "Two to three litres of fluid a day. Add salt if you sweat a lot; cramping in long sessions is usually salt, not water.",
    "Sleep is the anabolic you are not taking. Seven hours plus, and it shows up in the log within a fortnight.",
    "The light week is a good time to eat at maintenance whatever your goal."]);
  html+=`<div class="hsets" style="padding:14px 4px 6px;color:var(--ink-faint)">General guidance for healthy adults, not medical advice. If you have a medical condition or are pregnant, get personal advice.</div>`;
  $("nutri-body").innerHTML=html;
}

/* ================= PROGRAMME EDITOR ================= */
const esc=v=>String(v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/"/g,"&quot;");
/* Moves this day's logs and swaps in lockstep with a structural edit (core.remapSlots) */
function remapDay(d,transform){remapSlots(db.logs,db.swaps,d,DAYS[d].ex.length,transform,WEEKS())}
function slotHasLogs(d,i){
  for(let w=1;w<=WEEKS();w++){
    const L=db.logs[logKey(w,d)];
    if(L&&L.ex[i]&&L.ex[i].some(s=>s&&s.kg!=null))return true;
  }
  return false;
}
function progChanged(){
  DAYS=db.programme;for(const d of dayIds())normaliseSupersets(DAYS[d].ex);
  if(PROGRAMME_TEMPLATES.some(t=>t.name===db.programmeName)&&!sameProgramme(db.programme,PROGRAMME_TEMPLATES.find(t=>t.name===db.programmeName).programme))db.programmeName="Custom programme";
  save();renderProg();
}
function sameProgramme(a,b){return JSON.stringify(a)===JSON.stringify(b)}
function setDayTitle(d,v){DAYS[d].title=v.trim()||"Untitled day";progChanged()}
function setRange(d,i,v){
  const r=normaliseRange(v);
  if(!r){toast("Use a range like 8–12");renderProg();return}
  DAYS[d].ex[i][1]=r;progChanged();
}
/* Superset control: the first of a pair toggles it, the second just shows the link */
function ssCtl(d,i){
  const exs=DAYS[d].ex;
  if(i>0&&exOpt(exs[i-1],"ss"))return `<span class="pill ss">⇄ PAIRED</span>`;
  if(i===exs.length-1)return "";
  const on=exOpt(exs[i],"ss");
  return `<button class="pill ${on?"ss":""}" role="switch" aria-checked="${!!on}" aria-label="Superset with the next lift" onclick="toggleSS('${d}',${i})">⇄ ${on?"SUPERSET":"PAIR"}</button>`;
}
function toggleSS(d,i){setExOpt(DAYS[d].ex[i],"ss",exOpt(DAYS[d].ex[i],"ss")?0:1);progChanged()}
/* pin a slot's set count; blank returns it to the plan's compound/accessory default */
function setSlotSets(d,i,v){
  v=String(v).trim().replace(/×/g,"");
  const n=parseInt(v);
  if(v!==""&&(isNaN(n)||n<1||n>8)){toast("Sets 1 to 8, or blank for the plan default");renderProg();return}
  setExOpt(DAYS[d].ex[i],"sets",v===""?0:n);progChanged();
}
function toggleComp(d,i){DAYS[d].ex[i][2]=DAYS[d].ex[i][2]?0:1;progChanged()}
function moveEx(d,i,dir){
  const j=i+dir;
  if(j<0||j>=DAYS[d].ex.length)return;
  remapDay(d,a=>{const t=a[i];a[i]=a[j];a[j]=t;return a});
  const e=DAYS[d].ex;const t=e[i];e[i]=e[j];e[j]=t;
  progChanged();
}
async function removeEx(d,i){
  const name=exName(d,i);
  if(slotHasLogs(d,i)&&!await ask({title:"Remove "+name+"?",
    body:"Sets you already logged stay in your history and records — the lift just leaves the plan.",
    ok:"Remove",danger:1}))return;
  remapDay(d,a=>{a.splice(i,1);return a});
  DAYS[d].ex.splice(i,1);
  progChanged();toast(name+" removed");
}
function addDay(){
  const used=new Set(dayIds());
  const letter="ABCDEFGH".split("").find(c=>!used.has(c));
  if(!letter){toast("Eight days is plenty");return}
  DAYS[letter]={title:"New day",ex:[]};
  progChanged();toast("Day "+letter+" added");
}
async function removeDay(d){
  if(dayIds().length<2){toast("Keep at least one day");return}
  if(!await ask({title:"Delete day "+d+"?",
    body:"Everything logged against it <b>this block</b> is deleted. Archived blocks keep their copy.",
    ok:"Delete day",danger:1}))return;
  for(let w=1;w<=WEEKS();w++)delete db.logs[logKey(w,d)];
  for(let i=0;i<DAYS[d].ex.length;i++)delete db.swaps[d+"-"+i];
  delete DAYS[d];
  progChanged();
}
async function resetProgramme(){
  const hasLogs=Object.keys(db.logs).length>0;
  if(!await ask({title:"Reset the programme?",
    body:hasLogs?"Every day and exercise goes back to the default. This block is filed in the archive first, so its sets stay attached to the lifts they were done on.":"Every day and exercise goes back to the default.",
    ok:hasLogs?"Archive and reset":"Reset",danger:1}))return;
  if(hasLogs){db.streakCarry={s:sessionStreakNow(),w:weekStreakNow()};archiveCurrent()}
  db.programme=clone(DEFAULT_DAYS);db.swaps={};db.programmeName="ATLAS full body";
  progChanged();toast("Programme reset");
}
/* ---------- block structure ---------- */
function setStartDate(v){
  if(!v||!/^\d{4}-\d{2}-\d{2}$/.test(v))return;
  db.plan.startDate=isoDate(mondayOf(v));db.startedOn=v;db.autoWeekFor=null;
  db.selWeek=curWeek();planChanged();toast("Week 1 starts "+db.plan.startDate+" · this is week "+curWeek());
}
/* move a logged session to another week (e.g. one that landed in the wrong week after a plan switch) */
function moveSessionSheet(w,d){
  const opts=[];
  for(let t=1;t<=WEEKS();t++){if(t===w)continue;const L=db.logs[logKey(t,d)];if(L&&loggedSets(t,d))continue;opts.push({label:`Week ${t} · ${phaseLabel(t)}${isOpen()&&t===curWeek()?" · this week":""}`,value:String(t)})}
  if(!opts.length){toast("Every other week already has a day "+d);return}
  chooseSheet("Move this session","Day "+d+" of week "+w+" moves with all its sets. Weeks that already have a day "+d+" logged aren't offered.",opts,t=>moveSession(w,d,+t));
}
function moveSession(w,d,toW){
  const from=logKey(w,d),to=logKey(toW,d);
  if(!db.logs[from]||(db.logs[to]&&hasSets(db.logs[to])))return;   /* an empty entry at the target is fine to replace */
  db.logs[to]=db.logs[from];delete db.logs[from];
  if(db.session&&db.session.w===w&&db.session.d===d)db.session.w=toW;
  PV={w:toW,d};db.selWeek=toW;save();haptic("log");
  if(document.querySelector(".screen.active").id==="scr-done")showDone(toW,d,true);else renderPreview();
  toast("Moved to week "+toW);
}
function weekHasLogs(w){return dayIds().some(d=>loggedSets(w,d)>0)}
function planChanged(){db.plan=validatePlan(db.plan,DEFAULT_PLAN,PHASES);if(db.selWeek>WEEKS())db.selWeek=WEEKS();save();renderProg()}
async function applyPreset(n){
  const weeks=PLAN_PRESETS[n];if(!weeks)return;
  if(isOpen()){
    if(Object.keys(db.logs).length){
      if(!await ask({title:"Switch to fixed blocks?",body:`Everything logged under <b>${esc(db.plan.name)}</b> is archived (kept for records and history) and block ${db.block+1} starts at week 1 with the ${n} structure.`,ok:"Archive and switch"}))return;
      archiveCurrent();
    }
    db.plan={name:n,weeks:clone(weeks)};db.selWeek=1;planChanged();toast(n+" blocks · week 1");return;
  }
  const lost=weekNums().filter(w=>w>weeks.length&&weekHasLogs(w));
  if(lost.length){toast(`Week${lost.length>1?"s":""} ${lost.join(", ")} already ${lost.length>1?"have":"has"} sets logged — finish the block first`);return}
  db.plan={name:n,weeks:clone(weeks)};planChanged();toast(n+" plan applied");
}
function setPlanField(w,k,v){
  const wkk=db.plan.weeks[w-1];if(!wkk)return;
  if(k==="rir"){const r=normaliseRange(v);if(!r){toast("RIR like 2 or 3–4");renderProg();return}wkk.rir=r}
  else if(k==="phase")wkk.phase=v;
  else wkk[k]=parseInt(v);
  db.plan.name="Custom";planChanged();
}
function addWeek(){
  if(WEEKS()>=12){toast("Twelve weeks is the longest block");return}
  const last=db.plan.weeks[db.plan.weeks.length-1];
  /* keep a trailing deload last: insert the new week in front of it */
  const nw={phase:"Build",comp:4,acc:3,rir:"2"};
  if(last.phase==="Deload")db.plan.weeks.splice(db.plan.weeks.length-1,0,nw);else db.plan.weeks.push(nw);
  db.plan.name="Custom";planChanged();
}
function removeWeek(w){
  if(WEEKS()<=2){toast("A block needs at least two weeks");return}
  if(weekNums().some(x=>x>=w&&weekHasLogs(x))){toast("Week "+w+" or a later week has sets logged — finish the block first");return}
  db.plan.weeks.splice(w-1,1);db.plan.name="Custom";planChanged();
}
function setOpenField(k,v){
  if(k==="every"){const n=parseInt(v);if(isNaN(n)||n<2||n>12){toast("Light week every 2 to 12 weeks");renderProg();return}db.plan.every=n}
  else if(k==="ramp"){const n=parseInt(v);if(isNaN(n)||n<0||n>4){toast("Ramp-in 0 to 4 weeks");renderProg();return}db.plan.rampWeeks=n}
  else{const i=k==="hard"?0:1;const f=arguments[2],val=arguments[3];
    if(f==="rir"){const r=normaliseRange(val);if(!r){toast("RIR like 0–1");renderProg();return}db.plan.weeks[i].rir=r}else db.plan.weeks[i][f]=parseInt(val)}
  planChanged();
}
function openPlanCardHTML(){
  const P=db.plan,cw=curWeek(),nl=nextLightWeek(P,cw);
  const row=(label,i,cls)=>`<div class="planrow open ${cls}"><span class="wn">${label}</span><span style="font-size:.78rem;font-weight:650;color:var(--ink-dim)">${i===0?"every week":"1 in "+P.every}</span>
      <input class="perange" value="${P.weeks[i].comp}" inputmode="numeric" onchange="setOpenField('${i===0?"hard":"light"}',null,'comp',this.value)" aria-label="${label} compound sets">
      <input class="perange" value="${P.weeks[i].acc}" inputmode="numeric" onchange="setOpenField('${i===0?"hard":"light"}',null,'acc',this.value)" aria-label="${label} accessory sets">
      <input class="perange" value="${esc(P.weeks[i].rir)}" onchange="setOpenField('${i===0?"hard":"light"}',null,'rir',this.value)" aria-label="${label} RIR"><span></span></div>`;
  return `<div class="progday">
    <div class="pdhead"><div class="pdletter"><svg viewBox="0 0 24 24" class="gico"><path d="M4 12a8 8 0 0 1 14.2-5M20 12a8 8 0 0 1-14.2 5"/><path d="M18.5 3.5v3.7h-3.7M5.5 20.5v-3.7h3.7"/></svg></div>
      <div class="lrtext"><b>Open-ended plan</b><i>${esc(P.name)} · week ${cw}</i></div></div>
    <div class="setrow" style="padding:0 0 10px"><div class="lrtext"><b>Week 1 started</b><i>Monday of week 1. Change it if the weeks are labelled wrong; logged sessions keep their week numbers, so move any stray ones from their preview.</i></div>
      <input type="date" class="searchbar" style="margin:0;width:150px;flex-shrink:0" value="${P.startDate||""}" onchange="setStartDate(this.value)" aria-label="Week 1 start date"></div>
    <div class="hsets" style="margin-bottom:10px">Weeks count up from the start date and never reset. Every set to ${esc(P.weeks[0].rir)} RIR on hard weeks; a light week holds the weights and cuts the sets.</div>
    <div class="planrow open head"><span class="wn"></span><span>When</span><span>Comp</span><span>Acc</span><span>RIR</span><span></span></div>
    ${row("Hard",0,"")}${row("Light",1,"")}
    <div class="setrow" style="padding:10px 0 0"><div class="lrtext"><b>Light week every</b><i>Next one is week ${nl}${nl===cw?" (this week)":""}</i></div>
      <div class="stepper small"><button onclick="setOpenField('every',${P.every-1})" aria-label="Fewer weeks">−</button><input type="number" value="${P.every}" onchange="setOpenField('every',this.value)" aria-label="Weeks between light weeks"><button onclick="setOpenField('every',${P.every+1})" aria-label="More weeks">+</button></div><span class="sunit">wk</span></div>
    <div class="setrow" style="padding:10px 0 0"><div class="lrtext"><b>Ramp-in weeks</b><i>${P.rampWeeks?`Weeks 1 to ${P.rampWeeks} at about two-thirds of the sets`:"Full volume from week 1"}</i></div>
      <div class="stepper small"><button onclick="setOpenField('ramp',${(P.rampWeeks||0)-1})" aria-label="Fewer ramp weeks">−</button><input type="number" value="${P.rampWeeks||0}" onchange="setOpenField('ramp',this.value)" aria-label="Ramp-in weeks"><button onclick="setOpenField('ramp',${(P.rampWeeks||0)+1})" aria-label="More ramp weeks">+</button></div><span class="sunit">wk</span></div>
    <div class="libchips wrap" style="margin-top:12px">${Object.keys(PLAN_PRESETS).map(n=>`<button class="libchip" onclick="applyPreset('${n.replace(/'/g,"\\'")}')">Switch to ${n} blocks</button>`).join("")}</div>
    <div class="hsets" style="margin-top:8px;color:var(--ink-faint)">Switching to fixed blocks archives everything logged under this plan and starts block ${db.block+1} at week 1.</div>
  </div>`;
}
function planCardHTML(){
  if(isOpen())return openPlanCardHTML();
  const rows=db.plan.weeks.map((k,i)=>{const w=i+1;
    return `<div class="planrow${weekHasLogs(w)?" logged":""}">
      <span class="wn">W${w}</span>
      <select class="pselect" onchange="setPlanField(${w},'phase',this.value)" aria-label="Week ${w} phase">${PHASES.map(p=>`<option ${p===k.phase?"selected":""}>${p}</option>`).join("")}</select>
      <input class="perange" value="${k.comp}" inputmode="numeric" onchange="setPlanField(${w},'comp',this.value)" aria-label="Compound sets">
      <input class="perange" value="${k.acc}" inputmode="numeric" onchange="setPlanField(${w},'acc',this.value)" aria-label="Accessory sets">
      <input class="perange" value="${esc(k.rir)}" onchange="setPlanField(${w},'rir',this.value)" aria-label="RIR target">
      <button class="miniBtn danger" onclick="removeWeek(${w})" aria-label="Remove week ${w}"><svg viewBox="0 0 24 24" class="gico"><path d="M6.4 6.4 17.6 17.6M17.6 6.4 6.4 17.6"/></svg></button>
    </div>`}).join("");
  return `<div class="progday">
    <div class="pdhead"><div class="pdletter"><svg viewBox="0 0 24 24" class="gico"><rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/></svg></div>
      <div class="lrtext"><b>Block structure</b><i>${WEEKS()} weeks · ${esc(db.plan.name)}</i></div></div>
    <div class="libchips wrap" style="margin-bottom:10px">${Object.keys(PLAN_PRESETS).map(n=>`<button class="libchip ${db.plan.name===n?"sel":""}" onclick="applyPreset('${n.replace(/'/g,"\\'")}')">${n}</button>`).join("")}</div>
    <div class="planrow head"><span class="wn"></span><span>Phase</span><span>Comp</span><span>Acc</span><span>RIR</span><span></span></div>
    ${rows}
    <button class="bigbtn ghost" style="margin-top:10px" onclick="addWeek()">+ Add a week</button>
    <div class="hsets" style="margin-top:8px;color:var(--ink-faint)">Comp and Acc are working sets per lift that week. Weeks with sets logged can't be removed.</div>
  </div>`;
}
function renderProg(){
  let html=`<div class="nudge" style="border-left-color:var(--plate-blue)">Edits apply to the current block onward. Archived blocks keep the programme and block structure they were run under, so old history stays readable.</div>`;
  html+=planCardHTML();
  html+=`<button class="bigbtn ghost" style="margin:0 0 14px" onclick="openBulk()">Set reps for several lifts</button>`;
  for(const d of dayIds()){
    const day=DAYS[d];
    html+=`<div class="progday">
      <div class="pdhead"><div class="pdletter">${d}</div>
        <input class="pdtitle" value="${esc(day.title)}" onchange="setDayTitle('${d}',this.value)" aria-label="Day title">
        <button class="miniBtn danger" onclick="removeDay('${d}')" aria-label="Delete day"><svg viewBox="0 0 24 24" class="gico"><path d="M6.4 6.4 17.6 17.6M17.6 6.4 6.4 17.6"/></svg></button></div>`;
    day.ex.forEach((e,i)=>{
      html+=`<div class="progex" style="flex-wrap:wrap">
        <div style="flex:1 1 100%;min-width:0;display:flex;align-items:center;gap:8px">
          <div style="flex:1;min-width:0"><div class="pename">${esc(exName(d,i))}</div>
          <div class="pemeta">${plannedSets(db.selWeek,d,i)} sets in week ${db.selWeek}${exOpt(e,"sets")?" (pinned)":""}${isUni(exName(d,i))?" · per side":""}${slotHasLogs(d,i)?" · has history":""}</div></div>
          <button class="miniBtn" onclick="removeEx('${d}',${i})" aria-label="Remove exercise"><svg viewBox="0 0 24 24" class="gico"><path d="M6.4 6.4 17.6 17.6M17.6 6.4 6.4 17.6"/></svg></button>
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex:1 1 100%;margin-top:4px">
          <input class="perange" value="${esc(slotRange(db.selWeek,d,i))}" onchange="setRange('${d}',${i},this.value)" aria-label="Rep range">
          <input class="perange sets" value="${exOpt(e,"sets")||""}" placeholder="${setsFor(db.selWeek,e[2])}×" inputmode="numeric" onchange="setSlotSets('${d}',${i},this.value)" aria-label="Sets (blank = plan default)">
          <button class="pill ${e[2]?"comp":""}" onclick="toggleComp('${d}',${i})">${e[2]?"COMPOUND":"ACCESSORY"}</button>
          ${ssCtl(d,i)}
          <div style="flex:1"></div>
          <button class="miniBtn" onclick="moveEx('${d}',${i},-1)" aria-label="Move up"><svg viewBox="0 0 24 24" class="gico"><path d="M12 19V5.6M6.4 11.2 12 5.6l5.6 5.6"/></svg></button>
          <button class="miniBtn" onclick="moveEx('${d}',${i},1)" aria-label="Move down"><svg viewBox="0 0 24 24" class="gico"><path d="M12 5v13.4M6.4 12.8 12 18.4l5.6-5.6"/></svg></button>
        </div></div>`;
    });
    if(!day.ex.length)html+=`<div class="hsets" style="padding:10px 0;color:var(--ink-faint)">No exercises yet.</div>`;
    html+=`<button class="bigbtn ghost" style="margin-top:10px" onclick="openPick('${d}')">+ Add exercise</button></div>`;
  }
  html+=`<button class="bigbtn ghost" onclick="addDay()">+ Add a training day</button>`;
  $("prog-body").innerHTML=html;
}
/* ---------- bulk rep range ---------- */
let BULK=new Set();
function openBulk(){
  if(!dayIds().some(d=>DAYS[d].ex.length)){toast("Add some lifts first");return}
  BULK=new Set();renderBulk();$("bulksheet").classList.add("active");
}
function closeBulk(){$("bulksheet").classList.remove("active")}
function bulkPick(mode){
  BULK=new Set();
  if(mode!=="none")for(const d of dayIds())DAYS[d].ex.forEach((e,i)=>{if(isTimed(e[0]))return;if(mode==="all"||(mode==="comp"?e[2]:!e[2]))BULK.add(d+"-"+i)});   /* seconds-based slots keep their range */
  renderBulk();haptic("select");
}
function bulkToggle(key){if(BULK.has(key))BULK.delete(key);else BULK.add(key);renderBulk()}
function renderBulk(){
  let html="";
  for(const d of dayIds()){
    if(!DAYS[d].ex.length)continue;
    html+=`<div class="hsets" style="font-weight:700;margin:6px 0 6px;color:var(--ink-faint)">${d} · ${esc(DAYS[d].title)}</div>`;
    DAYS[d].ex.forEach((e,i)=>{const k=d+"-"+i,on=BULK.has(k);
      html+=`<button class="subopt bulkrow ${on?"current":""}" role="checkbox" aria-checked="${on}" onclick="bulkToggle('${k}')">
        <span class="bchk">${on?"✓":""}</span><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(exName(d,i))}</span>
        <span class="pemeta" style="flex-shrink:0">${esc(e[1])} · ${e[2]?"comp":"acc"}</span></button>`});
  }
  $("bulklist").innerHTML=html;
  $("bulk-apply").textContent=BULK.size?`Apply to ${BULK.size} lift${BULK.size>1?"s":""}`:"Apply";
  $("bulk-apply").disabled=!BULK.size;
}
function applyBulk(){
  const r=normaliseRange($("bulk-range").value);
  if(!r){toast("Use a range like 8–12");return}
  if(!BULK.size){toast("Tick at least one lift");return}
  const n=bulkRange(DAYS,[...BULK],r);
  closeBulk();progChanged();haptic("log");
  toast(n?`${r} reps set on ${n} lift${n>1?"s":""}`:"Those lifts already use "+r);
}
/* ---------- exercise picker ---------- */
let PICK=null,PICK_EQ="All";
function openPick(d){PICK=d;PICK_EQ="All";$("picksearch").value="";renderPick();$("picksheet").classList.add("active")}
function closePick(){$("picksheet").classList.remove("active")}
function renderPick(){
  const q=$("picksearch").value.trim().toLowerCase();
  $("pickeq").innerHTML=["All",...EQUIPMENT].map(g=>
    `<button class="libchip eq ${g===PICK_EQ?"sel":""}" aria-pressed="${g===PICK_EQ}" onclick="PICK_EQ='${g}';renderPick()">${g}</button>`).join("");
  const words=q.split(/\s+/).filter(Boolean);
  const match=([n,e])=>(PICK_EQ==="All"||e.eq===PICK_EQ)&&(!words.length||words.every(t=>(n+" "+e.eq+" "+e.g+" "+e.pat+" "+[...e.pri,...e.sec].map(m=>MUSCLE_NAMES[m]).join(" ")).toLowerCase().includes(t)));
  let html="";
  for(const g of GROUPS){
    const items=Object.entries(EXDB).filter(([,e])=>e.g===g).filter(match);
    if(!items.length)continue;
    html+=`<div class="sectlabel">${g}</div>`+items.map(([n,e])=>
      `<button class="librow" onclick="pickAdd('${n.replace(/'/g,"\\'")}')">
        <div class="linfo"><div class="lname">${n}</div>
        <div class="lmeta">${e.pri.map(m=>MUSCLE_NAMES[m]).slice(0,2).join(", ")} · ${e.eq}</div></div>
        <svg viewBox="0 0 24 24" class="chev"><path d="M12 5.2v13.6M5.2 12h13.6"/></svg></button>`).join("");
  }
  $("picklist").innerHTML=html||`<div class="emptymsg">Nothing matches "${esc($("picksearch").value)}".</div>`;
}
function pickAdd(name){
  const isComp=isCompPattern(name)?1:0;
  DAYS[PICK].ex.push([name,isTimed(name)?"30–60":isComp?"6–10":"10–15",isComp]);
  closePick();progChanged();toast(name+" added to day "+PICK);
}

/* ================= DATA ================= */
/* Blob + object URL: data: URIs get unreliable on Android as the file grows */
function download(filename,text,mime){
  const url=URL.createObjectURL(new Blob([text],{type:mime+";charset=utf-8"}));
  const a=document.createElement("a");
  a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),4000);
}
/* Prefer the share sheet so a backup can go straight to Drive/Gmail instead of
   dying unnoticed in the Downloads folder; fall back to a plain download. */
async function shareOrDownload(filename,text,mime){
  try{
    const file=new File([text],filename,{type:mime});
    if(navigator.canShare&&navigator.canShare({files:[file]})){
      await navigator.share({files:[file],title:filename});
      return "shared";
    }
  }catch(e){if(e&&e.name==="AbortError")return "cancelled"}
  download(filename,text,mime);
  return "downloaded";
}
async function exportPhotos(){
  const out={};
  for(const m of db.metrics||[])for(const id of m.photos||[]){
    const data=await IDB.get("photo:"+id);
    if(data)out[id]=data;
  }
  return out;
}
async function backupJSON(withPhotos){
  const payload=clone(db);
  payload.exportedAt=new Date().toISOString();
  payload.appVersion=APP_VERSION;
  if(withPhotos)payload.photoBlobs=await exportPhotos();
  const name="atlas-"+new Date().toISOString().slice(0,10)+(withPhotos?"-full":"")+".json";
  const res=await shareOrDownload(name,JSON.stringify(payload),"application/json");
  if(res==="cancelled")return;
  db.lastBackup=Date.now();save({quiet:true});
  const cur=document.querySelector(".screen.active");if(cur&&cur.id==="scr-stats")renderStats();
  toast(res==="shared"?"Backup shared":"Backup saved");
}
function restoreJSON(input){
  const f=input.files[0];if(!f)return;
  const r=new FileReader();
  r.onload=async()=>{
    try{
      const d=JSON.parse(r.result);
      if(typeof d!=="object"||!("logs"in d))throw 0;
      const blocks=1+((d.archive||[]).length)+(d.prev?1:0);
      if(!await ask({title:"Restore this backup?",
        body:"<b>"+blocks+" block"+(blocks>1?"s":"")+"</b>, "+Object.keys(d.logs||{}).length+
          " sessions in the current block.<br><br>Everything currently on this device is replaced.",
        ok:"Restore",danger:1}))return;
      const photos=d.photoBlobs||null;delete d.photoBlobs;
      const keepSync=db.sync;
      db=migrateDb(d);db.sync=Object.assign({},keepSync);   /* the backup's Drive link belongs to whichever phone made it */
      if(photos)for(const[id,data]of Object.entries(photos))await IDB.set("photo:"+id,data);
      DAYS=db.programme;PV=null;
      save();applyTheme();showNow("settings");toast("Backup restored"+(photos?" with photos":""));
      if(driveOn())driveSync({quiet:true});
    }catch(e){toast("That file isn't a valid backup")}
    input.value="";
  };
  r.readAsText(f);
}
function exportCSV(){
  const q=v=>/[",]/.test(v)?'"'+String(v).replace(/"/g,'""')+'"':v;
  let rows=[["block","week","day","date","time","exercise","set","kg","reps_or_seconds","timed","per_side","score_e1rm"]];
  for(const B of allBlocks()){
    for(const[k,L]of Object.entries(B.logs||{})){
      const[w,d]=k.split("-");
      for(const[i,sets]of Object.entries(L.ex||{}))
        sets.forEach((s,si)=>{if(s&&s.kg!=null)
          rows.push([B.block,w,d,L.date||"",s.t?new Date(s.t).toISOString().slice(11,16):"",q(setName(s,B,d,i)),si+1,s.kg,s.reps,s.timed?1:0,s.uni?1:0,setScore(s)])});
    }
  }
  download("atlas-"+new Date().toISOString().slice(0,10)+".csv",rows.map(r=>r.join(",")).join("\n"),"text/csv");
  toast(rows.length-1+" sets exported");
}
/* file the current block: history stays readable under the programme and plan it ran with */
function archiveCurrent(){
  db.archive.push({block:db.block,logs:db.logs,programme:clone(db.programme),
    swaps:clone(db.swaps),plan:clone(db.plan),endedAt:Date.now()});
  db.logs={};db.block++;db.selWeek=1;db.session=null;db.rest=null;db.autoWeekFor=null;
}
async function rollover(){
  if(!blockComplete()&&!await ask({title:`Week ${WEEKS()} isn't finished`,
    body:"You can still close the block out and start the next one.",ok:"Start anyway"}))return;
  if(!await ask({title:"Start block "+(db.block+1)+"?",
    body:"This block is filed in the archive — every past block is kept — and the coach seeds your new weights from recent numbers.",
    ok:"Start block "+(db.block+1)}))return;
  /* archive keeps the programme + swaps this block ran under, so its history
     stays readable even after you edit the programme */
  const carry={s:sessionStreakNow(),w:weekStreakNow()};
  archiveCurrent();
  db.streakCarry=(carry.s||carry.w)?carry:null;   /* a new block is not a broken streak */
  save();show("home");
  if(driveOn())driveSync({quiet:true});
  toast("Block "+db.block+" — previous block archived");
}
async function wipeData(){
  if(!await ask({title:"Erase everything?",
    body:"Every logged set, all blocks, swaps and notes on this phone. <b>This cannot be undone.</b>"+(driveOn()?" The copy in Google Drive is left as it is and sync is switched off.":"")+" Take a backup first if there's any doubt.",
    ok:"Erase it all",danger:1}))return;
  for(const k of await IDB.keys())if(String(k).startsWith("photo:"))await IDB.del(k);
  db=migrateDb({});DAYS=db.programme;PV=null;save();applyTheme();showNow("settings");toast("All data erased");
}

/* ================= INIT ================= */
async function init(){
  if(!db.notes)db.notes={};
  if(!db.metrics)db.metrics=[];
  /* localStorage gone (eviction / new profile) or a write failed there? The IndexedDB
     mirror may hold the newer copy: take whichever updatedAt is later. */
  try{
    let m=await IDB.get("db");if(typeof m==="string")m=JSON.parse(m);
    if(m&&m.logs&&(Object.keys(m.logs).length||(m.archive||[]).length)&&(m.updatedAt||0)>(db.updatedAt||0)){
      db=migrateDb(m);DAYS=db.programme;
      save({quiet:true});toast("Log restored from device mirror");   /* quiet: a stale mirror must not out-rank Drive */
    }
  }catch(e){logErr(e)}
  if(BOOT_ERR){logErr(BOOT_ERR);toast("Saved data couldn't be read — a copy was kept. Restore a backup.")}
  try{if(navigator.storage&&navigator.storage.persist)navigator.storage.persist()}catch(e){}
  DAYS=db.programme;
  /* keep the focused input clear of the Android keyboard */
  document.querySelectorAll('input[type=number]').forEach(el=>{
    el.addEventListener("focus",()=>setTimeout(()=>el.scrollIntoView({block:"center",behavior:"smooth"}),280));
  });
  try{history.scrollRestoration="manual"}catch(e){}   /* we restore scroll ourselves */
  applyTheme();anatBind();
  /* swipe between weeks on Plan and Progression */
  onSwipe($("scr-home"),dir=>{const w=Math.min(WEEKS(),Math.max(1,db.selWeek+dir));db.autoWeekFor=todayISO();if(w!==db.selWeek){haptic("select");db.selWeek=w;save();renderHome()}});
  onSwipe($("photoview"),dir=>stepPhoto(dir));
  onSwipe($("scr-progress"),dir=>{if(PG.tab==="body")return;const w=Math.min(WEEKS(),Math.max(1,(PG.week||db.selWeek)+dir));if(w!==PG.week){haptic("select");PG.week=w;renderProgress()}});
  /* hold a logged set to delete it; hold a library lift to add it to a day */
  onLongPress($("done-list"),".setchip",async el=>{
    if(DONE.past||!el.dataset.w)return;   /* an archived session's chips are read-only */
    const {w,d,ex,si}=el.dataset;const arr=db.logs[logKey(w,d)].ex[ex];const st=arr&&arr[si];if(!st)return;
    if(!await ask({title:"Delete this set?",body:`<b>${fmtSet(st)}</b> on ${st.name||exName(d,+ex)} will be removed from your history.`,ok:"Delete",danger:1}))return;
    arr.splice(+si,1);save();showDone(+w,d,true);toast("Set deleted");
  });
  onLongPress($("liblist"),".librow",el=>{
    const name=el.dataset.name;if(!name)return;
    chooseSheet("Add "+name,"Which training day should it go on?",dayIds().map(d=>({label:"Day "+d+" · "+DAYS[d].title,value:d})),d=>{PICK=d;pickAdd(name)});
  });
  /* swipe down from the top of any sheet to dismiss it; swipe down on the rest veil to peek */
  const closers={swapsheet:closeSwap,editsheet:closeEdit,picksheet:closePick,cfsheet:()=>closeAsk(false),padsheet:closePad,choosesheet:closeChoose,bulksheet:closeBulk,cisheet:closeCheckin};
  for(const [id,fn] of Object.entries(closers)){
    const panel=document.querySelector("#"+id+" .panel");if(!panel)continue;
    let y0=null;
    panel.addEventListener("touchstart",e=>{const r=panel.getBoundingClientRect();y0=e.touches[0].clientY-r.top<56?e.touches[0].clientY:null},{passive:true});
    panel.addEventListener("touchend",e=>{if(y0!=null&&e.changedTouches[0].clientY-y0>70){haptic("select");fn()}y0=null},{passive:true});
  }
  {const v=$("restveil");let y0=0;
    v.addEventListener("touchstart",e=>{y0=e.touches[0].clientY},{passive:true});
    v.addEventListener("touchend",e=>{const dy=e.changedTouches[0].clientY-y0;if(!v.classList.contains("peek")&&dy>80)peekRest(true);else if(v.classList.contains("peek")&&dy<-40)peekRest(false)},{passive:true});
    $("rest-time").parentElement.addEventListener("click",()=>{if(v.classList.contains("peek"))peekRest(false)});
  }
  checkPending();
  document.addEventListener("visibilitychange",()=>{if(!document.hidden&&!S&&checkPending())showNow("home")});
  history.replaceState({scr:"home"},"");
  renderHome();
  if(driveOn())setTimeout(()=>driveSync({quiet:true}),1200);
  /* launcher shortcut (manifest.json → ?start): jump straight to the next session */
  if(new URLSearchParams(location.search).has("start")){
    history.replaceState({scr:"home"},"",location.pathname);
    const w=db.selWeek,nd=dayIds().find(d=>loggedSets(w,d)<totalSets(w,d));
    if(nd)showPreview(w,nd);
  }
}
init();
