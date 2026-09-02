/* Integrity checks for js/data.js: every lift is well-formed and every
   reference (substitutions, default programme) points at a real lift. */
const test=require("node:test");
const assert=require("node:assert/strict");
const D=require("../js/data.js");

const PATTERNS=["Squat","Hinge","Horizontal Push","Vertical Push","Horizontal Pull","Vertical Pull","Isolation","Core"];
const EQUIPMENT=["Barbell","Dumbbell","Cable","Machine","Smith","EZ-Bar","Bodyweight"];

test("every lift has a valid group, pattern, equipment, muscles, about and cues",()=>{
  for(const [n,e] of Object.entries(D.EXDB)){
    assert.ok(D.GROUPS.includes(e.g),n+": group "+e.g);
    assert.ok(PATTERNS.includes(e.pat),n+": pattern "+e.pat);
    assert.ok(EQUIPMENT.includes(e.eq),n+": equipment "+e.eq);
    assert.ok(e.pri.length>=1,n+": needs a primary muscle");
    for(const m of [...e.pri,...e.sec])assert.ok(m in D.MUSCLE_NAMES,n+": unknown muscle "+m);
    for(const m of e.pri)assert.ok(!e.sec.includes(m),n+": "+m+" is both primary and secondary");
    assert.ok(typeof e.about==="string"&&e.about.length>40,n+": about text");
    assert.ok(Array.isArray(e.form)&&e.form.length>=3,n+": at least three form cues");
    if(e.uni!==undefined)assert.equal(e.uni,1,n+": uni flag must be 1 when present");
    if(e.timed!==undefined)assert.equal(e.timed,1,n+": timed flag must be 1 when present");
  }
});

test("every muscle used in the map has a diagram region and a display name",()=>{
  for(const k of Object.keys(D.MUSCLE_NAMES))assert.ok(Array.isArray(D.MUSCLE_MAP[k])&&D.MUSCLE_MAP[k].length,"no diagram region for "+k);
  for(const k of Object.keys(D.MUSCLE_MAP))assert.ok(k in D.MUSCLE_NAMES,"no name for "+k);
});

test("substitutions and the default programme only reference real lifts",()=>{
  for(const [k,list] of Object.entries(D.SUBS)){
    assert.ok(k in D.EXDB,"SUBS key "+k);
    for(const n of list)assert.ok(n in D.EXDB,"SUBS "+k+" → "+n);
    assert.equal(new Set(list).size,list.length,"duplicate swap under "+k);
    assert.ok(!list.includes(k),k+" lists itself as a swap");
  }
  for(const [d,day] of Object.entries(D.DEFAULT_DAYS)){
    assert.ok(day.title);
    for(const e of day.ex){
      assert.ok(e[0] in D.EXDB,"day "+d+": "+e[0]);
      assert.match(e[1],/^\d+(–\d+)?$/,"day "+d+": rep range "+e[1]);
      assert.ok(e[2]===0||e[2]===1,"day "+d+": compound flag");
    }
  }
});

test("the library is substantial and every group has depth",()=>{
  const counts={};
  for(const e of Object.values(D.EXDB))counts[e.g]=(counts[e.g]||0)+1;
  assert.ok(Object.keys(D.EXDB).length>=120,"expected 120+ lifts, got "+Object.keys(D.EXDB).length);
  for(const g of D.GROUPS)assert.ok(counts[g]>=7,g+" has only "+(counts[g]||0)+" lifts");
});

test("block plan presets are well-formed",()=>{
  assert.ok(D.PLAN_PRESETS[D.DEFAULT_PLAN.name],"default plan is one of the presets");
  for(const [n,weeks] of Object.entries(D.PLAN_PRESETS)){
    assert.ok(weeks.length>=2&&weeks.length<=12,n);
    for(const w of weeks){
      assert.ok(D.PHASES.includes(w.phase),n+": "+w.phase);
      assert.ok(w.comp>=1&&w.acc>=0,n);
      assert.match(w.rir,/^\d+(–\d+)?$/,n+": rir "+w.rir);
    }
  }
});
test("programme templates only use real lifts and valid tuples",()=>{
  assert.ok(D.PROGRAMME_TEMPLATES.length>=3);
  const ids=new Set();
  for(const t of D.PROGRAMME_TEMPLATES){
    assert.ok(t.id&&t.name&&t.tag&&t.desc,"template metadata");
    assert.ok(!ids.has(t.id),"duplicate id "+t.id);ids.add(t.id);
    const days=Object.keys(t.programme);
    assert.ok(days.length>=1&&days.length<=8,t.id+": day count");
    for(const d of days){
      assert.match(d,/^[A-H]$/,t.id+": day id "+d);
      assert.ok(t.programme[d].title,t.id+": day title");
      for(const e of t.programme[d].ex){
        assert.ok(e[0] in D.EXDB,t.id+" day "+d+": unknown lift "+e[0]);
        assert.match(e[1],/^\d+(–\d+)?$/,t.id+": rep range "+e[1]);
        assert.ok(e[2]===0||e[2]===1,t.id+": compound flag");
      }
    }
  }
  assert.ok(D.PROGRAMME_TEMPLATES.some(t=>t.programme===D.DEFAULT_DAYS),"the default programme is one of the templates");
  const phys=D.PROGRAMME_TEMPLATES.find(t=>t.id==="physique");
  assert.ok(phys&&phys.plan&&phys.plan.open,"the physique template carries an open plan");
  assert.equal(Object.keys(phys.programme).length,6);
  for(const day of Object.values(phys.programme))for(const e of day.ex)if(e[3]&&e[3].sets)assert.ok(e[3].sets>=1&&e[3].sets<=8,"pinned sets in range");
  assert.ok(D.PROGRAMME_TEMPLATES.some(t=>Object.values(t.programme).every(day=>day.ex.length===0)),"there is an empty starting point");
});
test("isBarbellLift follows the equipment field",()=>{
  assert.equal(D.isBarbellLift("Back Squat"),true);
  assert.equal(D.isBarbellLift("Leg Press"),false);
  assert.equal(D.isBarbellLift("Not A Lift"),false);
});
