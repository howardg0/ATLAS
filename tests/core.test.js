/* Unit tests for js/core.js. Zero dependencies: `npm test` (Node 18+). */
const test=require("node:test");
const assert=require("node:assert/strict");
const D=require("../js/data.js");
const C=require("../js/core.js");

/* ---------- rep ranges ---------- */
test("parseRange accepts en dash, hyphen, em dash and spaces",()=>{
  for(const r of ["6–8","6-8","6 - 8","6—8"," 6–8 "])assert.deepEqual(C.parseRange(r),{lo:6,hi:8});
  assert.deepEqual(C.parseRange("12"),{lo:12,hi:12});
  assert.equal(C.repTop("10–15"),15);
  assert.equal(C.repBottom("10–15"),10);
});
test("normaliseRange canonicalises to an en dash or rejects",()=>{
  assert.equal(C.normaliseRange("8-12"),"8–12");
  assert.equal(C.normaliseRange(" 8 – 12 "),"8–12");
  assert.equal(C.normaliseRange("12"),"12");
  assert.equal(C.normaliseRange("eight"),null);
  assert.equal(C.normaliseRange("8-"),null);
});

/* ---------- numbers ---------- */
test("fmtKg trims trailing zeros and caps at two decimals",()=>{
  assert.equal(C.fmtKg(60),"60");
  assert.equal(C.fmtKg(62.5),"62.5");
  assert.equal(C.fmtKg(41.25),"41.25");
  assert.equal(C.fmtKg(41.2500001),"41.25");
});
test("snapStep pulls a value back onto the increment grid",()=>{
  assert.equal(C.snapStep(43.75,2.5),45);
  assert.equal(C.snapStep(41.25+5,5),45);
  assert.equal(C.snapStep(12.5,1),13);
  assert.equal(C.snapStep(7.5,2.5),7.5);
  assert.equal(C.snapStep(20,2),20);
});

/* ---------- sets ---------- */
test("e1rm is Epley to one decimal",()=>{
  assert.equal(C.e1rm(100,10),133.3);
  assert.equal(C.e1rm(80,8),101.3);
  assert.equal(C.e1rm(60,1),62);
});
test("setTonnage doubles a per-side set and ignores timed sets",()=>{
  assert.equal(C.setTonnage({kg:20,reps:10}),200);
  assert.equal(C.setTonnage({kg:20,reps:10,uni:1}),400);
  assert.equal(C.setTonnage({kg:20,reps:60,timed:1}),0);
});
test("setScore: e1RM for reps, seconds (load-scaled) for timed sets",()=>{
  assert.equal(C.setScore({kg:100,reps:10}),133.3);
  assert.equal(C.setScore({kg:0,reps:60,timed:1}),60);
  assert.equal(C.setScore({kg:10,reps:60,timed:1}),20);
  assert.ok(C.setScore({kg:10,reps:90,timed:1})>C.setScore({kg:10,reps:60,timed:1}));
});
test("fmtSet reads naturally for every kind of set",()=>{
  assert.equal(C.fmtSet({kg:85,reps:12}),"85 kg × 12");
  assert.equal(C.fmtSet({kg:85,reps:12},true),"85 × 12");
  assert.equal(C.fmtSet({kg:20,reps:60,timed:1}),"20 kg × 60 s");
  assert.equal(C.fmtSet({kg:0,reps:60,timed:1}),"60 s");
  assert.equal(C.fmtSet({kg:0,reps:12}),"12 reps");
  assert.equal(C.fmtSet({kg:24,reps:10,uni:1}),"24 kg × 10 /side");
});

/* ---------- block plan ---------- */
test("validatePlan cleans a plan or falls back to the default",()=>{
  const ok=C.validatePlan({name:"Mine",weeks:[{phase:"Build",comp:4,acc:3,rir:"2"},{phase:"Deload",comp:"2",acc:2,rir:"4-5"}]},D.DEFAULT_PLAN,D.PHASES);
  assert.equal(ok.name,"Mine");
  assert.equal(ok.weeks.length,2);
  assert.equal(ok.weeks[1].comp,2);
  assert.equal(ok.weeks[1].rir,"4–5","rir normalised to an en dash");
  const bad=C.validatePlan({weeks:[{phase:"Nonsense",comp:99,acc:-1,rir:"x"}]},D.DEFAULT_PLAN,D.PHASES);
  assert.deepEqual(bad,D.DEFAULT_PLAN,"one week is too short, so the default comes back");
  const fixed=C.validatePlan({weeks:[{phase:"Nonsense",comp:99,acc:-1,rir:"x"},{}]},D.DEFAULT_PLAN,D.PHASES);
  assert.deepEqual(fixed.weeks[0],{phase:"Build",comp:8,acc:0,rir:"2"});
  assert.deepEqual(fixed.weeks[1],{phase:"Build",comp:3,acc:3,rir:"2"});
  assert.notEqual(C.validatePlan(null,D.DEFAULT_PLAN,D.PHASES).weeks,D.DEFAULT_PLAN.weeks,"fallback is a copy");
});
test("plan accessors and history order",()=>{
  const P=D.DEFAULT_PLAN;
  assert.equal(C.planWeeks(P),6);
  assert.equal(C.planWeek(P,1).phase,"Re-groove");
  assert.equal(C.planWeek(P,99).phase,"Deload","out-of-range clamps to the last week");
  assert.equal(C.isDeload(P,6),true);
  assert.equal(C.isDeload(P,5),false);
  assert.deepEqual(C.historyOrder(P),[5,4,3,2,1,6]);
  assert.deepEqual(C.historyOrder({weeks:D.PLAN_PRESETS["5-week · no deload"]}),[5,4,3,2,1]);
});
test("every preset is valid as-is",()=>{
  for(const [n,weeks] of Object.entries(D.PLAN_PRESETS)){
    const v=C.validatePlan({name:n,weeks},D.DEFAULT_PLAN,D.PHASES);
    assert.deepEqual(v.weeks,weeks,n);
  }
});

/* ---------- open-ended plans ---------- */
test("validatePlan keeps an open plan's shape and clamps its cadence",()=>{
  const v=C.validatePlan({name:"Go",open:true,every:99,lightOffset:-3,startDate:"2026-09-07",weeks:[{phase:"Build",comp:3,acc:3,rir:"0-1"},{phase:"Deload",comp:2,acc:2,rir:"2–3"}]},D.DEFAULT_PLAN,D.PHASES);
  assert.equal(v.open,true);
  assert.equal(v.every,12);
  assert.equal(v.lightOffset,0);
  assert.equal(v.startDate,"2026-09-07");
  assert.equal(v.weeks.length,2);
  assert.equal(v.weeks[0].rir,"0–1");
  assert.equal(C.validatePlan({open:true,startDate:"nonsense",weeks:[{},{}]},D.DEFAULT_PLAN,D.PHASES).startDate,null);
  assert.deepEqual(C.validatePlan(D.PHYSIQUE_PLAN,D.DEFAULT_PLAN,D.PHASES),D.PHYSIQUE_PLAN,"the shipped open plan is already clean");
});
test("ramp-in weeks scale sets to about two-thirds, never below two",()=>{
  const P={open:true,every:6,lightOffset:0,rampWeeks:2,weeks:[{phase:"Build"},{phase:"Deload"}]};
  assert.deepEqual([1,2,3].map(w=>C.isRampWeek(P,w)),[true,true,false]);
  assert.equal(C.isRampWeek(D.DEFAULT_PLAN,1),false,"block plans never ramp");
  assert.deepEqual([4,3,2,1].map(C.rampSets),[3,2,2,1]);
  assert.equal(C.validatePlan({open:true,rampWeeks:9,weeks:[{},{}]},D.DEFAULT_PLAN,D.PHASES).rampWeeks,4);
  assert.equal(C.validatePlan({open:true,weeks:[{},{}]},D.DEFAULT_PLAN,D.PHASES).rampWeeks,0);
});
test("light weeks land on the cadence and move when postponed",()=>{
  const P={open:true,every:6,lightOffset:0,weeks:[{phase:"Build"},{phase:"Deload"}]};
  assert.deepEqual([1,5,6,7,12,13].map(w=>C.isLightWeek(P,w)),[false,false,true,false,true,false]);
  assert.equal(C.nextLightWeek(P,1),6);
  assert.equal(C.nextLightWeek(P,6),6);
  assert.equal(C.nextLightWeek(P,7),12);
  const Q={...P,lightOffset:1};
  assert.deepEqual([6,7,13].map(w=>C.isLightWeek(Q,w)),[false,true,true]);
  assert.equal(C.planWeek(P,6).phase,"Deload");
  assert.equal(C.planWeek(P,47).phase,"Build");
  assert.equal(C.isDeload(P,12),true);
  assert.equal(C.planWeeks(P),Infinity);
  assert.equal(C.isLightWeek(D.DEFAULT_PLAN,6),false,"block plans never report light weeks");
});
test("calendar weeks start on Monday and count from the start week",()=>{
  assert.equal(C.isoDate(C.mondayOf("2026-09-02")),"2026-08-31","Wednesday → that week's Monday");
  assert.equal(C.isoDate(C.mondayOf("2026-08-31")),"2026-08-31","Monday stays");
  assert.equal(C.isoDate(C.mondayOf("2026-09-06")),"2026-08-31","Sunday belongs to the week that began the Monday before");
  assert.equal(C.calendarWeek("2026-08-31","2026-08-31"),1);
  assert.equal(C.calendarWeek("2026-08-31","2026-09-06"),1);
  assert.equal(C.calendarWeek("2026-08-31","2026-09-07"),2);
  assert.equal(C.calendarWeek("2026-09-02","2026-09-08"),2,"a mid-week start still makes that week 1");
  assert.equal(C.calendarWeek("2026-08-31","2026-12-25"),17);
  assert.equal(C.calendarWeek("2026-08-31","2026-08-01"),1,"before the start is clamped to 1");
  assert.equal(C.calendarWeek(null,"2026-09-02"),1);
});
test("maxLoggedWeek and historyOrder handle open plans",()=>{
  assert.equal(C.maxLoggedWeek({}),0);
  assert.equal(C.maxLoggedWeek({"3-A":{},"11-C":{},"7-B":{}}),11);
  const P={open:true,every:6,lightOffset:0,weeks:[{phase:"Build"},{phase:"Deload"}]};
  assert.deepEqual(C.historyOrder(P,{"7-A":{},"6-A":{},"5-A":{},"1-A":{}}),[7,5,4,3,2,1,6],"latest hard weeks first, light weeks last");
  assert.deepEqual(C.historyOrder(D.DEFAULT_PLAN,{}),[5,4,3,2,1,6],"block plans ignore logs");
});

/* ---------- streaks ---------- */
test("sessionStreak counts back from the latest due session and skips ones not yet due",()=>{
  const S=(done,due=true)=>({done,due});
  assert.equal(C.sessionStreak([S(true),S(true),S(true)]),3);
  assert.equal(C.sessionStreak([S(true),S(false),S(true),S(true)]),2);
  assert.equal(C.sessionStreak([S(true),S(true),S(false,false),S(false,false)]),2,"future sessions don't break it");
  assert.equal(C.sessionStreak([S(true),S(false)]),0);
  assert.equal(C.sessionStreak([]),0);
  assert.equal(C.adherence([S(true),S(false),S(true),S(false,false)]),2/3);
  assert.equal(C.adherence([S(false,false)]),null);
});

/* ---------- calendar reminders ---------- */
test("buildICS emits one weekly recurring event with an alarm per training day",()=>{
  const ics=C.buildICS([{weekday:0,title:"Day A · Push",desc:"8 lifts"},{weekday:2,title:"Day B, Pull; hard"}],"17:30","2026-09-02",10);
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\n"));
  assert.equal((ics.match(/BEGIN:VEVENT/g)||[]).length,2);
  assert.ok(ics.includes("RRULE:FREQ=WEEKLY;BYDAY=MO"));
  assert.ok(ics.includes("RRULE:FREQ=WEEKLY;BYDAY=WE"));
  assert.ok(ics.includes("DTSTART:20260907T173000"),"first Monday on or after Wed 2 Sep 2026 is 7 Sep");
  assert.ok(ics.includes("DTSTART:20260902T173000"),"Wednesday starts the same day");
  assert.ok(ics.includes("TRIGGER:-PT10M"));
  assert.ok(ics.includes("SUMMARY:Day B\\, Pull\\; hard"),"commas and semicolons are escaped");
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
});

/* ---------- Drive sync ---------- */
test("syncDecision: newer wins, empty phone never overwrites, missing file gets uploaded",()=>{
  assert.equal(C.syncDecision(10,0,false,false),"upload");
  assert.equal(C.syncDecision(10,0,false,true),"upload");
  assert.equal(C.syncDecision(10,20,true,false),"download");
  assert.equal(C.syncDecision(30,20,true,false),"upload");
  assert.equal(C.syncDecision(20,20,true,false),"none");
  assert.equal(C.syncDecision(999,1,true,true),"download","a fresh install adopts Drive even with a newer stamp");
});
test("setName prefers the stamped name over the slot",()=>{
  const ctx={programme:{A:{ex:[["Back Squat","6–8",1]]}},swaps:{"A-0":"Hack Squat"}};
  assert.equal(C.setName({kg:1,reps:1,name:"Leg Press"},ctx,"A",0),"Leg Press");
  assert.equal(C.setName({kg:1,reps:1},ctx,"A",0),"Hack Squat");
  assert.equal(C.exNameIn({programme:ctx.programme,swaps:{}},"A",0),"Back Squat");
  assert.equal(C.exNameIn({programme:ctx.programme,swaps:{}},"A",9),"—");
});

/* ---------- per-lift overrides ---------- */
test("incrementFor: big lifts 5, others 2.5, override wins",()=>{
  assert.equal(C.incrementFor("Back Squat",{},D.BIG_INC),5);
  assert.equal(C.incrementFor("Cable Curl",{},D.BIG_INC),2.5);
  assert.equal(C.incrementFor("Cable Curl",{"Cable Curl":{inc:1}},D.BIG_INC),1);
  assert.equal(C.incrementFor("Back Squat",{"Back Squat":{inc:0}},D.BIG_INC),5);
});
test("restFor: compound/accessory default, override wins",()=>{
  const rest=D.DEFAULT_SETTINGS.rest;
  assert.equal(C.restFor("Back Squat",1,{},rest),150);
  assert.equal(C.restFor("Cable Curl",0,{},rest),90);
  assert.equal(C.restFor("Cable Curl",0,{"Cable Curl":{rest:45}},rest),45);
});
test("isUnilateral: encyclopedia default, explicit 0/1 override",()=>{
  assert.equal(C.isUnilateral("Bulgarian Split Squat",{},D.EXDB),true);
  assert.equal(C.isUnilateral("Back Squat",{},D.EXDB),false);
  assert.equal(C.isUnilateral("Bulgarian Split Squat",{"Bulgarian Split Squat":{uni:0}},D.EXDB),false);
  assert.equal(C.isUnilateral("Cable Curl",{"Cable Curl":{uni:1}},D.EXDB),true);
});

/* ---------- plates ---------- */
test("plateBreakdown loads greedily per side",()=>{
  const P=D.DEFAULT_SETTINGS.plates;
  assert.deepEqual(C.plateBreakdown(100,20,P).perSide,[25,15]);
  assert.deepEqual(C.plateBreakdown(62.5,20,P).perSide,[20,1.25]);
  assert.equal(C.plateBreakdown(20,20,P).ok,true);
  assert.deepEqual(C.plateBreakdown(20,20,P).perSide,[]);
});
test("plateBreakdown reports below-bar and nearest clean load",()=>{
  assert.equal(C.plateBreakdown(15,20,[25]).belowBar,true);
  const r=C.plateBreakdown(72,20,[25,20,15,10,5,2.5]);   /* 26 per side: 25 + 1 left over */
  assert.equal(r.ok,false);
  assert.equal(r.nearest,70);
  assert.equal(C.plateBreakdown(72,20,[25,20,15,10,5,2.5,1]).ok,true);
  assert.deepEqual(C.plateBreakdown(30,15,[5,2.5]).perSide,[5,2.5]);   /* 15 kg bar */
});

/* ---------- supersets ---------- */
test("exOpt/setExOpt keep the tuple tidy",()=>{
  const e=["A","6–8",1];
  C.setExOpt(e,"ss",1);assert.deepEqual(e,["A","6–8",1,{ss:1}]);
  assert.equal(C.exOpt(e,"ss"),1);
  C.setExOpt(e,"ss",0);assert.deepEqual(e,["A","6–8",1]);
  assert.equal(C.exOpt(e,"ss"),0);
});
test("pairOf pairs a flagged slot with the next one, both ways",()=>{
  const exs=[["A","6–8",1,{ss:1}],["B","10–12",0],["C","10–12",0]];
  assert.equal(C.pairOf(exs,0),1);
  assert.equal(C.pairOf(exs,1),0);
  assert.equal(C.pairOf(exs,2),-1);
});
test("normaliseSupersets clears flags on the last slot and on chains",()=>{
  const exs=[["A","6–8",1,{ss:1}],["B","10–12",0,{ss:1}],["C","10–12",0],["D","10–12",0,{ss:1}]];
  C.normaliseSupersets(exs);
  assert.equal(C.exOpt(exs[0],"ss"),1);
  assert.equal(C.exOpt(exs[1],"ss"),0,"B follows a flagged slot, so it cannot start a pair");
  assert.equal(C.exOpt(exs[3],"ss"),0,"last slot has nothing to pair with");
  assert.equal(C.pairOf(exs,2),-1);
  assert.equal(C.pairOf(exs,1),0);
});

/* ---------- programme edits ---------- */
function fixture(){
  const s=i=>[{kg:10*i,reps:5,name:"L"+i}];
  return{
    logs:{"1-A":{date:"2026-01-01",ex:{0:s(0),1:s(1),2:s(2)}},"2-A":{date:"2026-01-08",ex:{1:s(1)}}},
    swaps:{"A-1":"Swapped","A-2":"Other","B-0":"Untouched"}
  };
}
test("remapSlots: removing a slot shifts logs and swaps together",()=>{
  const {logs,swaps}=fixture();
  C.remapSlots(logs,swaps,"A",3,a=>{a.splice(0,1);return a},6);
  assert.deepEqual(Object.keys(logs["1-A"].ex),["0","1"]);
  assert.equal(logs["1-A"].ex[0][0].name,"L1");
  assert.equal(logs["1-A"].ex[1][0].name,"L2");
  assert.equal(logs["2-A"].ex[0][0].name,"L1");
  assert.deepEqual(swaps,{"A-0":"Swapped","A-1":"Other","B-0":"Untouched"});
});
test("remapSlots: swapping two slots keeps history attached to its lift",()=>{
  const {logs,swaps}=fixture();
  C.remapSlots(logs,swaps,"A",3,a=>{const t=a[0];a[0]=a[1];a[1]=t;return a},6);
  assert.equal(logs["1-A"].ex[0][0].name,"L1");
  assert.equal(logs["1-A"].ex[1][0].name,"L0");
  assert.equal(swaps["A-0"],"Swapped");
  assert.equal(swaps["A-1"],undefined);
  assert.equal(swaps["A-2"],"Other");
});

/* ---------- progression ---------- */
test("stallStreak counts consecutive non-improving weeks",()=>{
  const wk=e=>new Map([["Back Squat",{top:{e}}]]);
  assert.equal(C.stallStreak("Back Squat",3,{1:wk(100),2:wk(100),3:wk(100)}),2);
  assert.equal(C.stallStreak("Back Squat",3,{1:wk(100),2:wk(105),3:wk(110)}),0);
  assert.equal(C.stallStreak("Back Squat",3,{1:wk(110),2:wk(105),3:wk(105)}),2);
  assert.equal(C.stallStreak("Back Squat",4,{1:wk(100),3:wk(100),4:wk(100)}),2,"skips weeks with no data");
  assert.equal(C.stallStreak("Nope",3,{1:wk(100)}),0);
});

/* ---------- migration ---------- */
test("migrate fills every field from an empty save",()=>{
  const d=C.migrate({},D.DEFAULT_DAYS,D.DEFAULT_SETTINGS,D.DEFAULT_PLAN,D.PHASES);
  assert.equal(d.block,1);
  assert.deepEqual(d.logs,{});
  assert.deepEqual(d.programme,D.DEFAULT_DAYS);
  assert.notEqual(d.programme,D.DEFAULT_DAYS,"programme must be a copy, not the shared default");
  assert.deepEqual(d.settings,D.DEFAULT_SETTINGS);
  assert.deepEqual(d.lifts,{});
  assert.deepEqual(d.plan,D.DEFAULT_PLAN);
  assert.equal(d.updatedAt,0);
  assert.deepEqual(d.sync,{});
  assert.equal(d.programmeName,"ATLAS full body");
  assert.deepEqual(d.errors,[]);
});
test("migrate gives archived blocks a plan and keeps a valid custom plan",()=>{
  const d=C.migrate({archive:[{block:1,logs:{}}],plan:{name:"Short",weeks:[{phase:"Build",comp:3,acc:3,rir:"2"},{phase:"Peak",comp:4,acc:3,rir:"1"}]}},D.DEFAULT_DAYS,D.DEFAULT_SETTINGS,D.DEFAULT_PLAN,D.PHASES);
  assert.equal(d.plan.name,"Short");
  assert.equal(d.plan.weeks.length,2);
  assert.deepEqual(d.archive[0].plan,D.DEFAULT_PLAN);
});
test("migrate keeps user settings and fills only what is missing",()=>{
  const d=C.migrate({logs:{},settings:{bar:15,rest:{comp:120}}},D.DEFAULT_DAYS,D.DEFAULT_SETTINGS,D.DEFAULT_PLAN,D.PHASES);
  assert.equal(d.settings.bar,15);
  assert.equal(d.settings.rest.comp,120);
  assert.equal(d.settings.rest.acc,90);
  assert.equal(d.settings.rest.super,30);
  assert.equal(d.settings.theme,"dark");
  assert.deepEqual(d.settings.plates,D.DEFAULT_SETTINGS.plates);
  assert.equal(C.migrate({settings:{theme:"auto"}},D.DEFAULT_DAYS,D.DEFAULT_SETTINGS,D.DEFAULT_PLAN,D.PHASES).settings.theme,"auto");
  assert.equal(C.migrate({settings:{theme:"neon"}},D.DEFAULT_DAYS,D.DEFAULT_SETTINGS,D.DEFAULT_PLAN,D.PHASES).settings.theme,"dark");
  const bad=C.migrate({settings:{bar:-1,plates:[]}},D.DEFAULT_DAYS,D.DEFAULT_SETTINGS,D.DEFAULT_PLAN,D.PHASES);
  assert.equal(bad.settings.bar,20);
  assert.equal(bad.settings.plates.length>0,true);
});
test("migrate folds the legacy single-slot prev into the archive",()=>{
  const d=C.migrate({block:3,prev:{"1-A":{ex:{}}},swaps:{"A-0":"X"}},D.DEFAULT_DAYS,D.DEFAULT_SETTINGS,D.DEFAULT_PLAN,D.PHASES);
  assert.equal("prev" in d,false);
  assert.equal(d.archive.length,1);
  assert.equal(d.archive[0].block,2);
  assert.deepEqual(d.archive[0].swaps,{"A-0":"X"});
});

test("bulkRange sets one range on the chosen slots only",()=>{
  const p={A:{title:"a",ex:[["Squat","3–5",1],["Curl","10–15",0]]},B:{title:"b",ex:[["Row","8–12",0]]}};
  assert.equal(C.bulkRange(p,["A-1","B-0"],"8-12"),1);       /* B-0 already 8–12 */
  assert.equal(p.A.ex[0][1],"3–5");assert.equal(p.A.ex[1][1],"8–12");assert.equal(p.B.ex[0][1],"8–12");
  assert.equal(C.bulkRange(p,["A-0"],"junk"),0);assert.equal(p.A.ex[0][1],"3–5");
  assert.equal(C.bulkRange(p,["Z-9","A-7"],"6–8"),0);
});

test("sameMuscleLifts shares a primary muscle, same pattern then exact match first",()=>{
  const db={
    "Back Squat":{g:"Quads",pat:"Squat",pri:["quads","glutes"]},
    "Hack Squat":{g:"Quads",pat:"Squat",pri:["quads","glutes"]},
    "Leg Extension":{g:"Quads",pat:"Isolation",pri:["quads"]},
    "Bulgarian Split Squat":{g:"Quads",pat:"Lunge",pri:["quads","glutes"]},
    "Seated Leg Curl":{g:"Hamstrings",pat:"Isolation",pri:["hamstrings"]},
    "Calf Raise":{g:"Quads",pat:"Isolation",pri:["calves"]},
  };
  assert.deepEqual(C.sameMuscleLifts(db,"Back Squat"),["Hack Squat","Bulgarian Split Squat","Leg Extension"]);
  assert.deepEqual(C.sameMuscleLifts(db,"Back Squat",{"Back Squat":["Leg Extension"]}),["Leg Extension","Hack Squat","Bulgarian Split Squat"]);
  assert.deepEqual(C.sameMuscleLifts(db,"Nope"),[]);
});

test("trimForTime drops accessories from the end, never compounds or started slots",()=>{
  const slots=[{i:0,comp:true,min:13.6},{i:1,comp:false,min:6.9},{i:2,comp:false,min:6.9,locked:true},{i:3,comp:false,min:6.9},{i:4,comp:true,min:10.2}];
  const r=C.trimForTime(slots,35,6);
  assert.deepEqual(r.skip,[1,3]);                 /* 50.5 -> drop 3 (43.6) -> skip locked 2 -> drop 1 (36.7) */
  assert.equal(r.min,37);
  assert.deepEqual(C.trimForTime(slots,60,6).skip,[]);
  assert.deepEqual(C.trimForTime(slots,10,6).skip,[1,3]);   /* compounds alone still over budget, but never dropped */
});

test("nutritionTargets: Mifflin-St Jeor plus activity and goal shift",()=>{
  const t=C.nutritionTargets({kg:75,cm:182,age:24,sex:"m",steps:"low",days:3,goal:"gain"});
  assert.equal(t.bmr,1773);                        /* 750+1137.5-120+5 */
  assert.equal(t.maint,2450);                      /* 1772.5*1.3+150 = 2454 -> 2450 */
  assert.equal(t.kcal,2700);                       /* +250 */
  assert.equal(t.protein,150);assert.equal(t.fat,68);
  assert.equal(t.carbs,Math.round((2700-600-612)/4));
  const c=C.nutritionTargets({kg:75,cm:182,age:24,sex:"m",steps:"low",days:6,goal:"cut"});
  assert.equal(c.protein,165);assert.ok(c.kcal<c.maint-250);
  assert.equal(C.nutritionTargets({kg:0,cm:180,age:30}),null);
});

test("betterSet: heavier wins, then more reps; anything beats nothing",()=>{
  assert.equal(C.betterSet({kg:100,reps:5},{kg:95,reps:12}),true);
  assert.equal(C.betterSet({kg:100,reps:6},{kg:100,reps:5}),true);
  assert.equal(C.betterSet({kg:100,reps:5},{kg:100,reps:5}),false);
  assert.equal(C.betterSet({kg:60,reps:8},null),true);
});

test("sessionDuration spans first to last set, zero for one set",()=>{
  assert.equal(C.sessionDuration({ex:{0:[{kg:1,reps:1,t:60000}],2:[null,{kg:1,reps:1,t:26*60000}]}}),25);
  assert.equal(C.sessionDuration({ex:{0:[{kg:1,reps:1,t:5}]}}),0);
  assert.equal(C.sessionDuration(null),0);
});

test("remapSlots carries today-only swaps and time skips with their slot",()=>{
  const logs={"1-A":{ex:{0:[{kg:1,reps:1}],2:[{kg:2,reps:2}]},once:{2:"Leg Press"},skip:[1]}};
  const swaps={};
  C.remapSlots(logs,swaps,"A",3,a=>{a.splice(0,1);return a},1);   /* remove slot 0 */
  assert.deepEqual(logs["1-A"].once,{1:"Leg Press"});
  assert.deepEqual(logs["1-A"].skip,[0]);
  C.remapSlots(logs,swaps,"A",2,a=>{a.splice(0,1);return a},1);   /* remove the skipped slot: skip list disappears */
  assert.equal(logs["1-A"].skip,undefined);
  assert.deepEqual(logs["1-A"].once,{0:"Leg Press"});
});

test("migrate repairs garbage shapes instead of throwing",()=>{
  const days={A:{title:"a",ex:[["Squat","5",1]]}};
  const d=C.migrate({logs:[],archive:[null,7,{logs:{}}],programme:{A:{title:"ok",ex:[["Squat","5",1],"junk",null]},B:null,C:"nope"}},days,{bar:20,plates:[20],rest:{comp:1,acc:1,super:1},theme:"dark"},null,null);
  assert.deepEqual(d.logs,{});
  assert.equal(d.archive.length,1);
  assert.deepEqual(Object.keys(d.programme),["A"]);
  assert.equal(d.programme.A.ex.length,1);
  const e=C.migrate({programme:{A:"bad"}},days,{bar:20,plates:[20],rest:{comp:1,acc:1,super:1},theme:"dark"},null,null);
  assert.deepEqual(e.programme,days);
});
