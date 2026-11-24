(() => {
  'use strict';

  const DB_NAME = 'suwayomi_offline_v1';
  const DB_VERSION = 1;
  const MEDIA_CACHE = 'suwayomi-offline-media-v1';

  let dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('mangas')) db.createObjectStore('mangas', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('downloads')) {
          const st = db.createObjectStore('downloads', { keyPath: 'chapterId' });
          st.createIndex('mangaId', 'mangaId', { unique: false });
        }
        if (!db.objectStoreNames.contains('syncQueue')) db.createObjectStore('syncQueue', { keyPath: 'chapterId' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function txStore(storeName, mode, fn) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      let out;
      try {
        out = fn(store);
      } catch (err) {
        reject(err);
        return;
      }
      tx.oncomplete = () => resolve(out && typeof out.result !== 'undefined' ? out.result : out);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('IndexedDB aborted'));
    });
  }

  function reqToPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function requestPersistence() {
    try {
      if (navigator.storage && navigator.storage.persist) {
        await navigator.storage.persist();
      }
    } catch { }
  }

  function mediaCacheKey(type, id, extra = '') {
    // Clave URL valida para Cache API dentro de /movil/__offline__/
    return `/movil/__offline__/${type}/${id}${extra ? '/' + extra : ''}`;
  }

  // ---------------- Snapshots (Biblioteca, Recientes, Detalle) ----------------
  async function saveSnapshot(key, value) {
    try {
      await txStore('kv', 'readwrite', (s) => s.put(value, key));
    } catch { }
  }

  async function getSnapshot(key) {
    try {
      const db = await openDb();
      return await reqToPromise(db.transaction('kv', 'readonly').objectStore('kv').get(key));
    } catch {
      return null;
    }
  }

  async function saveMangaDetail(manga, chapters) {
    if (!manga || !manga.id) return;
    try {
      await txStore('mangas', 'readwrite', (s) => s.put({
        id: manga.id,
        manga,
        chapters: chapters || [],
        savedAt: Date.now()
      }));
    } catch { }
  }

  async function getMangaDetail(mangaId) {
    try {
      const db = await openDb();
      return await reqToPromise(db.transaction('mangas', 'readonly').objectStore('mangas').get(mangaId));
    } catch {
      return null;
    }
  }

  async function getAllSavedMangas() {
    try {
      const db = await openDb();
      return (await reqToPromise(db.transaction('mangas', 'readonly').objectStore('mangas').getAll())) || [];
    } catch {
      return [];
    }
  }

  // ---------------- Portadas en caché local ----------------
  async function cacheCover(mangaId, thumbnailUrl) {
    if (!mangaId || !thumbnailUrl || !('caches' in window)) return;
    try {
      const cache = await caches.open(MEDIA_CACHE);
      const key = mediaCacheKey('cover', mangaId);
      const existing = await cache.match(key);
      if (existing) return;
      const res = await fetch(thumbnailUrl);
      if (res && res.ok) {
        await cache.put(key, res);
      }
    } catch { }
  }

  async function getCachedCoverBlobUrl(mangaId) {
    if (!mangaId || !('caches' in window)) return null;
    try {
      const cache = await caches.open(MEDIA_CACHE);
      const res = await cache.match(mediaCacheKey('cover', mangaId));
      if (!res) return null;
      const blob = await res.blob();
      return URL.createObjectURL(blob);
    } catch {
      return null;
    }
  }

  // ---------------- Descargas de capítulos ----------------
  async function listDownloads() {
    try {
      const db = await openDb();
      return (await reqToPromise(db.transaction('downloads', 'readonly').objectStore('downloads').getAll())) || [];
    } catch {
      return [];
    }
  }

  async function getDownload(chapterId) {
    try {
      const db = await openDb();
      return await reqToPromise(db.transaction('downloads', 'readonly').objectStore('downloads').get(chapterId));
    } catch {
      return null;
    }
  }

  async function downloadChapter({ manga, chapters, chapter, pageUrls, onProgress }) {
    if (!('caches' in window)) {
      throw new Error('Este navegador no soporta almacenamiento offline.');
    }
    if (!pageUrls || !pageUrls.length) {
      throw new Error('El capítulo no tiene páginas disponibles.');
    }

    await requestPersistence();
    const cache = await caches.open(MEDIA_CACHE);
    let totalBytes = 0;
    let done = 0;
    const total = pageUrls.length;
    const concurrency = 3;
    let cursor = 0;

    async function worker() {
      while (cursor < total) {
        const idx = cursor++;
        const url = pageUrls[idx];
        const key = mediaCacheKey('page', chapter.id, idx);
        const res = await fetch(url);
        if (!res || !res.ok) throw new Error(`Error descargando página ${idx + 1}`);
        const blob = await res.blob();
        totalBytes += blob.size || 0;
        const stored = new Response(blob, {
          status: 200,
          headers: { 'Content-Type': blob.type || 'image/jpeg' }
        });
        await cache.put(key, stored);
        done += 1;
        if (onProgress) onProgress(done, total);
      }
    }

    try {
      const workers = [];
      for (let i = 0; i < Math.min(concurrency, total); i++) workers.push(worker());
      await Promise.all(workers);
    } catch (err) {
      // Limpiar descarga incompleta
      for (let i = 0; i < total; i++) {
        await cache.delete(mediaCacheKey('page', chapter.id, i)).catch(() => { });
      }
      throw err;
    }

    if (manga) {
      await cacheCover(manga.id, manga.thumbnailUrl);
      await saveMangaDetail(manga, chapters || [chapter]);
    }

    const record = {
      chapterId: chapter.id,
      mangaId: manga ? manga.id : chapter.mangaId,
      mangaTitle: manga ? manga.title : '',
      chapterName: chapter.name,
      chapterNumber: chapter.chapterNumber,
      sourceOrder: chapter.sourceOrder,
      pageCount: total,
      bytes: totalBytes,
      downloadedAt: Date.now()
    };
    await txStore('downloads', 'readwrite', (s) => s.put(record));
    return record;
  }

  async function deleteDownload(chapterId) {
    const rec = await getDownload(chapterId);
    if ('caches' in window && rec) {
      const cache = await caches.open(MEDIA_CACHE);
      for (let i = 0; i < (rec.pageCount || 0); i++) {
        await cache.delete(mediaCacheKey('page', chapterId, i)).catch(() => { });
      }
    }
    await txStore('downloads', 'readwrite', (s) => s.delete(chapterId));
  }

  async function deleteMangaDownloads(mangaId) {
    const all = await listDownloads();
    for (const d of all) {
      if (d.mangaId === mangaId) await deleteDownload(d.chapterId);
    }
  }

  async function deleteAllDownloads() {
    const all = await listDownloads();
    for (const d of all) {
      await deleteDownload(d.chapterId);
    }
  }

  async function loadDownloadedPageBlobUrls(chapterId) {
    const rec = await getDownload(chapterId);
    if (!rec || !('caches' in window)) return null;
    const cache = await caches.open(MEDIA_CACHE);
    const urls = [];
    for (let i = 0; i < rec.pageCount; i++) {
      const res = await cache.match(mediaCacheKey('page', chapterId, i));
      if (!res) {
        urls.forEach((u) => URL.revokeObjectURL(u));
        return null;
      }
      const blob = await res.blob();
      urls.push(URL.createObjectURL(blob));
    }
    return urls;
  }

  // ---------------- Cola de sincronización de progreso offline ----------------
  async function queueProgress(chapterId, patch) {
    try {
      const existing = await (async () => {
        const db = await openDb();
        return await reqToPromise(db.transaction('syncQueue', 'readonly').objectStore('syncQueue').get(chapterId));
      })();
      const merged = {
        chapterId,
        lastPageRead: typeof patch.lastPageRead === 'number' ? patch.lastPageRead : (existing ? existing.lastPageRead : 0),
        isRead: !!(patch.isRead || (existing && existing.isRead)),
        updatedAt: Date.now()
      };
      await txStore('syncQueue', 'readwrite', (s) => s.put(merged));
    } catch { }
  }

  async function getPendingSyncs() {
    try {
      const db = await openDb();
      return (await reqToPromise(db.transaction('syncQueue', 'readonly').objectStore('syncQueue').getAll())) || [];
    } catch {
      return [];
    }
  }

  async function removePendingSync(chapterId) {
    try {
      await txStore('syncQueue', 'readwrite', (s) => s.delete(chapterId));
    } catch { }
  }

  async function updateLocalChapterProgress(mangaId, chapterId, patch) {
    const saved = await getMangaDetail(mangaId);
    if (!saved || !saved.chapters) return;
    let changed = false;
    for (const c of saved.chapters) {
      if (c.id === chapterId) {
        if (typeof patch.lastPageRead === 'number') c.lastPageRead = patch.lastPageRead;
        if (typeof patch.isRead === 'boolean') c.isRead = patch.isRead;
        c.lastReadAt = String(Math.floor(Date.now() / 1000));
        changed = true;
      }
    }
    if (changed) await saveMangaDetail(saved.manga, saved.chapters);
  }

  function formatBytes(bytes) {
    const b = Number(bytes) || 0;
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
    return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  }

  window.SuwayomiOffline = {
    saveSnapshot,
    getSnapshot,
    saveMangaDetail,
    getMangaDetail,
    getAllSavedMangas,
    cacheCover,
    getCachedCoverBlobUrl,
    listDownloads,
    getDownload,
    downloadChapter,
    deleteDownload,
    deleteMangaDownloads,
    deleteAllDownloads,
    loadDownloadedPageBlobUrls,
    queueProgress,
    getPendingSyncs,
    removePendingSync,
    updateLocalChapterProgress,
    formatBytes
  };
})();
