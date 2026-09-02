/* ATLAS · core: pure functions shared by the app (js/app.js) and the test
   suite (tests/core.test.js). No DOM, no storage, nothing from app.js.
   Anything that reasons about a set, a log or the programme shape belongs
   here so it can be tested without a browser. */

const clone=o=>JSON.parse(JSON.stringify(o));
function logKey(w,d){return w+"-"+d}

/* ---------- rep ranges ---------- */
/* Ranges are stored as "6–8" (en dash). Accept a hyphen, en or em dash and
   stray spaces on the way in so a hand-edited backup can't break the coach. */
const DASH=/\s*[-–—]\s*/;
function parseRange(range){
  const p=String(range).trim().split(DASH);
  const lo=parseInt(p[0]),hi=parseInt(p[1]);
  return{lo,hi:isNaN(hi)?lo:hi};
}
function repTop(range){return parseRange(range).hi}
function repBottom(range){return parseRange(range).lo}
/* Canonical form for storage, or null if it isn't a rep range at all */
function normaliseRange(v){
  v=String(v).trim().replace(DASH,"–");
  return /^\d+(–\d+)?$/.test(v)?v:null;
}

/* ---------- numbers ---------- */
/* 62.5 -> "62.5", 60 -> "60", 41.25 -> "41.25": no trailing zeros, at most 2 dp */
function fmtKg(v){return String(Math.round(v*100)/100)}
/* Nearest multiple of step, so the stepper pulls off-grid values back onto the grid */
function snapStep(v,step){return Math.round(Math.round(v/step)*step*100)/100}

/* ---------- sets ---------- */
/* Epley estimated 1RM — lets 80x8 and 85x6 be compared honestly */
function e1rm(kg,reps){return Math.round(kg*(1+reps/30)*10)/10}
/* One comparable number per set. Rep sets: e1RM. Timed sets: seconds held,
   scaled up by load when there is any, so a heavier plank still scores higher. */
function setScore(s){
  if(s.timed)return s.kg>0?Math.round(s.kg*(1+s.reps/60)*10)/10:s.reps;
  return e1rm(s.kg,s.reps);
}
/* A unilateral set is logged once but performed on both sides. Timed sets
   don't contribute tonnage — kg × seconds isn't weight moved. */
function setTonnage(s){return s.timed?0:s.kg*s.reps*(s.uni?2:1)}
/* "85 kg × 12", "20 kg × 60 s", "60 s", "12 reps /side" */
function fmtSet(s,short){
  const unit=s.timed?" s":"";
  const core=s.kg>0?`${fmtKg(s.kg)}${short?"":" kg"} × ${s.reps}${unit}`:`${s.reps}${s.timed?" s":(short?"":" reps")}`;
  return core+(s.uni?" /side":"");
}

/* ---------- block plan ---------- */
function clampInt(v,lo,hi,dflt){v=parseInt(v);return isNaN(v)?dflt:Math.max(lo,Math.min(hi,v))}
/* Returns a clean plan, or a copy of `fallback` when the input is unusable.
   Block plans have 2 to 12 weeks. Open plans (open:true) have exactly two
   week definitions, hard then light, plus the cadence of the light week. */
function validatePlan(p,fallback,phases){
  if(!p||!Array.isArray(p.weeks)||p.weeks.length<2||p.weeks.length>12)return clone(fallback);
  const cleanWeek=w=>({
    phase:phases.includes(w&&w.phase)?w.phase:"Build",
    comp:clampInt(w&&w.comp,1,8,3),acc:clampInt(w&&w.acc,0,8,3),
    rir:normaliseRange(w&&w.rir!=null?w.rir:"2")||"2"});
  if(p.open){
    return{name:String((p.name||"Open-ended")).slice(0,40),open:true,
      every:clampInt(p.every,2,12,6),lightOffset:clampInt(p.lightOffset,0,999,0),rampWeeks:clampInt(p.rampWeeks,0,4,0),
      startDate:/^\d{4}-\d{2}-\d{2}$/.test(p.startDate||"")?p.startDate:null,
      weeks:[cleanWeek(p.weeks[0]),cleanWeek(p.weeks[1])]};
  }
  return{name:String((p.name||"Custom")).slice(0,40),weeks:p.weeks.map(cleanWeek)};
}
/* Light weeks fall every `every` weeks, pushed later by lightOffset (postponements) */
function isLightWeek(plan,w){if(!plan.open)return false;const x=w-(plan.lightOffset||0);return x>0&&x%(plan.every||6)===0}
/* the first rampWeeks of an open plan run at about two-thirds of the sets */
function isRampWeek(plan,w){return !!plan.open&&w<=(plan.rampWeeks||0)}
function rampSets(n){return n<=1?n:Math.max(2,Math.round(n*0.67))}
function nextLightWeek(plan,fromW){let w=Math.max(1,fromW);while(!isLightWeek(plan,w))w++;return w}
const planWeeks=plan=>plan.open?Infinity:plan.weeks.length;
const planWeek=(plan,w)=>plan.open?plan.weeks[isLightWeek(plan,w)?1:0]:plan.weeks[Math.min(w,plan.weeks.length)-1];
/* calendar weeks, Monday start: which week of an open plan today falls in */
function isoDate(d){const z=new Date(d.getTime()-d.getTimezoneOffset()*60000);return z.toISOString().slice(0,10)}
function mondayOf(dateStr){const d=new Date(dateStr+"T12:00:00");d.setDate(d.getDate()-((d.getDay()+6)%7));return d}
function calendarWeek(startDate,today){
  if(!startDate)return 1;
  const t=typeof today==="string"?today:isoDate(today);
  return Math.max(1,Math.round((mondayOf(t)-mondayOf(startDate))/(7*86400e3))+1);
}
/* highest week number that has any set logged (0 when empty) */
function maxLoggedWeek(logs){let m=0;for(const k of Object.keys(logs||{})){const w=parseInt(k);if(w>m)m=w}return m}
const isDeload=(plan,w)=>planWeek(plan,w).phase==="Deload";
/* Which weeks of an old block to look at first for "last time": the heaviest
   ones — latest non-deload week first, deloads last. */
function historyOrder(plan,logs){
  const n=plan.open?maxLoggedWeek(logs):planWeeks(plan);
  const ws=[];for(let w=n;w>=1;w--)ws.push(w);
  return [...ws.filter(w=>!isDeload(plan,w)),...ws.filter(w=>isDeload(plan,w))];
}

/* ---------- Drive sync ---------- */
/* Newer copy wins. An empty phone never overwrites a Drive log; a missing
   Drive file always gets this phone's copy. */
function syncDecision(localAt,remoteAt,remoteExists,localEmpty){
  if(!remoteExists)return "upload";
  if(localEmpty)return "download";
  if(remoteAt>localAt)return "download";
  if(localAt>remoteAt)return "upload";
  return "none";
}

/* ---------- names ---------- */
/* Resolve a slot's name inside a block context (current or archived) */
function exNameIn(ctx,d,i){
  const sw=ctx.swaps&&ctx.swaps[d+"-"+i];
  if(sw)return sw;
  const day=ctx.programme&&ctx.programme[d];
  return (day&&day.ex[i]&&day.ex[i][0])||"—";
}
/* A set records the lift it was performed on. Older sets predate that, so fall
   back to resolving the slot — but a stamped name always wins, which is what
   stops a later swap from retroactively relabelling your history. */
function setName(s,ctx,d,i){return (s&&s.name)||exNameIn(ctx,d,i)}

/* ---------- per-lift overrides (db.lifts[name] = {inc, rest, uni}) ---------- */
function incrementFor(name,lifts,bigInc){
  const o=lifts&&lifts[name];
  if(o&&o.inc>0)return o.inc;
  return bigInc.has(name)?5:2.5;
}
function restFor(name,isComp,lifts,rest){
  const o=lifts&&lifts[name];
  if(o&&o.rest>0)return o.rest;
  return isComp?rest.comp:rest.acc;
}
/* An explicit override (1 or 0) beats the encyclopedia's default */
function isUnilateral(name,lifts,exdb){
  const o=lifts&&lifts[name];
  if(o&&o.uni!=null)return !!o.uni;
  return !!(exdb[name]&&exdb[name].uni);
}

/* ---------- plates ---------- */
/* Greedy per-side load. `nearest` is the heaviest clean load at or below kg. */
function plateBreakdown(kg,bar,plates){
  if(isNaN(kg)||kg<bar)return{ok:false,belowBar:true,perSide:[],nearest:bar};
  let rem=(kg-bar)/2;const out=[];
  for(const p of [...plates].sort((a,b)=>b-a)){
    while(rem>=p-0.001){out.push(p);rem=Math.round((rem-p)*100)/100}
  }
  return{ok:rem<=0.001,belowBar:false,perSide:out,nearest:Math.round((kg-rem*2)*100)/100};
}

/* ---------- slot options / supersets ---------- */
/* Options live in the 4th tuple element: ["Name","6–8",1,{ss:1}].
   ss:1 pairs a slot with the one after it. */
function exOpt(e,k){return (e&&e[3]&&e[3][k])||0}
function setExOpt(e,k,v){
  e[3]=e[3]||{};
  if(v)e[3][k]=v;else delete e[3][k];
  if(!Object.keys(e[3]).length)e.length=3;
}
/* Partner slot index, or -1. Being the second half of a pair wins over
   starting a new one, so a chain of flags never yields overlapping pairs. */
function pairOf(exs,i){
  if(i>0&&exOpt(exs[i-1],"ss"))return i-1;
  if(exOpt(exs[i],"ss")&&i+1<exs.length)return i+1;
  return -1;
}
/* Clear flags that can't form a pair: on the last slot, or directly after
   another flagged slot. Run after any structural edit. */
function normaliseSupersets(exs){
  for(let i=0;i<exs.length;i++){
    if(!exOpt(exs[i],"ss"))continue;
    if(i===exs.length-1||(i>0&&exOpt(exs[i-1],"ss")))setExOpt(exs[i],"ss",0);
  }
  return exs;
}

/* ---------- programme edits ---------- */
/* Logs and swaps are keyed by slot index, so any structural edit has to move
   them in lockstep or a day's history would silently shift one lift across.
   `transform` receives an n-long array (one entry per slot) and returns the
   reordered array; it is applied identically to every week's log and to swaps. */
function remapSlots(logs,swaps,d,n,transform,nWeeks){
  for(let w=1;w<=(nWeeks||6);w++){
    const L=logs[logKey(w,d)];if(!L)continue;
    const arr=[];for(let i=0;i<n;i++)arr.push(L.ex[i]||null);
    const out=transform(arr);
    const ex={};out.forEach((v,i)=>{if(v&&v.length)ex[i]=v});
    L.ex=ex;
  }
  const sw=[];for(let i=0;i<n;i++)sw.push(swaps[d+"-"+i]||null);
  const swOut=transform(sw);
  for(let i=0;i<n;i++)delete swaps[d+"-"+i];
  swOut.forEach((v,i)=>{if(v)swaps[d+"-"+i]=v});
}

/* ---------- progression ---------- */
/* Consecutive weeks ending at w where this lift failed to beat the week before.
   WK is {week: Map(name -> {top:{e}})}. */
function stallStreak(name,w,WK){
  let n=0,newer=null;
  for(let x=w;x>=1;x--){
    const m=WK[x]&&WK[x].get(name);
    if(!m)continue;
    if(newer===null){newer=m.top.e;continue}
    if(newer<=m.top.e+0.01){n++;newer=m.top.e}else break;
  }
  return n;
}

/* ---------- migration ---------- */
/* Brings any older save up to the current shape. Runs on load and on restore. */
function migrate(d,defaultDays,defaultSettings,defaultPlan,phases){
  d=d||{};
  d.block=d.block||1;
  d.logs=d.logs||{};
  d.selWeek=d.selWeek||1;
  d.swaps=d.swaps||{};
  d.notes=d.notes||{};
  d.metrics=d.metrics||[];
  d.archive=d.archive||[];
  d.lastBackup=d.lastBackup||null;
  d.session=d.session||null;
  d.rest=d.rest||null;
  if(!d.programme)d.programme=clone(defaultDays);
  /* 6.1: adjustable bar, plates and rests, plus per-lift overrides */
  const ds=defaultSettings,s=d.settings||{};
  d.settings={
    bar:s.bar>0?s.bar:ds.bar,
    plates:Array.isArray(s.plates)&&s.plates.length?s.plates:clone(ds.plates),
    rest:Object.assign(clone(ds.rest),s.rest||{}),
    theme:["dark","light","auto"].includes(s.theme)?s.theme:ds.theme
  };
  d.lifts=d.lifts||{};
  /* 6.4: configurable block plan; archived blocks carry theirs. Sync bookkeeping. */
  if(defaultPlan){
    d.plan=validatePlan(d.plan,defaultPlan,phases);
    for(const b of d.archive)b.plan=validatePlan(b.plan,defaultPlan,phases);
  }
  d.updatedAt=d.updatedAt||0;
  d.sync=d.sync||{};
  d.programmeName=d.programmeName||"ATLAS full body";
  /* single-slot `prev` used to be the only archive — fold it in so it stops
     being overwritten (and lost) on the next block rollover */
  if(d.prev){
    d.archive.unshift({block:Math.max(1,d.block-1),logs:d.prev,
      programme:clone(defaultDays),swaps:clone(d.swaps),endedAt:null,plan:defaultPlan?clone(defaultPlan):undefined});
    delete d.prev;
  }
  return d;
}

if(typeof module!=="undefined"&&module.exports)module.exports={clone,logKey,parseRange,repTop,repBottom,normaliseRange,fmtKg,snapStep,
  e1rm,setScore,setTonnage,fmtSet,validatePlan,planWeeks,planWeek,isDeload,isLightWeek,isRampWeek,rampSets,nextLightWeek,isoDate,mondayOf,calendarWeek,maxLoggedWeek,historyOrder,syncDecision,exNameIn,setName,incrementFor,restFor,isUnilateral,plateBreakdown,
  exOpt,setExOpt,pairOf,normaliseSupersets,remapSlots,stallStreak,migrate};
