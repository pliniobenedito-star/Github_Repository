const CACHE_NAME = 'rail-chainage-pwa-v3';
const ASSETS = [
  '/',
  '/index.html',
  '/map.js',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  '/rail-icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return; // pass-through for cross-origin (e.g., Mapbox tiles)
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => {
          if (url.pathname === '/' || url.pathname === '/index.html') {
            return caches.match('/index.html');
          }
          return cached;
        });
    })
  );
});
