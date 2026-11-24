// Bridge to the desktop shell (same contract style as DabbleCAD's platform.js).
// In Electron the preload script exposes window.electroNative; in a plain browser
// the same API is backed by localStorage so the editor still works.

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

// Browser file helpers (as in DabbleCAD's platform.js): a hidden file input to open, a download to save.
function pickFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = async () => {
      const f = input.files[0];
      resolve(f ? { name: f.name, path: null, text: await f.text() } : null);
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

export const platform = {
  isDesktop,
  async getSettings() {
    if (native) return native.getSettings();
    return { ...BROWSER_DEFAULTS, ...LS.get(SETTINGS_KEY, {}), platform: 'browser', version };
  },
  /** Ask the user for a project file. Resolves to { name, path, text } or null if cancelled. */
  async openProject() {
    if (native) return native.openProject();
    return pickFile('.ecad,application/json');
  },
  /**
   * Save project text. On desktop, `path` (from an earlier open/save) writes in place; without
   * it a Save dialog asks. In the browser the file is downloaded (save-in-place is ticket #6).
   * Resolves to { name, path } or null if cancelled.
   */
  async saveProject({ path, text, suggestedName }) {
    if (native) return native.saveProject({ path, text, suggestedName });
    download(suggestedName, text);
    return { name: suggestedName, path: null };
  },
  async setSettings(patch) {
    if (native) return native.setSettings(patch);
    const next = { ...LS.get(SETTINGS_KEY, {}), ...patch };
    LS.set(SETTINGS_KEY, next);
    return next;
  },
};
