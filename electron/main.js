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
const USER_DATA = argValue('user-data');
const SHOT = argValue('shot');
const DEV_URL = argValue('dev-url');

// Keep test runs away from the user's real settings.
if (SMOKE) app.setPath('userData', typeof USER_DATA === 'string' ? USER_DATA : path.join(os.tmpdir(), 'electrocad-smoke-' + process.pid));
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
  const allowed = ['theme', 'units', 'workspace', 'lastProject', 'colorThemes', 'customThemes', 'customFieldStyles', 'schematicDisplay'];
  for (const k of allowed) if (k in patch) settings[k] = patch[k];
  if ('theme' in patch) nativeTheme.themeSource = settings.theme === 'light' ? 'light' : 'dark';
  saveSettings();
  return settings;
});

// ---------------------------------------------------------------- Project store (ADR-0011)
// Every Project lives in <userData>/projects as <id>.ecad, with index.json holding the
// card metadata. The renderer addresses Projects by id only, so it can't touch other files.
const projectsDir = () => path.join(app.getPath('userData'), 'projects');
const indexFile = () => path.join(projectsDir(), 'index.json');
const SAFE_ID = /^[a-z0-9]{6,40}$/i;
const projectPath = (id) => {
  if (typeof id !== 'string' || !SAFE_ID.test(id)) throw new Error('Bad project id');
  return path.join(projectsDir(), id + '.ecad');
};
function readIndex() {
  try { return JSON.parse(fs.readFileSync(indexFile(), 'utf8')); } catch { return {}; }
}
function writeIndex(index) {
  fs.mkdirSync(projectsDir(), { recursive: true });
  const tmp = indexFile() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(index));
  fs.renameSync(tmp, indexFile());
}
function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

ipcMain.handle('store:list', () => {
  const index = readIndex();
  // only list Projects whose file still exists
  return Object.values(index).filter((m) => { try { return fs.existsSync(projectPath(m.id)); } catch { return false; } });
});
ipcMain.handle('store:load', (_e, id) => fs.readFileSync(projectPath(id), 'utf8'));
ipcMain.handle('store:save', (_e, id, text, meta) => {
  if (typeof text !== 'string') throw new Error('Nothing to save');
  writeAtomic(projectPath(id), text);
  const index = readIndex();
  index[id] = { ...(meta || {}), id };
  writeIndex(index);
  return true;
});
ipcMain.handle('store:delete', (_e, id) => {
  const file = projectPath(id);
  if (fs.existsSync(file)) fs.rmSync(file);
  const index = readIndex();
  delete index[id];
  writeIndex(index);
  return true;
});
// ---------------------------------------------------------------- user Libraries (#13)
// Each Library is <userData>/libraries/<id>.ecadlib. Ids are checked, so the renderer can't
// reach other files. Libraries are small, so list returns every file's text.
const librariesDir = () => path.join(app.getPath('userData'), 'libraries');
const SAFE_LIB = /^[a-z0-9][a-z0-9-]{0,40}$/;
const libraryPath = (id) => {
  if (typeof id !== 'string' || !SAFE_LIB.test(id)) throw new Error('Bad library id');
  return path.join(librariesDir(), id + '.ecadlib');
};
ipcMain.handle('lib:list', () => {
  try {
    return fs.readdirSync(librariesDir()).filter((f) => f.endsWith('.ecadlib'))
      .map((f) => { try { return fs.readFileSync(path.join(librariesDir(), f), 'utf8'); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
});
ipcMain.handle('lib:save', (_e, id, text) => {
  if (typeof text !== 'string') throw new Error('Nothing to save');
  writeAtomic(libraryPath(id), text);
  return true;
});
ipcMain.handle('lib:delete', (_e, id) => { const f = libraryPath(id); if (fs.existsSync(f)) fs.rmSync(f); return true; });

ipcMain.handle('store:folder', () => { fs.mkdirSync(projectsDir(), { recursive: true }); shell.openPath(projectsDir()); });

// ---------------------------------------------------------------- .ecad files on disk (import / export)
const FILE_KINDS = {
  project: { ext: 'ecad', filters: [{ name: 'ElectroCAD project', extensions: ['ecad'] }, { name: 'All files', extensions: ['*'] }], open: 'Open project file', save: 'Save project as file' },
  theme: { ext: 'json', filters: [{ name: 'ElectroCAD colour theme', extensions: ['json'] }, { name: 'All files', extensions: ['*'] }], open: 'Import colour theme', save: 'Export colour theme' },
  pdf: { ext: 'pdf', filters: [{ name: 'PDF', extensions: ['pdf'] }], save: 'Export schematic as PDF' },
  svg: { ext: 'svg', filters: [{ name: 'SVG image', extensions: ['svg'] }], save: 'Export sheet as SVG' },
  zip: { ext: 'zip', filters: [{ name: 'Zip archive', extensions: ['zip'] }], save: 'Save the fab zip' },
  eagle: { ext: 'sch', filters: [{ name: 'Eagle schematic and board', extensions: ['sch', 'brd'] }, { name: 'All files', extensions: ['*'] }], open: 'Import an Eagle schematic and/or board' },
};
const fileKind = (k) => FILE_KINDS[k] || FILE_KINDS.project;
const smokeDialogs = []; // smoke tests queue dialog answers here instead of clicking

ipcMain.handle('file:import', async (_e, kind) => {
  const K = fileKind(kind);
  let file;
  if (SMOKE) file = smokeDialogs.shift() || null;
  else {
    const r = await dialog.showOpenDialog(win, { title: K.open, filters: K.filters, properties: ['openFile'] });
    file = r.canceled || !r.filePaths.length ? null : r.filePaths[0];
  }
  if (!file) return null;
  return { name: path.basename(file), text: fs.readFileSync(file, 'utf8') };
});
// several files at once (an Eagle .sch and its .brd): [{ name, text }] or null
ipcMain.handle('file:importMany', async (_e, kind) => {
  const K = fileKind(kind);
  let files;
  if (SMOKE) files = [].concat(smokeDialogs.shift() || []).map((f) => path.resolve(app.getAppPath(), f)); // journeys name repo files relative to the app
  else {
    const r = await dialog.showOpenDialog(win, { title: K.open, filters: K.filters, properties: ['openFile', 'multiSelections'] });
    files = r.canceled || !r.filePaths.length ? null : r.filePaths;
  }
  if (!files?.length) return null;
  return [].concat(files).map((f) => ({ name: path.basename(f), text: fs.readFileSync(f, 'utf8') }));
});
ipcMain.handle('file:export', async (_e, suggestedName, text, kind) => {
  const K = fileKind(kind);
  if (typeof text !== 'string' && !(text instanceof Uint8Array)) throw new Error('Nothing to save'); // text, or bytes (the fab zip)
  let file;
  if (SMOKE) file = smokeDialogs.shift() || null;
  else {
    const r = await dialog.showSaveDialog(win, { title: K.save, defaultPath: suggestedName, filters: K.filters });
    file = r.canceled || !r.filePath ? null : r.filePath;
  }
  if (!file) return null;
  if (!file.toLowerCase().endsWith('.' + K.ext)) file += '.' + K.ext;
  fs.writeFileSync(file, text);
  return { name: path.basename(file) };
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

  // Let the renderer finish saving the open Project before the window goes away.
  let closing = false, closeTimer = null;
  win.on('close', (event) => {
    if (SMOKE) return;
    const b = win.getNormalBounds();
    settings.window = { width: b.width, height: b.height, maximized: win.isMaximized() };
    saveSettings();
    event.preventDefault();
    if (closing) return;
    closing = true;
    win.webContents.send('app:before-close');
    closeTimer = setTimeout(() => { if (win && !win.isDestroyed()) win.destroy(); }, 4000);
  });
  ipcMain.removeAllListeners('app:close-ready');
  ipcMain.on('app:close-ready', () => { clearTimeout(closeTimer); if (win && !win.isDestroyed()) win.destroy(); });
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
