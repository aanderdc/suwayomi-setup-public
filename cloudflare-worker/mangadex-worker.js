// Puente CORS gratuito en Cloudflare Workers para Suwayomi Movil (Modo Directo MangaDex)
// Solo reenvia peticiones GET/OPTIONS a api.mangadex.org y a imagenes de uploads.mangadex.org / *.mangadex.network.
// Despliegue gratuito (100.000 peticiones/dia): https://dash.cloudflare.com -> Workers & Pages -> Create Worker

const UPSTREAM = 'https://api.mangadex.org';

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

function isAllowedImgHost(hostname) {
  const h = (hostname || '').toLowerCase();
  return h === 'uploads.mangadex.org' || h === 'mangadex.network' || h.endsWith('.mangadex.network');
}

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') || '*';
    const headers = corsHeaders(origin);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== 'GET') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }

    const url = new URL(request.url);
    if (url.pathname === '/' || url.pathname === '/health') {
      return new Response(JSON.stringify({ ok: true, bridge: 'suwayomi-movil-mangadex', v: 2 }), {
        status: 200,
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }

    // Puente de imagenes de capitulos y portadas (MangaDex@Home exige Referer: https://mangadex.org/)
    if (url.pathname === '/img') {
      const raw = url.searchParams.get('u') || '';
      let target;
      try { target = new URL(raw); } catch { target = null; }
      if (!target || target.protocol !== 'https:' || !isAllowedImgHost(target.hostname)) {
        return new Response(JSON.stringify({ error: 'Image host not allowed' }), {
          status: 403,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }
      const imgRes = await fetch(target.toString(), {
        method: 'GET',
        headers: {
          'Referer': 'https://mangadex.org/',
          'User-Agent': 'Mozilla/5.0 (compatible; SuwayomiMovilBridge/2.0)'
        }
      });
      const outHeaders = new Headers(imgRes.headers);
      for (const [k, v] of Object.entries(headers)) outHeaders.set(k, v);
      outHeaders.delete('set-cookie');
      if (imgRes.ok) outHeaders.set('Cache-Control', 'public, max-age=86400');
      return new Response(imgRes.body, { status: imgRes.status, headers: outHeaders });
    }

    // Permitir solo rutas de lectura de api.mangadex.org
    const allowed = /^\/(manga(\/[0-9a-f-]{36}(\/feed)?)?|manga\/tag|at-home\/server\/[0-9a-f-]{36}|ping)$/i;
    if (!allowed.test(url.pathname)) {
      return new Response(JSON.stringify({ error: 'Path not allowed' }), {
        status: 403,
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }

    const targetUrl = UPSTREAM + url.pathname + url.search;
    const upstreamRes = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'SuwayomiMovilBridge/2.0',
        'Accept': 'application/json'
      }
    });

    const outHeaders = new Headers(upstreamRes.headers);
    for (const [k, v] of Object.entries(headers)) {
      outHeaders.set(k, v);
    }
    outHeaders.delete('set-cookie');

    return new Response(upstreamRes.body, {
      status: upstreamRes.status,
      headers: outHeaders
    });
  }
};
