// Tiny DOM helpers shared by the UI modules.
// Ported from DabbleCAD (jonsole/DabbleCAD, Apache-2.0); see NOTICE. ElectroCAD icons are appended to P.

export function h(tag, props, ...children) {
  const el = tag === 'svg' || tag === 'path' ? document.createElementNS('http://www.w3.org/2000/svg', tag) : document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null) continue;
      if (v === false) {
        // boolean DOM properties default to true in some cases (spellcheck, draggable): set them explicitly
        if (tag !== 'svg' && tag !== 'path' && k in el && typeof el[k] === 'boolean') el[k] = false;
        continue;
      }
      if (k === 'class') el.setAttribute('class', v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k in el && tag !== 'svg' && tag !== 'path') { try { el[k] = v; } catch { el.setAttribute(k, v); } }
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

// Stroke icons (24x24). Kept inline so the app has no external assets.
const P = {
  home: 'M3 11.5 12 4l9 7.5M5.5 10v9.5h4.5v-6h4v6h4.5V10',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5M9 9h6v6H9z',
  plus: 'M12 5v14M5 12h14',
  parts: 'M4 4h7v7H4zM15.5 4a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zM7.5 13l4 7h-8zM14 14h6v6h-6z',
  grid: 'M4 4h16v16H4zM4 9.33h16M4 14.67h16M9.33 4v16M14.67 4v16',
  viewIcons: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  viewSmall: 'M4 5h4v4H4zM10 7h4M4 15h4v4H4zM10 17h4M15 5h1M15 15h1',
  viewList: 'M4 6h2M9 6h11M4 12h2M9 12h11M4 18h2M9 18h11',
  viewDetails: 'M3 5h18v14H3zM3 9h18M9 9v10M15 9v10',
  up: 'M6 15l6-6 6 6',
  down: 'M6 9l6 6 6-6',
  minus: 'M5 12h14',
  ortho: 'M4 7.5 12 4l8 3.5v9L12 20l-8-3.5zM4 7.5l8 3.5 8-3.5M12 11v9',
  persp: 'M3 6.5 12 4l9 2.5v11L12 20l-9-2.5zM12 4v16M3 6.5l9 3 9-3',
  copy: 'M9 9h10v11H9zM5 15V4h10',
  paste: 'M8 5H6v15h12V5h-2M9 3.5h6V7H9zM9 11h6M9 15h6',
  duplicate: 'M4 4h11v11H4zM9 9h11v11H9z',
  trash: 'M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13M10 11v6M14 11v6',
  undo: 'M9 7 4 12l5 5M4 12h10a5 5 0 0 1 0 10h-2',
  redo: 'M15 7l5 5-5 5M20 12H10a5 5 0 0 0 0 10h2',
  group: 'M4 4h9v9H4zM11 11h9v9h-9z',
  ungroup: 'M3 3h8v8H3zM13 13h8v8h-8zM13 6h3M6 13v3',
  intersect: 'M4 4h11v11H4zM9 9h11v11H9zM9 9h6v6H9z',
  bundle: 'M4 8l8-4 8 4-8 4zM4 8v8l8 4 8-4V8M12 12v8',
  align: 'M4 3v18M8 6h10v4H8zM8 14h6v4H8z',
  mirror: 'M12 3v18M9 7 4 12l5 5zM15 7l5 5-5 5z',
  axes: 'M5 19V6M5 19h13M5 19l8-8M2.500 8.500 5 5l2.500 3.500M15.500 16.500 19 19l-3.500 2.500M9.500 10.500H13.500V14.500',
  split: 'M3 8.5h6.5v9H3zM14.5 6.5H21v9h-6.5zM12 2v3M12 8v3M12 14v3M12 20v2',
  cruise: 'M6 4v7a6 6 0 0 0 12 0V4h-4v7a2 2 0 0 1-4 0V4zM6 7h4M14 7h4',
  workplane: 'M3 15l9-4 9 4-9 4zM12 4v7M9 7l3-3 3 3',
  ruler: 'M4 16 16 4l4 4L8 20zM8.5 13.5l1.5 1.5M11 11l1.5 1.5M13.5 8.5 15 10',
  edges: 'M4 20V12a8 8 0 0 1 8-8h8M4 20h4M20 4v4',
  horizontal: 'M4 12h16M4 8.5v7M20 8.5v7',
  vertical: 'M12 4v16M8.5 4h7M8.5 20h7',
  parallel: 'M6 19 13 5M11 19l7-14',
  perpendicular: 'M5 19h14M12 19V5M12 15h4v4',
  pointline: 'M4 19 20 5M12 9.5a2.500 2.500 0 1 0 0 5 2.500 2.500 0 0 0 0-5z',
  note: 'M5 4h14v12H10l-5 4z M8 8h8M8 12h5',
  bulb: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.3 1 2.1h5c0-.8.4-1.6 1-2.1A6 6 0 0 0 12 3z',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  eyeOff: 'M3 3l18 18M10.6 5.1A10.6 10.6 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3 3.8M6.5 6.6C3.7 8.4 2 12 2 12s3.6 7 10 7c1.6 0 3-.4 4.300-1',
  lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  unlock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 6.7-1.5',
  settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19.4 13a7.6 7.6 0 0 0 0-2l2-1.5-2-3.5-2.4 1a7.6 7.6 0 0 0-1.700-1L15 3.500h-4l-.3 2.500a7.600 7.600 0 0 0-1.700 1l-2.400-1-2 3.500L6.600 11a7.600 7.600 0 0 0 0 2l-2 1.500 2 3.500 2.400-1c.5.4 1.100.700 1.700 1l.300 2.500h4l.300-2.500c.6-.3 1.200-.6 1.700-1l2.400 1 2-3.500z',
  import: 'M12 3v12M7 10l5 5 5-5M4 19h16',
  export: 'M12 15V3M7 8l5-5 5 5M4 19h16',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  orient: 'M3 20.5h18M5.5 8.5l6 2.2-2.2 6-6-2.2zM13.5 5.5a7 7 0 0 1 5.5 7.5M16.6 11.8 19 14.4l2.4-2.6',
  drop: 'M12 3v12M7 10l5 5 5-5M4 20h16',
  chevron: 'M6 9l6 6 6-6',
  chevronRight: 'M9 6l6 6-6 6',
  close: 'M6 6l12 12M18 6 6 18',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM16 16l4.500 4.500',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  camera: 'M4 8h4l1.500-2.500h5L16 8h4v11H4zM12 11a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.900 4.900l1.400 1.400M17.700 17.700l1.400 1.400M2 12h2M20 12h2M4.900 19.100l1.400-1.400M17.700 6.300l1.400-1.400',
  moon: 'M20 14.500A8 8 0 1 1 9.500 4a6.500 6.500 0 0 0 10.500 10.500z',
  pattern: 'M4 4h5v5H4zM15 4h5v5h-5zM4 15h5v5H4zM15 15h5v5h-5zM9 6.500h6M6.500 9v6M17.500 9v6M9 17.500h6',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v6M12 7.500v.500',
  cube: 'M12 3l8 4.500v9L12 21l-8-4.500v-9zM12 12l8-4.500M12 12v9M12 12 4 7.500',
  blocks: 'M3 13h6v6H3zM9 13h6v6H9zM15 13h6v6h-6zM6 7h6v6H6zM12 7h6v6h-6z',
  bricks: 'M3 9h18v10H3zM6 9V6h4v3M14 9V6h4v3',
  star: 'M12 3.500l2.600 5.400 5.900.800-4.300 4.100 1 5.900L12 16.900l-5.200 2.800 1-5.900-4.300-4.100 5.900-.800z',
  help: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9.500 9.500a2.500 2.500 0 1 1 3.500 2.300c-.6.300-1 .900-1 1.700M12 16.500v.500',
  folder: 'M3 6h6l2 2.500h10V19H3z',
  pencil: 'M4 20l1-4L16 5l3 3L8 19zM14 7l3 3',
  check: 'M5 12.500l4.500 4.500L19 7.500',
  rotate: 'M5 12a7 7 0 0 1 12-5l2 2M19 5v4h-4M19 12a7 7 0 0 1-12 5l-2-2M5 19v-4h4',
  select: 'M5 3l13 9-6 1.500L9.500 19z',
  stats: 'M4 20V10M10 20V4M16 20v-8M21 20H3',
  cut: 'M6 6a2.500 2.500 0 1 0 0 5 2.500 2.500 0 0 0 0-5zM6 13a2.500 2.500 0 1 0 0 5 2.500 2.500 0 0 0 0-5zM8 9.500 20 18M8 14.500 20 6',
  flip: 'M12 3v18M7 8l-3 4 3 4M17 8l3 4-3 4',
  lrect: 'M4 6h16v12H4z',
  lellipse: 'M12 5.500c5 0 9 2.900 9 6.500s-4 6.500-9 6.500-9-2.900-9-6.500 4-6.500 9-6.500z',
  lpolygon: 'M12 3l8.500 6.200-3.200 10H6.700L3.500 9.200z',
  lline: 'M4 19 9.500 7l5 8L20 5',
  ltext: 'M5 7V4.500h14V7M12 4.500v15M9 19.500h6',
  lnode: 'M5 17c3-11 11-11 14 0M3 15h4v4H3zM17 15h4v4h-4zM10 6.500h4v4h-4z',
  target: 'M12 3v5M12 16v5M3 12h5M16 12h5M12 9.500a2.500 2.500 0 1 0 0 5 2.500 2.500 0 0 0 0-5z',
  play: 'M7 4.500l12 7.500-12 7.500z',
  pause: 'M7 5h3.500v14H7zM13.500 5H17v14h-3.500z',
  stop: 'M6 6h12v12H6z',
  frame: 'M4 4h16v16H4zM4 9h2M4 15h2M18 9h2M18 15h2M9 4v2M15 4v2M9 18v2M15 18v2',
  laser: 'M12 2.500v7M9 9.500h6l-1 4h-4zM12 13.500v3.500M6.500 21l3-3M17.500 21l-3-3M12 22v-2M4 17h3M17 17h3',
  plug: 'M9 3v5M15 3v5M6.500 8h11v4a5.500 5.500 0 0 1-11 0zM12 17.500V21',
  arrowUp: 'M12 19V5M6 11l6-6 6 6',
  arrowDown: 'M12 5v14M6 13l6 6 6-6',
  arrowLeft: 'M19 12H5M11 6l-6 6 6 6',
  arrowRight: 'M5 12h14M13 6l6 6-6 6',
  cloud: 'M7 18.500a4.500 4.500 0 0 1-.6-8.960A6 6 0 0 1 18 9a4.750 4.750 0 0 1-.5 9.500z',
  cloudOff: 'M7 18.500a4.500 4.500 0 0 1-.6-8.960A6 6 0 0 1 18 9a4.750 4.750 0 0 1-.5 9.500zM4 4l16 16',
  cloudCheck: 'M7 18.500a4.500 4.500 0 0 1-.6-8.960A6 6 0 0 1 18 9a4.750 4.750 0 0 1-.5 9.500zM9.500 13.500l2 2 3.500-3.500',
  // ---- ElectroCAD icons (same 24x24 stroke style) ----
  schematic: 'M2 12h4l1.500-3 3 6 3-6 3 6 1.500-3h4',
  board: 'M6 6h12v12H6zM9 2.500V6M15 2.500V6M9 18v3.500M15 18v3.500M2.500 9H6M2.500 15H6M18 9h3.500M18 15h3.500',
  gerber: 'M12 3l9 4.500-9 4.500-9-4.500zM3 12l9 4.500 9-4.500M3 16.500 12 21l9-4.500',
  library: 'M5 4.500A1.500 1.500 0 0 1 6.500 3H19v15H6.500A1.500 1.500 0 0 0 5 19.500zM5 19.500A1.500 1.500 0 0 0 6.500 21H19v-3M9 7h6',
  wire: 'M3 18h8V6h10M3 18h.01M21 6h.01',
  netLabel: 'M3 12l4-5h13v10H7zM10 12h6',
  globalLabel: 'M3 12l4-5h10l4 5-4 5H7zM9 12h6',
  power: 'M12 21V9M6 9h12M9 5.500 12 3l3 2.500',
  ground: 'M12 3v9M5 12h14M8 15.500h8M10.500 19h3',
  noConnect: 'M3 12h7M10 8l8 8M18 8l-8 8',
  route: 'M3 20v-5l7-7h11M17 4l4 4-4 4',
  via: 'M12 6.500a5.500 5.500 0 1 0 0 11 5.500 5.500 0 0 0 0-11zM12 10.500a1.500 1.500 0 1 0 0 3 1.500 1.500 0 0 0 0-3z',
  zone: 'M4 7l7-3 9 3-1.500 13H5.500zM7 15l6-6M9 19l9-9M5.500 11 9 7.500',
  outline: 'M8 4h8a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V8a4 4 0 0 1 4-4z',
  dragTrack: 'M3 17h6l5-10h7M18 4l3 3-3 3',
  pad: 'M6 6h12v12H6zM12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
  pin: 'M3 12h11M17 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
  arc: 'M4 19a15 15 0 0 1 15-15',
  wand: 'M4 20 15 9M15 3.500v3M18.500 9h3M18 6l2-2M12 6 10 4',
  netlist: 'M4 6h5M4 12h5M4 18h5M9 6l6 6-6 6M15 12h5',
  erc: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8 12.500l3 3 5-6',
  annotate: 'M3 6h9M3 10h6M3 18h14M15 15l3 3-3 3',
  print: 'M6 9V3h12v6M6 18H4v-8h16v8h-2M6 14h12v7H6z',
  sheets: 'M8 3h11v14H8zM5 6v15h11',
  undo2: 'M9 7 4 12l5 5M4 12h10a5 5 0 0 1 0 10h-2',
  zip: 'M6 3h9l4 4v14H6zM11 3v2M11 7v2M11 11v2M10 15h2v3h-2z',
  twoD: 'M4 5h16v14H4zM8 9h3v2H8v4h3M14 9h2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-2z',
};

// Mode icons: a cube with the part each mode works on picked out.
const CUBE = 'M12 3l8 4.500v9L12 21l-8-4.500v-9zM4 7.500l8 4.500 8-4.500M12 12v9';
const MULTI = {
  modeObject: [{ d: 'M12 3l8 4.500v9L12 21l-8-4.500v-9z', fill: 'currentColor', o: 0.22 }, { d: CUBE }],
  modeFace: [{ d: CUBE, o: 0.55 }, { d: 'M12 3l8 4.500-8 4.500-8-4.500z', fill: 'currentColor', o: 0.85 }],
  modeEdge: [{ d: CUBE, o: 0.55 }, { d: 'M12 12v9', w: 3.4 }],
  modeCorner: [{ d: CUBE, o: 0.55 }, { d: 'M12 9.300a2.700 2.700 0 1 0 0 5.400 2.700 2.700 0 1 0 0-5.400z', fill: 'currentColor' }],
};

export function icon(name, size = 20) {
  const svg = h('svg', { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', class: 'icon' });
  if (MULTI[name]) {
    for (const part of MULTI[name]) {
      const a = { d: part.d };
      if (part.fill) a.fill = part.fill;
      if (part.o != null) a.opacity = part.o;
      if (part.w) a['stroke-width'] = part.w;
      svg.append(h('path', a));
    }
    return svg;
  }
  svg.append(h('path', { d: P[name] || P.cube }));
  return svg;
}

export function button(opts) {
  const { icon: ic, label, title, onClick, cls = '', size } = opts;
  const b = h('button', { class: 'btn ' + cls, title: title || label || '', type: 'button' });
  // icon-only buttons need a spoken name; the tooltip text doubles as it
  if (!label && title) b.setAttribute('aria-label', title);
  if (ic) b.append(icon(ic, size));
  if (label) b.append(h('span', { class: 'btn-label' }, label));
  // keep focus on the button for keyboard users (detail is 0 for Enter / Space), drop it after a mouse click
  if (onClick) b.addEventListener('click', (e) => { onClick(e); if (e.detail) b.blur(); });
  return b;
}

let toastHost = null;
export function toast(message, kind = 'info', ms = 2600) {
  if (!toastHost) {
    toastHost = h('div', { class: 'toast-host', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastHost);
  }
  const t = h('div', { class: 'toast toast-' + kind }, message);
  toastHost.append(t);
  setTimeout(() => t.classList.add('toast-out'), ms);
  setTimeout(() => t.remove(), ms + 350);
}

/** Modal dialog. Returns { el, body, close }. */
export function modal({ title, width = 520, onClose, cls = '' }) {
  const body = h('div', { class: 'modal-body' });
  const opener = document.activeElement;
  const focusable = () => [...el.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((n) => !n.disabled && n.offsetParent !== null);
  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey, true);
    if (onClose) onClose();
    if (opener && opener.focus && document.body.contains(opener)) opener.focus();
  };
  const onKey = (e) => {
    const top = () => { const all = document.querySelectorAll('.modal-backdrop'); return all[all.length - 1] === backdrop; };
    if (e.key === 'Tab' && top()) {
      // keep keyboard focus inside the dialog
      const list = focusable();
      if (!list.length) return;
      const first = list[0], lastEl = list[list.length - 1];
      if (!el.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); lastEl.focus(); }
      else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); first.focus(); }
      return;
    }
    if (e.key !== 'Escape') return;
    // only the top-most dialog closes, and an open popup menu gets the Escape first
    const all = document.querySelectorAll('.modal-backdrop');
    if (all[all.length - 1] !== backdrop || document.querySelector('.menu')) return;
    e.stopPropagation();
    close();
  };
  const el = h('div', { class: 'modal ' + cls, style: { width: width + 'px' }, role: 'dialog', 'aria-modal': 'true', 'aria-label': title, tabindex: '-1' },
    h('div', { class: 'modal-head' }, h('div', { class: 'modal-title' }, title), button({ icon: 'close', title: 'Close', cls: 'btn-ghost', onClick: close })),
    body);
  const backdrop = h('div', { class: 'modal-backdrop', onMousedown: (e) => { if (e.target === backdrop) close(); } }, el);
  document.body.append(backdrop);
  document.addEventListener('keydown', onKey, true);
  // move focus into the dialog once its content exists (callers fill the body right after this returns)
  setTimeout(() => { if (document.body.contains(el) && !el.contains(document.activeElement)) { const target = body.querySelector('input:not([type="checkbox"]):not([type="range"]), textarea, select') || el; try { target.focus({ preventScroll: true }); } catch { /* not focusable */ } } }, 0);
  return { el, body, close };
}

export function confirmDialog(title, message, okLabel = 'OK', danger = false) {
  return new Promise((resolve) => {
    let done = false;
    const m = modal({ title, width: 420, onClose: () => { if (!done) resolve(false); } });
    m.body.append(
      h('p', { class: 'modal-text' }, message),
      h('div', { class: 'modal-actions' },
        button({ label: 'Cancel', cls: 'btn-outline', onClick: () => m.close() }),
        button({ label: okLabel, cls: danger ? 'btn-danger' : 'btn-primary', onClick: () => { done = true; resolve(true); m.close(); } })));
  });
}

export function promptDialog(title, label, value = '') {
  return new Promise((resolve) => {
    let done = false;
    const m = modal({ title, width: 420, onClose: () => { if (!done) resolve(null); } });
    const input = h('input', { class: 'input', value, type: 'text' });
    const ok = () => { done = true; resolve(input.value); m.close(); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
    m.body.append(h('label', { class: 'field' }, h('span', {}, label), input),
      h('div', { class: 'modal-actions' }, button({ label: 'Cancel', cls: 'btn-outline', onClick: () => m.close() }), button({ label: 'OK', cls: 'btn-primary', onClick: ok })));
    setTimeout(() => { input.focus(); input.select(); }, 30);
  });
}

/** Floating menu anchored at a point or element. items: [{label, icon, shortcut, onClick, disabled, checked} | 'sep'] */
export function popupMenu(items, at) {
  document.querySelectorAll('.menu').forEach((m) => m.remove());
  const menu = h('div', { class: 'menu', role: 'menu' });
  const opener = document.activeElement;
  for (const it of items) {
    if (!it) continue;
    if (it === 'sep') { menu.append(h('div', { class: 'menu-sep' })); continue; }
    const row = h('button', { class: 'menu-item' + (it.disabled ? ' disabled' : ''), type: 'button', role: 'menuitem', 'aria-disabled': it.disabled ? 'true' : 'false' },
      h('span', { class: 'menu-icon' }, it.checked ? icon('check', 16) : it.icon ? icon(it.icon, 16) : null),
      h('span', { class: 'menu-label' }, it.label),
      it.shortcut ? h('span', { class: 'menu-shortcut' }, it.shortcut) : null);
    if (!it.disabled) row.addEventListener('click', () => { close(); it.onClick(); });
    menu.append(row);
  }
  document.body.append(menu);
  let x, y;
  if (at instanceof Element) {
    const r = at.getBoundingClientRect();
    x = r.left; y = r.bottom + 4;
  } else { x = at.x; y = at.y; }
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  menu.style.left = Math.max(6, Math.min(x, window.innerWidth - mw - 6)) + 'px';
  menu.style.top = Math.max(6, Math.min(y, window.innerHeight - mh - 6)) + 'px';
  const close = () => {
    menu.remove();
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', esc, true);
  };
  const outside = (e) => { if (!menu.contains(e.target)) close(); };
  const esc = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); if (opener && opener.focus && document.body.contains(opener)) opener.focus(); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    const rows = [...menu.querySelectorAll('.menu-item:not(.disabled)')];
    if (!rows.length) return;
    e.preventDefault(); e.stopPropagation();
    const i = rows.indexOf(document.activeElement);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? rows.length - 1 : e.key === 'ArrowDown' ? (i + 1) % rows.length : (i - 1 + rows.length) % rows.length;
    rows[next].focus();
  };
  // a menu opened from the keyboard starts with its first item focused
  if (opener && opener.matches && opener.matches(':focus-visible')) { const first = menu.querySelector('.menu-item:not(.disabled)'); if (first) first.focus(); }
  setTimeout(() => {
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', esc, true);
  }, 0);
  return close;
}
