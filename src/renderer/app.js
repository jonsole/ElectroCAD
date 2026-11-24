// Application shell: top bar, workspace tabs, theme and dialogs (layout per docs/UI.md,
// modelled on DabbleCAD's app shell).
import { APP_NAME, LOGO_SVG } from './brand.js';
import { h, button, modal, popupMenu, toast, confirmDialog } from './ui/dom.js';
import { platform } from './platform.js';
import { newProject, serialize, deserialize, ProjectFileError, FILE_EXTENSION } from './core/project.js';
import { buildWorkspaces } from './workspaces/index.js';
import { later, sep, spacer } from './workspaces/workspace.js';

/** The commit this build was made from (set in vite.config.mjs). */
const BUILD = typeof __APP_BUILD__ === 'object' ? __APP_BUILD__ : { sha: 'unknown', short: 'dev', branch: '', date: '' };
const BUILD_TITLE = `Commit ${BUILD.sha}${BUILD.branch ? `\nBranch ${BUILD.branch}` : ''}${BUILD.date ? `\nBuilt ${new Date(BUILD.date).toLocaleString()}` : ''}`;

export class App {
  async init() {
    this.settings = await platform.getSettings();
    this.applyTheme(this.settings.theme);
    this.project = newProject('Untitled');
    this.file = { name: null, path: null, dirty: false };
    this.workspaces = buildWorkspaces(this);
    this._build();
    this.setWorkspace(this.settings.workspace && this.workspaces.some((w) => w.id === this.settings.workspace) ? this.settings.workspace : 'schematic');
    this._keys();
    document.getElementById('boot')?.remove();
  }

  _build() {
    const root = document.getElementById('app');
    const logo = h('button', { class: 'logo', type: 'button', title: `About ${APP_NAME}` },
      h('span', { class: 'logo-mark', html: LOGO_SVG }),
      h('span', { class: 'logo-name' }, APP_NAME),
      h('span', { class: 'logo-commit', title: BUILD_TITLE }, BUILD.short));
    logo.addEventListener('click', () => this.about());

    this.nameInput = h('input', { class: 'design-name', type: 'text', spellcheck: false, title: 'Project name', value: this.project.name });
    this.nameInput.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'Escape') this.nameInput.blur(); });
    this.nameInput.addEventListener('change', () => {
      const name = this.nameInput.value.trim() || 'Untitled';
      this.nameInput.value = name;
      if (name !== this.project.name) { this.project.name = name; this.markDirty(); }
    });
    this.saveState = h('span', { class: 'save-state' });
    this.fileBtn = button({ label: 'File', icon: 'folder', title: 'New, open and save projects', onClick: () => this.fileMenu() });
    this.themeBtn = button({ icon: this.settings.theme === 'light' ? 'moon' : 'sun', title: 'Switch between dark and light mode', onClick: () => this.toggleTheme() });

    const topbar = h('div', { class: 'topbar', role: 'toolbar', 'aria-label': 'Project and app tools' },
      logo, sep(), this.nameInput, this.saveState, spacer(),
      this.fileBtn,
      later({ label: 'Import', icon: 'import', title: 'Import KiCad or Eagle files' }, 33),
      later({ label: 'Export', icon: 'export', title: 'Export to KiCad or Eagle' }, 34),
      sep(), this.themeBtn,
      button({ icon: 'help', title: 'Help: shortcuts (?)', onClick: () => this.help() }),
      button({ icon: 'info', title: `About ${APP_NAME}`, onClick: () => this.about() }),
      button({ icon: 'settings', title: 'Settings', onClick: () => this.settingsDialog() }));

    this.tabs = {};
    const tabBar = h('div', { class: 'workspace-bar', role: 'tablist', 'aria-label': 'Workspace' },
      ...this.workspaces.map((w) => {
        const b = button({ label: w.cfg.label, icon: w.cfg.icon, title: w.cfg.title, size: 17, cls: 'ws-tab', onClick: () => this.setWorkspace(w.id) });
        b.setAttribute('role', 'tab');
        b.dataset.ws = w.id;
        this.tabs[w.id] = b;
        return b;
      }));

    this.tabBar = tabBar;
    root.append(topbar, tabBar, ...this.workspaces.map((w) => w.el));
    this._showFileState();
  }

  // ---------------------------------------------------------------- project files

  /** Record that the Project has changed since it was last saved. */
  markDirty() {
    if (!this.file.dirty) { this.file.dirty = true; this._showFileState(); }
  }

  _showFileState() {
    const f = this.file;
    this.saveState.textContent = f.dirty ? 'Unsaved changes' : f.name ? 'Saved' : 'Not saved yet';
    this.saveState.title = f.path || f.name || '';
    document.title = `${f.dirty ? '• ' : ''}${this.project.name} · ${APP_NAME}`;
  }

  /** Replace the open Project (after New or Open). Workspaces are rebuilt around it. */
  setProject(project, file = { name: null, path: null }) {
    this.project = project;
    this.file = { name: file.name, path: file.path, dirty: false };
    this.nameInput.value = project.name;
    const active = this.active ? this.active.id : 'schematic';
    for (const w of this.workspaces) w.el.remove();
    this.workspaces = buildWorkspaces(this);
    this.tabBar.after(...this.workspaces.map((w) => w.el));
    this.setWorkspace(active);
    this._showFileState();
  }

  /** Ask before throwing away unsaved changes. Resolves true when it is fine to continue. */
  async _okToDiscard(action) {
    if (!this.file.dirty) return true;
    return confirmDialog('Unsaved changes', `"${this.project.name}" has unsaved changes. ${action} anyway and lose them?`, action, true);
  }

  async newProject({ force = false } = {}) {
    if (!force && !(await this._okToDiscard('Start a new project'))) return false;
    this.setProject(newProject('Untitled'));
    return true;
  }

  async openProject({ force = false } = {}) {
    if (!force && !(await this._okToDiscard('Open another project'))) return false;
    const file = await platform.openProject();
    if (!file) return false;
    let project;
    try {
      project = deserialize(file.text);
    } catch (err) {
      // the open Project stays exactly as it was
      toast(err instanceof ProjectFileError ? `Couldn't open ${file.name}: ${err.message}` : `Couldn't open ${file.name}.`, 'error', 7000);
      if (!(err instanceof ProjectFileError)) console.error(err);
      return false;
    }
    this.setProject(project, file);
    toast(`Opened ${file.name}`);
    return true;
  }

  async saveProject({ as = false } = {}) {
    const suggestedName = (this.file.name || `${this.project.name.replace(/[\\/:*?"<>|]+/g, '-') || 'Untitled'}.${FILE_EXTENSION}`);
    let result;
    try {
      result = await platform.saveProject({ path: as ? null : this.file.path, text: serialize(this.project), suggestedName });
    } catch (err) {
      console.error(err);
      toast(`Couldn't save: ${err.message || err}`, 'error', 7000);
      return false;
    }
    if (!result) return false;
    this.file = { name: result.name, path: result.path, dirty: false };
    this._showFileState();
    toast(platform.isDesktop ? `Saved ${result.name}` : `Downloaded ${result.name}`);
    return true;
  }

  fileMenu() {
    const mod = /Mac/.test(navigator.platform) ? '⌘' : 'Ctrl+';
    popupMenu([
      { label: 'New project', icon: 'plus', shortcut: mod + 'N', onClick: () => this.newProject() },
      { label: 'Open…', icon: 'folder', shortcut: mod + 'O', onClick: () => this.openProject() },
      'sep',
      { label: platform.isDesktop ? 'Save' : 'Save (download)', icon: 'check', shortcut: mod + 'S', onClick: () => this.saveProject() },
      { label: 'Save as…', icon: 'export', shortcut: mod + 'Shift+S', onClick: () => this.saveProject({ as: true }) },
    ], this.fileBtn);
  }

  /** Switch the visible Workspace. Each keeps its own pan/zoom (its own Canvas2D). */
  setWorkspace(id) {
    const ws = this.workspaces.find((w) => w.id === id);
    if (!ws) return;
    this.active = ws;
    for (const w of this.workspaces) {
      const on = w === ws;
      w.show(on);
      this.tabs[w.id].classList.toggle('active', on);
      this.tabs[w.id].setAttribute('aria-selected', String(on));
    }
    if (this.settings.workspace !== id) { this.settings.workspace = id; platform.setSettings({ workspace: id }); }
  }

  workspace(id) { return this.workspaces.find((w) => w.id === id); }

  applyTheme(theme) {
    document.documentElement.dataset.theme = theme === 'light' ? 'light' : 'dark';
  }

  toggleTheme() {
    const theme = this.settings.theme === 'light' ? 'dark' : 'light';
    this.settings.theme = theme;
    this.applyTheme(theme);
    this.themeBtn.replaceWith(this.themeBtn = button({ icon: theme === 'light' ? 'moon' : 'sun', title: 'Switch between dark and light mode', onClick: () => this.toggleTheme() }));
    platform.setSettings({ theme });
    for (const w of this.workspaces) w.view.invalidate();
  }

  _keys() {
    const order = ['schematic', 'board', 'gerber', 'library'];
    document.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || document.querySelector('.modal-backdrop')) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && /^[1-4]$/.test(e.key)) { this.setWorkspace(order[+e.key - 1]); e.preventDefault(); }
      else if (mod && k === 's') { e.preventDefault(); this.saveProject({ as: e.shiftKey }); }
      else if (mod && k === 'o') { e.preventDefault(); this.openProject(); }
      else if (mod && k === 'n') { e.preventDefault(); this.newProject(); }
      else if (e.key === '?') this.help();
    });
  }

  about() {
    const m = modal({ title: `About ${APP_NAME}`, width: 460 });
    m.body.append(
      h('div', { class: 'about-head' }, h('span', { class: 'logo-mark', html: LOGO_SVG }),
        h('div', {}, h('div', { class: 'about-name' }, APP_NAME), h('div', { class: 'side-note' }, `Version ${this.settings.version || '0.0.0'} · ${BUILD.short}${platform.isDesktop ? ' · desktop' : ' · browser'}`))),
      h('p', { class: 'modal-text' }, 'Schematic capture and 2/4-layer PCB layout, in the browser or on the desktop.'),
      h('p', { class: 'modal-text' }, 'The look and feel, UI components and app shell are ported from DabbleCAD (jonsole/DabbleCAD, Apache-2.0). See NOTICE.'));
  }

  help() {
    if (document.querySelector('.modal-backdrop')) return;
    const m = modal({ title: 'Shortcuts', width: 440 });
    const rows = [['New project', 'Ctrl+N'], ['Open', 'Ctrl+O'], ['Save', 'Ctrl+S'], ['Save as', 'Ctrl+Shift+S'], ['Pan', 'Middle- or right-drag'], ['Zoom', 'Scroll wheel'], ['Fit the view', 'Home'], ['Schematic · Board · Gerber · Library', 'Ctrl+1 … Ctrl+4'], ['This help', '?']];
    m.body.append(h('div', { class: 'shortcut-group' }, h('h4', {}, 'Every workspace'),
      ...rows.map(([a, b]) => h('div', { class: 'shortcut-row' }, h('span', {}, a), h('span', { class: 'kbd' }, b)))));
  }

  settingsDialog() {
    const m = modal({ title: 'Settings', width: 440 });
    const sel = h('select', { class: 'select' }, h('option', { value: 'dark' }, 'Dark'), h('option', { value: 'light' }, 'Light'));
    sel.value = this.settings.theme === 'light' ? 'light' : 'dark';
    sel.addEventListener('change', () => { if (sel.value !== (this.settings.theme === 'light' ? 'light' : 'dark')) this.toggleTheme(); });
    m.body.append(h('label', { class: 'field' }, h('span', {}, 'Theme'), sel),
      h('p', { class: 'side-note' }, 'More settings (units, AI providers, agents) arrive with later tickets.'));
  }
}
