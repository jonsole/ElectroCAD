// Floating, dockable cards over the canvas. Ported from DabbleCAD's makeDraggable and its
// dockable panels (ui/dock.js) (see NOTICE), and kept in step with them:
//  - a card starts in its home column over the canvas (`dock`, e.g. the top-right stack);
//  - drag it by its header to float it anywhere (its place and size are remembered);
//  - drag it to the left or right edge of the canvas, or onto a docked column, and drop it on the
//    highlighted strip to dock it in a column beside the canvas (the canvas makes room). Docked
//    cards stack top to bottom, in the order they were dropped; drag one out by its header;
//  - resize a floating card from its bottom-right corner; double-click a header to send it home.
// Header drags follow the pointer on the window (not pointer capture), because a card moves to
// another parent as it docks and undocks.
const GRIP = 16;   // px: the corner that resizes
const EDGE = 56;   // px from the canvas's edge that counts as "dock here"
const START = 6;   // px the pointer moves before a header drag starts (a click stays a click)
let topZ = 12;

/**
 * @param {HTMLElement} el            the card
 * @param {object} o
 * @param {string} o.key              remembered under electrocad.card.<key>
 * @param {HTMLElement} o.layer       the element cards float over (the canvas)
 * @param {{el, put}} o.dock          the card's home column over the canvas
 * @param {{left, right}} [o.edges]   columns beside the canvas to dock into
 */
export function makeDraggable(el, { key, layer, dock, edges = null, handle = '.insp-head, .fp-head', resize = { minW: 250, maxW: 520, minH: 140 } }) {
  const STORE = 'electrocad.card.' + key;
  // { left, top, w, h }: floating, px within `layer`; { side, order }: docked beside the canvas; null: home
  let pos = null;
  try { pos = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch { pos = null; }
  const save = () => { try { if (pos) localStorage.setItem(STORE, JSON.stringify(pos)); else localStorage.removeItem(STORE); } catch { /* private window */ } };
  el.classList.add('card');
  const hint = layer.querySelector(':scope > .dock-hint') || layer.appendChild(Object.assign(document.createElement('div'), { className: 'dock-hint' }));
  const clamp = () => {
    const pw = layer.clientWidth, ph = layer.clientHeight;
    if (!pw || !ph) return;
    pos.w = Math.min(Math.max(resize.minW, pos.w || 280), Math.min(resize.maxW, Math.max(resize.minW, pw - 8)));
    pos.left = Math.min(Math.max(0, pos.left), Math.max(0, pw - pos.w));
    pos.top = Math.min(Math.max(0, pos.top), Math.max(0, ph - Math.min(Math.max(el.scrollHeight, el.offsetHeight, 48), pos.h || Infinity, ph) - 14)); // keep it all on screen
  };
  const plain = () => { el.style.left = el.style.top = el.style.width = el.style.maxHeight = el.style.zIndex = el.style.height = ''; };
  const apply = () => {
    const col = pos?.side && edges?.[pos.side];
    if (pos?.side && !col) pos = null; // that column isn't here
    el.classList.toggle('docked', !!col);
    if (col) {
      el.classList.remove('card-free'); plain();
      el.dataset.dockOrder = String(pos.order ?? 0);
      // in order among the column's cards
      const after = [...col.children].find((c) => c !== el && +(c.dataset.dockOrder ?? 0) > (pos.order ?? 0));
      if (el.parentElement !== col || (after && el.nextElementSibling !== after)) col.insertBefore(el, after || null);
      return;
    }
    if (!pos) {
      el.classList.remove('card-free'); plain();
      if (el.parentElement !== dock.el) dock.put(el);
      return;
    }
    if (el.parentElement !== layer) layer.insertBefore(el, hint);
    el.classList.add('card-free');
    clamp();
    el.style.left = pos.left + 'px'; el.style.top = pos.top + 'px'; el.style.width = pos.w + 'px';
    const room = `calc(100% - ${pos.top + 14}px)`;
    el.style.maxHeight = pos.h ? `min(${Math.max(resize.minH, pos.h)}px, ${room})` : room;
    if (pos.h) el.style.height = `min(${Math.max(resize.minH, pos.h)}px, ${room})`;
  };
  apply();
  if (window.ResizeObserver) new ResizeObserver(() => { if (pos && !pos.side) apply(); }).observe(layer);
  const here = () => {
    const lr = layer.getBoundingClientRect(), er = el.getBoundingClientRect();
    return { left: er.left - lr.left, top: er.top - lr.top, w: er.width, h: pos?.h };
  };
  /** The column (if any) a drop at this pointer would dock into: near a canvas edge, or over a docked column. */
  const zone = (ev) => {
    if (!edges) return null;
    const r = layer.getBoundingClientRect();
    const inY = ev.clientY > r.top && ev.clientY < r.bottom;
    let side = inY && ev.clientX < r.left + EDGE ? 'left' : inY && ev.clientX > r.right - EDGE ? 'right' : null;
    for (const s of ['left', 'right']) {
      const c = edges[s]?.getBoundingClientRect();
      if (c?.width && ev.clientX >= c.left && ev.clientX <= c.right && ev.clientY >= c.top && ev.clientY <= c.bottom) side = s;
    }
    return side;
  };
  const showHint = (side) => { hint.className = side ? `dock-hint on ${side}` : 'dock-hint'; };
  /** Follow the pointer on the window until it is let go. */
  const follow = (e, onMove, onUp) => {
    e.preventDefault();
    const move = (ev) => onMove(ev);
    const up = (ev) => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
      el.classList.remove('dragging');
      onUp(ev);
      save();
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  };
  el.addEventListener('pointerdown', (e) => {
    if (pos && !pos.side) el.style.zIndex = String(++topZ); // the card you touch comes to the front
    if (e.button !== 0) return;
    const r = el.getBoundingClientRect();
    if (pos && !pos.side && e.clientX > r.right - GRIP && e.clientY > r.bottom - GRIP) {
      const start = here(), sx = e.clientX, sy = e.clientY, h0 = r.height;
      el.classList.add('dragging');
      follow(e, (ev) => { pos.w = start.w + ev.clientX - sx; pos.h = h0 + ev.clientY - sy; apply(); }, () => {});
      return;
    }
    if (!pos && e.clientX > r.right - GRIP && e.clientY > r.bottom - GRIP) {
      // resizing a card in its home column floats it where it is
      const start = here(), sx = e.clientX, sy = e.clientY, h0 = r.height;
      pos = { ...start }; apply();
      el.classList.add('dragging');
      follow(e, (ev) => { pos.w = start.w + ev.clientX - sx; pos.h = h0 + ev.clientY - sy; apply(); }, () => {});
      return;
    }
    const head = e.target.closest && e.target.closest(handle);
    if (!head || !el.contains(head) || e.target.closest('button, input, select, textarea, a')) return;
    const sx = e.clientX, sy = e.clientY, er = el.getBoundingClientRect();
    const dx = e.clientX - er.left, dy = e.clientY - er.top;
    let started = false, start = null;
    follow(e, (ev) => {
      if (!started) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < START) return;
        started = true;
        el.classList.add('dragging');
        start = here();
        if (pos?.side) start.w = Math.min(start.w, 320); // out of a column at a card's width
        pos = { ...start, h: pos?.side ? undefined : pos?.h };
        apply();
        el.style.zIndex = String(++topZ);
      }
      const lr = layer.getBoundingClientRect();
      pos = { ...pos, left: ev.clientX - lr.left - Math.min(dx, el.offsetWidth - 20), top: ev.clientY - lr.top - dy };
      apply();
      showHint(zone(ev));
    }, (ev) => {
      showHint(null);
      if (!started) return;
      const side = ev.type === 'pointerup' ? zone(ev) : null;
      if (side) {
        // its place in the column: above the first docked card whose middle is below the pointer
        const others = [...edges[side].children].filter((c) => c !== el && c.classList.contains('docked'));
        others.forEach((c, i) => { c.dataset.dockOrder = String(i * 2); c.dispatchEvent(new CustomEvent('dock-order', { detail: i * 2 })); });
        const below = others.find((c) => { const cr = c.getBoundingClientRect(); return ev.clientY < cr.top + cr.height / 2; });
        pos = { side, order: below ? +below.dataset.dockOrder - 1 : others.length * 2 };
        apply();
      }
    });
  });
  // other cards renumbered when one docks among them
  el.addEventListener('dock-order', (e) => { if (pos?.side) { pos.order = e.detail; save(); } });
  el.addEventListener('dblclick', (e) => {
    const head = e.target.closest && e.target.closest(handle);
    if (!head || !el.contains(head) || e.target.closest('button, input, select, textarea, a')) return;
    pos = null; apply(); save();
  });
  return {
    get docked() { return !pos; },
    get side() { return pos?.side || null; },
    dock: () => { pos = null; apply(); save(); },
    dockSide: (side) => { pos = { side, order: edges?.[side] ? edges[side].children.length * 2 + 1 : 0 }; apply(); save(); },
  };
}
