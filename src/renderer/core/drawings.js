// Schematic markup (#59): text notes, lines (with arrows), rectangles, circles and arcs drawn on a
// Sheet. They never connect like Wires. Also the Sheet's paper size, the title block and text
// variables. DOM-free; text widths come from a `measure(text, sizeNm)` function.
//
// A drawing is one of (all lengths nm, +Y down; `style` is 'solid' | 'dashed' | 'dotted'):
//   { id, type: 'text',   at, text, size, bold, italic, align: 'left'|'center'|'right', rot: 0|90 }
//   { id, type: 'line',   pts: [[x, y]…], style, arrowStart, arrowEnd }
//   { id, type: 'rect',   a, b, style, fill: 'none'|'tint' }
//   { id, type: 'circle', c, r, style, fill }
//   { id, type: 'arc',    start, mid, end, style }
// For text, `at` is the start (left), middle (centre) or end (right) of the first line's middle.
import { mm, SCH_GRID } from './units.js';
import { rot90, arcCircle } from './geom.js';

export const LINE_STYLES = ['solid', 'dashed', 'dotted'];
export const TEXT_SIZE = mm(1.27);

// ---------------------------------------------------------------- paper and title block

/** Paper sizes in mm, landscape (width, height). */
export const PAPER_SIZES = {
  A4: [297, 210], A3: [420, 297], A2: [594, 420],
  Letter: [279.4, 215.9], Tabloid: [431.8, 279.4],
};
export const DEFAULT_PAPER = { size: 'A4', orientation: 'landscape' };

/** The Sheet's paper as a rectangle in nm, origin top left. */
export function paperRect(sheet) {
  const p = sheet?.paper || DEFAULT_PAPER;
  const [w, h] = PAPER_SIZES[p.size] || PAPER_SIZES.A4;
  const [W, H] = p.orientation === 'portrait' ? [h, w] : [w, h];
  return { x0: 0, y0: 0, x1: mm(W), y1: mm(H) };
}

/** The Project-wide title block fields, in the order the setup dialog shows them. */
export const TITLE_FIELDS = [
  ['title', 'Title'], ['company', 'Company'], ['author', 'Drawn by'], ['revision', 'Revision'], ['date', 'Date'], ['comment', 'Comment'],
];
export const newTitleBlock = () => Object.fromEntries(TITLE_FIELDS.map(([k]) => [k, '']));

/** Text variables and their values for a Sheet. `${TITLE}` falls back to the Project name. */
export function textVariables(project, sheet) {
  const tb = project.titleBlock || {};
  const sheets = project.schematic.sheets;
  return {
    TITLE: tb.title || project.name, PROJECT: project.name,
    COMPANY: tb.company || '', AUTHOR: tb.author || '', REV: tb.revision || '', DATE: tb.date || '', COMMENT: tb.comment || '',
    SHEET_NAME: sheet?.name || '', SHEET_NUMBER: String(sheets.indexOf(sheet) + 1), SHEET_COUNT: String(sheets.length),
  };
}

/** Fill in `${NAME}` variables; unknown ones are left as typed so a typo shows. */
export function expandVariables(text, project, sheet) {
  const vars = textVariables(project, sheet);
  return String(text).replace(/\$\{([A-Z_]+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}

/**
 * Where the title block sits (bottom right, inside a 5 mm margin) and its cells, each
 * { key, label, box, value(project, sheet), size, bold }. Lengths in nm.
 */
export function titleBlockLayout(sheet) {
  const r = paperRect(sheet);
  const margin = mm(5), W = mm(120), rowH = mm(7);
  const x1 = r.x1 - margin, y1 = r.y1 - margin, x0 = x1 - W, y0 = y1 - rowH * 4;
  const col = (f) => x0 + W * f;
  const cell = (key, label, cx0, cy0, cx1, cy1, value, opts = {}) => ({ key, label, box: { x0: cx0, y0: cy0, x1: cx1, y1: cy1 }, value, size: opts.size || mm(1.8), bold: !!opts.bold });
  const v = (k) => (p) => p.titleBlock?.[k] || '';
  return {
    box: { x0, y0, x1, y1 },
    cells: [
      cell('title', 'Title', x0, y0, x1, y0 + rowH * 1.5, (p) => p.titleBlock?.title || p.name, { size: mm(3), bold: true }),
      cell('sheet', 'Sheet', x0, y0 + rowH * 1.5, col(0.62), y0 + rowH * 2.5, (p, s) => s.name),
      cell('number', 'Sheet', col(0.62), y0 + rowH * 1.5, x1, y0 + rowH * 2.5, (p, s) => `${p.schematic.sheets.indexOf(s) + 1} of ${p.schematic.sheets.length}`),
      cell('company', 'Company', x0, y0 + rowH * 2.5, col(0.62), y1 - rowH * 0.5, v('company')),
      cell('revision', 'Rev', col(0.62), y0 + rowH * 2.5, col(0.78), y1 - rowH * 0.5, v('revision')),
      cell('date', 'Date', col(0.78), y0 + rowH * 2.5, x1, y1 - rowH * 0.5, v('date')),
      cell('author', 'Drawn by', x0, y1 - rowH * 0.5, col(0.5), y1, v('author'), { size: mm(1.3) }),
      cell('comment', 'Comment', col(0.5), y1 - rowH * 0.5, x1, y1, v('comment'), { size: mm(1.3) }),
    ],
  };
}

// ---------------------------------------------------------------- geometry of drawings

const estimate = (text, size) => Math.round(String(text).length * size * 0.6);

/** A text note's lines and the space they take, in the note's own frame (rot 0, origin at `at`). */
export function textLayout(d, measure = estimate) {
  const lines = String(d.text || '').split('\n');
  const lh = Math.round(d.size * 1.3);
  const w = Math.max(...lines.map((l) => measure(l || ' ', d.size)));
  const x0 = d.align === 'center' ? -w / 2 : d.align === 'right' ? -w : 0;
  return { lines, lh, w, box: { x0, y0: -lh / 2, x1: x0 + w, y1: -lh / 2 + lh * lines.length } };
}

/** The bounding box of a drawing in world nm (text measured with `measure`). */
export function drawingBounds(d, measure = estimate) {
  let pts;
  switch (d.type) {
    case 'text': {
      const { box } = textLayout(d, measure);
      pts = [[box.x0, box.y0], [box.x1, box.y0], [box.x1, box.y1], [box.x0, box.y1]].map((p) => rot90(p, d.rot || 0)).map(([x, y]) => [x + d.at[0], y + d.at[1]]);
      break;
    }
    case 'line': pts = d.pts; break;
    case 'rect': pts = [d.a, d.b]; break;
    case 'circle': pts = [[d.c[0] - d.r, d.c[1] - d.r], [d.c[0] + d.r, d.c[1] + d.r]]; break;
    case 'arc': pts = [d.start, d.mid, d.end]; break;
    default: pts = [[0, 0]];
  }
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

const segDist2 = (p, a, b) => {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = dx || dy ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy))) : 0;
  const x = a[0] + t * dx - p[0], y = a[1] + t * dy - p[1];
  return x * x + y * y;
};

/** Is world point `pt` on drawing `d` (within `tol`)? Outlines are hit on their line, filled shapes inside too, text anywhere in its box. */
export function hitsDrawing(d, pt, tol, measure = estimate) {
  if (d.type === 'text') {
    const b = drawingBounds(d, measure);
    return pt[0] >= b.x0 - tol && pt[0] <= b.x1 + tol && pt[1] >= b.y0 - tol && pt[1] <= b.y1 + tol;
  }
  if (d.type === 'line') { for (let i = 1; i < d.pts.length; i++) if (segDist2(pt, d.pts[i - 1], d.pts[i]) <= tol * tol) return true; return false; }
  if (d.type === 'rect') {
    const b = drawingBounds(d);
    const inside = pt[0] >= b.x0 && pt[0] <= b.x1 && pt[1] >= b.y0 && pt[1] <= b.y1;
    if (inside && d.fill === 'tint') return true;
    const c = [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]];
    return c.some((p, i) => segDist2(pt, p, c[(i + 1) % 4]) <= tol * tol);
  }
  if (d.type === 'circle') {
    const r = Math.hypot(pt[0] - d.c[0], pt[1] - d.c[1]);
    return Math.abs(r - d.r) <= tol || (d.fill === 'tint' && r <= d.r);
  }
  if (d.type === 'arc') {
    const c = arcCircle(d.start, d.mid, d.end);
    if (!c) return segDist2(pt, d.start, d.end) <= tol * tol;
    if (Math.abs(Math.hypot(pt[0] - c.c[0], pt[1] - c.c[1]) - c.r) > tol) return false;
    // within the sweep from start to end that passes through mid
    const ang = (p) => Math.atan2(p[1] - c.c[1], p[0] - c.c[0]);
    const norm = (a) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const a0 = ang(d.start), sweep = norm(ang(d.end) - a0), viaMid = norm(ang(d.mid) - a0) <= sweep;
    const t = norm(ang(pt) - a0);
    return viaMid ? t <= sweep : t >= sweep;
  }
  return false;
}

/** The topmost drawing on `sheet` under `pt`, or null. */
export function hitDrawing(sheet, pt, tol, measure = estimate) {
  const ds = sheet.drawings || [];
  for (let i = ds.length - 1; i >= 0; i--) if (hitsDrawing(ds[i], pt, tol, measure)) return ds[i];
  return null;
}

const POINT_KEYS = ['at', 'a', 'b', 'c', 'start', 'mid', 'end'];

/** Move a drawing by `delta` (in place). */
export function moveDrawing(d, [dx, dy]) {
  for (const k of POINT_KEYS) if (d[k]) d[k] = [d[k][0] + dx, d[k][1] + dy];
  if (d.pts) d.pts = d.pts.map(([x, y]) => [x + dx, y + dy]);
}

/**
 * Turn a drawing 90° counter-clockwise (in place): text toggles between 0° and 90° about its
 * anchor; shapes turn about the centre of their bounds, snapped to the grid so they stay on it.
 */
export function rotateDrawing(d) {
  if (d.type === 'text') { d.rot = d.rot === 90 ? 0 : 90; return; }
  const b = drawingBounds(d);
  const g = SCH_GRID / 2;
  const c = [Math.round((b.x0 + b.x1) / 2 / g) * g, Math.round((b.y0 + b.y1) / 2 / g) * g];
  const turn = ([x, y]) => { const [rx, ry] = rot90([x - c[0], y - c[1]], 90); return [rx + c[0], ry + c[1]]; };
  for (const k of POINT_KEYS) if (d[k]) d[k] = turn(d[k]);
  if (d.pts) d.pts = d.pts.map(turn);
}

/** Defaults for a new drawing of `type`. */
export function drawingDefaults(type) {
  switch (type) {
    case 'text': return { size: TEXT_SIZE, bold: false, italic: false, align: 'left', rot: 0 };
    case 'line': return { style: 'solid', arrowStart: false, arrowEnd: false };
    case 'rect': return { style: 'dashed', fill: 'none' };
    case 'circle': return { style: 'solid', fill: 'none' };
    case 'arc': return { style: 'solid' };
    default: return {};
  }
}
