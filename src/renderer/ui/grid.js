// The grid and origin controls every editor shows in its properties when nothing is selected,
// and the Alt key watcher that switches to the Alt grid while held.
import { h, button } from './dom.js';
import { gridLabel } from '../core/grid.js';

/**
 * @param {object} o
 * @param {{main:number, alt:number}} o.grid
 * @param {[number, number][]} o.choices          [nm, label]
 * @param {(which: 'main'|'alt', nm: number) => void} o.onGrid
 * @param {string} o.originText                   where the origin is, in words
 * @param {(() => void) | null} [o.onResetOrigin] shown as a Reset button when given
 * @param {string} [o.resetTitle]
 */
export function gridPanel({ grid, choices, onGrid, originText, onResetOrigin = null, resetTitle = 'Put the origin back' }) {
  const sel = (which, label, help) => {
    const cur = grid[which];
    const el = h('select', { class: 'select', 'aria-label': label, title: help },
      ...choices.map(([v, l]) => h('option', { value: String(v), selected: v === cur }, l)));
    if (!choices.some(([v]) => v === cur)) el.prepend(h('option', { value: String(cur), selected: true }, gridLabel(cur)));
    el.addEventListener('change', () => onGrid(which, +el.value));
    el.addEventListener('keydown', (e) => e.stopPropagation());
    return h('label', { class: 'le-row' }, h('span', {}, label), el, h('em', {}, ''));
  };
  return h('div', { class: 'grid-panel' },
    sel('main', 'Grid', 'The snap grid'),
    sel('alt', 'Alt grid', 'Hold Alt while drawing, moving or resizing to snap to this grid'),
    h('div', { class: 'le-row' }, h('span', {}, 'Origin'), h('span', { class: 'origin-at' }, originText),
      onResetOrigin ? button({ label: 'Reset', cls: 'btn-ghost', title: resetTitle, onClick: onResetOrigin }) : h('em', {}, '')));
}

/** Call `setAlt(true/false)` as Alt goes down and up while `ws` is the active workspace. */
export function watchAlt(ws, setAlt) {
  const onKey = (e) => {
    if (e.key !== 'Alt' || !ws.el.classList.contains('active')) return;
    setAlt(e.type === 'keydown');
    if (e.type === 'keyup') e.preventDefault(); // keep the desktop app's menu bar from taking focus
  };
  document.addEventListener('keydown', onKey);
  document.addEventListener('keyup', onKey);
  window.addEventListener('blur', () => setAlt(false));
}
