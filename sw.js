const CACHE_NAME = 'sri-kaliamman-v7';
const APP_SHELL = [
  './',
  './index.html',
  './site.css?v=7',
  './site.js?v=7',
  './manifest.webmanifest?v=7',
  './assets/sri-kaliamman-logo.jpg',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './app/',
  './app/index.html',
  './app/app.css?v=7',
  './app/app.js?v=7',
  './app/sync-config.js',
  './app/js/store.js?v=7'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const request = event.request;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then((response) => {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      return response;
    }).catch(() => caches.match(request).then((cached) => cached || caches.match('./app/index.html'))));
    return;
  }
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
    if (response.ok && new URL(request.url).origin === self.location.origin) {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
    }
    return response;
  })));
});
