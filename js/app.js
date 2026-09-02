/* ATLAS · app: state, screens and rendering. Depends on js/data.js and
   js/core.js being loaded first (classic scripts share one global scope). */

/* ================= STATE ================= */
/* Storage key predates the ATLAS rename and must never change — it is the
   address of every logged set on the device. */
const KEY="block-log-v2";
/* Keep in step with CACHE in sw.js and the ?v= stamps in index.html (tests/version.test.js checks) */
const APP_VERSION="6.6";
let restEnd=0,restTick=null,restDur=1,restLabel="",restHintTxt="";
let S=null;
const migrateDb=d=>migrate(d,DEFAULT_DAYS,DEFAULT_SETTINGS,DEFAULT_PLAN,PHASES);
let db=migrateDb(load());
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
const phaseLabel=w=>isOpen()?(deloadWeek(w)?"Light week":"Hard week"):phaseOf(w);
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
  DAYS[d].ex.forEach((e,i)=>{m+=slotSets(w,d,i)*(e[2]?3.4:2.3)});
  return Math.round(m/5)*5;
}
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
  open(){return new Promise((res,rej)=>{
    const r=indexedDB.open("blocklog",1);
    r.onupgradeneeded=()=>r.result.createObjectStore("kv");
    r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})},
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
  try{localStorage.setItem(KEY,JSON.stringify(db))}catch(e){toast("Storage unavailable — back up now")}
  IDB.set("db",clone(db));
}

/* ================= HELPERS ================= */
const $=id=>document.getElementById(id);
function toast(m,actionLabel,actionFn){
  const t=$("toast");
  t.innerHTML=m+(actionLabel?` <button id="toast-act">${actionLabel}</button>`:"");
  if(actionLabel)$("toast-act").onclick=()=>{t.classList.remove("show");actionFn()};
  t.classList.add("show");clearTimeout(t._h);
  t._h=setTimeout(()=>t.classList.remove("show"),actionLabel?4500:2000);
}
function bumpEl(id,step){
  const el=$(id);let v=parseFloat(el.value)||0;
  v=Math.max(0,Math.round((v+step)*10)/10);
  if(Math.abs(step)===1)v=Math.round(v);
  el.value=v;
}
function setsFor(w,isComp){return isComp?wk(w).comp:wk(w).acc}
/* a slot can pin its own set count ({sets:n}); light weeks scale it to about 60% */
function slotSets(w,d,i){const e=DAYS[d].ex[i];const o=exOpt(e,"sets");if(o)return deloadWeek(w)?Math.max(1,Math.round(o*0.6)):o;return setsFor(w,e[2])}
function totalSets(w,d){return DAYS[d].ex.reduce((a,e,i)=>a+slotSets(w,d,i),0)}
function loggedSets(w,d,logs){logs=logs||db.logs;const L=logs[logKey(w,d)];if(!L)return 0;let n=0;for(const ex of Object.values(L.ex||{}))n+=ex.filter(s=>s&&s.kg!=null).length;return n}
function sessionTonnage(w,d,logs){logs=logs||db.logs;const L=logs[logKey(w,d)];if(!L)return 0;let t=0;for(const ex of Object.values(L.ex||{}))for(const s of ex)if(s&&s.kg!=null)t+=setTonnage(s);return Math.round(t)}
function ytLink(name){return "https://www.youtube.com/results?search_query="+encodeURIComponent(name+" proper form")}
function exName(d,i){return (db.swaps&&db.swaps[d+"-"+i])||(DAYS[d].ex[i]||["—"])[0]}
/* ---------- per-lift settings (Lift screen) over global defaults (Settings) ---------- */
function increment(name){return incrementFor(name,db.lifts,BIG_INC)}
function isUni(name){return isUnilateral(name,db.lifts,EXDB)}
/* seconds instead of reps: encyclopedia default, per-lift override wins */
function isTimed(name){const o=db.lifts[name];if(o&&o.timed!=null)return !!o.timed;return !!(EXDB[name]&&EXDB[name].timed)}
function restSecs(d,i){const e=DAYS[d].ex[i];return restFor(exName(d,i),e[2],db.lifts,db.settings.rest)}
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
function weekComplete(w){const ds=dayIds().filter(d=>totalSets(w,d)>0);return ds.length>0&&ds.every(d=>loggedSets(w,d)>=totalSets(w,d))}
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
  $("nav-home").classList.toggle("active",name==="home"||name==="preview"||name==="settings"||name==="prog");
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
  if(name==="session")measureDock();   /* the dock only has a height once the screen is displayed */
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
  if(veil||sw||ed||pk||cf||pd||ch){
    if(veil)endRest();if(sw)closeSwap();if(ed)closeEdit();if(pk)closePick();if(cf)closeAsk(false);if(pd)closePad();if(ch)closeChoose();
    history.pushState({scr:document.querySelector(".screen.active").id.slice(4)},"");
    return;
  }
  let scr=(e.state&&e.state.scr)||"home";
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
      <div class="hname">Day ${q.d} · ${DAYS[q.d].title}</div>
      <div class="hmeta">Left off at ${exName(q.d,Math.min(q.exIdx,DAYS[q.d].ex.length-1))} · ${mins<60?mins+" min":Math.round(mins/60)+" h"} ago</div></div>
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
    const first=exName(nd,0),h0=prevSession(w,nd,0);
    const firstTxt=DAYS[nd].ex.length
      ?`Starts with <b>${first}</b>${h0?` · last <b>${fmtSet(h0.sets[0])}</b>`:""}`
      :"No lifts on this day yet";
    $("hero").innerHTML=`<button class="hero d${nd}" onclick="shareTitle(this.querySelector('.hname'));showPreview(${w},'${nd}')">
      <div class="hinfo"><div class="hkick">${started?"Continue":(isOpen()&&w===curWeek()&&dayIds()[todayIdx()]===nd?"Today":"Next up")} · Week ${w}${isOpen()&&deloadWeek(w)?" · light":""}</div>
      <div class="hname">${dayWeekday(nd)?dayWeekday(nd)+" · ":"Day "+nd+" · "}${DAYS[nd].title}</div>
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
    if(db.plan.open){db.plan.startDate=isoDate(mondayOf(todayISO()));db.autoWeekFor=null}   /* this calendar week is week 1 */
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
      if(Object.keys(db.logs).length){
        if(!await ask({title:"Archive this block and switch?",
          body:`Everything logged so far is filed in the archive (kept for records, progression and history). <b>${esc(t.name)}</b> then starts fresh${t.plan&&t.plan.open?" with this calendar week as week 1":" at week 1"}.`,
          ok:"Archive and switch"}))return;
        archiveCurrent();
      }
      applyTemplate(id);renderSettings();toast(db.programmeName+" loaded");
      if(id==="blank")go("prog");
    });
}
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
        ?`<div class="introstep"><span class="n">1</span><div><b>An open-ended plan</b><p>Weeks count up from this Monday and never reset. Hard weeks are every set to ${esc(rirOf(1))} RIR; every ${db.plan.every}th week is light: same weights, fewer sets. Postpone it from the Plan screen if you're flying.</p></div></div>`
        :`<div class="introstep"><span class="n">1</span><div><b>Training in blocks</b><p>Sets and intensity climb week by week, then a deload. The default block is six weeks; change the length and phases under Programme → Block structure.</p></div></div>`}
      <div class="introstep"><span class="n">2</span><div><b>RIR is your effort dial</b><p>Reps in reserve. ${isOpen()?"0 to 1 RIR means every set ends at, or one rep before, failure. Stop a heavy compound at 1 when form goes, not muscle.":"3 RIR means stop three reps short of failure. The target tightens as the block goes on."}</p></div></div>
      <div class="introstep"><span class="n">3</span><div><b>The coach picks the weight</b><p>Hit the top of the rep range on every set and it tells you to add load. Miss it and you chase reps at the same weight.</p></div></div>
      <button class="bigbtn ghost" onclick="db.seenIntro=1;save();renderHome()">Got it</button></div>`;
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
    <span>${days===null?"No backup yet":"Last backup "+days+" days ago"} — your history lives only on this phone. <b>Back up now</b></span></button>`;
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
  if(db.selWeek>WEEKS()){db.selWeek=WEEKS();save()}
  const w=db.selWeek;
  const nl=isOpen()?nextLightWeek(db.plan,curWeek()):0;
  const canPostpone=isOpen()&&!weekHasLogs(nl)&&(w===curWeek()||(deloadWeek(w)&&w>=curWeek()));
  $("weekmeta").innerHTML=(isOpen()
      ?`Week ${w}${w===curWeek()?" · this week":w<curWeek()?" · past":" · upcoming"} · <b>${phaseLabel(w)}</b> · target <b>${rirOf(w)} RIR</b> · ${deloadWeek(w)?"same weights, fewer sets":"compounds "+wk(w).comp+" sets, accessories "+wk(w).acc}`
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
      <div class="dayinfo"><div class="dtitle">${DAYS[d].title}</div>
      <div class="dsub">${dayWeekday(d)?dayWeekday(d)+" · ":""}${DAYS[d].ex.length} exercises · ~${estMinutes(w,d)} min</div></div>
      <div class="daystate ${cls}">${state}</div></div>
      <div class="dayprog"><i class="${cls}" style="width:${pct}%"></i></div>`;
    card.onclick=()=>{tap(8);if(total===0){go("prog");return}shareTitle(card.querySelector(".dtitle"));done>=total?showDone(w,d):showPreview(w,d)};
    dl.appendChild(card);
  }
  animateRings();
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
  const L=(db.logs[logKey(w,d)]||{}).ex||{};
  let nextFound=false,html="";
  DAYS[d].ex.forEach((e,i)=>{
    const [,range,isComp]=e;
    const name=exName(d,i);
    const need=slotSets(w,d,i);
    const have=(L[i]||[]).filter(s=>s&&s.kg!=null).length;
    const isDone=have>=need;
    const isNext=!isDone&&!nextFound;
    if(isNext)nextFound=true;
    const hist=prevSession(w,d,i);
    const todaySets=(L[i]||[]).filter(s=>s&&s.kg!=null);
    const lastTxt=todaySets.length?fmtKg(Math.max(...todaySets.map(s=>s.kg)))+" kg today"
      :hist?"last "+fmtSet(hist.sets[0]):"find weight";
    const state=isDone?`<span class="rstate done">✓</span>`
      :have>0?`<span class="rstate part">${have}/${need}</span>`
      :`<span class="rstate">›</span>`;
    html+=`<button class="rstep${isDone?" done":""}${isNext?" next":""}${i===DAYS[d].ex.length-1?" last":""}"
      onclick="openLift('${name.replace(/'/g,"\\'")}','preview')">
      <div class="rrail"><div class="rnode">${isDone?"✓":i+1}</div><div class="rline"></div></div>
      <div class="rbody"><div class="rinfo">
        ${isNext&&done>0?'<div class="nextlabel">Up next</div>':""}
        <div class="rname">${name}</div>
        <div class="rmeta"><span class="rdot" style="background:var(--plate-${isComp?"red":"blue"})"></span>${need} × ${range}${isTimed(name)?" s":""}${isUni(name)?"/side":""}${pairOf(DAYS[d].ex,i)>=0?" · ⇄ superset":""} · ${lastTxt}</div>
      </div>${state}</div></button>`;
  });
  $("pv-route").innerHTML=html;
  $("pv-start").textContent=done>0?`Continue — ${done}/${total} sets done →`:"Start session →";
}

/* ================= SESSION ================= */
function startSession(w,d){
  const k=logKey(w,d);
  if(!db.logs[k])db.logs[k]={date:new Date().toISOString().slice(0,10),ex:{}};
  let exIdx=0,setIdx=0,found=false;
  const exs=DAYS[d].ex;
  for(let i=0;i<exs.length&&!found;i++){
    const need=slotSets(w,d,i);
    const have=(db.logs[k].ex[i]||[]).filter(s=>s&&s.kg!=null).length;
    if(have<need){exIdx=i;setIdx=have;found=true}
  }
  if(!found){showDone(w,d);return}
  S={w,d,exIdx,setIdx};save();
  lockScreen();TON_SHOWN=0;LAST_EX=null;
  renderSet();show("session");
}
function exitSession(){S=null;unlockScreen();save();history.back()}
function resumeSession(){
  const q=db.session;
  if(!q||!DAYS[q.d]){toast("That session is no longer in the plan");db.session=null;save();renderHome();return}
  const k=logKey(q.w,q.d);
  if(!db.logs[k])db.logs[k]={date:new Date().toISOString().slice(0,10),ex:{}};
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
  const target=exName(d,exIdx);
  const pick=(L,ctx)=>{
    if(!L||!L.ex[exIdx])return null;
    const sets=L.ex[exIdx].filter(s=>s&&s.kg!=null);
    if(!sets.length)return null;
    return setName(sets[0],ctx,d,exIdx)===target?sets:null;
  };
  const cur=blockCtx();
  for(let pw=w-1;pw>=1;pw--){
    const sets=pick(db.logs[logKey(pw,d)],cur);
    if(sets)return{w:pw,block:db.block,sets};
  }
  for(let a=db.archive.length-1;a>=0;a--){
    const B=db.archive[a];
    for(const pw of historyOrder(B.plan||DEFAULT_PLAN,B.logs)){
      const sets=pick(B.logs[logKey(pw,d)],B);
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
  const [,range,isComp]=DAYS[d].ex[exIdx];
  const name=exName(d,exIdx);
  const hist=prevSession(w,d,exIdx);
  const timed=isTimed(name),unit=timed?"seconds":"reps",u=timed?" s":"";
  if(deloadWeek(w))return{cls:"hold",ico:CO.deload,txt:`<b>Deload.</b> Same weights as last week, fewer sets, ${rirOf(w)} RIR. Leave the gym feeling fresh.`};
  if(!hist)return{cls:"fresh",ico:CO.fresh,txt:`<b>First time on this lift.</b> Pick a weight you could do ~twice the reps with. Week 1 is for finding numbers, not testing them.`};
  const top=repTop(range);
  const allTop=hist.sets.every(s=>s.reps>=top);
  const ref=hist.block<db.block?`Block ${hist.block} wk ${hist.w}`:`Wk ${hist.w}`;
  if(allTop){
    const inc=increment(name);
    const newKg=hist.sets[0].kg+inc;
    return{cls:"",ico:CO.up,rec:newKg,recReps:repBottom(range),
      txt:`<b>Add ${timed&&hist.sets[0].kg===0?"load":"weight"}: ${fmtKg(newKg)} kg.</b> You hit the top of the range on every set (${ref}). Drop back to ${repBottom(range)}${u} and build up again.`};
  }
  return{cls:"hold",ico:CO.hold,txt:`<b>Same weight, chase ${unit}.</b> ${ref} you got ${hist.sets.map(s=>s.reps+u).join(", ")} — target is ${top}${u} on every set before adding load.`};
}

function renderSet(){
  const {w,d,exIdx,setIdx}=S;
  const [,reps,isComp]=DAYS[d].ex[exIdx];
  const name=exName(d,exIdx);
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
    +(pair>=0?`<span class="tag ss">⇄ Superset · ${exName(d,pair)}</span>`:"");
  const adv=coachAdvice(w,d,exIdx);
  const co=$("ss-coach");co.className="coach "+adv.cls;
  $("ss-coachico").innerHTML=adv.ico;$("ss-coachtxt").innerHTML=adv.txt;
  $("ss-cuelist").innerHTML=((EXDB[name]&&EXDB[name].form)||["No cues stored for this variant — watch the video below before your first set."]).map(c=>"<li>"+c+"</li>").join("");
  $("ss-vid").href=ytLink(name);
  $("ss-cues").open=false;
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
  const hist=prevSession(w,d,exIdx);
  let lastTxt="First time — start light";
  if(hist){const ref=hist.block<db.block?"B"+hist.block+" wk"+hist.w:"Wk "+hist.w;
    lastTxt=`${ref}: <b>${hist.sets.map(x=>fmtSet(x,true)).join(", ")}</b>`}
  $("ss-last").innerHTML=lastTxt;
  /* seed priority: earlier set today > coach's add-weight recommendation > last session */
  const seed=prevSet||(hist?hist.sets[Math.min(setIdx,hist.sets.length-1)]:null);
  $("in-kg").value=prevSet?prevSet.kg:(adv.rec!=null?adv.rec:(seed?seed.kg:""));
  $("in-reps").value=prevSet?prevSet.reps:(adv.rec!=null?adv.recReps:(seed?seed.reps:""));
  const note=db.notes&&db.notes[name];
  $("ss-note").style.display=note?"block":"none";
  if(note)$("ss-note").innerHTML='<svg viewBox="0 0 24 24" class="gico"><path d="M4.5 5.5h15M4.5 10h15M4.5 14.5h9"/></svg> '+esc(note);
  $("ss-prog").style.width=Math.round(100*loggedSets(w,d)/totalSets(w,d))+"%";
  $("ss-setcount").textContent=loggedSets(w,d)+"/"+totalSets(w,d)+" sets";
  tickTon(sessionTonnage(w,d));
  $("ss-upnext").innerHTML=DAYS[d].ex.map((e2,j)=>{
    const need2=slotSets(w,d,j);
    const have2=((db.logs[logKey(w,d)].ex[j])||[]).filter(s=>s&&s.kg!=null).length;
    const st=have2>=need2?"done":j===exIdx?"cur":"";
    const link=j>0&&exOpt(DAYS[d].ex[j-1],"ss")?"⇄ ":"";
    return `<button class="upchip ${st}" ${st==="done"?"disabled":""} onclick="jumpTo(${j})">${st==="done"?"✓ ":(j+1)+". "}${link}${exName(d,j)}</button>`;
  }).join("");
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
function tickTon(to){
  const el=$("ss-ton"),from=TON_SHOWN;if(from===to){el.textContent=to.toLocaleString();return}
  const t0=performance.now(),dur=reduceMotion()?0:520;
  const step=t=>{const p=dur?Math.min(1,(t-t0)/dur):1,e=1-Math.pow(1-p,3);
    el.textContent=Math.round(from+(to-from)*e).toLocaleString();
    if(p<1)requestAnimationFrame(step);else TON_SHOWN=to};
  requestAnimationFrame(step);
}
function jumpTo(i){S.exIdx=i;S.setIdx=firstOpenSet();renderSet();save()}
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
  if(!S||S.exIdx!==0||S.setIdx!==0){box.style.display="none";return}
  const kg=parseFloat($("in-kg").value);
  if(isNaN(kg)||kg<=0){box.style.display="none";return}
  const name=exName(S.d,0);
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
  const name=exName(S.d,S.exIdx);
  if(!isBarbellLift(name)){bar.textContent="";return}
  const kg=parseFloat($("in-kg").value),barKg=db.settings.bar;
  const r=plateBreakdown(kg,barKg,db.settings.plates);
  if(r.belowBar){bar.innerHTML=kg?`Below bar weight (${barKg} kg)`:"";return}
  if(!r.ok){bar.innerHTML=`No clean load for ${kg} kg — nearest: <b>${r.nearest} kg</b>`;return}
  bar.innerHTML=r.perSide.length?`Per side: <b>${r.perSide.join(" + ")}</b> (${barKg} kg bar)`:`Empty bar (${barKg} kg)`;
  measureDock();
}

function bump(f,dir){
  const el=f==="kg"?$("in-kg"):$("in-reps");
  const step=f==="kg"?increment(exName(S.d,S.exIdx)):1;
  let v=parseFloat(el.value)||0;
  v=Math.max(0,snapStep(v+dir*step,step));
  el.value=f==="kg"?fmtKg(v):Math.round(v);
  haptic("select");
  if(f==="kg"){renderPlates();renderWarmup()}
}

function logSet(){
  if(TIMER)stopTimer();
  const kg=parseFloat($("in-kg").value),reps=parseInt($("in-reps").value);
  const {w,d,exIdx,setIdx}=S;
  const timed=isTimed(exName(d,exIdx));
  if(isNaN(kg)||isNaN(reps)||reps<=0){haptic("error");toast(timed?"Enter weight and seconds":"Enter weight and reps");return}
  const k=logKey(w,d);
  const name=exName(d,exIdx);
  const prevBest=liftStats(name,k);   /* best before today's session */
  if(!db.logs[k].ex[exIdx])db.logs[k].ex[exIdx]=[];
  const set={kg,reps,t:Date.now(),name};
  if(isUni(name))set.uni=1;   /* stamped so history stays honest if the flag changes later */
  if(timed)set.timed=1;
  db.logs[k].ex[exIdx][setIdx]=set;
  save();
  const pos={w,d,exIdx,setIdx};
  const isPR=prevBest&&(kg>prevBest.best.kg||(kg===prevBest.best.kg&&reps>prevBest.best.reps));
  FX={ex:exIdx,pip:setIdx};
  const b=$("logbtn");b.classList.add("pressed");setTimeout(()=>b.classList.remove("pressed"),140);
  if(isPR){haptic("pr");const f=$("prflash");f.classList.remove("go");void f.offsetWidth;f.classList.add("go")}
  else haptic("log");
  toast((isPR?"🏆 New PR — ":"Logged ")+fmtSet(set),"Undo",()=>undoSet(pos));
  advance(true);
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
  if(exIdx+1<DAYS[d].ex.length){S.exIdx++;S.setIdx=firstOpenSet();renderSet();save()}
  else showDone(w,d);
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
        return{exIdx:j,setIdx:open(j),rest:(exIdx===first&&j===second)?db.settings.rest.super:restSecs(d,exIdx)};
    }
    after=second+1;
  }else{
    if(setIdx+1<slotSets(w,d,exIdx))return{exIdx,setIdx:setIdx+1,rest:restSecs(d,exIdx)};
    after=exIdx+1;
  }
  if(after<exs.length)return{exIdx:after,setIdx:open(after),rest:restSecs(d,exIdx)};
  return null;
}
function advance(withRest){
  const {w,d,exIdx}=S;
  const nx=nextTarget();
  if(!nx){showDone(w,d);return}
  const nextLabel=nx.exIdx===exIdx?"Next: set "+(nx.setIdx+1)+" — "+exName(d,exIdx):"Next: "+exName(d,nx.exIdx);
  const hint=restHint(nx);
  S.exIdx=nx.exIdx;S.setIdx=nx.setIdx;
  if(withRest&&nx.rest>0)startRest(nx.rest,nextLabel,hint);
  renderSet();save();
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
  $("pad-label").textContent=f==="kg"?"Weight kg":(isTimed(exName(S.d,S.exIdx))?"Seconds":"Reps");
  $("pad-dot").style.visibility=f==="kg"?"visible":"hidden";
  const {w,d,exIdx,setIdx}=S,name=exName(d,exIdx);
  const L=db.logs[logKey(w,d)].ex[exIdx]||[],prev=setIdx>0?L[setIdx-1]:null,hist=prevSession(w,d,exIdx);
  const ref=prev||(hist?hist.sets[Math.min(setIdx,hist.sets.length-1)]:null);
  const q=[];
  if(f==="kg"){
    if(ref)q.push([`${prev?"Same as last set":"Last time"} · ${fmtKg(ref.kg)}`,ref.kg]);
    if(isBarbellLift(name))q.push([`Empty bar · ${fmtKg(db.settings.bar)}`,db.settings.bar]);
  }else{
    if(ref)q.push([`${prev?"Same as last set":"Last time"} · ${ref.reps}`,ref.reps]);
    const [,range]=DAYS[d].ex[exIdx];
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
    el.value=isNaN(n)?"":(PAD.f==="kg"?fmtKg(n):Math.round(n));padApply();PAD=null}
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
function closeChoose(){CHOOSE=null;$("choosesheet").classList.remove("active")}

/* ---------- gestures ---------- */
function onSwipe(el,fn){
  let x0=0,y0=0,t0=0;
  el.addEventListener("touchstart",e=>{const t=e.touches[0];x0=t.clientX;y0=t.clientY;t0=Date.now()},{passive:true});
  el.addEventListener("touchend",e=>{const t=e.changedTouches[0],dx=t.clientX-x0,dy=t.clientY-y0;
    if(Date.now()-t0<600&&Math.abs(dx)>70&&Math.abs(dy)<45)fn(dx<0?1:-1)},{passive:true});
}
/* long-press on any descendant matching `selector`; the follow-up click is swallowed */
function onLongPress(container,selector,fn){
  let timer=null,target=null;
  const cancel=()=>{if(timer){clearTimeout(timer);timer=null}};
  container.addEventListener("pointerdown",e=>{target=e.target.closest(selector);if(!target)return;
    timer=setTimeout(()=>{timer=null;haptic("log");target.dataset.lp="1";fn(target)},480)});
  container.addEventListener("pointermove",cancel);
  container.addEventListener("pointerup",cancel);
  container.addEventListener("pointercancel",cancel);
  container.addEventListener("click",e=>{const t=e.target.closest(selector);if(t&&t.dataset.lp){delete t.dataset.lp;e.stopPropagation();e.preventDefault()}},true);
  container.addEventListener("contextmenu",e=>{if(e.target.closest(selector))e.preventDefault()});
}

/* ================= SWAP ================= */
function openSwap(){
  const {d,exIdx}=S;
  const orig=DAYS[d].ex[exIdx][0];
  const cur=exName(d,exIdx);
  const opts=[orig,...similarLifts(orig)];
  $("swaplist").innerHTML=opts.map(o=>
    `<button class="subopt ${o===cur?"current":""}" onclick="doSwap('${o.replace(/'/g,"\\'")}')">${o}${o===orig?" <span style='color:var(--ink-faint);font-weight:400'>(programme default)</span>":""}</button>`).join("");
  $("swap-hint").textContent=isOpen()?"Same movement pattern, different tool. The swap sticks until you change it back, so your progression stays comparable.":"Same movement pattern, different tool. The swap sticks for this whole block so your progression stays comparable.";
  $("swapsheet").classList.add("active");
}
function doSwap(name){
  const {d,exIdx}=S;
  const orig=DAYS[d].ex[exIdx][0];
  if(!db.swaps)db.swaps={};
  if(name===orig)delete db.swaps[d+"-"+exIdx];
  else db.swaps[d+"-"+exIdx]=name;
  save();closeSwap();renderSet();
  toast(name===orig?"Back to default":"Swapped to "+name);
}
function closeSwap(){$("swapsheet").classList.remove("active")}

/* Curated swaps first, then anything else in the same group with the same
   movement pattern — so every slot has options, not just the default programme's */
function similarLifts(name){
  const e=EXDB[name];
  const same=e?Object.keys(EXDB).filter(n=>n!==name&&EXDB[n].g===e.g&&EXDB[n].pat===e.pat):[];
  return [...new Set([...(SUBS[name]||[]),...same])].filter(n=>EXDB[n]);
}
/* ================= LIFT LIBRARY ================= */
const LIB={q:"",grp:"All",current:null,src:"lib"};
function planDays(name){
  const days=[];
  for(const d of dayIds())DAYS[d].ex.forEach((e,i)=>{if(exName(d,i)===name&&!days.includes(d))days.push(d)});
  return days;
}
function renderLib(){
  $("libchips").innerHTML=["All",...GROUPS].map(g=>
    `<button class="libchip ${g===LIB.grp?"sel":""}" aria-pressed="${g===LIB.grp}" onclick="LIB.grp='${g.replace(/&/g,"&amp;")}';renderLib()">${g}</button>`).join("");
  const q=LIB.q.trim().toLowerCase();
  let html="";
  for(const g of GROUPS){
    if(LIB.grp!=="All"&&LIB.grp!==g)continue;
    const items=Object.entries(EXDB).filter(([,e])=>e.g===g).filter(([n,e])=>{
      if(!q)return true;
      const hay=(n+" "+e.eq+" "+e.pat+" "+g+" "+[...e.pri,...e.sec].map(m=>MUSCLE_NAMES[m]).join(" ")).toLowerCase();
      return hay.includes(q);
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
  $("liblist").innerHTML=html||`<div class="emptymsg">No lifts match "${LIB.q}".<br>Try a muscle — "hamstrings", "rear delts", "abs"…</div>`;
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
  /* muscle diagram */
  document.querySelectorAll("#anat .mus").forEach(m=>m.classList.remove("pri","sec"));
  const mark=(keys,cls)=>keys.forEach(k=>(MUSCLE_MAP[k]||[]).forEach(id=>{
    const el=$(id);if(el&&!(cls==="sec"&&el.classList.contains("pri")))el.classList.add(cls)}));
  mark(e.pri,"pri");mark(e.sec,"sec");
  $("lift-muscles").innerHTML=
    e.pri.map(m=>`<span class="mchip pri">${MUSCLE_NAMES[m]}</span>`).join("")
    +e.sec.map(m=>`<span class="mchip">${MUSCLE_NAMES[m]}</span>`).join("");
  $("lift-about").textContent=e.about;
  $("lift-form").innerHTML=e.form.map(c=>"<li>"+c+"</li>").join("");
  $("lift-vid").href=ytLink(name);
  const st=liftStats(name);
  $("lift-stats").style.display=st?"grid":"none";
  if(st){$("lift-best").textContent=fmtSet(st.best);$("lift-setcount").textContent=st.count}
  $("lift-notes").value=(db.notes&&db.notes[name])||"";
  renderLiftSettings(name);
  const sim=similarLifts(name);
  $("lift-similar").innerHTML=sim.length?sim.map(n=>`<button class="librow" onclick="openLift('${n.replace(/'/g,"\\'")}','lift')">
      <div class="linfo"><div class="lname">${n}</div><div class="lmeta">${EXDB[n].pri.map(m=>MUSCLE_NAMES[m]).slice(0,2).join(", ")} · ${EXDB[n].eq}</div></div>
      <svg viewBox="0 0 24 24" class="chev"><path d="M9.6 5.4 16.2 12l-6.6 6.6"/></svg></button>`).join("")
    :`<div class="hsets" style="padding:6px 4px;color:var(--ink-faint)">Nothing else in the library shares this pattern.</div>`;
  show("lift");
}
/* ---------- per-lift settings: weight step, rest, per side ---------- */
function stepperHTML(fn,val,step,label,unit,mode){
  return `<div class="stepper small"><button onclick="${fn}(-${step})" aria-label="Decrease ${label}">−</button><input type="number" inputmode="${mode||"decimal"}" value="${val}" onchange="${fn}(0,this.value)" aria-label="${label}"><button onclick="${fn}(${step})" aria-label="Increase ${label}">+</button></div><span class="sunit">${unit}</span>`;
}
function renderLiftSettings(name){
  const o=liftOpt(name),inc=increment(name),uni=isUni(name),timed=isTimed(name);
  const defInc=incrementFor(name,{},BIG_INC);
  const defRest=isCompPattern(name)?db.settings.rest.comp:db.settings.rest.acc;
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
function openLiftFromSession(){if(S)openLift(exName(S.d,S.exIdx),"session")}
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
          if(!best||s.kg>best.kg||(s.kg===best.kg&&s.reps>best.reps))best=rec;
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
  restEnd=Date.now()+sec*1000;restDur=sec;restLabel=nextLabel;restHintTxt=hint||"";
  $("rest-next").textContent=nextLabel;
  $("rest-hint").innerHTML=restHintTxt;
  $("restveil").classList.add("active");
  if(window.Notification&&Notification.permission==="default")try{Notification.requestPermission()}catch(e){}
  tickRest();restTick=setInterval(tickRest,250);
}
function tickRest(){
  const left=Math.max(0,Math.ceil((restEnd-Date.now())/1000));
  $("rest-time").textContent=Math.floor(left/60)+":"+String(left%60).padStart(2,"0");
  $("rest-ring").style.strokeDashoffset=(RING_C*(1-Math.min(1,left/restDur))).toFixed(1);
  if(left<=0){
    endRest();
    haptic("restEnd");
    if(document.hidden)notifyRestDone();
  }
}
function notifyRestDone(){
  try{
    if(window.Notification&&Notification.permission==="granted"&&navigator.serviceWorker)
      navigator.serviceWorker.getRegistration().then(r=>r&&r.showNotification("Rest over",
        {body:restLabel||"Back to work",icon:"icon-192.png",tag:"rest",vibrate:[200,100,200]}));
  }catch(e){}
}
function addRest(s){restEnd+=s*1000;restDur=Math.max(5,restDur+s);tickRest()}
function endRest(){clearInterval(restTick);$("restveil").classList.remove("active")}

/* ================= DONE ================= */
function showDone(w,d){
  S=null;unlockScreen();save();
  $("done-sub").textContent="Day "+d+" · Week "+w+" · "+DAYS[d].title;
  const L=db.logs[logKey(w,d)];
  let ts=[];for(const ex of Object.values(L.ex||{}))for(const s of ex)if(s&&s.t)ts.push(s.t);
  const dur=ts.length>1?Math.round((Math.max(...ts)-Math.min(...ts))/60000):0;
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
  const skipped=DAYS[d].ex.map((e,i)=>({n:exName(d,i),has:(L.ex[i]||[]).some(s=>s&&s.kg!=null)}))
    .filter(x=>!x.has).map(x=>x.n);
  if(skipped.length)html+=`<div class="hsets" style="padding:10px 4px;color:var(--ink-faint)">Not done: ${skipped.join(", ")}</div>`;
  html+=`<div class="hsets" style="padding:2px 4px;color:var(--ink-faint)">Tap a set to edit it, hold to delete.</div>`;
  $("done-list").innerHTML=html;
  $("done-nudge").innerHTML=backupNudgeHTML(7);
  $("done-share").onclick=()=>shareSession(w,d);
  show("done");
  if(driveOn())setTimeout(()=>driveSync({quiet:true}),800);
}

/* ---------- edit a logged set ---------- */
let ED=null;
function openEdit(w,d,ex,si,src){
  ED={w,d,ex,si,src};
  const s=db.logs[logKey(w,d)].ex[ex][si];
  $("ed-sub").textContent=exName(d,ex)+" · set "+(si+1);
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
  else showDone(ED.w,ED.d);
}
function deleteEditSet(){
  const arr=db.logs[logKey(ED.w,ED.d)].ex[ED.ex];
  arr[ED.si]=null;while(arr.length&&!arr[arr.length-1])arr.pop();
  save();
  closeEdit();editReturn();toast("Set deleted");
}

/* ================= STATS ================= */
let ST={tab:"volume"};
function sparkSVG(series,w2,h2,color){
  if(series.length<2)return "";
  const W=w2||96,H=h2||32,p=4,min=Math.min(...series),max=Math.max(...series),r=max-min||1;
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
function muscleVolume(w){
  const out={};
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
      bump(exName(d,i),slotSets(w,d,i),"planned");
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
  const rows=Object.entries(vol).sort((a,b)=>b[1].planned-a[1].planned);
  const max=Math.max(24,...rows.map(r=>Math.max(r[1].planned,r[1].logged)));
  const bars=rows.map(([g,v])=>{
    const n=Math.round(v.logged*10)/10,pl=Math.round(v.planned*10)/10;
    /* colour by what the week PLANS to deliver, so an unstarted week still
       tells you whether the programme covers this muscle at all */
    const cls=pl===0?"none":pl<8?"low":pl<=22?"ok":"high";
    return `<div class="musrow">
      <div class="muslabel">${g}</div>
      <div class="mustrack">
        <div class="musband" style="left:${100*8/max}%;width:${100*12/max}%"></div>
        <div class="musghost" style="width:${Math.min(100,100*pl/max)}%"></div>
        <div class="musfill ${cls}" style="width:${Math.min(100,100*n/max)}%"></div>
        <div class="musmark" style="left:${100*8/max}%"></div>
        <div class="musmark" style="left:${100*20/max}%"></div>
      </div>
      <div class="musval">${n}<span>/${pl}</span></div></div>`;
  }).join("");
  const thin=rows.filter(([,v])=>v.planned>0&&v.planned<8).map(([g])=>g);
  const none=rows.filter(([,v])=>v.planned===0).map(([g])=>g);
  let verdict="";
  if(thin.length||none.length){
    verdict=`<div class="nudge" style="margin:12px 0 0">`+
      (none.length?`<b>Untrained this week:</b> ${none.join(", ")}. `:"")+
      (thin.length?`<b>Under 8 sets:</b> ${thin.join(", ")}.`:"")+
      `</div>`;
  }else if(rows.length){
    verdict=`<div class="nudge" style="margin:12px 0 0;border-left-color:var(--plate-green)">Every muscle group is planned for 8+ sets this week. Balanced.</div>`;
  }
  return tonChartHTML()+
    `<div class="chartcard">
      <div class="sectlabel" style="margin:0 0 4px">Sets per muscle · week ${w}</div>
      <div class="hsets" style="margin-bottom:12px">The shaded band, 8 to 20 sets a week, is the productive range for most muscles. Solid = logged, faint = planned. A primary muscle counts 1 set, a secondary ½.</div>
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
      if(!r.best||s.kg>r.best.kg||(s.kg===r.best.kg&&s.reps>r.best.reps))r.best={kg:s.kg,reps:s.reps,timed:s.timed,uni:s.uni,date:L.date,block:B.block};
      if(!r.bestE||e>r.bestE.e)r.bestE={e,kg:s.kg,reps:s.reps,date:L.date,block:B.block};
    }
  }
  return Object.values(map).sort((a,b)=>b.bestE.e-a.bestE.e);
}
function recordsHTML(){
  const recs=allRecords();
  if(!recs.length)return `<div class="emptymsg">No records yet.<br>Log your first session and this fills up.</div>`;
  const weekAgo=new Date(Date.now()-7*86400e3).toISOString().slice(0,10);
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

function renderStats(){
  const total=allBlocks().reduce((a,B)=>a+Object.keys(B.logs||{}).length,0);
  $("stats-sub").textContent=db.archive.length
    ? (db.archive.length+1)+" blocks · "+total+" sessions on record"
    : "Volume, balance and every record you've set";
  const tabs=[["volume","Volume"],["records","Records"],["progress","Per lift"]];
  $("stats-tabs").innerHTML=tabs.map(([k,l])=>
    `<button class="seg ${ST.tab===k?"sel":""}" aria-pressed="${ST.tab===k}" onclick="ST.tab='${k}';renderStats()">${l}</button>`).join("");
  $("stats-body").innerHTML=
    ST.tab==="volume"?volumeHTML():ST.tab==="records"?recordsHTML():progressHTML();
  $("backup-nudge").innerHTML=backupNudgeHTML(14);
}

/* ================= PROGRESSION =================
   Week-over-week reading of the log, plus coaching drawn from it.
   Load (best e1RM per lift) and volume (tonnage) are reported separately:
   the programme changes set counts week to week and week 6 is a deload, so
   tonnage alone would call a planned drop a regression. */
let PG={week:null,filter:null};

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
    if(WK[pw]&&WK[pw].size)return{w:pw,block:db.block,lifts:WK[pw],label:"week "+pw,sameBlock:true};
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
    const status=pct>1?"up":pct<-1?"down":"hold";
    if(status==="up")up++;else if(status==="down")down++;else hold++;
    pctSum+=pct;pctN++;
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
      if(done.length<slotSets(w,d,i))return;
      const top=repTop(e[1]);
      if(!isNaN(top)&&done.every(s=>s.reps>=top)){
        const name=exName(d,i);
        out.push({name,kg:Math.max(...done.map(s=>s.kg)),inc:increment(name),low:repBottom(e[1])});
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

  const stalled=S.rows.filter(r=>r.p&&stallStreak(r.name,w,WK)>=2)
    .map(r=>({name:r.name,n:stallStreak(r.name,w,WK),kg:r.c.top.kg,reps:r.c.top.reps}));
  if(stalled.length){
    const s0=stalled[0];
    t.push({k:"warn",title:`${s0.name} has stalled ${s0.n} weeks`,
      body:`Stuck at <b>${fmtSet({kg:s0.kg,reps:s0.reps})}</b>. Three things worth trying, in order: make sure you're genuinely near failure (target is ${rirOf(w)} RIR this week), drop to about 90% for one week and rebuild, or swap to a close variation for the rest of the block — the Lifts tab lists alternatives.`
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
    const missed=dayIds().filter(d=>loggedSets(w,d)===0);
    t.push({k:"warn",title:missed.length
        ?`Day ${missed.join(" and ")} never got logged`
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
      body:`${names}${ready.length>3?` and ${ready.length-3} more`:""}. You hit the top of the rep range on every set, so add the increment and drop back to the bottom of the range next time.`});
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
  const S=weekSummary(w,WK);
  const V=weekVerdict(S);
  let html=`<div class="verdict ${V.tone}">
    <div class="vkick">Week ${w} · ${phaseLabel(w)}${S.base?" vs "+S.base.label:""}</div>
    <h2>${V.title}</h2><p>${V.body}</p></div>`;

  if(S.cur.size){
    const loadTxt=S.avgPct==null?"—":(S.avgPct>=0?"+":"")+Math.round(S.avgPct*10)/10+"%";
    const volTxt=S.baseTon?((S.ton-S.baseTon)>=0?"+":"")+Math.round(100*(S.ton-S.baseTon)/S.baseTon)+"%":S.ton.toLocaleString();
    html+=`<div class="statgrid three">
      <div class="stat"><div class="v" style="color:${S.avgPct==null?"var(--ink)":S.avgPct>=0?"var(--plate-green)":"var(--plate-yellow)"}">${loadTxt}</div><div class="k">Load</div></div>
      <div class="stat"><div class="v">${volTxt}</div><div class="k">${S.baseTon?"Volume":"Tonnage"}</div></div>
      <div class="stat"><div class="v">${S.doneSets}/${S.planSets}</div><div class="k">Sets</div></div>
    </div>`;
    /* load and volume can move opposite ways for good reasons — say which */
    if(S.baseTon&&S.avgPct!=null){
      const volPct=100*(S.ton-S.baseTon)/S.baseTon;
      let note="";
      if(S.avgPct>0.8&&volPct<-8)
        note=`Volume is down because you logged fewer sets, not because you lifted lighter — the weights went <b>up</b>.`;
      else if(S.avgPct<-0.8&&volPct>8)
        note=`More total work than ${S.base.label}, but at lighter loads. Fine for a pump week; watch it doesn't become the pattern.`;
      else if(deloadWeek(w)&&volPct<-15)
        note=`Volume down <b>${Math.abs(Math.round(volPct))}%</b> on half the sets — that's the deload working as intended.`;
      if(note)html+=`<div class="pgnote">${note}</div>`;
    }

    html+=`<div class="sectlabel">Lift by lift</div>`;
    const cnt={up:S.up,hold:S.hold,down:S.down,new:S.rows.filter(r=>r.status==="new").length};
    html+=`<div class="pgsum">${[["up","▲","up"],["hold","●","held"],["down","▼","down"],["new","+","new"]].map(([k,g,l])=>
      `<button class="${k}${PG.filter===k?" sel":""}" aria-pressed="${PG.filter===k}" onclick="PG.filter=PG.filter==='${k}'?null:'${k}';renderProgress()"><b>${g} ${cnt[k]}</b>${l}</button>`).join("")}</div>`;
    const rows=PG.filter?S.rows.filter(r=>r.status===PG.filter):S.rows;
    html+=rows.map(r=>`<button class="pgrow" onclick="openLift('${r.name.replace(/'/g,"\\'")}','progress')">
      <span class="pgbar ${r.status}"></span>
      <div class="pginfo"><div class="pgname">${r.name}</div>
        <div class="pgcmp">${r.p?`${fmtSet(r.p.top,true)} <span class="arr">→</span> ${fmtSet(r.c.top,true)}`
          :`${fmtSet(r.c.top)} · first time`}</div></div>
      ${pgDelta(r)}</button>`).join("")||`<div class="emptymsg">No lifts in this group.</div>`;
  }

  const tips=weekTips(S,WK);
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
  renderTrainSettings();renderDrive();
  $("set-theme").innerHTML=[["auto","Auto"],["dark","Dark"],["light","Light"]].map(([k,l])=>
    `<button class="seg ${db.settings.theme===k?"sel":""}" aria-pressed="${db.settings.theme===k}" onclick="setTheme('${k}')">${l}</button>`).join("");
}
/* ---------- appearance ---------- */
function applyTheme(){
  const pref=db.settings.theme||"dark";
  const light=pref==="light"||(pref==="auto"&&matchMedia("(prefers-color-scheme: light)").matches);
  document.documentElement.dataset.theme=light?"light":"dark";
  const m=document.querySelector('meta[name="theme-color"]');if(m)m.content=light?"#F3F4F8":"#0A0B0F";
}
function setTheme(k){db.settings.theme=k;save();applyTheme();renderSettings();tap(6)}
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
    row("Rest · superset","Between the two paired lifts (0 = none)","setRestSuper",st.rest.super,5,"s","numeric");
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
  if(!await ask({title:"Reset the programme?",
    body:"Every day and exercise goes back to the default. Your logged history is untouched.",
    ok:"Reset",danger:1}))return;
  db.programme=clone(DEFAULT_DAYS);db.swaps={};db.programmeName="ATLAS full body";
  progChanged();toast("Programme reset");
}
/* ---------- block structure ---------- */
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
      <div class="lrtext"><b>Open-ended plan</b><i>${esc(P.name)} · week ${cw} · started ${P.startDate||"—"}</i></div></div>
    <div class="hsets" style="margin-bottom:10px">Weeks count up from the start date and never reset. Every set to ${esc(P.weeks[0].rir)} RIR on hard weeks; a light week holds the weights and cuts the sets.</div>
    <div class="planrow open head"><span class="wn"></span><span>When</span><span>Comp</span><span>Acc</span><span>RIR</span><span></span></div>
    ${row("Hard",0,"")}${row("Light",1,"")}
    <div class="setrow" style="padding:10px 0 0"><div class="lrtext"><b>Light week every</b><i>Next one is week ${nl}${nl===cw?" (this week)":""}</i></div>
      <div class="stepper small"><button onclick="setOpenField('every',${P.every-1})" aria-label="Fewer weeks">−</button><input type="number" value="${P.every}" onchange="setOpenField('every',this.value)" aria-label="Weeks between light weeks"><button onclick="setOpenField('every',${P.every+1})" aria-label="More weeks">+</button></div><span class="sunit">wk</span></div>
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
          <div class="pemeta">${slotSets(db.selWeek,d,i)} sets in week ${db.selWeek}${exOpt(e,"sets")?" (pinned)":""}${isUni(exName(d,i))?" · per side":""}${slotHasLogs(d,i)?" · has history":""}</div></div>
          <button class="miniBtn" onclick="removeEx('${d}',${i})" aria-label="Remove exercise"><svg viewBox="0 0 24 24" class="gico"><path d="M6.4 6.4 17.6 17.6M17.6 6.4 6.4 17.6"/></svg></button>
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex:1 1 100%;margin-top:4px">
          <input class="perange" value="${esc(e[1])}" onchange="setRange('${d}',${i},this.value)" aria-label="Rep range">
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
/* ---------- exercise picker ---------- */
let PICK=null;
function openPick(d){PICK=d;$("picksearch").value="";renderPick();$("picksheet").classList.add("active")}
function closePick(){$("picksheet").classList.remove("active")}
function renderPick(){
  const q=$("picksearch").value.trim().toLowerCase();
  const match=([n,e])=>!q||(n+" "+e.eq+" "+e.g+" "+e.pat+" "+[...e.pri,...e.sec].map(m=>MUSCLE_NAMES[m]).join(" ")).toLowerCase().includes(q);
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
  db.lastBackup=Date.now();save();renderStats();
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
      db=migrateDb(d);
      if(photos)for(const[id,data]of Object.entries(photos))await IDB.set("photo:"+id,data);
      DAYS=db.programme;
      save();renderStats();toast("Backup restored"+(photos?" with photos":""));
      if(driveOn())driveSync({quiet:true});
    }catch(e){toast("That file isn't a valid backup")}
    input.value="";
  };
  r.readAsText(f);
}
function exportCSV(){
  const q=v=>/[",]/.test(v)?'"'+String(v).replace(/"/g,'""')+'"':v;
  let rows=[["block","week","day","date","exercise","set","kg","reps_or_seconds","timed","per_side","score_e1rm"]];
  for(const B of allBlocks()){
    for(const[k,L]of Object.entries(B.logs||{})){
      const[w,d]=k.split("-");
      for(const[i,sets]of Object.entries(L.ex||{}))
        sets.forEach((s,si)=>{if(s&&s.kg!=null)
          rows.push([B.block,w,d,L.date||"",q(setName(s,B,d,i)),si+1,s.kg,s.reps,s.timed?1:0,s.uni?1:0,setScore(s)])});
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
  archiveCurrent();
  save();show("home");
  if(driveOn())driveSync({quiet:true});
  toast("Block "+db.block+" — previous block archived");
}
async function wipeData(){
  if(!await ask({title:"Erase everything?",
    body:"Every logged set, all blocks, swaps, notes and photos. <b>This cannot be undone.</b> Take a backup first if there's any doubt.",
    ok:"Erase it all",danger:1}))return;
  for(const k of await IDB.keys())if(String(k).startsWith("photo:"))await IDB.del(k);
  db=migrateDb({});DAYS=db.programme;save();renderStats();toast("All data erased");
}

/* ================= INIT ================= */
async function init(){
  if(!db.notes)db.notes={};
  if(!db.metrics)db.metrics=[];
  /* localStorage gone (eviction / new browser profile)? Recover from the IndexedDB mirror. */
  if(!localStorage.getItem(KEY)){
    const m=await IDB.get("db");
    if(m&&m.logs&&(Object.keys(m.logs).length||(m.archive||[]).length)){
      db=migrateDb(m);DAYS=db.programme;
      save();toast("Log restored from device mirror");
    }
  }
  try{if(navigator.storage&&navigator.storage.persist)navigator.storage.persist()}catch(e){}
  db=migrateDb(db);
  DAYS=db.programme;
  /* keep the focused input clear of the Android keyboard */
  document.querySelectorAll('input[type=number]').forEach(el=>{
    el.addEventListener("focus",()=>setTimeout(()=>el.scrollIntoView({block:"center",behavior:"smooth"}),280));
  });
  try{history.scrollRestoration="manual"}catch(e){}   /* we restore scroll ourselves */
  applyTheme();
  /* swipe between weeks on Plan and Progression */
  onSwipe($("scr-home"),dir=>{const w=Math.min(WEEKS(),Math.max(1,db.selWeek+dir));db.autoWeekFor=todayISO();if(w!==db.selWeek){haptic("select");db.selWeek=w;save();renderHome()}});
  onSwipe($("scr-progress"),dir=>{const w=Math.min(WEEKS(),Math.max(1,(PG.week||db.selWeek)+dir));if(w!==PG.week){haptic("select");PG.week=w;renderProgress()}});
  /* hold a logged set to delete it; hold a library lift to add it to a day */
  onLongPress($("done-list"),".setchip",async el=>{
    const {w,d,ex,si}=el.dataset;const arr=db.logs[logKey(w,d)].ex[ex];const st=arr&&arr[si];if(!st)return;
    if(!await ask({title:"Delete this set?",body:`<b>${fmtSet(st)}</b> on ${exName(d,+ex)} will be removed from your history.`,ok:"Delete",danger:1}))return;
    arr[si]=null;while(arr.length&&!arr[arr.length-1])arr.pop();save();showDone(+w,d);toast("Set deleted");
  });
  onLongPress($("liblist"),".librow",el=>{
    const name=el.dataset.name;if(!name)return;
    chooseSheet("Add "+name,"Which training day should it go on?",dayIds().map(d=>({label:"Day "+d+" · "+DAYS[d].title,value:d})),d=>{PICK=d;pickAdd(name)});
  });
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
