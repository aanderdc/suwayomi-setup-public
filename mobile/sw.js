const CACHE_NAME = 'suwayomi-movil-v3';
const SHELL_URLS = [
  '/movil/',
  '/movil/index.html',
  '/movil/styles.css?v=3',
  '/movil/app.js?v=3',
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
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Solo cacheamos el shell de /movil/ (nunca /api/graphql ni imagenes dinamicas)
  if (!url.pathname.startsWith('/movil')) return;

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
