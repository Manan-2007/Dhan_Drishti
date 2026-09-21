/**
 * Minimal service worker for Dhan Drishti — makes the app installable and gives the static
 * shell an offline cache. It NEVER caches API responses (those are per-user, live data): only
 * same-origin GETs for the app shell and assets, stale-while-revalidate. No precache manifest,
 * so it works with Vite's hashed filenames without a build step.
 */
const CACHE = "dd-shell-v1";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Drop caches from older versions of this worker.
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // leave cross-origin (fonts/CDNs) to the network
  if (url.pathname.startsWith("/api") || url.pathname === "/health") return; // never cache live data

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok && res.type === "basic") cache.put(req, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })(),
  );
});
