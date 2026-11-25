(() => {
  'use strict';

  const CONFIG_KEY = 'suwayomi_remote_config_v1';
  const LIB_KEY = 'suwayomi_remote_library_v1';
  const HIST_KEY = 'suwayomi_remote_history_v1';
  const PROG_KEY = 'suwayomi_remote_progress_v1';
  const BOOKMARKS_KEY = 'suwayomi_remote_chap_bookmarks_v1';

  const DEFAULT_CONFIG = {
    mode: 'local',          // 'local' | 'direct' | 'remote_suwayomi'
    workerUrl: '',          // URL del Cloudflare Worker propio (ej. https://mangadex.tu-usuario.workers.dev)
    suwayomiUrl: '',        // URL de otro servidor Suwayomi remoto (ej. https://mi-vps.ts.net)
    lang: 'es',             // 'es' | 'es-la' | 'en' | 'all'
    dataSaver: true         // true = ahorro de datos (mas rapido en 4G/5G), false = calidad original
  };

  const WORKER_SNIPPET = `const UPSTREAM = 'https://api.mangadex.org';
function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}
function isAllowedImgHost(h) {
  h = (h || '').toLowerCase();
  return h === 'uploads.mangadex.org' || h === 'mangadex.network' || h.endsWith('.mangadex.network');
}
export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') || '*';
    const headers = corsHeaders(origin);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'GET') return new Response('{"error":"Method not allowed"}', { status: 405, headers: { ...headers, 'Content-Type': 'application/json' } });
    const url = new URL(request.url);
    if (url.pathname === '/' || url.pathname === '/health') {
      return new Response('{"ok":true,"bridge":"suwayomi-movil-mangadex","v":2}', { status: 200, headers: { ...headers, 'Content-Type': 'application/json' } });
    }
    if (url.pathname === '/img') {
      let target = null;
      try { target = new URL(url.searchParams.get('u') || ''); } catch {}
      if (!target || target.protocol !== 'https:' || !isAllowedImgHost(target.hostname)) {
        return new Response('{"error":"Image host not allowed"}', { status: 403, headers: { ...headers, 'Content-Type': 'application/json' } });
      }
      const imgRes = await fetch(target.toString(), {
        headers: { 'Referer': 'https://mangadex.org/', 'User-Agent': 'Mozilla/5.0 (compatible; SuwayomiMovilBridge/2.0)' }
      });
      const out = new Headers(imgRes.headers);
      for (const [k, v] of Object.entries(headers)) out.set(k, v);
      out.delete('set-cookie');
      if (imgRes.ok) out.set('Cache-Control', 'public, max-age=86400');
      return new Response(imgRes.body, { status: imgRes.status, headers: out });
    }
    const allowed = /^\\/(manga(\\/[0-9a-f-]{36}(\\/feed)?)?|manga\\/tag|at-home\\/server\\/[0-9a-f-]{36}|ping)$/i;
    if (!allowed.test(url.pathname)) return new Response('{"error":"Path not allowed"}', { status: 403, headers: { ...headers, 'Content-Type': 'application/json' } });
    const res = await fetch(UPSTREAM + url.pathname + url.search, {
      headers: { 'User-Agent': 'SuwayomiMovilBridge/2.0', 'Accept': 'application/json' }
    });
    const out = new Headers(res.headers);
    for (const [k, v] of Object.entries(headers)) out.set(k, v);
    out.delete('set-cookie');
    return new Response(res.body, { status: res.status, headers: out });
  }
};`;

  // Mapeo de etiquetas en español a nombres oficiales de tags en MangaDex (ingles)
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
    'harem': 'harem'
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
    return getConfig().mode === 'direct' && !getDirectApiBase();
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

  // ---------------- Peticiones HTTP al puente / API ----------------
  async function apiGet(path, params = {}, timeoutMs = 15000) {
    const base = getDirectApiBase();
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

  function proxyImageUrl(rawUrl) {
    if (!rawUrl) return '';
    const cfg = getConfig();
    if (cfg.workerUrl) {
      return `${cfg.workerUrl}/img?u=${encodeURIComponent(rawUrl)}`;
    }
    return rawUrl;
  }

  function mapManga(raw) {
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

  function mapChapter(raw, mangaId) {
    const attr = raw.attributes || {};
    const rels = Array.isArray(raw.relationships) ? raw.relationships : [];
    const grp = rels.find((r) => r.type === 'scanlation_group' && r.attributes && r.attributes.name);
    const chNum = attr.chapter != null && attr.chapter !== '' ? parseFloat(attr.chapter) : -1;
    const numTxt = attr.chapter != null && attr.chapter !== '' ? `Cap. ${attr.chapter}` : 'One-shot';
    const titlePart = attr.title ? ` — ${attr.title}` : '';
    const langTag = attr.translatedLanguage ? `[${String(attr.translatedLanguage).toUpperCase()}] ` : '';
    const prog = getChapterProgress(raw.id);
    const bms = loadChapBookmarks();
    const ts = attr.publishAt || attr.readableAt || attr.createdAt || '';
    const epoch = ts ? Math.floor(new Date(ts).getTime() / 1000) : 0;

    return {
      id: raw.id,
      mangaId,
      name: `${langTag}${numTxt}${titlePart}`,
      chapterNumber: isNaN(chNum) ? -1 : chNum,
      sourceOrder: isNaN(chNum) ? 0 : chNum,
      scanlator: grp ? grp.attributes.name : 'MangaDex',
      translatedLanguage: attr.translatedLanguage || '',
      uploadDate: epoch,
      fetchedAt: epoch,
      pageCount: Number(attr.pages || 0),
      isRead: !!(prog && prog.isRead),
      lastPageRead: prog ? Number(prog.lastPageRead || 0) : 0,
      lastReadAt: prog ? Number(prog.updatedAt || 0) : 0,
      isBookmarked: !!bms[raw.id],
      externalUrl: attr.externalUrl || null,
      isRemoteDirect: true
    };
  }

  // ---------------- Consultas MangaDex ----------------
  async function browseMangas({ mode = 'POPULAR', query = '', tag = '', page = 1, hideNsfw = false } = {}) {
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

    let tagId = null;
    if (tag) {
      tagId = await resolveTagId(tag);
      if (tagId) {
        params['includedTags[]'] = [tagId];
      } else if (!query) {
        params.title = tag;
      }
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
    const list = ((data && data.data) || []).map(mapManga).filter(Boolean);
    const total = Number((data && data.total) || 0);
    return {
      mangas: list,
      hasNextPage: offset + list.length < total && offset + limit < 9900
    };
  }

  async function fetchMangaDetail(mangaId, hideNsfw = false) {
    const [mRes, feedRes] = await Promise.all([
      apiGet(`/manga/${encodeURIComponent(mangaId)}`, { 'includes[]': ['cover_art', 'author', 'artist'] }, 15000),
      fetchAllChapters(mangaId, hideNsfw)
    ]);
    const manga = mapManga(mRes && mRes.data);
    if (!manga) throw new Error('Manga no encontrado en MangaDex');

    // Guardar metadata actualizada si esta en la biblioteca directa
    const lib = loadLibraryMap();
    if (lib[manga.id]) {
      lib[manga.id] = Object.assign({}, lib[manga.id], {
        title: manga.title,
        thumbnailUrl: manga.thumbnailUrl,
        genre: manga.genre,
        author: manga.author,
        status: manga.status
      });
      saveLibraryMap(lib);
    }
    return { manga, chapters: feedRes };
  }

  async function fetchAllChapters(mangaId, hideNsfw = false) {
    const prefLangs = getLangList();
    async function loadForLangs(langs) {
      const all = [];
      const seen = new Set();
      let offset = 0;
      const limit = 100;
      // Max 500 capitulos (5 paginas) para mantener rapidez movil
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
          all.push(mapChapter(raw, mangaId));
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

    // Asignar sourceOrder limpio ascendente (menor = primero) para el lector
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
        const data = await apiGet(`/manga/${encodeURIComponent(m.id)}/feed`, {
          limit: 5,
          'translatedLanguage[]': langs,
          'contentRating[]': getContentRatings(hideNsfw),
          'includes[]': ['scanlation_group'],
          'order[publishAt]': 'desc'
        }, 12000);
        return ((data && data.data) || [])
          .filter((raw) => !(raw.attributes && raw.attributes.externalUrl && Number(raw.attributes.pages || 0) === 0))
          .map((raw) => Object.assign(mapChapter(raw, m.id), { manga: m }));
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
    const prog = loadProgressMap();
    const hist = getHistory();
    const histByManga = new Map();
    for (const h of hist) {
      if (!histByManga.has(h.mangaId)) histByManga.set(h.mangaId, h);
    }
    return Object.values(map).map((m) => {
      const h = histByManga.get(m.id);
      return Object.assign({}, m, {
        inLibrary: true,
        isRemoteDirect: true,
        unreadCount: 0,
        lastReadChapter: h ? {
          id: h.chapterId,
          name: h.chapterName,
          lastReadAt: Math.floor((h.readAt || 0) / 1000),
          lastPageRead: h.lastPageRead || 0
        } : null,
        _progCount: Object.keys(prog).length
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
        thumbnailUrl: manga.thumbnailUrl || '',
        genre: Array.isArray(manga.genre) ? manga.genre : [],
        author: manga.author || '',
        status: manga.status || '',
        sourceId: 'mangadex',
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
      return Array.isArray(arr) ? arr.sort((a, b) => (b.readAt || 0) - (a.readAt || 0)) : [];
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
      thumbnailUrl: entry.thumbnailUrl || '',
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
      const res = await fetch(`${base}/manga?limit=1`, {
        headers: { 'Accept': 'application/json' },
        referrerPolicy: 'no-referrer',
        signal: ctrl ? ctrl.signal : undefined
      });
      if (timer) clearTimeout(timer);
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      const json = await res.json();
      if (!json || !Array.isArray(json.data)) return { ok: false, error: 'Respuesta inesperada del puente' };
      return { ok: true, message: 'Puente MangaDex operativo' };
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
    WORKER_SNIPPET,
    cleanBaseUrl,
    getConfig,
    saveConfig,
    isLocalhostOrigin,
    getDirectApiBase,
    needsWorkerSetup,
    getTags,
    resolveTagId,
    browseMangas,
    fetchMangaDetail,
    fetchAllChapters,
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
