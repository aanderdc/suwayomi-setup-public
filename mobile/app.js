(() => {
  'use strict';

  const API_URL = '/api/graphql';
  const VAULT_API_URL = '/movil/__vault__/api/graphql';
  const PREFS_KEY = 'suwayomi_mobile_prefs_v3';
  const Offline = window.SuwayomiOffline;
  const Extras = window.SuwayomiExtras;

  const DEFAULT_PREFS = {
    mode: 'vertical',     // 'vertical' (PDF continuo) | 'rtl' | 'ltr'
    fit: 'width',         // 'width' (100% ancho del movil) | 'screen'
    gap: false,           // false = 0px sin espacio entre paginas
    dim: 0,               // 0..70 filtro nocturno
    miniStatus: true,     // indicador discreto en esquina
    autoNext: true,       // paso automatico al siguiente capitulo al llegar al final en vertical
    wakeLock: true,       // mantener pantalla encendida al leer
    cropMargins: false,   // recorte automatico de margenes blancos
    doublePage: true,     // doble pagina en horizontal / tablet (modo paginado)
    autoDlNext: 0,        // 0 | 1 | 3 | 5 descargar siguientes N capitulos al abrir uno
    autoDelRead: false    // borrar descarga del movil al terminar un capitulo
  };

  function loadPrefs() {
    try {
      const prev = JSON.parse(localStorage.getItem(PREFS_KEY) || localStorage.getItem('suwayomi_mobile_prefs_v2') || '{}');
      return Object.assign({}, DEFAULT_PREFS, prev);
    } catch {
      return Object.assign({}, DEFAULT_PREFS);
    }
  }

  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(state.prefs)); } catch { }
  }

  const state = {
    tab: 'library',
    offline: false,
    prefs: loadPrefs(),
    library: [],
    categories: [],
    selectedCat: 'all',
    onlyDownloaded: false,
    librarySort: 'title', // 'title' | 'lastRead' | 'unread' | 'added'
    librarySearch: '',
    updates: [],
    recent: [],
    sources: [],
    activeSource: null,
    sourceMode: 'POPULAR',
    sourceQuery: '',
    sourcePage: 1,
    sourceHasNext: false,
    sourceMangas: [],
    globalSearchQuery: '',
    globalSearchResults: [],
    // Descargas locales
    downloads: new Map(),
    downloadsByManga: new Map(),
    downloadQueue: [],
    downloadsPaused: false,
    activeDownload: null,
    // Detalle de manga
    manga: null,
    mangaInVault: false,
    mangaChapters: [],
    chapterFilter: 'all', // 'all' | 'unread' | 'downloaded' | 'bookmarked'
    chapterDesc: true,
    // Bóveda oculta (instancia aislada Tachidesk-Vault:4569)
    vaultOpen: false,
    vaultReady: false,
    vaultOffline: false,
    vaultTab: 'mangas', // 'mangas' | 'sources' | 'options'
    vaultLibrary: [],
    vaultSources: [],
    vaultActiveSource: null,
    vaultSourceMode: 'POPULAR',
    vaultSourceQuery: '',
    vaultSourcePage: 1,
    vaultSourceHasNext: false,
    vaultSourceMangas: [],
    vaultGlobalQuery: '',
    vaultGlobalResults: [],
    vaultSearch: '',
    // Lector
    reader: {
      open: false,
      inVault: false,
      manga: null,
      chapters: [],
      chapIdx: 0,
      pages: [],
      blobUrls: [],
      pageIdx: 0,
      chromeVisible: true,
      zoomed: false,
      observer: null,
      endObserver: null,
      autoNextTimer: null,
      readTickTimer: null,
      lastSavedPage: -1,
      markedRead: false,
      preloadedChapId: null,
      touchStartX: 0,
      touchStartY: 0,
      touchMoved: false,
      brightnessDrag: false,
      brightnessStartDim: 0,
      lastTapTime: 0
    }
  };

  // ---------------- DOM ----------------
  const $ = (id) => document.getElementById(id);
  const headerTitle = $('headerTitle');
  const headerActions = $('headerActions');
  const headerSub = $('headerSub');
  const mainContent = $('mainContent');
  const bottomNav = $('bottomNav');
  const vaultView = $('vaultView');
  const mangaView = $('mangaView');
  const appSheetBackdrop = $('appSheetBackdrop');
  const appSheet = $('appSheet');
  const readerView = $('readerView');
  const readerStage = $('readerStage');
  const readerDimmer = $('readerDimmer');
  const readerBrightnessHud = $('readerBrightnessHud');
  const readerMiniStatus = $('readerMiniStatus');
  const readerMangaTitle = $('readerMangaTitle');
  const readerChapterTitle = $('readerChapterTitle');
  const readerBookmarkBtn = $('readerBookmarkBtn');
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
  const dlQueueBar = $('dlQueueBar');
  const dlQueueInfo = $('dlQueueInfo');
  const dlQueuePauseBtn = $('dlQueuePauseBtn');
  const dlQueueOpenBtn = $('dlQueueOpenBtn');
  const pinLockOverlay = $('pinLockOverlay');
  const pinTitle = $('pinTitle');
  const pinDots = $('pinDots');
  const pinErr = $('pinErr');
  const pinPad = $('pinPad');
  const pinCancelBtn = $('pinCancelBtn');

  // ---------------- Bloqueo con PIN ----------------
  let pinBuffer = '';
  let pinCallback = null;

  function renderPinDots() {
    const spans = pinDots.querySelectorAll('span');
    spans.forEach((sp, i) => sp.classList.toggle('filled', i < pinBuffer.length));
  }

  function showPinPrompt(titleText, onDone, cancellable = false) {
    pinBuffer = '';
    pinCallback = onDone;
    pinTitle.textContent = titleText || 'Introduce tu PIN';
    pinErr.textContent = '';
    if (pinCancelBtn) pinCancelBtn.classList.toggle('hidden', !cancellable);
    renderPinDots();
    pinLockOverlay.classList.remove('hidden');
  }

  function hidePinPrompt() {
    pinBuffer = '';
    pinCallback = null;
    if (pinCancelBtn) pinCancelBtn.classList.add('hidden');
    pinLockOverlay.classList.add('hidden');
  }

  if (pinCancelBtn) pinCancelBtn.addEventListener('click', hidePinPrompt);

  pinPad.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-pin]');
    if (!btn) return;
    const val = btn.dataset.pin;
    if (val === 'clear') {
      pinBuffer = '';
      pinErr.textContent = '';
      renderPinDots();
      return;
    }
    if (val === 'back') {
      pinBuffer = pinBuffer.slice(0, -1);
      renderPinDots();
      return;
    }
    if (pinBuffer.length >= 4) return;
    pinBuffer += val;
    renderPinDots();
    if (pinBuffer.length === 4 && pinCallback) {
      const code = pinBuffer;
      const fn = pinCallback;
      await fn(code);
    }
  });

  function checkStartupPin() {
    if (!Extras || !Extras.isPinLockedNow()) return;
    showPinPrompt('Introduce tu PIN', async (code) => {
      const ok = await Extras.verifyPin(code);
      if (ok) {
        Extras.markPinUnlocked();
        hidePinPrompt();
      } else {
        pinBuffer = '';
        pinErr.textContent = 'PIN incorrecto';
        renderPinDots();
      }
    });
  }

  // ---------------- Instalación PWA ----------------
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
      alert('En iPhone/iPad:\n1. Pulsa Compartir.\n2. Elige "Añadir a pantalla de inicio".');
    } else {
      alert('En Chrome:\n1. Pulsa el menú (3 puntos arriba).\n2. Pulsa "Instalar aplicación" o "Añadir a pantalla de inicio".');
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

  function effectiveReaderMode() {
    const m = state.reader.manga;
    if (m && Extras) {
      const override = Extras.getMangaMode(m.id);
      if (override) return override;
    }
    return state.prefs.mode;
  }

  function isDoublePageNow() {
    const mode = effectiveReaderMode();
    return mode !== 'vertical' && state.prefs.doublePage && window.innerWidth > window.innerHeight && window.innerWidth >= 680;
  }

  function dlKey(id, inVault = false) {
    return inVault ? ('v_' + Number(id)) : Number(id);
  }

  function isDownloaded(chapterId, inVault = false) {
    return state.downloads.has(dlKey(chapterId, inVault));
  }

  function mangaDownloadCount(mangaId, inVault = false) {
    return state.downloadsByManga.get(dlKey(mangaId, inVault)) || 0;
  }

  function assetUrl(rawUrl, inVault = false) {
    if (!rawUrl) return '';
    if (inVault && rawUrl.startsWith('/api/')) return '/movil/__vault__' + rawUrl;
    return rawUrl;
  }

  function coverUrlFor(manga, inVault = false) {
    if (!manga) return '';
    const isOff = inVault ? state.vaultOffline : state.offline;
    if (isOff || !manga.thumbnailUrl) return `/movil/__offline__/cover/${dlKey(manga.id, inVault)}`;
    return assetUrl(manga.thumbnailUrl, inVault);
  }

  function attachCoverFallbacks(root) {
    if (!root || !Offline) return;
    root.querySelectorAll('img[data-cover-id]').forEach((img) => {
      img.addEventListener('error', async () => {
        if (img.dataset.fallbackTried) return;
        img.dataset.fallbackTried = '1';
        const cid = img.dataset.coverId;
        const key = cid.startsWith('v_') ? cid : Number(cid);
        const blobUrl = await Offline.getCachedCoverBlobUrl(key);
        if (blobUrl) img.src = blobUrl;
      });
    });
  }

  function openAppSheet(html) {
    appSheet.innerHTML = html;
    appSheetBackdrop.classList.remove('hidden');
    appSheet.classList.remove('hidden');
  }

  function closeAppSheet() {
    appSheetBackdrop.classList.add('hidden');
    appSheet.classList.add('hidden');
  }
  appSheetBackdrop.addEventListener('click', closeAppSheet);

  function isMangaSecret(manga) {
    if (!Extras || !manga) return false;
    return Extras.isMangaHidden(manga.id) || (manga.sourceId && Extras.isSourceHidden(manga.sourceId));
  }

  function isIncognitoManga(manga) {
    if (!Extras || !manga) return false;
    return Extras.isVaultIncognito() && (state.vaultOpen || isMangaSecret(manga));
  }

  // Gesto discreto: 5 toques rápidos en el título "Biblioteca" abren la bóveda oculta
  let vaultTapCount = 0;
  let vaultTapReset = null;
  headerTitle.addEventListener('click', () => {
    if (state.tab !== 'library') return;
    vaultTapCount += 1;
    clearTimeout(vaultTapReset);
    vaultTapReset = setTimeout(() => { vaultTapCount = 0; }, 1600);
    if (vaultTapCount >= 5) {
      vaultTapCount = 0;
      requestOpenVault();
    }
  });

  // Auto-bloquear bóveda si la app pasa a segundo plano más de 30s
  let vaultHideTimer = null;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && state.vaultOpen) {
      vaultHideTimer = setTimeout(() => lockVault(true), 30000);
    } else if (document.visibilityState === 'visible' && vaultHideTimer) {
      clearTimeout(vaultHideTimer);
      vaultHideTimer = null;
    }
  });

  function requestOpenVault() {
    if (!Extras) return;
    if (Extras.isVaultUnlocked()) {
      openVault();
      return;
    }
    if (!Extras.hasVaultPin()) {
      showPinPrompt('Crea un PIN (4 dígitos) para tu bóveda oculta', async (first) => {
        showPinPrompt('Repite el PIN de tu bóveda', async (second) => {
          if (first === second) {
            await Extras.setVaultPin(first);
            hidePinPrompt();
            showToast('Bóveda oculta creada');
            openVault();
          } else {
            pinBuffer = '';
            pinErr.textContent = 'No coinciden, inténtalo de nuevo';
            renderPinDots();
          }
        }, true);
      }, true);
      return;
    }
    showPinPrompt('PIN de la bóveda oculta', async (code) => {
      if (await Extras.verifyVaultPin(code)) {
        Extras.unlockVaultSession();
        hidePinPrompt();
        openVault();
      } else {
        pinBuffer = '';
        pinErr.textContent = 'PIN incorrecto';
        renderPinDots();
      }
    }, true);
  }

  async function openVault() {
    state.vaultOpen = true;
    state.vaultReady = false;
    state.vaultActiveSource = null;
    vaultView.classList.remove('hidden');
    vaultView.innerHTML = `
      <div class="vault-header">
        <div class="vault-title-row">
          <h2 class="vault-title">🔒 Bóveda oculta</h2>
          <button id="vaultAbortBtn" class="secondary-btn" type="button" style="padding:6px 11px;font-size:12px">Cerrar</button>
        </div>
      </div>
      <div class="empty-state" style="padding-top:90px">
        <div class="spinner"></div>
        <h3>Iniciando bóveda aislada...</h3>
        <p>Base de datos y extensiones 100% independientes de Suwayomi PC (tarda 2-5 seg).</p>
      </div>
    `;
    $('vaultAbortBtn').addEventListener('click', () => lockVault(false));

    await refreshDownloadsIndex();
    try {
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), 25000) : null;
      const res = await fetch('/movil/__vault__/start', {
        method: 'POST',
        headers: { 'X-Suwayomi-Action': 'vault' },
        signal: ctrl ? ctrl.signal : undefined
      });
      if (timer) clearTimeout(timer);
      let d = {};
      try { d = await res.json(); } catch { }
      if (!res.ok || !d.ok) throw new Error(d.error || `HTTP ${res.status}`);
      state.vaultReady = true;
      state.vaultOffline = false;
      await loadVaultData();
    } catch {
      // Modo offline de la bóveda: cargar snapshot + descargas locales de bóveda
      state.vaultReady = false;
      state.vaultOffline = true;
      const snap = Offline ? await Offline.getSnapshot('vault_library') : null;
      state.vaultLibrary = (snap && snap.library) || [];
      state.vaultSources = [];
    }
    renderVault();
  }

  async function loadVaultData() {
    try {
      const [libData, srcData] = await Promise.all([
        gql(Q_LIBRARY, {}, 10000, true),
        gql(Q_SOURCES, {}, 10000, true)
      ]);
      state.vaultLibrary = (libData.mangas && libData.mangas.nodes) || [];
      state.vaultSources = ((srcData.sources && srcData.sources.nodes) || [])
        .sort((a, b) => (a.lang || '').localeCompare(b.lang || '') || (a.name || '').localeCompare(b.name || ''));
      state.vaultOffline = false;
      if (Offline) {
        Offline.saveSnapshot('vault_library', { library: state.vaultLibrary });
        state.vaultLibrary.slice(0, 40).forEach((m) => {
          if (m.thumbnailUrl) Offline.cacheCover(dlKey(m.id, true), assetUrl(m.thumbnailUrl, true));
        });
      }
    } catch {
      state.vaultOffline = true;
      const snap = Offline ? await Offline.getSnapshot('vault_library') : null;
      state.vaultLibrary = (snap && snap.library) || [];
    }
  }

  function lockVault(silent = false) {
    state.vaultOpen = false;
    state.vaultReady = false;
    state.vaultActiveSource = null;
    if (Extras) Extras.lockVaultSession();
    vaultView.classList.add('hidden');

    // Detener inmediatamente la instancia aislada en el PC (0 RAM, 0 procesos)
    fetch('/movil/__vault__/stop', {
      method: 'POST',
      headers: { 'X-Suwayomi-Action': 'vault' }
    }).catch(() => { });

    if (state.reader.open && state.reader.inVault) {
      closeReaderUi();
      navigateHash('#library');
    } else if (!mangaView.classList.contains('hidden') && state.mangaInVault) {
      mangaView.classList.add('hidden');
      navigateHash('#library');
    } else {
      renderCurrentTab();
    }
    if (!silent) showToast('Bóveda bloqueada y cerrada');
  }

  async function ensureAllSourcesLoaded() {
    if (state.sources.length) return state.sources;
    try {
      const d = await gql(Q_SOURCES, {}, 7000);
      state.sources = ((d.sources && d.sources.nodes) || [])
        .sort((a, b) => (a.lang || '').localeCompare(b.lang || '') || (a.name || '').localeCompare(b.name || ''));
    } catch { }
    return state.sources;
  }

  async function runVaultGlobalSearch(query) {
    state.vaultGlobalQuery = query;
    state.vaultGlobalResults = [];
    if (!query) { renderVault(); return; }
    const wrap = $('vaultSourcesBody');
    if (wrap) wrap.innerHTML = `<div class="empty-state"><div class="spinner"></div><p>Buscando "${esc(query)}" en ${state.vaultSources.length} fuente(s) de la bóveda...</p></div>`;
    const res = await Promise.all(state.vaultSources.map(async (src) => {
      try {
        const data = await gql(M_SOURCE_MANGAS, {
          input: { source: String(src.id), type: 'SEARCH', page: 1, query }
        }, 12000, true);
        return { source: src, mangas: ((data.fetchSourceManga && data.fetchSourceManga.mangas) || []).slice(0, 12) };
      } catch {
        return { source: src, mangas: [] };
      }
    }));
    state.vaultGlobalResults = res.filter((x) => x.mangas.length > 0);
    renderVault();
  }

  async function renderVault() {
    if (!state.vaultOpen) return;
    const incognito = Extras.isVaultIncognito();

    let bodyHtml = '';
    if (state.vaultTab === 'mangas') {
      const q = state.vaultSearch.trim().toLowerCase();
      const filtered = state.vaultLibrary.filter((m) => !q || (m.title || '').toLowerCase().includes(q));
      bodyHtml = `
        <div style="display:flex;gap:8px;margin-bottom:12px">
          <div class="search-box" style="flex:1">
            <input id="vaultSearchInput" type="search" placeholder="Buscar en la bóveda..." value="${esc(state.vaultSearch)}">
          </div>
          ${!state.vaultOffline ? '<button id="vaultRefreshLib" class="secondary-btn" type="button" style="padding:8px 10px;font-size:12px">↻</button>' : ''}
        </div>
        ${state.vaultOffline ? '<div style="margin-bottom:10px;font-size:12px;color:#f6d57a">Sin conexión con el PC · Mostrando biblioteca guardada de la bóveda.</div>' : ''}
        ${filtered.length ? `<div class="manga-grid">${filtered.map((m) => {
          const dl = mangaDownloadCount(m.id, true);
          return `
            <div class="manga-card ${state.vaultOffline && dl === 0 ? 'offline-dim' : ''}" data-vmanga-id="${m.id}">
              <div class="manga-cover-wrap">
                <img src="${esc(coverUrlFor(m, true))}" data-cover-id="${dlKey(m.id, true)}" alt="" loading="lazy">
                <div class="manga-cover-grad"></div>
                ${m.unreadCount > 0 ? `<span class="manga-badge" style="background:#7c3aed">${m.unreadCount}</span>` : ''}
                ${dl > 0 ? `<span class="manga-dl-badge">↓ ${dl}</span>` : ''}
                <div class="manga-card-title">${esc(m.title)}</div>
              </div>
            </div>
          `;
        }).join('')}</div>` : `
          <div class="empty-state">
            <h3>Bóveda vacía</h3>
            <p>Ve a la pestaña <strong>Fuentes</strong> para instalar extensiones exclusivas de la bóveda (no aparecerán en tu Suwayomi normal ni en el historial del PC) y añadir tus mangas aquí.</p>
          </div>
        `}
      `;
    } else if (state.vaultTab === 'sources') {
      if (state.vaultActiveSource) {
        const src = state.vaultActiveSource;
        bodyHtml = `
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
            <strong style="color:#e9d5ff">${esc(src.name)}</strong>
            <button id="vsBackBtn" class="secondary-btn" type="button" style="padding:5px 10px;font-size:12px">‹ Fuentes</button>
          </div>
          <form id="vsSearchForm" class="search-box" style="margin-bottom:10px">
            <input id="vsSearchInput" type="search" placeholder="Buscar en ${esc(src.name)}..." value="${esc(state.vaultSourceQuery)}">
          </form>
          <div class="chips-row" style="margin-bottom:10px">
            <button class="chip ${state.vaultSourceMode === 'POPULAR' ? 'active' : ''}" data-vsmode="POPULAR">Populares</button>
            ${src.supportsLatest ? `<button class="chip ${state.vaultSourceMode === 'LATEST' ? 'active' : ''}" data-vsmode="LATEST">Últimos</button>` : ''}
          </div>
          <div id="vaultSourceGridWrap"><div class="spinner"></div></div>
        `;
      } else {
        const globalHtml = (state.vaultGlobalQuery && state.vaultGlobalResults.length)
          ? state.vaultGlobalResults.map((grp) => `
              <div style="margin-bottom:14px">
                <div style="font-size:12.5px;font-weight:700;color:#c4b5fd;margin-bottom:6px">${esc(grp.source.name)} (${grp.mangas.length})</div>
                <div class="manga-grid">${grp.mangas.map((m) => `
                  <div class="manga-card" data-vs-global-m="${m.id}">
                    <div class="manga-cover-wrap">
                      <img src="${esc(assetUrl(m.thumbnailUrl, true))}" alt="" loading="lazy">
                      <div class="manga-cover-grad"></div>
                      ${m.inLibrary ? '<span class="manga-badge" style="background:#7c3aed">En bóveda</span>' : ''}
                      <div class="manga-card-title">${esc(m.title)}</div>
                    </div>
                  </div>
                `).join('')}</div>
              </div>
            `).join('')
          : '';

        bodyHtml = `
          <div style="margin-bottom:10px">
            <button id="vsInstallExtBtn" class="primary-btn" type="button" style="background:#7c3aed;font-size:13.5px;padding:11px 12px">+ Instalar extensiones en la bóveda</button>
          </div>
          ${state.vaultSources.length ? `
          <form id="vaultGlobalForm" class="search-box" style="margin-bottom:10px">
            <input id="vaultGlobalInput" type="search" placeholder="Buscar en todas las fuentes de la bóveda..." value="${esc(state.vaultGlobalQuery)}">
          </form>` : ''}
          <div id="vaultSourcesBody">
            ${globalHtml || (state.vaultSources.length ? `<div class="list-stack">${state.vaultSources.map((s) => `
              <div class="list-card" data-vsrc-id="${esc(s.id)}">
                <img class="source-icon" src="${esc(assetUrl(s.iconUrl, true))}" alt="" loading="lazy">
                <div class="list-body">
                  <div class="list-title">${esc(s.name)}</div>
                  <div class="list-sub">Exclusiva de la bóveda · ${esc((s.lang || '').toUpperCase())}</div>
                </div>
                <span style="color:#c4b5fd;font-size:18px">›</span>
              </div>
            `).join('')}</div>` : `
              <div class="empty-state">
                <h3>Sin extensiones en la bóveda</h3>
                <p>Pulsa <strong>+ Instalar extensiones en la bóveda</strong>. Las que instales aquí quedan aisladas en <code>Tachidesk-Vault</code> y nunca aparecen en <code>localhost:4567</code> ni en búsquedas normales.</p>
              </div>
            `)}
          </div>
        `;
      }
    } else {
      const allDl = Offline ? await Offline.listDownloads() : [];
      const secretDl = allDl.filter((d) => String(d.chapterId).startsWith('v_'));
      const secretBytes = secretDl.reduce((acc, d) => acc + (d.bytes || 0), 0);
      bodyHtml = `
        <div class="settings-card">
          <div style="font-size:14px;font-weight:700;margin-bottom:6px;color:#e9d5ff">Aislamiento total garantizado</div>
          <p style="margin:0 0 10px;font-size:12px;color:var(--muted);line-height:1.45">
            Esta bóveda usa su propia instancia y carpeta de datos separada (<code>Tachidesk-Vault</code>). Nada de lo que instales, busques o leas aquí aparece en <code>http://localhost:4567/history</code> ni en <code>/browse?tab=sources</code>. Al bloquear la bóveda, el proceso se apaga por completo.
          </p>
          <div class="setting-group" style="margin-bottom:0">
            <span class="setting-label">Modo incógnito (no guardar historial ni siquiera en la bóveda)</span>
            <div class="seg-control two">
              <button class="seg-btn ${incognito ? 'active' : ''}" data-vinc="1">Sin historial</button>
              <button class="seg-btn ${!incognito ? 'active' : ''}" data-vinc="0">Guardar en bóveda</button>
            </div>
          </div>
        </div>

        <div class="settings-card">
          <div style="font-size:14px;font-weight:700;margin-bottom:4px">Descargas de la bóveda</div>
          <div style="font-size:12.5px;color:var(--muted);margin-bottom:10px">
            ${secretDl.length} capítulo(s) descargados · ${Offline ? Offline.formatBytes(secretBytes) : '0 B'} (ocultos de los ajustes normales).
          </div>
          ${secretDl.length ? '<button id="vaultDelDlBtn" class="secondary-btn" type="button" style="width:100%;color:#ff8690;border-color:rgba(255,77,90,0.35)">Borrar descargas de la bóveda</button>' : ''}
        </div>

        <div class="settings-card">
          <div style="font-size:14px;font-weight:700;margin-bottom:8px">Seguridad de la bóveda</div>
          <p style="margin:0 0 10px;font-size:12px;color:var(--muted)">
            Acceso rápido: toca <strong>5 veces</strong> en el título <strong>"Biblioteca"</strong>.
          </p>
          <button id="vaultChPinBtn" class="secondary-btn" type="button" style="width:100%">Cambiar PIN de bóveda</button>
        </div>
      `;
    }

    vaultView.innerHTML = `
      <div class="vault-header">
        <div class="vault-title-row">
          <h2 class="vault-title">🔒 Bóveda oculta</h2>
          <button id="vaultLockBtn" class="secondary-btn" type="button" style="padding:6px 11px;font-size:12px;border-color:rgba(167,139,250,0.5)">Bloquear</button>
        </div>
        <div class="vault-tabs">
          <button class="vault-tab-btn ${state.vaultTab === 'mangas' ? 'active' : ''}" data-vtab="mangas" type="button">Mangas (${state.vaultLibrary.length})</button>
          <button class="vault-tab-btn ${state.vaultTab === 'sources' ? 'active' : ''}" data-vtab="sources" type="button">Fuentes (${state.vaultSources.length})</button>
          <button class="vault-tab-btn ${state.vaultTab === 'options' ? 'active' : ''}" data-vtab="options" type="button">Opciones</button>
        </div>
      </div>
      <div class="vault-body">${bodyHtml}</div>
    `;

    attachCoverFallbacks(vaultView);
    $('vaultLockBtn').addEventListener('click', () => lockVault(false));
    vaultView.querySelectorAll('[data-vtab]').forEach((b) => {
      b.addEventListener('click', () => {
        state.vaultTab = b.dataset.vtab;
        state.vaultActiveSource = null;
        renderVault();
      });
    });

    if (state.vaultTab === 'mangas') {
      const inp = $('vaultSearchInput');
      if (inp) inp.addEventListener('input', (e) => { state.vaultSearch = e.target.value; renderVault(); });
      const ref = $('vaultRefreshLib');
      if (ref) ref.addEventListener('click', async () => { await loadVaultData(); renderVault(); });
      vaultView.querySelectorAll('[data-vmanga-id]').forEach((card) => {
        card.addEventListener('click', () => navigateHash('#vmanga/' + card.dataset.vmangaId));
      });
    } else if (state.vaultTab === 'sources') {
      if (state.vaultActiveSource) {
        $('vsBackBtn').addEventListener('click', () => { state.vaultActiveSource = null; renderVault(); });
        $('vsSearchForm').addEventListener('submit', (e) => {
          e.preventDefault();
          const q = $('vsSearchInput').value.trim();
          state.vaultSourceQuery = q;
          state.vaultSourceMode = q ? 'SEARCH' : 'POPULAR';
          state.vaultSourcePage = 1;
          state.vaultSourceMangas = [];
          loadVaultSourcePage();
        });
        vaultView.querySelectorAll('[data-vsmode]').forEach((ch) => {
          ch.addEventListener('click', () => {
            state.vaultSourceMode = ch.dataset.vsmode;
            state.vaultSourceQuery = '';
            state.vaultSourcePage = 1;
            state.vaultSourceMangas = [];
            renderVault();
          });
        });
        loadVaultSourcePage();
      } else {
        const iBtn = $('vsInstallExtBtn');
        if (iBtn) iBtn.addEventListener('click', () => openExtensionsManager(true));
        const gForm = $('vaultGlobalForm');
        if (gForm) {
          gForm.addEventListener('submit', (e) => {
            e.preventDefault();
            runVaultGlobalSearch($('vaultGlobalInput').value.trim());
          });
        }
        vaultView.querySelectorAll('[data-vs-global-m]').forEach((card) => {
          card.addEventListener('click', () => navigateHash('#vmanga/' + card.dataset.vsGlobalM));
        });
        vaultView.querySelectorAll('[data-vsrc-id]').forEach((card) => {
          card.addEventListener('click', () => {
            const s = state.vaultSources.find((x) => String(x.id) === String(card.dataset.vsrcId));
            if (!s) return;
            state.vaultActiveSource = s;
            state.vaultSourceMode = 'POPULAR';
            state.vaultSourceQuery = '';
            state.vaultSourcePage = 1;
            state.vaultSourceMangas = [];
            renderVault();
          });
        });
      }
    } else {
      vaultView.querySelectorAll('[data-vinc]').forEach((b) => {
        b.addEventListener('click', () => { Extras.setVaultIncognito(b.dataset.vinc === '1'); renderVault(); });
      });
      const delDl = $('vaultDelDlBtn');
      if (delDl) {
        delDl.addEventListener('click', async () => {
          if (!confirm('¿Borrar todas las descargas de la bóveda?')) return;
          const allDl = await Offline.listDownloads();
          for (const d of allDl) {
            if (String(d.chapterId).startsWith('v_')) await Offline.deleteDownload(d.chapterId);
          }
          await refreshDownloadsIndex();
          showToast('Descargas de la bóveda borradas');
          renderVault();
        });
      }
      $('vaultChPinBtn').addEventListener('click', () => {
        showPinPrompt('Nuevo PIN (4 dígitos) para bóveda', async (first) => {
          showPinPrompt('Repite el nuevo PIN', async (second) => {
            if (first === second) {
              await Extras.setVaultPin(first);
              hidePinPrompt();
              showToast('PIN de bóveda actualizado');
            } else {
              pinBuffer = '';
              pinErr.textContent = 'No coinciden';
              renderPinDots();
            }
          }, true);
        }, true);
      });
    }
  }

  async function loadVaultSourcePage() {
    const wrap = $('vaultSourceGridWrap');
    if (!wrap || !state.vaultActiveSource) return;
    if (state.vaultSourcePage === 1) wrap.innerHTML = '<div class="spinner"></div>';
    try {
      const input = {
        source: String(state.vaultActiveSource.id),
        type: state.vaultSourceMode,
        page: state.vaultSourcePage
      };
      if (state.vaultSourceMode === 'SEARCH') input.query = state.vaultSourceQuery;
      const data = await gql(M_SOURCE_MANGAS, { input }, 15000, true);
      const res = data.fetchSourceManga || { mangas: [], hasNextPage: false };
      state.vaultSourceHasNext = !!res.hasNextPage;
      state.vaultSourceMangas = state.vaultSourcePage === 1 ? res.mangas : state.vaultSourceMangas.concat(res.mangas);
      wrap.innerHTML = state.vaultSourceMangas.length ? `
        <div class="manga-grid">${state.vaultSourceMangas.map((m) => `
          <div class="manga-card" data-vs-manga="${m.id}">
            <div class="manga-cover-wrap">
              <img src="${esc(assetUrl(m.thumbnailUrl, true))}" alt="" loading="lazy">
              <div class="manga-cover-grad"></div>
              ${m.inLibrary ? '<span class="manga-badge" style="background:#7c3aed">En bóveda</span>' : ''}
              <div class="manga-card-title">${esc(m.title)}</div>
            </div>
          </div>
        `).join('')}</div>
        ${state.vaultSourceHasNext ? '<div style="margin-top:12px"><button id="vsMoreBtn" class="secondary-btn" style="width:100%">Cargar más</button></div>' : ''}
      ` : '<div class="empty-state"><p>Sin resultados.</p></div>';

      wrap.querySelectorAll('[data-vs-manga]').forEach((c) => {
        c.addEventListener('click', () => navigateHash('#vmanga/' + c.dataset.vsManga));
      });
      const more = $('vsMoreBtn');
      if (more) {
        more.addEventListener('click', () => {
          more.disabled = true;
          state.vaultSourcePage += 1;
          loadVaultSourcePage();
        });
      }
    } catch {
      wrap.innerHTML = '<div class="empty-state"><p>Sin conexión con la bóveda.</p></div>';
    }
  }

  function setOfflineMode(isOff) {
    const wasOff = state.offline;
    state.offline = !!isOff;
    if (offlineBanner) offlineBanner.classList.toggle('hidden', !state.offline);
    if (wasOff && !state.offline) flushPendingSyncs();
  }

  if (offlineRetryBtn) {
    offlineRetryBtn.addEventListener('click', async () => {
      showToast('Comprobando conexión con el PC...');
      setOfflineMode(false);
      await handleRoute();
    });
  }

  window.addEventListener('online', () => {
    if (state.offline) { setOfflineMode(false); handleRoute(); }
  });

  window.addEventListener('offline', () => {
    setOfflineMode(true);
    if (!state.reader.open && mangaView.classList.contains('hidden')) renderCurrentTab();
    else if (!mangaView.classList.contains('hidden') && state.manga) drawMangaDetail();
  });

  // ---------------- Cola de descargas pausable / cancelable ----------------
  async function refreshDownloadsIndex() {
    if (!Offline) return;
    const all = await Offline.listDownloads();
    state.downloads.clear();
    state.downloadsByManga.clear();
    for (const rec of all) {
      state.downloads.set(rec.chapterId, rec);
      state.downloadsByManga.set(rec.mangaId, (state.downloadsByManga.get(rec.mangaId) || 0) + 1);
    }
  }

  function updateDownloadQueueBar() {
    const totalPending = (state.activeDownload ? 1 : 0) + state.downloadQueue.length;
    if (totalPending === 0) {
      dlQueueBar.classList.add('hidden');
      return;
    }
    dlQueueBar.classList.remove('hidden');
    if (state.downloadsPaused) {
      dlQueueInfo.textContent = `Descargas en pausa (${totalPending} pendiente(s))`;
      dlQueuePauseBtn.textContent = 'Reanudar';
    } else if (state.activeDownload) {
      const a = state.activeDownload;
      const pct = a.total > 0 ? ` (${a.done}/${a.total})` : '';
      dlQueueInfo.textContent = `Descargando ${a.name || ''}${pct} · ${totalPending} en cola`;
      dlQueuePauseBtn.textContent = 'Pausar';
    } else {
      dlQueueInfo.textContent = `${totalPending} capítulo(s) en cola`;
      dlQueuePauseBtn.textContent = 'Pausar';
    }
  }

  function openDownloadQueueSheet() {
    const items = [];
    if (state.activeDownload) {
      items.push({ id: state.activeDownload.chapterId, title: state.activeDownload.mangaTitle, name: state.activeDownload.name, active: true, prog: state.activeDownload.total ? `${state.activeDownload.done}/${state.activeDownload.total}` : '...' });
    }
    state.downloadQueue.forEach((q) => {
      items.push({ id: q.chapter.id, title: q.manga ? q.manga.title : '', name: q.chapter.name, active: false, prog: 'En cola' });
    });

    openAppSheet(`
      <div class="sheet-title">
        <span>Cola de descargas (${items.length})</span>
        <button id="qCloseBtn" class="secondary-btn" type="button" style="padding:5px 10px;font-size:12px">Cerrar</button>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:12px">
        <button id="qTogglePause" class="secondary-btn" type="button" style="flex:1">${state.downloadsPaused ? 'Reanudar cola' : 'Pausar cola'}</button>
        <button id="qCancelAll" class="secondary-btn" type="button" style="flex:1;color:#ff8690;border-color:rgba(255,77,90,0.35)">Cancelar todo</button>
      </div>
      ${items.length ? items.map((it) => `
        <div class="dl-storage-row">
          <div style="min-width:0;flex:1">
            <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(it.name)}</div>
            <div style="font-size:11.5px;color:var(--muted)">${esc(it.title)} · ${it.prog}</div>
          </div>
          ${it.active ? '' : `<button class="list-del-btn" data-q-cancel="${it.id}" type="button" title="Quitar de cola">×</button>`}
        </div>
      `).join('') : '<p style="color:var(--muted);font-size:13px">No hay descargas pendientes.</p>'}
    `);

    $('qCloseBtn').addEventListener('click', closeAppSheet);
    $('qTogglePause').addEventListener('click', () => {
      state.downloadsPaused = !state.downloadsPaused;
      updateDownloadQueueBar();
      if (!state.downloadsPaused) processDownloadQueue();
      openDownloadQueueSheet();
    });
    $('qCancelAll').addEventListener('click', () => {
      state.downloadQueue = [];
      state.downloadsPaused = false;
      updateDownloadQueueBar();
      refreshVisibleAfterDownload();
      closeAppSheet();
      showToast('Cola de descargas vaciada');
    });
    appSheet.querySelectorAll('[data-q-cancel]').forEach((b) => {
      b.addEventListener('click', () => {
        const cid = Number(b.dataset.qCancel);
        state.downloadQueue = state.downloadQueue.filter((q) => q.chapter.id !== cid);
        updateDownloadQueueBar();
        refreshVisibleAfterDownload();
        openDownloadQueueSheet();
      });
    });
  }

  dlQueuePauseBtn.addEventListener('click', () => {
    state.downloadsPaused = !state.downloadsPaused;
    updateDownloadQueueBar();
    if (!state.downloadsPaused) processDownloadQueue();
  });
  dlQueueOpenBtn.addEventListener('click', openDownloadQueueSheet);

  function refreshVisibleAfterDownload() {
    updateDownloadQueueBar();
    if (!mangaView.classList.contains('hidden') && state.manga) drawMangaDetail();
    else if (state.tab === 'library') drawLibraryGrid();
    else if (state.tab === 'settings') renderSettings();
  }

  function enqueueChapterDownload(manga, chapters, chapter, silent = false, inVault = false) {
    if (inVault ? state.vaultOffline : state.offline) {
      if (!silent) showToast('Sin conexión: conéctate al PC para descargar capítulos.');
      return;
    }
    const cKey = dlKey(chapter.id, inVault);
    if (isDownloaded(chapter.id, inVault)) return;
    if (state.activeDownload && state.activeDownload.chapterKey === cKey) return;
    if (state.downloadQueue.some((q) => q.chapterKey === cKey)) return;

    state.downloadQueue.push({ manga, chapters, chapter, inVault, chapterKey: cKey });
    refreshVisibleAfterDownload();
    processDownloadQueue();
  }

  let downloadingLoop = false;
  async function processDownloadQueue() {
    if (downloadingLoop || state.downloadsPaused) return;
    downloadingLoop = true;
    try {
      while (state.downloadQueue.length > 0 && !state.downloadsPaused) {
        const job = state.downloadQueue.shift();
        const inVault = !!job.inVault;
        state.activeDownload = {
          chapterId: job.chapter.id,
          chapterKey: job.chapterKey,
          inVault,
          name: job.chapter.name,
          mangaTitle: job.manga ? job.manga.title : '',
          done: 0,
          total: 0
        };
        refreshVisibleAfterDownload();

        try {
          const pgData = await gql(M_FETCH_PAGES, { chapterId: job.chapter.id }, 25000, inVault);
          const rawPages = (pgData.fetchChapterPages && pgData.fetchChapterPages.pages) || [];
          const pages = rawPages.map((u) => assetUrl(u, inVault));
          if (!pages.length) throw new Error('Sin páginas');

          state.activeDownload.total = pages.length;
          const dlManga = job.manga ? Object.assign({}, job.manga, {
            id: dlKey(job.manga.id, inVault),
            thumbnailUrl: assetUrl(job.manga.thumbnailUrl, inVault)
          }) : null;
          const dlChap = Object.assign({}, job.chapter, {
            id: dlKey(job.chapter.id, inVault),
            mangaId: dlKey(job.manga ? job.manga.id : job.chapter.mangaId, inVault)
          });

          await Offline.downloadChapter({
            manga: dlManga,
            chapters: job.chapters,
            chapter: dlChap,
            pageUrls: pages,
            onProgress: (done, total) => {
              if (state.activeDownload && state.activeDownload.chapterKey === job.chapterKey) {
                state.activeDownload.done = done;
                state.activeDownload.total = total;
                updateDownloadQueueBar();
                const btn = mangaView.querySelector(`.chap-dl-btn[data-dl-id="${job.chapter.id}"]`);
                if (btn) btn.textContent = `${done}/${total}`;
              }
            }
          });
          await refreshDownloadsIndex();
        } catch (err) {
          showToast(`Error descargando ${job.chapter.name}: ${err.message || ''}`);
          if (!navigator.onLine) {
            state.downloadsPaused = true;
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
      updateDownloadQueueBar();
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
    if (synced > 0) showToast(`Progreso sincronizado (${synced} cap.)`);
  }

  function warmLibraryCovers(mangas) {
    if (!Offline || state.offline || !mangas.length) return;
    const list = mangas.slice(0, 60);
    let idx = 0;
    async function worker() {
      while (idx < list.length && !state.offline) {
        const m = list[idx++];
        if (m && m.id && m.thumbnailUrl) await Offline.cacheCover(m.id, m.thumbnailUrl);
      }
    }
    for (let i = 0; i < 3; i++) worker();
  }

  // ---------------- GraphQL (normal o bóveda aislada) ----------------
  async function gql(query, variables = {}, timeoutMs = 12000, inVault = false) {
    const endpoint = inVault ? VAULT_API_URL : API_URL;
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    try {
      const res = await fetch(endpoint, {
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
      if (!inVault && state.offline) setOfflineMode(false);
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
          id title thumbnailUrl inLibrary inLibraryAt unreadCount sourceId
          categories { nodes { id name } }
          firstUnreadChapter { id name chapterNumber sourceOrder }
          lastReadChapter { id name chapterNumber sourceOrder lastReadAt lastPageRead }
        }
      }
    }
  `;

  const Q_UPDATES = `
    query UpdatesList {
      chapters(
        filter: { inLibrary: { equalTo: true } }
        order: [{ by: FETCHED_AT, byType: DESC }, { by: UPLOAD_DATE, byType: DESC }]
        first: 60
      ) {
        nodes {
          id name chapterNumber mangaId fetchedAt uploadDate isRead lastPageRead pageCount
          manga { id title thumbnailUrl inLibrary sourceId }
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
          manga { id title thumbnailUrl unreadCount sourceId }
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
        categories { nodes { id name } }
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
          categories { nodes { id name } }
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

  const M_UPDATE_LIBRARY = `
    mutation UpdateLibrary {
      updateLibrary(input: {}) { clientMutationId }
    }
  `;

  const M_CREATE_CATEGORY = `
    mutation CreateCategory($name: String!) {
      createCategory(input: { name: $name }) { category { id name order } }
    }
  `;

  const M_DELETE_CATEGORY = `
    mutation DeleteCategory($id: Int!) {
      deleteCategory(input: { categoryId: $id }) { category { id } }
    }
  `;

  const M_UPDATE_MANGA_CATS = `
    mutation UpdateMangaCats($id: Int!, $catIds: [Int!]!) {
      updateMangaCategories(input: { id: $id, patch: { clearCategories: true, addToCategories: $catIds } }) {
        manga { id categories { nodes { id name } } }
      }
    }
  `;

  const M_CREATE_BACKUP = `
    mutation CreateBackup {
      createBackup(input: {}) { url }
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

  const Q_EXTENSIONS = `
    query GetExtensions {
      extensions {
        nodes {
          pkgName name lang versionName iconUrl isInstalled hasUpdate isObsolete
        }
      }
    }
  `;

  const M_FETCH_EXTENSIONS = `
    mutation FetchExtensions {
      fetchExtensions(input: {}) {
        extensions {
          pkgName name lang versionName iconUrl isInstalled hasUpdate isObsolete
        }
      }
    }
  `;

  const M_UPDATE_EXTENSION = `
    mutation UpdateExtension($id: String!, $patch: UpdateExtensionPatchInput!) {
      updateExtension(input: { id: $id, patch: $patch }) {
        extension { pkgName isInstalled hasUpdate }
      }
    }
  `;

  const M_ADD_EXT_STORE = `
    mutation AddExtStore($url: String!) {
      addExtensionStore(input: { indexUrl: $url }) {
        extensionStore { indexUrl name }
      }
    }
  `;

  // ---------------- Gestor de extensiones integrado (normal y bóveda oculta) ----------------
  let cachedExtensions = [];
  let extSearch = '';
  let extFilter = 'all'; // 'all' | 'es' | 'en' | 'installed'

  async function openExtensionsManager(forVault = false) {
    if (forVault ? state.vaultOffline : state.offline) {
      showToast('Conéctate al PC para instalar o gestionar extensiones.');
      return;
    }
    openAppSheet(`
      <div class="sheet-title">
        <span>${forVault ? '🔒 Extensiones de la bóveda' : 'Extensiones'}</span>
        <button id="extCloseTmp" class="secondary-btn" type="button" style="padding:5px 10px;font-size:12px">Cerrar</button>
      </div>
      <div class="spinner"></div>
      <p style="text-align:center;color:var(--muted);font-size:13px">Cargando catálogo de extensiones...</p>
    `);
    $('extCloseTmp').addEventListener('click', closeAppSheet);

    try {
      let data = await gql(Q_EXTENSIONS, {}, 12000, forVault);
      let list = (data.extensions && data.extensions.nodes) || [];
      if (!list.length) {
        const fetched = await gql(M_FETCH_EXTENSIONS, {}, 25000, forVault);
        list = (fetched.fetchExtensions && fetched.fetchExtensions.extensions) || [];
      }
      cachedExtensions = list;
      drawExtensionsManager(forVault);
    } catch (err) {
      openAppSheet(`
        <div class="sheet-title">
          <span>Extensiones</span>
          <button id="extErrClose" class="secondary-btn" type="button" style="padding:5px 10px;font-size:12px">Cerrar</button>
        </div>
        <p style="color:var(--muted);font-size:13px">No se pudieron cargar las extensiones: ${esc(err.message || '')}</p>
      `);
      $('extErrClose').addEventListener('click', closeAppSheet);
    }
  }

  function drawExtensionsManager(forVault = false) {
    const q = extSearch.trim().toLowerCase();
    const list = cachedExtensions
      .filter((e) => {
        if (extFilter === 'installed' && !e.isInstalled) return false;
        if (extFilter === 'es' && (e.lang || '').toLowerCase() !== 'es') return false;
        if (extFilter === 'en' && (e.lang || '').toLowerCase() !== 'en') return false;
        if (q && !(e.name || '').toLowerCase().includes(q) && !(e.lang || '').toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => Number(b.hasUpdate) - Number(a.hasUpdate) || Number(b.isInstalled) - Number(a.isInstalled) || (a.name || '').localeCompare(b.name || ''));

    const shown = list.slice(0, 80);

    openAppSheet(`
      <div class="sheet-title">
        <span>${forVault ? '🔒 Instalar extensiones (ocultas)' : 'Gestor de extensiones'}</span>
        <button id="extClose" class="secondary-btn" type="button" style="padding:5px 10px;font-size:12px">Cerrar</button>
      </div>
      ${forVault ? '<p style="margin:0 0 8px;font-size:11.5px;color:#c4b5fd">Las extensiones que instales desde aquí se ocultarán automáticamente en tu bóveda.</p>' : ''}
      <div style="display:flex;gap:6px;margin-bottom:8px">
        <div class="search-box" style="flex:1;padding:6px 10px">
          <input id="extSearchInput" type="search" placeholder="Buscar extensión..." value="${esc(extSearch)}">
        </div>
        <button id="extRefreshBtn" class="secondary-btn" type="button" style="padding:6px 9px;font-size:12px" title="Actualizar catálogo">↻</button>
        <button id="extAddRepoBtn" class="secondary-btn" type="button" style="padding:6px 9px;font-size:12px">+ Repo</button>
      </div>
      <div class="chips-row" style="margin-bottom:8px">
        <button class="chip ${extFilter === 'all' ? 'active' : ''}" data-ef="all">Todas (${cachedExtensions.length})</button>
        <button class="chip ${extFilter === 'es' ? 'active' : ''}" data-ef="es">ES</button>
        <button class="chip ${extFilter === 'en' ? 'active' : ''}" data-ef="en">EN</button>
        <button class="chip ${extFilter === 'installed' ? 'active' : ''}" data-ef="installed">Instaladas</button>
      </div>
      <div id="extListBody">
        ${shown.length ? shown.map((e) => {
          const btnTxt = e.hasUpdate ? 'Actualizar' : (e.isInstalled ? 'Quitar' : 'Instalar');
          const act = e.hasUpdate ? 'update' : (e.isInstalled ? 'uninstall' : 'install');
          const style = act === 'uninstall'
            ? 'padding:6px 10px;font-size:11.5px;color:#ff8690;border-color:rgba(255,77,90,0.35)'
            : (act === 'update' ? 'padding:6px 10px;font-size:11.5px;background:var(--green);color:#062111;border:0' : 'padding:6px 10px;font-size:11.5px;background:var(--accent);color:#fff;border:0');
          return `
            <div class="dl-storage-row">
              <img src="${esc(assetUrl(e.iconUrl, forVault))}" alt="" style="width:32px;height:32px;border-radius:7px;background:#1d2230;flex:0 0 auto" loading="lazy">
              <div style="min-width:0;flex:1">
                <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(e.name)}</div>
                <div style="font-size:11px;color:var(--muted)">${esc((e.lang || '').toUpperCase())} · v${esc(e.versionName || '')}</div>
              </div>
              <button class="secondary-btn" data-ext-pkg="${esc(e.pkgName)}" data-ext-act="${act}" type="button" style="${style}">${btnTxt}</button>
            </div>
          `;
        }).join('') : '<p style="color:var(--muted);font-size:13px;text-align:center;padding:18px 0">No hay extensiones. Pulsa "+ Repo" para añadir el repositorio Keiyoushi o uno personalizado.</p>'}
        ${list.length > shown.length ? `<p style="font-size:11.5px;color:var(--muted);text-align:center">Mostrando ${shown.length} de ${list.length}. Usa el buscador para filtrar.</p>` : ''}
      </div>
    `);

    $('extClose').addEventListener('click', closeAppSheet);
    $('extSearchInput').addEventListener('input', (ev) => {
      extSearch = ev.target.value;
      drawExtensionsManager(forVault);
      const inp = $('extSearchInput');
      if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
    });
    appSheet.querySelectorAll('[data-ef]').forEach((ch) => {
      ch.addEventListener('click', () => { extFilter = ch.dataset.ef; drawExtensionsManager(forVault); });
    });
    $('extRefreshBtn').addEventListener('click', async () => {
      showToast('Actualizando lista de extensiones...');
      try {
        const fetched = await gql(M_FETCH_EXTENSIONS, {}, 30000, forVault);
        cachedExtensions = (fetched.fetchExtensions && fetched.fetchExtensions.extensions) || cachedExtensions;
        drawExtensionsManager(forVault);
      } catch {
        showToast('Error actualizando extensiones');
      }
    });
    $('extAddRepoBtn').addEventListener('click', async () => {
      const defUrl = 'https://raw.githubusercontent.com/keiyoushi/extensions/repo/index.min.json';
      const url = prompt('Pega la URL del repositorio de extensiones (index.min.json):', defUrl);
      if (!url || !url.trim()) return;
      try {
        showToast('Añadiendo repositorio...');
        await gql(M_ADD_EXT_STORE, { url: url.trim() }, 15000, forVault);
        const fetched = await gql(M_FETCH_EXTENSIONS, {}, 30000, forVault);
        cachedExtensions = (fetched.fetchExtensions && fetched.fetchExtensions.extensions) || cachedExtensions;
        showToast('Repositorio añadido');
        drawExtensionsManager(forVault);
      } catch (err) {
        showToast('Error añadiendo repo: ' + (err.message || ''));
      }
    });

    appSheet.querySelectorAll('[data-ext-pkg]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const pkg = btn.dataset.extPkg;
        const act = btn.dataset.extAct;
        btn.disabled = true;
        btn.textContent = '...';

        try {
          const patch = {};
          patch[act] = true;
          await gql(M_UPDATE_EXTENSION, { id: pkg, patch }, 30000, forVault);

          const extObj = cachedExtensions.find((x) => x.pkgName === pkg);
          if (extObj) {
            if (act === 'install') extObj.isInstalled = true;
            if (act === 'uninstall') { extObj.isInstalled = false; extObj.hasUpdate = false; }
            if (act === 'update') extObj.hasUpdate = false;
          }

          if (forVault) {
            await loadVaultData();
            showToast(act === 'uninstall' ? 'Extensión quitada de la bóveda' : 'Extensión instalada SOLO en la bóveda');
            drawExtensionsManager(true);
            renderVault();
          } else {
            state.sources = [];
            await ensureAllSourcesLoaded();
            showToast(act === 'uninstall' ? 'Extensión desinstalada' : 'Extensión instalada');
            drawExtensionsManager(false);
            if (state.tab === 'explore') renderExplore();
          }
        } catch (err) {
          showToast('Error: ' + (err.message || 'no se pudo completar'));
          btn.disabled = false;
          drawExtensionsManager(forVault);
        }
      });
    });
  }

  // ---------------- Enrutado ----------------
  function navigateHash(hash) {
    if (location.hash === hash) handleRoute();
    else location.hash = hash;
  }

  window.addEventListener('hashchange', handleRoute);

  async function handleRoute() {
    const raw = (location.hash || '#library').replace(/^#/, '');
    const parts = raw.split('/');
    const view = parts[0] || 'library';

    if ((view === 'read' || view === 'vread') && parts[1] && parts[2]) {
      const mId = parseInt(parts[1], 10);
      const cId = parseInt(parts[2], 10);
      const pg = parts[3] ? parseInt(parts[3], 10) : null;
      const inVault = (view === 'vread');
      if (inVault && !state.vaultOpen) {
        navigateHash('#library');
        return;
      }
      if (mId && cId) {
        await openReader(mId, cId, pg, inVault);
        return;
      }
    } else if (state.reader.open) {
      closeReaderUi();
    }

    if ((view === 'manga' || view === 'vmanga') && parts[1]) {
      const mId = parseInt(parts[1], 10);
      const inVault = (view === 'vmanga');
      if (inVault && !state.vaultOpen) {
        navigateHash('#library');
        return;
      }
      if (mId) {
        await openMangaDetail(mId, false, inVault);
        return;
      }
    } else {
      mangaView.classList.add('hidden');
      if (state.vaultOpen) renderVault();
    }

    const validTabs = ['library', 'updates', 'recent', 'explore', 'settings'];
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

  async function renderCurrentTab(forceReload = false) {
    if (state.tab === 'library') await renderLibrary(forceReload);
    else if (state.tab === 'updates') await renderUpdates();
    else if (state.tab === 'recent') await renderRecent();
    else if (state.tab === 'explore') await renderExplore();
    else if (state.tab === 'settings') await renderSettings();
  }

  // ---------------- BIBLIOTECA ----------------
  function openCategoriesManager() {
    const custom = state.categories.filter((c) => c.id !== 0);
    openAppSheet(`
      <div class="sheet-title">
        <span>Categorías</span>
        <button id="catClose" class="secondary-btn" type="button" style="padding:5px 10px;font-size:12px">Cerrar</button>
      </div>
      <form id="catAddForm" style="display:flex;gap:8px;margin-bottom:12px">
        <input id="catNewName" type="text" placeholder="Nueva categoría..." style="flex:1;background:var(--bg-card);border:1px solid var(--border);border-radius:10px;padding:8px 10px">
        <button class="primary-btn" type="submit" style="width:auto;padding:8px 14px;font-size:13px">Crear</button>
      </form>
      ${custom.length ? custom.map((c) => `
        <div class="dl-storage-row">
          <strong style="font-size:13.5px">${esc(c.name)}</strong>
          <button class="list-del-btn" data-del-cat="${c.id}" type="button" title="Eliminar categoría">×</button>
        </div>
      `).join('') : '<p style="color:var(--muted);font-size:13px">Aún no has creado categorías personalizadas.</p>'}
    `);

    $('catClose').addEventListener('click', closeAppSheet);
    $('catAddForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = $('catNewName').value.trim();
      if (!name) return;
      try {
        await gql(M_CREATE_CATEGORY, { name });
        showToast(`Categoría "${name}" creada`);
        closeAppSheet();
        renderLibrary(true);
      } catch (err) {
        showToast('Error creando categoría: ' + (err.message || ''));
      }
    });
    appSheet.querySelectorAll('[data-del-cat]').forEach((b) => {
      b.addEventListener('click', async () => {
        if (!confirm('¿Eliminar esta categoría? (No borra los mangas).')) return;
        try {
          await gql(M_DELETE_CATEGORY, { id: Number(b.dataset.delCat) });
          showToast('Categoría eliminada');
          closeAppSheet();
          renderLibrary(true);
        } catch (err) {
          showToast('Error eliminando categoría');
        }
      });
    });
  }

  async function renderLibrary(forceReload = false) {
    headerTitle.textContent = 'Biblioteca';
    headerActions.innerHTML = `
      ${!state.offline ? `<button id="libCatsBtn" class="secondary-btn" type="button" style="padding:6px 9px;font-size:11.5px">Categorías</button>` : ''}
      <button id="libUpdateBtn" class="icon-btn" type="button" title="Actualizar biblioteca" aria-label="Actualizar biblioteca">
        <svg viewBox="0 0 24 24"><path d="M17.6 6.4A8 8 0 1 0 20 12h-2a6 6 0 1 1-1.8-4.2L13 11h7V4l-2.4 2.4z"/></svg>
      </button>
    `;
    const catsBtn = $('libCatsBtn');
    if (catsBtn) catsBtn.addEventListener('click', openCategoriesManager);
    $('libUpdateBtn').addEventListener('click', async () => {
      if (!state.offline) {
        try {
          await gql(M_UPDATE_LIBRARY);
          showToast('Actualizando capítulos nuevos en el servidor...');
        } catch { }
      }
      renderLibrary(true);
    });

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

    headerSub.classList.remove('hidden');
    const visibleAll = state.library.filter((m) => !isMangaSecret(m));
    const usedCats = state.categories.filter((c) => c.id !== 0);
    const dlMangasCount = visibleAll.filter((m) => mangaDownloadCount(m.id) > 0).length;

    headerSub.innerHTML = `
      <div style="display:flex;gap:8px;align-items:center">
        <div class="search-box" style="flex:1">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="#8e98a8"><path d="M15.5 14h-.8l-.3-.3a6.5 6.5 0 1 0-.7.7l.3.3v.8l5 5 1.5-1.5-5-5zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14z"/></svg>
          <input id="libSearchInput" type="search" placeholder="Buscar en tu biblioteca..." value="${esc(state.librarySearch)}">
        </div>
        <select id="libSortSelect" class="select-pill" aria-label="Ordenar biblioteca">
          <option value="title" ${state.librarySort === 'title' ? 'selected' : ''}>A-Z</option>
          <option value="lastRead" ${state.librarySort === 'lastRead' ? 'selected' : ''}>Últ. leído</option>
          <option value="unread" ${state.librarySort === 'unread' ? 'selected' : ''}>Sin leer</option>
          <option value="added" ${state.librarySort === 'added' ? 'selected' : ''}>Añadidos</option>
        </select>
      </div>
      <div class="chips-row">
        <button class="chip ${state.onlyDownloaded ? 'active' : ''}" id="chipOnlyDl">↓ Descargados (${dlMangasCount})</button>
        <button class="chip ${!state.onlyDownloaded && state.selectedCat === 'all' ? 'active' : ''}" data-cat="all">Todos (${visibleAll.length})</button>
        ${usedCats.map((c) => `<button class="chip ${!state.onlyDownloaded && String(state.selectedCat) === String(c.id) ? 'active' : ''}" data-cat="${c.id}">${esc(c.name)}</button>`).join('')}
      </div>
    `;

    $('libSearchInput').addEventListener('input', (e) => {
      state.librarySearch = e.target.value;
      drawLibraryGrid();
    });
    $('libSortSelect').addEventListener('change', (e) => {
      state.librarySort = e.target.value;
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
      if (isMangaSecret(m)) return false;
      if (q && !m.title.toLowerCase().includes(q)) return false;
      if (state.onlyDownloaded && mangaDownloadCount(m.id) === 0) return false;
      if (!state.onlyDownloaded && state.selectedCat !== 'all') {
        const cats = (m.categories && m.categories.nodes) || [];
        return cats.some((c) => String(c.id) === String(state.selectedCat));
      }
      return true;
    });

    list = list.slice().sort((a, b) => {
      if (state.offline) {
        const da = mangaDownloadCount(a.id) > 0 ? 1 : 0;
        const db = mangaDownloadCount(b.id) > 0 ? 1 : 0;
        if (db !== da) return db - da;
      }
      if (state.librarySort === 'lastRead') {
        const ta = Number((a.lastReadChapter && a.lastReadChapter.lastReadAt) || 0);
        const tb = Number((b.lastReadChapter && b.lastReadChapter.lastReadAt) || 0);
        if (tb !== ta) return tb - ta;
      } else if (state.librarySort === 'unread') {
        const ua = Number(a.unreadCount || 0);
        const ub = Number(b.unreadCount || 0);
        if (ub !== ua) return ub - ua;
      } else if (state.librarySort === 'added') {
        const ia = Number(a.inLibraryAt || 0);
        const ib = Number(b.inLibraryAt || 0);
        if (ib !== ia) return ib - ia;
      }
      return (a.title || '').localeCompare(b.title || '');
    });

    if (!list.length) {
      mainContent.innerHTML = `
        <div class="empty-state">
          <h3>${state.onlyDownloaded ? 'Sin capítulos descargados' : (state.offline ? 'Sin conexión y sin datos guardados' : 'Sin resultados')}</h3>
          <p>${state.onlyDownloaded ? 'Abre un manga con el PC encendido y pulsa ↓ para descargar capítulos.' : 'Prueba con otro filtro o añade mangas desde Explorar.'}</p>
        </div>
      `;
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

  // ---------------- NOVEDADES ----------------
  async function renderUpdates() {
    headerTitle.textContent = 'Novedades';
    headerActions.innerHTML = `
      <button id="updRefreshBtn" class="secondary-btn" type="button" style="padding:6px 10px;font-size:12px">Buscar nuevos</button>
    `;
    $('updRefreshBtn').addEventListener('click', async () => {
      if (state.offline) { showToast('Sin conexión con el PC'); return; }
      try {
        await gql(M_UPDATE_LIBRARY);
        showToast('Buscando capítulos nuevos en tu biblioteca...');
        setTimeout(() => { if (state.tab === 'updates') renderUpdates(); }, 3000);
      } catch {
        showToast('No se pudo actualizar la biblioteca');
      }
    });
    headerSub.classList.add('hidden');
    mainContent.innerHTML = '<div class="spinner"></div>';
    await refreshDownloadsIndex();

    try {
      const data = await gql(Q_UPDATES, {}, 8000);
      state.updates = (data.chapters && data.chapters.nodes) || [];
      setOfflineMode(false);
      if (Offline) Offline.saveSnapshot('updates', state.updates);
    } catch {
      setOfflineMode(true);
      state.updates = (Offline ? await Offline.getSnapshot('updates') : null) || [];
    }

    const visibleUpdates = state.updates.filter((ch) => ch.manga && !isMangaSecret(ch.manga));
    if (!visibleUpdates.length) {
      mainContent.innerHTML = `
        <div class="empty-state">
          <h3>Sin novedades todavía</h3>
          <p>Pulsa "Buscar nuevos" para comprobar si hay capítulos recientes en tu biblioteca.</p>
        </div>
      `;
      return;
    }

    mainContent.innerHTML = `<div class="list-stack">${visibleUpdates.map((ch) => {
      if (!ch.manga) return '';
      const dl = isDownloaded(ch.id);
      const locked = state.offline && !dl;
      return `
        <div class="list-card ${locked ? 'offline-dim' : ''}" data-manga-id="${ch.manga.id}">
          <img class="list-thumb" src="${esc(coverUrlFor(ch.manga))}" data-cover-id="${ch.manga.id}" alt="" loading="lazy">
          <div class="list-body">
            <div class="list-title">${esc(ch.manga.title)}</div>
            <div class="list-sub" style="${ch.isRead ? '' : 'color:#fff;font-weight:600'}">${esc(ch.name)} ${dl ? '· ✓' : ''}</div>
            <div class="list-sub">${formatDate(ch.uploadDate || ch.fetchedAt)}</div>
          </div>
          <button class="list-cta" data-upd-read="${ch.manga.id}:${ch.id}" type="button">${locked ? 'Sin red' : 'Leer'}</button>
        </div>
      `;
    }).join('')}</div>`;

    attachCoverFallbacks(mainContent);
    mainContent.querySelectorAll('.list-card').forEach((card) => {
      card.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-upd-read]');
        if (btn) {
          e.stopPropagation();
          const [mId, cId] = btn.dataset.updRead.split(':').map(Number);
          if (state.offline && !isDownloaded(cId)) {
            showToast('No descargado. Conéctate al PC para leer este capítulo.');
            return;
          }
          navigateHash(`#read/${mId}/${cId}`);
          return;
        }
        navigateHash('#manga/' + card.dataset.mangaId);
      });
    });
  }

  // ---------------- RECIENTES + BORRAR HISTORIAL (TOTAL O INDIVIDUAL) ----------------
  let clearingHistory = false;

  async function runClearHistory(mangaId = 0, mangaTitle = '') {
    if (clearingHistory) return;
    const isSingle = Number(mangaId) > 0;
    if (state.offline) {
      const msgOff = isSingle
        ? `Estás sin conexión con el PC. ¿Quitar "${mangaTitle}" solo de recientes locales en este móvil?`
        : 'Estás sin conexión con el PC. ¿Limpiar solo la lista local de recientes en este móvil?';
      if (confirm(msgOff)) {
        state.recent = isSingle
          ? state.recent.filter((ch) => !ch.manga || Number(ch.manga.id) !== Number(mangaId))
          : [];
        if (Offline) await Offline.saveSnapshot('recent', state.recent);
        showToast(isSingle ? 'Quitado de recientes locales' : 'Lista local de recientes vaciada');
        if (state.tab === 'recent') renderRecent();
      }
      return;
    }

    const ok = confirm(
      (isSingle
        ? `Se quitará "${mangaTitle}" del historial de lectura en Suwayomi.\n\n`
        : 'Se borrará TODO el historial de lectura en Suwayomi.\n\n') +
      '• Los capítulos siguen marcados como leídos.\n' +
      '• Se conservan la biblioteca, el progreso y las descargas.\n' +
      '• Se hace copia de seguridad automática de la base de datos.\n' +
      '• Suwayomi se reiniciará unos segundos.\n\n¿Continuar?'
    );
    if (!ok) return;

    clearingHistory = true;
    showToast(isSingle ? `Quitando "${mangaTitle}" del historial...` : 'Borrando historial y reiniciando Suwayomi...');
    if (state.tab === 'recent') {
      mainContent.innerHTML = `<div class="empty-state"><div class="spinner"></div><h3>${isSingle ? 'Quitando del historial...' : 'Borrando historial...'}</h3><p>Suwayomi se está reiniciando (tarda unos segundos).</p></div>`;
    }

    try {
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), 45000) : null;
      const url = isSingle
        ? `/movil/__action__/clear-history?mangaId=${encodeURIComponent(String(mangaId))}`
        : '/movil/__action__/clear-history';
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'X-Suwayomi-Action': 'clear-history' },
        signal: ctrl ? ctrl.signal : undefined
      });
      if (timer) clearTimeout(timer);
      let data = {};
      try { data = await res.json(); } catch { }
      if (!res.ok || !data.ok) throw new Error(data.error || `Error HTTP ${res.status}`);
      state.recent = isSingle
        ? state.recent.filter((ch) => !ch.manga || Number(ch.manga.id) !== Number(mangaId))
        : [];
      if (Offline) await Offline.saveSnapshot('recent', state.recent);
      showToast(isSingle ? `"${mangaTitle}" quitado del historial` : 'Historial borrado correctamente');
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
      <button id="recentClearBtn" class="secondary-btn" type="button" style="padding:6px 10px;font-size:12px;color:#ff8690;border-color:rgba(255,77,90,0.35)">Borrar todo</button>
    `;
    $('recentClearBtn').addEventListener('click', () => runClearHistory(0, ''));
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
      state.recent = (Offline ? await Offline.getSnapshot('recent') : null) || [];
    }

    const visibleRecent = state.recent.filter((ch) => ch.manga && !isMangaSecret(ch.manga));
    if (!visibleRecent.length) {
      mainContent.innerHTML = `
        <div class="empty-state">
          <h3>${state.offline ? 'Sin lecturas recientes guardadas' : 'Aún no hay lecturas recientes'}</h3>
          <p>${state.offline ? 'Tus capítulos descargados están disponibles en Biblioteca.' : 'Cuando abras un capítulo aparecerá aquí para retomarlo con un toque.'}</p>
        </div>
      `;
      return;
    }

    mainContent.innerHTML = `<div class="list-stack">${visibleRecent.map((ch) => {
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
          <button class="list-del-btn" data-del-hist-manga="${ch.manga.id}" data-del-hist-title="${esc(ch.manga.title)}" type="button" title="Quitar del historial" aria-label="Quitar del historial">×</button>
        </div>
      `;
    }).join('')}</div>`;

    attachCoverFallbacks(mainContent);
    mainContent.querySelectorAll('.list-card').forEach((card) => {
      card.addEventListener('click', (e) => {
        const delBtn = e.target.closest('.list-del-btn');
        if (delBtn) {
          e.stopPropagation();
          runClearHistory(Number(delBtn.dataset.delHistManga), delBtn.dataset.delHistTitle || '');
          return;
        }
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

  // ---------------- EXPLORAR + BÚSQUEDA GLOBAL ----------------
  async function runGlobalSearch(query) {
    state.globalSearchQuery = query;
    state.globalSearchResults = [];
    if (!query) { renderExplore(); return; }

    const publicSources = state.sources.filter((s) => !Extras || !Extras.isSourceHidden(s.id));
    mainContent.innerHTML = `<div class="empty-state"><div class="spinner"></div><p>Buscando "${esc(query)}" en ${publicSources.length} fuente(s)...</p></div>`;
    const results = await Promise.all(publicSources.map(async (src) => {
      try {
        const data = await gql(M_SOURCE_MANGAS, {
          input: { source: String(src.id), type: 'SEARCH', page: 1, query }
        }, 12000);
        const mangas = (data.fetchSourceManga && data.fetchSourceManga.mangas) || [];
        return { source: src, mangas: mangas.slice(0, 12) };
      } catch {
        return { source: src, mangas: [] };
      }
    }));
    state.globalSearchResults = results.filter((r) => r.mangas.length > 0);
    drawGlobalSearchResults();
  }

  function drawGlobalSearchResults() {
    if (!state.globalSearchResults.length) {
      mainContent.innerHTML = `
        <div class="empty-state">
          <h3>Sin resultados para "${esc(state.globalSearchQuery)}"</h3>
          <p>Prueba con otro término o revisa tus fuentes instaladas.</p>
          <button id="clearGlobalBtn" class="secondary-btn" type="button">Ver fuentes</button>
        </div>
      `;
      $('clearGlobalBtn').addEventListener('click', () => { state.globalSearchQuery = ''; renderExplore(); });
      return;
    }

    mainContent.innerHTML = state.globalSearchResults.map((grp) => `
      <div style="margin-bottom:18px">
        <div style="font-size:13px;font-weight:700;color:var(--muted);margin:0 0 8px">${esc(grp.source.name)} (${grp.mangas.length})</div>
        <div class="manga-grid">${grp.mangas.map((m) => `
          <div class="manga-card" data-manga-id="${m.id}">
            <div class="manga-cover-wrap">
              <img src="${esc(m.thumbnailUrl || '')}" alt="" loading="lazy">
              <div class="manga-cover-grad"></div>
              ${m.inLibrary ? '<span class="manga-badge in-lib">En biblioteca</span>' : ''}
              <div class="manga-card-title">${esc(m.title)}</div>
            </div>
          </div>
        `).join('')}</div>
      </div>
    `).join('');

    mainContent.querySelectorAll('.manga-card').forEach((card) => {
      card.addEventListener('click', () => navigateHash('#manga/' + card.dataset.mangaId));
    });
  }

  async function renderExplore() {
    if (state.activeSource && !state.offline) {
      renderSourceBrowser();
      return;
    }
    headerTitle.textContent = 'Explorar';
    headerActions.innerHTML = state.offline
      ? ''
      : '<button id="expExtBtn" class="secondary-btn" type="button" style="padding:6px 10px;font-size:12px">+ Extensiones</button>';
    const expExtBtn = $('expExtBtn');
    if (expExtBtn) expExtBtn.addEventListener('click', () => openExtensionsManager(false));
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
          <p>Mientras el PC está apagado puedes leer tus capítulos descargados en Biblioteca.</p>
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

    const publicSources = state.sources.filter((s) => !Extras || !Extras.isSourceHidden(s.id));
    if (!publicSources.length) {
      mainContent.innerHTML = `
        <div class="empty-state">
          <h3>No hay fuentes visibles</h3>
          <p>Instala extensiones directamente desde aquí sin tener que abrir Suwayomi en el PC.</p>
          <button id="expEmptyExtBtn" class="primary-btn" type="button" style="max-width:240px">Instalar extensiones</button>
        </div>
      `;
      $('expEmptyExtBtn').addEventListener('click', () => openExtensionsManager(false));
      return;
    }

    headerSub.classList.remove('hidden');
    headerSub.innerHTML = `
      <form id="globalSearchForm" class="search-box">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="#8e98a8"><path d="M15.5 14h-.8l-.3-.3a6.5 6.5 0 1 0-.7.7l.3.3v.8l5 5 1.5-1.5-5-5zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14z"/></svg>
        <input id="globalSearchInput" type="search" placeholder="Buscar en todas las fuentes..." value="${esc(state.globalSearchQuery)}">
      </form>
    `;
    $('globalSearchForm').addEventListener('submit', (e) => {
      e.preventDefault();
      runGlobalSearch($('globalSearchInput').value.trim());
    });

    if (state.globalSearchQuery && state.globalSearchResults.length) {
      drawGlobalSearchResults();
      return;
    }

    mainContent.innerHTML = `<div class="list-stack">${publicSources.map((s) => `
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
    headerActions.innerHTML = `<button id="srcBackBtn" class="secondary-btn" type="button" style="padding:6px 10px;font-size:12px">‹ Fuentes</button>`;
    $('srcBackBtn').addEventListener('click', () => { state.activeSource = null; renderExplore(); });

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

    if (loadNow || !state.sourceMangas.length) await loadSourcePage();
    else drawSourceGrid();
  }

  async function loadSourcePage() {
    if (state.sourcePage === 1) mainContent.innerHTML = '<div class="spinner"></div>';
    try {
      const input = { source: String(state.activeSource.id), type: state.sourceMode, page: state.sourcePage };
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

  // ---------------- AJUSTES (Descargas, Cuota, Estadísticas, Marcadores, PIN, Backup) ----------------
  async function renderSettings() {
    headerTitle.textContent = 'Ajustes';
    headerActions.innerHTML = '';
    headerSub.classList.add('hidden');
    const p = state.prefs;

    await refreshDownloadsIndex();
    const rawDl = Offline ? await Offline.listDownloads() : [];
    const allDl = rawDl.filter((d) => !String(d.chapterId).startsWith('v_') && (!Extras || !Extras.isMangaHidden(d.mangaId)));
    const pendingSyncs = Offline ? await Offline.getPendingSyncs() : [];
    const totalBytes = allDl.reduce((acc, d) => acc + (d.bytes || 0), 0);
    const est = Extras ? await Extras.getStorageEstimate() : null;
    const stats = Extras ? Extras.getStats() : { chaptersCompleted: 0, secondsRead: 0, pagesViewed: 0 };
    const bookmarks = (Extras ? Extras.getPageBookmarks() : []).filter((bm) => !Extras || !Extras.isMangaHidden(bm.mangaId));
    const visibleLibCount = state.library.filter((m) => !isMangaSecret(m)).length;

    const byManga = new Map();
    for (const d of allDl) {
      const cur = byManga.get(d.mangaId) || { mangaId: d.mangaId, title: d.mangaTitle || `Manga #${d.mangaId}`, count: 0, bytes: 0 };
      cur.count += 1;
      cur.bytes += (d.bytes || 0);
      byManga.set(d.mangaId, cur);
    }
    const mangaGroups = Array.from(byManga.values()).sort((a, b) => b.bytes - a.bytes);

    let quotaHtml = '';
    if (est && est.quota > 0) {
      const pct = Math.min(100, Math.round((est.usage / est.quota) * 100));
      quotaHtml = `
        <div style="font-size:11.5px;color:var(--muted)">
          Espacio del navegador: ${Offline.formatBytes(est.usage)} / ${Offline.formatBytes(est.quota)} (${pct}%)
          ${pct >= 80 ? ' · <strong style="color:#ff8690">Poco espacio</strong>' : ''}
        </div>
        <div class="quota-bar-track"><div class="quota-bar-fill ${pct >= 80 ? 'warn' : ''}" style="width:${Math.max(2, pct)}%"></div></div>
      `;
    }

    const minsRead = Math.round((stats.secondsRead || 0) / 60);

    mainContent.innerHTML = `
      <div class="settings-card">
        <div style="font-size:14px;font-weight:700;margin-bottom:4px">Estadísticas en este móvil</div>
        <div class="stats-grid">
          <div class="stat-tile"><strong>${visibleLibCount}</strong><span>En biblioteca</span></div>
          <div class="stat-tile"><strong>${stats.chaptersCompleted}</strong><span>Cap. leídos</span></div>
          <div class="stat-tile"><strong>${minsRead}m</strong><span>Tiempo leído</span></div>
        </div>
      </div>

      <div class="settings-card">
        <div style="font-size:14px;font-weight:700;margin-bottom:4px">Descargas sin conexión (tipo Spotify)</div>
        <div style="font-size:13px;color:var(--muted);margin-bottom:6px">
          ${allDl.length} capítulo(s) guardados · <strong>${Offline ? Offline.formatBytes(totalBytes) : '0 B'}</strong>
          ${pendingSyncs.length ? `<br><span style="color:#f6d57a">${pendingSyncs.length} lectura(s) offline pendientes de sincronizar.</span>` : ''}
        </div>
        ${quotaHtml}
        <div class="setting-group" style="margin-top:10px">
          <span class="setting-label">Auto-descargar siguientes al leer</span>
          <div class="seg-control" style="grid-template-columns:repeat(4,1fr)">
            ${[0, 1, 3, 5].map((n) => `<button class="seg-btn ${p.autoDlNext === n ? 'active' : ''}" data-pref-autodl="${n}">${n === 0 ? 'No' : '+' + n}</button>`).join('')}
          </div>
        </div>
        <div class="setting-group">
          <span class="setting-label">Borrar descarga del móvil al terminar capítulo</span>
          <div class="seg-control two">
            <button class="seg-btn ${!p.autoDelRead ? 'active' : ''}" data-pref-autodel="0">Conservar</button>
            <button class="seg-btn ${p.autoDelRead ? 'active' : ''}" data-pref-autodel="1">Borrar al leer</button>
          </div>
        </div>
        ${mangaGroups.map((g) => `
          <div class="dl-storage-row">
            <div style="min-width:0;flex:1">
              <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(g.title)}</div>
              <div style="font-size:11.5px;color:var(--muted)">${g.count} cap. · ${Offline.formatBytes(g.bytes)}</div>
            </div>
            <button class="secondary-btn" data-del-manga-dl="${g.mangaId}" type="button" style="padding:6px 10px;font-size:12px">Borrar</button>
          </div>
        `).join('')}
        ${allDl.length ? '<button id="delAllDlBtn" class="secondary-btn" type="button" style="width:100%;margin-top:10px;color:#ff8690;border-color:rgba(255,77,90,0.35)">Borrar todas las descargas</button>' : ''}
      </div>

      <div class="settings-card">
        <div style="font-size:14px;font-weight:700;margin-bottom:8px">Lector por defecto</div>
        <div class="setting-group">
          <span class="setting-label">Modo de lectura</span>
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
          <span class="setting-label">Espacio entre páginas (vertical)</span>
          <div class="seg-control two">
            <button class="seg-btn ${!p.gap ? 'active' : ''}" data-pref-gap="0">Sin espacio (PDF)</button>
            <button class="seg-btn ${p.gap ? 'active' : ''}" data-pref-gap="1">Con separación</button>
          </div>
        </div>
        <div class="setting-group">
          <span class="setting-label">Paso automático al siguiente capítulo</span>
          <div class="seg-control two">
            <button class="seg-btn ${p.autoNext ? 'active' : ''}" data-pref-autonext="1">Activado</button>
            <button class="seg-btn ${!p.autoNext ? 'active' : ''}" data-pref-autonext="0">Manual</button>
          </div>
        </div>
        <div class="setting-group">
          <span class="setting-label">Mantener pantalla encendida al leer (Wake Lock)</span>
          <div class="seg-control two">
            <button class="seg-btn ${p.wakeLock ? 'active' : ''}" data-pref-wake="1">Sí</button>
            <button class="seg-btn ${!p.wakeLock ? 'active' : ''}" data-pref-wake="0">No</button>
          </div>
        </div>
        <div class="setting-group">
          <span class="setting-label">Recortar márgenes blancos automáticamente</span>
          <div class="seg-control two">
            <button class="seg-btn ${!p.cropMargins ? 'active' : ''}" data-pref-crop="0">No</button>
            <button class="seg-btn ${p.cropMargins ? 'active' : ''}" data-pref-crop="1">Sí</button>
          </div>
        </div>
        <div class="setting-group">
          <span class="setting-label">Doble página en horizontal / tablet (paginado)</span>
          <div class="seg-control two">
            <button class="seg-btn ${p.doublePage ? 'active' : ''}" data-pref-dbl="1">Sí</button>
            <button class="seg-btn ${!p.doublePage ? 'active' : ''}" data-pref-dbl="0">No</button>
          </div>
        </div>
        <div class="setting-group" style="margin-bottom:0">
          <span class="setting-label">Filtro nocturno: <strong id="setDimVal">${p.dim}%</strong></span>
          <input id="setDimSlider" type="range" min="0" max="70" step="5" value="${p.dim}" style="width:100%;accent-color:var(--accent)">
        </div>
      </div>

      ${bookmarks.length ? `
      <div class="settings-card">
        <div style="font-size:14px;font-weight:700;margin-bottom:6px">Páginas marcadas (${bookmarks.length})</div>
        ${bookmarks.slice(0, 15).map((bm) => `
          <div class="dl-storage-row">
            <div style="min-width:0;flex:1;cursor:pointer" data-open-bm="${bm.mangaId}:${bm.chapterId}:${bm.pageIdx}">
              <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(bm.mangaTitle)}</div>
              <div style="font-size:11.5px;color:var(--muted)">${esc(bm.chapterName)} · Pág. ${bm.pageIdx + 1}</div>
            </div>
            <button class="list-del-btn" data-del-bm="${bm.chapterId}:${bm.pageIdx}" type="button">×</button>
          </div>
        `).join('')}
      </div>` : ''}

      <div class="settings-card">
        <div style="font-size:14px;font-weight:700;margin-bottom:8px">Privacidad, copias y app</div>
        <div style="display:flex;gap:8px;margin-bottom:10px">
          <button id="pinToggleBtn" class="secondary-btn" type="button" style="flex:1">
            ${Extras && Extras.hasPin() ? 'Quitar bloqueo PIN' : 'Activar bloqueo PIN (4 dígitos)'}
          </button>
          ${!state.offline ? '<button id="exportBackupBtn" class="secondary-btn" type="button">Backup .tachibk</button>' : ''}
        </div>
        ${!isStandaloneApp() ? `<button id="settingsInstallBtn" class="primary-btn" type="button" style="margin-bottom:10px">${deferredInstallPrompt ? 'Instalar app ahora' : 'Cómo instalar en pantalla de inicio'}</button>` : ''}
        <a href="/" class="secondary-btn" style="display:block;text-align:center;text-decoration:none;margin-bottom:10px">
          Abrir Suwayomi completo (instalar extensiones)
        </a>
        <button id="settingsClearHistBtn" class="secondary-btn" type="button" style="width:100%;margin-bottom:10px;color:#ff8690;border-color:rgba(255,77,90,0.35)">
          Borrar historial de lectura
        </button>
        <button id="settingsVaultBtn" class="secondary-btn" type="button" style="width:100%;font-size:12px;color:var(--muted)">
          Bóveda privada (acceso rápido: 5 toques en "Biblioteca")
        </button>
      </div>
    `;

    // Bindings de ajustes
    mainContent.querySelectorAll('[data-pref-autodl]').forEach((b) => {
      b.addEventListener('click', () => { state.prefs.autoDlNext = Number(b.dataset.prefAutodl); savePrefs(); renderSettings(); });
    });
    mainContent.querySelectorAll('[data-pref-autodel]').forEach((b) => {
      b.addEventListener('click', () => { state.prefs.autoDelRead = b.dataset.prefAutodel === '1'; savePrefs(); renderSettings(); });
    });
    mainContent.querySelectorAll('[data-pref-mode]').forEach((b) => {
      b.addEventListener('click', () => { state.prefs.mode = b.dataset.prefMode; savePrefs(); renderSettings(); });
    });
    mainContent.querySelectorAll('[data-pref-fit]').forEach((b) => {
      b.addEventListener('click', () => { state.prefs.fit = b.dataset.prefFit; savePrefs(); renderSettings(); });
    });
    mainContent.querySelectorAll('[data-pref-gap]').forEach((b) => {
      b.addEventListener('click', () => { state.prefs.gap = b.dataset.prefGap === '1'; savePrefs(); renderSettings(); });
    });
    mainContent.querySelectorAll('[data-pref-autonext]').forEach((b) => {
      b.addEventListener('click', () => { state.prefs.autoNext = b.dataset.prefAutonext === '1'; savePrefs(); renderSettings(); });
    });
    mainContent.querySelectorAll('[data-pref-wake]').forEach((b) => {
      b.addEventListener('click', () => { state.prefs.wakeLock = b.dataset.prefWake === '1'; savePrefs(); renderSettings(); });
    });
    mainContent.querySelectorAll('[data-pref-crop]').forEach((b) => {
      b.addEventListener('click', () => { state.prefs.cropMargins = b.dataset.prefCrop === '1'; savePrefs(); renderSettings(); });
    });
    mainContent.querySelectorAll('[data-pref-dbl]').forEach((b) => {
      b.addEventListener('click', () => { state.prefs.doublePage = b.dataset.prefDbl === '1'; savePrefs(); renderSettings(); });
    });
    $('setDimSlider').addEventListener('input', (e) => {
      state.prefs.dim = parseInt(e.target.value, 10) || 0;
      $('setDimVal').textContent = state.prefs.dim + '%';
      savePrefs();
    });

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
        for (const d of allDl) {
          await Offline.deleteDownload(d.chapterId);
        }
        await refreshDownloadsIndex();
        showToast('Todas las descargas borradas');
        renderSettings();
      });
    }

    mainContent.querySelectorAll('[data-open-bm]').forEach((el) => {
      el.addEventListener('click', () => {
        const [mId, cId, pIdx] = el.dataset.openBm.split(':').map(Number);
        navigateHash(`#read/${mId}/${cId}/${pIdx}`);
      });
    });
    mainContent.querySelectorAll('[data-del-bm]').forEach((el) => {
      el.addEventListener('click', () => {
        const [cId, pIdx] = el.dataset.delBm.split(':').map(Number);
        Extras.removePageBookmark(cId, pIdx);
        renderSettings();
      });
    });

    $('pinToggleBtn').addEventListener('click', () => {
      if (Extras.hasPin()) {
        showPinPrompt('PIN actual para desactivar', async (code) => {
          if (await Extras.verifyPin(code)) {
            Extras.clearPin();
            hidePinPrompt();
            showToast('Bloqueo PIN desactivado');
            renderSettings();
          } else {
            pinBuffer = '';
            pinErr.textContent = 'PIN incorrecto';
            renderPinDots();
          }
        });
      } else {
        showPinPrompt('Elige un PIN de 4 dígitos', async (first) => {
          showPinPrompt('Repite el PIN para confirmar', async (second) => {
            if (first === second) {
              await Extras.setPin(first);
              hidePinPrompt();
              showToast('Bloqueo PIN activado');
              renderSettings();
            } else {
              pinBuffer = '';
              pinErr.textContent = 'No coinciden, inténtalo de nuevo';
              renderPinDots();
            }
          });
        });
      }
    });

    const expBk = $('exportBackupBtn');
    if (expBk) {
      expBk.addEventListener('click', async () => {
        try {
          showToast('Generando copia .tachibk...');
          const d = await gql(M_CREATE_BACKUP, {}, 25000);
          const url = d.createBackup && d.createBackup.url;
          if (!url) throw new Error('Sin URL de backup');
          const a = document.createElement('a');
          a.href = url;
          a.download = 'suwayomi-backup.tachibk';
          document.body.appendChild(a);
          a.click();
          a.remove();
        } catch (err) {
          showToast('No se pudo crear la copia: ' + (err.message || ''));
        }
      });
    }

    const instBtn = $('settingsInstallBtn');
    if (instBtn) instBtn.addEventListener('click', triggerInstallApp);
    const clrHistBtn = $('settingsClearHistBtn');
    if (clrHistBtn) clrHistBtn.addEventListener('click', () => runClearHistory(0, ''));
    const vaultBtn = $('settingsVaultBtn');
    if (vaultBtn) vaultBtn.addEventListener('click', requestOpenVault);
  }

  // ---------------- DETALLE DE MANGA (Categorías, Migración, Marcadores, Descargas) ----------------
  async function openMangaCategoriesSheet(manga) {
    if (!state.categories.length) {
      try {
        const d = await gql(Q_LIBRARY, {}, 6000);
        state.categories = (d.categories && d.categories.nodes) || [];
      } catch { }
    }
    const custom = state.categories.filter((c) => c.id !== 0);
    if (!custom.length) {
      showToast('Crea primero una categoría desde Biblioteca → Categorías');
      return;
    }
    const currentIds = new Set(((manga.categories && manga.categories.nodes) || []).map((c) => c.id));
    openAppSheet(`
      <div class="sheet-title">
        <span>Categorías del manga</span>
        <button id="mcClose" class="secondary-btn" type="button" style="padding:5px 10px;font-size:12px">Cerrar</button>
      </div>
      <div id="mcList">
        ${custom.map((c) => `
          <label class="dl-storage-row" style="cursor:pointer">
            <span>${esc(c.name)}</span>
            <input type="checkbox" value="${c.id}" ${currentIds.has(c.id) ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--accent)">
          </label>
        `).join('')}
      </div>
      <button id="mcSave" class="primary-btn" type="button" style="margin-top:12px">Guardar categorías</button>
    `);
    $('mcClose').addEventListener('click', closeAppSheet);
    $('mcSave').addEventListener('click', async () => {
      const checked = Array.from(appSheet.querySelectorAll('input[type="checkbox"]:checked')).map((i) => Number(i.value));
      try {
        const r = await gql(M_UPDATE_MANGA_CATS, { id: manga.id, catIds: checked });
        if (r.updateMangaCategories && r.updateMangaCategories.manga) {
          manga.categories = r.updateMangaCategories.manga.categories;
        }
        state.library = [];
        closeAppSheet();
        showToast('Categorías guardadas');
      } catch {
        showToast('No se pudieron guardar las categorías');
      }
    });
  }

  async function openMigrateSheet(manga) {
    openAppSheet(`
      <div class="sheet-title">
        <span>Migrar fuente</span>
        <button id="migClose" class="secondary-btn" type="button" style="padding:5px 10px;font-size:12px">Cerrar</button>
      </div>
      <div class="spinner"></div>
      <p style="text-align:center;color:var(--muted);font-size:13px">Buscando "${esc(manga.title)}" en otras fuentes...</p>
    `);
    $('migClose').addEventListener('click', closeAppSheet);

    try {
      if (!state.sources.length) {
        const d = await gql(Q_SOURCES, {}, 7000);
        state.sources = (d.sources && d.sources.nodes) || [];
      }
      const others = state.sources.filter((s) =>
        String(s.id) !== String(manga.sourceId) &&
        (state.vaultOpen ? true : (!Extras || !Extras.isSourceHidden(s.id)))
      );
      const res = await Promise.all(others.map(async (src) => {
        try {
          const r = await gql(M_SOURCE_MANGAS, {
            input: { source: String(src.id), type: 'SEARCH', page: 1, query: manga.title }
          }, 10000);
          return { source: src, mangas: ((r.fetchSourceManga && r.fetchSourceManga.mangas) || []).slice(0, 4) };
        } catch {
          return { source: src, mangas: [] };
        }
      }));
      const hits = res.filter((x) => x.mangas.length > 0);

      openAppSheet(`
        <div class="sheet-title">
          <span>Migrar "${esc(manga.title)}"</span>
          <button id="migClose2" class="secondary-btn" type="button" style="padding:5px 10px;font-size:12px">Cerrar</button>
        </div>
        ${hits.length ? hits.map((h) => `
          <div style="margin-bottom:12px">
            <div style="font-size:12px;color:var(--muted);margin-bottom:6px">${esc(h.source.name)}</div>
            ${h.mangas.map((cand) => `
              <div class="list-card" data-mig-id="${cand.id}" style="margin-bottom:6px">
                <img class="list-thumb" src="${esc(cand.thumbnailUrl || '')}" alt="" style="width:40px;height:56px">
                <div class="list-body">
                  <div class="list-title">${esc(cand.title)}</div>
                  <div class="list-sub">${cand.inLibrary ? 'Ya en biblioteca' : 'Abrir en esta fuente'}</div>
                </div>
                <span style="color:var(--accent);font-weight:700;font-size:12px">Abrir ›</span>
              </div>
            `).join('')}
          </div>
        `).join('') : '<p style="color:var(--muted);font-size:13px">No se encontraron alternativas en tus otras fuentes instaladas.</p>'}
      `);
      $('migClose2').addEventListener('click', closeAppSheet);
      appSheet.querySelectorAll('[data-mig-id]').forEach((row) => {
        row.addEventListener('click', () => {
          closeAppSheet();
          navigateHash('#manga/' + row.dataset.migId);
        });
      });
    } catch {
      closeAppSheet();
      showToast('Error buscando alternativas');
    }
  }

  async function openMangaDetail(mangaId, forceFetch = false, inVault = false) {
    state.mangaInVault = !!inVault;
    mangaView.classList.remove('hidden');
    mangaView.innerHTML = '<div style="padding-top:80px"><div class="spinner"></div></div>';
    await refreshDownloadsIndex();

    try {
      let data = await gql(Q_MANGA_DETAIL, { id: mangaId }, 8000, inVault);
      let manga = data.manga;
      let chapters = (data.chapters && data.chapters.nodes) || [];

      if (forceFetch || !manga.initialized || !chapters.length) {
        const refreshed = await gql(M_REFRESH_MANGA, { id: mangaId, fetchManga: true, fetchChapters: true }, 20000, inVault);
        if (refreshed.fetchMangaAndChapters) {
          if (refreshed.fetchMangaAndChapters.manga) manga = refreshed.fetchMangaAndChapters.manga;
          if (refreshed.fetchMangaAndChapters.chapters) chapters = refreshed.fetchMangaAndChapters.chapters;
        }
      }

      if (!inVault) setOfflineMode(false);
      else state.vaultOffline = false;

      if (inVault && Extras && Extras.isVaultIncognito()) {
        chapters = chapters.map((c) => {
          const vp = Extras.getVaultChapterProgress('v_' + c.id);
          return vp ? Object.assign({}, c, { lastPageRead: vp.lastPageRead, isRead: vp.isRead }) : c;
        });
      }
      state.manga = manga;
      state.mangaChapters = chapters;
      if (Offline) {
        const cacheManga = Object.assign({}, manga, { id: dlKey(manga.id, inVault) });
        Offline.saveMangaDetail(cacheManga, chapters);
        Offline.cacheCover(dlKey(manga.id, inVault), assetUrl(manga.thumbnailUrl, inVault));
      }
      drawMangaDetail();
    } catch {
      if (inVault) state.vaultOffline = true;
      else setOfflineMode(true);
      const cached = Offline ? await Offline.getMangaDetail(dlKey(mangaId, inVault)) : null;
      if (cached && cached.manga) {
        state.manga = Object.assign({}, cached.manga, { id: mangaId });
        state.mangaChapters = (cached.chapters || []).map((c) => {
          if (inVault && Extras && Extras.isVaultIncognito()) {
            const vp = Extras.getVaultChapterProgress('v_' + c.id);
            if (vp) return Object.assign({}, c, { lastPageRead: vp.lastPageRead, isRead: vp.isRead });
          }
          return c;
        });
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

  function pickResumeChapter(chapters, inVault = false) {
    if (!chapters.length) return null;
    const isOff = inVault ? state.vaultOffline : state.offline;
    const pool = isOff ? chapters.filter((c) => isDownloaded(c.id, inVault)) : chapters;
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

  function chapterDlButtonHtml(c, inVault = false) {
    const cKey = dlKey(c.id, inVault);
    if (isDownloaded(c.id, inVault)) {
      return `<button class="chap-dl-btn done" data-dl-id="${c.id}" type="button" title="Descargado">✓</button>`;
    }
    if (state.activeDownload && state.activeDownload.chapterKey === cKey) {
      const txt = state.activeDownload.total > 0 ? `${state.activeDownload.done}/${state.activeDownload.total}` : '...';
      return `<button class="chap-dl-btn busy" data-dl-id="${c.id}" type="button" disabled>${txt}</button>`;
    }
    if (state.downloadQueue.some((q) => q.chapterKey === cKey)) {
      return `<button class="chap-dl-btn busy" data-dl-id="${c.id}" type="button" disabled>Cola</button>`;
    }
    if (inVault ? state.vaultOffline : state.offline) {
      return `<button class="chap-dl-btn" data-dl-id="${c.id}" type="button" disabled>—</button>`;
    }
    return `<button class="chap-dl-btn" data-dl-id="${c.id}" type="button" title="Descargar">↓</button>`;
  }

  function drawMangaDetail() {
    const m = state.manga;
    const inVault = !!state.mangaInVault;
    const isOff = inVault ? state.vaultOffline : state.offline;
    const readHashPrefix = inVault ? 'vread' : 'read';
    const resume = pickResumeChapter(state.mangaChapters, inVault);
    const dlCount = state.mangaChapters.filter((c) => isDownloaded(c.id, inVault)).length;
    const filtered = state.mangaChapters
      .filter((c) => {
        if (state.chapterFilter === 'unread') return !c.isRead;
        if (state.chapterFilter === 'downloaded') return isDownloaded(c.id, inVault);
        if (state.chapterFilter === 'bookmarked') return !!c.isBookmarked;
        return true;
      })
      .slice()
      .sort((a, b) => (state.chapterDesc ? b.sourceOrder - a.sourceOrder : a.sourceOrder - b.sourceOrder));

    const metaParts = [];
    if (m.author) metaParts.push(m.author);
    if (m.source && m.source.name) metaParts.push(m.source.name);
    if (m.status) metaParts.push(m.status);
    const cover = coverUrlFor(m, inVault);

    mangaView.innerHTML = `
      <div class="manga-hero">
        <div class="manga-hero-bg" style="background-image:url('${esc(cover)}')"></div>
        <div class="manga-hero-fade"></div>
        <div class="manga-hero-inner">
          <div class="manga-hero-top">
            <button id="detailBackBtn" class="icon-btn" type="button" aria-label="Volver">
              <svg viewBox="0 0 24 24"><path d="M15.4 7.4 14 6l-6 6 6 6 1.4-1.4L10.8 12z"/></svg>
            </button>
            <div style="display:flex;gap:6px">
              ${!isOff ? '<button id="detailBatchDlBtn" class="secondary-btn" type="button" style="padding:6px 10px;font-size:12px">↓ Sig. 5</button>' : ''}
              ${!isOff && !inVault ? '<button id="detailMigBtn" class="secondary-btn" type="button" style="padding:6px 10px;font-size:12px">Migrar</button>' : ''}
              ${!isOff ? `<button id="detailRefreshBtn" class="icon-btn" type="button" aria-label="Actualizar capítulos">
                <svg viewBox="0 0 24 24"><path d="M17.6 6.4A8 8 0 1 0 20 12h-2a6 6 0 1 1-1.8-4.2L13 11h7V4l-2.4 2.4z"/></svg>
              </button>` : ''}
            </div>
          </div>
          <div class="manga-hero-main">
            <img class="manga-hero-cover" src="${esc(cover)}" data-cover-id="${dlKey(m.id, inVault)}" alt="">
            <div class="manga-hero-meta">
              <h2 class="manga-hero-title">${esc(m.title)}</h2>
              <div class="manga-hero-sub">${esc(metaParts.join(' · '))}</div>
              ${dlCount > 0 ? `<div style="margin-top:5px;font-size:11.5px;color:var(--green);font-weight:600">↓ ${dlCount} descargado(s)</div>` : ''}
              ${inVault ? '<div style="margin-top:5px"><span class="vault-pill">🔒 Bóveda aislada (sin rastro en localhost:4567)</span></div>' : ''}
            </div>
          </div>
        </div>
      </div>

      <div class="manga-actions-bar">
        ${resume
          ? `<button id="detailResumeBtn" class="primary-btn" style="flex:1">${esc(resume.label)}</button>`
          : (isOff ? '<button class="secondary-btn" style="flex:1;opacity:0.6" disabled>Sin capítulos descargados</button>' : '')}
        ${!isOff
          ? (inVault
            ? `<button id="detailLibBtn" class="secondary-btn" type="button" style="border-color:#a78bfa;color:#e9d5ff">${m.inLibrary ? '🔒 En bóveda' : '+ Bóveda'}</button>`
            : `<button id="detailLibBtn" class="secondary-btn" type="button" style="${m.inLibrary ? 'border-color:var(--green);color:var(--green)' : ''}">${m.inLibrary ? '✓ Biblio' : '+ Biblio'}</button>`)
          : ''}
        ${!isOff && !inVault && m.inLibrary ? '<button id="detailCatBtn" class="secondary-btn" type="button">Cat.</button>' : ''}
      </div>

      ${m.description ? `<div id="detailDesc" class="manga-desc clamped">${esc(m.description)}</div>` : ''}

      <div class="chapters-head">
        <strong>${filtered.length} cap.</strong>
        <div style="display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end">
          <button id="chapFilterDl" class="chip ${state.chapterFilter === 'downloaded' ? 'active' : ''}" type="button">↓ (${dlCount})</button>
          <button id="chapFilterStar" class="chip ${state.chapterFilter === 'bookmarked' ? 'active' : ''}" type="button">★</button>
          <button id="chapFilterBtn" class="chip ${state.chapterFilter === 'unread' ? 'active' : ''}" type="button">Sin leer</button>
          <button id="chapSortBtn" class="chip" type="button">${state.chapterDesc ? '↓' : '↑'}</button>
        </div>
      </div>

      <div id="chaptersList">
        ${filtered.length ? filtered.map((c) => {
          const dl = isDownloaded(c.id, inVault);
          const locked = isOff && !dl;
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
              ${!isOff ? `<button class="chap-star-btn ${c.isBookmarked ? 'active' : ''}" data-star-id="${c.id}" type="button" title="Marcar capítulo">${c.isBookmarked ? '★' : '☆'}</button>` : ''}
              ${chapterDlButtonHtml(c, inVault)}
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
    if (refBtn) refBtn.addEventListener('click', () => { showToast('Actualizando capítulos...'); openMangaDetail(m.id, true, inVault); });
    const migBtn = $('detailMigBtn');
    if (migBtn) migBtn.addEventListener('click', () => openMigrateSheet(m));
    const catBtn = $('detailCatBtn');
    if (catBtn) catBtn.addEventListener('click', () => openMangaCategoriesSheet(m));

    const batchBtn = $('detailBatchDlBtn');
    if (batchBtn) {
      batchBtn.addEventListener('click', () => {
        const asc = state.mangaChapters.slice().sort((a, b) => a.sourceOrder - b.sourceOrder);
        const candidates = asc.filter((c) => !c.isRead && !isDownloaded(c.id, inVault)).slice(0, 5);
        const toQueue = candidates.length ? candidates : asc.filter((c) => !isDownloaded(c.id, inVault)).slice(0, 5);
        if (!toQueue.length) { showToast('Todos los capítulos ya están descargados'); return; }
        toQueue.forEach((c) => enqueueChapterDownload(m, state.mangaChapters, c, true, inVault));
        showToast(`Añadidos ${toQueue.length} capítulo(s) a descargas`);
      });
    }

    const desc = $('detailDesc');
    if (desc) desc.addEventListener('click', () => desc.classList.toggle('clamped'));
    const resumeBtn = $('detailResumeBtn');
    if (resumeBtn && resume) resumeBtn.addEventListener('click', () => navigateHash(`#${readHashPrefix}/${m.id}/${resume.chap.id}`));

    const libBtn = $('detailLibBtn');
    if (libBtn) {
      libBtn.addEventListener('click', async () => {
        try {
          const nextVal = !m.inLibrary;
          await gql(M_UPDATE_MANGA, { id: m.id, inLibrary: nextVal }, 10000, inVault);
          m.inLibrary = nextVal;
          if (inVault) {
            await loadVaultData();
            showToast(nextVal ? 'Guardado en la bóveda oculta' : 'Quitado de la bóveda');
            if (state.vaultOpen) renderVault();
          } else {
            state.library = [];
            showToast(nextVal ? 'Añadido a tu biblioteca' : 'Quitado de tu biblioteca');
          }
          drawMangaDetail();
        } catch { showToast('No se pudo actualizar'); }
      });
    }

    $('chapFilterDl').addEventListener('click', () => { state.chapterFilter = state.chapterFilter === 'downloaded' ? 'all' : 'downloaded'; drawMangaDetail(); });
    $('chapFilterStar').addEventListener('click', () => { state.chapterFilter = state.chapterFilter === 'bookmarked' ? 'all' : 'bookmarked'; drawMangaDetail(); });
    $('chapFilterBtn').addEventListener('click', () => { state.chapterFilter = state.chapterFilter === 'unread' ? 'all' : 'unread'; drawMangaDetail(); });
    $('chapSortBtn').addEventListener('click', () => { state.chapterDesc = !state.chapterDesc; drawMangaDetail(); });

    mangaView.querySelectorAll('.chap-star-btn').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const cId = Number(btn.dataset.starId);
        const chap = state.mangaChapters.find((x) => x.id === cId);
        if (!chap) return;
        const nextVal = !chap.isBookmarked;
        try {
          await gql(M_UPDATE_CHAPTER, { id: cId, patch: { isBookmarked: nextVal } }, 8000, inVault);
          chap.isBookmarked = nextVal;
          drawMangaDetail();
        } catch { showToast('No se pudo marcar el capítulo'); }
      });
    });

    mangaView.querySelectorAll('.chap-dl-btn').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const cId = Number(btn.dataset.dlId);
        const chap = state.mangaChapters.find((x) => x.id === cId);
        if (!chap) return;
        if (isDownloaded(cId, inVault)) {
          if (confirm(`¿Borrar la descarga local de "${chap.name}"?`)) {
            await Offline.deleteDownload(dlKey(cId, inVault));
            await refreshDownloadsIndex();
            showToast('Descarga borrada');
            drawMangaDetail();
          }
          return;
        }
        enqueueChapterDownload(m, state.mangaChapters, chap, false, inVault);
      });
    });

    mangaView.querySelectorAll('.chapter-row').forEach((row) => {
      row.addEventListener('click', () => {
        const cId = Number(row.dataset.chapId);
        if (isOff && !isDownloaded(cId, inVault)) {
          showToast('No descargado. Conéctate al PC para leer o descargar este capítulo.');
          return;
        }
        navigateHash(`#${readHashPrefix}/${m.id}/${cId}`);
      });
    });
  }

  // ---------------- LECTOR AVANZADO (Auto-siguiente, por manga, Wake Lock, Zoom, Recorte, Brillo, 2 págs) ----------------
  function revokeReaderBlobs() {
    if (state.reader.blobUrls && state.reader.blobUrls.length) {
      state.reader.blobUrls.forEach((u) => URL.revokeObjectURL(u));
      state.reader.blobUrls = [];
    }
    readerStage.querySelectorAll('img[data-cropped-url]').forEach((img) => {
      try { URL.revokeObjectURL(img.dataset.croppedUrl); } catch { }
    });
  }

  function clearReaderTimers() {
    const r = state.reader;
    if (r.observer) { r.observer.disconnect(); r.observer = null; }
    if (r.endObserver) { r.endObserver.disconnect(); r.endObserver = null; }
    if (r.autoNextTimer) { clearTimeout(r.autoNextTimer); r.autoNextTimer = null; }
    if (r.readTickTimer) { clearInterval(r.readTickTimer); r.readTickTimer = null; }
  }

  async function openReader(mangaId, chapterId, forcedPage = null, inVault = false) {
    const r = state.reader;
    clearReaderTimers();
    revokeReaderBlobs();
    r.open = true;
    r.inVault = !!inVault;
    r.zoomed = false;
    r.lastSavedPage = -1;
    r.markedRead = false;
    r.preloadedChapId = null;
    closeReaderSheet();
    await refreshDownloadsIndex();

    readerView.classList.remove('hidden');
    if (state.prefs.wakeLock && Extras) Extras.requestWakeLock();

    r.readTickTimer = setInterval(() => {
      if (r.open && !r.inVault && document.visibilityState === 'visible' && Extras) {
        Extras.recordStat({ secondsRead: 10 });
      }
    }, 10000);

    setReaderChrome(true);
    readerStage.innerHTML = '<div style="padding-top:40vh"><div class="spinner"></div></div>';

    try {
      if (!state.manga || state.manga.id !== mangaId || state.mangaInVault !== inVault || !state.mangaChapters.length) {
        try {
          const d = await gql(Q_MANGA_DETAIL, { id: mangaId }, 7000, inVault);
          state.manga = d.manga;
          state.mangaInVault = inVault;
          state.mangaChapters = (d.chapters && d.chapters.nodes) || [];
          if (Offline) Offline.saveMangaDetail(Object.assign({}, state.manga, { id: dlKey(state.manga.id, inVault) }), state.mangaChapters);
        } catch {
          if (inVault) state.vaultOffline = true;
          else setOfflineMode(true);
          const cached = Offline ? await Offline.getMangaDetail(dlKey(mangaId, inVault)) : null;
          if (cached) {
            state.manga = Object.assign({}, cached.manga, { id: mangaId });
            state.mangaInVault = inVault;
            state.mangaChapters = cached.chapters || [];
          }
        }
      }

      r.manga = state.manga;
      r.chapters = state.mangaChapters.slice().sort((a, b) => a.sourceOrder - b.sourceOrder);
      r.chapIdx = Math.max(0, r.chapters.findIndex((c) => c.id === chapterId));
      const chap = r.chapters[r.chapIdx];

      applyReaderVisualPrefs();
      readerMangaTitle.textContent = r.manga ? r.manga.title : 'Manga';
      readerChapterTitle.textContent = chap ? chap.name : '';
      readerPrevChap.disabled = r.chapIdx <= 0;
      readerNextChap.disabled = r.chapIdx >= r.chapters.length - 1;

      const isOff = inVault ? state.vaultOffline : state.offline;
      let pages = Offline ? await Offline.loadDownloadedPageBlobUrls(dlKey(chapterId, inVault)) : null;
      if (pages && pages.length) {
        r.blobUrls = pages;
      } else {
        if (isOff) throw new Error('OFFLINE_NOT_DOWNLOADED');
        try {
          const pgData = await gql(M_FETCH_PAGES, { chapterId }, 25000, inVault);
          const rawPages = (pgData.fetchChapterPages && pgData.fetchChapterPages.pages) || [];
          pages = rawPages.map((u) => assetUrl(u, inVault));
        } catch {
          if (inVault) state.vaultOffline = true;
          else setOfflineMode(true);
          throw new Error('OFFLINE_NOT_DOWNLOADED');
        }
      }

      r.pages = pages || [];
      if (!r.pages.length) {
        readerStage.innerHTML = `<div class="empty-state" style="padding-top:34vh"><h3>No se pudieron cargar las páginas</h3><button id="retryPagesBtn" class="primary-btn" style="max-width:220px">Reintentar</button></div>`;
        $('retryPagesBtn').addEventListener('click', () => openReader(mangaId, chapterId, forcedPage, inVault));
        return;
      }

      if (!isOff && state.prefs.autoDlNext > 0 && r.manga) {
        for (let k = 1; k <= state.prefs.autoDlNext; k++) {
          const nextC = r.chapters[r.chapIdx + k];
          if (nextC && !nextC.isRead && !isDownloaded(nextC.id, inVault)) {
            enqueueChapterDownload(r.manga, r.chapters, nextC, true, inVault);
          }
        }
      }

      const startPage = (typeof forcedPage === 'number' && !isNaN(forcedPage) && forcedPage >= 0 && forcedPage < r.pages.length)
        ? forcedPage
        : ((chap && !chap.isRead && chap.lastPageRead > 0 && chap.lastPageRead < r.pages.length) ? chap.lastPageRead : 0);
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
          <p>${notDl ? 'El servidor está apagado o sin conexión. Solo puedes leer capítulos descargados.' : esc(err.message || '')}</p>
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
    clearReaderTimers();
    revokeReaderBlobs();
    if (Extras) Extras.releaseWakeLock();
    closeReaderSheet();
    readerView.classList.add('hidden');
    readerStage.innerHTML = '';
    if (state.manga && !mangaView.classList.contains('hidden')) drawMangaDetail();
  }

  function applyReaderVisualPrefs() {
    const p = state.prefs;
    readerDimmer.style.opacity = String((p.dim || 0) / 100);
    readerModeQuick.textContent = modeLabel(effectiveReaderMode());
    readerMiniStatus.classList.toggle('hidden', !p.miniStatus);
  }

  function setReaderChrome(visible) {
    state.reader.chromeVisible = visible;
    readerView.classList.toggle('chrome-hidden', !visible);
  }

  function updateBookmarkBtnUi() {
    const r = state.reader;
    const chap = r.chapters[r.chapIdx];
    const marked = chap && Extras && Extras.isPageBookmarked(chap.id, r.pageIdx);
    readerBookmarkBtn.classList.toggle('bookmarked', !!marked);
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
    updateBookmarkBtnUi();

    syncProgressToServer(r.pageIdx);

    if (effectiveReaderMode() === 'vertical') {
      for (let k = 1; k <= 6; k++) {
        const nextImg = readerStage.querySelector(`.reader-page-slot[data-page="${r.pageIdx + k}"] img`);
        if (nextImg && nextImg.loading === 'lazy') nextImg.loading = 'eager';
      }
    }

    const isOff = r.inVault ? state.vaultOffline : state.offline;
    if (!isOff && r.pageIdx >= Math.floor(r.pages.length * 0.8) && r.chapIdx < r.chapters.length - 1) {
      const nextChap = r.chapters[r.chapIdx + 1];
      if (nextChap && !isDownloaded(nextChap.id, r.inVault) && r.preloadedChapId !== nextChap.id) {
        r.preloadedChapId = nextChap.id;
        gql(M_FETCH_PAGES, { chapterId: nextChap.id }, 15000, r.inVault).catch(() => { });
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
        if (!r.inVault && Extras) Extras.recordStat({ chaptersCompleted: 1 });
        if (state.prefs.autoDelRead && isDownloaded(chap.id, r.inVault) && Offline) {
          Offline.deleteDownload(dlKey(chap.id, r.inVault)).then(() => refreshDownloadsIndex()).catch(() => { });
        }
      }
      r.lastSavedPage = pageIdx;

      if (Offline && r.manga) Offline.updateLocalChapterProgress(dlKey(r.manga.id, r.inVault), chap.id, patch);

      // Si estamos en la bóveda aislada: NUNCA toca el Suwayomi normal (4567)
      if (r.inVault) {
        if (Extras && Extras.isVaultIncognito()) {
          Extras.saveVaultChapterProgress('v_' + chap.id, patch);
        } else if (!state.vaultOffline) {
          gql(M_UPDATE_CHAPTER, { id: chap.id, patch }, 6000, true).catch(() => { });
        }
        return;
      }

      if (state.offline) {
        if (Offline) Offline.queueProgress(chap.id, patch);
      } else {
        gql(M_UPDATE_CHAPTER, { id: chap.id, patch }, 6000, false).catch(() => {
          if (Offline) Offline.queueProgress(chap.id, patch);
        });
      }
    }, reachedEnd ? 150 : 650);
  }

  function renderReaderPages() {
    const r = state.reader;
    if (r.observer) { r.observer.disconnect(); r.observer = null; }
    if (r.endObserver) { r.endObserver.disconnect(); r.endObserver = null; }
    if (r.autoNextTimer) { clearTimeout(r.autoNextTimer); r.autoNextTimer = null; }

    const mode = effectiveReaderMode();
    readerStage.className = 'reader-stage' + (mode === 'vertical' ? '' : ' paged') + (r.zoomed ? ' zoomed' : '');
    readerStage.scrollTop = 0;

    if (mode === 'vertical') renderVerticalReader();
    else renderPagedReader();
    updatePageUi(r.pageIdx);
  }

  function createPageImg(url, pageNum) {
    const img = document.createElement('img');
    img.className = effectiveReaderMode() === 'vertical' ? 'reader-page-img' : 'reader-paged-img';
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
        if (state.prefs.cropMargins && !img.dataset.cropped && Extras) {
          Extras.cropWhiteMargins(img);
        }
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
    const nextLocked = nextChap && (r.inVault ? state.vaultOffline : state.offline) && !isDownloaded(nextChap.id, r.inVault);

    const endCard = document.createElement('div');
    endCard.className = 'reader-end-card';
    endCard.innerHTML = `
      <div class="reader-end-title" id="endStatusTxt">Fin de ${esc(r.chapters[r.chapIdx] ? r.chapters[r.chapIdx].name : 'capítulo')}</div>
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

    // Paso automático al siguiente capítulo al llegar al final haciendo scroll
    if (state.prefs.autoNext && nextChap && !nextLocked) {
      r.endObserver = new IntersectionObserver((entries) => {
        const vis = entries.some((en) => en.isIntersecting && en.intersectionRatio > 0.75);
        if (vis && !r.autoNextTimer && r.pageIdx >= r.pages.length - 2) {
          const stTxt = $('endStatusTxt');
          if (stTxt) stTxt.textContent = `Pasando automáticamente a ${nextChap.name}...`;
          r.autoNextTimer = setTimeout(() => {
            r.autoNextTimer = null;
            if (r.open) switchChapter(r.chapIdx + 1);
          }, 1100);
        } else if (!vis && r.autoNextTimer) {
          clearTimeout(r.autoNextTimer);
          r.autoNextTimer = null;
        }
      }, { root: readerStage, threshold: [0.75] });
      r.endObserver.observe(endCard);
    }

    if (r.pageIdx > 0 && slots[r.pageIdx]) {
      setTimeout(() => slots[r.pageIdx].scrollIntoView({ behavior: 'auto', block: 'start' }), 60);
    }
  }

  function renderPagedReader() {
    const r = state.reader;
    const mode = effectiveReaderMode();
    const dbl = isDoublePageNow() && (r.pageIdx + 1 < r.pages.length);

    const wrap = document.createElement('div');
    wrap.className = (dbl ? 'reader-paged-spread' : 'reader-paged-wrap') + (!dbl && state.prefs.fit === 'width' ? ' fit-width' : '');

    const indices = dbl
      ? (mode === 'rtl' ? [r.pageIdx + 1, r.pageIdx] : [r.pageIdx, r.pageIdx + 1])
      : [r.pageIdx];

    indices.forEach((pIdx) => {
      const url = r.pages[pIdx];
      const img = createPageImg(url, pIdx);
      img.addEventListener('load', () => {
        if (state.prefs.cropMargins && !img.dataset.cropped && Extras) {
          Extras.cropWhiteMargins(img);
        }
      });
      img.addEventListener('error', () => {
        img.alt = 'Error al cargar (toca para reintentar)';
      });
      wrap.appendChild(img);
    });

    readerStage.innerHTML = '';
    readerStage.appendChild(wrap);

    for (let k = 1; k <= 3; k++) {
      if (r.pageIdx + k < r.pages.length) {
        const pre = new Image();
        pre.src = r.pages[r.pageIdx + k];
      }
    }
  }

  window.addEventListener('resize', () => {
    if (state.reader.open && effectiveReaderMode() !== 'vertical') {
      renderPagedReader();
    }
  });

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
    if (effectiveReaderMode() === 'vertical') {
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
    const isOff = r.inVault ? state.vaultOffline : state.offline;
    if (isOff && !isDownloaded(target.id, r.inVault)) {
      showToast('Ese capítulo no está descargado en tu móvil');
      return;
    }
    location.replace(`#${r.inVault ? 'vread' : 'read'}/${r.manga.id}/${target.id}`);
  }

  // Gestos del lector: brillo deslizando por borde izquierdo + swipe paginado + doble toque zoom
  let hudTimer = null;
  function showBrightnessHud(dim) {
    readerBrightnessHud.textContent = `Brillo: ${100 - dim}%`;
    readerBrightnessHud.classList.remove('hidden');
    clearTimeout(hudTimer);
    hudTimer = setTimeout(() => readerBrightnessHud.classList.add('hidden'), 900);
  }

  readerStage.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    state.reader.touchStartX = t.clientX;
    state.reader.touchStartY = t.clientY;
    state.reader.touchMoved = false;
    state.reader.brightnessDrag = (t.clientX < window.innerWidth * 0.14);
    state.reader.brightnessStartDim = state.prefs.dim || 0;
  }, { passive: true });

  readerStage.addEventListener('touchmove', (e) => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    const dx = t.clientX - state.reader.touchStartX;
    const dy = t.clientY - state.reader.touchStartY;
    if (Math.abs(dx) > 12 || Math.abs(dy) > 12) state.reader.touchMoved = true;

    // Deslizar verticalmente por el borde izquierdo ajusta el brillo/filtro nocturno
    if (state.reader.brightnessDrag && Math.abs(dy) > 18 && Math.abs(dy) > Math.abs(dx) * 1.5) {
      const deltaDim = Math.round((dy / 3.5)); // bajar dedo = más oscuro, subir = más brillo
      const nextDim = Math.max(0, Math.min(70, state.reader.brightnessStartDim + deltaDim));
      state.prefs.dim = nextDim;
      readerDimmer.style.opacity = String(nextDim / 100);
      showBrightnessHud(nextDim);
    }
  }, { passive: true });

  readerStage.addEventListener('touchend', (e) => {
    if (state.reader.brightnessDrag && state.reader.touchMoved) {
      savePrefs();
      state.reader.brightnessDrag = false;
      return;
    }
    state.reader.brightnessDrag = false;

    const mode = effectiveReaderMode();
    if (mode === 'vertical' || state.reader.zoomed) return;
    if (window.visualViewport && window.visualViewport.scale > 1.05) return;
    if (!e.changedTouches.length) return;
    const dx = e.changedTouches[0].clientX - state.reader.touchStartX;
    const dy = e.changedTouches[0].clientY - state.reader.touchStartY;
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      const step = isDoublePageNow() ? 2 : 1;
      const forward = mode === 'rtl' ? (dx > 0) : (dx < 0);
      goToPage(state.reader.pageIdx + (forward ? step : -step));
    }
  }, { passive: true });

  let singleTapTimer = null;
  readerStage.addEventListener('click', (e) => {
    if (state.reader.touchMoved) { state.reader.touchMoved = false; return; }
    if (e.target.closest('button, a')) return;

    const now = Date.now();
    if (now - state.reader.lastTapTime < 280) {
      // Doble toque -> Zoom 2x / 1x
      clearTimeout(singleTapTimer);
      state.reader.lastTapTime = 0;
      state.reader.zoomed = !state.reader.zoomed;
      readerStage.classList.toggle('zoomed', state.reader.zoomed);
      showToast(state.reader.zoomed ? 'Zoom 2× (doble toque para salir)' : 'Zoom normal');
      return;
    }
    state.reader.lastTapTime = now;

    const x = e.clientX;
    const w = window.innerWidth;
    singleTapTimer = setTimeout(() => {
      const mode = effectiveReaderMode();
      if (mode === 'vertical' || state.reader.zoomed) {
        setReaderChrome(!state.reader.chromeVisible);
        return;
      }
      const step = isDoublePageNow() ? 2 : 1;
      if (x < w * 0.28) {
        goToPage(state.reader.pageIdx + (mode === 'rtl' ? step : -step));
      } else if (x > w * 0.72) {
        goToPage(state.reader.pageIdx + (mode === 'rtl' ? -step : step));
      } else {
        setReaderChrome(!state.reader.chromeVisible);
      }
    }, 240);
  });

  // Controles de las barras del lector
  $('readerBackBtn').addEventListener('click', () => {
    if (history.length > 1) history.back();
    else if (state.reader.manga) navigateHash(`#${state.reader.inVault ? 'vmanga' : 'manga'}/${state.reader.manga.id}`);
    else navigateHash('#library');
  });

  readerBookmarkBtn.addEventListener('click', () => {
    const r = state.reader;
    if (r.inVault) { showToast('En la bóveda no se guardan marcadores públicos'); return; }
    const chap = r.chapters[r.chapIdx];
    if (!chap || !r.manga || !Extras) return;
    const added = Extras.togglePageBookmark({
      mangaId: r.manga.id,
      mangaTitle: r.manga.title,
      chapterId: chap.id,
      chapterName: chap.name,
      pageIdx: r.pageIdx
    });
    updateBookmarkBtnUi();
    showToast(added ? `Página ${r.pageIdx + 1} guardada en marcadores` : 'Marcador quitado');
  });

  readerPrevChap.addEventListener('click', () => switchChapter(state.reader.chapIdx - 1));
  readerNextChap.addEventListener('click', () => switchChapter(state.reader.chapIdx + 1));

  readerSlider.addEventListener('input', () => {
    readerPageNow.textContent = String(parseInt(readerSlider.value, 10));
  });
  readerSlider.addEventListener('change', () => {
    goToPage(parseInt(readerSlider.value, 10) - 1);
  });

  readerModeQuick.addEventListener('click', () => {
    const order = ['vertical', 'rtl', 'ltr'];
    const cur = effectiveReaderMode();
    const next = order[(order.indexOf(cur) + 1) % order.length];
    if (state.reader.manga && Extras && Extras.getMangaMode(state.reader.manga.id)) {
      Extras.setMangaMode(state.reader.manga.id, next);
    } else {
      state.prefs.mode = next;
      savePrefs();
    }
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
    const m = state.reader.manga;
    const mangaMode = (m && Extras) ? (Extras.getMangaMode(m.id) || 'default') : 'default';

    readerSheetBackdrop.classList.remove('hidden');
    readerSheet.classList.remove('hidden');
    readerSheet.innerHTML = `
      <div class="sheet-title">
        <span>Opciones de lectura</span>
        <button id="closeSheetBtn" class="secondary-btn" type="button" style="padding:5px 10px;font-size:12px">Cerrar</button>
      </div>

      ${m ? `
      <div class="setting-group">
        <span class="setting-label">Modo solo para este manga</span>
        <div class="seg-control" style="grid-template-columns:repeat(4,1fr)">
          <button class="seg-btn ${mangaMode === 'default' ? 'active' : ''}" data-mmode="default">General</button>
          <button class="seg-btn ${mangaMode === 'vertical' ? 'active' : ''}" data-mmode="vertical">PDF</button>
          <button class="seg-btn ${mangaMode === 'rtl' ? 'active' : ''}" data-mmode="rtl">D→I</button>
          <button class="seg-btn ${mangaMode === 'ltr' ? 'active' : ''}" data-mmode="ltr">I→D</button>
        </div>
      </div>` : ''}

      <div class="setting-group">
        <span class="setting-label">Ajuste de imagen</span>
        <div class="seg-control two">
          <button class="seg-btn ${p.fit === 'width' ? 'active' : ''}" data-rfit="width">Ancho del móvil</button>
          <button class="seg-btn ${p.fit === 'screen' ? 'active' : ''}" data-rfit="screen">Ajustar pantalla</button>
        </div>
      </div>

      <div class="setting-group">
        <span class="setting-label">Espacio entre páginas · Paso automático</span>
        <div class="seg-control two">
          <button class="seg-btn ${!p.gap ? 'active' : ''}" data-rgap="toggle">${p.gap ? 'Separadas' : 'Sin espacio'}</button>
          <button class="seg-btn ${p.autoNext ? 'active' : ''}" data-rautonext="toggle">${p.autoNext ? 'Auto-sig: Sí' : 'Auto-sig: No'}</button>
        </div>
      </div>

      <div class="setting-group">
        <span class="setting-label">Recorte de márgenes · Doble página</span>
        <div class="seg-control two">
          <button class="seg-btn ${p.cropMargins ? 'active' : ''}" data-rcrop="toggle">${p.cropMargins ? 'Recorte: Sí' : 'Recorte: No'}</button>
          <button class="seg-btn ${p.doublePage ? 'active' : ''}" data-rdbl="toggle">${p.doublePage ? '2 págs: Sí' : '2 págs: No'}</button>
        </div>
      </div>

      <div class="setting-group" style="margin-bottom:0">
        <span class="setting-label">Filtro nocturno (o desliza borde izquierdo): <strong id="rDimVal">${p.dim}%</strong></span>
        <input id="rDimSlider" type="range" min="0" max="70" step="5" value="${p.dim}" style="width:100%;accent-color:var(--accent)">
      </div>
    `;

    $('closeSheetBtn').addEventListener('click', closeReaderSheet);
    readerSheet.querySelectorAll('[data-mmode]').forEach((b) => {
      b.addEventListener('click', () => {
        if (m && Extras) Extras.setMangaMode(m.id, b.dataset.mmode);
        applyReaderVisualPrefs(); renderReaderPages(); openReaderSettingsSheet();
      });
    });
    readerSheet.querySelectorAll('[data-rfit]').forEach((b) => {
      b.addEventListener('click', () => { state.prefs.fit = b.dataset.rfit; savePrefs(); renderReaderPages(); openReaderSettingsSheet(); });
    });
    readerSheet.querySelector('[data-rgap]').addEventListener('click', () => {
      state.prefs.gap = !state.prefs.gap; savePrefs(); renderReaderPages(); openReaderSettingsSheet();
    });
    readerSheet.querySelector('[data-rautonext]').addEventListener('click', () => {
      state.prefs.autoNext = !state.prefs.autoNext; savePrefs(); renderReaderPages(); openReaderSettingsSheet();
    });
    readerSheet.querySelector('[data-rcrop]').addEventListener('click', () => {
      state.prefs.cropMargins = !state.prefs.cropMargins; savePrefs(); renderReaderPages(); openReaderSettingsSheet();
    });
    readerSheet.querySelector('[data-rdbl]').addEventListener('click', () => {
      state.prefs.doublePage = !state.prefs.doublePage; savePrefs(); renderReaderPages(); openReaderSettingsSheet();
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
          const dl = isDownloaded(c.id, r.inVault);
          const locked = (r.inVault ? state.vaultOffline : state.offline) && !dl;
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
  checkStartupPin();
  refreshDownloadsIndex().then(() => handleRoute());
})();
