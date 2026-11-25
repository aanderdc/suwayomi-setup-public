// Puente CORS gratuito en Cloudflare Workers para Suwayomi Movil (Modo Directo MangaDex)
// Solo reenvia peticiones GET/OPTIONS a https://api.mangadex.org (no es un proxy abierto).
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
      return new Response(JSON.stringify({ ok: true, bridge: 'suwayomi-movil-mangadex' }), {
        status: 200,
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
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
        'User-Agent': 'SuwayomiMovilBridge/1.0',
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
