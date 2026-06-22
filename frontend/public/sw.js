// Phase 2 service worker — app-shell offline caching.
//
// Strategy:
//   • navigations  → network-first, fall back to the cached app shell (offline launch)
//   • /api/*        → network-first, fall back to last cached response
//   • other GETs    → stale-while-revalidate (instant load, refresh in background)
//
// Bump CACHE when the shell list or strategy changes to retire old caches.
const CACHE = 'turnover-v2';
const SHELL = [
  '/',
  '/manifest.json',
  '/manifest.admin.json',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png',
  '/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // let cross-origin pass through

  // App navigations: try network, fall back to the cached shell so the app
  // still launches offline (SPA — any path resolves to the same shell).
  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request).catch(() => caches.match('/', { ignoreSearch: true }))
    );
    return;
  }

  // API: prefer fresh data, but serve the last good response when offline.
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
          return res;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Static assets: stale-while-revalidate.
  e.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
