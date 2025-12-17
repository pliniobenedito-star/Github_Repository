const CACHE_NAME = 'rail-chainage-pwa-v9';

const SCOPE_URL = self.registration?.scope ?? self.location.href;
const SCOPE_PATH = new URL(SCOPE_URL).pathname;
const INDEX_URL = new URL('index.html', SCOPE_URL).toString();

const ASSETS = [
  './',
  'index.html',
  'map.js',
  'manifest.webmanifest',
  'icon-192.png',
  'icon-512.png',
  'Icon%20button/milepost_icon.png',
  'Icon%20button/access_icon.png',
  'Icon%20button/Reference_line.png',
  'Icon%20button/Show_access.png'
].map((path) => new URL(path, SCOPE_URL).toString());

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
    caches.match(request).then(async (cached) => {
      if (cached) return cached;
      try {
        const response = await fetch(request);
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        return response;
      } catch (error) {
        const isNavigation = request.mode === 'navigate' || request.destination === 'document';
        const isScopeRoot = url.pathname === SCOPE_PATH || url.pathname === `${SCOPE_PATH}index.html`;
        if (isNavigation || isScopeRoot) {
          return caches.match(INDEX_URL);
        }
        return caches.match(request);
      }
    })
  );
});
