// The Grid card: a toolbar button (icon only, lit while open) and a floating card over the
// canvas, like the Schematic's Sheets, Netlist and ERC cards. It sets the main and Alt grids and
// the grid origin of whatever the editor is showing (the current Sheet, the Board, the Symbol
// editor). The same component serves all three editors.
import { h, button, icon } from './dom.js';
import { gridLabel } from '../core/grid.js';
import { makeDraggable } from './draggable.js';

export class GridCard {
  /**
   * @param {object} o
   * @param {string} o.key                     remembers the card's place (per browser)
   * @param {[number, string][]} o.choices     grid steps offered: [nm, label]
   * @param {() => {grid: {main:number, alt:number}, origin: number[], scope: string, originNote: string, originEditable?: boolean}} o.state
   * @param {(which: 'main'|'alt', nm: number) => void} o.onGrid
   * @param {(at: number[]) => void} [o.onOrigin]   set the origin to a point (mm inputs, Reset)
   * @param {() => void} [o.onPick]                 pick the origin on the canvas (the Origin tool)
   */
  constructor(o) {
    this.o = o;
    this.open = false;
    this.el = h('div', { class: 'float-panel grid-card', role: 'region', 'aria-label': 'Grid' });
    this.el.style.display = 'none';
    this.el.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
    this.button = button({ icon: 'grid', title: 'Grid: the snap grid, the Alt grid and the origin', onClick: () => this.toggle() });
  }

  /**
   * Put the card over a workspace's canvas: into an existing card column (`layer`, `dock`), or a
   * column of its own.
   */
  mount(ws, { layer = null, dock = null } = {}) {
    if (!layer) {
      const stack = h('div', { class: 'float-stack' });
      layer = h('div', { class: 'card-layer' }, stack);
      ws.view.el.append(layer);
      dock = { el: stack, put: (card) => stack.append(card) };
      stack.append(this.el);
    }
    makeDraggable(this.el, { key: this.o.key, layer, dock });
    this.render();
  }

  toggle(open = !this.open) {
    this.open = open;
    this.button.classList.toggle('active', open);
    this.render();
  }

  render() {
    const el = this.el;
    el.style.display = this.open ? '' : 'none';
    if (!this.open) return;
    const a = document.activeElement;
    if (el.contains(a) && a.tagName === 'INPUT') return; // don't disturb typing
    const st = this.o.state();
    const sel = (which, label, help) => {
      const cur = st.grid[which];
      const s = h('select', { class: 'select', 'aria-label': label, title: help },
        ...this.o.choices.map(([v, l]) => h('option', { value: String(v), selected: v === cur }, l)));
      if (!this.o.choices.some(([v]) => v === cur)) s.prepend(h('option', { value: String(cur), selected: true }, gridLabel(cur)));
      s.addEventListener('change', () => this.o.onGrid(which, +s.value));
      s.addEventListener('keydown', (e) => e.stopPropagation());
      return h('label', { class: 'le-row' }, h('span', {}, label), s, h('em', {}, ''));
    };
    const fmt = (nm) => String(+(nm / 1e6).toFixed(3));
    const num = (label, v, i) => {
      const inp = h('input', { class: 'input', type: 'number', step: '0.01', value: fmt(v), 'aria-label': label, title: `${label}, in mm` });
      inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') inp.blur(); });
      inp.addEventListener('change', () => {
        const n = parseFloat(inp.value);
        if (!Number.isFinite(n)) return;
        const at = [...st.origin]; at[i] = Math.round(n * 1e6);
        this.o.onOrigin(at);
      });
      return inp;
    };
    const editable = st.originEditable !== false && this.o.onOrigin;
    const atOrigin = !st.origin[0] && !st.origin[1];
    el.replaceChildren(
      h('div', { class: 'fp-head' }, h('b', {}, 'Grid'), h('span', { class: 'fp-count', title: st.scope }, st.scope),
        button({ icon: 'close', title: 'Close', cls: 'btn-ghost', onClick: () => this.toggle(false) })),
      h('div', { class: 'fp-body' },
        sel('main', 'Grid', 'The snap grid'),
        sel('alt', 'Alt grid', 'Hold Alt while drawing, moving or resizing to snap to this grid'),
        h('div', { class: 'grid-card-origin' },
          h('span', { class: 'grid-card-label' }, 'Origin'),
          editable ? h('span', { class: 'grid-card-xy' }, h('span', {}, 'X'), num('Origin X', st.origin[0], 0), h('span', {}, 'Y'), num('Origin Y', st.origin[1], 1)) : h('span', { class: 'grid-card-note' }, st.originNote),
          h('span', { class: 'grid-card-btns' },
            this.o.onPick ? button({ icon: 'target', title: 'Pick the origin on the canvas (Origin tool, O)', cls: 'btn-ghost btn-xs', onClick: () => this.o.onPick() }) : null,
            editable && !atOrigin ? button({ icon: 'undo2', title: 'Reset the origin', cls: 'btn-ghost btn-xs', onClick: () => this.o.onOrigin([0, 0]) }) : null)),
        h('p', { class: 'side-note' }, editable ? `${st.originNote} Hold Alt while drawing, moving or resizing for the Alt grid.` : 'Hold Alt while drawing, moving or resizing for the Alt grid.')));
  }
}
