// A Workspace is one top-level tab (Schematic, Board, Gerber, Library). Every workspace uses
// the layout of DabbleCAD's Laser workspace (docs/UI.md, "Screen layout"):
//   toolbar / hint bar / [tool palette | ruled canvas | side panel] / bottom chips + status.
import { h, button, icon } from '../ui/dom.js';
import { Canvas2D } from '../view/canvas2d.js';
import { addResizer } from '../ui/resizer.js';

/** A toolbar or palette button that is not built yet: shown, but disabled with a pointer to its ticket. */
export function later(opts, ticket) {
  const b = button({ ...opts, title: `${opts.title || opts.label} (coming in #${ticket})` });
  b.disabled = true;
  return b;
}

export const sep = () => h('span', { class: 'sep' });
export const spacer = () => h('span', { class: 'spacer' });

/** Collapsible uppercase side-panel section, like the Laser workspace's LAYERS / LASER. */
export function section(title, ...children) {
  return h('details', { class: 'panel-section', open: true }, h('summary', {}, title), ...children);
}

/** Segmented control (DabbleCAD .segmented); returns the element. Items: [id, label, icon, title, ticket?]. */
export function segmented(items, active, onPick) {
  const seg = h('div', { class: 'segmented' });
  for (const [id, label, ic, title, ticket] of items) {
    const b = ticket ? later({ label, icon: ic, title, size: 16 }, ticket) : button({ label, icon: ic, title, size: 16, onClick: () => onPick && onPick(id) });
    b.dataset.id = id;
    if (id === active) b.classList.add('active');
    seg.append(b);
  }
  return seg;
}

export class Workspace {
  /**
   * @param {object} cfg
   * @param {string} cfg.id
   * @param {string} cfg.label
   * @param {string} cfg.icon
   * @param {string} cfg.title         tab tooltip
   * @param {number} cfg.grid          snap grid in nm
   * @param {object} [cfg.frame]       sheet rectangle in nm
   * @param {object} [cfg.home]        rectangle fitted by Home
   * @param {Element[]} cfg.toolbar
   * @param {string} cfg.hint
   * @param {Element[]} cfg.tools      left tool palette buttons (null = separator)
   * @param {Element} cfg.side         side panel element
   * @param {() => Element[]} [cfg.chips]
   * @param {() => string} [cfg.status]
   * @param {() => object} cfg.colors    resolved Colour theme tokens for this canvas
   * @param {() => void} [cfg.onRefresh]
   * @param {(ctx, view, colors) => void} [cfg.draw]  draws the workspace content
   */
  constructor(cfg) {
    this.id = cfg.id;
    this.cfg = cfg;
    this.view = new Canvas2D({ grid: cfg.grid, frame: cfg.frame, home: cfg.home, colors: cfg.colors, draw: cfg.draw });
    this.hint = h('span', { class: 'hint-text' }, cfg.hint);
    this.chipStrip = h('div', { class: 'chip-strip' });
    // columns either side of the canvas that floating cards dock into (drag a card to an edge)
    this.dockL = h('div', { class: 'dock-col dock-left', role: 'complementary', 'aria-label': 'Docked panels, left' });
    this.dockR = h('div', { class: 'dock-col dock-right', role: 'complementary', 'aria-label': 'Docked panels, right' });
    this.statusText = h('div', { class: 'status-text' });
    const toolCol = h('div', { class: 'tool-col', role: 'toolbar', 'aria-label': `${cfg.label} tools`, 'aria-orientation': 'vertical' },
      ...cfg.tools.map((t) => t || h('span', { class: 'sep-h' })));
    this.el = h('div', { class: 'ws-root', dataset: { ws: cfg.id }, role: 'tabpanel', 'aria-label': cfg.label },
      h('div', { class: 'toolbar', role: 'toolbar', 'aria-label': `${cfg.label} toolbar` }, ...cfg.toolbar),
      h('div', { class: 'hint-bar' }, this.hint),
      h('div', { class: 'ws-main' }, toolCol, this.dockL, this.view.el, this.dockR, cfg.side || ''),
      h('div', { class: 'bottom-bar' }, this.chipStrip, this.statusText));
    const splitL = addResizer(this.dockL, { side: 'left', key: `${cfg.id}-dock-left`, min: 220, max: 560 });
    const splitR = addResizer(this.dockR, { side: 'right', key: `${cfg.id}-dock-right`, min: 220, max: 560 });
    // a column with no card showing takes no room, nor does its splitter
    const tidy = () => {
      for (const [col, split] of [[this.dockL, splitL], [this.dockR, splitR]]) {
        const empty = ![...col.children].some((c) => c.style.display !== 'none');
        col.classList.toggle('empty', empty); split.classList.toggle('empty', empty);
      }
    };
    tidy();
    for (const col of [this.dockL, this.dockR]) new MutationObserver(tidy).observe(col, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
    this.refresh();
  }

  refresh() {
    this.renderBar();
    if (this.cfg.onRefresh) this.cfg.onRefresh();
  }

  /** The bottom bar only: chips and status. */
  renderBar() {
    this.chipStrip.replaceChildren(...(this.cfg.chips ? this.cfg.chips() : []));
    this.statusText.textContent = this.cfg.status ? this.cfg.status() : '';
  }

  /** Redraw after a Colour theme or UI theme change. */
  recolor() {
    this.refresh();
    this.view.invalidate();
  }

  show(on) {
    this.el.classList.toggle('active', on);
    if (on) requestAnimationFrame(() => this.view.resize());
  }
}

/** Active-state tool palette button (only Select is live in the boot shell). */
export function toolButton(ic, title, { active = false, ticket = null } = {}) {
  const b = ticket ? later({ icon: ic, title }, ticket) : button({ icon: ic, title });
  if (active) b.classList.add('active');
  return b;
}

export { icon };
