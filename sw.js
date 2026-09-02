/* ATLAS service worker.

   Release checklist (tests/version.test.js enforces it):
     1. bump CACHE below
     2. bump APP_VERSION in js/app.js
     3. bump the ?v= query on the css/js tags in index.html

   Strategy: the page itself is network-first so a new release is picked up on
   the next open; css/js/icons are cache-first for instant offline loads and
   are matched on their exact (versioned) URL, so a new index.html always pulls
   matching assets rather than a stale mix. */
const CACHE = "atlas-v6.9";
const V = CACHE.replace("atlas-v", "");
const ASSETS = [
  "./", "./index.html", "./manifest.json",
  "./css/atlas.css?v=" + V, "./js/config.js?v=" + V, "./js/data.js?v=" + V, "./js/core.js?v=" + V,
  "./js/share.js?v=" + V, "./js/drive.js?v=" + V, "./js/app.js?v=" + V,
  "./icon-192.png", "./icon-512.png",
  "./icon-maskable-192.png", "./icon-maskable-512.png", "./apple-touch-icon.png"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  const sameOrigin = url.origin === location.origin;
  if (!sameOrigin) return;   /* Google APIs and the sign-in script go straight to the network */
  const isPage = e.request.mode === "navigate" || (sameOrigin && /\/(index\.html)?$/.test(url.pathname));

  if (isPage) {
    e.respondWith(
      fetch(e.request).then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put("./index.html", copy)); }
        return res;
      }).catch(() => caches.match("./index.html"))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then(hit =>
      hit || fetch(e.request).then(res => {
        if (res.ok && sameOrigin) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      }).catch(() => caches.match("./index.html"))
    )
  );
});
