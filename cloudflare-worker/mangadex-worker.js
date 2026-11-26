// Puente CORS gratuito en Cloudflare Workers para Suwayomi Movil (v4 Multi-fuente + Edge Cache)
// Fuentes soportadas: MangaDex (ES/EN), LeerCapitulo (ES - Mangas/Manhwas/Manhuas) y WeebCentral (EN - Manhwas/Mangas).
// Despliegue gratuito (100.000 peticiones/dia): https://dash.cloudflare.com -> Workers & Pages -> Edit code -> Deploy

const MD_API = 'https://api.mangadex.org';
const LC_BASE = 'https://www.leercapitulo.co';
const WC_BASE = 'https://weebcentral.com';
const UA = 'SuwayomiMovilBridge/4.0';
const WC_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const MAX_IMG_BYTES = 25 * 1024 * 1024;

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

function jsonResp(data, headers, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' }
  });
}

function imgRefererForHost(hostname) {
  const h = (hostname || '').toLowerCase();
  if (h === 'uploads.mangadex.org' || h === 'mangadex.network' || h.endsWith('.mangadex.network')) {
    return 'https://mangadex.org/';
  }
  if (h === 'www.leercapitulo.co' || h === 'leercapitulo.co' || h.endsWith('.t34798ndc.com')) {
    return 'https://www.leercapitulo.co/';
  }
  if (
    h === 'weebcentral.com' || h.endsWith('.weebcentral.com') ||
    h.endsWith('.compsci88.com') || h.endsWith('.planeptune.us') ||
    h.endsWith('.lowee.us') || h.endsWith('.lastation.us') ||
    h.endsWith('.leanbox.us') || h.endsWith('.mangasee123.com') || h.endsWith('.nep.li')
  ) {
    return 'https://weebcentral.com/';
  }
  return null;
}

function decodeHtml(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/[\u200e\u200f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripTags(s) {
  return decodeHtml(String(s || '').replace(/<[^>]+>/g, ' '));
}

// ---------------- LeerCapitulo (ES: Mangas, Manhwas, Manhuas) ----------------
async function handleLcBrowse(url, headers) {
  const q = (url.searchParams.get('q') || '').trim();
  const type = (url.searchParams.get('type') || 'all').toLowerCase();
  const mode = (url.searchParams.get('mode') || 'POPULAR').toUpperCase();
  const tag = (url.searchParams.get('tag') || '').trim().toLowerCase();
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);

  if (q) {
    const res = await fetch(`${LC_BASE}/search/?q=${encodeURIComponent(q)}`, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
    if (!res.ok) return jsonResp({ mangas: [], hasNextPage: false }, headers, res.status);
    let arr = [];
    try { arr = await res.json(); } catch { arr = []; }
    const mangas = (Array.isArray(arr) ? arr : [])
      .filter((it) => it && it.uri && (type === 'all' || String(it.type || '').toLowerCase() === type))
      .map((it) => ({
        id: 'lc:' + it.uri,
        title: decodeHtml(it.name || 'Sin título'),
        thumbnailUrl: it.cover_uri ? (it.cover_uri.startsWith('http') ? it.cover_uri : LC_BASE + it.cover_uri) : '',
        status: it.status || '',
        genre: it.type ? [it.type] : [],
        sourceId: 'leercapitulo'
      }));
    return jsonResp({ mangas, hasNextPage: false }, headers);
  }

  const qs = new URLSearchParams();
  if (type === 'manhwa' || type === 'manga' || type === 'manhua') qs.set('type', type);
  if (tag) qs.set('genre', tag.replace(/\s+/g, '-'));
  if (mode === 'POPULAR') qs.set('sort', 'views');
  if (page > 1) qs.set('page', String(page));

  const res = await fetch(`${LC_BASE}/manga/?${qs.toString()}`, { headers: { 'User-Agent': UA } });
  if (!res.ok) return jsonResp({ mangas: [], hasNextPage: false }, headers, res.status);
  const html = await res.text();

  const seen = new Set();
  const mangas = [];
  const cardRe = /href="(\/manga\/[a-z0-9]+\/[^"]+)"[^>]*>\s*<img[^>]+src="([^"]+)"[\s\S]{0,600}?class="lc-card-name[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = cardRe.exec(html)) !== null) {
    const uri = m[1];
    if (seen.has(uri)) continue;
    seen.add(uri);
    const cov = m[2].startsWith('http') ? m[2] : LC_BASE + m[2];
    const badgeM = m[0].match(/class="lc-card-badge"[^>]*>([^<]+)</i);
    const kind = badgeM ? decodeHtml(badgeM[1]) : (type !== 'all' ? type : '');
    mangas.push({
      id: 'lc:' + uri,
      title: stripTags(m[3]) || 'Sin título',
      thumbnailUrl: cov,
      genre: kind ? [kind] : [],
      sourceId: 'leercapitulo'
    });
  }
  const hasNextPage = html.includes(`page=${page + 1}`) && mangas.length >= 12;
  return jsonResp({ mangas, hasNextPage }, headers);
}

async function handleLcManga(url, headers) {
  const uri = url.searchParams.get('uri') || '';
  if (!/^\/manga\/[a-z0-9]+\/[^?#]+$/i.test(uri)) return jsonResp({ error: 'Invalid uri' }, headers, 400);
  const res = await fetch(LC_BASE + uri, { headers: { 'User-Agent': UA } });
  if (!res.ok) return jsonResp({ error: `HTTP ${res.status}` }, headers, res.status);
  const html = await res.text();

  const titleM = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const covM = html.match(/src="(\/covers\/[^"]+)"/i);
  const descM = html.match(/Sinopsis[\s\S]{0,1200}?<p[^>]*>([\s\S]*?)<\/p>/i);
  const statusM = html.match(/Estado[\s\S]{0,200}?<span[^>]*>([^<]+)<\/span>/i);

  // Extraer tags solo del bloque principal del manga (tras <h1>, antes de la lista de capitulos)
  const bodySlice = (() => {
    const start = html.indexOf('<h1');
    const end = html.indexOf('/leer/', start > 0 ? start : 0);
    return start >= 0 ? html.slice(start, end > start ? end : start + 6000) : '';
  })();
  const tags = [...new Set([...bodySlice.matchAll(/href="\/manga\/\?genre=[^"]+"[^>]*>([^<]+)<\/a>/gi)].map((x) => decodeHtml(x[1])))];

  const seenCh = new Set();
  const chapters = [];
  const chRe = /<a[^>]+href="(\/leer\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let cm;
  while ((cm = chRe.exec(html)) !== null) {
    const chUri = cm[1];
    if (seenCh.has(chUri)) continue;
    seenCh.add(chUri);
    const rawTxt = stripTags(cm[2]);
    const dateM = rawTxt.match(/(\d{4}-\d{2}-\d{2})/);
    const cleanName = dateM ? rawTxt.replace(dateM[1], '').trim() : rawTxt;
    const numM = cleanName.match(/(\d+(?:\.\d+)?)/) || chUri.match(/\/(\d+(?:\.\d+)?)\/?$/);
    const chNum = numM ? parseFloat(numM[1]) : -1;
    const epoch = dateM ? Math.floor(new Date(dateM[1]).getTime() / 1000) : 0;
    chapters.push({
      id: 'lc:' + chUri,
      mangaId: 'lc:' + uri,
      name: cleanName || `Capítulo ${chNum >= 0 ? chNum : ''}`,
      chapterNumber: isNaN(chNum) ? -1 : chNum,
      scanlator: 'LeerCapitulo (ES)',
      uploadDate: isNaN(epoch) ? 0 : epoch
    });
  }

  // Orden ascendente para asignar sourceOrder y devolver descendente
  const asc = chapters.slice().reverse();
  asc.forEach((c, i) => { c.sourceOrder = i + 1; });

  return jsonResp({
    manga: {
      id: 'lc:' + uri,
      title: titleM ? stripTags(titleM[1]) : 'Sin título',
      thumbnailUrl: covM ? LC_BASE + covM[1] : '',
      description: descM ? stripTags(descM[1]) : '',
      status: statusM ? decodeHtml(statusM[1]) : '',
      genre: tags,
      sourceId: 'leercapitulo',
      source: { id: 'leercapitulo', name: 'LeerCapitulo (ES)', displayName: 'LeerCapitulo (ES)' }
    },
    chapters: asc.reverse()
  }, headers);
}

async function handleLcPages(url, headers) {
  const uri = url.searchParams.get('uri') || '';
  if (!/^\/leer\/[a-z0-9]+\/[^?#]+$/i.test(uri)) return jsonResp({ error: 'Invalid uri' }, headers, 400);
  const res = await fetch(LC_BASE + uri, { headers: { 'User-Agent': UA } });
  if (!res.ok) return jsonResp({ error: `HTTP ${res.status}` }, headers, res.status);
  const html = await res.text();
  const seen = new Set();
  const pages = [];
  const imgRe = /<img[^>]+(?:data-src|src)="(https?:\/\/[^"]+)"/gi;
  let im;
  while ((im = imgRe.exec(html)) !== null) {
    const u = im[1];
    if (seen.has(u) || /logo|flag|icon|avatar|banner|ads/i.test(u)) continue;
    if (!/\.(?:webp|jpe?g|png)(?:\?|$)/i.test(u)) continue;
    seen.add(u);
    pages.push(u);
  }
  return jsonResp({ pages }, headers);
}

// ---------------- WeebCentral (EN: Manhwas, Mangas, Manhuas) ----------------
async function handleWcBrowse(url, headers) {
  const q = (url.searchParams.get('q') || '').trim();
  const type = (url.searchParams.get('type') || 'all').toLowerCase();
  const mode = (url.searchParams.get('mode') || 'POPULAR').toUpperCase();
  const tag = (url.searchParams.get('tag') || '').trim();
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
  const hideNsfw = url.searchParams.get('hideNsfw') === '1';

  const qs = new URLSearchParams();
  if (q) {
    qs.set('text', q);
    qs.set('sort', 'Best Match');
  } else {
    qs.set('sort', mode === 'LATEST' ? 'Latest Updates' : 'Popularity');
  }
  qs.set('order', 'Descending');
  qs.set('official', 'Any');
  qs.set('anime', 'Any');
  qs.set('adult', hideNsfw ? 'False' : 'Any');
  qs.set('display_mode', 'Full Display');
  if (type === 'manhwa') qs.set('included_type', 'Manhwa');
  else if (type === 'manga') qs.set('included_type', 'Manga');
  else if (type === 'manhua') qs.set('included_type', 'Manhua');
  if (tag) qs.set('included_tag', tag);
  if (page > 1) qs.set('offset', String((page - 1) * 32));

  const res = await fetch(`${WC_BASE}/search/data?${qs.toString()}`, {
    headers: { 'User-Agent': WC_UA, 'HX-Request': 'true', 'Referer': `${WC_BASE}/search` }
  });
  if (!res.ok) return jsonResp({ mangas: [], hasNextPage: false }, headers, res.status);
  const html = await res.text();

  const seen = new Set();
  const mangas = [];
  const blocks = html.split(/<article\s+class="bg-base-300/i).slice(1);
  for (const blk of blocks) {
    const linkM = blk.match(/href="https:\/\/weebcentral\.com\/series\/([A-Z0-9]+)\/([^"]+)"/i);
    if (!linkM) continue;
    const sid = linkM[1];
    if (seen.has(sid)) continue;
    seen.add(sid);
    const titleM = blk.match(/class="link link-hover"[^>]*>([\s\S]*?)<\/a>/i)
      || blk.match(/alt="([^"]+?) cover"/i);
    const title = titleM ? stripTags(titleM[1]) : decodeURIComponent(linkM[2]).replace(/-/g, ' ');
    const covM = blk.match(/srcset="(https:\/\/temp\.compsci88\.com\/cover\/[^"]+)"/i)
      || blk.match(/src="(https:\/\/temp\.compsci88\.com\/cover\/[^"]+)"/i);
    const cover = covM ? covM[1] : `https://temp.compsci88.com/cover/normal/${sid}.webp`;
    const typeM = blk.match(/Type:<\/strong>\s*<span>([^<]+)<\/span>/i);
    const tags = [...blk.matchAll(/<span>([^<,]+),?<\/span>/gi)].map((t) => decodeHtml(t[1])).slice(0, 6);
    if (typeM) tags.unshift(decodeHtml(typeM[1]));
    mangas.push({
      id: 'wc:' + sid,
      title,
      thumbnailUrl: cover,
      genre: [...new Set(tags)].filter(Boolean),
      sourceId: 'weebcentral'
    });
  }
  return jsonResp({ mangas, hasNextPage: mangas.length >= 28 }, headers);
}

async function handleWcManga(url, headers) {
  const sid = (url.searchParams.get('id') || '').trim();
  if (!/^[A-Z0-9]{10,40}$/i.test(sid)) return jsonResp({ error: 'Invalid id' }, headers, 400);

  const [detRes, listRes] = await Promise.all([
    fetch(`${WC_BASE}/series/${sid}`, { headers: { 'User-Agent': WC_UA } }),
    fetch(`${WC_BASE}/series/${sid}/full-chapter-list`, { headers: { 'User-Agent': WC_UA, 'HX-Request': 'true', 'Referer': `${WC_BASE}/series/${sid}` } })
  ]);
  if (!detRes.ok) return jsonResp({ error: `HTTP ${detRes.status}` }, headers, detRes.status);
  const [detHtml, listHtml] = await Promise.all([detRes.text(), listRes.ok ? listRes.text() : Promise.resolve('')]);

  const h1 = detHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const desc = detHtml.match(/Description<\/strong>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i);
  const status = detHtml.match(/Status:[\s\S]{0,250}?<a[^>]*>([^<]+)<\/a>/i);
  const type = detHtml.match(/Type:[\s\S]{0,250}?<a[^>]*>([^<]+)<\/a>/i);
  const tags = [...new Set([...detHtml.matchAll(/included_tag=([^"&]+)/g)].map((m) => decodeURIComponent(m[1]).replace(/\+/g, ' ')))];
  if (type) {
    const tVal = decodeHtml(type[1]);
    if (tVal && !tags.includes(tVal)) tags.unshift(tVal);
  }
  const authors = [...new Set([...detHtml.matchAll(/author=([^"&]+)/g)].map((m) => decodeURIComponent(m[1]).replace(/\+/g, ' ')))];

  const seenCh = new Set();
  const chapters = [];
  const chRe = /<a[^>]+href="\/chapters\/([A-Z0-9]+)"[\s\S]*?<\/a>/gi;
  let cm;
  while ((cm = chRe.exec(listHtml)) !== null) {
    const cid = cm[1];
    if (seenCh.has(cid)) continue;
    seenCh.add(cid);
    const blk = cm[0];
    const nameM = blk.match(/<span class="">([\s\S]*?)<\/span>/i);
    const timeM = blk.match(/datetime="([^"]+)"/i);
    const name = nameM ? stripTags(nameM[1]) : 'Chapter';
    const numM = name.match(/(\d+(?:\.\d+)?)/);
    const chNum = numM ? parseFloat(numM[1]) : -1;
    const epoch = timeM ? Math.floor(new Date(timeM[1]).getTime() / 1000) : 0;
    chapters.push({
      id: 'wc:' + cid,
      mangaId: 'wc:' + sid,
      name,
      chapterNumber: isNaN(chNum) ? -1 : chNum,
      scanlator: 'WeebCentral (EN)',
      uploadDate: isNaN(epoch) ? 0 : epoch
    });
  }

  const asc = chapters.slice().reverse();
  asc.forEach((c, i) => { c.sourceOrder = i + 1; });

  return jsonResp({
    manga: {
      id: 'wc:' + sid,
      title: h1 ? stripTags(h1[1]) : 'Sin título',
      thumbnailUrl: `https://temp.compsci88.com/cover/normal/${sid}.webp`,
      description: desc ? stripTags(desc[1]) : '',
      author: authors.join(', '),
      status: status ? decodeHtml(status[1]) : '',
      genre: tags,
      sourceId: 'weebcentral',
      source: { id: 'weebcentral', name: 'WeebCentral (EN)', displayName: 'WeebCentral (EN)' }
    },
    chapters: asc.reverse()
  }, headers);
}

async function handleWcPages(url, headers) {
  const cid = (url.searchParams.get('id') || '').trim();
  if (!/^[A-Z0-9]{10,40}$/i.test(cid)) return jsonResp({ error: 'Invalid id' }, headers, 400);
  const res = await fetch(`${WC_BASE}/chapters/${cid}/images?is_prev=False&current_page=1&reading_style=long_strip`, {
    headers: { 'User-Agent': WC_UA, 'HX-Request': 'true', 'Referer': `${WC_BASE}/chapters/${cid}` }
  });
  if (!res.ok) return jsonResp({ error: `HTTP ${res.status}` }, headers, res.status);
  const html = await res.text();
  const pages = [...html.matchAll(/src="(https:\/\/[^"]+)"/gi)]
    .map((m) => m[1])
    .filter((u) => !/brand|logo|avatar/i.test(u));
  return jsonResp({ pages }, headers);
}

function cacheTtlForPath(pathname) {
  if (pathname === '/img' || pathname === '/manga/tag') return 86400;
  if (pathname === '/lc/browse' || pathname === '/lc/manga' || pathname === '/wc/browse' || pathname === '/wc/manga') return 240;
  if (/^\/manga(\/[0-9a-f-]{36}(\/feed)?)?$/i.test(pathname)) return 180;
  return 0;
}

function withCors(resp, headers, cacheState = '') {
  const out = new Headers(resp.headers);
  for (const [k, v] of Object.entries(headers)) out.set(k, v);
  out.delete('set-cookie');
  if (cacheState) out.set('X-Bridge-Cache', cacheState);
  return new Response(resp.body, { status: resp.status, headers: out });
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '*';
    const headers = corsHeaders(origin);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'GET') return jsonResp({ error: 'Method not allowed' }, headers, 405);

    const url = new URL(request.url);
    if (url.pathname === '/' || url.pathname === '/health') {
      return jsonResp({ ok: true, bridge: 'suwayomi-movil-multi', v: 4, sources: ['mangadex', 'leercapitulo', 'weebcentral'] }, headers);
    }

    const ttl = cacheTtlForPath(url.pathname);
    const edgeCache = (ttl > 0 && typeof caches !== 'undefined' && caches.default) ? caches.default : null;
    const cacheKey = edgeCache ? new Request(url.toString(), { method: 'GET' }) : null;
    if (edgeCache && cacheKey) {
      const hit = await edgeCache.match(cacheKey);
      if (hit) return withCors(hit, headers, 'HIT');
    }

    const saveToEdge = (resp) => {
      if (!edgeCache || !cacheKey || !resp || resp.status !== 200) return resp;
      const toCacheHeaders = new Headers(resp.headers);
      toCacheHeaders.set('Cache-Control', `public, max-age=${ttl}`);
      toCacheHeaders.delete('set-cookie');
      const [b1, b2] = resp.body ? resp.body.tee() : [null, null];
      const cacheResp = new Response(b2, { status: resp.status, headers: toCacheHeaders });
      const p = edgeCache.put(cacheKey, cacheResp).catch(() => { });
      if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(p);
      return new Response(b1, { status: resp.status, headers: resp.headers });
    };

    // Puente de imagenes (portadas y capitulos de las 3 fuentes) sin UA Mozilla para evitar DDoS-Guard
    if (url.pathname === '/img') {
      const raw = url.searchParams.get('u') || '';
      let target;
      try { target = new URL(raw); } catch { target = null; }
      const ref = target && target.protocol === 'https:' ? imgRefererForHost(target.hostname) : null;
      if (!ref) return jsonResp({ error: 'Image host not allowed' }, headers, 403);
      const imgUa = ref === 'https://weebcentral.com/' ? WC_UA : UA;
      const imgRes = await fetch(target.toString(), {
        method: 'GET',
        headers: { 'Referer': ref, 'User-Agent': imgUa }
      });
      const contentLen = parseInt(imgRes.headers.get('content-length') || '0', 10);
      if (contentLen > MAX_IMG_BYTES) return jsonResp({ error: 'Image too large' }, headers, 413);
      const outHeaders = new Headers(imgRes.headers);
      for (const [k, v] of Object.entries(headers)) outHeaders.set(k, v);
      outHeaders.delete('set-cookie');
      if (imgRes.ok) outHeaders.set('Cache-Control', 'public, max-age=86400');
      const finalResp = new Response(imgRes.body, { status: imgRes.status, headers: outHeaders });
      return saveToEdge(finalResp);
    }

    // Rutas LeerCapitulo (ES) y WeebCentral (EN)
    try {
      if (url.pathname === '/lc/browse') return saveToEdge(await handleLcBrowse(url, headers));
      if (url.pathname === '/lc/manga') return saveToEdge(await handleLcManga(url, headers));
      if (url.pathname === '/lc/pages') return await handleLcPages(url, headers);
      if (url.pathname === '/wc/browse') return saveToEdge(await handleWcBrowse(url, headers));
      if (url.pathname === '/wc/manga') return saveToEdge(await handleWcManga(url, headers));
      if (url.pathname === '/wc/pages') return await handleWcPages(url, headers);
    } catch (err) {
      return jsonResp({ error: String((err && err.message) || err || 'Upstream error') }, headers, 502);
    }

    // Rutas de lectura de api.mangadex.org
    const allowedMd = /^\/(manga(\/[0-9a-f-]{36}(\/feed)?)?|manga\/tag|at-home\/server\/[0-9a-f-]{36}|ping)$/i;
    if (!allowedMd.test(url.pathname)) return jsonResp({ error: 'Path not allowed' }, headers, 403);

    const upstreamRes = await fetch(MD_API + url.pathname + url.search, {
      method: 'GET',
      headers: { 'User-Agent': UA, 'Accept': 'application/json' }
    });
    const outHeaders = new Headers(upstreamRes.headers);
    for (const [k, v] of Object.entries(headers)) outHeaders.set(k, v);
    outHeaders.delete('set-cookie');
    const finalMd = new Response(upstreamRes.body, { status: upstreamRes.status, headers: outHeaders });
    return ttl > 0 ? saveToEdge(finalMd) : finalMd;
  }
};
