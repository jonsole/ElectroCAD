// Bridge to the desktop shell (same contract style as DabbleCAD's platform.js).
// In Electron the preload script exposes window.electroNative; in a plain browser the same
// API is backed by localStorage (settings) and IndexedDB (the Project store, ADR-0011).

const native = window.electroNative || null;
export const isDesktop = !!native;

const SETTINGS_KEY = 'electrocad.settings';
const BROWSER_DEFAULTS = { theme: 'dark', units: 'mm' };

const LS = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } },
};

const version = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';

// ---------------------------------------------------------------- browser Project store (IndexedDB)
// Two object stores keyed by Project id: 'projects' holds the .ecad text, 'meta' the card metadata.
let dbPromise = null;
function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open('electrocad', 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('projects')) d.createObjectStore('projects');
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('Browser storage is not available'));
    });
  }
  return dbPromise;
}
async function tx(stores, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(stores, mode);
    let result;
    const req = fn(...stores.map((s) => t.objectStore(s)));
    if (req) req.onsuccess = () => { result = req.result; };
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Browser storage write was aborted (is it full?)'));
  });
}
const idbStore = {
  list: () => tx(['meta'], 'readonly', (m) => m.getAll()),
  load: async (id) => {
    const text = await tx(['projects'], 'readonly', (p) => p.get(id));
    if (typeof text !== 'string') throw new Error('That project is no longer in this browser');
    return text;
  },
  save: (id, text, meta) => tx(['projects', 'meta'], 'readwrite', (p, m) => { p.put(text, id); m.put({ ...meta, id }, id); }),
  delete: (id) => tx(['projects', 'meta'], 'readwrite', (p, m) => { p.delete(id); m.delete(id); }),
};

// ---------------------------------------------------------------- browser files (as in DabbleCAD)
function pickFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = async () => {
      const f = input.files[0];
      resolve(f ? { name: f.name, text: await f.text() } : null);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

function download(name, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// ---------------------------------------------------------------- the contract

export const platform = {
  isDesktop,
  async getSettings() {
    if (native) return native.getSettings();
    return { ...BROWSER_DEFAULTS, ...LS.get(SETTINGS_KEY, {}), platform: 'browser', version };
  },
  async setSettings(patch) {
    if (native) return native.setSettings(patch);
    const next = { ...LS.get(SETTINGS_KEY, {}), ...patch };
    LS.set(SETTINGS_KEY, next);
    return next;
  },

  // Project store: Projects by id, plus card metadata { id, name, modified, components, layers, thumb }.
  store: {
    list: () => (native ? native.listProjects() : idbStore.list()),
    load: (id) => (native ? native.loadProject(id) : idbStore.load(id)),
    save: (id, text, meta) => (native ? native.storeProject(id, text, meta) : idbStore.save(id, text, meta)),
    delete: (id) => (native ? native.deleteProject(id) : idbStore.delete(id)),
    openFolder: () => (native ? native.openProjectsFolder() : null),
  },

  /** Pick an .ecad file to bring into the store. Resolves to { name, text } or null if cancelled. */
  importFile: () => (native ? native.importFile() : pickFile('.ecad,application/json')),
  /** Write an .ecad file: a Save dialog on desktop, a download in the browser. Resolves to { name } or null. */
  async exportFile(suggestedName, text) {
    if (native) return native.exportFile(suggestedName, text);
    download(suggestedName, text);
    return { name: suggestedName };
  },

  /** Run fn before the desktop window closes (it may be async); the window waits for it. */
  onBeforeClose(fn) {
    if (!native) return;
    native.onBeforeClose(async () => { try { await fn(); } finally { native.closeReady(); } });
  },
};
