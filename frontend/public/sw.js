// Phase 1 service worker — enables "Add to Home Screen" on localhost.
// No offline caching yet; that's a Phase 2 concern.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => e.respondWith(fetch(e.request)));
