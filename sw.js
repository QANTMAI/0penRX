/* 0penRX service worker — speed + offline, accuracy-safe.
 *
 * Strategy:
 *  - App shell (HTML/CSS/JS/fonts/icons): precached on install, then served
 *    stale-while-revalidate, so repeat loads and in-app navigation are instant
 *    while a fresh copy is fetched in the background.
 *  - Navigations: network-first with an offline fallback to the cached shell.
 *  - Cross-origin requests (RxNorm, openFDA, CMS NADAC, the backend): NEVER
 *    cached. Live drug/price/shortage data must always be fresh when online, so
 *    the worker stays out of the way and lets the network (and the app's own
 *    fail-soft handling) take over. Offline, those calls fail and the UI shows
 *    "unavailable" rather than a stale price.
 *
 * Bump CACHE on any shell-asset change so old caches are evicted on activate.
 */
const CACHE = 'openrx-shell-v22';
const SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/assets/styles.css',
  '/assets/app.js',
  '/assets/live.js',
  '/assets/catalog.js',
  '/assets/catalog-validator.js',
  '/assets/config.js',
  '/assets/favicon.svg',
  '/assets/fonts/dm-sans-latin.woff2',
  '/assets/fonts/instrument-serif-latin.woff2',
  '/assets/fonts/instrument-serif-italic-latin.woff2',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // Don't fail the whole install if one optional asset 404s.
      .then((cache) => Promise.allSettled(SHELL.map((u) => cache.add(u))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Cross-origin (gov/FDA/backend APIs): stay out of the way — always live.
  if (url.origin !== self.location.origin) return;

  // Navigations: fresh when online, cached shell when offline.
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('/index.html')));
    return;
  }

  // Same-origin assets: stale-while-revalidate.
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
