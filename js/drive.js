/* ATLAS · Google Drive sync.
   Drive holds the master copy of the log in the app's private appDataFolder;
   the phone keeps a working cache so logging in the gym never waits on a
   network. Sync runs on open, after a finished session, when the app goes to
   the background, when the network returns, and on demand from Settings.
   Newer `updatedAt` wins; a phone with nothing on it always adopts Drive.

   Needs a Google OAuth client ID (Web application) whose authorised
   JavaScript origin is where ATLAS is hosted. See README → Google Drive sync. */

const DRIVE={token:null,exp:0,busy:false};
const DRIVE_SCOPE="https://www.googleapis.com/auth/drive.appdata";
const DRIVE_FILE="atlas.json";

function driveClientId(){return (db.sync&&db.sync.clientId)||(typeof GOOGLE_CLIENT_ID!=="undefined"&&GOOGLE_CLIENT_ID)||""}
const driveOn=()=>!!(db.sync&&db.sync.enabled);

function loadGIS(){
  return new Promise((res,rej)=>{
    if(window.google&&google.accounts&&google.accounts.oauth2)return res();
    const s=document.createElement("script");s.src="https://accounts.google.com/gsi/client";s.async=true;
    s.onload=res;s.onerror=()=>rej(new Error("Google sign-in script failed to load"));
    document.head.appendChild(s);
  });
}
/* Access tokens live about an hour. A silent request works while the Google
   session is alive; otherwise the user has to tap Sync (popup rules). */
async function driveToken(interactive){
  if(DRIVE.token&&Date.now()<DRIVE.exp-60e3)return DRIVE.token;
  await loadGIS();
  return new Promise((res,rej)=>{
    const tc=google.accounts.oauth2.initTokenClient({
      client_id:driveClientId(),scope:DRIVE_SCOPE,
      callback:r=>{
        if(r.error)return rej(new Error(r.error==="interaction_required"||r.error==="access_denied"?"auth":r.error));
        DRIVE.token=r.access_token;DRIVE.exp=Date.now()+((+r.expires_in)||3600)*1000;res(DRIVE.token);
      },
      error_callback:e=>rej(new Error(e&&e.type==="popup_closed"?"cancelled":"auth"))
    });
    tc.requestAccessToken({prompt:interactive?"consent":""});
  });
}
async function dfetch(url,opts={},interactive){
  const t=await driveToken(interactive);
  const r=await fetch(url,{...opts,headers:{...(opts.headers||{}),Authorization:"Bearer "+t}});
  if(r.status===401){DRIVE.token=null;throw new Error("auth")}
  if(!r.ok)throw new Error("Drive "+r.status);
  return r;
}
async function driveFind(){
  const q=encodeURIComponent(`name='${DRIVE_FILE}' and trashed=false`);
  const r=await dfetch(`https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id,modifiedTime,size)`);
  const j=await r.json();return (j.files&&j.files[0])||null;
}
async function driveRead(id){return (await dfetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`)).json()}
async function driveWrite(id,obj){
  const meta=id?{name:DRIVE_FILE}:{name:DRIVE_FILE,parents:["appDataFolder"]};
  const b="atlas"+Date.now();
  const body=`--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(obj)}\r\n--${b}--`;
  const url=id?`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=multipart`
             :"https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";
  const r=await dfetch(url,{method:id?"PATCH":"POST",headers:{"Content-Type":"multipart/related; boundary="+b},body});
  return (await r.json()).id;
}

function drivePayload(){const p=clone(db);p.exportedAt=new Date().toISOString();p.appVersion=APP_VERSION;delete p.session;delete p.rest;return p}
/* Replace the local copy with Drive's, keeping this device's connection details */
function adoptRemote(remote){
  const keep=db.sync;
  db=migrateDb(remote);
  db.sync=Object.assign({},remote.sync||{},keep,{enabled:true});
  DAYS=db.programme;
  save({quiet:true});applyTheme();
  const cur=document.querySelector(".screen.active");
  if(cur)showNow(cur.id.slice(4));
}

/* opts.force: "upload" | "download"; opts.quiet: no toasts on success */
async function driveSync(opts={}){
  if(!driveOn()||DRIVE.busy)return;
  if(!navigator.onLine){renderSyncStatus();return}
  DRIVE.busy=true;renderSyncStatus("Syncing…");
  let dec="none";
  try{
    const f=await driveFind();
    const remote=f?await driveRead(f.id).catch(()=>null):null;
    const localEmpty=!Object.keys(db.logs).length&&!db.archive.length;
    dec=opts.force||syncDecision(db.updatedAt||0,remote?(remote.updatedAt||0):0,!!remote,localEmpty);
    if(dec==="download"&&S)dec="deferred";          /* never swap the log out from under a live session */
    if(dec==="download"&&remote)adoptRemote(remote);
    else if(dec==="upload"){db.sync.fileId=await driveWrite(f?f.id:null,drivePayload());db.lastBackup=Date.now()}
    db.sync.lastSync=Date.now();db.sync.error=null;save({quiet:true});
    if(!opts.quiet)toast(dec==="download"?"Updated from Google Drive":dec==="upload"?"Saved to Google Drive":dec==="deferred"?"Drive has newer data — will update after this session":"Drive is up to date");
  }catch(e){
    db.sync.error=e.message;save({quiet:true});
    if(e.message==="cancelled"){/* user closed the popup */}
    else if(e.message==="auth"){if(!opts.quiet)toast("Tap Sync now in Settings to reconnect Google Drive")}
    else if(!opts.quiet)toast("Drive sync failed: "+e.message);
  }finally{DRIVE.busy=false;renderSyncStatus()}
  return dec;
}

async function connectDrive(){
  const id=($("drive-client")&&$("drive-client").value.trim())||driveClientId();
  if(!id){toast("Paste your Google client ID first");return}
  db.sync=Object.assign({},db.sync,{clientId:id});save({quiet:true});
  try{
    await driveToken(true);
    const f=await driveFind();
    const remote=f?await driveRead(f.id).catch(()=>null):null;
    const localEmpty=!Object.keys(db.logs).length&&!db.archive.length;
    let force="upload";
    if(remote&&(Object.keys(remote.logs||{}).length||(remote.archive||[]).length)){
      if(localEmpty)force="download";
      else{
        const n=Object.keys(remote.logs||{}).length,when=remote.exportedAt?remote.exportedAt.slice(0,10):"unknown date";
        force=await ask({title:"Drive already has a log",
          body:`Saved <b>${when}</b> with ${n} session${n===1?"":"s"} in its current block.<br><br><b>Use Drive copy</b> replaces what's on this phone. <b>Cancel</b> keeps this phone's log and overwrites Drive instead.`,
          ok:"Use Drive copy"})?"download":"upload";
      }
    }
    db.sync.enabled=true;save({quiet:true});
    await driveSync({force});
    toast("Google Drive connected");
  }catch(e){
    if(e.message!=="cancelled")toast(e.message==="auth"?"Google sign-in didn't complete":"Couldn't connect: "+e.message);
  }
  renderSettings();
}
function disconnectDrive(){
  try{if(DRIVE.token&&window.google)google.accounts.oauth2.revoke(DRIVE.token,()=>{})}catch(e){}
  DRIVE.token=null;db.sync=Object.assign({},db.sync,{enabled:false,error:null});save({quiet:true});
  renderSettings();toast("Drive disconnected — your log stays on this phone");
}

function syncStatusText(){
  if(!driveOn())return "";
  if(!navigator.onLine)return "Offline · will sync when back online";
  if(db.sync.error==="auth")return "Signed out of Google · tap Sync now";
  if(db.sync.error)return "Last attempt failed · "+db.sync.error;
  if(!db.sync.lastSync)return "Not synced yet";
  const m=Math.round((Date.now()-db.sync.lastSync)/60000);
  return "Synced "+(m<1?"just now":m<60?m+" min ago":Math.round(m/60)+" h ago");
}
function renderSyncStatus(txt){const el=$("drive-status");if(el)el.textContent=txt||syncStatusText()}
function renderDrive(){
  const el=$("set-drive");if(!el)return;
  const hasCfg=!!(typeof GOOGLE_CLIENT_ID!=="undefined"&&GOOGLE_CLIENT_ID);
  if(!driveOn()){
    el.innerHTML=`<div class="setrow col">
      <div class="lrtext"><b>Google Drive</b><i>Keep the master copy of your log in your Drive. Syncs on open, after each session and on demand. The phone stays fully usable offline.</i></div>
      ${hasCfg?"":`<input class="searchbar" id="drive-client" style="margin:0" placeholder="Google OAuth client ID (…apps.googleusercontent.com)" value="${esc((db.sync&&db.sync.clientId)||"")}" autocomplete="off" spellcheck="false">`}
      <button class="bigbtn primary" style="padding:14px" onclick="connectDrive()">Connect Google Drive</button>
      ${hasCfg?"":`<div class="hsets" style="color:var(--ink-faint)">Needs a client ID from Google Cloud — the README has the five steps.</div>`}
    </div>`;
  }else{
    el.innerHTML=`<div class="setrow"><span class="lrico"><svg viewBox="0 0 24 24" class="gico"><path d="M7 18.5h10.5a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.6 9.4 4.6 4.6 0 0 0 7 18.5z"/></svg></span>
      <div class="lrtext"><b>Google Drive · connected</b><i id="drive-status">${syncStatusText()}</i></div></div>
      <div class="setrow" style="gap:8px"><button class="bigbtn ghost" style="margin:0;flex:1;padding:13px" onclick="disconnectDrive()">Disconnect</button>
      <button class="bigbtn primary" style="flex:1.4;padding:13px" onclick="driveSync({})">Sync now</button></div>`;
  }
}
addEventListener("online",()=>driveSync({quiet:true}));
document.addEventListener("visibilitychange",()=>{if(document.hidden&&driveOn()&&!S)driveSync({quiet:true})});
