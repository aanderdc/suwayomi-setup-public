(() => {
  'use strict';

  const CONFIG_KEY = 'suwayomi_remote_config_v1';
  const LIB_KEY = 'suwayomi_remote_library_v1';
  const HIST_KEY = 'suwayomi_remote_history_v1';
  const PROG_KEY = 'suwayomi_remote_progress_v1';
  const BOOKMARKS_KEY = 'suwayomi_remote_chap_bookmarks_v1';

  const DEFAULT_CONFIG = {
    mode: 'local',          // 'local' | 'direct' | 'remote_suwayomi'
    workerUrl: '',          // URL del Cloudflare Worker propio (v3 multi-fuente)
    suwayomiUrl: '',        // URL de otro servidor Suwayomi remoto (ej. https://mi-vps.ts.net)
    source: 'mangadex',     // 'mangadex' | 'leercapitulo' | 'weebcentral'
    contentType: 'all',     // 'all' | 'manhwa' | 'manga' | 'manhua'
    lang: 'es',             // 'es' | 'es-la' | 'en' | 'all' (para MangaDex)
    dataSaver: true         // true = ahorro de datos (MangaDex), false = calidad original
  };

  const SOURCES_META = [
    { id: 'mangadex', name: 'MangaDex', badge: 'ES/EN', desc: 'Mangas, Manhwas y Manhuas' },
    { id: 'leercapitulo', name: 'LeerCapitulo', badge: 'ES', desc: 'Mangas y Manhwas en Español' },
    { id: 'weebcentral', name: 'WeebCentral', badge: 'EN', desc: 'Gran catálogo de Manhwas y Mangas' }
  ];

  const WORKER_SNIPPET = `const MD_API = 'https://api.mangadex.org';
const LC_BASE = 'https://www.leercapitulo.co';
const WC_BASE = 'https://weebcentral.com';
const UA = 'SuwayomiMovilBridge/3.0';
const WC_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
function corsHeaders(origin) {
  return { 'Access-Control-Allow-Origin': origin || '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Accept', 'Access-Control-Max-Age': '86400', 'Vary': 'Origin' };
}
function jsonResp(data, headers, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' } });
}
function imgRefererForHost(hostname) {
  const h = (hostname || '').toLowerCase();
  if (h === 'uploads.mangadex.org' || h === 'mangadex.network' || h.endsWith('.mangadex.network')) return 'https://mangadex.org/';
  if (h === 'www.leercapitulo.co' || h === 'leercapitulo.co' || h.endsWith('.t34798ndc.com')) return 'https://www.leercapitulo.co/';
  if (h === 'weebcentral.com' || h.endsWith('.weebcentral.com') || h.endsWith('.compsci88.com') || h.endsWith('.planeptune.us') || h.endsWith('.lowee.us') || h.endsWith('.lastation.us') || h.endsWith('.leanbox.us') || h.endsWith('.mangasee123.com') || h.endsWith('.nep.li')) return 'https://weebcentral.com/';
  return null;
}
function decodeHtml(s) {
  return String(s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0*39;/g, "'").replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/&#(\\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10))).replace(/[\\u200e\\u200f]/g, '').replace(/\\s+/g, ' ').trim();
}
function stripTags(s) { return decodeHtml(String(s || '').replace(/<[^>]+>/g, ' ')); }
async function handleLcBrowse(url, headers) {
  const q = (url.searchParams.get('q') || '').trim();
  const type = (url.searchParams.get('type') || 'all').toLowerCase();
  const mode = (url.searchParams.get('mode') || 'POPULAR').toUpperCase();
  const tag = (url.searchParams.get('tag') || '').trim().toLowerCase();
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
  if (q) {
    const res = await fetch(LC_BASE + '/search/?q=' + encodeURIComponent(q), { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
    if (!res.ok) return jsonResp({ mangas: [], hasNextPage: false }, headers, res.status);
    let arr = []; try { arr = await res.json(); } catch {}
    const mangas = (Array.isArray(arr) ? arr : []).filter((it) => it && it.uri && (type === 'all' || String(it.type || '').toLowerCase() === type)).map((it) => ({
      id: 'lc:' + it.uri, title: decodeHtml(it.name || 'Sin título'),
      thumbnailUrl: it.cover_uri ? (it.cover_uri.startsWith('http') ? it.cover_uri : LC_BASE + it.cover_uri) : '',
      status: it.status || '', genre: it.type ? [it.type] : [], sourceId: 'leercapitulo'
    }));
    return jsonResp({ mangas, hasNextPage: false }, headers);
  }
  const qs = new URLSearchParams();
  if (type === 'manhwa' || type === 'manga' || type === 'manhua') qs.set('type', type);
  if (tag) qs.set('genre', tag.replace(/\\s+/g, '-'));
  if (mode === 'POPULAR') qs.set('sort', 'views');
  if (page > 1) qs.set('page', String(page));
  const res = await fetch(LC_BASE + '/manga/?' + qs.toString(), { headers: { 'User-Agent': UA } });
  if (!res.ok) return jsonResp({ mangas: [], hasNextPage: false }, headers, res.status);
  const html = await res.text();
  const seen = new Set(), mangas = [];
  const cardRe = /href="(\\/manga\\/[a-z0-9]+\\/[^"]+)"[^>]*>\\s*<img[^>]+src="([^"]+)"[\\s\\S]{0,600}?class="lc-card-name[^"]*"[^>]*>([\\s\\S]*?)<\\/a>/gi;
  let m;
  while ((m = cardRe.exec(html)) !== null) {
    if (seen.has(m[1])) continue; seen.add(m[1]);
    const cov = m[2].startsWith('http') ? m[2] : LC_BASE + m[2];
    const badgeM = m[0].match(/class="lc-card-badge"[^>]*>([^<]+)</i);
    const kind = badgeM ? decodeHtml(badgeM[1]) : (type !== 'all' ? type : '');
    mangas.push({ id: 'lc:' + m[1], title: stripTags(m[3]) || 'Sin título', thumbnailUrl: cov, genre: kind ? [kind] : [], sourceId: 'leercapitulo' });
  }
  return jsonResp({ mangas, hasNextPage: html.includes('page=' + (page + 1)) && mangas.length >= 12 }, headers);
}
async function handleLcManga(url, headers) {
  const uri = url.searchParams.get('uri') || '';
  if (!/^\\/manga\\/[a-z0-9]+\\/[^?#]+$/i.test(uri)) return jsonResp({ error: 'Invalid uri' }, headers, 400);
  const res = await fetch(LC_BASE + uri, { headers: { 'User-Agent': UA } });
  if (!res.ok) return jsonResp({ error: 'HTTP ' + res.status }, headers, res.status);
  const html = await res.text();
  const titleM = html.match(/<h1[^>]*>([\\s\\S]*?)<\\/h1>/i);
  const covM = html.match(/src="(\\/covers\\/[^"]+)"/i);
  const descM = html.match(/Sinopsis[\\s\\S]{0,1200}?<p[^>]*>([\\s\\S]*?)<\\/p>/i);
  const statusM = html.match(/Estado[\\s\\S]{0,200}?<span[^>]*>([^<]+)<\\/span>/i);
  const start = html.indexOf('<h1'), end = html.indexOf('/leer/', start > 0 ? start : 0);
  const bodySlice = start >= 0 ? html.slice(start, end > start ? end : start + 6000) : '';
  const tags = [...new Set([...bodySlice.matchAll(/href="\\/manga\\/\\?genre=[^"]+"[^>]*>([^<]+)<\\/a>/gi)].map((x) => decodeHtml(x[1])))];
  const seenCh = new Set(), chapters = [];
  const chRe = /<a[^>]+href="(\\/leer\\/[^"]+)"[^>]*>([\\s\\S]*?)<\\/a>/gi;
  let cm;
  while ((cm = chRe.exec(html)) !== null) {
    if (seenCh.has(cm[1])) continue; seenCh.add(cm[1]);
    const rawTxt = stripTags(cm[2]), dateM = rawTxt.match(/(\\d{4}-\\d{2}-\\d{2})/);
    const cleanName = dateM ? rawTxt.replace(dateM[1], '').trim() : rawTxt;
    const numM = cleanName.match(/(\\d+(?:\\.\\d+)?)/) || cm[1].match(/\\/(\\d+(?:\\.\\d+)?)\\/?$/);
    const chNum = numM ? parseFloat(numM[1]) : -1;
    const epoch = dateM ? Math.floor(new Date(dateM[1]).getTime() / 1000) : 0;
    chapters.push({ id: 'lc:' + cm[1], mangaId: 'lc:' + uri, name: cleanName || ('Capítulo ' + (chNum >= 0 ? chNum : '')), chapterNumber: isNaN(chNum) ? -1 : chNum, scanlator: 'LeerCapitulo (ES)', uploadDate: isNaN(epoch) ? 0 : epoch });
  }
  const asc = chapters.slice().reverse(); asc.forEach((c, i) => { c.sourceOrder = i + 1; });
  return jsonResp({ manga: { id: 'lc:' + uri, title: titleM ? stripTags(titleM[1]) : 'Sin título', thumbnailUrl: covM ? LC_BASE + covM[1] : '', description: descM ? stripTags(descM[1]) : '', status: statusM ? decodeHtml(statusM[1]) : '', genre: tags, sourceId: 'leercapitulo', source: { id: 'leercapitulo', name: 'LeerCapitulo (ES)', displayName: 'LeerCapitulo (ES)' } }, chapters: asc.reverse() }, headers);
}
async function handleLcPages(url, headers) {
  const uri = url.searchParams.get('uri') || '';
  if (!/^\\/leer\\/[a-z0-9]+\\/[^?#]+$/i.test(uri)) return jsonResp({ error: 'Invalid uri' }, headers, 400);
  const res = await fetch(LC_BASE + uri, { headers: { 'User-Agent': UA } });
  if (!res.ok) return jsonResp({ error: 'HTTP ' + res.status }, headers, res.status);
  const html = await res.text();
  const seen = new Set(), pages = [];
  const imgRe = /<img[^>]+(?:data-src|src)="(https?:\\/\\/[^"]+)"/gi;
  let im;
  while ((im = imgRe.exec(html)) !== null) {
    const u = im[1];
    if (seen.has(u) || /logo|flag|icon|avatar|banner|ads/i.test(u) || !/\\.(?:webp|jpe?g|png)(?:\\?|$)/i.test(u)) continue;
    seen.add(u); pages.push(u);
  }
  return jsonResp({ pages }, headers);
}
async function handleWcBrowse(url, headers) {
  const q = (url.searchParams.get('q') || '').trim();
  const type = (url.searchParams.get('type') || 'all').toLowerCase();
  const mode = (url.searchParams.get('mode') || 'POPULAR').toUpperCase();
  const tag = (url.searchParams.get('tag') || '').trim();
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
  const hideNsfw = url.searchParams.get('hideNsfw') === '1';
  const qs = new URLSearchParams();
  if (q) { qs.set('text', q); qs.set('sort', 'Best Match'); } else { qs.set('sort', mode === 'LATEST' ? 'Latest Updates' : 'Popularity'); }
  qs.set('order', 'Descending'); qs.set('official', 'Any'); qs.set('anime', 'Any'); qs.set('adult', hideNsfw ? 'False' : 'Any'); qs.set('display_mode', 'Full Display');
  if (type === 'manhwa') qs.set('included_type', 'Manhwa'); else if (type === 'manga') qs.set('included_type', 'Manga'); else if (type === 'manhua') qs.set('included_type', 'Manhua');
  if (tag) qs.set('included_tag', tag);
  if (page > 1) qs.set('offset', String((page - 1) * 32));
  const res = await fetch(WC_BASE + '/search/data?' + qs.toString(), { headers: { 'User-Agent': WC_UA, 'HX-Request': 'true', 'Referer': WC_BASE + '/search' } });
  if (!res.ok) return jsonResp({ mangas: [], hasNextPage: false }, headers, res.status);
  const html = await res.text();
  const seen = new Set(), mangas = [];
  for (const blk of html.split(/<article\\s+class="bg-base-300/i).slice(1)) {
    const linkM = blk.match(/href="https:\\/\\/weebcentral\\.com\\/series\\/([A-Z0-9]+)\\/([^"]+)"/i);
    if (!linkM || seen.has(linkM[1])) continue; seen.add(linkM[1]);
    const sid = linkM[1];
    const titleM = blk.match(/class="link link-hover"[^>]*>([\\s\\S]*?)<\\/a>/i) || blk.match(/alt="([^"]+?) cover"/i);
    const title = titleM ? stripTags(titleM[1]) : decodeURIComponent(linkM[2]).replace(/-/g, ' ');
    const covM = blk.match(/srcset="(https:\\/\\/temp\\.compsci88\\.com\\/cover\\/[^"]+)"/i) || blk.match(/src="(https:\\/\\/temp\\.compsci88\\.com\\/cover\\/[^"]+)"/i);
    const typeM = blk.match(/Type:<\\/strong>\\s*<span>([^<]+)<\\/span>/i);
    const tags = [...blk.matchAll(/<span>([^<,]+),?<\\/span>/gi)].map((t) => decodeHtml(t[1])).slice(0, 6);
    if (typeM) tags.unshift(decodeHtml(typeM[1]));
    mangas.push({ id: 'wc:' + sid, title, thumbnailUrl: covM ? covM[1] : ('https://temp.compsci88.com/cover/normal/' + sid + '.webp'), genre: [...new Set(tags)].filter(Boolean), sourceId: 'weebcentral' });
  }
  return jsonResp({ mangas, hasNextPage: mangas.length >= 28 }, headers);
}
async function handleWcManga(url, headers) {
  const sid = (url.searchParams.get('id') || '').trim();
  if (!/^[A-Z0-9]{10,40}$/i.test(sid)) return jsonResp({ error: 'Invalid id' }, headers, 400);
  const [detRes, listRes] = await Promise.all([
    fetch(WC_BASE + '/series/' + sid, { headers: { 'User-Agent': WC_UA } }),
    fetch(WC_BASE + '/series/' + sid + '/full-chapter-list', { headers: { 'User-Agent': WC_UA, 'HX-Request': 'true', 'Referer': WC_BASE + '/series/' + sid } })
  ]);
  if (!detRes.ok) return jsonResp({ error: 'HTTP ' + detRes.status }, headers, detRes.status);
  const [detHtml, listHtml] = await Promise.all([detRes.text(), listRes.ok ? listRes.text() : Promise.resolve('')]);
  const h1 = detHtml.match(/<h1[^>]*>([\\s\\S]*?)<\\/h1>/i);
  const desc = detHtml.match(/Description<\\/strong>[\\s\\S]*?<p[^>]*>([\\s\\S]*?)<\\/p>/i);
  const status = detHtml.match(/Status:[\\s\\S]{0,250}?<a[^>]*>([^<]+)<\\/a>/i);
  const type = detHtml.match(/Type:[\\s\\S]{0,250}?<a[^>]*>([^<]+)<\\/a>/i);
  const tags = [...new Set([...detHtml.matchAll(/included_tag=([^"&]+)/g)].map((m) => decodeURIComponent(m[1]).replace(/\\+/g, ' ')))];
  if (type) { const tv = decodeHtml(type[1]); if (tv && !tags.includes(tv)) tags.unshift(tv); }
  const authors = [...new Set([...detHtml.matchAll(/author=([^"&]+)/g)].map((m) => decodeURIComponent(m[1]).replace(/\\+/g, ' ')))];
  const seenCh = new Set(), chapters = [];
  const chRe = /<a[^>]+href="\\/chapters\\/([A-Z0-9]+)"[\\s\\S]*?<\\/a>/gi;
  let cm;
  while ((cm = chRe.exec(listHtml)) !== null) {
    if (seenCh.has(cm[1])) continue; seenCh.add(cm[1]);
    const nameM = cm[0].match(/<span class="">([\\s\\S]*?)<\\/span>/i), timeM = cm[0].match(/datetime="([^"]+)"/i);
    const name = nameM ? stripTags(nameM[1]) : 'Chapter';
    const numM = name.match(/(\\d+(?:\\.\\d+)?)/), chNum = numM ? parseFloat(numM[1]) : -1;
    const epoch = timeM ? Math.floor(new Date(timeM[1]).getTime() / 1000) : 0;
    chapters.push({ id: 'wc:' + cm[1], mangaId: 'wc:' + sid, name, chapterNumber: isNaN(chNum) ? -1 : chNum, scanlator: 'WeebCentral (EN)', uploadDate: isNaN(epoch) ? 0 : epoch });
  }
  const asc = chapters.slice().reverse(); asc.forEach((c, i) => { c.sourceOrder = i + 1; });
  return jsonResp({ manga: { id: 'wc:' + sid, title: h1 ? stripTags(h1[1]) : 'Sin título', thumbnailUrl: 'https://temp.compsci88.com/cover/normal/' + sid + '.webp', description: desc ? stripTags(desc[1]) : '', author: authors.join(', '), status: status ? decodeHtml(status[1]) : '', genre: tags, sourceId: 'weebcentral', source: { id: 'weebcentral', name: 'WeebCentral (EN)', displayName: 'WeebCentral (EN)' } }, chapters: asc.reverse() }, headers);
}
async function handleWcPages(url, headers) {
  const cid = (url.searchParams.get('id') || '').trim();
  if (!/^[A-Z0-9]{10,40}$/i.test(cid)) return jsonResp({ error: 'Invalid id' }, headers, 400);
  const res = await fetch(WC_BASE + '/chapters/' + cid + '/images?is_prev=False&current_page=1&reading_style=long_strip', { headers: { 'User-Agent': WC_UA, 'HX-Request': 'true', 'Referer': WC_BASE + '/chapters/' + cid } });
  if (!res.ok) return jsonResp({ error: 'HTTP ' + res.status }, headers, res.status);
  const html = await res.text();
  const pages = [...html.matchAll(/src="(https:\\/\\/[^"]+)"/gi)].map((m) => m[1]).filter((u) => !/brand|logo|avatar/i.test(u));
  return jsonResp({ pages }, headers);
}
export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') || '*', headers = corsHeaders(origin);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'GET') return jsonResp({ error: 'Method not allowed' }, headers, 405);
    const url = new URL(request.url);
    if (url.pathname === '/' || url.pathname === '/health') return jsonResp({ ok: true, bridge: 'suwayomi-movil-multi', v: 3, sources: ['mangadex', 'leercapitulo', 'weebcentral'] }, headers);
    if (url.pathname === '/img') {
      let target = null; try { target = new URL(url.searchParams.get('u') || ''); } catch {}
      const ref = target && target.protocol === 'https:' ? imgRefererForHost(target.hostname) : null;
      if (!ref) return jsonResp({ error: 'Image host not allowed' }, headers, 403);
      const imgRes = await fetch(target.toString(), { headers: { 'Referer': ref, 'User-Agent': ref === 'https://weebcentral.com/' ? WC_UA : UA } });
      const out = new Headers(imgRes.headers);
      for (const [k, v] of Object.entries(headers)) out.set(k, v);
      out.delete('set-cookie');
      if (imgRes.ok) out.set('Cache-Control', 'public, max-age=86400');
      return new Response(imgRes.body, { status: imgRes.status, headers: out });
    }
    try {
      if (url.pathname === '/lc/browse') return await handleLcBrowse(url, headers);
      if (url.pathname === '/lc/manga') return await handleLcManga(url, headers);
      if (url.pathname === '/lc/pages') return await handleLcPages(url, headers);
      if (url.pathname === '/wc/browse') return await handleWcBrowse(url, headers);
      if (url.pathname === '/wc/manga') return await handleWcManga(url, headers);
      if (url.pathname === '/wc/pages') return await handleWcPages(url, headers);
    } catch (err) { return jsonResp({ error: String((err && err.message) || err || 'Upstream error') }, headers, 502); }
    const allowedMd = /^\\/(manga(\\/[0-9a-f-]{36}(\\/feed)?)?|manga\\/tag|at-home\\/server\\/[0-9a-f-]{36}|ping)$/i;
    if (!allowedMd.test(url.pathname)) return jsonResp({ error: 'Path not allowed' }, headers, 403);
    const res = await fetch(MD_API + url.pathname + url.search, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
    const out = new Headers(res.headers);
    for (const [k, v] of Object.entries(headers)) out.set(k, v);
    out.delete('set-cookie');
    return new Response(res.body, { status: res.status, headers: out });
  }
};`;

  const ES_TAG_ALIASES = {
    'accion': 'action',
    'aventura': 'adventure',
    'comedia': 'comedy',
    'drama': 'drama',
    'fantasia': 'fantasy',
    'isekai': 'isekai',
    'misterio': 'mystery',
    'romance': 'romance',
    'sci-fi': 'sci-fi',
    'ciencia ficcion': 'sci-fi',
    'slice of life': 'slice of life',
    'recuentos de la vida': 'slice of life',
    'sobrenatural': 'supernatural',
    'terror': 'horror',
    'horror': 'horror',
    'artes marciales': 'martial arts',
    'deportes': 'sports',
    'historico': 'historical',
    'psicologico': 'psychological',
    'webtoon': 'long strip',
    'magia': 'magic',
    'tragedia': 'tragedy',
    'escolar': 'school life',
    'supervivencia': 'survival',
    'monstruos': 'monsters',
    'crimen': 'crime',
    'thriller': 'thriller',
    'reencarnacion': 'reincarnation',
    'videojuegos': 'video games',
    'mecha': 'mecha',
    'harem': 'harem',
    'shonen': 'shounen',
    'seinen': 'seinen'
  };

  function norm(s) {
    return String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
  }

  function cleanBaseUrl(raw) {
    let u = String(raw || '').trim();
    if (!u) return '';
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    return u.replace(/\/+$/, '');
  }

  function getConfig() {
    try {
      const saved = JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}') || {};
      const cfg = Object.assign({}, DEFAULT_CONFIG, saved);
      if (!['local', 'direct', 'remote_suwayomi'].includes(cfg.mode)) cfg.mode = 'local';
      if (!['mangadex', 'leercapitulo', 'weebcentral'].includes(cfg.source)) cfg.source = 'mangadex';
      if (!['all', 'manhwa', 'manga', 'manhua'].includes(cfg.contentType)) cfg.contentType = 'all';
      cfg.workerUrl = cleanBaseUrl(cfg.workerUrl);
      cfg.suwayomiUrl = cleanBaseUrl(cfg.suwayomiUrl);
      return cfg;
    } catch {
      return Object.assign({}, DEFAULT_CONFIG);
    }
  }

  function saveConfig(patch) {
    const next = Object.assign(getConfig(), patch || {});
    next.workerUrl = cleanBaseUrl(next.workerUrl);
    next.suwayomiUrl = cleanBaseUrl(next.suwayomiUrl);
    try { localStorage.setItem(CONFIG_KEY, JSON.stringify(next)); } catch { }
    return next;
  }

  function isLocalhostOrigin() {
    try {
      const h = (window.location && window.location.hostname) || '';
      return h === 'localhost' || h === '127.0.0.1' || h === '::1';
    } catch {
      return false;
    }
  }

  function getDirectApiBase() {
    const cfg = getConfig();
    if (cfg.workerUrl) return cfg.workerUrl;
    if (isLocalhostOrigin()) return 'https://api.mangadex.org';
    return '';
  }

  function needsWorkerSetup() {
    const cfg = getConfig();
    if (cfg.mode !== 'direct') return false;
    if (cfg.source !== 'mangadex') return !cfg.workerUrl;
    return !getDirectApiBase();
  }

  function getLangList(langPref) {
    const l = langPref || getConfig().lang || 'es';
    if (l === 'es') return ['es', 'es-la'];
    if (l === 'es-la') return ['es-la', 'es'];
    if (l === 'en') return ['en'];
    return ['es', 'es-la', 'en'];
  }

  function getContentRatings(hideNsfw) {
    return hideNsfw
      ? ['safe']
      : ['safe', 'suggestive', 'erotica', 'pornographic'];
  }

  function detectSourceFromId(id) {
    const s = String(id || '');
    if (s.startsWith('lc:')) return 'leercapitulo';
    if (s.startsWith('wc:')) return 'weebcentral';
    return 'mangadex';
  }

  function proxyImageUrl(rawUrl) {
    if (!rawUrl) return '';
    const cfg = getConfig();
    // Evitar doble envoltorio si ya viene proxiada
    if (cfg.workerUrl && rawUrl.startsWith(cfg.workerUrl + '/img?')) return rawUrl;
    if (cfg.workerUrl && /^https:\/\//i.test(rawUrl)) {
      return `${cfg.workerUrl}/img?u=${encodeURIComponent(rawUrl)}`;
    }
    return rawUrl;
  }

  function unwrapImageUrl(url) {
    if (!url) return '';
    try {
      const u = new URL(url);
      if (u.pathname === '/img' && u.searchParams.get('u')) {
        return u.searchParams.get('u');
      }
    } catch { }
    return url;
  }

  function ensureProxiedIfWorker(url) {
    if (!url) return '';
    const raw = unwrapImageUrl(url);
    return proxyImageUrl(raw);
  }

  // ---------------- Peticiones HTTP al puente / API ----------------
  async function apiGet(path, params = {}, timeoutMs = 15000, requireWorker = false) {
    const cfg = getConfig();
    const base = requireWorker ? cfg.workerUrl : getDirectApiBase();
    if (!base) {
      throw new Error('NO_WORKER_URL');
    }
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params || {})) {
      if (v == null || v === '') continue;
      if (Array.isArray(v)) {
        for (const item of v) {
          if (item != null && item !== '') qs.append(k, String(item));
        }
      } else {
        qs.append(k, String(v));
      }
    }
    const url = `${base}${path}${qs.toString() ? '?' + qs.toString() : ''}`;
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        referrerPolicy: 'no-referrer',
        signal: ctrl ? ctrl.signal : undefined
      });
      if (res.status === 403 && requireWorker) {
        throw new Error('WORKER_UPGRADE_NEEDED');
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  // ---------------- Cache de tags de MangaDex ----------------
  let tagsCache = null;

  async function getTags() {
    if (tagsCache) return tagsCache;
    const data = await apiGet('/manga/tag', {}, 12000);
    const list = (data && data.data) || [];
    tagsCache = list.map((t) => ({
      id: t.id,
      name: (t.attributes && t.attributes.name && (t.attributes.name.es || t.attributes.name.en)) || '',
      enName: (t.attributes && t.attributes.name && t.attributes.name.en) || '',
      group: (t.attributes && t.attributes.group) || ''
    })).filter((t) => t.id && t.name);
    return tagsCache;
  }

  async function resolveTagId(tagLabel) {
    const clean = norm(tagLabel);
    if (!clean) return null;
    const mapped = ES_TAG_ALIASES[clean] || clean;
    try {
      const all = await getTags();
      const exact = all.find((t) => norm(t.enName) === mapped || norm(t.name) === clean);
      if (exact) return exact.id;
      const partial = all.find((t) => norm(t.enName).includes(mapped) || norm(t.name).includes(clean));
      return partial ? partial.id : null;
    } catch {
      return null;
    }
  }

  function mapTagToEnglish(tagLabel) {
    const clean = norm(tagLabel);
    if (!clean) return '';
    return ES_TAG_ALIASES[clean] || clean;
  }

  // ---------------- Normalización MangaDex -> formato app ----------------
  function pickLocalized(obj, preferEs = true) {
    if (!obj || typeof obj !== 'object') return '';
    if (preferEs) {
      if (obj.es) return obj.es;
      if (obj['es-la']) return obj['es-la'];
    }
    if (obj.en) return obj.en;
    if (obj['ja-ro']) return obj['ja-ro'];
    const keys = Object.keys(obj);
    return keys.length ? String(obj[keys[0]] || '') : '';
  }

  function mapMangaDexItem(raw) {
    if (!raw || !raw.id) return null;
    const attr = raw.attributes || {};
    const rels = Array.isArray(raw.relationships) ? raw.relationships : [];
    const coverRel = rels.find((r) => r.type === 'cover_art' && r.attributes && r.attributes.fileName);
    const authorRel = rels.find((r) => r.type === 'author' && r.attributes && r.attributes.name);
    const artistRel = rels.find((r) => r.type === 'artist' && r.attributes && r.attributes.name);

    const fileName = coverRel ? coverRel.attributes.fileName : '';
    const rawThumb = fileName ? `https://uploads.mangadex.org/covers/${raw.id}/${fileName}.256.jpg` : '';
    const thumb = proxyImageUrl(rawThumb);

    const genres = (attr.tags || [])
      .map((t) => (t.attributes && t.attributes.name && (t.attributes.name.es || t.attributes.name.en)) || '')
      .filter(Boolean);
    if (attr.originalLanguage === 'ko' && !genres.some((g) => norm(g) === 'manhwa')) genres.unshift('Manhwa');
    else if ((attr.originalLanguage === 'zh' || attr.originalLanguage === 'zh-hk') && !genres.some((g) => norm(g) === 'manhua')) genres.unshift('Manhua');
    if (attr.publicationDemographic) {
      const demo = String(attr.publicationDemographic);
      const demoLabel = demo.charAt(0).toUpperCase() + demo.slice(1);
      if (!genres.some((g) => norm(g) === norm(demoLabel))) genres.push(demoLabel);
    }
    if (attr.contentRating && (attr.contentRating === 'erotica' || attr.contentRating === 'pornographic')) {
      genres.push('18+');
    }

    const title = pickLocalized(attr.title, false) || pickLocalized(attr.title, true) || 'Sin título';
    const description = pickLocalized(attr.description, true);
    const statusMap = {
      ongoing: 'En emisión',
      completed: 'Finalizado',
      hiatus: 'En pausa',
      cancelled: 'Cancelado'
    };

    const lib = loadLibraryMap();
    const inLib = !!lib[raw.id];

    return {
      id: raw.id,
      title,
      thumbnailUrl: thumb,
      inLibrary: inLib,
      inLibraryAt: inLib ? (lib[raw.id].inLibraryAt || 0) : 0,
      initialized: true,
      status: statusMap[attr.status] || attr.status || '',
      author: authorRel ? authorRel.attributes.name : '',
      artist: artistRel ? artistRel.attributes.name : '',
      description,
      genre: genres,
      sourceId: 'mangadex',
      source: { id: 'mangadex', name: 'MangaDex (Directo)', displayName: 'MangaDex (Directo)' },
      contentRating: attr.contentRating || 'safe',
      isRemoteDirect: true
    };
  }

  function mapGenericRemoteManga(item, sourceName) {
    if (!item || !item.id) return null;
    const lib = loadLibraryMap();
    const inLib = !!lib[item.id];
    return {
      id: item.id,
      title: item.title || 'Sin título',
      thumbnailUrl: proxyImageUrl(item.thumbnailUrl || ''),
      inLibrary: inLib,
      inLibraryAt: inLib ? (lib[item.id].inLibraryAt || 0) : 0,
      initialized: true,
      status: item.status || '',
      author: item.author || '',
      artist: item.artist || '',
      description: item.description || '',
      genre: Array.isArray(item.genre) ? item.genre : [],
      sourceId: item.sourceId || detectSourceFromId(item.id),
      source: item.source || { id: item.sourceId || 'remote', name: sourceName, displayName: sourceName },
      isRemoteDirect: true
    };
  }

  function enrichRemoteChapter(ch, mangaId) {
    const prog = getChapterProgress(ch.id);
    const bms = loadChapBookmarks();
    return Object.assign({}, ch, {
      mangaId: mangaId || ch.mangaId,
      fetchedAt: ch.uploadDate || 0,
      pageCount: Number(ch.pageCount || 0),
      isRead: !!(prog && prog.isRead),
      lastPageRead: prog ? Number(prog.lastPageRead || 0) : 0,
      lastReadAt: prog ? Number(prog.updatedAt || 0) : 0,
      isBookmarked: !!bms[ch.id],
      isRemoteDirect: true
    });
  }

  function mapMangaDexChapter(raw, mangaId) {
    const attr = raw.attributes || {};
    const rels = Array.isArray(raw.relationships) ? raw.relationships : [];
    const grp = rels.find((r) => r.type === 'scanlation_group' && r.attributes && r.attributes.name);
    const chNum = attr.chapter != null && attr.chapter !== '' ? parseFloat(attr.chapter) : -1;
    const numTxt = attr.chapter != null && attr.chapter !== '' ? `Cap. ${attr.chapter}` : 'One-shot';
    const titlePart = attr.title ? ` — ${attr.title}` : '';
    const langTag = attr.translatedLanguage ? `[${String(attr.translatedLanguage).toUpperCase()}] ` : '';
    const ts = attr.publishAt || attr.readableAt || attr.createdAt || '';
    const epoch = ts ? Math.floor(new Date(ts).getTime() / 1000) : 0;

    return enrichRemoteChapter({
      id: raw.id,
      mangaId,
      name: `${langTag}${numTxt}${titlePart}`,
      chapterNumber: isNaN(chNum) ? -1 : chNum,
      sourceOrder: isNaN(chNum) ? 0 : chNum,
      scanlator: grp ? grp.attributes.name : 'MangaDex',
      translatedLanguage: attr.translatedLanguage || '',
      uploadDate: epoch,
      pageCount: Number(attr.pages || 0),
      externalUrl: attr.externalUrl || null
    }, mangaId);
  }

  // ---------------- Consultas Multi-fuente (MangaDex / LeerCapitulo ES / WeebCentral EN) ----------------
  async function browseMangas({ source, contentType, mode = 'POPULAR', query = '', tag = '', page = 1, hideNsfw = false } = {}) {
    const cfg = getConfig();
    const src = source || cfg.source || 'mangadex';
    const cType = contentType || cfg.contentType || 'all';

    if (src === 'leercapitulo') {
      const enTag = tag ? mapTagToEnglish(tag) : '';
      const data = await apiGet('/lc/browse', {
        q: query,
        type: cType,
        mode,
        tag: enTag,
        page
      }, 15000, true);
      const list = ((data && data.mangas) || [])
        .map((it) => mapGenericRemoteManga(it, 'LeerCapitulo (ES)'))
        .filter(Boolean);
      return { mangas: list, hasNextPage: !!(data && data.hasNextPage) };
    }

    if (src === 'weebcentral') {
      const enTag = tag ? mapTagToEnglish(tag) : '';
      const wcTag = enTag ? enTag.split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : '';
      const data = await apiGet('/wc/browse', {
        q: query,
        type: cType,
        mode,
        tag: wcTag,
        page,
        hideNsfw: hideNsfw ? '1' : '0'
      }, 15000, true);
      const list = ((data && data.mangas) || [])
        .map((it) => mapGenericRemoteManga(it, 'WeebCentral (EN)'))
        .filter(Boolean);
      return { mangas: list, hasNextPage: !!(data && data.hasNextPage) };
    }

    // MangaDex (con soporte nativo para Manhwas = ko, Mangas = ja, Manhuas = zh/zh-hk)
    const limit = 24;
    const offset = Math.max(0, (page - 1) * limit);
    const langs = getLangList();
    const params = {
      limit,
      offset,
      'includes[]': ['cover_art', 'author'],
      'availableTranslatedLanguage[]': langs,
      'contentRating[]': getContentRatings(hideNsfw),
      hasAvailableChapters: 'true'
    };

    if (cType === 'manhwa') params['originalLanguage[]'] = ['ko'];
    else if (cType === 'manga') params['originalLanguage[]'] = ['ja'];
    else if (cType === 'manhua') params['originalLanguage[]'] = ['zh', 'zh-hk'];

    if (tag) {
      const tagId = await resolveTagId(tag);
      if (tagId) params['includedTags[]'] = [tagId];
      else if (!query) params.title = tag;
    }

    if (query) {
      params.title = query;
      params['order[relevance]'] = 'desc';
    } else if (mode === 'LATEST') {
      params['order[latestUploadedChapter]'] = 'desc';
    } else {
      params['order[followedCount]'] = 'desc';
    }

    const data = await apiGet('/manga', params, 15000);
    const list = ((data && data.data) || []).map(mapMangaDexItem).filter(Boolean);
    const total = Number((data && data.total) || 0);
    return {
      mangas: list,
      hasNextPage: offset + list.length < total && offset + limit < 9900
    };
  }

  function updateSavedLibraryMeta(manga) {
    const lib = loadLibraryMap();
    if (lib[manga.id]) {
      lib[manga.id] = Object.assign({}, lib[manga.id], {
        title: manga.title,
        thumbnailUrl: unwrapImageUrl(manga.thumbnailUrl || ''),
        genre: manga.genre,
        author: manga.author,
        status: manga.status,
        sourceId: manga.sourceId
      });
      saveLibraryMap(lib);
    }
  }

  async function fetchMangaDetail(mangaId, hideNsfw = false) {
    const src = detectSourceFromId(mangaId);

    if (src === 'leercapitulo') {
      const uri = String(mangaId).slice(3);
      const data = await apiGet('/lc/manga', { uri }, 15000, true);
      const manga = mapGenericRemoteManga(data && data.manga, 'LeerCapitulo (ES)');
      if (!manga) throw new Error('Manga no encontrado en LeerCapitulo');
      const chapters = ((data && data.chapters) || []).map((c) => enrichRemoteChapter(c, manga.id));
      updateSavedLibraryMeta(manga);
      return { manga, chapters };
    }

    if (src === 'weebcentral') {
      const sid = String(mangaId).slice(3);
      const data = await apiGet('/wc/manga', { id: sid }, 15000, true);
      const manga = mapGenericRemoteManga(data && data.manga, 'WeebCentral (EN)');
      if (!manga) throw new Error('Manga no encontrado en WeebCentral');
      const chapters = ((data && data.chapters) || []).map((c) => enrichRemoteChapter(c, manga.id));
      updateSavedLibraryMeta(manga);
      return { manga, chapters };
    }

    const [mRes, feedRes] = await Promise.all([
      apiGet(`/manga/${encodeURIComponent(mangaId)}`, { 'includes[]': ['cover_art', 'author', 'artist'] }, 15000),
      fetchAllMangaDexChapters(mangaId, hideNsfw)
    ]);
    const manga = mapMangaDexItem(mRes && mRes.data);
    if (!manga) throw new Error('Manga no encontrado en MangaDex');
    updateSavedLibraryMeta(manga);
    return { manga, chapters: feedRes };
  }

  async function fetchAllMangaDexChapters(mangaId, hideNsfw = false) {
    const prefLangs = getLangList();
    async function loadForLangs(langs) {
      const all = [];
      const seen = new Set();
      let offset = 0;
      const limit = 100;
      for (let p = 0; p < 5; p++) {
        const data = await apiGet(`/manga/${encodeURIComponent(mangaId)}/feed`, {
          limit,
          offset,
          'translatedLanguage[]': langs,
          'contentRating[]': getContentRatings(hideNsfw),
          includeExternalUrl: '0',
          'includes[]': ['scanlation_group'],
          'order[chapter]': 'desc'
        }, 15000);
        const batch = (data && data.data) || [];
        for (const raw of batch) {
          if (!raw || !raw.id || seen.has(raw.id)) continue;
          if (raw.attributes && raw.attributes.externalUrl && Number(raw.attributes.pages || 0) === 0) continue;
          seen.add(raw.id);
          all.push(mapMangaDexChapter(raw, mangaId));
        }
        const total = Number((data && data.total) || 0);
        offset += limit;
        if (batch.length < limit || offset >= total) break;
      }
      return all;
    }

    let all = await loadForLangs(prefLangs);
    if (!all.length && !prefLangs.includes('en')) {
      all = await loadForLangs(['en']);
    }

    const asc = all.slice().sort((a, b) => {
      const ca = a.chapterNumber >= 0 ? a.chapterNumber : -1;
      const cb = b.chapterNumber >= 0 ? b.chapterNumber : -1;
      if (ca !== cb) return ca - cb;
      return (a.uploadDate || 0) - (b.uploadDate || 0);
    });
    asc.forEach((c, i) => { c.sourceOrder = i + 1; });
    return asc.reverse();
  }

  async function fetchChapterPages(chapterId) {
    const src = detectSourceFromId(chapterId);

    if (src === 'leercapitulo') {
      const uri = String(chapterId).slice(3);
      const data = await apiGet('/lc/pages', { uri }, 18000, true);
      const rawPages = (data && data.pages) || [];
      if (!rawPages.length) throw new Error('Sin páginas disponibles en LeerCapitulo');
      return rawPages.map((u) => proxyImageUrl(u));
    }

    if (src === 'weebcentral') {
      const cid = String(chapterId).slice(3);
      const data = await apiGet('/wc/pages', { id: cid }, 18000, true);
      const rawPages = (data && data.pages) || [];
      if (!rawPages.length) throw new Error('Sin páginas disponibles en WeebCentral');
      return rawPages.map((u) => proxyImageUrl(u));
    }

    const cfg = getConfig();
    const data = await apiGet(`/at-home/server/${encodeURIComponent(chapterId)}`, {}, 18000);
    if (!data || !data.baseUrl || !data.chapter) {
      throw new Error('No hay páginas disponibles en MangaDex para este capítulo');
    }
    const hash = data.chapter.hash;
    const useSaver = cfg.dataSaver !== false && Array.isArray(data.chapter.dataSaver) && data.chapter.dataSaver.length > 0;
    const files = useSaver ? data.chapter.dataSaver : (data.chapter.data || []);
    const modePath = useSaver ? 'data-saver' : 'data';
    return files.map((f) => proxyImageUrl(`${data.baseUrl}/${modePath}/${hash}/${f}`));
  }

  async function fetchLibraryUpdates(hideNsfw = false) {
    const lib = getLibraryList();
    if (!lib.length) return [];
    const langs = getLangList();
    const top = lib.slice(0, 12);
    const groups = await Promise.all(top.map(async (m) => {
      try {
        const src = detectSourceFromId(m.id);
        if (src === 'leercapitulo' || src === 'weebcentral') {
          const det = await fetchMangaDetail(m.id, hideNsfw);
          return (det.chapters || []).slice(0, 3).map((ch) => Object.assign(ch, { manga: m }));
        }
        const data = await apiGet(`/manga/${encodeURIComponent(m.id)}/feed`, {
          limit: 5,
          'translatedLanguage[]': langs,
          'contentRating[]': getContentRatings(hideNsfw),
          includeExternalUrl: '0',
          'includes[]': ['scanlation_group'],
          'order[publishAt]': 'desc'
        }, 12000);
        return ((data && data.data) || [])
          .filter((raw) => !(raw.attributes && raw.attributes.externalUrl && Number(raw.attributes.pages || 0) === 0))
          .map((raw) => Object.assign(mapMangaDexChapter(raw, m.id), { manga: m }));
      } catch {
        return [];
      }
    }));
    return groups.flat().sort((a, b) => (b.uploadDate || 0) - (a.uploadDate || 0)).slice(0, 50);
  }

  // ---------------- Biblioteca, Historial y Progreso locales (Modo Directo) ----------------
  function loadLibraryMap() {
    try { return JSON.parse(localStorage.getItem(LIB_KEY) || '{}') || {}; }
    catch { return {}; }
  }

  function saveLibraryMap(map) {
    try { localStorage.setItem(LIB_KEY, JSON.stringify(map)); } catch { }
  }

  function getLibraryList() {
    const map = loadLibraryMap();
    const hist = getHistory();
    const histByManga = new Map();
    for (const h of hist) {
      if (!histByManga.has(h.mangaId)) histByManga.set(h.mangaId, h);
    }
    return Object.values(map).map((m) => {
      const h = histByManga.get(m.id);
      return Object.assign({}, m, {
        thumbnailUrl: ensureProxiedIfWorker(m.thumbnailUrl || ''),
        inLibrary: true,
        isRemoteDirect: true,
        unreadCount: 0,
        lastReadChapter: h ? {
          id: h.chapterId,
          name: h.chapterName,
          lastReadAt: Math.floor((h.readAt || 0) / 1000),
          lastPageRead: h.lastPageRead || 0
        } : null
      });
    });
  }

  function toggleLibraryManga(manga, inLib) {
    if (!manga || !manga.id) return false;
    const map = loadLibraryMap();
    if (inLib) {
      map[manga.id] = {
        id: manga.id,
        title: manga.title || 'Sin título',
        thumbnailUrl: unwrapImageUrl(manga.thumbnailUrl || ''),
        genre: Array.isArray(manga.genre) ? manga.genre : [],
        author: manga.author || '',
        status: manga.status || '',
        sourceId: manga.sourceId || detectSourceFromId(manga.id),
        inLibrary: true,
        inLibraryAt: Date.now(),
        isRemoteDirect: true
      };
    } else {
      delete map[manga.id];
    }
    saveLibraryMap(map);
    return !!inLib;
  }

  function loadProgressMap() {
    try { return JSON.parse(localStorage.getItem(PROG_KEY) || '{}') || {}; }
    catch { return {}; }
  }

  function getChapterProgress(chapterId) {
    return loadProgressMap()[String(chapterId)] || null;
  }

  function saveChapterProgress(chapterId, patch) {
    const map = loadProgressMap();
    const cur = map[String(chapterId)] || { lastPageRead: 0, isRead: false };
    map[String(chapterId)] = {
      lastPageRead: typeof patch.lastPageRead === 'number' ? patch.lastPageRead : cur.lastPageRead,
      isRead: !!(patch.isRead || cur.isRead),
      updatedAt: Date.now()
    };
    try { localStorage.setItem(PROG_KEY, JSON.stringify(map)); } catch { }
  }

  function loadChapBookmarks() {
    try { return JSON.parse(localStorage.getItem(BOOKMARKS_KEY) || '{}') || {}; }
    catch { return {}; }
  }

  function toggleChapterBookmark(chapterId, val) {
    const map = loadChapBookmarks();
    if (val) map[String(chapterId)] = true;
    else delete map[String(chapterId)];
    try { localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(map)); } catch { }
  }

  function getHistory() {
    try {
      const arr = JSON.parse(localStorage.getItem(HIST_KEY) || '[]');
      return Array.isArray(arr)
        ? arr.map((h) => Object.assign({}, h, { thumbnailUrl: ensureProxiedIfWorker(h.thumbnailUrl || '') })).sort((a, b) => (b.readAt || 0) - (a.readAt || 0))
        : [];
    } catch {
      return [];
    }
  }

  function recordHistory(entry) {
    if (!entry || !entry.mangaId || !entry.chapterId) return;
    let list = getHistory().filter((x) => String(x.mangaId) !== String(entry.mangaId));
    list.unshift({
      mangaId: String(entry.mangaId),
      mangaTitle: entry.mangaTitle || 'Manga',
      thumbnailUrl: unwrapImageUrl(entry.thumbnailUrl || ''),
      chapterId: String(entry.chapterId),
      chapterName: entry.chapterName || '',
      lastPageRead: Number(entry.lastPageRead || 0),
      pageCount: Number(entry.pageCount || 0),
      isRead: !!entry.isRead,
      readAt: Date.now()
    });
    try { localStorage.setItem(HIST_KEY, JSON.stringify(list.slice(0, 80))); } catch { }
  }

  function removeHistoryManga(mangaId) {
    const list = getHistory().filter((x) => String(x.mangaId) !== String(mangaId));
    try { localStorage.setItem(HIST_KEY, JSON.stringify(list)); } catch { }
  }

  function clearHistory() {
    try { localStorage.setItem(HIST_KEY, '[]'); } catch { }
  }

  // ---------------- Pruebas de conexión ----------------
  async function testDirectBridge(urlOverride = '') {
    const base = cleanBaseUrl(urlOverride) || getDirectApiBase();
    if (!base) {
      return { ok: false, error: 'Pega primero la URL de tu Cloudflare Worker gratuito.' };
    }
    try {
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), 10000) : null;
      const res = await fetch(`${base}/health`, {
        headers: { 'Accept': 'application/json' },
        referrerPolicy: 'no-referrer',
        signal: ctrl ? ctrl.signal : undefined
      });
      if (timer) clearTimeout(timer);
      if (res.ok) {
        const j = await res.json().catch(() => ({}));
        if (j && j.ok) {
          if ((j.v || 1) >= 3) {
            return { ok: true, version: j.v, message: 'Puente v3 operativo (MangaDex + LeerCapitulo ES + WeebCentral EN)' };
          }
          return { ok: true, version: j.v || 1, message: `Puente v${j.v || 1} activo. Actualízalo a v3 en Cloudflare para portadas mejoradas, LeerCapitulo y WeebCentral.` };
        }
      }
      // Fallback directo a api.mangadex.org en localhost
      const r2 = await fetch(`${base}/manga?limit=1`, { headers: { 'Accept': 'application/json' }, referrerPolicy: 'no-referrer' });
      if (!r2.ok) return { ok: false, error: `HTTP ${r2.status}` };
      return { ok: true, version: 1, message: 'Conexión MangaDex operativa' };
    } catch (err) {
      return { ok: false, error: err && err.name === 'AbortError' ? 'Tiempo de espera agotado' : (err.message || 'Error CORS o de red') };
    }
  }

  async function testRemoteSuwayomi(urlOverride = '') {
    const base = cleanBaseUrl(urlOverride) || getConfig().suwayomiUrl;
    if (!base) {
      return { ok: false, error: 'Introduce la URL de tu servidor Suwayomi remoto.' };
    }
    try {
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), 10000) : null;
      const res = await fetch(`${base}/api/graphql`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: '{ __typename }' }),
        signal: ctrl ? ctrl.signal : undefined
      });
      if (timer) clearTimeout(timer);
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      const json = await res.json();
      if (!json || !json.data) return { ok: false, error: 'No responde como GraphQL de Suwayomi' };
      return { ok: true, message: 'Servidor Suwayomi remoto conectado' };
    } catch (err) {
      return {
        ok: false,
        error: err && err.name === 'AbortError'
          ? 'Tiempo de espera agotado'
          : 'No se pudo conectar (revisa la URL, HTTPS y que el servidor permita CORS si está en otro dominio).'
      };
    }
  }

  window.SuwayomiRemote = {
    SOURCES_META,
    WORKER_SNIPPET,
    cleanBaseUrl,
    getConfig,
    saveConfig,
    isLocalhostOrigin,
    getDirectApiBase,
    needsWorkerSetup,
    detectSourceFromId,
    proxyImageUrl,
    unwrapImageUrl,
    getTags,
    resolveTagId,
    browseMangas,
    fetchMangaDetail,
    fetchChapterPages,
    fetchLibraryUpdates,
    getLibraryList,
    toggleLibraryManga,
    getChapterProgress,
    saveChapterProgress,
    toggleChapterBookmark,
    getHistory,
    recordHistory,
    removeHistoryManga,
    clearHistory,
    testDirectBridge,
    testRemoteSuwayomi
  };
})();
