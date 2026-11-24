(() => {
  'use strict';

  const API_URL = '/api/graphql';
  const PREFS_KEY = 'suwayomi_mobile_prefs_v2';

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
    prefs: loadPrefs(),
    library: [],
    categories: [],
    selectedCat: 'all',
    librarySearch: '',
    recent: [],
    sources: [],
    activeSource: null,
    sourceMode: 'POPULAR', // 'POPULAR' | 'LATEST' | 'SEARCH'
    sourceQuery: '',
    sourcePage: 1,
    sourceHasNext: false,
    sourceMangas: [],
    // Detalle de manga
    manga: null,
    mangaChapters: [],
    chapterFilter: 'all', // 'all' | 'unread'
    chapterDesc: true,
    // Lector
    reader: {
      open: false,
      manga: null,
      chapters: [],       // orden ascendente por sourceOrder (index 0 = Cap 1)
      chapIdx: 0,
      pages: [],
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
  const topHeader = $('topHeader');
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
    if (isStandaloneApp()) {
      installBanner.classList.add('hidden');
      return;
    }
    const dismissed = sessionStorage.getItem(INSTALL_DISMISSED_KEY) === '1';
    if (dismissed) {
      installBanner.classList.add('hidden');
      return;
    }
    if (deferredInstallPrompt || isIosBrowser()) {
      installBanner.classList.remove('hidden');
    } else {
      // En Android antes de beforeinstallprompt también lo mostramos para guiar con 1 toque
      installBanner.classList.remove('hidden');
    }
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

  let toastTimer = null;
  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 2400);
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

  // ---------------- GraphQL ----------------
  async function gql(query, variables = {}) {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables })
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const json = await res.json();
    if (json.errors && json.errors.length) {
      throw new Error(json.errors[0].message || 'Error de Suwayomi');
    }
    return json.data;
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
  function renderOfflineError(err) {
    mainContent.innerHTML = `
      <div class="empty-state">
        <h3>No se puede conectar con Suwayomi</h3>
        <p>Comprueba que el PC esté encendido, Suwayomi en marcha y Tailscale conectado.<br><small>${esc(err.message || '')}</small></p>
        <button id="retryTabBtn" class="primary-btn" style="max-width:240px">Reintentar</button>
      </div>
    `;
    const btn = $('retryTabBtn');
    if (btn) btn.addEventListener('click', () => renderCurrentTab(true));
  }

  async function renderCurrentTab(forceReload = false) {
    if (state.tab === 'library') await renderLibrary(forceReload);
    else if (state.tab === 'recent') await renderRecent();
    else if (state.tab === 'explore') await renderExplore();
    else if (state.tab === 'settings') renderSettings();
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

    if (!state.library.length || forceReload) {
      mainContent.innerHTML = '<div class="spinner"></div>';
      try {
        const data = await gql(Q_LIBRARY);
        state.categories = (data.categories && data.categories.nodes) || [];
        state.library = (data.mangas && data.mangas.nodes) || [];
      } catch (err) {
        headerSub.classList.add('hidden');
        renderOfflineError(err);
        return;
      }
    }

    // Buscador + categorías
    headerSub.classList.remove('hidden');
    const usedCats = state.categories.filter((c) => c.id !== 0);
    const chipsHtml = usedCats.length
      ? `<div class="chips-row">
           <button class="chip ${state.selectedCat === 'all' ? 'active' : ''}" data-cat="all">Todos (${state.library.length})</button>
           ${usedCats.map((c) => `<button class="chip ${String(state.selectedCat) === String(c.id) ? 'active' : ''}" data-cat="${c.id}">${esc(c.name)}</button>`).join('')}
         </div>`
      : '';

    headerSub.innerHTML = `
      <div class="search-box">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="#8e98a8"><path d="M15.5 14h-.8l-.3-.3a6.5 6.5 0 1 0-.7.7l.3.3v.8l5 5 1.5-1.5-5-5zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14z"/></svg>
        <input id="libSearchInput" type="search" placeholder="Buscar en tu biblioteca..." value="${esc(state.librarySearch)}">
      </div>
      ${chipsHtml}
    `;

    $('libSearchInput').addEventListener('input', (e) => {
      state.librarySearch = e.target.value;
      drawLibraryGrid();
    });
    headerSub.querySelectorAll('.chip').forEach((ch) => {
      ch.addEventListener('click', () => {
        state.selectedCat = ch.dataset.cat;
        headerSub.querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x === ch));
        drawLibraryGrid();
      });
    });

    drawLibraryGrid();
  }

  function drawLibraryGrid() {
    const q = state.librarySearch.trim().toLowerCase();
    const list = state.library.filter((m) => {
      if (q && !m.title.toLowerCase().includes(q)) return false;
      if (state.selectedCat !== 'all') {
        const cats = (m.categories && m.categories.nodes) || [];
        return cats.some((c) => String(c.id) === String(state.selectedCat));
      }
      return true;
    });

    if (!list.length) {
      mainContent.innerHTML = `
        <div class="empty-state">
          <h3>${state.library.length ? 'Sin coincidencias' : 'Tu biblioteca está vacía'}</h3>
          <p>${state.library.length ? 'Prueba con otro filtro o búsqueda.' : 'Ve a Explorar para buscar un manga y añadirlo a tu biblioteca.'}</p>
          ${state.library.length ? '' : '<button id="goExploreBtn" class="primary-btn" style="max-width:220px">Ir a Explorar</button>'}
        </div>
      `;
      const b = $('goExploreBtn');
      if (b) b.addEventListener('click', () => navigateHash('#explore'));
      return;
    }

    mainContent.innerHTML = `<div class="manga-grid">${list.map((m) => `
      <div class="manga-card" data-manga-id="${m.id}">
        <div class="manga-cover-wrap">
          <img src="${esc(m.thumbnailUrl || '')}" alt="" loading="lazy">
          <div class="manga-cover-grad"></div>
          ${m.unreadCount > 0 ? `<span class="manga-badge">${m.unreadCount}</span>` : ''}
          <div class="manga-card-title">${esc(m.title)}</div>
        </div>
      </div>
    `).join('')}</div>`;

    mainContent.querySelectorAll('.manga-card').forEach((card) => {
      card.addEventListener('click', () => navigateHash('#manga/' + card.dataset.mangaId));
    });
  }

  // --- RECIENTES ---
  async function renderRecent() {
    headerTitle.textContent = 'Recientes';
    headerActions.innerHTML = '';
    headerSub.classList.add('hidden');
    mainContent.innerHTML = '<div class="spinner"></div>';

    try {
      const data = await gql(Q_RECENT);
      const raw = (data.chapters && data.chapters.nodes) || [];
      // Agrupar por manga manteniendo el capítulo más reciente leído
      const seen = new Set();
      state.recent = [];
      for (const ch of raw) {
        if (!ch.manga || seen.has(ch.manga.id)) continue;
        seen.add(ch.manga.id);
        state.recent.push(ch);
      }
    } catch (err) {
      renderOfflineError(err);
      return;
    }

    if (!state.recent.length) {
      mainContent.innerHTML = `
        <div class="empty-state">
          <h3>Aún no hay lecturas recientes</h3>
          <p>Cuando abras un capítulo aparecerá aquí para que puedas retomarlo con un toque.</p>
        </div>
      `;
      return;
    }

    mainContent.innerHTML = `<div class="list-stack">${state.recent.map((ch) => {
      const pageTxt = ch.isRead
        ? 'Leído'
        : (ch.pageCount > 0 ? `Pág. ${(ch.lastPageRead || 0) + 1} / ${ch.pageCount}` : 'En progreso');
      return `
        <div class="list-card" data-manga-id="${ch.manga.id}">
          <img class="list-thumb" src="${esc(ch.manga.thumbnailUrl || '')}" alt="" loading="lazy">
          <div class="list-body">
            <div class="list-title">${esc(ch.manga.title)}</div>
            <div class="list-sub">${esc(ch.name)}</div>
            <div class="list-sub">${pageTxt} · ${formatDate(ch.lastReadAt)}</div>
          </div>
          <button class="list-cta" data-read-manga="${ch.manga.id}" data-read-chap="${ch.id}" type="button">Leer</button>
        </div>
      `;
    }).join('')}</div>`;

    mainContent.querySelectorAll('.list-card').forEach((card) => {
      card.addEventListener('click', (e) => {
        const btn = e.target.closest('.list-cta');
        if (btn) {
          e.stopPropagation();
          navigateHash(`#read/${btn.dataset.readManga}/${btn.dataset.readChap}`);
          return;
        }
        navigateHash('#manga/' + card.dataset.mangaId);
      });
    });
  }

  // --- EXPLORAR ---
  async function renderExplore() {
    if (state.activeSource) {
      renderSourceBrowser();
      return;
    }
    headerTitle.textContent = 'Explorar';
    headerActions.innerHTML = `
      <a href="/" class="secondary-btn" style="text-decoration:none;padding:6px 10px;font-size:12px">Extensiones</a>
    `;
    headerSub.classList.add('hidden');
    mainContent.innerHTML = '<div class="spinner"></div>';

    try {
      const data = await gql(Q_SOURCES);
      state.sources = ((data.sources && data.sources.nodes) || [])
        .sort((a, b) => (a.lang || '').localeCompare(b.lang || '') || (a.name || '').localeCompare(b.name || ''));
    } catch (err) {
      renderOfflineError(err);
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
    } catch (err) {
      renderOfflineError(err);
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
  function renderSettings() {
    headerTitle.textContent = 'Ajustes';
    headerActions.innerHTML = '';
    headerSub.classList.add('hidden');
    const p = state.prefs;

    mainContent.innerHTML = `
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
        <a href="/" class="secondary-btn" style="display:block;text-align:center;text-decoration:none">
          Abrir Suwayomi completo (instalar extensiones)
        </a>
      </div>
    `;

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
  }

  // ---------------- Detalle de Manga ----------------
  async function openMangaDetail(mangaId, forceFetch = false) {
    mangaView.classList.remove('hidden');
    mangaView.innerHTML = '<div style="padding-top:80px"><div class="spinner"></div></div>';

    try {
      let data = await gql(Q_MANGA_DETAIL, { id: mangaId });
      let manga = data.manga;
      let chapters = (data.chapters && data.chapters.nodes) || [];

      if (forceFetch || !manga.initialized || !chapters.length) {
        const refreshed = await gql(M_REFRESH_MANGA, { id: mangaId, fetchManga: true, fetchChapters: true });
        if (refreshed.fetchMangaAndChapters) {
          if (refreshed.fetchMangaAndChapters.manga) manga = refreshed.fetchMangaAndChapters.manga;
          if (refreshed.fetchMangaAndChapters.chapters) chapters = refreshed.fetchMangaAndChapters.chapters;
        }
      }

      state.manga = manga;
      state.mangaChapters = chapters;
      drawMangaDetail();
    } catch (err) {
      mangaView.innerHTML = `
        <div class="empty-state" style="padding-top:80px">
          <h3>No se pudo cargar el manga</h3>
          <p>${esc(err.message || '')}</p>
          <button id="mangaErrBack" class="secondary-btn">Volver</button>
        </div>
      `;
      $('mangaErrBack').addEventListener('click', () => history.back());
    }
  }

  function pickResumeChapter(chapters) {
    if (!chapters.length) return null;
    const asc = chapters.slice().sort((a, b) => a.sourceOrder - b.sourceOrder);
    // Primero: último capítulo en progreso (no leído pero con lastPageRead > 0)
    const inProg = asc.filter((c) => !c.isRead && (c.lastPageRead || 0) > 0)
      .sort((a, b) => Number(b.lastReadAt || 0) - Number(a.lastReadAt || 0));
    if (inProg.length) return { chap: inProg[0], label: `Continuar: ${inProg[0].name}` };
    // Segundo: primer capítulo sin leer
    const firstUnread = asc.find((c) => !c.isRead);
    if (firstUnread) {
      const anyRead = asc.some((c) => c.isRead);
      return { chap: firstUnread, label: `${anyRead ? 'Continuar' : 'Empezar'}: ${firstUnread.name}` };
    }
    // Todos leídos -> último capítulo
    const last = asc[asc.length - 1];
    return { chap: last, label: `Releer: ${last.name}` };
  }

  function drawMangaDetail() {
    const m = state.manga;
    const resume = pickResumeChapter(state.mangaChapters);
    const filtered = state.mangaChapters
      .filter((c) => (state.chapterFilter === 'unread' ? !c.isRead : true))
      .slice()
      .sort((a, b) => (state.chapterDesc ? b.sourceOrder - a.sourceOrder : a.sourceOrder - b.sourceOrder));

    const metaParts = [];
    if (m.author) metaParts.push(m.author);
    if (m.source && m.source.name) metaParts.push(m.source.name);
    if (m.status) metaParts.push(m.status);

    mangaView.innerHTML = `
      <div class="manga-hero">
        <div class="manga-hero-bg" style="background-image:url('${esc(m.thumbnailUrl || '')}')"></div>
        <div class="manga-hero-fade"></div>
        <div class="manga-hero-inner">
          <div class="manga-hero-top">
            <button id="detailBackBtn" class="icon-btn" type="button" aria-label="Volver">
              <svg viewBox="0 0 24 24"><path d="M15.4 7.4 14 6l-6 6 6 6 1.4-1.4L10.8 12z"/></svg>
            </button>
            <button id="detailRefreshBtn" class="icon-btn" type="button" aria-label="Actualizar capítulos">
              <svg viewBox="0 0 24 24"><path d="M17.6 6.4A8 8 0 1 0 20 12h-2a6 6 0 1 1-1.8-4.2L13 11h7V4l-2.4 2.4z"/></svg>
            </button>
          </div>
          <div class="manga-hero-main">
            <img class="manga-hero-cover" src="${esc(m.thumbnailUrl || '')}" alt="">
            <div class="manga-hero-meta">
              <h2 class="manga-hero-title">${esc(m.title)}</h2>
              <div class="manga-hero-sub">${esc(metaParts.join(' · '))}</div>
            </div>
          </div>
        </div>
      </div>

      <div class="manga-actions-bar">
        ${resume ? `<button id="detailResumeBtn" class="primary-btn" style="flex:1">${esc(resume.label)}</button>` : ''}
        <button id="detailLibBtn" class="secondary-btn" type="button" style="${m.inLibrary ? 'border-color:var(--green);color:var(--green)' : ''}">
          ${m.inLibrary ? '✓ En biblioteca' : '+ Biblioteca'}
        </button>
      </div>

      ${m.description ? `<div id="detailDesc" class="manga-desc clamped">${esc(m.description)}</div>` : ''}

      <div class="chapters-head">
        <strong>${filtered.length} capítulos</strong>
        <div style="display:flex;gap:6px">
          <button id="chapFilterBtn" class="chip ${state.chapterFilter === 'unread' ? 'active' : ''}" type="button">Sin leer</button>
          <button id="chapSortBtn" class="chip" type="button">${state.chapterDesc ? '↓ Nuevos' : '↑ Antiguos'}</button>
        </div>
      </div>

      <div id="chaptersList">
        ${filtered.length ? filtered.map((c) => `
          <div class="chapter-row ${c.isRead ? 'read' : ''}" data-chap-id="${c.id}">
            <span class="chapter-dot"></span>
            <div class="chapter-info">
              <div class="chapter-name">${esc(c.name)}</div>
              <div class="chapter-meta">
                ${[
                  formatDate(c.uploadDate),
                  c.scanlator,
                  (!c.isRead && c.lastPageRead > 0 ? `Pág. ${c.lastPageRead + 1}` : '')
                ].filter(Boolean).join(' · ')}
              </div>
            </div>
            ${c.isRead ? '<span style="font-size:11px;color:var(--muted)">Leído</span>' : ''}
          </div>
        `).join('') : '<div class="empty-state"><p>No hay capítulos con este filtro.</p></div>'}
      </div>
    `;

    $('detailBackBtn').addEventListener('click', () => {
      if (history.length > 1) history.back();
      else navigateHash('#' + state.tab);
    });
    $('detailRefreshBtn').addEventListener('click', () => {
      showToast('Actualizando capítulos...');
      openMangaDetail(m.id, true);
    });
    const desc = $('detailDesc');
    if (desc) desc.addEventListener('click', () => desc.classList.toggle('clamped'));

    const resumeBtn = $('detailResumeBtn');
    if (resumeBtn && resume) {
      resumeBtn.addEventListener('click', () => navigateHash(`#read/${m.id}/${resume.chap.id}`));
    }

    $('detailLibBtn').addEventListener('click', async () => {
      try {
        const nextVal = !m.inLibrary;
        await gql(M_UPDATE_MANGA, { id: m.id, inLibrary: nextVal });
        m.inLibrary = nextVal;
        state.library = []; // refrescar biblioteca al volver
        showToast(nextVal ? 'Añadido a tu biblioteca' : 'Quitado de tu biblioteca');
        drawMangaDetail();
      } catch {
        showToast('No se pudo actualizar la biblioteca');
      }
    });

    $('chapFilterBtn').addEventListener('click', () => {
      state.chapterFilter = state.chapterFilter === 'unread' ? 'all' : 'unread';
      drawMangaDetail();
    });
    $('chapSortBtn').addEventListener('click', () => {
      state.chapterDesc = !state.chapterDesc;
      drawMangaDetail();
    });

    mangaView.querySelectorAll('.chapter-row').forEach((row) => {
      row.addEventListener('click', () => navigateHash(`#read/${m.id}/${row.dataset.chapId}`));
    });
  }

  // ---------------- Lector estilo Manga Dogs ----------------
  async function openReader(mangaId, chapterId) {
    const r = state.reader;
    r.open = true;
    r.lastSavedPage = -1;
    r.markedRead = false;
    r.preloadedChapId = null;
    closeReaderSheet();

    readerView.classList.remove('hidden');
    applyReaderVisualPrefs();
    setReaderChrome(true);
    readerStage.innerHTML = '<div style="padding-top:40vh"><div class="spinner"></div></div>';

    try {
      // Asegurar manga + lista de capítulos ordenada ascendente (Cap 1 -> Cap N)
      if (!state.manga || state.manga.id !== mangaId || !state.mangaChapters.length) {
        const d = await gql(Q_MANGA_DETAIL, { id: mangaId });
        state.manga = d.manga;
        state.mangaChapters = (d.chapters && d.chapters.nodes) || [];
      }
      r.manga = state.manga;
      r.chapters = state.mangaChapters.slice().sort((a, b) => a.sourceOrder - b.sourceOrder);
      r.chapIdx = Math.max(0, r.chapters.findIndex((c) => c.id === chapterId));
      const chap = r.chapters[r.chapIdx];

      readerMangaTitle.textContent = r.manga ? r.manga.title : 'Manga';
      readerChapterTitle.textContent = chap ? chap.name : '';
      readerPrevChap.disabled = r.chapIdx <= 0;
      readerNextChap.disabled = r.chapIdx >= r.chapters.length - 1;

      const pgData = await gql(M_FETCH_PAGES, { chapterId });
      r.pages = (pgData.fetchChapterPages && pgData.fetchChapterPages.pages) || [];

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

      // Retomar última página si el capítulo no estaba terminado
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
      // Ocultar barras tras un instante para lectura limpia a pantalla completa
      setTimeout(() => { if (r.open) setReaderChrome(false); }, 1400);
    } catch (err) {
      readerStage.innerHTML = `
        <div class="empty-state" style="padding-top:34vh">
          <h3>Error al cargar el capítulo</h3>
          <p>${esc(err.message || '')}</p>
          <button id="retryPagesErr" class="primary-btn" style="max-width:220px">Reintentar</button>
        </div>
      `;
      $('retryPagesErr').addEventListener('click', () => openReader(mangaId, chapterId));
    }
  }

  function closeReaderUi() {
    const r = state.reader;
    r.open = false;
    if (r.observer) { r.observer.disconnect(); r.observer = null; }
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

    // Precargar las siguientes 6 paginas en modo vertical para scroll fluido sin huecos
    if (state.prefs.mode === 'vertical') {
      for (let k = 1; k <= 6; k++) {
        const nextImg = readerStage.querySelector(`.reader-page-slot[data-page="${r.pageIdx + k}"] img`);
        if (nextImg && nextImg.loading === 'lazy') nextImg.loading = 'eager';
      }
    }

    // Precargar siguiente capítulo al llegar al 80%
    if (r.pageIdx >= Math.floor(r.pages.length * 0.8) && r.chapIdx < r.chapters.length - 1) {
      const nextChap = r.chapters[r.chapIdx + 1];
      if (nextChap && r.preloadedChapId !== nextChap.id) {
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
      gql(M_UPDATE_CHAPTER, { id: chap.id, patch }).catch(() => { });
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
          img.src = url + (url.includes('?') ? '&' : '?') + 'r=' + Date.now();
        };
      });
      slot.appendChild(img);
      list.appendChild(slot);
      return slot;
    });

    // Tarjeta de fin de capítulo (estilo Manga Dogs)
    const nextChap = r.chapIdx < r.chapters.length - 1 ? r.chapters[r.chapIdx + 1] : null;
    const prevChap = r.chapIdx > 0 ? r.chapters[r.chapIdx - 1] : null;
    const endCard = document.createElement('div');
    endCard.className = 'reader-end-card';
    endCard.innerHTML = `
      <div class="reader-end-title">Fin de ${esc(r.chapters[r.chapIdx] ? r.chapters[r.chapIdx].name : 'capítulo')}</div>
      <div class="reader-end-btns">
        ${prevChap ? '<button id="endPrevBtn" class="secondary-btn" type="button">‹ Anterior</button>' : ''}
        ${nextChap
          ? `<button id="endNextBtn" class="primary-btn" type="button" style="flex:1">Siguiente: ${esc(nextChap.name)} ›</button>`
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

    // Seguir la página visible al hacer scroll
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
        img.src = url + (url.includes('?') ? '&' : '?') + 'r=' + Date.now();
      };
    });
    wrap.appendChild(img);
    readerStage.innerHTML = '';
    readerStage.appendChild(wrap);

    // Precargar las 2 páginas siguientes
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
    location.replace(`#read/${r.manga.id}/${target.id}`);
  }

  // Gestos del lector (tap zonas + swipe horizontal en paginado)
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
        ${listDesc.map((c) => `
          <div class="chapter-row ${c.isRead ? 'read' : ''}" data-jump-id="${c.id}" style="${current && c.id === current.id ? 'background:var(--accent-soft);border-radius:10px' : ''}">
            <span class="chapter-dot"></span>
            <div class="chapter-info">
              <div class="chapter-name">${esc(c.name)}</div>
              <div class="chapter-meta">${formatDate(c.uploadDate)}</div>
            </div>
          </div>
        `).join('')}
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
  handleRoute();
})();
