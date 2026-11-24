// Floating cards over the canvas: move them by their header and resize them from the corner grip.
// Ported from DabbleCAD's makeDraggable (see NOTICE) and extended with resizing. The position and
// size are remembered in this browser and always kept inside the view the card floats over.
// Double-clicking the header's empty space puts the card back in its default place and size.
export function makeDraggable(el, { key, handle = '.insp-head', resize = null }) {
  const STORE = 'electrocad.card.' + key;
  let pos = null; // { left, top, w, h } in px; null = default place (CSS)
  try { pos = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch { pos = null; }
  const save = () => { try { if (pos) localStorage.setItem(STORE, JSON.stringify(pos)); else localStorage.removeItem(STORE); } catch { /* private window */ } };
  const parentOf = () => el.offsetParent || el.parentElement;
  const clamp = () => {
    const parent = parentOf();
    if (!pos || !parent) return;
    const pw = parent.clientWidth, ph = parent.clientHeight;
    if (resize && pos.w) pos.w = Math.min(Math.max(resize.minW, pos.w), Math.min(resize.maxW, pw - 8));
    const w = pos.w || el.offsetWidth || 280;
    pos.left = Math.min(Math.max(0, pos.left), Math.max(0, pw - w));
    pos.top = Math.min(Math.max(0, pos.top), Math.max(0, ph - 48));
  };
  const apply = () => {
    if (!pos) { el.style.left = el.style.top = el.style.right = el.style.width = el.style.maxHeight = ''; return; }
    clamp();
    el.style.left = pos.left + 'px'; el.style.top = pos.top + 'px'; el.style.right = 'auto';
    if (pos.w) el.style.width = pos.w + 'px';
    const room = `calc(100% - ${pos.top + 14}px)`;
    el.style.maxHeight = pos.h ? `min(${Math.max(resize?.minH || 120, pos.h)}px, ${room})` : room;
  };
  apply();
  if (window.ResizeObserver && el.parentElement) new ResizeObserver(() => apply()).observe(el.parentElement);
  // the current place in px, so a card in its default (right-anchored) place can be moved or sized
  const here = () => {
    const pr = parentOf().getBoundingClientRect(), er = el.getBoundingClientRect();
    return { left: er.left - pr.left, top: er.top - pr.top, w: pos?.w, h: pos?.h };
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
    if (e.button !== 0) return;
    if (resize && e.target.closest('.card-grip')) {
      const start = here(), sx = e.clientX, sy = e.clientY, w0 = el.offsetWidth, h0 = el.offsetHeight;
      pos = { ...start };
      track(e, (ev) => { pos.w = w0 + ev.clientX - sx; pos.h = h0 + ev.clientY - sy; });
      return;
    }
    const head = e.target.closest && e.target.closest(handle);
    if (!head || !el.contains(head) || e.target.closest('button, input, select, textarea, a')) return;
    const start = here(), sx = e.clientX, sy = e.clientY;
    track(e, (ev) => { pos = { ...start, left: start.left + ev.clientX - sx, top: start.top + ev.clientY - sy }; });
  });
  el.addEventListener('dblclick', (e) => {
    const head = e.target.closest && e.target.closest(handle);
    if (!head || e.target.closest('button, input, select, textarea, a, .insp-title')) return;
    pos = null; apply(); save();
  });
  return { reset: () => { pos = null; apply(); save(); } };
}
