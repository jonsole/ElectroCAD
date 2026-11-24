// Your projects: the home screen of every Project in the Project store (ADR-0011).
// Ported from DabbleCAD's "Your designs" dashboard (ui/dashboard.js); see NOTICE.
import { h, clear, button, icon, popupMenu, confirmDialog, promptDialog } from './dom.js';
import { platform, isDesktop } from '../platform.js';
import { describeMeta, sortNewestFirst } from '../core/store.js';
import { APP_NAME, LOGO_SVG } from '../brand.js';

function ago(ts) {
  if (!ts) return '';
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return new Date(ts).toLocaleDateString();
}

export class ProjectsScreen {
  constructor(app) {
    this.app = app;
    this.grid = h('div', { class: 'dash-grid', role: 'list', 'aria-label': 'Your projects' });
    this.el = h('div', { class: 'dashboard', role: 'dialog', 'aria-label': 'Your projects' },
      h('div', { class: 'dash-head' },
        h('div', { class: 'logo', style: { cursor: 'default' } }, h('span', { class: 'logo-mark', html: LOGO_SVG }), h('span', { class: 'logo-name' }, APP_NAME)),
        h('span', { class: 'spacer' }),
        button({ label: 'Open file…', icon: 'folder', cls: 'btn-outline', title: 'Bring an .ecad file into Your projects', onClick: () => this.app.importFile() }),
        isDesktop ? button({ label: 'Projects folder', icon: 'external', cls: 'btn-outline', title: 'Show the folder where your projects are kept', onClick: () => platform.store.openFolder() }) : null,
        button({ label: 'Back to project', icon: 'chevronRight', cls: 'btn-outline', onClick: () => this.hide() })),
      h('div', { class: 'dash-body' }, h('h2', { class: 'dash-title' }, 'Your projects'), this.grid));
    this.el.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !document.querySelector('.modal-backdrop, .menu')) { e.stopPropagation(); this.hide(); } });
    document.body.append(this.el);
  }

  get isOpen() { return this.el.classList.contains('open'); }

  async show() {
    await this.app.saveNow(); // so the open Project's card is current
    this.el.classList.add('open');
    await this.refresh();
    (this.grid.querySelector('.dash-card.current') || this.grid.firstChild)?.focus();
  }

  hide() { this.el.classList.remove('open'); }

  async refresh() {
    const list = sortNewestFirst(await platform.store.list());
    clear(this.grid);
    const create = h('div', { class: 'dash-card dash-new', tabindex: '0', role: 'listitem' }, icon('plus', 34), 'Create new project');
    const doCreate = async () => { if (await this.app.newProject()) this.hide(); };
    create.addEventListener('click', doCreate);
    create.addEventListener('keydown', (e) => { if (e.key === 'Enter') doCreate(); });
    this.grid.append(create);
    for (const meta of list) {
      const open = async () => { if (await this.app.openStored(meta.id)) this.hide(); };
      const more = button({ icon: 'list', title: 'More', cls: 'btn-ghost', onClick: (e) => {
        e.stopPropagation();
        popupMenu([
          { label: 'Open', icon: 'pencil', onClick: open },
          { label: 'Duplicate', icon: 'duplicate', onClick: async () => { await this.app.duplicateStored(meta.id); this.refresh(); } },
          { label: 'Rename', icon: 'pencil', onClick: async () => {
            const name = await promptDialog('Rename project', 'Name', meta.name);
            if (name && name.trim()) { await this.app.renameStored(meta.id, name.trim()); this.refresh(); }
          } },
          { label: 'Save as file…', icon: 'export', onClick: () => this.app.exportStored(meta.id) },
          'sep',
          { label: 'Delete', icon: 'trash', onClick: async () => {
            if (await confirmDialog('Delete project', `"${meta.name}" will be permanently deleted.`, 'Delete', true)) {
              await this.app.deleteStored(meta.id);
              this.refresh();
            }
          } },
        ], more);
      } });
      const card = h('div', { class: 'dash-card' + (meta.id === this.app.project.id ? ' current' : ''), tabindex: '0', role: 'listitem', dataset: { id: meta.id }, 'aria-label': meta.name },
        h('div', { class: 'dash-thumb', style: meta.thumb ? { backgroundImage: `url(${meta.thumb})` } : {} }),
        h('div', { class: 'dash-meta' }, h('div', {}, h('b', {}, meta.name || 'Untitled'), h('small', {}, `${ago(meta.modified)} · ${describeMeta(meta)}`)), more));
      card.addEventListener('click', open);
      card.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === card) open(); });
      this.grid.append(card);
    }
  }
}
