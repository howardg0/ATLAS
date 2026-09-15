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

/* Sets one rep range on several programme slots. slots is a list of "D-i" keys; returns how many changed. */
function bulkRange(programme,slots,range){
  const r=normaliseRange(range);if(!r)return 0;
  let n=0;
  for(const key of slots){
    const [d,i]=key.split("-");const ex=programme[d]&&programme[d].ex[+i];
    if(ex&&ex[1]!==r){ex[1]=r;n++}
  }
  return n;
}

/* Alternatives for a one-off swap: same group and at least one shared primary muscle.
   Curated swaps first, then same movement pattern, then exact primary-muscle match, then the rest. */
function sameMuscleLifts(exdb,name,subs){
  const e=exdb[name];if(!e)return[];
  const key=[...e.pri].sort().join(),cur=(subs&&subs[name])||[];
  const score=n=>{const x=exdb[n];return (cur.includes(n)?0:4)+(x.pat===e.pat?0:2)+([...x.pri].sort().join()===key?0:1)};
  return Object.keys(exdb).filter(n=>n!==name&&exdb[n].g===e.g&&exdb[n].pri.some(m=>e.pri.includes(m)))
    .sort((a,b)=>score(a)-score(b)||a.localeCompare(b));
}

/* ---------- sets ---------- */
/* Does set a beat set b? Heavier wins; same weight, more reps wins. */
function betterSet(a,b){return !b||a.kg>b.kg||(a.kg===b.kg&&a.reps>b.reps)}
/* Minutes from the first logged set to the last in one session's log entry */
function sessionDuration(L){
  const ts=[];for(const ex of Object.values((L&&L.ex)||{}))for(const s of ex||[])if(s&&s.t)ts.push(s.t);
  return ts.length>1?Math.round((Math.max(...ts)-Math.min(...ts))/60000):0;
}

/* ---------- plan switching ---------- */
/* The first Monday strictly after `today` (ISO date) */
function nextMonday(today){const d=mondayOf(today);d.setDate(d.getDate()+7);return isoDate(d)}
/* Streak carried over a plan switch: it survives until the new plan has a missed session /
   an incomplete past week, then it is gone for good. */
function carriedStreak(base,carry,broken){return base+((carry&&!broken)?carry:0)}

/* ---------- time budget ---------- */
/* Rough minutes a slot takes: sets × (work + rest), compounds rest longer */
function slotMinutes(sets,isComp){return sets*(isComp?3.4:2.3)}
/* Trim a session to a time budget. slots: [{i,comp,min,locked}] in programme order.
   Accessories go first, from the end of the session backwards; compounds and
   locked slots (already started) are never dropped. Returns the slot indices to skip. */
function trimForTime(slots,budgetMin,baseMin){
  let total=(baseMin||0)+slots.reduce((a,s)=>a+s.min,0);
  const skip=[];
  for(let k=slots.length-1;k>=0&&total>budgetMin;k--){
    const s=slots[k];if(s.comp||s.locked||!s.min)continue;
    skip.push(s.i);total-=s.min;
  }
  return{skip:skip.sort((a,b)=>a-b),min:Math.round(total)};
}

/* ---------- nutrition ---------- */
/* Mifflin-St Jeor BMR, a step-count activity factor, plus an allowance per training
   day spread over the week. Goal shifts the target; protein and fat are set per kg
   of bodyweight and carbs take the remainder. Numbers are a starting point: the
   scale over two to three weeks is the real answer. */
const STEP_FACTOR={low:1.3,mid:1.4,high:1.55};
function nutritionTargets(p){
  const kg=+p.kg||0,cm=+p.cm||0,age=+p.age||0,days=Math.min(7,Math.max(0,+p.days||0));
  if(kg<30||cm<100||age<10)return null;
  const bmr=10*kg+6.25*cm-5*age+(p.sex==="f"?-161:5);
  const maint=bmr*(STEP_FACTOR[p.steps]||1.3)+days*350/7;
  const shift=p.goal==="cut"?-Math.min(500,Math.max(300,maint*0.15)):p.goal==="gain"?250:0;
  const kcal=Math.round((maint+shift)/25)*25;
  const protein=Math.round(kg*(p.goal==="cut"?2.2:2.0));
  const fat=Math.round(kg*0.9);
  const carbs=Math.max(0,Math.round((kcal-protein*4-fat*9)/4));
  const rate=p.goal==="cut"?"0.5 to 1% of bodyweight down per week":p.goal==="gain"?"0.25 to 0.5% of bodyweight up per week":"weight steady over a month";
  return{bmr:Math.round(bmr),maint:Math.round(maint/25)*25,kcal,protein,fat,carbs,rate,
    lo:kcal-100,hi:kcal+100,kgLo:Math.round(kg*(p.goal==="cut"?0.005:0.0025)*10)/10,kgHi:Math.round(kg*(p.goal==="cut"?0.01:0.005)*10)/10};
}

/* ---------- numbers ---------- */
/* 62.5 -> "62.5", 60 -> "60", 41.25 -> "41.25": no trailing zeros, at most 2 dp */
function fmtKg(v){return String(Math.round(v*100)/100)}
/* Nearest multiple of step, so the stepper pulls off-grid values back onto the grid */
function snapStep(v,step){return Math.round(Math.round(v/step)*step*100)/100}
/* One tap of +/−: on the grid, move one step; off it (62.5 with a 5 kg step), land on the next grid line in that direction */
function stepValue(v,step,dir){
  const q=v/step,on=Math.abs(q-Math.round(q))<1e-6;
  const n=on?Math.round(q)+dir:(dir>0?Math.ceil(q):Math.floor(q));
  return Math.max(0,Math.round(n*step*100)/100);
}

/* ---------- sets ---------- */
/* Epley estimated 1RM — lets 80x8 and 85x6 be compared honestly */
function e1rm(kg,reps){return Math.round(kg*(1+reps/30)*10)/10}
/* One comparable number per set. Rep sets: e1RM. Timed sets: seconds held,
   scaled up by load when there is any, so a heavier plank still scores higher. */
function setScore(s){
  if(s.timed)return Math.round(s.reps*(1+(s.kg||0)/10)*10)/10;   /* 60 s = 60; 60 s with 5 kg = 90 */
  return e1rm(s.kg,s.reps);
}
/* Ready for more load: every set but one reached the top of the range and none fell below the bottom.
   "Every set at the top" almost never happens on 4 hard sets, so it stalled people at the same weight. */
function hitTop(reps,top,bottom){
  if(!reps.length||isNaN(top))return false;
  const atTop=reps.filter(r=>r>=top).length;
  return atTop>=Math.max(1,reps.length-1)&&reps.every(r=>r>=(isNaN(bottom)?0:bottom));
}
/* Most sets under the bottom of the range: the weight is too heavy for the prescription */
function underRange(reps,bottom){return !isNaN(bottom)&&reps.length>0&&reps.filter(r=>r<bottom).length>=Math.ceil(reps.length/2)}
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
function hasSets(L){return !!L&&Object.values(L.ex||{}).some(a=>Array.isArray(a)&&a.some(s=>s&&s.kg!=null))}
function maxLoggedWeek(logs){let m=0;for(const [k,L] of Object.entries(logs||{})){if(!hasSets(L))continue;const w=parseInt(k);if(w>m)m=w}return m}
/* A session counts as done when it was finished in the app, every planned set is in, or at least 80% are */
function sessionDone(L,logged,total){return !!(L&&L.done)||(total>0&&logged>=total)||(total>0&&logged>0&&logged/total>=0.8)}
const isDeload=(plan,w)=>planWeek(plan,w).phase==="Deload";
/* Which weeks of an old block to look at first for "last time": the heaviest
   ones — latest non-deload week first, deloads last. */
function historyOrder(plan,logs){
  const n=plan.open?maxLoggedWeek(logs):planWeeks(plan);
  const ws=[];for(let w=n;w>=1;w--)ws.push(w);
  return [...ws.filter(w=>!isDeload(plan,w)),...ws.filter(w=>isDeload(plan,w))];
}

/* ---------- streaks ---------- */
/* `list` is planned sessions in order, each {done, due}. A session that is not
   due yet (later today, later this week) is skipped rather than breaking the run. */
function sessionStreak(list){
  let n=0;
  for(let i=list.length-1;i>=0;i--){const x=list[i];if(!x.due)continue;if(x.done)n++;else break}
  return n;
}
function adherence(list){const due=list.filter(x=>x.due);return due.length?due.filter(x=>x.done).length/due.length:null}

/* ---------- calendar reminders (.ics) ---------- */
const ICS_DAYS=["MO","TU","WE","TH","FR","SA","SU"];
function icsEscape(t){return String(t).replace(/\\/g,"\\\\").replace(/;/g,"\\;").replace(/,/g,"\\,").replace(/\n/g,"\\n")}
/* events: [{weekday:0..6 (Mon=0), title, desc}], time "HH:MM", from: ISO date the series starts on or after */
function buildICS(events,time,from,minutesBefore){
  const [hh,mm]=time.split(":").map(Number);
  const base=new Date(from+"T12:00:00");
  const pad=n=>String(n).padStart(2,"0");
  const stamp=new Date().toISOString().replace(/[-:]/g,"").replace(/\.\d+Z$/,"Z");
  const out=["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//ATLAS//Training reminders//EN","CALSCALE:GREGORIAN","METHOD:PUBLISH"];
  events.forEach((e,i)=>{
    const d=new Date(base);const cur=(d.getDay()+6)%7;d.setDate(d.getDate()+((e.weekday-cur+7)%7));
    const dt=`${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}T${pad(hh)}${pad(mm)}00`;
    const end=new Date(d);end.setHours(hh+1,mm);
    const de=`${end.getFullYear()}${pad(end.getMonth()+1)}${pad(end.getDate())}T${pad(end.getHours())}${pad(end.getMinutes())}00`;
    out.push("BEGIN:VEVENT",`UID:atlas-day-${e.weekday}@atlas`,`DTSTAMP:${stamp}`,`DTSTART:${dt}`,`DTEND:${de}`,
      `RRULE:FREQ=WEEKLY;BYDAY=${ICS_DAYS[e.weekday]}`,`SUMMARY:${icsEscape(e.title)}`,`DESCRIPTION:${icsEscape(e.desc||"")}`,
      "BEGIN:VALARM","ACTION:DISPLAY",`DESCRIPTION:${icsEscape(e.title)}`,`TRIGGER:-PT${minutesBefore||0}M`,"END:VALARM","END:VEVENT");
  });
  out.push("END:VCALENDAR");
  return out.join("\r\n")+"\r\n";
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

/* ---------- merge ----------
   Two copies of the log (this phone and Drive, or the installed app and a browser
   tab). Whole-file last-writer-wins lost whichever side logged less recently, so:
   structure (programme, plan, settings, swaps) comes from the newer copy; logged
   sets are the UNION of both, matched by their timestamp; archived blocks are the
   union by block number. If one side has rolled over to a new block, the other
   side's current-block sets are folded into the matching archived block. */
function mergeSets(a,b){
  const out=(a||[]).filter(s=>s&&s.kg!=null);
  const seen=new Set(out.map(s=>s.t||JSON.stringify(s)));
  for(const s of b||[]){if(!s||s.kg==null)continue;const k=s.t||JSON.stringify(s);if(seen.has(k))continue;seen.add(k);out.push(s)}
  return out.sort((p,q)=>(p.t||0)-(q.t||0));
}
function mergeLogs(x,y){
  const o=clone(x||{});
  for(const [k,L] of Object.entries(y||{})){
    if(!L)continue;
    if(!o[k]){o[k]=clone(L);continue}
    const O=o[k];O.ex=O.ex||{};
    for(const [i,sets] of Object.entries(L.ex||{}))O.ex[i]=mergeSets(O.ex[i],sets);
    if(!O.date&&L.date)O.date=L.date;
    if(L.done&&(!O.done||L.done>O.done))O.done=L.done;
    if(!O.once&&L.once)O.once=clone(L.once);
    if(!O.skip&&L.skip)O.skip=clone(L.skip);
  }
  return o;
}
function mergeDb(a,b){
  if(!a)return clone(b);if(!b)return clone(a);
  const newer=(a.updatedAt||0)>=(b.updatedAt||0)?a:b,older=newer===a?b:a;
  const out=clone(newer);
  out.archive=clone(newer.archive||[]);
  for(const blk of older.archive||[]){
    if(!blk||typeof blk!=="object")continue;
    const hit=out.archive.find(x=>x&&x.block===blk.block);
    if(hit)hit.logs=mergeLogs(hit.logs,blk.logs);else out.archive.push(clone(blk));
  }
  out.archive.sort((p,q)=>(p.block||0)-(q.block||0));
  if((older.block||1)===(newer.block||1))out.logs=mergeLogs(newer.logs,older.logs);
  else if((older.block||1)<(newer.block||1)){
    /* the newer copy has rolled over: the older side's live sets belong to the block it was still on */
    const hit=out.archive.find(x=>x&&x.block===(older.block||1));
    if(hit)hit.logs=mergeLogs(hit.logs,older.logs);
    else out.archive.push({block:older.block||1,logs:clone(older.logs||{}),programme:clone(older.programme||{}),swaps:clone(older.swaps||{}),plan:older.plan?clone(older.plan):undefined,endedAt:null});
  }
  out.lifts=Object.assign({},older.lifts||{},newer.lifts||{});
  out.notes=Object.assign({},older.notes||{},newer.notes||{});
  out.updatedAt=Math.max(a.updatedAt||0,b.updatedAt||0);
  return out;
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
    /* today-only swaps and time skips are slot-indexed too */
    if(L.once){const o=[];for(let i=0;i<n;i++)o.push(L.once[i]||null);const oo=transform(o);
      L.once={};oo.forEach((v,i)=>{if(v)L.once[i]=v});if(!Object.keys(L.once).length)delete L.once}
    if(L.skip){const k=[];for(let i=0;i<n;i++)k.push(L.skip.includes(i)?1:null);const kk=transform(k);
      L.skip=[];kk.forEach((v,i)=>{if(v)L.skip.push(i)});if(!L.skip.length)delete L.skip}
  }
  const sw=[];for(let i=0;i<n;i++)sw.push(swaps[d+"-"+i]||null);
  const swOut=transform(sw);
  for(let i=0;i<n;i++)delete swaps[d+"-"+i];
  swOut.forEach((v,i)=>{if(v)swaps[d+"-"+i]=v});
}

/* ---------- progression ---------- */
/* Consecutive weeks ending at w where this lift failed to beat the week before.
   WK is {week: Map(name -> {top:{e}})}. */
function stallStreak(name,w,WK,isLight){
  let n=0,newer=null;
  for(let x=w;x>=1;x--){
    if(isLight&&isLight(x))continue;   /* a planned light week is not a stall */
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
  d.archive=(Array.isArray(d.archive)?d.archive:[]).filter(b=>b&&typeof b==="object"&&b.logs&&typeof b.logs==="object");
  d.lastBackup=d.lastBackup||null;
  d.session=d.session||null;
  d.rest=d.rest||null;
  if(typeof d.logs!=="object"||Array.isArray(d.logs))d.logs={};
  /* a programme must be an object of days, each with an array of [name,range,isComp] tuples */
  if(!d.programme||typeof d.programme!=="object")d.programme=clone(defaultDays);
  for(const k of Object.keys(d.programme)){
    const day=d.programme[k];
    if(!day||typeof day!=="object"||!Array.isArray(day.ex)){delete d.programme[k];continue}
    day.ex=day.ex.filter(e=>Array.isArray(e)&&typeof e[0]==="string");
    day.title=String(day.title||"Day "+k);
  }
  if(!Object.keys(d.programme).length)d.programme=clone(defaultDays);
  /* 6.1: adjustable bar, plates and rests, plus per-lift overrides */
  const ds=defaultSettings,s=d.settings||{};
  d.settings={
    ...s,
    bar:s.bar>0?s.bar:ds.bar,
    plates:Array.isArray(s.plates)&&s.plates.length?s.plates:clone(ds.plates),
    rest:Object.assign(clone(ds.rest),s.rest||{}),
    theme:["dark","light","auto"].includes(s.theme)?s.theme:ds.theme,
    oled:!!s.oled,
    nutri:Object.assign(clone(ds.nutri||{kg:80,cm:180,age:30,sex:"m",steps:"low",goal:"maintain"}),s.nutri||{})
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
  d.errors=Array.isArray(d.errors)?d.errors.slice(-5):[];
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
  e1rm,setScore,setTonnage,fmtSet,validatePlan,planWeeks,planWeek,isDeload,isLightWeek,isRampWeek,rampSets,nextLightWeek,isoDate,mondayOf,calendarWeek,maxLoggedWeek,historyOrder,sessionStreak,adherence,buildICS,syncDecision,exNameIn,setName,incrementFor,restFor,isUnilateral,plateBreakdown,
  exOpt,setExOpt,pairOf,normaliseSupersets,remapSlots,stallStreak,migrate,bulkRange,sameMuscleLifts,slotMinutes,trimForTime,nutritionTargets,betterSet,sessionDuration,nextMonday,carriedStreak,stepValue,hitTop,underRange,hasSets,sessionDone,mergeSets,mergeLogs,mergeDb};
