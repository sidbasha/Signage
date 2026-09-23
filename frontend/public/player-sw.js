// Offline shell for the web player: a screen that reboots without network still starts and plays
// its cached content (media itself lives in Cache Storage, managed by the player engine).
const SHELL = "signage-shell-v1";

self.addEventListener("install", (e) => { self.skipWaiting(); e.waitUntil(caches.open(SHELL).then(c => c.addAll(["/player", "/favicon.svg"]))); });
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/hubs/")) return; // never cache API traffic

  if (e.request.mode === "navigate" && url.pathname.startsWith("/player")) {
    // network first, so deployments reach screens; cached shell when offline
    e.respondWith(fetch(e.request).then(res => { const copy = res.clone(); caches.open(SHELL).then(c => c.put("/player", copy)); return res; })
      .catch(() => caches.match("/player")));
    return;
  }
  if (url.pathname.startsWith("/assets/")) {
    // hashed, immutable build assets: cache first
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(SHELL).then(c => c.put(e.request, copy)); }
      return res;
    })));
  }
});
