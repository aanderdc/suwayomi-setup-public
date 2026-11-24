(() => {
  'use strict';

  const API_URL = '/api/graphql';
  const PREFS_KEY = 'suwayomi_mobile_prefs_v2';
  const Offline = window.SuwayomiOffline;

  const DEFAULT_PREFS = {
    mode: 'vertical',     // 'vertical' (PDF continuo) | 'rtl' | 'ltr'
    fit: 'width',         // 'width' (100% ancho del movil) | 'screen'
    gap: false,           // false = 0px sin espacio entre paginas
    dim: 0,               // 0..70 filtro nocturno
    miniStatus: true      // indicador discreto en esquina
  };

  function loadPrefs() {
    try {
      const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
      return Object.assign({}, DEFAULT_PREFS, saved);
    } catch {
      return Object.assign({}, DEFAULT_PREFS);
    }
  }

  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(state.prefs));
    } catch { }
  }

  const state = {
    tab: 'library',
    offline: false,
    prefs: loadPrefs(),
    library: [],
    categories: [],
    selectedCat: 'all',
    onlyDownloaded: false,
    librarySearch: '',
    recent: [],
    sources: [],
    activeSource: null,
    sourceMode: 'POPULAR', // 'POPULAR' | 'LATEST' | 'SEARCH'
    sourceQuery: '',
    sourcePage: 1,
    sourceHasNext: false,
    sourceMangas: [],
    // Descargas locales (modo sin conexión tipo Spotify)
    downloads: new Map(),         // chapterId -> record
    downloadsByManga: new Map(),  // mangaId -> count
    downloadQueue: [],            // [{ manga, chapters, chapter }]
    activeDownload: null,         // { chapterId, done, total }
    // Detalle de manga
    manga: null,
    mangaChapters: [],
    chapterFilter: 'all', // 'all' | 'unread' | 'downloaded'
    chapterDesc: true,
    // Lector
    reader: {
      open: false,
      manga: null,
      chapters: [],       // orden ascendente por sourceOrder (index 0 = Cap 1)
      chapIdx: 0,
      pages: [],
      blobUrls: [],
      pageIdx: 0,
      chromeVisible: true,
      observer: null,
      lastSavedPage: -1,
      markedRead: false,
      preloadedChapId: null,
      touchStartX: 0,
      touchStartY: 0,
      touchMoved: false
    }
  };

  // ---------------- DOM ----------------
  const $ = (id) => document.getElementById(id);
  const headerTitle = $('headerTitle');
  const headerActions = $('headerActions');
  const headerSub = $('headerSub');
  const mainContent = $('mainContent');
  const bottomNav = $('bottomNav');
  const mangaView = $('mangaView');
  const readerView = $('readerView');
  const readerStage = $('readerStage');
  const readerDimmer = $('readerDimmer');
  const readerMiniStatus = $('readerMiniStatus');
  const readerMangaTitle = $('readerMangaTitle');
  const readerChapterTitle = $('readerChapterTitle');
  const readerSlider = $('readerSlider');
  const readerPageNow = $('readerPageNow');
  const readerPageTotal = $('readerPageTotal');
  const readerPrevChap = $('readerPrevChap');
  const readerNextChap = $('readerNextChap');
  const readerModeQuick = $('readerModeQuick');
  const readerSheetBackdrop = $('readerSheetBackdrop');
  const readerSheet = $('readerSheet');
  const toastEl = $('toast');
  const offlineBanner = $('offlineBanner');
  const offlineRetryBtn = $('offlineRetryBtn');
  const installBanner = $('installBanner');
  const installBannerBtn = $('installBannerBtn');
  const installBannerClose = $('installBannerClose');

  // ---------------- Instalación PWA (una sola vez, sin volver a escanear QR) ----------------
  let deferredInstallPrompt = null;
  const INSTALL_DISMISSED_KEY = 'suwayomi_install_dismissed_v1';

  function isStandaloneApp() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
      || window.navigator.standalone === true;
  }

  function isIosBrowser() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent || '');
  }

  function updateInstallBanner() {
    if (!installBanner) return;
    if (isStandaloneApp() || sessionStorage.getItem(INSTALL_DISMISSED_KEY) === '1') {
      installBanner.classList.add('hidden');
      return;
    }
    installBanner.classList.remove('hidden');
  }

  async function triggerInstallApp() {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      try {
        const res = await deferredInstallPrompt.userChoice;
        if (res && res.outcome === 'accepted') {
          showToast('Instalando Suwayomi Móvil...');
          installBanner.classList.add('hidden');
        }
      } catch { }
      deferredInstallPrompt = null;
      if (state.tab === 'settings') renderSettings();
      return;
    }
    if (isIosBrowser()) {
      alert('Para instalarla en iPhone/iPad:\n\n1. Pulsa el botón Compartir (cuadro con flecha abajo).\n2. Elige "Añadir a pantalla de inicio".\n\nYa no tendrás que volver a escanear el QR.');
    } else {
      alert('Para instalarla en tu móvil:\n\n1. Pulsa el menú de Chrome (los 3 puntos arriba a la derecha).\n2. Pulsa "Instalar aplicación" o "Añadir a pantalla de inicio".\n\nQuedará como una app en tu móvil y no tendrás que volver a escanear el QR.');
    }
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    updateInstallBanner();
    if (state.tab === 'settings') renderSettings();
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    if (installBanner) installBanner.classList.add('hidden');
    showToast('App instalada. Ya no necesitas el QR.');
    if (state.tab === 'settings') renderSettings();
  });

  if (installBannerBtn) installBannerBtn.addEventListener('click', triggerInstallApp);
  if (installBannerClose) {
    installBannerClose.addEventListener('click', () => {
      sessionStorage.setItem(INSTALL_DISMISSED_KEY, '1');
      installBanner.classList.add('hidden');
    });
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/movil/sw.js', { scope: '/movil/' }).catch(() => { });
  }
  updateInstallBanner();

  // ---------------- Utilidades ----------------
  let toastTimer = null;
  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 2600);
  }

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatDate(ts) {
    const n = Number(ts);
    if (!n) return '';
    const ms = n > 1e12 ? n : n * 1000;
    const d = new Date(ms);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function modeLabel(mode) {
    if (mode === 'vertical') return 'Continuo (PDF)';
    if (mode === 'rtl') return 'Manga D→I';
    return 'Paginado I→D';
  }

  function isDownloaded(chapterId) {
    return state.downloads.has(Number(chapterId));
  }

  function mangaDownloadCount(mangaId) {
    return state.downloadsByManga.get(Number(mangaId)) || 0;
  }

  function coverUrlFor(manga) {
    if (!manga) return '';
    if (state.offline || !manga.thumbnailUrl) {
      return `/movil/__offline__/cover/${manga.id}`;
    }
    return manga.thumbnailUrl;
  }

  function attachCoverFallbacks(root) {
    if (!root || !Offline) return;
    root.querySelectorAll('img[data-cover-id]').forEach((img) => {
      img.addEventListener('error', async () => {
        if (img.dataset.fallbackTried) return;
        img.dataset.fallbackTried = '1';
        const blobUrl = await Offline.getCachedCoverBlobUrl(Number(img.dataset.coverId));
        if (blobUrl) img.src = blobUrl;
      });
    });
  }

  function setOfflineMode(isOff) {
    const wasOff = state.offline;
    state.offline = !!isOff;
    if (offlineBanner) {
      offlineBanner.classList.toggle('hidden', !state.offline);
    }
    if (wasOff && !state.offline) {
      flushPendingSyncs();
    }
  }

  if (offlineRetryBtn) {
    offlineRetryBtn.addEventListener('click', async () => {
      showToast('Comprobando conexión con el PC...');
      setOfflineMode(false);
      await handleRoute();
    });
  }

  window.addEventListener('online', () => {
    if (state.offline) {
      setOfflineMode(false);
      handleRoute();
    }
  });

  window.addEventListener('offline', () => {
    setOfflineMode(true);
    if (!state.reader.open && mangaView.classList.contains('hidden')) {
      renderCurrentTab();
    } else if (!mangaView.classList.contains('hidden') && state.manga) {
      drawMangaDetail();
    }
  });

  // ---------------- Índice y cola de descargas offline ----------------
  async function refreshDownloadsIndex() {
    if (!Offline) return;
    const all = await Offline.listDownloads();
    state.downloads.clear();
    state.downloadsByManga.clear();
    for (const rec of all) {
      state.downloads.set(Number(rec.chapterId), rec);
      const mid = Number(rec.mangaId);
      state.downloadsByManga.set(mid, (state.downloadsByManga.get(mid) || 0) + 1);
    }
  }

  function refreshVisibleAfterDownload() {
    if (!mangaView.classList.contains('hidden') && state.manga) {
      drawMangaDetail();
    } else if (state.tab === 'library') {
      drawLibraryGrid();
    } else if (state.tab === 'settings') {
      renderSettings();
    }
  }

  function enqueueChapterDownload(manga, chapters, chapter) {
    if (state.offline) {
      showToast('Sin conexión: conéctate al PC para descargar capítulos.');
      return;
    }
    if (isDownloaded(chapter.id)) return;
    if (state.activeDownload && state.activeDownload.chapterId === chapter.id) return;
    if (state.downloadQueue.some((q) => q.chapter.id === chapter.id)) return;

    state.downloadQueue.push({ manga, chapters, chapter });
    refreshVisibleAfterDownload();
    processDownloadQueue();
  }

  let downloadingLoop = false;
  async function processDownloadQueue() {
    if (downloadingLoop) return;
    downloadingLoop = true;
    try {
      while (state.downloadQueue.length > 0) {
        const job = state.downloadQueue.shift();
        state.activeDownload = { chapterId: job.chapter.id, done: 0, total: 0 };
        refreshVisibleAfterDownload();

        try {
          const pgData = await gql(M_FETCH_PAGES, { chapterId: job.chapter.id });
          const pages = (pgData.fetchChapterPages && pgData.fetchChapterPages.pages) || [];
          if (!pages.length) throw new Error('Sin páginas');

          state.activeDownload.total = pages.length;
          await Offline.downloadChapter({
            manga: job.manga,
            chapters: job.chapters,
            chapter: job.chapter,
            pageUrls: pages,
            onProgress: (done, total) => {
              if (state.activeDownload && state.activeDownload.chapterId === job.chapter.id) {
                state.activeDownload.done = done;
                state.activeDownload.total = total;
                const btn = mangaView.querySelector(`.chap-dl-btn[data-dl-id="${job.chapter.id}"]`);
                if (btn) btn.textContent = `${done}/${total}`;
              }
            }
          });
          await refreshDownloadsIndex();
          showToast(`Descargado: ${job.chapter.name}`);
        } catch (err) {
          showToast(`Error descargando ${job.chapter.name}: ${err.message || ''}`);
          if (!navigator.onLine) {
            state.downloadQueue = [];
            setOfflineMode(true);
            break;
          }
        } finally {
          state.activeDownload = null;
          refreshVisibleAfterDownload();
        }
      }
    } finally {
      downloadingLoop = false;
    }
  }

  async function flushPendingSyncs() {
    if (!Offline || state.offline) return;
    const items = await Offline.getPendingSyncs();
    if (!items.length) return;
    let synced = 0;
    for (const item of items) {
      try {
        const patch = { lastPageRead: item.lastPageRead };
        if (item.isRead) patch.isRead = true;
        await gql(M_UPDATE_CHAPTER, { id: item.chapterId, patch });
        await Offline.removePendingSync(item.chapterId);
        synced += 1;
      } catch {
        break;
      }
    }
    if (synced > 0) {
      showToast(`Progreso sincronizado (${synced} cap.)`);
    }
  }

  function warmLibraryCovers(mangas) {
    if (!Offline || state.offline || !mangas.length) return;
    const list = mangas.slice(0, 60);
    let idx = 0;
    async function worker() {
      while (idx < list.length && !state.offline) {
        const m = list[idx++];
        if (m && m.id && m.thumbnailUrl) {
          await Offline.cacheCover(m.id, m.thumbnailUrl);
        }
      }
    }
    for (let i = 0; i < 3; i++) worker();
  }

  // ---------------- GraphQL ----------------
  async function gql(query, variables = {}, timeoutMs = 12000) {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables }),
        signal: ctrl ? ctrl.signal : undefined
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.errors && json.errors.length) {
        throw new Error(json.errors[0].message || 'Error de Suwayomi');
      }
      if (state.offline) setOfflineMode(false);
      return json.data;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  const Q_LIBRARY = `
    query LibraryData {
      categories(order: [{ by: ORDER, byType: ASC }]) {
        nodes { id name order default }
      }
      mangas(condition: { inLibrary: true }, order: [{ by: TITLE, byType: ASC }]) {
        nodes {
          id title thumbnailUrl inLibrary unreadCount
          categories { nodes { id name } }
          firstUnreadChapter { id name chapterNumber sourceOrder }
          lastReadChapter { id name chapterNumber sourceOrder lastReadAt lastPageRead }
        }
      }
    }
  `;

  const Q_RECENT = `
    query RecentChapters {
      chapters(
        filter: { lastReadAt: { greaterThan: "0" } }
        order: [{ by: LAST_READ_AT, byType: DESC }]
        first: 40
      ) {
        nodes {
          id name chapterNumber mangaId lastReadAt lastPageRead pageCount isRead
          manga { id title thumbnailUrl unreadCount }
        }
      }
    }
  `;

  const Q_SOURCES = `
    query SourcesList {
      sources {
        nodes { id name displayName lang iconUrl supportsLatest }
      }
    }
  `;

  const Q_MANGA_DETAIL = `
    query MangaDetail($id: Int!) {
      manga(id: $id) {
        id title thumbnailUrl inLibrary initialized status author artist description genre sourceId
        unreadCount
        source { id name displayName }
      }
      chapters(condition: { mangaId: $id }, order: [{ by: SOURCE_ORDER, byType: DESC }]) {
        nodes {
          id name mangaId chapterNumber sourceOrder scanlator uploadDate
          isRead isDownloaded isBookmarked lastPageRead pageCount lastReadAt
        }
      }
    }
  `;

  const M_REFRESH_MANGA = `
    mutation RefreshManga($id: Int!, $fetchManga: Boolean!, $fetchChapters: Boolean!) {
      fetchMangaAndChapters(input: { id: $id, fetchManga: $fetchManga, fetchChapters: $fetchChapters }) {
        manga {
          id title thumbnailUrl inLibrary initialized status author artist description genre sourceId
          unreadCount
          source { id name displayName }
        }
        chapters {
          id name mangaId chapterNumber sourceOrder scanlator uploadDate
          isRead isDownloaded isBookmarked lastPageRead pageCount lastReadAt
        }
      }
    }
  `;

  const M_FETCH_PAGES = `
    mutation FetchPages($chapterId: Int!) {
      fetchChapterPages(input: { chapterId: $chapterId }) {
        chapter { id pageCount }
        pages
      }
    }
  `;

  const M_UPDATE_CHAPTER = `
    mutation UpdateChapter($id: Int!, $patch: UpdateChapterPatchInput!) {
      updateChapter(input: { id: $id, patch: $patch }) {
        chapter { id isRead lastPageRead isBookmarked }
      }
    }
  `;

  const M_UPDATE_MANGA = `
    mutation UpdateManga($id: Int!, $inLibrary: Boolean!) {
      updateManga(input: { id: $id, patch: { inLibrary: $inLibrary } }) {
        manga { id inLibrary }
      }
    }
  `;

  const M_SOURCE_MANGAS = `
    mutation FetchSource($input: FetchSourceMangaInput!) {
      fetchSourceManga(input: $input) {
        hasNextPage
        mangas { id title thumbnailUrl inLibrary sourceId }
      }
    }
  `;

  // ---------------- Enrutado (botón Atrás del móvil) ----------------
  function navigateHash(hash) {
    if (location.hash === hash) {
      handleRoute();
    } else {
      location.hash = hash;
    }
  }

  window.addEventListener('hashchange', handleRoute);

  async function handleRoute() {
    const raw = (location.hash || '#library').replace(/^#/, '');
    const parts = raw.split('/');
    const view = parts[0] || 'library';

    if (view === 'read' && parts[1] && parts[2]) {
      const mId = parseInt(parts[1], 10);
      const cId = parseInt(parts[2], 10);
      if (mId && cId) {
        await openReader(mId, cId);
        return;
      }
    } else if (state.reader.open) {
      closeReaderUi();
    }

    if (view === 'manga' && parts[1]) {
      const mId = parseInt(parts[1], 10);
      if (mId) {
        await openMangaDetail(mId);
        return;
      }
    } else {
      mangaView.classList.add('hidden');
    }

    const validTabs = ['library', 'recent', 'explore', 'settings'];
    state.tab = validTabs.includes(view) ? view : 'library';
    updateBottomNav();
    renderCurrentTab();
  }

  function updateBottomNav() {
    bottomNav.querySelectorAll('.nav-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === state.tab);
    });
  }

  bottomNav.addEventListener('click', (e) => {
    const btn = e.target.closest('.nav-btn');
    if (!btn) return;
    navigateHash('#' + btn.dataset.tab);
  });

  // ---------------- Pestañas ----------------
  async function renderCurrentTab(forceReload = false) {
    if (state.tab === 'library') await renderLibrary(forceReload);
    else if (state.tab === 'recent') await renderRecent();
    else if (state.tab === 'explore') await renderExplore();
    else if (state.tab === 'settings') await renderSettings();
  }

  // --- BIBLIOTECA ---
  async function renderLibrary(forceReload = false) {
    headerTitle.textContent = 'Biblioteca';
    headerActions.innerHTML = `
      <button id="libRefreshBtn" class="icon-btn" type="button" aria-label="Recargar">
        <svg viewBox="0 0 24 24"><path d="M17.6 6.4A8 8 0 1 0 20 12h-2a6 6 0 1 1-1.8-4.2L13 11h7V4l-2.4 2.4z"/></svg>
      </button>
    `;
    $('libRefreshBtn').addEventListener('click', () => renderLibrary(true));

    await refreshDownloadsIndex();

    if (!state.library.length || forceReload) {
      mainContent.innerHTML = '<div class="spinner"></div>';
      try {
        const data = await gql(Q_LIBRARY, {}, 7000);
        state.categories = (data.categories && data.categories.nodes) || [];
        state.library = (data.mangas && data.mangas.nodes) || [];
        setOfflineMode(false);
        if (Offline) {
          Offline.saveSnapshot('library', { categories: state.categories, library: state.library });
          warmLibraryCovers(state.library);
          flushPendingSyncs();
        }
      } catch {
        setOfflineMode(true);
        const snap = Offline ? await Offline.getSnapshot('library') : null;
        state.categories = (snap && snap.categories) || [];
        state.library = (snap && snap.library) || [];

        // Asegurar que aparezcan mangas que tengan capítulos descargados aunque no estuvieran en el snapshot
        if (Offline) {
          const savedMangas = await Offline.getAllSavedMangas();
          const knownIds = new Set(state.library.map((m) => m.id));
          for (const entry of savedMangas) {
            if (entry.manga && !knownIds.has(entry.manga.id) && mangaDownloadCount(entry.manga.id) > 0) {
              state.library.push(entry.manga);
            }
          }
        }
      }
    }

    // Buscador + filtros (categorías + Solo descargados)
    headerSub.classList.remove('hidden');
    const usedCats = state.categories.filter((c) => c.id !== 0);
    const dlMangasCount = state.library.filter((m) => mangaDownloadCount(m.id) > 0).length;

    headerSub.innerHTML = `
      <div class="search-box">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="#8e98a8"><path d="M15.5 14h-.8l-.3-.3a6.5 6.5 0 1 0-.7.7l.3.3v.8l5 5 1.5-1.5-5-5zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14z"/></svg>
        <input id="libSearchInput" type="search" placeholder="Buscar en tu biblioteca..." value="${esc(state.librarySearch)}">
      </div>
      <div class="chips-row">
        <button class="chip ${state.onlyDownloaded ? 'active' : ''}" id="chipOnlyDl">↓ Descargados (${dlMangasCount})</button>
        <button class="chip ${!state.onlyDownloaded && state.selectedCat === 'all' ? 'active' : ''}" data-cat="all">Todos (${state.library.length})</button>
        ${usedCats.map((c) => `<button class="chip ${!state.onlyDownloaded && String(state.selectedCat) === String(c.id) ? 'active' : ''}" data-cat="${c.id}">${esc(c.name)}</button>`).join('')}
      </div>
    `;

    $('libSearchInput').addEventListener('input', (e) => {
      state.librarySearch = e.target.value;
      drawLibraryGrid();
    });
    $('chipOnlyDl').addEventListener('click', () => {
      state.onlyDownloaded = !state.onlyDownloaded;
      renderLibrary(false);
    });
    headerSub.querySelectorAll('.chip[data-cat]').forEach((ch) => {
      ch.addEventListener('click', () => {
        state.onlyDownloaded = false;
        state.selectedCat = ch.dataset.cat;
        renderLibrary(false);
      });
    });

    drawLibraryGrid();
  }

  function drawLibraryGrid() {
    const q = state.librarySearch.trim().toLowerCase();
    let list = state.library.filter((m) => {
      if (q && !m.title.toLowerCase().includes(q)) return false;
      if (state.onlyDownloaded && mangaDownloadCount(m.id) === 0) return false;
      if (!state.onlyDownloaded && state.selectedCat !== 'all') {
        const cats = (m.categories && m.categories.nodes) || [];
        return cats.some((c) => String(c.id) === String(state.selectedCat));
      }
      return true;
    });

    // En modo sin conexión, mostrar primero los mangas con capítulos descargados
    if (state.offline) {
      list = list.slice().sort((a, b) => {
        const da = mangaDownloadCount(a.id) > 0 ? 1 : 0;
        const db = mangaDownloadCount(b.id) > 0 ? 1 : 0;
        if (db !== da) return db - da;
        return (a.title || '').localeCompare(b.title || '');
      });
    }

    if (!list.length) {
      const msgTitle = state.onlyDownloaded
        ? 'No tienes capítulos descargados'
        : (state.offline
          ? 'Sin conexión y sin datos guardados'
          : (state.library.length ? 'Sin coincidencias' : 'Tu biblioteca está vacía'));
      const msgDesc = state.onlyDownloaded
        ? 'Abre cualquier manga con el PC encendido y pulsa ↓ para descargar capítulos y leerlos sin conexión.'
        : (state.offline
          ? 'Enciende el PC una vez, abre la app y descarga los capítulos que quieras leer sin conexión.'
          : (state.library.length ? 'Prueba con otro filtro o búsqueda.' : 'Ve a Explorar para buscar un manga y añadirlo a tu biblioteca.'));
      mainContent.innerHTML = `
        <div class="empty-state">
          <h3>${msgTitle}</h3>
          <p>${msgDesc}</p>
          ${state.offline
            ? '<button id="retryLibOff" class="primary-btn" style="max-width:220px">Reintentar conexión</button>'
            : (!state.library.length ? '<button id="goExploreBtn" class="primary-btn" style="max-width:220px">Ir a Explorar</button>' : '')}
        </div>
      `;
      const b = $('goExploreBtn');
      if (b) b.addEventListener('click', () => navigateHash('#explore'));
      const rBtn = $('retryLibOff');
      if (rBtn) rBtn.addEventListener('click', () => renderLibrary(true));
      return;
    }

    mainContent.innerHTML = `<div class="manga-grid">${list.map((m) => {
      const dlCount = mangaDownloadCount(m.id);
      const dimmed = state.offline && dlCount === 0;
      return `
        <div class="manga-card ${dimmed ? 'offline-dim' : ''}" data-manga-id="${m.id}">
          <div class="manga-cover-wrap">
            <img src="${esc(coverUrlFor(m))}" data-cover-id="${m.id}" alt="" loading="lazy">
            <div class="manga-cover-grad"></div>
            ${m.unreadCount > 0 ? `<span class="manga-badge">${m.unreadCount}</span>` : ''}
            ${dlCount > 0 ? `<span class="manga-dl-badge">↓ ${dlCount}</span>` : ''}
            <div class="manga-card-title">${esc(m.title)}</div>
          </div>
        </div>
      `;
    }).join('')}</div>`;

    attachCoverFallbacks(mainContent);
    mainContent.querySelectorAll('.manga-card').forEach((card) => {
      card.addEventListener('click', () => navigateHash('#manga/' + card.dataset.mangaId));
    });
  }

  // --- RECIENTES ---
  let clearingHistory = false;

  async function runClearHistory() {
    if (clearingHistory) return;
    if (state.offline) {
      if (confirm('Estás sin conexión con el PC. ¿Quieres limpiar solo la lista local de recientes en este móvil? (Para borrar también el historial del servidor, hazlo cuando el PC esté encendido).')) {
        state.recent = [];
        if (Offline) await Offline.saveSnapshot('recent', []);
        showToast('Lista local de recientes vaciada');
        if (state.tab === 'recent') renderRecent();
      }
      return;
    }

    const ok = confirm(
      'Se borrará el historial de lectura en Suwayomi.\n\n' +
      '• Los capítulos siguen marcados como leídos.\n' +
      '• Se conservan la biblioteca, el progreso y las descargas.\n' +
      '• Se hace copia de seguridad automática de la base de datos.\n' +
      '• Suwayomi se reiniciará unos segundos.\n\n' +
      '¿Continuar?'
    );
    if (!ok) return;

    clearingHistory = true;
    showToast('Borrando historial y reiniciando Suwayomi...');
    if (state.tab === 'recent') {
      mainContent.innerHTML = '<div class="empty-state"><div class="spinner"></div><h3>Borrando historial...</h3><p>Suwayomi se está reiniciando (tarda unos segundos).</p></div>';
    }

    try {
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), 45000) : null;
      const res = await fetch('/movil/__action__/clear-history', {
        method: 'POST',
        headers: { 'X-Suwayomi-Action': 'clear-history' },
        signal: ctrl ? ctrl.signal : undefined
      });
      if (timer) clearTimeout(timer);
      let data = {};
      try { data = await res.json(); } catch { }
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `Error HTTP ${res.status}`);
      }
      state.recent = [];
      if (Offline) await Offline.saveSnapshot('recent', []);
      showToast('Historial borrado correctamente');
    } catch (err) {
      showToast('No se pudo borrar el historial: ' + (err.message || 'error'));
    } finally {
      clearingHistory = false;
      if (state.tab === 'recent') renderRecent();
      else if (state.tab === 'settings') renderSettings();
    }
  }

  async function renderRecent() {
    headerTitle.textContent = 'Recientes';
    headerActions.innerHTML = `
      <button id="recentClearBtn" class="secondary-btn" type="button" style="padding:6px 10px;font-size:12px;color:#ff8690;border-color:rgba(255,77,90,0.35)">Borrar historial</button>
    `;
    $('recentClearBtn').addEventListener('click', runClearHistory);
    headerSub.classList.add('hidden');
    mainContent.innerHTML = '<div class="spinner"></div>';
    await refreshDownloadsIndex();

    try {
      const data = await gql(Q_RECENT, {}, 7000);
      const raw = (data.chapters && data.chapters.nodes) || [];
      const seen = new Set();
      state.recent = [];
      for (const ch of raw) {
        if (!ch.manga || seen.has(ch.manga.id)) continue;
        seen.add(ch.manga.id);
        state.recent.push(ch);
      }
      setOfflineMode(false);
      if (Offline) Offline.saveSnapshot('recent', state.recent);
    } catch {
      setOfflineMode(true);
      const snap = Offline ? await Offline.getSnapshot('recent') : null;
      state.recent = snap || [];
    }

    if (!state.recent.length) {
      mainContent.innerHTML = `
        <div class="empty-state">
          <h3>${state.offline ? 'Sin lecturas recientes guardadas' : 'Aún no hay lecturas recientes'}</h3>
          <p>${state.offline ? 'Tus capítulos descargados están disponibles en Biblioteca.' : 'Cuando abras un capítulo aparecerá aquí para que puedas retomarlo con un toque.'}</p>
        </div>
      `;
      return;
    }

    mainContent.innerHTML = `<div class="list-stack">${state.recent.map((ch) => {
      const dl = isDownloaded(ch.id);
      const locked = state.offline && !dl;
      const pageTxt = ch.isRead
        ? 'Leído'
        : (ch.pageCount > 0 ? `Pág. ${(ch.lastPageRead || 0) + 1} / ${ch.pageCount}` : 'En progreso');
      return `
        <div class="list-card ${locked ? 'offline-dim' : ''}" data-manga-id="${ch.manga.id}">
          <img class="list-thumb" src="${esc(coverUrlFor(ch.manga))}" data-cover-id="${ch.manga.id}" alt="" loading="lazy">
          <div class="list-body">
            <div class="list-title">${esc(ch.manga.title)}</div>
            <div class="list-sub">${esc(ch.name)} ${dl ? '· ✓ Descargado' : ''}</div>
            <div class="list-sub">${pageTxt} · ${formatDate(ch.lastReadAt)}</div>
          </div>
          <button class="list-cta" data-read-manga="${ch.manga.id}" data-read-chap="${ch.id}" type="button">${locked ? 'Sin red' : 'Leer'}</button>
        </div>
      `;
    }).join('')}</div>`;

    attachCoverFallbacks(mainContent);
    mainContent.querySelectorAll('.list-card').forEach((card) => {
      card.addEventListener('click', (e) => {
        const btn = e.target.closest('.list-cta');
        if (btn) {
          e.stopPropagation();
          const cId = Number(btn.dataset.readChap);
          if (state.offline && !isDownloaded(cId)) {
            showToast('No descargado. Conéctate al PC para leer este capítulo.');
            return;
          }
          navigateHash(`#read/${btn.dataset.readManga}/${cId}`);
          return;
        }
        navigateHash('#manga/' + card.dataset.mangaId);
      });
    });
  }

  // --- EXPLORAR ---
  async function renderExplore() {
    if (state.activeSource && !state.offline) {
      renderSourceBrowser();
      return;
    }
    headerTitle.textContent = 'Explorar';
    headerActions.innerHTML = state.offline
      ? ''
      : '<a href="/" class="secondary-btn" style="text-decoration:none;padding:6px 10px;font-size:12px">Extensiones</a>';
    headerSub.classList.add('hidden');
    mainContent.innerHTML = '<div class="spinner"></div>';

    try {
      const data = await gql(Q_SOURCES, {}, 7000);
      setOfflineMode(false);
      state.sources = ((data.sources && data.sources.nodes) || [])
        .sort((a, b) => (a.lang || '').localeCompare(b.lang || '') || (a.name || '').localeCompare(b.name || ''));
    } catch {
      setOfflineMode(true);
      mainContent.innerHTML = `
        <div class="empty-state">
          <h3>Explorar requiere conexión con tu PC</h3>
          <p>El servidor está apagado o sin red. Mientras tanto puedes leer tus capítulos descargados en Biblioteca.</p>
          <div style="display:flex;gap:8px;justify-content:center">
            <button id="expGoLib" class="primary-btn" style="max-width:170px">Ir a Biblioteca</button>
            <button id="expRetry" class="secondary-btn">Reintentar</button>
          </div>
        </div>
      `;
      $('expGoLib').addEventListener('click', () => navigateHash('#library'));
      $('expRetry').addEventListener('click', () => renderExplore());
      return;
    }

    if (!state.sources.length) {
      mainContent.innerHTML = `
        <div class="empty-state">
          <h3>No hay fuentes instaladas</h3>
          <p>Instala alguna extensión desde el Suwayomi completo para explorar mangas desde aquí.</p>
          <a href="/" class="primary-btn" style="display:inline-block;max-width:240px;text-decoration:none">Abrir Suwayomi completo</a>
        </div>
      `;
      return;
    }

    mainContent.innerHTML = `<div class="list-stack">${state.sources.map((s) => `
      <div class="list-card" data-source-id="${esc(s.id)}">
        <img class="source-icon" src="${esc(s.iconUrl || '')}" alt="" loading="lazy">
        <div class="list-body">
          <div class="list-title">${esc(s.name)}</div>
          <div class="list-sub">Idioma: ${esc((s.lang || '').toUpperCase())}</div>
        </div>
        <span style="color:var(--muted);font-size:18px">›</span>
      </div>
    `).join('')}</div>`;

    mainContent.querySelectorAll('.list-card').forEach((card) => {
      card.addEventListener('click', () => {
        const src = state.sources.find((x) => String(x.id) === String(card.dataset.sourceId));
        if (!src) return;
        state.activeSource = src;
        state.sourceMode = 'POPULAR';
        state.sourceQuery = '';
        state.sourcePage = 1;
        state.sourceMangas = [];
        renderSourceBrowser(true);
      });
    });
  }

  async function renderSourceBrowser(loadNow = false) {
    const src = state.activeSource;
    headerTitle.textContent = src.name;
    headerActions.innerHTML = `
      <button id="srcBackBtn" class="secondary-btn" type="button" style="padding:6px 10px;font-size:12px">‹ Fuentes</button>
    `;
    $('srcBackBtn').addEventListener('click', () => {
      state.activeSource = null;
      renderExplore();
    });

    headerSub.classList.remove('hidden');
    headerSub.innerHTML = `
      <form id="srcSearchForm" class="search-box">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="#8e98a8"><path d="M15.5 14h-.8l-.3-.3a6.5 6.5 0 1 0-.7.7l.3.3v.8l5 5 1.5-1.5-5-5zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14z"/></svg>
        <input id="srcSearchInput" type="search" placeholder="Buscar en ${esc(src.name)}..." value="${esc(state.sourceQuery)}">
      </form>
      <div class="chips-row">
        <button class="chip ${state.sourceMode === 'POPULAR' ? 'active' : ''}" data-smode="POPULAR">Populares</button>
        ${src.supportsLatest ? `<button class="chip ${state.sourceMode === 'LATEST' ? 'active' : ''}" data-smode="LATEST">Últimos</button>` : ''}
      </div>
    `;

    $('srcSearchForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const q = $('srcSearchInput').value.trim();
      state.sourceQuery = q;
      state.sourceMode = q ? 'SEARCH' : 'POPULAR';
      state.sourcePage = 1;
      state.sourceMangas = [];
      loadSourcePage();
    });
    headerSub.querySelectorAll('.chip').forEach((ch) => {
      ch.addEventListener('click', () => {
        state.sourceMode = ch.dataset.smode;
        state.sourceQuery = '';
        state.sourcePage = 1;
        state.sourceMangas = [];
        renderSourceBrowser(true);
      });
    });

    if (loadNow || !state.sourceMangas.length) {
      await loadSourcePage();
    } else {
      drawSourceGrid();
    }
  }

  async function loadSourcePage() {
    if (state.sourcePage === 1) mainContent.innerHTML = '<div class="spinner"></div>';
    try {
      const input = {
        source: String(state.activeSource.id),
        type: state.sourceMode,
        page: state.sourcePage
      };
      if (state.sourceMode === 'SEARCH') input.query = state.sourceQuery;
      const data = await gql(M_SOURCE_MANGAS, { input });
      const res = data.fetchSourceManga || { mangas: [], hasNextPage: false };
      state.sourceHasNext = !!res.hasNextPage;
      state.sourceMangas = state.sourcePage === 1 ? res.mangas : state.sourceMangas.concat(res.mangas);
      drawSourceGrid();
    } catch {
      setOfflineMode(true);
      state.activeSource = null;
      renderExplore();
    }
  }

  function drawSourceGrid() {
    if (!state.sourceMangas.length) {
      mainContent.innerHTML = '<div class="empty-state"><h3>Sin resultados</h3><p>Prueba otra búsqueda o cambia de fuente.</p></div>';
      return;
    }
    mainContent.innerHTML = `
      <div class="manga-grid">${state.sourceMangas.map((m) => `
        <div class="manga-card" data-manga-id="${m.id}">
          <div class="manga-cover-wrap">
            <img src="${esc(m.thumbnailUrl || '')}" alt="" loading="lazy">
            <div class="manga-cover-grad"></div>
            ${m.inLibrary ? '<span class="manga-badge in-lib">En biblioteca</span>' : ''}
            <div class="manga-card-title">${esc(m.title)}</div>
          </div>
        </div>
      `).join('')}</div>
      ${state.sourceHasNext ? '<div style="margin-top:14px"><button id="srcLoadMore" class="secondary-btn" style="width:100%">Cargar más</button></div>' : ''}
    `;
    mainContent.querySelectorAll('.manga-card').forEach((card) => {
      card.addEventListener('click', () => navigateHash('#manga/' + card.dataset.mangaId));
    });
    const more = $('srcLoadMore');
    if (more) {
      more.addEventListener('click', () => {
        more.disabled = true;
        more.textContent = 'Cargando...';
        state.sourcePage += 1;
        loadSourcePage();
      });
    }
  }

  // --- AJUSTES ---
  async function renderSettings() {
    headerTitle.textContent = 'Ajustes';
    headerActions.innerHTML = '';
    headerSub.classList.add('hidden');
    const p = state.prefs;

    await refreshDownloadsIndex();
    const allDl = Offline ? await Offline.listDownloads() : [];
    const pendingSyncs = Offline ? await Offline.getPendingSyncs() : [];
    const totalBytes = allDl.reduce((acc, d) => acc + (d.bytes || 0), 0);

    // Agrupar descargas por manga para gestión de almacenamiento
    const byManga = new Map();
    for (const d of allDl) {
      const cur = byManga.get(d.mangaId) || { mangaId: d.mangaId, title: d.mangaTitle || `Manga #${d.mangaId}`, count: 0, bytes: 0 };
      cur.count += 1;
      cur.bytes += (d.bytes || 0);
      byManga.set(d.mangaId, cur);
    }
    const mangaGroups = Array.from(byManga.values()).sort((a, b) => b.bytes - a.bytes);

    mainContent.innerHTML = `
      <div class="settings-card">
        <div style="font-size:14px;font-weight:700;margin-bottom:4px">Descargas sin conexión (tipo Spotify)</div>
        <div style="font-size:13px;color:var(--muted);margin-bottom:10px">
          ${allDl.length} capítulo(s) en este móvil · <strong>${Offline ? Offline.formatBytes(totalBytes) : '0 B'}</strong>
          ${pendingSyncs.length ? `<br><span style="color:#f6d57a">${pendingSyncs.length} lectura(s) offline pendientes de sincronizar con tu PC.</span>` : ''}
        </div>
        ${mangaGroups.length ? mangaGroups.map((g) => `
          <div class="dl-storage-row">
            <div style="min-width:0;flex:1">
              <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(g.title)}</div>
              <div style="font-size:11.5px;color:var(--muted)">${g.count} cap. · ${Offline.formatBytes(g.bytes)}</div>
            </div>
            <button class="secondary-btn" data-del-manga-dl="${g.mangaId}" type="button" style="padding:6px 10px;font-size:12px">Borrar</button>
          </div>
        `).join('') : '<p style="margin:0 0 6px;font-size:12.5px;color:var(--muted)">Abre un manga y pulsa el icono ↓ junto a cada capítulo (o "↓ Sig. 5") para descargarlo en tu móvil y leerlo aunque el PC esté apagado.</p>'}
        ${allDl.length ? '<button id="delAllDlBtn" class="secondary-btn" type="button" style="width:100%;margin-top:10px;color:#ff8690;border-color:rgba(255,77,90,0.35)">Borrar todas las descargas</button>' : ''}
      </div>

      <div class="settings-card">
        <div class="setting-group">
          <span class="setting-label">Modo de lectura por defecto</span>
          <div class="seg-control">
            <button class="seg-btn ${p.mode === 'vertical' ? 'active' : ''}" data-pref-mode="vertical">Continuo (PDF)</button>
            <button class="seg-btn ${p.mode === 'rtl' ? 'active' : ''}" data-pref-mode="rtl">Manga D→I</button>
            <button class="seg-btn ${p.mode === 'ltr' ? 'active' : ''}" data-pref-mode="ltr">Paginado I→D</button>
          </div>
        </div>

        <div class="setting-group">
          <span class="setting-label">Ajuste de imagen</span>
          <div class="seg-control two">
            <button class="seg-btn ${p.fit === 'width' ? 'active' : ''}" data-pref-fit="width">Ancho del móvil</button>
            <button class="seg-btn ${p.fit === 'screen' ? 'active' : ''}" data-pref-fit="screen">Ajustar pantalla</button>
          </div>
        </div>

        <div class="setting-group">
          <span class="setting-label">Espacio entre páginas</span>
          <div class="seg-control two">
            <button class="seg-btn ${!p.gap ? 'active' : ''}" data-pref-gap="0">Sin espacio (PDF)</button>
            <button class="seg-btn ${p.gap ? 'active' : ''}" data-pref-gap="1">Con separación</button>
          </div>
        </div>

        <div class="setting-group" style="margin-bottom:0">
          <span class="setting-label">Filtro nocturno (oscurecer lector): <strong id="setDimVal">${p.dim}%</strong></span>
          <input id="setDimSlider" type="range" min="0" max="70" step="5" value="${p.dim}" style="width:100%;accent-color:var(--accent)">
        </div>
      </div>

      <div class="settings-card">
        <div style="font-size:14px;font-weight:700;margin-bottom:6px">App en tu móvil</div>
        ${isStandaloneApp()
          ? '<p style="margin:0 0 12px;font-size:13px;color:var(--green);line-height:1.45"><strong>✓ Ya estás usando la app instalada.</strong> Se abre directo en tu móvil sin volver a escanear el QR.</p>'
          : `<p style="margin:0 0 12px;font-size:13px;color:var(--muted);line-height:1.45">
               Instálala una sola vez para tener el icono en tu móvil, leer a pantalla completa y no volver a escanear el QR.
             </p>
             <button id="settingsInstallBtn" class="primary-btn" type="button" style="margin-bottom:10px">
               ${deferredInstallPrompt ? 'Instalar app ahora' : 'Cómo instalar en pantalla de inicio'}
             </button>`}
        <a href="/" class="secondary-btn" style="display:block;text-align:center;text-decoration:none;margin-bottom:10px">
          Abrir Suwayomi completo (instalar extensiones)
        </a>
        <button id="settingsClearHistBtn" class="secondary-btn" type="button" style="width:100%;color:#ff8690;border-color:rgba(255,77,90,0.35)">
          Borrar historial de lectura
        </button>
      </div>
    `;

    mainContent.querySelectorAll('[data-del-manga-dl]').forEach((b) => {
      b.addEventListener('click', async () => {
        if (!confirm('¿Borrar las descargas de este manga en tu móvil?')) return;
        await Offline.deleteMangaDownloads(Number(b.dataset.delMangaDl));
        await refreshDownloadsIndex();
        showToast('Descargas borradas');
        renderSettings();
      });
    });
    const delAll = $('delAllDlBtn');
    if (delAll) {
      delAll.addEventListener('click', async () => {
        if (!confirm('¿Borrar TODOS los capítulos descargados de tu móvil?')) return;
        await Offline.deleteAllDownloads();
        await refreshDownloadsIndex();
        showToast('Todas las descargas borradas');
        renderSettings();
      });
    }

    mainContent.querySelectorAll('[data-pref-mode]').forEach((b) => {
      b.addEventListener('click', () => { state.prefs.mode = b.dataset.prefMode; savePrefs(); renderSettings(); });
    });
    mainContent.querySelectorAll('[data-pref-fit]').forEach((b) => {
      b.addEventListener('click', () => { state.prefs.fit = b.dataset.prefFit; savePrefs(); renderSettings(); });
    });
    mainContent.querySelectorAll('[data-pref-gap]').forEach((b) => {
      b.addEventListener('click', () => { state.prefs.gap = b.dataset.prefGap === '1'; savePrefs(); renderSettings(); });
    });
    $('setDimSlider').addEventListener('input', (e) => {
      state.prefs.dim = parseInt(e.target.value, 10) || 0;
      $('setDimVal').textContent = state.prefs.dim + '%';
      savePrefs();
    });
    const instBtn = $('settingsInstallBtn');
    if (instBtn) instBtn.addEventListener('click', triggerInstallApp);
    const clrHistBtn = $('settingsClearHistBtn');
    if (clrHistBtn) clrHistBtn.addEventListener('click', runClearHistory);
  }

  // ---------------- Detalle de Manga ----------------
  async function openMangaDetail(mangaId, forceFetch = false) {
    mangaView.classList.remove('hidden');
    mangaView.innerHTML = '<div style="padding-top:80px"><div class="spinner"></div></div>';
    await refreshDownloadsIndex();

    try {
      let data = await gql(Q_MANGA_DETAIL, { id: mangaId }, 8000);
      let manga = data.manga;
      let chapters = (data.chapters && data.chapters.nodes) || [];

      if (forceFetch || !manga.initialized || !chapters.length) {
        const refreshed = await gql(M_REFRESH_MANGA, { id: mangaId, fetchManga: true, fetchChapters: true }, 20000);
        if (refreshed.fetchMangaAndChapters) {
          if (refreshed.fetchMangaAndChapters.manga) manga = refreshed.fetchMangaAndChapters.manga;
          if (refreshed.fetchMangaAndChapters.chapters) chapters = refreshed.fetchMangaAndChapters.chapters;
        }
      }

      setOfflineMode(false);
      state.manga = manga;
      state.mangaChapters = chapters;
      if (Offline) {
        Offline.saveMangaDetail(manga, chapters);
        Offline.cacheCover(manga.id, manga.thumbnailUrl);
      }
      drawMangaDetail();
    } catch {
      setOfflineMode(true);
      const cached = Offline ? await Offline.getMangaDetail(mangaId) : null;
      if (cached && cached.manga) {
        state.manga = cached.manga;
        state.mangaChapters = cached.chapters || [];
        drawMangaDetail();
      } else {
        mangaView.innerHTML = `
          <div class="empty-state" style="padding-top:80px">
            <h3>Sin conexión con el PC</h3>
            <p>Este manga no está guardado en tu móvil. Conéctate al PC para abrirlo o descargar capítulos.</p>
            <button id="mangaErrBack" class="secondary-btn">Volver</button>
          </div>
        `;
        $('mangaErrBack').addEventListener('click', () => history.back());
      }
    }
  }

  function pickResumeChapter(chapters) {
    if (!chapters.length) return null;
    const pool = state.offline ? chapters.filter((c) => isDownloaded(c.id)) : chapters;
    if (!pool.length) return null;

    const asc = pool.slice().sort((a, b) => a.sourceOrder - b.sourceOrder);
    const inProg = asc.filter((c) => !c.isRead && (c.lastPageRead || 0) > 0)
      .sort((a, b) => Number(b.lastReadAt || 0) - Number(a.lastReadAt || 0));
    if (inProg.length) return { chap: inProg[0], label: `Continuar: ${inProg[0].name}` };
    const firstUnread = asc.find((c) => !c.isRead);
    if (firstUnread) {
      const anyRead = asc.some((c) => c.isRead);
      return { chap: firstUnread, label: `${anyRead ? 'Continuar' : 'Empezar'}: ${firstUnread.name}` };
    }
    const last = asc[asc.length - 1];
    return { chap: last, label: `Releer: ${last.name}` };
  }

  function chapterDlButtonHtml(c) {
    const dl = isDownloaded(c.id);
    if (dl) {
      return `<button class="chap-dl-btn done" data-dl-id="${c.id}" type="button" title="Descargado (toca para borrar)">✓</button>`;
    }
    if (state.activeDownload && state.activeDownload.chapterId === c.id) {
      const txt = state.activeDownload.total > 0
        ? `${state.activeDownload.done}/${state.activeDownload.total}`
        : '...';
      return `<button class="chap-dl-btn busy" data-dl-id="${c.id}" type="button" disabled>${txt}</button>`;
    }
    if (state.downloadQueue.some((q) => q.chapter.id === c.id)) {
      return `<button class="chap-dl-btn busy" data-dl-id="${c.id}" type="button" disabled>Cola</button>`;
    }
    if (state.offline) {
      return `<button class="chap-dl-btn" data-dl-id="${c.id}" type="button" disabled title="No descargado">—</button>`;
    }
    return `<button class="chap-dl-btn" data-dl-id="${c.id}" type="button" title="Descargar para leer sin conexión">↓</button>`;
  }

  function drawMangaDetail() {
    const m = state.manga;
    const resume = pickResumeChapter(state.mangaChapters);
    const dlCount = state.mangaChapters.filter((c) => isDownloaded(c.id)).length;
    const filtered = state.mangaChapters
      .filter((c) => {
        if (state.chapterFilter === 'unread') return !c.isRead;
        if (state.chapterFilter === 'downloaded') return isDownloaded(c.id);
        return true;
      })
      .slice()
      .sort((a, b) => (state.chapterDesc ? b.sourceOrder - a.sourceOrder : a.sourceOrder - b.sourceOrder));

    const metaParts = [];
    if (m.author) metaParts.push(m.author);
    if (m.source && m.source.name) metaParts.push(m.source.name);
    if (m.status) metaParts.push(m.status);

    const cover = coverUrlFor(m);

    mangaView.innerHTML = `
      <div class="manga-hero">
        <div class="manga-hero-bg" style="background-image:url('${esc(cover)}')"></div>
        <div class="manga-hero-fade"></div>
        <div class="manga-hero-inner">
          <div class="manga-hero-top">
            <button id="detailBackBtn" class="icon-btn" type="button" aria-label="Volver">
              <svg viewBox="0 0 24 24"><path d="M15.4 7.4 14 6l-6 6 6 6 1.4-1.4L10.8 12z"/></svg>
            </button>
            <div style="display:flex;gap:8px">
              ${!state.offline ? `<button id="detailBatchDlBtn" class="secondary-btn" type="button" style="padding:6px 11px;font-size:12px">↓ Sig. 5</button>` : ''}
              ${!state.offline ? `<button id="detailRefreshBtn" class="icon-btn" type="button" aria-label="Actualizar capítulos">
                <svg viewBox="0 0 24 24"><path d="M17.6 6.4A8 8 0 1 0 20 12h-2a6 6 0 1 1-1.8-4.2L13 11h7V4l-2.4 2.4z"/></svg>
              </button>` : ''}
            </div>
          </div>
          <div class="manga-hero-main">
            <img class="manga-hero-cover" src="${esc(cover)}" data-cover-id="${m.id}" alt="">
            <div class="manga-hero-meta">
              <h2 class="manga-hero-title">${esc(m.title)}</h2>
              <div class="manga-hero-sub">${esc(metaParts.join(' · '))}</div>
              ${dlCount > 0 ? `<div style="margin-top:5px;font-size:11.5px;color:var(--green);font-weight:600">↓ ${dlCount} capítulo(s) descargados en este móvil</div>` : ''}
            </div>
          </div>
        </div>
      </div>

      <div class="manga-actions-bar">
        ${resume
          ? `<button id="detailResumeBtn" class="primary-btn" style="flex:1">${esc(resume.label)}</button>`
          : (state.offline ? '<button class="secondary-btn" style="flex:1;opacity:0.6" disabled>Sin capítulos descargados</button>' : '')}
        ${!state.offline ? `<button id="detailLibBtn" class="secondary-btn" type="button" style="${m.inLibrary ? 'border-color:var(--green);color:var(--green)' : ''}">
          ${m.inLibrary ? '✓ En biblioteca' : '+ Biblioteca'}
        </button>` : ''}
      </div>

      ${m.description ? `<div id="detailDesc" class="manga-desc clamped">${esc(m.description)}</div>` : ''}

      <div class="chapters-head">
        <strong>${filtered.length} cap.</strong>
        <div style="display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end">
          <button id="chapFilterDl" class="chip ${state.chapterFilter === 'downloaded' ? 'active' : ''}" type="button">↓ (${dlCount})</button>
          <button id="chapFilterBtn" class="chip ${state.chapterFilter === 'unread' ? 'active' : ''}" type="button">Sin leer</button>
          <button id="chapSortBtn" class="chip" type="button">${state.chapterDesc ? '↓ Nuevos' : '↑ Antiguos'}</button>
        </div>
      </div>

      <div id="chaptersList">
        ${filtered.length ? filtered.map((c) => {
          const dl = isDownloaded(c.id);
          const locked = state.offline && !dl;
          return `
            <div class="chapter-row ${c.isRead ? 'read' : ''} ${locked ? 'offline-locked' : ''}" data-chap-id="${c.id}">
              <span class="chapter-dot"></span>
              <div class="chapter-info">
                <div class="chapter-name">${esc(c.name)}</div>
                <div class="chapter-meta">
                  ${[
                    dl ? 'Descargado' : (locked ? 'Solo con PC' : ''),
                    formatDate(c.uploadDate),
                    c.scanlator,
                    (!c.isRead && c.lastPageRead > 0 ? `Pág. ${c.lastPageRead + 1}` : '')
                  ].filter(Boolean).join(' · ')}
                </div>
              </div>
              ${chapterDlButtonHtml(c)}
            </div>
          `;
        }).join('') : '<div class="empty-state"><p>No hay capítulos con este filtro.</p></div>'}
      </div>
    `;

    attachCoverFallbacks(mangaView);

    $('detailBackBtn').addEventListener('click', () => {
      if (history.length > 1) history.back();
      else navigateHash('#' + state.tab);
    });
    const refBtn = $('detailRefreshBtn');
    if (refBtn) {
      refBtn.addEventListener('click', () => {
        showToast('Actualizando capítulos...');
        openMangaDetail(m.id, true);
      });
    }
    const batchBtn = $('detailBatchDlBtn');
    if (batchBtn) {
      batchBtn.addEventListener('click', () => {
        const asc = state.mangaChapters.slice().sort((a, b) => a.sourceOrder - b.sourceOrder);
        const candidates = asc.filter((c) => !c.isRead && !isDownloaded(c.id)).slice(0, 5);
        const toQueue = candidates.length ? candidates : asc.filter((c) => !isDownloaded(c.id)).slice(0, 5);
        if (!toQueue.length) {
          showToast('Todos los capítulos ya están descargados');
          return;
        }
        toQueue.forEach((c) => enqueueChapterDownload(m, state.mangaChapters, c));
        showToast(`Añadidos ${toQueue.length} capítulo(s) a descargas`);
      });
    }

    const desc = $('detailDesc');
    if (desc) desc.addEventListener('click', () => desc.classList.toggle('clamped'));

    const resumeBtn = $('detailResumeBtn');
    if (resumeBtn && resume) {
      resumeBtn.addEventListener('click', () => navigateHash(`#read/${m.id}/${resume.chap.id}`));
    }

    const libBtn = $('detailLibBtn');
    if (libBtn) {
      libBtn.addEventListener('click', async () => {
        try {
          const nextVal = !m.inLibrary;
          await gql(M_UPDATE_MANGA, { id: m.id, inLibrary: nextVal });
          m.inLibrary = nextVal;
          state.library = [];
          showToast(nextVal ? 'Añadido a tu biblioteca' : 'Quitado de tu biblioteca');
          drawMangaDetail();
        } catch {
          showToast('No se pudo actualizar la biblioteca');
        }
      });
    }

    $('chapFilterDl').addEventListener('click', () => {
      state.chapterFilter = state.chapterFilter === 'downloaded' ? 'all' : 'downloaded';
      drawMangaDetail();
    });
    $('chapFilterBtn').addEventListener('click', () => {
      state.chapterFilter = state.chapterFilter === 'unread' ? 'all' : 'unread';
      drawMangaDetail();
    });
    $('chapSortBtn').addEventListener('click', () => {
      state.chapterDesc = !state.chapterDesc;
      drawMangaDetail();
    });

    mangaView.querySelectorAll('.chap-dl-btn').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const cId = Number(btn.dataset.dlId);
        const chap = state.mangaChapters.find((x) => x.id === cId);
        if (!chap) return;
        if (isDownloaded(cId)) {
          if (confirm(`¿Borrar la descarga local de "${chap.name}"?`)) {
            await Offline.deleteDownload(cId);
            await refreshDownloadsIndex();
            showToast('Descarga borrada');
            drawMangaDetail();
          }
          return;
        }
        enqueueChapterDownload(m, state.mangaChapters, chap);
      });
    });

    mangaView.querySelectorAll('.chapter-row').forEach((row) => {
      row.addEventListener('click', () => {
        const cId = Number(row.dataset.chapId);
        if (state.offline && !isDownloaded(cId)) {
          showToast('No descargado. Conéctate al PC para leer o descargar este capítulo.');
          return;
        }
        navigateHash(`#read/${m.id}/${cId}`);
      });
    });
  }

  // ---------------- Lector estilo Manga Dogs (Online y Sin Conexión) ----------------
  function revokeReaderBlobs() {
    if (state.reader.blobUrls && state.reader.blobUrls.length) {
      state.reader.blobUrls.forEach((u) => URL.revokeObjectURL(u));
      state.reader.blobUrls = [];
    }
  }

  async function openReader(mangaId, chapterId) {
    const r = state.reader;
    revokeReaderBlobs();
    r.open = true;
    r.lastSavedPage = -1;
    r.markedRead = false;
    r.preloadedChapId = null;
    closeReaderSheet();
    await refreshDownloadsIndex();

    readerView.classList.remove('hidden');
    applyReaderVisualPrefs();
    setReaderChrome(true);
    readerStage.innerHTML = '<div style="padding-top:40vh"><div class="spinner"></div></div>';

    try {
      // Asegurar manga + lista de capítulos (desde red o caché offline)
      if (!state.manga || state.manga.id !== mangaId || !state.mangaChapters.length) {
        try {
          const d = await gql(Q_MANGA_DETAIL, { id: mangaId }, 7000);
          state.manga = d.manga;
          state.mangaChapters = (d.chapters && d.chapters.nodes) || [];
          if (Offline) Offline.saveMangaDetail(state.manga, state.mangaChapters);
        } catch {
          setOfflineMode(true);
          const cached = Offline ? await Offline.getMangaDetail(mangaId) : null;
          if (cached) {
            state.manga = cached.manga;
            state.mangaChapters = cached.chapters || [];
          }
        }
      }

      r.manga = state.manga;
      r.chapters = state.mangaChapters.slice().sort((a, b) => a.sourceOrder - b.sourceOrder);
      r.chapIdx = Math.max(0, r.chapters.findIndex((c) => c.id === chapterId));
      const chap = r.chapters[r.chapIdx];

      readerMangaTitle.textContent = r.manga ? r.manga.title : 'Manga';
      readerChapterTitle.textContent = chap ? chap.name : '';
      readerPrevChap.disabled = r.chapIdx <= 0;
      readerNextChap.disabled = r.chapIdx >= r.chapters.length - 1;

      // 1) Intentar primero desde descargas locales (instantáneo y 100% offline)
      let pages = Offline ? await Offline.loadDownloadedPageBlobUrls(chapterId) : null;
      if (pages && pages.length) {
        r.blobUrls = pages;
      } else {
        // 2) No está descargado -> requiere conexión con el PC
        if (state.offline) {
          throw new Error('OFFLINE_NOT_DOWNLOADED');
        }
        try {
          const pgData = await gql(M_FETCH_PAGES, { chapterId }, 25000);
          pages = (pgData.fetchChapterPages && pgData.fetchChapterPages.pages) || [];
        } catch {
          setOfflineMode(true);
          throw new Error('OFFLINE_NOT_DOWNLOADED');
        }
      }

      r.pages = pages || [];

      if (!r.pages.length) {
        readerStage.innerHTML = `
          <div class="empty-state" style="padding-top:34vh">
            <h3>No se pudieron cargar las páginas</h3>
            <p>La fuente puede estar saturada o tardando en responder.</p>
            <button id="retryPagesBtn" class="primary-btn" style="max-width:220px">Reintentar</button>
          </div>
        `;
        $('retryPagesBtn').addEventListener('click', () => openReader(mangaId, chapterId));
        return;
      }

      const startPage = (chap && !chap.isRead && chap.lastPageRead > 0 && chap.lastPageRead < r.pages.length)
        ? chap.lastPageRead
        : 0;
      r.pageIdx = startPage;
      r.markedRead = !!(chap && chap.isRead);

      readerSlider.min = '1';
      readerSlider.max = String(r.pages.length);
      readerSlider.value = String(r.pageIdx + 1);
      readerPageTotal.textContent = String(r.pages.length);

      renderReaderPages();
      setTimeout(() => { if (r.open) setReaderChrome(false); }, 1400);
    } catch (err) {
      const notDl = err && err.message === 'OFFLINE_NOT_DOWNLOADED';
      readerStage.innerHTML = `
        <div class="empty-state" style="padding-top:34vh">
          <h3>${notDl ? 'Capítulo no descargado' : 'Error al cargar el capítulo'}</h3>
          <p>${notDl
            ? 'El servidor está apagado o sin conexión. Solo puedes leer los capítulos que hayas descargado previamente en tu móvil.'
            : esc(err.message || '')}</p>
          <button id="readerErrBack" class="primary-btn" style="max-width:220px">Volver</button>
        </div>
      `;
      $('readerErrBack').addEventListener('click', () => {
        if (history.length > 1) history.back();
        else navigateHash('#library');
      });
    }
  }

  function closeReaderUi() {
    const r = state.reader;
    r.open = false;
    if (r.observer) { r.observer.disconnect(); r.observer = null; }
    revokeReaderBlobs();
    closeReaderSheet();
    readerView.classList.add('hidden');
    readerStage.innerHTML = '';
    if (state.manga && !mangaView.classList.contains('hidden')) {
      drawMangaDetail();
    }
  }

  function applyReaderVisualPrefs() {
    const p = state.prefs;
    readerDimmer.style.opacity = String((p.dim || 0) / 100);
    readerModeQuick.textContent = modeLabel(p.mode);
    readerMiniStatus.classList.toggle('hidden', !p.miniStatus);
  }

  function setReaderChrome(visible) {
    state.reader.chromeVisible = visible;
    readerView.classList.toggle('chrome-hidden', !visible);
  }

  function updatePageUi(idx) {
    const r = state.reader;
    if (!r.pages.length) return;
    r.pageIdx = Math.max(0, Math.min(r.pages.length - 1, idx));
    readerSlider.value = String(r.pageIdx + 1);
    readerPageNow.textContent = String(r.pageIdx + 1);
    const chap = r.chapters[r.chapIdx];
    const chapShort = chap && chap.chapterNumber >= 0 ? `Cap. ${chap.chapterNumber}` : '';
    readerMiniStatus.textContent = `${chapShort ? chapShort + ' · ' : ''}${r.pageIdx + 1}/${r.pages.length}`;

    syncProgressToServer(r.pageIdx);

    if (state.prefs.mode === 'vertical') {
      for (let k = 1; k <= 6; k++) {
        const nextImg = readerStage.querySelector(`.reader-page-slot[data-page="${r.pageIdx + k}"] img`);
        if (nextImg && nextImg.loading === 'lazy') nextImg.loading = 'eager';
      }
    }

    if (!state.offline && r.pageIdx >= Math.floor(r.pages.length * 0.8) && r.chapIdx < r.chapters.length - 1) {
      const nextChap = r.chapters[r.chapIdx + 1];
      if (nextChap && !isDownloaded(nextChap.id) && r.preloadedChapId !== nextChap.id) {
        r.preloadedChapId = nextChap.id;
        gql(M_FETCH_PAGES, { chapterId: nextChap.id }).catch(() => { });
      }
    }
  }

  let syncTimer = null;
  function syncProgressToServer(pageIdx) {
    const r = state.reader;
    const chap = r.chapters[r.chapIdx];
    if (!chap) return;

    const reachedEnd = pageIdx >= r.pages.length - 1;
    if (!reachedEnd && pageIdx === r.lastSavedPage) return;

    chap.lastPageRead = pageIdx;
    if (reachedEnd) chap.isRead = true;

    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      const patch = { lastPageRead: pageIdx };
      if (reachedEnd && !r.markedRead) {
        patch.isRead = true;
        r.markedRead = true;
      }
      r.lastSavedPage = pageIdx;

      if (Offline && r.manga) {
        Offline.updateLocalChapterProgress(r.manga.id, chap.id, patch);
      }

      if (state.offline) {
        if (Offline) Offline.queueProgress(chap.id, patch);
      } else {
        gql(M_UPDATE_CHAPTER, { id: chap.id, patch }, 6000).catch(() => {
          if (Offline) Offline.queueProgress(chap.id, patch);
        });
      }
    }, reachedEnd ? 150 : 650);
  }

  function renderReaderPages() {
    const r = state.reader;
    const p = state.prefs;
    if (r.observer) { r.observer.disconnect(); r.observer = null; }

    readerStage.className = 'reader-stage' + (p.mode === 'vertical' ? '' : ' paged');
    readerStage.scrollTop = 0;

    if (p.mode === 'vertical') {
      renderVerticalReader();
    } else {
      renderPagedReader();
    }
    updatePageUi(r.pageIdx);
  }

  function createPageImg(url, pageNum) {
    const img = document.createElement('img');
    img.className = state.prefs.mode === 'vertical' ? 'reader-page-img' : 'reader-paged-img';
    img.decoding = 'async';
    img.alt = `Página ${pageNum + 1}`;
    img.src = url;
    return img;
  }

  function renderVerticalReader() {
    const r = state.reader;
    const p = state.prefs;
    const list = document.createElement('div');
    list.className = 'reader-vertical-list' + (p.gap ? ' with-gap' : '') + (p.fit === 'screen' ? ' fit-screen' : '');

    const slots = r.pages.map((url, idx) => {
      const slot = document.createElement('div');
      slot.className = 'reader-page-slot';
      slot.dataset.page = String(idx);
      const loader = document.createElement('div');
      loader.className = 'reader-page-loader';
      loader.textContent = `Página ${idx + 1}...`;
      slot.appendChild(loader);

      const img = createPageImg(url, idx);
      img.loading = idx < 6 ? 'eager' : 'lazy';
      img.addEventListener('load', () => {
        loader.remove();
        slot.classList.add('loaded');
      });
      img.addEventListener('error', () => {
        loader.innerHTML = `Error cargando página ${idx + 1}. <u style="color:var(--accent)">Tocar para reintentar</u>`;
        loader.onclick = (e) => {
          e.stopPropagation();
          loader.textContent = `Reintentando página ${idx + 1}...`;
          img.src = url.startsWith('blob:') ? url : (url + (url.includes('?') ? '&' : '?') + 'r=' + Date.now());
        };
      });
      slot.appendChild(img);
      list.appendChild(slot);
      return slot;
    });

    const nextChap = r.chapIdx < r.chapters.length - 1 ? r.chapters[r.chapIdx + 1] : null;
    const prevChap = r.chapIdx > 0 ? r.chapters[r.chapIdx - 1] : null;
    const nextLocked = nextChap && state.offline && !isDownloaded(nextChap.id);

    const endCard = document.createElement('div');
    endCard.className = 'reader-end-card';
    endCard.innerHTML = `
      <div class="reader-end-title">Fin de ${esc(r.chapters[r.chapIdx] ? r.chapters[r.chapIdx].name : 'capítulo')}</div>
      <div class="reader-end-btns">
        ${prevChap ? '<button id="endPrevBtn" class="secondary-btn" type="button">‹ Anterior</button>' : ''}
        ${nextChap
          ? (nextLocked
            ? '<button id="endBackBtn" class="secondary-btn" type="button" style="flex:1">Siguiente no descargado · Volver</button>'
            : `<button id="endNextBtn" class="primary-btn" type="button" style="flex:1">Siguiente: ${esc(nextChap.name)} ›</button>`)
          : '<button id="endBackBtn" class="primary-btn" type="button" style="flex:1">Volver al manga</button>'}
      </div>
    `;
    list.appendChild(endCard);

    readerStage.innerHTML = '';
    readerStage.appendChild(list);

    const endPrev = $('endPrevBtn');
    if (endPrev && prevChap) endPrev.addEventListener('click', (e) => { e.stopPropagation(); switchChapter(r.chapIdx - 1); });
    const endNext = $('endNextBtn');
    if (endNext && nextChap) endNext.addEventListener('click', (e) => { e.stopPropagation(); switchChapter(r.chapIdx + 1); });
    const endBack = $('endBackBtn');
    if (endBack) endBack.addEventListener('click', (e) => { e.stopPropagation(); history.back(); });

    r.observer = new IntersectionObserver((entries) => {
      let bestIdx = -1;
      let bestRatio = 0;
      for (const en of entries) {
        if (en.isIntersecting && en.intersectionRatio >= bestRatio) {
          bestRatio = en.intersectionRatio;
          bestIdx = parseInt(en.target.dataset.page, 10);
        }
      }
      if (bestIdx >= 0) updatePageUi(bestIdx);
    }, { root: readerStage, threshold: [0.15, 0.5, 0.8] });

    slots.forEach((s) => r.observer.observe(s));

    if (r.pageIdx > 0 && slots[r.pageIdx]) {
      setTimeout(() => slots[r.pageIdx].scrollIntoView({ behavior: 'auto', block: 'start' }), 60);
    }
  }

  function renderPagedReader() {
    const r = state.reader;
    const url = r.pages[r.pageIdx];
    const wrap = document.createElement('div');
    wrap.className = 'reader-paged-wrap' + (state.prefs.fit === 'width' ? ' fit-width' : '');

    const loader = document.createElement('div');
    loader.className = 'reader-page-loader';
    loader.innerHTML = '<div class="spinner"></div><div>Cargando página...</div>';
    wrap.appendChild(loader);

    const img = createPageImg(url, r.pageIdx);
    img.style.display = 'none';
    img.addEventListener('load', () => {
      loader.remove();
      img.style.display = 'block';
    });
    img.addEventListener('error', () => {
      loader.innerHTML = 'Error cargando la página. <u style="color:var(--accent)">Tocar para reintentar</u>';
      loader.onclick = (e) => {
        e.stopPropagation();
        loader.innerHTML = '<div class="spinner"></div><div>Reintentando...</div>';
        img.src = url.startsWith('blob:') ? url : (url + (url.includes('?') ? '&' : '?') + 'r=' + Date.now());
      };
    });
    wrap.appendChild(img);
    readerStage.innerHTML = '';
    readerStage.appendChild(wrap);

    for (let k = 1; k <= 2; k++) {
      if (r.pageIdx + k < r.pages.length) {
        const pre = new Image();
        pre.src = r.pages[r.pageIdx + k];
      }
    }
  }

  function goToPage(idx) {
    const r = state.reader;
    if (!r.pages.length) return;
    if (idx < 0) {
      if (r.chapIdx > 0) switchChapter(r.chapIdx - 1);
      else showToast('Ya estás en el primer capítulo');
      return;
    }
    if (idx >= r.pages.length) {
      if (r.chapIdx < r.chapters.length - 1) switchChapter(r.chapIdx + 1);
      else showToast('Has llegado al último capítulo');
      return;
    }
    r.pageIdx = idx;
    if (state.prefs.mode === 'vertical') {
      const slot = readerStage.querySelector(`.reader-page-slot[data-page="${idx}"]`);
      if (slot) slot.scrollIntoView({ behavior: 'auto', block: 'start' });
      updatePageUi(idx);
    } else {
      renderPagedReader();
      updatePageUi(idx);
    }
  }

  function switchChapter(newIdx) {
    const r = state.reader;
    if (newIdx < 0 || newIdx >= r.chapters.length || !r.manga) return;
    const target = r.chapters[newIdx];
    if (state.offline && !isDownloaded(target.id)) {
      showToast('Ese capítulo no está descargado en tu móvil');
      return;
    }
    location.replace(`#read/${r.manga.id}/${target.id}`);
  }

  // Gestos del lector
  readerStage.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    state.reader.touchStartX = e.touches[0].clientX;
    state.reader.touchStartY = e.touches[0].clientY;
    state.reader.touchMoved = false;
  }, { passive: true });

  readerStage.addEventListener('touchmove', (e) => {
    if (e.touches.length !== 1) return;
    const dx = Math.abs(e.touches[0].clientX - state.reader.touchStartX);
    const dy = Math.abs(e.touches[0].clientY - state.reader.touchStartY);
    if (dx > 12 || dy > 12) state.reader.touchMoved = true;
  }, { passive: true });

  readerStage.addEventListener('touchend', (e) => {
    if (state.prefs.mode === 'vertical') return;
    if (window.visualViewport && window.visualViewport.scale > 1.05) return;
    if (!e.changedTouches.length) return;
    const dx = e.changedTouches[0].clientX - state.reader.touchStartX;
    const dy = e.changedTouches[0].clientY - state.reader.touchStartY;
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      const forward = state.prefs.mode === 'rtl' ? (dx > 0) : (dx < 0);
      goToPage(state.reader.pageIdx + (forward ? 1 : -1));
    }
  }, { passive: true });

  readerStage.addEventListener('click', (e) => {
    if (state.reader.touchMoved) { state.reader.touchMoved = false; return; }
    if (e.target.closest('button, a')) return;

    const w = window.innerWidth;
    const x = e.clientX;
    if (state.prefs.mode === 'vertical') {
      setReaderChrome(!state.reader.chromeVisible);
      return;
    }

    if (x < w * 0.28) {
      const delta = state.prefs.mode === 'rtl' ? 1 : -1;
      goToPage(state.reader.pageIdx + delta);
    } else if (x > w * 0.72) {
      const delta = state.prefs.mode === 'rtl' ? -1 : 1;
      goToPage(state.reader.pageIdx + delta);
    } else {
      setReaderChrome(!state.reader.chromeVisible);
    }
  });

  // Controles de las barras del lector
  $('readerBackBtn').addEventListener('click', () => {
    if (history.length > 1) history.back();
    else if (state.reader.manga) navigateHash('#manga/' + state.reader.manga.id);
    else navigateHash('#library');
  });

  readerPrevChap.addEventListener('click', () => switchChapter(state.reader.chapIdx - 1));
  readerNextChap.addEventListener('click', () => switchChapter(state.reader.chapIdx + 1));

  readerSlider.addEventListener('input', () => {
    const val = parseInt(readerSlider.value, 10) - 1;
    readerPageNow.textContent = String(val + 1);
  });
  readerSlider.addEventListener('change', () => {
    const val = parseInt(readerSlider.value, 10) - 1;
    goToPage(val);
  });

  readerModeQuick.addEventListener('click', () => {
    const order = ['vertical', 'rtl', 'ltr'];
    const next = order[(order.indexOf(state.prefs.mode) + 1) % order.length];
    state.prefs.mode = next;
    savePrefs();
    applyReaderVisualPrefs();
    renderReaderPages();
    showToast('Modo: ' + modeLabel(next));
  });

  $('readerSettingsBtn').addEventListener('click', openReaderSettingsSheet);
  $('readerChaptersBtn').addEventListener('click', openReaderChaptersSheet);
  readerSheetBackdrop.addEventListener('click', closeReaderSheet);

  function closeReaderSheet() {
    readerSheetBackdrop.classList.add('hidden');
    readerSheet.classList.add('hidden');
  }

  function openReaderSettingsSheet() {
    const p = state.prefs;
    readerSheetBackdrop.classList.remove('hidden');
    readerSheet.classList.remove('hidden');
    readerSheet.innerHTML = `
      <div class="sheet-title">
        <span>Opciones de lectura</span>
        <button id="closeSheetBtn" class="secondary-btn" type="button" style="padding:5px 10px;font-size:12px">Cerrar</button>
      </div>

      <div class="setting-group">
        <span class="setting-label">Modo de lectura</span>
        <div class="seg-control">
          <button class="seg-btn ${p.mode === 'vertical' ? 'active' : ''}" data-rmode="vertical">Continuo (PDF)</button>
          <button class="seg-btn ${p.mode === 'rtl' ? 'active' : ''}" data-rmode="rtl">Manga D→I</button>
          <button class="seg-btn ${p.mode === 'ltr' ? 'active' : ''}" data-rmode="ltr">Paginado I→D</button>
        </div>
      </div>

      <div class="setting-group">
        <span class="setting-label">Ajuste de imagen</span>
        <div class="seg-control two">
          <button class="seg-btn ${p.fit === 'width' ? 'active' : ''}" data-rfit="width">Ancho del móvil</button>
          <button class="seg-btn ${p.fit === 'screen' ? 'active' : ''}" data-rfit="screen">Ajustar pantalla</button>
        </div>
      </div>

      <div class="setting-group">
        <span class="setting-label">Espacio entre páginas</span>
        <div class="seg-control two">
          <button class="seg-btn ${!p.gap ? 'active' : ''}" data-rgap="0">Sin espacio (PDF)</button>
          <button class="seg-btn ${p.gap ? 'active' : ''}" data-rgap="1">Con separación</button>
        </div>
      </div>

      <div class="setting-group">
        <span class="setting-label">Indicador de página en esquina</span>
        <div class="seg-control two">
          <button class="seg-btn ${p.miniStatus ? 'active' : ''}" data-rmini="1">Mostrar</button>
          <button class="seg-btn ${!p.miniStatus ? 'active' : ''}" data-rmini="0">Ocultar</button>
        </div>
      </div>

      <div class="setting-group" style="margin-bottom:0">
        <span class="setting-label">Filtro nocturno: <strong id="rDimVal">${p.dim}%</strong></span>
        <input id="rDimSlider" type="range" min="0" max="70" step="5" value="${p.dim}" style="width:100%;accent-color:var(--accent)">
      </div>
    `;

    $('closeSheetBtn').addEventListener('click', closeReaderSheet);
    readerSheet.querySelectorAll('[data-rmode]').forEach((b) => {
      b.addEventListener('click', () => {
        state.prefs.mode = b.dataset.rmode;
        savePrefs(); applyReaderVisualPrefs(); renderReaderPages(); openReaderSettingsSheet();
      });
    });
    readerSheet.querySelectorAll('[data-rfit]').forEach((b) => {
      b.addEventListener('click', () => {
        state.prefs.fit = b.dataset.rfit;
        savePrefs(); renderReaderPages(); openReaderSettingsSheet();
      });
    });
    readerSheet.querySelectorAll('[data-rgap]').forEach((b) => {
      b.addEventListener('click', () => {
        state.prefs.gap = b.dataset.rgap === '1';
        savePrefs(); renderReaderPages(); openReaderSettingsSheet();
      });
    });
    readerSheet.querySelectorAll('[data-rmini]').forEach((b) => {
      b.addEventListener('click', () => {
        state.prefs.miniStatus = b.dataset.rmini === '1';
        savePrefs(); applyReaderVisualPrefs(); openReaderSettingsSheet();
      });
    });
    $('rDimSlider').addEventListener('input', (e) => {
      state.prefs.dim = parseInt(e.target.value, 10) || 0;
      $('rDimVal').textContent = state.prefs.dim + '%';
      savePrefs();
      applyReaderVisualPrefs();
    });
  }

  function openReaderChaptersSheet() {
    const r = state.reader;
    const current = r.chapters[r.chapIdx];
    const listDesc = r.chapters.slice().reverse();
    readerSheetBackdrop.classList.remove('hidden');
    readerSheet.classList.remove('hidden');
    readerSheet.innerHTML = `
      <div class="sheet-title">
        <span>Capítulos (${r.chapters.length})</span>
        <button id="closeChapSheet" class="secondary-btn" type="button" style="padding:5px 10px;font-size:12px">Cerrar</button>
      </div>
      <div>
        ${listDesc.map((c) => {
          const dl = isDownloaded(c.id);
          const locked = state.offline && !dl;
          return `
            <div class="chapter-row ${c.isRead ? 'read' : ''} ${locked ? 'offline-locked' : ''}" data-jump-id="${c.id}" style="${current && c.id === current.id ? 'background:var(--accent-soft);border-radius:10px' : ''}">
              <span class="chapter-dot"></span>
              <div class="chapter-info">
                <div class="chapter-name">${esc(c.name)}</div>
                <div class="chapter-meta">${[dl ? '✓ Descargado' : '', formatDate(c.uploadDate)].filter(Boolean).join(' · ')}</div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
    $('closeChapSheet').addEventListener('click', closeReaderSheet);
    readerSheet.querySelectorAll('[data-jump-id]').forEach((row) => {
      row.addEventListener('click', () => {
        const idx = r.chapters.findIndex((x) => String(x.id) === String(row.dataset.jumpId));
        closeReaderSheet();
        if (idx >= 0) switchChapter(idx);
      });
    });
    if (current) {
      const curRow = readerSheet.querySelector(`[data-jump-id="${current.id}"]`);
      if (curRow) curRow.scrollIntoView({ block: 'center' });
    }
  }

  // ---------------- Arranque ----------------
  refreshDownloadsIndex().then(() => handleRoute());
})();
