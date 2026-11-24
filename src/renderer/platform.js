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
};
