const CACHE_NAME = 'suwayomi-movil-v7';
const MEDIA_CACHE = 'suwayomi-offline-media-v1';
const SHELL_URLS = [
  '/movil/',
  '/movil/index.html',
  '/movil/styles.css?v=7',
  '/movil/offline.js?v=7',
  '/movil/extras.js?v=7',
  '/movil/app.js?v=7',
  '/movil/manifest.json',
  '/movil/icon-192.png',
  '/movil/icon-512.png',
  '/movil/icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME && k !== MEDIA_CACHE)
          .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (!url.pathname.startsWith('/movil')) return;

  if (url.pathname.startsWith('/movil/__offline__/')) {
    event.respondWith(
      caches.open(MEDIA_CACHE)
        .then((cache) => cache.match(url.pathname))
        .then((res) => res || new Response('', { status: 404 }))
    );
    return;
  }

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone)).catch(() => { });
        }
        return res;
      })
      .catch(() => caches.match(req).then((cached) => cached || caches.match('/movil/index.html')))
  );
});
