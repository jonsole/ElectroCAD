// The Grid card: a toolbar button (icon only, lit while open) and a floating card over the
// canvas, like the Schematic's Sheets, Netlist and ERC cards. It sets the main and Alt grids and
// the grid origin of whatever the editor is showing (the current Sheet, the Board, the Symbol
// editor). The same component serves all three editors.
import { h, button, icon, popupMenu, toast } from './dom.js';
import { gridLabel, parseGridStep } from '../core/grid.js';
import { makeDraggable } from './draggable.js';
import { cardHead } from './cards.js';

export class GridCard {
  /**
   * @param {object} o
   * @param {string} o.key                     remembers the card's place (per browser)
   * @param {[number, string][]} o.choices     grid steps offered: [nm, label]
   * @param {() => {grid: {main:number, alt:number}, origin: number[], scope: string, originNote: string, originEditable?: boolean}} o.state
   * @param {(which: 'main'|'alt', nm: number) => void} o.onGrid
   * @param {() => void} [o.onSwap]                 swap the grid and the Alt grid (one undo step); else two onGrid calls
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

  /** Swap the main and Alt grid steps. */
  swap() {
    const { grid } = this.o.state();
    if (grid.main === grid.alt) return;
    if (this.o.onSwap) this.o.onSwap();
    else { const { main, alt } = grid; this.o.onGrid('main', alt); this.o.onGrid('alt', main); }
    this.render();
  }

  render() {
    const el = this.el;
    el.style.display = this.open ? '' : 'none';
    if (!this.open) return;
    const a = document.activeElement;
    if (el.contains(a) && a.tagName === 'INPUT') return; // don't disturb typing
    const st = this.o.state();
    // a grid step: type one in ("0.1mm", "7mil"; a bare number is in the current step's unit),
    // or pick from the list (the arrow)
    const sel = (which, label, help) => {
      const cur = st.grid[which];
      const inp = h('input', { class: 'input grid-step-input', type: 'text', value: gridLabel(cur), spellcheck: false, autocomplete: 'off', 'aria-label': label, title: `${help}. Type a size such as 0.1mm or 7mil, or pick one` });
      const apply = () => {
        const unit = /mil$/.test(gridLabel(cur)) ? 'mil' : 'mm';
        const nm = parseGridStep(inp.value, unit);
        if (nm == null) { if (inp.value.trim() !== gridLabel(cur)) toast('Type a grid size such as 0.1mm or 7mil (0.001 to 100 mm).', 'info', 2600); inp.value = gridLabel(cur); return; }
        if (nm !== cur) this.o.onGrid(which, nm); else inp.value = gridLabel(cur);
      };
      inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') inp.blur(); if (e.key === 'Escape') { inp.value = gridLabel(cur); inp.blur(); } });
      inp.addEventListener('change', apply);
      inp.addEventListener('blur', () => setTimeout(() => this.render()));
      const pick = button({ icon: 'chevron', title: `Pick the ${label.toLowerCase()} from the list`, cls: 'btn-ghost btn-xs grid-step-pick',
        onClick: () => popupMenu(this.o.choices.map(([v, l]) => ({ label: l, checked: v === cur, onClick: () => { if (v !== cur) this.o.onGrid(which, v); this.render(); } })), inp) });
      return h('label', { class: 'le-row' }, h('span', {}, label), h('span', { class: 'grid-step' }, inp, pick), h('em', {}, ''));
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
      cardHead({ icon: 'grid', title: 'Grid', sub: st.scope, onClose: () => this.toggle(false), closeTitle: 'Close (the Grid button on the toolbar opens it again)' }),
      h('div', { class: 'fp-body' },
        h('div', { class: 'grid-card-steps' },
          h('div', { class: 'grid-card-sels' },
            sel('main', 'Grid', 'The snap grid'),
            sel('alt', 'Alt grid', 'Hold Alt while drawing, moving or resizing to snap to this grid')),
          button({ icon: 'swapVert', title: 'Swap the grid and the Alt grid', cls: 'btn-ghost btn-xs grid-card-swap', onClick: () => this.swap() })),
        h('div', { class: 'grid-card-origin' },
          h('span', { class: 'grid-card-label' }, 'Origin'),
          editable ? h('span', { class: 'grid-card-xy' }, h('span', {}, 'X'), num('Origin X', st.origin[0], 0), h('span', {}, 'Y'), num('Origin Y', st.origin[1], 1)) : h('span', { class: 'grid-card-note' }, st.originNote),
          h('span', { class: 'grid-card-btns' },
            this.o.onPick ? button({ icon: 'target', title: 'Pick the origin on the canvas (Origin tool, O)', cls: 'btn-ghost btn-xs', onClick: () => this.o.onPick() }) : null,
            editable && !atOrigin ? button({ icon: 'undo2', title: 'Reset the origin', cls: 'btn-ghost btn-xs', onClick: () => this.o.onOrigin([0, 0]) }) : null)),
        h('p', { class: 'side-note' }, editable ? `${st.originNote} Hold Alt while drawing, moving or resizing for the Alt grid.` : 'Hold Alt while drawing, moving or resizing for the Alt grid.')));
  }
}
