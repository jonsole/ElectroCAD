// Floating cards over the canvas: move one by its header and resize it from its bottom-right
// corner. Ported from DabbleCAD's makeDraggable (see NOTICE) and extended: cards start docked in a
// column (the `dock` element) and float on their own once moved or resized; double-clicking a
// header's empty space docks the card again. Place and size are remembered in this browser and
// kept inside the view (`layer`). The corner grip is drawn with CSS (::after), so cards that
// re-render their contents keep it.
const GRIP = 16; // px: the corner that resizes
let topZ = 12;

export function makeDraggable(el, { key, layer, dock, handle = '.insp-head, .fp-head', resize = { minW: 250, maxW: 520, minH: 140 } }) {
  const STORE = 'electrocad.card.' + key;
  let pos = null; // { left, top, w, h } in px within `layer`; null = docked
  try { pos = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch { pos = null; }
  const save = () => { try { if (pos) localStorage.setItem(STORE, JSON.stringify(pos)); else localStorage.removeItem(STORE); } catch { /* private window */ } };
  el.classList.add('card');
  const clamp = () => {
    const pw = layer.clientWidth, ph = layer.clientHeight;
    if (!pw || !ph) return;
    pos.w = Math.min(Math.max(resize.minW, pos.w || 280), Math.min(resize.maxW, Math.max(resize.minW, pw - 8)));
    pos.left = Math.min(Math.max(0, pos.left), Math.max(0, pw - pos.w));
    pos.top = Math.min(Math.max(0, pos.top), Math.max(0, ph - Math.min(Math.max(el.scrollHeight, el.offsetHeight, 48), pos.h || Infinity, ph) - 14)); // keep it all on screen
  };
  const apply = () => {
    if (!pos) {
      el.classList.remove('card-free');
      el.style.left = el.style.top = el.style.width = el.style.maxHeight = el.style.zIndex = '';
      if (el.parentElement !== dock.el) dock.put(el);
      return;
    }
    if (el.parentElement !== layer) layer.append(el);
    el.classList.add('card-free');
    clamp();
    el.style.left = pos.left + 'px'; el.style.top = pos.top + 'px'; el.style.width = pos.w + 'px';
    const room = `calc(100% - ${pos.top + 14}px)`;
    el.style.maxHeight = pos.h ? `min(${Math.max(resize.minH, pos.h)}px, ${room})` : room;
  };
  apply();
  if (window.ResizeObserver) new ResizeObserver(() => { if (pos) apply(); }).observe(layer);
  const here = () => {
    const lr = layer.getBoundingClientRect(), er = el.getBoundingClientRect();
    return { left: er.left - lr.left, top: er.top - lr.top, w: er.width, h: pos?.h };
  };
  const track = (e, onMove) => {
    e.preventDefault();
    try { el.setPointerCapture(e.pointerId); } catch { /* not an active pointer */ }
    el.classList.add('dragging');
    const move = (ev) => { onMove(ev); apply(); };
    const up = () => {
      el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
      el.classList.remove('dragging');
      save();
    };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  };
  el.addEventListener('pointerdown', (e) => {
    if (pos) el.style.zIndex = String(++topZ); // the card you touch comes to the front
    if (e.button !== 0) return;
    const r = el.getBoundingClientRect();
    if (e.clientX > r.right - GRIP && e.clientY > r.bottom - GRIP) {
      const start = here(), sx = e.clientX, sy = e.clientY, h0 = r.height;
      pos = { ...start }; apply();
      track(e, (ev) => { pos.w = start.w + ev.clientX - sx; pos.h = h0 + ev.clientY - sy; });
      return;
    }
    const head = e.target.closest && e.target.closest(handle);
    if (!head || !el.contains(head) || e.target.closest('button, input, select, textarea, a')) return;
    // come out of the dock first: moving the element later would drop the pointer capture
    const start = here(), sx = e.clientX, sy = e.clientY;
    pos = { ...start }; apply();
    track(e, (ev) => { pos = { ...start, left: start.left + ev.clientX - sx, top: start.top + ev.clientY - sy }; });
  });
  el.addEventListener('dblclick', (e) => {
    const head = e.target.closest && e.target.closest(handle);
    if (!head || !el.contains(head) || e.target.closest('button, input, select, textarea, a')) return;
    pos = null; apply(); save();
  });
  return { get docked() { return !pos; }, dock: () => { pos = null; apply(); save(); } };
}
