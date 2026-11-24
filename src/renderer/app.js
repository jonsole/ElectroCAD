// Application shell: top bar, workspace tabs, theme and dialogs (layout per docs/UI.md,
// modelled on DabbleCAD's app shell).
import { APP_NAME, LOGO_SVG } from './brand.js';
import { h, button, modal } from './ui/dom.js';
import { platform } from './platform.js';
import { newProject } from './core/project.js';
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
      this.project.name = this.nameInput.value.trim() || 'Untitled';
      this.nameInput.value = this.project.name;
      document.title = `${this.project.name} · ${APP_NAME}`;
    });
    this.saveState = h('span', { class: 'save-state', title: 'Saving arrives with #3' }, 'Not saved yet');
    this.themeBtn = button({ icon: this.settings.theme === 'light' ? 'moon' : 'sun', title: 'Switch between dark and light mode', onClick: () => this.toggleTheme() });

    const topbar = h('div', { class: 'topbar', role: 'toolbar', 'aria-label': 'Project and app tools' },
      logo, sep(), this.nameInput, this.saveState, spacer(),
      later({ label: 'Import', icon: 'import', title: 'Open a project or import KiCad / Eagle files' }, 3),
      later({ label: 'Export', icon: 'export', title: 'Save or export the project' }, 3),
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

    root.append(topbar, tabBar, ...this.workspaces.map((w) => w.el));
    document.title = `${this.project.name} · ${APP_NAME}`;
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
      if ((e.ctrlKey || e.metaKey) && /^[1-4]$/.test(e.key)) { this.setWorkspace(order[+e.key - 1]); e.preventDefault(); }
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
    const rows = [['Pan', 'Middle- or right-drag'], ['Zoom', 'Scroll wheel'], ['Fit the view', 'Home'], ['Schematic · Board · Gerber · Library', 'Ctrl+1 … Ctrl+4'], ['This help', '?']];
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
