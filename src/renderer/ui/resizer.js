// Drag handles for resizing a column beside the canvas. Ported from DabbleCAD (see NOTICE): the
// handle sits on the column's inner edge; the width is remembered in this browser; double-click
// the handle to go back to the default width.
const KEY = (k) => 'electrocad.panel.' + k;

/**
 * panel: the element to resize. side: 'left' (panel on the left, handle on its right edge) or
 * 'right' (panel on the right, handle on its left edge). key: remembered under this name.
 */
export function addResizer(panel, { side, key, min = 160, max = 640 }) {
  const handle = document.createElement('div');
  handle.className = 'splitter splitter-' + side;
  handle.setAttribute('role', 'separator');
  handle.setAttribute('aria-orientation', 'vertical');
  handle.title = 'Drag to resize. Double-click to reset.';
  if (side === 'left') panel.after(handle); else panel.before(handle);
  const clamp = (w) => Math.round(Math.min(max, Math.max(min, w)));
  const apply = (w) => { panel.style.width = w + 'px'; };
  try { const saved = parseFloat(localStorage.getItem(KEY(key))); if (saved > 0) apply(clamp(saved)); } catch { /* storage may be unavailable */ }
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX, startW = panel.getBoundingClientRect().width;
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('dragging');
    document.body.classList.add('resizing');
    const move = (ev) => apply(clamp(startW + (side === 'left' ? ev.clientX - startX : startX - ev.clientX)));
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      handle.classList.remove('dragging');
      document.body.classList.remove('resizing');
      try { localStorage.setItem(KEY(key), String(Math.round(panel.getBoundingClientRect().width))); } catch { /* ignore */ }
      window.dispatchEvent(new Event('resize'));
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  });
  handle.addEventListener('dblclick', () => {
    panel.style.width = '';
    try { localStorage.removeItem(KEY(key)); } catch { /* ignore */ }
    window.dispatchEvent(new Event('resize'));
  });
  return handle;
}
