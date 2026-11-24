(() => {
  'use strict';

  const PIN_HASH_KEY = 'suwayomi_pin_hash_v1';
  const PIN_UNLOCK_KEY = 'suwayomi_pin_unlocked_v1';
  const MANGA_MODES_KEY = 'suwayomi_manga_modes_v1';
  const PAGE_MARKS_KEY = 'suwayomi_page_bookmarks_v1';
  const STATS_KEY = 'suwayomi_reading_stats_v1';
  const VAULT_KEY = 'suwayomi_vault_data_v1';
  const VAULT_PIN_KEY = 'suwayomi_vault_pin_hash_v1';
  const VAULT_UNLOCK_KEY = 'suwayomi_vault_unlocked_v1';

  // ---------------- Hash SHA-256 (con respaldo síncrono si no hay crypto.subtle) ----------------
  async function hashPin(pin) {
    const text = 'suwayomi-pin:' + String(pin);
    try {
      if (window.crypto && window.crypto.subtle) {
        const enc = new TextEncoder().encode(text);
        const buf = await window.crypto.subtle.digest('SHA-256', enc);
        return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
      }
    } catch { }
    // Respaldo FNV-1a 64-bit hex
    let h1 = 0x811c9dc5;
    let h2 = 0x01000193;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 0x01000193);
      h2 = Math.imul(h2 ^ (c + i), 0x85ebca6b);
    }
    return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
  }

  function hasPin() {
    return !!localStorage.getItem(PIN_HASH_KEY);
  }

  async function setPin(pin) {
    const h = await hashPin(pin);
    localStorage.setItem(PIN_HASH_KEY, h);
    sessionStorage.setItem(PIN_UNLOCK_KEY, '1');
  }

  function clearPin() {
    localStorage.removeItem(PIN_HASH_KEY);
    sessionStorage.removeItem(PIN_UNLOCK_KEY);
  }

  async function verifyPin(pin) {
    const stored = localStorage.getItem(PIN_HASH_KEY);
    if (!stored) return true;
    const h = await hashPin(pin);
    return h === stored;
  }

  function isPinLockedNow() {
    return hasPin() && sessionStorage.getItem(PIN_UNLOCK_KEY) !== '1';
  }

  function markPinUnlocked() {
    sessionStorage.setItem(PIN_UNLOCK_KEY, '1');
  }

  // ---------------- Modo de lectura por manga ----------------
  function loadMap(key) {
    try { return JSON.parse(localStorage.getItem(key) || '{}') || {}; }
    catch { return {}; }
  }

  function getMangaMode(mangaId) {
    const m = loadMap(MANGA_MODES_KEY);
    return m[String(mangaId)] || null; // null = usar ajuste general
  }

  function setMangaMode(mangaId, mode) {
    const m = loadMap(MANGA_MODES_KEY);
    if (!mode || mode === 'default') delete m[String(mangaId)];
    else m[String(mangaId)] = mode;
    try { localStorage.setItem(MANGA_MODES_KEY, JSON.stringify(m)); } catch { }
  }

  // ---------------- Marcadores de páginas ----------------
  function getPageBookmarks() {
    try { return JSON.parse(localStorage.getItem(PAGE_MARKS_KEY) || '[]') || []; }
    catch { return []; }
  }

  function savePageBookmarks(list) {
    try { localStorage.setItem(PAGE_MARKS_KEY, JSON.stringify(list.slice(0, 100))); } catch { }
  }

  function isPageBookmarked(chapterId, pageIdx) {
    return getPageBookmarks().some((b) => b.chapterId === chapterId && b.pageIdx === pageIdx);
  }

  function togglePageBookmark({ mangaId, mangaTitle, chapterId, chapterName, pageIdx }) {
    const list = getPageBookmarks();
    const idx = list.findIndex((b) => b.chapterId === chapterId && b.pageIdx === pageIdx);
    if (idx >= 0) {
      list.splice(idx, 1);
      savePageBookmarks(list);
      return false;
    }
    list.unshift({ mangaId, mangaTitle, chapterId, chapterName, pageIdx, savedAt: Date.now() });
    savePageBookmarks(list);
    return true;
  }

  function removePageBookmark(chapterId, pageIdx) {
    const list = getPageBookmarks().filter((b) => !(b.chapterId === chapterId && b.pageIdx === pageIdx));
    savePageBookmarks(list);
  }

  // ---------------- Estadísticas de lectura locales ----------------
  function getStats() {
    const base = { chaptersCompleted: 0, secondsRead: 0, pagesViewed: 0 };
    try { return Object.assign(base, JSON.parse(localStorage.getItem(STATS_KEY) || '{}')); }
    catch { return base; }
  }

  function recordStat(delta) {
    const st = getStats();
    st.chaptersCompleted += (delta.chaptersCompleted || 0);
    st.secondsRead += (delta.secondsRead || 0);
    st.pagesViewed += (delta.pagesViewed || 0);
    try { localStorage.setItem(STATS_KEY, JSON.stringify(st)); } catch { }
  }

  // ---------------- Screen Wake Lock (mantener pantalla encendida al leer) ----------------
  let wakeSentinel = null;
  let wakeWanted = false;

  async function requestWakeLock() {
    wakeWanted = true;
    try {
      if ('wakeLock' in navigator && !wakeSentinel) {
        wakeSentinel = await navigator.wakeLock.request('screen');
        wakeSentinel.addEventListener('release', () => { wakeSentinel = null; });
      }
    } catch { }
  }

  async function releaseWakeLock() {
    wakeWanted = false;
    try {
      if (wakeSentinel) {
        await wakeSentinel.release();
        wakeSentinel = null;
      }
    } catch { }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && wakeWanted) {
      requestWakeLock();
    }
  });

  // ---------------- Recorte automático de márgenes blancos ----------------
  function cropWhiteMargins(imgEl) {
    try {
      const w = imgEl.naturalWidth;
      const h = imgEl.naturalHeight;
      if (!w || !h || w < 80 || h < 80 || w * h > 16000000) return;

      // Muestreamos en un canvas reducido para rapidez en móvil
      const scale = Math.min(1, 480 / Math.max(w, h));
      const sw = Math.max(16, Math.round(w * scale));
      const sh = Math.max(16, Math.round(h * scale));
      const c = document.createElement('canvas');
      c.width = sw;
      c.height = sh;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(imgEl, 0, 0, sw, sh);
      const data = ctx.getImageData(0, 0, sw, sh).data;

      function isUniformWhiteRow(y) {
        let nonWhite = 0;
        const rowOff = y * sw * 4;
        for (let x = 0; x < sw; x += 2) {
          const i = rowOff + x * 4;
          if (data[i] < 238 || data[i + 1] < 238 || data[i + 2] < 238) {
            nonWhite++;
            if (nonWhite > sw * 0.015) return false;
          }
        }
        return true;
      }

      function isUniformWhiteCol(x, top, bottom) {
        let nonWhite = 0;
        const span = Math.max(1, bottom - top);
        for (let y = top; y < bottom; y += 2) {
          const i = (y * sw + x) * 4;
          if (data[i] < 238 || data[i + 1] < 238 || data[i + 2] < 238) {
            nonWhite++;
            if (nonWhite > span * 0.015) return false;
          }
        }
        return true;
      }

      let top = 0;
      let bottom = sh - 1;
      const maxTrimY = Math.floor(sh * 0.2);
      while (top < maxTrimY && isUniformWhiteRow(top)) top++;
      while (bottom > sh - 1 - maxTrimY && bottom > top + 20 && isUniformWhiteRow(bottom)) bottom--;

      let left = 0;
      let right = sw - 1;
      const maxTrimX = Math.floor(sw * 0.22);
      while (left < maxTrimX && isUniformWhiteCol(left, top, bottom)) left++;
      while (right > sw - 1 - maxTrimX && right > left + 20 && isUniformWhiteCol(right, top, bottom)) right--;

      // Solo recortar si realmente hay margen apreciable (> 2%)
      if (left < sw * 0.02 && (sw - 1 - right) < sw * 0.02 && top < sh * 0.02 && (sh - 1 - bottom) < sh * 0.02) {
        return;
      }

      const sx = Math.floor(left / scale);
      const sy = Math.floor(top / scale);
      const cw = Math.max(40, Math.min(w - sx, Math.ceil((right - left + 1) / scale)));
      const ch = Math.max(40, Math.min(h - sy, Math.ceil((bottom - top + 1) / scale)));

      const out = document.createElement('canvas');
      out.width = cw;
      out.height = ch;
      out.getContext('2d').drawImage(imgEl, sx, sy, cw, ch, 0, 0, cw, ch);
      out.toBlob((blob) => {
        if (!blob) return;
        const old = imgEl.dataset.croppedUrl;
        const u = URL.createObjectURL(blob);
        imgEl.dataset.croppedUrl = u;
        imgEl.dataset.cropped = '1';
        imgEl.src = u;
        if (old) URL.revokeObjectURL(old);
      }, 'image/jpeg', 0.92);
    } catch { }
  }

  // ---------------- Cuota de almacenamiento del navegador ----------------
  async function getStorageEstimate() {
    try {
      if (navigator.storage && navigator.storage.estimate) {
        const est = await navigator.storage.estimate();
        return { usage: est.usage || 0, quota: est.quota || 0 };
      }
    } catch { }
    return null;
  }

  // ---------------- Bóveda oculta / Modo incógnito ----------------
  function defaultVault() {
    return {
      mangas: {},      // id -> { id, title, thumbnailUrl, sourceId, addedAt }
      sourceIds: [],   // string[] de source.id ocultos
      incognito: true, // true = no envía progreso ni historial a Suwayomi PC
      progress: {}     // chapterId -> { lastPageRead, isRead, updatedAt }
    };
  }

  function loadVault() {
    try {
      const raw = JSON.parse(localStorage.getItem(VAULT_KEY) || '{}') || {};
      return Object.assign(defaultVault(), raw, {
        mangas: raw.mangas || {},
        sourceIds: Array.isArray(raw.sourceIds) ? raw.sourceIds.map(String) : [],
        progress: raw.progress || {}
      });
    } catch {
      return defaultVault();
    }
  }

  function saveVault(v) {
    try { localStorage.setItem(VAULT_KEY, JSON.stringify(v)); } catch { }
  }

  function hasVaultPin() {
    return !!localStorage.getItem(VAULT_PIN_KEY);
  }

  async function setVaultPin(pin) {
    const h = await hashPin('vault:' + pin);
    localStorage.setItem(VAULT_PIN_KEY, h);
    sessionStorage.setItem(VAULT_UNLOCK_KEY, '1');
  }

  async function verifyVaultPin(pin) {
    const stored = localStorage.getItem(VAULT_PIN_KEY);
    if (!stored) return true;
    return (await hashPin('vault:' + pin)) === stored;
  }

  function isVaultUnlocked() {
    return hasVaultPin() && sessionStorage.getItem(VAULT_UNLOCK_KEY) === '1';
  }

  function unlockVaultSession() {
    sessionStorage.setItem(VAULT_UNLOCK_KEY, '1');
  }

  function lockVaultSession() {
    sessionStorage.removeItem(VAULT_UNLOCK_KEY);
  }

  function isMangaHidden(mangaId) {
    const v = loadVault();
    return !!v.mangas[String(mangaId)];
  }

  function isSourceHidden(sourceId) {
    const v = loadVault();
    return v.sourceIds.includes(String(sourceId));
  }

  function getHiddenMangaList() {
    const v = loadVault();
    return Object.values(v.mangas).sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  }

  function getHiddenSourceIds() {
    return loadVault().sourceIds;
  }

  function addMangaToVault(manga) {
    if (!manga || !manga.id) return;
    const v = loadVault();
    v.mangas[String(manga.id)] = {
      id: Number(manga.id),
      title: manga.title || `Manga #${manga.id}`,
      thumbnailUrl: manga.thumbnailUrl || '',
      sourceId: manga.sourceId ? String(manga.sourceId) : '',
      addedAt: Date.now()
    };
    saveVault(v);
  }

  function removeMangaFromVault(mangaId) {
    const v = loadVault();
    delete v.mangas[String(mangaId)];
    saveVault(v);
  }

  function toggleSourceHidden(sourceId) {
    const id = String(sourceId);
    const v = loadVault();
    const idx = v.sourceIds.indexOf(id);
    if (idx >= 0) v.sourceIds.splice(idx, 1);
    else v.sourceIds.push(id);
    saveVault(v);
    return idx < 0;
  }

  function isVaultIncognito() {
    return loadVault().incognito !== false;
  }

  function setVaultIncognito(val) {
    const v = loadVault();
    v.incognito = !!val;
    saveVault(v);
  }

  function getVaultChapterProgress(chapterId) {
    const v = loadVault();
    return v.progress[String(chapterId)] || null;
  }

  function saveVaultChapterProgress(chapterId, patch) {
    const v = loadVault();
    const cur = v.progress[String(chapterId)] || { lastPageRead: 0, isRead: false };
    v.progress[String(chapterId)] = {
      lastPageRead: typeof patch.lastPageRead === 'number' ? patch.lastPageRead : cur.lastPageRead,
      isRead: !!(patch.isRead || cur.isRead),
      updatedAt: Date.now()
    };
    saveVault(v);
  }

  function clearVaultAll() {
    saveVault(defaultVault());
  }

  window.SuwayomiExtras = {
    hasPin,
    setPin,
    clearPin,
    verifyPin,
    isPinLockedNow,
    markPinUnlocked,
    getMangaMode,
    setMangaMode,
    getPageBookmarks,
    isPageBookmarked,
    togglePageBookmark,
    removePageBookmark,
    getStats,
    recordStat,
    requestWakeLock,
    releaseWakeLock,
    cropWhiteMargins,
    getStorageEstimate,
    hasVaultPin,
    setVaultPin,
    verifyVaultPin,
    isVaultUnlocked,
    unlockVaultSession,
    lockVaultSession,
    isMangaHidden,
    isSourceHidden,
    getHiddenMangaList,
    getHiddenSourceIds,
    addMangaToVault,
    removeMangaFromVault,
    toggleSourceHidden,
    isVaultIncognito,
    setVaultIncognito,
    getVaultChapterProgress,
    saveVaultChapterProgress,
    clearVaultAll
  };
})();
