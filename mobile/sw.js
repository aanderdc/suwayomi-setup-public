const CACHE_NAME = 'suwayomi-movil-v19';
const MEDIA_CACHE = 'suwayomi-offline-media-v1';
const SHELL_URLS = [
  '/movil/',
  '/movil/index.html',
  '/movil/styles.css?v=19',
  '/movil/offline.js?v=19',
  '/movil/extras.js?v=19',
  '/movil/remote.js?v=19',
  '/movil/app.js?v=19',
  '/movil/manifest.json',
  '/movil/icon-192.png',
  '/movil/icon-512.png',
  '/movil/icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_URLS.map((u) => new Request(u, { cache: 'reload' }))))
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

  // Nunca cachear tráfico dinámico ni el propio sw.js
  if (
    url.pathname === '/movil/sw.js' ||
    url.pathname.startsWith('/movil/__vault__/') ||
    url.pathname.startsWith('/movil/__action__/')
  ) {
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

  // Recursos estáticos versionados (?v=17) e iconos: cache-first para arranque instantáneo con PC apagado
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

  // HTML principal (/movil/ o /movil/index.html): siempre intenta red sin caché HTTP (hasta 5s) y cae a caché si PC apagado
  const netReq = new Request('/movil/index.html', { cache: 'no-store' });
  const netPromise = fetchWithTimeout(netReq, 5000).then((res) => {
    if (res && res.ok) {
      const clone1 = res.clone();
      const clone2 = res.clone();
      caches.open(CACHE_NAME).then((cache) => {
        cache.put('/movil/index.html', clone1).catch(() => { });
        cache.put('/movil/', clone2).catch(() => { });
      }).catch(() => { });
    }
    return res;
  });

  event.respondWith(
    netPromise.catch(() => caches.match('/movil/index.html').then((cached) => cached || caches.match('/movil/')))
  );
});
