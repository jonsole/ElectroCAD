// Application shell: top bar, workspace tabs, theme and dialogs (layout per docs/UI.md,
// modelled on DabbleCAD's app shell).
import { APP_NAME, LOGO_SVG } from './brand.js';
import { h, button, modal, popupMenu, toast } from './ui/dom.js';
import { platform } from './platform.js';
import { parseLibrary, serializeLibrary } from './core/library.js';
import { HIGHLIGHT_STYLES, DEFAULT_HIGHLIGHT } from './view/highlight.js';
import { probeKey, probeIsEmpty } from './core/probe.js';
import { openPrintDialog } from './print/dialog.js';
import { newProject, serialize, deserialize, ProjectFileError } from './core/project.js';
import { History } from './core/history.js';
import { projectMeta, importProject, duplicateProject, exportFileName } from './core/store.js';
import { renderThumbnail } from './view/thumbnail.js';
import { ProjectsScreen } from './ui/projects.js';
import { resolveTheme, listThemes, MATCH_APP } from './core/themes.js';
import { colorsSection } from './ui/themes.js';
import { fieldStylesSection } from './ui/fieldStyles.js';
import { setDefaultFieldStyle } from './core/fields.js';
import { DEFAULT_DISPLAY } from './schematic/render.js';
import { buildWorkspaces } from './workspaces/index.js';
import { later, sep, spacer } from './workspaces/workspace.js';

/** The commit this build was made from (set in vite.config.mjs). */
const BUILD = typeof __APP_BUILD__ === 'object' ? __APP_BUILD__ : { sha: 'unknown', short: 'dev', branch: '', date: '' };
const BUILD_TITLE = `Commit ${BUILD.sha}${BUILD.branch ? `\nBranch ${BUILD.branch}` : ''}${BUILD.date ? `\nBuilt ${new Date(BUILD.date).toLocaleString()}` : ''}`;

export class App {
  async init() {
    this.settings = await platform.getSettings();
    this.applyTheme(this.settings.theme);
    this.applyHintBar();
    this.project = await this._startupProject();
    this.save = { dirty: false, saving: false, timer: null, pending: null };
    this.history = new History(() => this.project, (p) => { this.project = p; }, () => this._afterEdit());
    this.libraries = await this._loadLibraries();
    this.workspaces = buildWorkspaces(this);
    this._build();
    this.projects = new ProjectsScreen(this);
    this._rememberLast();
    platform.onBeforeClose(() => this.saveNow());
    // browser: save when the tab is hidden or closed (autosave normally got there first)
    window.addEventListener('pagehide', () => { if (this.save.dirty) this.saveNow(); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && this.save.dirty) this.saveNow(); });
    this.split = !!this.settings.split;
    this.splitBtn.classList.toggle('active', this.split);
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

    // split view (#18): the Schematic and the Board side by side, each probing the other
    this.splitBtn = button({ icon: 'split', label: 'Split', title: 'Split view: the Schematic and the Board side by side; selecting in one highlights and scrolls to it in the other', cls: 'ws-split', onClick: () => this.toggleSplit() });
    tabBar.append(h('span', { class: 'spacer' }), this.splitBtn);
    this.tabBar = tabBar;
    this.wsHost = h('div', { class: 'ws-host' }, ...this.workspaces.map((w) => w.el));
    // in split view, a click in a pane makes that workspace the active one (keys, undo go there)
    this.wsHost.addEventListener('pointerdown', (e) => {
      if (!this.split) return;
      const w = this.workspaces.find((x) => x.el.contains(e.target));
      if (w && w !== this.active) this.setWorkspace(w.id);
    }, true);
    root.append(topbar, tabBar, this.wsHost);
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
  // a workspace with its own history (the Library tab's Part editor) undoes its own edits
  undo() { const ed = this.active?.editor; if (ed?.ownHistory) ed.undo(); else this.history.undo(); }
  redo() { const ed = this.active?.editor; if (ed?.ownHistory) ed.redo(); else this.history.redo(); }

  // ---------------------------------------------------------------- user Libraries (#13)

  async _loadLibraries() {
    const out = [];
    let texts = [];
    try { texts = await platform.libraries.list(); } catch (err) { console.warn('Library store unavailable', err); }
    for (const t of texts) { try { out.push(parseLibrary(t)); } catch (err) { console.warn('Skipped a library file', err.message); } }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Every Part in the user's Libraries (for the Schematic's picker). */
  userParts() { return this.libraries.flatMap((l) => Object.values(l.parts)); }

  async saveLibrary(lib) {
    if (!this.libraries.includes(lib)) { this.libraries.push(lib); this.libraries.sort((a, b) => a.name.localeCompare(b.name)); }
    await platform.libraries.save(lib.id, serializeLibrary(lib));
    this.workspace('schematic')?.editor?.librariesChanged?.();
  }

  async deleteLibrary(id) {
    this.libraries = this.libraries.filter((l) => l.id !== id);
    await platform.libraries.delete(id);
    this.workspace('schematic')?.editor?.librariesChanged?.();
  }

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
    this.probe = null;
    this.workspaces = buildWorkspaces(this);
    this.wsHost.append(...this.workspaces.map((w) => w.el));
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
    const was = this.active;
    this.active = ws;
    const pair = this.split && (id === 'schematic' || id === 'board');
    this.wsHost.classList.toggle('split', !!pair);
    for (const w of this.workspaces) {
      const on = w === ws, shown = on || (pair && (w.id === 'schematic' || w.id === 'board'));
      if (w.el.classList.contains('active') !== shown || on) w.show(shown);
      w.el.classList.toggle('focused', !!pair && on);
      this.tabs[w.id].classList.toggle('active', on);
      this.tabs[w.id].setAttribute('aria-selected', String(on));
    }
    // switching tabs shows the other editor's cross-probe, scrolled into view
    if (was !== ws && !pair) ws.editor?.revealProbe?.();
    if (this.settings.workspace !== id) { this.settings.workspace = id; platform.setSettings({ workspace: id }); }
  }

  workspace(id) { return this.workspaces.find((w) => w.id === id); }

  // ---------------------------------------------------------------- cross-probing (#18)

  /**
   * The Components and Nets selected in one editor (`source`: 'schematic' or 'board'). The other
   * editor highlights them; in split view it also scrolls to them.
   */
  setProbe(source, probe) {
    const key = probeKey(probe);
    if (this.probe && this.probe.source === source && this.probe.key === key) return;
    if (!this.probe && probeIsEmpty(probe)) return;
    this.probe = { source, probe, key };
    for (const w of this.workspaces) {
      if (w.id === source) continue;
      w.view.invalidate();
      if (this.split && w.el.classList.contains('active')) w.editor?.revealProbe?.();
    }
  }

  /** The probe another editor set, for `id` to highlight (null when it set it itself, or none). */
  probeFor(id) { return this.probe && this.probe.source !== id && !probeIsEmpty(this.probe.probe) ? this.probe.probe : null; }

  toggleSplit(on = !this.split) {
    this.split = on;
    this.splitBtn.classList.toggle('active', on);
    this.settings.split = on; platform.setSettings({ split: on });
    const id = this.active && (this.active.id === 'schematic' || this.active.id === 'board') ? this.active.id : 'schematic';
    this.setWorkspace(id);
    for (const w of this.workspaces) requestAnimationFrame(() => w.view.resize());
  }

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

  /** How close (screen pixels) the pointer must come to another object's handle or pad to snap onto it; 0 is off. */
  snapDistance() { const v = this.settings.snapDistance; return Number.isFinite(v) ? v : 10; }

  /** The hint bar (context help) under each toolbar: off unless turned on in Settings. */
  applyHintBar(on = !!this.settings.hintBar) { document.documentElement.classList.toggle('no-hint-bar', !on); for (const w of this.workspaces || []) requestAnimationFrame(() => w.view.resize()); }

  /** How selected things are highlighted in every editor (Settings → Highlight). */
  highlightStyle() { return this.settings.highlightStyle || DEFAULT_HIGHLIGHT; }

  /** Schematic display options (Settings → Schematic display), with defaults filled in. */
  schematicDisplay() { return { ...DEFAULT_DISPLAY, ...(this.settings.schematicDisplay || {}) }; }

  setSchematicDisplay(patch) {
    this.settings.schematicDisplay = { ...this.schematicDisplay(), ...patch };
    platform.setSettings({ schematicDisplay: this.settings.schematicDisplay });
    this.recolor();
  }

  _displaySection() {
    const d = this.schematicDisplay();
    const row = (key, label, note) => {
      const cb = h('input', { type: 'checkbox', checked: !!d[key], dataset: { display: key } });
      cb.addEventListener('change', () => this.setSchematicDisplay({ [key]: cb.checked }));
      return h('label', { class: 'check-row' }, cb, h('span', {}, label, note ? h('small', { class: 'side-note', style: { display: 'block', margin: 0 } }, note) : null));
    };
    return h('div', { class: 'colors-section' }, h('div', { class: 'set-group-title' }, 'Schematic display'),
      row('colorConnectedPins', 'Colour connected pins like wires', 'A pin with a wire on it is drawn in the wire colour.'),
      row('markUnconnectedPins', 'Mark unconnected pin ends', 'A small open circle at the tip of a pin with nothing on it.'),
      row('wireHops', 'Hop where wires cross', 'A small bridge where wires cross without connecting.'));
  }

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
      else if (mod && k === 's') { e.preventDefault(); if (!e.shiftKey && this.active?.editor?.ownHistory) this.active.editor.onModKey(e); else if (e.shiftKey) this.exportFile(); else this.saveNow(); }
      else if (mod && k === 'o') { e.preventDefault(); this.importFile(); }
      else if (mod && k === 'p') { e.preventDefault(); openPrintDialog(this); }
      else if (mod && k === 'n') { e.preventDefault(); this.newProject(); }
      else if (e.key === 'F8') { e.preventDefault(); this.workspace('board')?.editor?.annotate(); }
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
    const rows = [['Select tool', 'V'], ['Wire tool (click to start, click a Pin or Wire to finish)', 'W'], ['Flip the wire corner', '/'], ['Undo last wire corner', 'Backspace'], ['Net label (joins by name on this sheet)', 'L'], ['Global label (joins on every sheet)', 'Ctrl+L'], ['Power symbol (last net used; double-click its name to change)', 'P'], ['Ground', 'G'], ['No-connect marker (click a Pin tip; again to remove)', 'Q'], ['Text note (Shift+Enter: new line; ${TITLE}, ${SHEET_NAME}… work)', 'T'], ['Line (arrows in the inspector) / Rectangle / Circle / Arc', 'I / B / C / A'], ['Sheet setup (paper size, title block)', 'Double-click the title block'], ['Print / export to PDF or SVG', 'Ctrl+P'], ['Update the Board from the Schematic (forward annotation)', 'F8'], ['Grid origin tool', 'O'], ['Use the Alt grid while drawing, moving or resizing', 'Hold Alt'], ['Rename a label', 'Double-click it'], ['Move a part\'s name or value by hand (pins it)', 'Drag the text'], ['Context menu (Re-apply style, Rotate, …)', 'Right-click'], ['Switch sheet / add a sheet', 'Sheet chips at the bottom / +'], ['Sheets · Netlist cards', 'Icon buttons after Fields on the toolbar'], ['Undo', 'Ctrl+Z'], ['Redo', 'Ctrl+Shift+Z / Ctrl+Y'], ['Rotate (placing or selected)', 'R'], ['Mirror', 'X'], ['Delete selected', 'Del'], ['Move selection (drag, or one grid step; Shift for ten)', 'Arrow keys'], ['Copy / Paste / Duplicate', 'Ctrl+C / Ctrl+V / Ctrl+D'], ['Select all', 'Ctrl+A'], ['Box select (left→right: inside, right→left: touching)', 'Drag on empty canvas'], ['Stop placing / deselect', 'Esc'], ['New project', 'Ctrl+N'], ['Open file (import)', 'Ctrl+O'], ['Save now', 'Ctrl+S'], ['Save as file', 'Ctrl+Shift+S'], ['Pan', 'Middle- or right-drag'], ['Zoom', 'Scroll wheel'], ['Fit the view', 'Home'], ['Schematic · Board · Gerber · Library', 'Ctrl+1 … Ctrl+4'], ['This help', '?']];
    m.body.append(h('div', { class: 'shortcut-group' }, h('h4', {}, 'Every workspace'),
      ...rows.map(([a, b]) => h('div', { class: 'shortcut-row' }, h('span', {}, a), h('span', { class: 'kbd' }, b)))));
  }

  settingsDialog() {
    const m = modal({ title: 'Settings', width: 520 });
    const sel = h('select', { class: 'select' }, h('option', { value: 'dark' }, 'Dark'), h('option', { value: 'light' }, 'Light'));
    sel.value = this.settings.theme === 'light' ? 'light' : 'dark';
    sel.addEventListener('change', () => { if (sel.value !== (this.settings.theme === 'light' ? 'light' : 'dark')) this.toggleTheme(); });
    const snap = h('select', { class: 'select', title: 'While drawing, moving or resizing, points jump onto another object\'s handles (corners, ends, pads) when the pointer is this close' },
      ...[[0, 'Off'], [5, '5 px'], [10, '10 px'], [15, '15 px'], [20, '20 px'], [30, '30 px']].map(([v, l]) => h('option', { value: String(v), selected: v === this.snapDistance() }, l)));
    snap.addEventListener('change', () => { this.settings.snapDistance = +snap.value; platform.setSettings({ snapDistance: +snap.value }); });
    const hl = h('select', { class: 'select', 'aria-label': 'Highlight style', title: 'How selected parts, wires, labels, footprints and shapes are shown, in every editor. The colour is the Selection colour of each Colour theme' },
      ...HIGHLIGHT_STYLES.map(([v, l, t]) => h('option', { value: v, title: t, selected: v === this.highlightStyle() }, l)));
    hl.addEventListener('change', () => { this.settings.highlightStyle = hl.value; platform.setSettings({ highlightStyle: hl.value }); for (const w of this.workspaces) w.view.invalidate(); });
    const hint = h('input', { type: 'checkbox', checked: !!this.settings.hintBar, 'aria-label': 'Hint bar' });
    hint.addEventListener('change', () => { this.settings.hintBar = hint.checked; platform.setSettings({ hintBar: hint.checked }); this.applyHintBar(); });
    m.body.append(h('label', { class: 'field' }, h('span', {}, 'App theme'), sel),
      h('label', { class: 'field' }, h('span', {}, 'Snap to objects within'), snap),
      h('label', { class: 'field' }, h('span', {}, 'Highlight selected things with'), hl),
      h('label', { class: 'check-row', title: 'A line of context help under the toolbar: what the tool does and its keys' }, hint, 'Show the hint bar (context help) under the toolbar'),
      this._displaySection(),
      colorsSection(this),
      fieldStylesSection(this),
      h('p', { class: 'side-note' }, 'More settings (units, AI providers, agents) arrive with later tickets.'));
  }
}
