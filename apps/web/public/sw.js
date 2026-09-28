/**
 * Minimal service worker for Dhan Drishti — makes the app installable and lets the shell open
 * offline. It NEVER caches API responses (per-user, live data).
 *
 * Pages are fetched network-first: a new build must reach the browser at once, or an old cached
 * page would ask for script files the new build no longer has and screens would fail to load.
 * Only when offline does the cached page answer. Hashed build assets (/assets/*) never change
 * under the same name, so those are served from cache first.
 */
const CACHE = "dd-shell-v2";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res && res.ok && res.type === "basic") cache.put(req, res.clone());
    return res;
  } catch {
    return (await cache.match(req)) || (req.mode === "navigate" ? await cache.match("/") : undefined) || Response.error();
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (res && res.ok && res.type === "basic") cache.put(req, res.clone());
  return res;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // fonts/CDNs go straight to the network
  if (url.pathname.startsWith("/api") || url.pathname === "/health") return; // never cache live data
  event.respondWith(url.pathname.startsWith("/assets/") ? cacheFirst(req) : networkFirst(req));
});
