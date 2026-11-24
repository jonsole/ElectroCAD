// ElectroCAD - Electron main process (modelled on DabbleCAD's main process).
const { app, BrowserWindow, ipcMain, shell, Menu, nativeTheme, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const argv = process.argv.slice(1);
const argValue = (name) => {
  const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return null;
  return hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : true;
};
const SMOKE = argValue('smoke');
const SHOT = argValue('shot');
const DEV_URL = argValue('dev-url');

// Keep test runs away from the user's real settings.
if (SMOKE) app.setPath('userData', path.join(os.tmpdir(), 'electrocad-smoke-' + process.pid));
// Software rendering for headless test machines (and as a user escape hatch).
if (argValue('software')) app.disableHardwareAcceleration();

// ---------------------------------------------------------------- settings
const DEFAULT_SETTINGS = { theme: 'dark', units: 'mm', workspace: 'schematic', window: { width: 1500, height: 940, maximized: false } };
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
let settings = { ...DEFAULT_SETTINGS };
function loadSettings() {
  try { settings = { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) }; } catch { /* first run */ }
}
function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2));
  } catch (err) { console.warn('Could not save settings', err); }
}

ipcMain.handle('settings:get', () => ({ ...settings, platform: process.platform, version: app.getVersion(), smoke: !!SMOKE }));
ipcMain.handle('settings:set', (_e, patch) => {
  if (!patch || typeof patch !== 'object') return settings;
  const allowed = ['theme', 'units', 'workspace'];
  for (const k of allowed) if (k in patch) settings[k] = patch[k];
  if ('theme' in patch) nativeTheme.themeSource = settings.theme === 'light' ? 'light' : 'dark';
  saveSettings();
  return settings;
});

// ---------------------------------------------------------------- project files
// The renderer may only write to paths the user picked in a dialog (or opened) this session.
const trustedPaths = new Set();
const PROJECT_FILTERS = [{ name: 'ElectroCAD project', extensions: ['ecad'] }, { name: 'All files', extensions: ['*'] }];
const smokeDialogs = []; // smoke tests queue dialog answers here instead of clicking

async function pickOpenPath() {
  if (SMOKE) return smokeDialogs.shift() || null;
  const r = await dialog.showOpenDialog(win, { title: 'Open project', filters: PROJECT_FILTERS, properties: ['openFile'] });
  return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
}
async function pickSavePath(suggestedName) {
  if (SMOKE) return smokeDialogs.shift() || null;
  const r = await dialog.showSaveDialog(win, { title: 'Save project', defaultPath: suggestedName, filters: PROJECT_FILTERS });
  if (r.canceled || !r.filePath) return null;
  return /\.ecad$/i.test(r.filePath) ? r.filePath : r.filePath + '.ecad';
}

ipcMain.handle('project:open', async () => {
  const file = await pickOpenPath();
  if (!file) return null;
  const text = fs.readFileSync(file, 'utf8');
  trustedPaths.add(file);
  return { name: path.basename(file), path: file, text };
});
ipcMain.handle('project:save', async (_e, { path: target, text, suggestedName } = {}) => {
  if (typeof text !== 'string') throw new Error('Nothing to save');
  let file = typeof target === 'string' && trustedPaths.has(target) ? target : null;
  if (!file) file = await pickSavePath(suggestedName || 'Untitled.ecad');
  if (!file) return null;
  fs.writeFileSync(file, text);
  trustedPaths.add(file);
  return { name: path.basename(file), path: file };
});
ipcMain.handle('smoke:dialog', (_e, answer) => { if (SMOKE) smokeDialogs.push(answer); return !!SMOKE; });

// ---------------------------------------------------------------- window
let win = null;

function createWindow() {
  const w = settings.window || {};
  nativeTheme.themeSource = settings.theme === 'light' ? 'light' : 'dark';
  win = new BrowserWindow({
    width: SMOKE ? 1500 : w.width || 1500,
    height: SMOKE ? 940 : w.height || 940,
    minWidth: 980,
    minHeight: 620,
    show: false,
    title: 'ElectroCAD',
    backgroundColor: settings.theme === 'light' ? '#f1f4f8' : '#16181d',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  Menu.setApplicationMenu(null);
  if (w.maximized && !SMOKE) win.maximize();

  if (SMOKE && argValue('offline')) {
    win.webContents.session.webRequest.onBeforeRequest(
      { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
      (_details, callback) => callback({ cancel: true }));
  }
  if (DEV_URL && typeof DEV_URL === 'string') win.loadURL(DEV_URL);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  win.once('ready-to-show', () => { if (!SMOKE || argValue('show')) win.show(); });

  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) {
      win.webContents.toggleDevTools(); event.preventDefault();
    } else if (input.key === 'F5') {
      win.webContents.reload(); event.preventDefault();
    } else if (input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen()); event.preventDefault();
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  win.on('close', () => {
    if (SMOKE) return;
    const b = win.getNormalBounds();
    settings.window = { width: b.width, height: b.height, maximized: win.isMaximized() };
    saveSettings();
  });
  win.on('closed', () => { win = null; });

  if (SMOKE) runSmoke();
}

// ---------------------------------------------------------------- smoke test harness
ipcMain.handle('smoke:shot', async (_e, file) => {
  if (!SMOKE || !win || typeof file !== 'string') return false;
  await win.webContents.capturePage(); // the first capture of a hidden window can be a stale frame
  await new Promise((r) => setTimeout(r, 300));
  const img = await win.webContents.capturePage();
  fs.writeFileSync(file, img.toPNG());
  return true;
});

function runSmoke() {
  win.webContents.on('console-message', (e) => console.log(`[renderer:${e.level}] ${e.message}`));
  win.webContents.on('render-process-gone', (_e, d) => { console.log('[renderer gone]', d.reason); app.exit(3); });
  win.webContents.once('did-finish-load', async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    try {
      await wait(1500);
      if (typeof SMOKE === 'string') {
        const script = fs.readFileSync(SMOKE, 'utf8');
        const result = await win.webContents.executeJavaScript(`(async () => { ${script}\n })()`, true);
        console.log('[smoke result]', JSON.stringify(result));
        if (Array.isArray(result?.fails) && result.fails.length) throw new Error('Smoke assertions failed: ' + result.fails.join('; '));
      }
      if (typeof SHOT === 'string') {
        await wait(500);
        const img = await win.webContents.capturePage();
        fs.writeFileSync(SHOT, img.toPNG());
        console.log('[smoke] screenshot', SHOT);
      }
    } catch (err) {
      console.log('[smoke error]', err && err.stack ? err.stack : String(err));
      process.exitCode = 2;
    }
    app.exit(process.exitCode || 0);
  });
}

// ---------------------------------------------------------------- lifecycle
const gotLock = SMOKE ? true : app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(() => { loadSettings(); createWindow(); });
  app.on('window-all-closed', () => app.quit());
}
