/* ATLAS · session share card. Draws the day's session to a 1080×1350 canvas
   (4:5, the safe size for every social feed) and hands it to the share sheet,
   falling back to a PNG download. Colours come from the live theme tokens. */

function cssVar(n){return getComputedStyle(document.documentElement).getPropertyValue(n).trim()}
function roundRect(c,x,y,w,h,r){c.beginPath();c.moveTo(x+r,y);c.arcTo(x+w,y,x+w,y+h,r);c.arcTo(x+w,y+h,x,y+h,r);c.arcTo(x,y+h,x,y,r);c.arcTo(x,y,x+w,y,r);c.closePath()}
function ellipsize(c,text,max){if(c.measureText(text).width<=max)return text;let t=text;while(t.length>1&&c.measureText(t+"…").width>max)t=t.slice(0,-1);return t+"…"}

async function drawSessionCard(w,d){
  const L=db.logs[logKey(w,d)];if(!L)return null;
  try{await Promise.all([document.fonts.load("800 60px Sora"),document.fonts.load("600 30px Inter"),document.fonts.load("700 30px Inter")])}catch(e){}
  const W=1080,H=1350,pad=72;
  const cv=document.createElement("canvas");cv.width=W;cv.height=H;const c=cv.getContext("2d");
  const light=document.documentElement.dataset.theme==="light";
  const col={bg:cssVar("--bg")||"#0A0B0F",surface:cssVar("--surface")||"#141822",line:cssVar("--line")||"#252B3A",
    ink:cssVar("--ink")||"#F3F5FA",dim:cssVar("--ink-dim")||"#98A1B5",faint:cssVar("--ink-faint")||"#606A80",
    ember:cssVar("--ember")||"#FF5A4E",green:cssVar("--green")||"#3FB57A",gold:cssVar("--gold")||"#F2B441"};
  /* ground */
  c.fillStyle=col.bg;c.fillRect(0,0,W,H);
  const g=c.createRadialGradient(W/2,-200,50,W/2,-200,900);g.addColorStop(0,light?"rgba(224,65,62,.16)":"rgba(255,90,78,.22)");g.addColorStop(1,"rgba(0,0,0,0)");
  c.fillStyle=g;c.fillRect(0,0,W,H);
  /* wordmark: the A-bar mark, then the name */
  const mx=pad,my=pad;
  c.lineCap="round";c.lineJoin="round";c.lineWidth=13;c.strokeStyle=col.ember;
  c.beginPath();c.moveTo(mx+8,my+64);c.lineTo(mx+32,my+4);c.lineTo(mx+56,my+64);c.stroke();
  c.fillStyle=col.ink;roundRect(c,mx,my+42,64,8,4);c.fill();roundRect(c,mx-4,my+36,8,20,4);c.fill();roundRect(c,mx+60,my+36,8,20,4);c.fill();
  c.font="800 44px Sora, Inter, sans-serif";c.fillStyle=col.ink;c.textBaseline="alphabetic";c.fillText("ATLAS",mx+88,my+56);
  c.font="700 22px Inter, sans-serif";c.fillStyle=col.ember;
  const kick=`BLOCK ${db.block} · WEEK ${w} · ${phaseOf(w).toUpperCase()}`;
  c.textAlign="right";c.fillText(kick.split("").join(" "),W-pad,my+52);c.textAlign="left";
  /* title */
  let y=my+150;
  const title=`Day ${d} · ${DAYS[d].title}`;
  c.fillStyle=col.ink;c.font="800 60px Sora, Inter, sans-serif";
  if(c.measureText(title).width>W-pad*2)c.font="800 48px Sora, Inter, sans-serif";   /* long day names shrink before they truncate */
  c.fillText(ellipsize(c,title,W-pad*2),pad,y);
  y+=48;c.font="500 30px Inter, sans-serif";c.fillStyle=col.dim;
  const date=L.date?new Date(L.date+"T12:00:00").toLocaleDateString(undefined,{weekday:"long",day:"numeric",month:"long"}):"";
  c.fillText(date,pad,y);
  /* stats */
  y+=54;
  let ts=[];for(const ex of Object.values(L.ex||{}))for(const s of ex)if(s&&s.t)ts.push(s.t);
  const dur=ts.length>1?Math.round((Math.max(...ts)-Math.min(...ts))/60000):0;
  const stats=[[sessionTonnage(w,d).toLocaleString(),"TONNAGE KG"],[String(loggedSets(w,d)),"SETS"],[dur?String(dur):"—","MINUTES"]];
  const sw=(W-pad*2-2*20)/3,sh=150;
  stats.forEach(([v,k],i)=>{const x=pad+i*(sw+20);
    c.fillStyle=col.surface;roundRect(c,x,y,sw,sh,26);c.fill();c.strokeStyle=col.line;c.lineWidth=2;c.stroke();
    c.fillStyle=col.ink;c.font="800 58px Sora, Inter, sans-serif";c.fillText(v,x+28,y+80);
    c.fillStyle=col.faint;c.font="700 19px Inter, sans-serif";c.fillText(k.split("").join(" "),x+28,y+120)});
  y+=sh+48;
  /* lifts */
  const k=logKey(w,d);
  const rows=DAYS[d].ex.map((e,i)=>{
    const sets=(L.ex[i]||[]).filter(s=>s&&s.kg!=null);if(!sets.length)return null;
    const name=setName(sets[0],blockCtx(),d,i);
    const prev=liftStats(name,k);
    const best=sets.reduce((a,s)=>!a||s.kg>a.kg||(s.kg===a.kg&&s.reps>a.reps)?s:a,null);
    const pr=!!prev&&(best.kg>prev.best.kg||(best.kg===prev.best.kg&&best.reps>prev.best.reps));
    return{name,sets,pr};
  }).filter(Boolean);
  const footerY=H-pad-10;
  const avail=footerY-56-y;
  const maxRows=Math.min(rows.length,Math.floor(avail/64));
  const rh=Math.min(104,Math.floor(avail/Math.max(1,maxRows)));
  const shown=rows.slice(0,maxRows),more=rows.length-shown.length;
  const nameFs=rh>=96?34:rh>=84?30:rh>=72?27:24,setFs=rh>=96?27:rh>=84?24:rh>=72?22:20;
  shown.forEach(r=>{
    c.fillStyle=col.surface;roundRect(c,pad,y,W-pad*2,rh-12,22);c.fill();c.strokeStyle=col.line;c.lineWidth=2;c.stroke();
    c.fillStyle=col.ink;c.font=`700 ${nameFs}px Inter, sans-serif`;
    const nameMax=r.pr?W-pad*2-56-190:W-pad*2-56;
    c.fillText(ellipsize(c,r.name,nameMax),pad+28,y+(rh-12)*0.42);
    if(r.pr){c.fillStyle=col.gold;c.font="800 19px Inter, sans-serif";const t="★ NEW PR";const tw=c.measureText(t).width;
      roundRect(c,W-pad-28-tw-28,y+18,tw+28,36,10);c.fillStyle=light?"rgba(184,128,26,.16)":"rgba(242,180,65,.16)";c.fill();
      c.fillStyle=col.gold;c.fillText(t,W-pad-28-tw-14,y+44)}
    c.fillStyle=col.dim;c.font=`600 ${setFs}px Inter, sans-serif`;
    c.fillText(ellipsize(c,r.sets.map(s=>fmtSet(s,true)).join("   "),W-pad*2-56),pad+28,y+(rh-12)*0.8);
    y+=rh;
  });
  if(more>0){c.fillStyle=col.faint;c.font="600 24px Inter, sans-serif";c.fillText(`+ ${more} more lift${more===1?"":"s"}`,pad+28,y+30)}
  /* footer */
  c.fillStyle=col.faint;c.font="600 22px Inter, sans-serif";c.fillText("ATLAS · training log",pad,footerY);
  const prs=rows.filter(r=>r.pr).length;
  if(prs){c.fillStyle=col.gold;c.textAlign="right";c.fillText(`${prs} PR${prs===1?"":"s"} today`,W-pad,footerY);c.textAlign="left"}
  return new Promise(res=>cv.toBlob(res,"image/png"));
}

async function shareSession(w,d){
  tap(8);
  const blob=await drawSessionCard(w,d);
  if(!blob){toast("Nothing logged to share yet");return}
  const name=`atlas-day${d}-week${w}-${(db.logs[logKey(w,d)].date||"session")}.png`;
  const file=new File([blob],name,{type:"image/png"});
  try{
    if(navigator.canShare&&navigator.canShare({files:[file]})){await navigator.share({files:[file],title:"ATLAS session"});return}
  }catch(e){if(e&&e.name==="AbortError")return}
  const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),4000);toast("Card saved");
}
