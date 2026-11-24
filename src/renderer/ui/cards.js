// A set of floating, dockable cards for an editor, each with an icon button on the toolbar
// (DabbleCAD's dockable panels; see ui/draggable.js). Replaces the fixed side panels: a card
// starts in a column at the top right of the canvas, floats when dragged, and docks beside the
// canvas when dropped on an edge. Whether each card is open is remembered in this browser.
import { h, icon, button } from './dom.js';
import { makeDraggable } from './draggable.js';

/**
 * The title bar every floating card has, as DabbleCAD's panels: an icon, the title (and an
 * optional muted detail, text or an element), any action buttons, then the close X on the right.
 * Dragging it moves the card; double-clicking it puts the card back in its column.
 */
export function cardHead({ icon: ic, title, sub = null, actions = [], onClose = null, closeTitle = 'Close' }) {
  const detail = sub == null || sub === '' ? '' : typeof sub === 'string' ? h('span', { class: 'insp-sub' }, ` · ${sub}`) : sub;
  return h('div', { class: 'insp-head card-head', title: 'Drag to move · drop on the left or right edge of the canvas to dock · double-click to put it back' },
    icon(ic, 16), h('div', { class: 'insp-title', title: typeof title === 'string' ? title : '' }, title, detail),
    ...actions.filter(Boolean),
    onClose ? button({ icon: 'close', title: closeTitle, size: 16, cls: 'btn-ghost card-close', onClick: onClose }) : '');
}

export class CardSet {
  /** prefix: names its cards in storage (e.g. 'board'). */
  constructor(prefix) {
    this.prefix = prefix;
    this.cards = [];
    this.visible = true;
  }

  /**
   * Add a card: { id, title, icon, body: Element[], open (default true), cls, tip }.
   * Returns { el, button, toggle(open) }.
   */
  add({ id, title, icon: ic, body, open = true, cls = '', tip = '' }) {
    const key = `electrocad.cardOpen.${this.prefix}-${id}`;
    let isOpen = open;
    try { const v = localStorage.getItem(key); if (v != null) isOpen = v === '1'; } catch { /* private mode */ }
    const card = { id, title, isOpen };
    card.el = h('div', { class: `float-panel side-card ${cls}`, role: 'region', 'aria-label': title, dataset: { card: id } },
      cardHead({ icon: ic, title, onClose: () => card.toggle(false), closeTitle: `Close (the ${title} button on the toolbar opens it again)` }),
      h('div', { class: 'fp-body side-card-body' }, ...body));
    card.el.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
    card.button = button({ icon: ic, title: tip || `${title} (a floating card; drag it to an edge of the canvas to dock it)`, onClick: () => card.toggle() });
    card.toggle = (on = !card.isOpen) => {
      card.isOpen = on;
      try { localStorage.setItem(key, on ? '1' : '0'); } catch { /* private mode */ }
      this._show(card);
    };
    this.cards.push(card);
    this._show(card);
    return card;
  }

  _show(card) {
    card.el.style.display = this.visible && card.isOpen ? '' : 'none';
    card.button.classList.toggle('active', card.isOpen);
    card.button.hidden = !this.visible;
  }

  /** Show or hide the whole set (the Library tab's Symbol | Footprint switch). */
  setVisible(on) { this.visible = on; for (const c of this.cards) this._show(c); }

  buttons() { return this.cards.map((c) => c.button); }
  card(id) { return this.cards.find((c) => c.id === id); }

  /** Put the cards over a workspace's canvas, in a column at its top right, dockable at its edges. */
  mount(ws) {
    const stack = h('div', { class: 'float-stack side-cards' });
    const layer = h('div', { class: 'card-layer' }, stack);
    ws.view.el.append(layer);
    const order = this.cards.map((c) => c.el);
    const dock = { el: stack, put: (el) => stack.append(...order.filter((c) => c === el || c.parentElement === stack)) };
    for (const el of order) stack.append(el);
    for (const c of this.cards) makeDraggable(c.el, { key: `${this.prefix}-${c.id}`, layer, dock, edges: { left: ws.dockL, right: ws.dockR }, resize: { minW: 240, maxW: 560, minH: 120 } });
  }
}
