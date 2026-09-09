// Oxonom V2 PWA Service Worker
const CACHE_NAME = 'oxonom-v2-cache-v2';
const ASSETS_TO_CACHE = [
  '/',
  '/mobil/patron/',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE).catch((err) => console.log('Cache addAll ignored error', err));
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Pass through all API calls directly
  if (event.request.url.includes('/api/')) {
    return;
  }
  // Network first with cache fallback
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request).then(res => res || caches.match('/mobil/patron/')))
  );
});
