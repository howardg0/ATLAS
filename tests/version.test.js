/* Release-consistency checks: the three version stamps must agree and the
   service worker must only precache files that exist. */
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.join(__dirname,"..");
const read=f=>fs.readFileSync(path.join(root,f),"utf8");

test("APP_VERSION, sw CACHE and index.html ?v= all match",()=>{
  const app=read("js/app.js").match(/APP_VERSION="([^"]+)"/)[1];
  const sw=read("sw.js").match(/CACHE\s*=\s*"atlas-v([^"]+)"/)[1];
  const tags=[...read("index.html").matchAll(/(?:href|src)="[^"]+\?v=([^"]+)"/g)].map(m=>m[1]);
  assert.equal(tags.length>=4,true,"css + 3 js tags should carry a ?v= stamp");
  for(const t of tags)assert.equal(t,app,"index.html tag version");
  assert.equal(sw,app,"sw.js cache version");
});

test("every precached asset exists on disk",()=>{
  const src=read("sw.js");
  const v=src.match(/CACHE\s*=\s*"atlas-v([^"]+)"/)[1];
  const listed=[...src.matchAll(/"\.\/([^"]*)"/g)].map(m=>m[1]).filter(Boolean);
  for(const a of listed){
    const file=a.replace(/\?v=.*$/,"").replace(/"\s*\+\s*V$/,"");
    if(!file)continue;
    assert.equal(fs.existsSync(path.join(root,file)),true,"missing "+file);
  }
  assert.equal(listed.length>=8,true);
  assert.equal(typeof v,"string");
});
