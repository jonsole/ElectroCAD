// Application shell: top bar, workspace tabs, theme and dialogs (layout per docs/UI.md,
// modelled on DabbleCAD's app shell).
import { APP_NAME, LOGO_SVG } from './brand.js';
import { h, button, modal, popupMenu, toast } from './ui/dom.js';
import { platform } from './platform.js';
import { newProject, serialize, deserialize, ProjectFileError } from './core/project.js';
import { History } from './core/history.js';
import { projectMeta, importProject, duplicateProject, exportFileName } from './core/store.js';
import { renderThumbnail } from './view/thumbnail.js';
import { ProjectsScreen } from './ui/projects.js';
import { resolveTheme, listThemes, MATCH_APP } from './core/themes.js';
import { colorsSection } from './ui/themes.js';
import { fieldStylesSection } from './ui/fieldStyles.js';
import { setDefaultFieldStyle } from './core/fields.js';
import { buildWorkspaces } from './workspaces/index.js';
import { later, sep, spacer } from './workspaces/workspace.js';

/** The commit this build was made from (set in vite.config.mjs). */
const BUILD = typeof __APP_BUILD__ === 'object' ? __APP_BUILD__ : { sha: 'unknown', short: 'dev', branch: '', date: '' };
const BUILD_TITLE = `Commit ${BUILD.sha}${BUILD.branch ? `\nBranch ${BUILD.branch}` : ''}${BUILD.date ? `\nBuilt ${new Date(BUILD.date).toLocaleString()}` : ''}`;

export class App {
  async init() {
    this.settings = await platform.getSettings();
    this.applyTheme(this.settings.theme);
    this.project = await this._startupProject();
    this.save = { dirty: false, saving: false, timer: null, pending: null };
    this.history = new History(() => this.project, (p) => { this.project = p; }, () => this._afterEdit());
    this.workspaces = buildWorkspaces(this);
    this._build();
    this.projects = new ProjectsScreen(this);
    this._rememberLast();
    platform.onBeforeClose(() => this.saveNow());
    // browser: save when the tab is hidden or closed (autosave normally got there first)
    window.addEventListener('pagehide', () => { if (this.save.dirty) this.saveNow(); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && this.save.dirty) this.saveNow(); });
    this.setWorkspace(this.settings.workspace && this.workspaces.some((w) => w.id === this.settings.workspace) ? this.settings.workspace : 'schematic');
    this._keys();
    document.getElementById('boot')?.remove();
  }

  _build() {
    const root = document.getElementById('app');
    const logo = h('button', { class: 'logo', type: 'button', title: 'Your projects' },
      h('span', { class: 'logo-mark', html: LOGO_SVG }),
      h('span', { class: 'logo-name' }, APP_NAME),
      h('span', { class: 'logo-commit', title: BUILD_TITLE }, BUILD.short));
    logo.addEventListener('click', () => this.projects.show());

    this.nameInput = h('input', { class: 'design-name', type: 'text', spellcheck: false, title: 'Project name', value: this.project.name });
    this.nameInput.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'Escape') this.nameInput.blur(); });
    this.nameInput.addEventListener('change', () => {
      const name = this.nameInput.value.trim() || 'Untitled';
      this.nameInput.value = name;
      if (name !== this.project.name) { this.project.name = name; this.markDirty(); }
    });
    this.saveState = h('span', { class: 'save-state' });
    this.fileBtn = button({ label: 'File', icon: 'folder', title: 'New project, Your projects, open and save files', onClick: () => this.fileMenu() });
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

  // ---------------------------------------------------------------- Project store (ADR-0011)

  async _startupProject() {
    const last = this.settings.lastProject;
    if (last) {
      try { return deserialize(await platform.store.load(last)); } catch (err) { console.warn('Could not reopen the last project', err); }
    }
    // first run, or the last Project is gone: the newest stored one, else a new one
    try {
      const list = await platform.store.list();
      list.sort((a, b) => (b.modified || 0) - (a.modified || 0));
      for (const m of list) { try { return deserialize(await platform.store.load(m.id)); } catch { /* try the next */ } }
    } catch (err) { console.warn('Project store unavailable', err); }
    const p = newProject('Untitled');
    this._firstSave = true;
    return p;
  }

  _rememberLast() {
    if (this.settings.lastProject !== this.project.id) { this.settings.lastProject = this.project.id; platform.setSettings({ lastProject: this.project.id }); }
    if (this._firstSave) { this._firstSave = false; this.saveNow(); }
  }

  /** Record a change to the open Project; it autosaves ~1.5 s after the last change. */
  markDirty() {
    this.save.dirty = true;
    this._showFileState();
    clearTimeout(this.save.timer);
    this.save.timer = setTimeout(() => this.saveNow(), 1500);
  }

  /** Save the open Project to the store now (Ctrl+S, switching Project, closing). */
  async saveNow() {
    clearTimeout(this.save.timer);
    if (this.save.pending) await this.save.pending; // one write at a time
    const project = this.project;
    const text = serialize(project);
    this.save.dirty = false;
    this.save.saving = true;
    this._showFileState();
    this.save.pending = (async () => {
      try {
        const meta = projectMeta(project, { modified: Date.now(), thumb: renderThumbnail(project, (k) => this.canvasColors(k)) });
        await platform.store.save(project.id, text, meta);
        return true;
      } catch (err) {
        console.error(err);
        if (this.project === project) this.save.dirty = true; // keep trying on the next change or Ctrl+S
        toast(`Couldn't save "${project.name}": ${err.message || err}`, 'error', 7000);
        return false;
      } finally {
        this.save.saving = false;
        this.save.pending = null;
        this._showFileState();
      }
    })();
    return this.save.pending;
  }

  _showFileState() {
    const st = this.save;
    this.saveState.textContent = st.saving ? 'Saving…' : st.dirty ? 'Unsaved changes' : 'All changes saved';
    document.title = `${this.project.name} · ${APP_NAME}`;
  }

  // ---------------------------------------------------------------- editing (undo/redo)

  /** Run one edit of the open Project as a single undo step. Returns fn's result. */
  edit(label, fn) { return this.history.transact(label, fn); }
  undo() { this.history.undo(); }
  redo() { this.history.redo(); }

  _afterEdit() {
    this.markDirty();
    for (const w of this.workspaces) w.refresh();
  }

  /** Replace the open Project. Workspaces are rebuilt around it. */
  setProject(project) {
    this.project = project;
    this.history.clear();
    this.save.dirty = false;
    this.nameInput.value = project.name;
    const active = this.active ? this.active.id : 'schematic';
    for (const w of this.workspaces) w.el.remove();
    this.workspaces = buildWorkspaces(this);
    this.tabBar.after(...this.workspaces.map((w) => w.el));
    this.setWorkspace(active);
    this._rememberLast();
    this._showFileState();
  }

  async newProject() {
    await this.saveNow();
    this.setProject(newProject('Untitled'));
    await this.saveNow(); // so it appears in Your projects straight away
    return true;
  }

  async openStored(id) {
    if (id === this.project.id) return true;
    await this.saveNow();
    try {
      this.setProject(deserialize(await platform.store.load(id)));
      return true;
    } catch (err) {
      toast(`Couldn't open that project: ${err.message || err}`, 'error', 7000);
      return false;
    }
  }

  async _storedIds() { return new Set((await platform.store.list()).map((m) => m.id)); }

  /** Open file…: bring an .ecad file into the store and open it. Bad files change nothing. */
  async importFile() {
    let file;
    try { file = await platform.importFile(); } catch (err) {
      toast(`Couldn't read that file: ${err.message || err}`, 'error', 7000);
      return false;
    }
    if (!file) return false;
    let project;
    try {
      project = importProject(file.text, await this._storedIds());
    } catch (err) {
      toast(err instanceof ProjectFileError ? `Couldn't open ${file.name}: ${err.message}` : `Couldn't open ${file.name}.`, 'error', 7000);
      if (!(err instanceof ProjectFileError)) console.error(err);
      return false;
    }
    await this.saveNow();
    this.setProject(project);
    await this.saveNow();
    this.projects?.hide();
    toast(`Opened ${file.name}`);
    return true;
  }

  /** Save as file…: write the open (or a stored) Project to an .ecad file on disk. */
  async exportFile(project = this.project) {
    try {
      const r = await platform.exportFile(exportFileName(project), serialize(project));
      if (r) toast(platform.isDesktop ? `Saved ${r.name}` : `Downloaded ${r.name}`);
      return !!r;
    } catch (err) {
      toast(`Couldn't save the file: ${err.message || err}`, 'error', 7000);
      return false;
    }
  }

  async _loadStored(id) {
    if (id === this.project.id) { await this.saveNow(); return this.project; }
    return deserialize(await platform.store.load(id));
  }

  async exportStored(id) { return this.exportFile(await this._loadStored(id)); }

  async duplicateStored(id) {
    const src = await this._loadStored(id);
    const names = (await platform.store.list()).map((m) => m.name);
    const copy = duplicateProject(src, names);
    await platform.store.save(copy.id, serialize(copy), projectMeta(copy, { thumb: renderThumbnail(copy, (k) => this.canvasColors(k)) }));
    return copy;
  }

  async renameStored(id, name) {
    if (id === this.project.id) {
      this.project.name = name;
      this.nameInput.value = name;
      return this.saveNow();
    }
    const p = deserialize(await platform.store.load(id));
    p.name = name;
    await platform.store.save(p.id, serialize(p), projectMeta(p, { thumb: renderThumbnail(p, (k) => this.canvasColors(k)) }));
    return true;
  }

  async deleteStored(id) {
    await platform.store.delete(id);
    if (id !== this.project.id) return true;
    // the open Project was deleted: open the newest remaining one, or start a new one
    const list = (await platform.store.list()).sort((a, b) => (b.modified || 0) - (a.modified || 0));
    let next = null;
    for (const m of list) { try { next = deserialize(await platform.store.load(m.id)); break; } catch { /* skip */ } }
    clearTimeout(this.save.timer);
    this.save.dirty = false;
    this.setProject(next || newProject('Untitled'));
    if (!next) await this.saveNow();
    return true;
  }

  fileMenu() {
    const mod = /Mac/.test(navigator.platform) ? '⌘' : 'Ctrl+';
    popupMenu([
      { label: 'New project', icon: 'plus', shortcut: mod + 'N', onClick: () => this.newProject() },
      { label: 'Your projects…', icon: 'list', onClick: () => this.projects.show() },
      'sep',
      { label: 'Open file…', icon: 'folder', shortcut: mod + 'O', onClick: () => this.importFile() },
      { label: platform.isDesktop ? 'Save as file…' : 'Download as file', icon: 'export', shortcut: mod + 'Shift+S', onClick: () => this.exportFile() },
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

  // ---------------------------------------------------------------- Colour themes (#51)

  /** Resolved canvas colours for 'schematic' or 'board', from the chosen Colour theme and the UI theme. */
  canvasColors(kind) {
    const chosen = (this.settings.colorThemes || {})[kind] || MATCH_APP;
    return resolveTheme(kind, chosen, this.settings.theme === 'light' ? 'light' : 'dark', this.settings.customThemes || []);
  }

  /** Pick the Colour theme for a kind; every canvas of that kind redraws at once. */
  setColorTheme(kind, id) {
    this.settings.colorThemes = { ...(this.settings.colorThemes || {}), [kind]: id };
    platform.setSettings({ colorThemes: this.settings.colorThemes });
    this.recolor();
  }

  /** Replace the list of custom themes (after duplicate, edit, rename, delete or import). */
  setCustomThemes(list) {
    this.settings.customThemes = list;
    const chosen = { ...(this.settings.colorThemes || {}) };
    for (const kind of ['schematic', 'board']) if (chosen[kind] && !listThemes(kind, list).some((t) => t.id === chosen[kind])) chosen[kind] = MATCH_APP;
    this.settings.colorThemes = chosen;
    platform.setSettings({ customThemes: list, colorThemes: chosen });
    this.recolor();
  }

  recolor() { for (const w of this.workspaces) w.recolor(); }

  // ---------------------------------------------------------------- Field styles (ADR-0012)

  /** Replace the user's own Field styles (kept in settings, like Colour themes). */
  setCustomFieldStyles(list) {
    this.settings.customFieldStyles = list;
    platform.setSettings({ customFieldStyles: list });
    for (const w of this.workspaces) w.refresh();
  }

  /** After editing a style the open Project uses, update the Project's copy (one undo step). */
  updateProjectFieldStyle(style) {
    this.edit(`Update field style ${style.name}`, (p) => {
      const isDefault = p.fieldStyles.default === style.id;
      p.fieldStyles.styles[style.id] = structuredClone(style);
      if (isDefault) setDefaultFieldStyle(p, style);
    });
  }

  applyTheme(theme) {
    document.documentElement.dataset.theme = theme === 'light' ? 'light' : 'dark';
  }

  toggleTheme() {
    const theme = this.settings.theme === 'light' ? 'dark' : 'light';
    this.settings.theme = theme;
    this.applyTheme(theme);
    this.themeBtn.replaceWith(this.themeBtn = button({ icon: theme === 'light' ? 'moon' : 'sun', title: 'Switch between dark and light mode', onClick: () => this.toggleTheme() }));
    platform.setSettings({ theme });
    this.recolor(); // canvases on "Match app" follow the UI theme
  }

  _keys() {
    const order = ['schematic', 'board', 'gerber', 'library'];
    document.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || document.querySelector('.modal-backdrop') || this.projects?.isOpen) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && /^[1-4]$/.test(e.key)) { this.setWorkspace(order[+e.key - 1]); e.preventDefault(); }
      else if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) this.redo(); else this.undo(); }
      else if (mod && k === 'y') { e.preventDefault(); this.redo(); }
      else if (mod && !e.shiftKey && this.active?.editor?.onModKey?.(e)) { e.preventDefault(); }
      else if (!mod && !e.altKey && this.active?.editor?.onKey(e)) { e.preventDefault(); }
      else if (mod && k === 's') { e.preventDefault(); if (e.shiftKey) this.exportFile(); else this.saveNow(); }
      else if (mod && k === 'o') { e.preventDefault(); this.importFile(); }
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
    const rows = [['Select tool', 'V'], ['Wire tool (click to start, click a Pin or Wire to finish)', 'W'], ['Flip the wire corner', '/'], ['Undo last wire corner', 'Backspace'], ['Netlist', 'Netlist button above the parts'], ['Undo', 'Ctrl+Z'], ['Redo', 'Ctrl+Shift+Z / Ctrl+Y'], ['Rotate (placing or selected)', 'R'], ['Mirror', 'X'], ['Delete selected', 'Del'], ['Move selection (drag, or one grid step; Shift for ten)', 'Arrow keys'], ['Copy / Paste / Duplicate', 'Ctrl+C / Ctrl+V / Ctrl+D'], ['Select all', 'Ctrl+A'], ['Box select (left→right: inside, right→left: touching)', 'Drag on empty canvas'], ['Stop placing / deselect', 'Esc'], ['New project', 'Ctrl+N'], ['Open file (import)', 'Ctrl+O'], ['Save now', 'Ctrl+S'], ['Save as file', 'Ctrl+Shift+S'], ['Pan', 'Middle- or right-drag'], ['Zoom', 'Scroll wheel'], ['Fit the view', 'Home'], ['Schematic · Board · Gerber · Library', 'Ctrl+1 … Ctrl+4'], ['This help', '?']];
    m.body.append(h('div', { class: 'shortcut-group' }, h('h4', {}, 'Every workspace'),
      ...rows.map(([a, b]) => h('div', { class: 'shortcut-row' }, h('span', {}, a), h('span', { class: 'kbd' }, b)))));
  }

  settingsDialog() {
    const m = modal({ title: 'Settings', width: 520 });
    const sel = h('select', { class: 'select' }, h('option', { value: 'dark' }, 'Dark'), h('option', { value: 'light' }, 'Light'));
    sel.value = this.settings.theme === 'light' ? 'light' : 'dark';
    sel.addEventListener('change', () => { if (sel.value !== (this.settings.theme === 'light' ? 'light' : 'dark')) this.toggleTheme(); });
    m.body.append(h('label', { class: 'field' }, h('span', {}, 'App theme'), sel),
      colorsSection(this),
      fieldStylesSection(this),
      h('p', { class: 'side-note' }, 'More settings (units, AI providers, agents) arrive with later tickets.'));
  }
}
