/**
 * Zenza FID — service worker
 * ---------------------------
 * Security-first caching strategy for a fraud-intelligence tool:
 *
 *  - The APP SHELL (HTML/CSS/JS/icons) is cached so the console loads
 *    instantly and the UI itself works offline (or on a flaky connection).
 *  - API responses (/api/*) are NEVER cached. Fraud intelligence data is
 *    sensitive — this app deliberately does not persist it to the device's
 *    disk cache, even for convenience. Every API call goes to the network;
 *    if there's no network, the request fails with a clear error rather
 *    than silently serving stale (or worse, cached-forever) case data.
 *
 * Bump CACHE_VERSION whenever public/ changes so returning users get the
 * new shell instead of a stale cached one.
 */

const CACHE_VERSION = "zenza-fid-shell-v3";

const SHELL_ASSETS = [
  "/login.html",
  "/console.html",
  "/manifest.json",
  "/assets/theme.css",
  "/assets/app.css",
  "/assets/site.js",
  "/assets/app.js",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/zenzatech-icon-transparent-teal.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never touch the API — always go to the network, never cache, never
  // serve a cached fallback. Fraud data does not belong in disk cache.
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(event.request).catch(
        () =>
          new Response(
            JSON.stringify({ ok: false, error: "You're offline — this action needs a network connection." }),
            { status: 503, headers: { "Content-Type": "application/json" } }
          )
      )
    );
    return;
  }

  // App shell: cache-first, falling back to network, then updating the
  // cache in the background (stale-while-revalidate).
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request)
        .then((response) => {
          if (response.ok && event.request.method === "GET") {
            const copy = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});
