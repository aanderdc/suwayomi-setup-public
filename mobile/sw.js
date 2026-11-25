const CACHE_NAME = 'suwayomi-movil-v16';
const MEDIA_CACHE = 'suwayomi-offline-media-v1';
const SHELL_URLS = [
  '/movil/',
  '/movil/index.html',
  '/movil/styles.css?v=16',
  '/movil/offline.js?v=16',
  '/movil/extras.js?v=16',
  '/movil/remote.js?v=16',
  '/movil/app.js?v=16',
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

function fetchWithTimeout(req, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    fetch(req).then((res) => {
      clearTimeout(timer);
      resolve(res);
    }, (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (!url.pathname.startsWith('/movil')) return;

  // Nunca cachear tráfico dinámico de la bóveda ni acciones privadas
  if (url.pathname.startsWith('/movil/__vault__/') || url.pathname.startsWith('/movil/__action__/')) {
    return;
  }

  if (url.pathname.startsWith('/movil/__offline__/')) {
    event.respondWith(
      caches.open(MEDIA_CACHE)
        .then((cache) => cache.match(url.pathname))
        .then((res) => res || new Response('', { status: 404 }))
    );
    return;
  }

  // Recursos estáticos versionados e iconos: cache-first para arranque instantáneo con el PC apagado
  const isStaticAsset = url.search.includes('v=') || /\.(png|svg|json|css|js)$/i.test(url.pathname);
  if (isStaticAsset && !url.pathname.endsWith('.html')) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          if (res && res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone)).catch(() => { });
          }
          return res;
        });
      })
    );
    return;
  }

  // HTML principal (/movil/ o /movil/index.html): red rápida (2.2s máx) y fallback a caché local
  event.respondWith(
    fetchWithTimeout(req, 2200)
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
