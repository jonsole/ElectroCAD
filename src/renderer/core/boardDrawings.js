// Board drawings (#66): text, lines, rectangles, circles, arcs and polygons on the Board's own layers
// (silk, fab, courtyard, mask, paste and copper), kept in board.drawings. DOM-free: the geometry the
// board view, the silk / copper Gerbers, zones and DRC all draw from, so they always agree.
//
// A drawing is { id, type, layer, … } in board nm (+Y down):
//   text   { text, at (the centre), size, rot (degrees anticlockwise) } — mirrored on the B.* layers,
//          drawn in the board's text font (core/strokefont.js, board.textFont)
//   line   { pts, width }                 arc { start, mid, end, width }
//   rect   { a, b, width, fill? }         circle { c, r, width, fill? }
//   poly   { pts, width, fill? }          fill: 'outline' fills the shape (its edge is still stroked)
import { strokeText, strokePen, strokeWidthOf, FONTS } from './strokefont.js';
import { arcCircle } from './geom.js';
import { copperLayerNames } from './board.js';

/** Layers a drawing can go on (copper ones depend on the stack). */
export const DRAWING_LAYERS = ['F.SilkS', 'B.SilkS', 'F.Fab', 'B.Fab', 'F.CrtYd', 'B.CrtYd', 'F.Mask', 'B.Mask', 'F.Paste', 'B.Paste'];
export const drawingLayers = (copper) => [...DRAWING_LAYERS, ...copperLayerNames(copper)];

/** Default stroke widths: silk 0.15 mm, the others 0.1 mm; text 1 mm high. */
export const defaultWidth = (layer) => (/SilkS$/.test(layer) ? 150_000 : /Cu$/.test(layer) ? 200_000 : 100_000);
export const DEFAULT_TEXT_SIZE = 1_000_000;

const isBack = (layer) => /^B\./.test(layer);
const rotPt = (deg) => {
  const t = (deg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  return ([x, y]) => [x * c + y * s, -x * s + y * c]; // anticlockwise on screen (+Y down)
};

/**
 * Where to put a text's centre so that its `anchor` (Eagle's alignments: 'bottom-left' (the default),
 * 'center', 'top-right', …) lands on `at`, given its rotation and whether it's mirrored.
 */
export function textCentre(text, { at, size, rot = 0, mirror = false, align = 'bottom-left', font = 'stroke' }) {
  const w = strokeWidthOf(text, size, font), cap = size * (FONTS[font] || FONTS.stroke).cap;
  const [v, hz] = align === 'center' ? ['center', 'center'] : align.split('-');
  const dx = hz === 'left' ? w / 2 : hz === 'right' ? -w / 2 : 0;
  const dy = v === 'bottom' ? -cap / 2 : v === 'top' ? cap / 2 : 0;
  const [ox, oy] = rotPt(rot)([mirror ? -dx : dx, dy]);
  return [Math.round(at[0] + ox), Math.round(at[1] + oy)];
}

/** A text drawing's strokes: polylines in board nm, and the pen width. */
export function textStrokes(d, font = 'stroke') {
  const R = rotPt(d.rot || 0);
  const lines = strokeText(d.text, { at: [0, 0], size: d.size, mirror: isBack(d.layer), font })
    .map((pl) => pl.map((p) => { const [x, y] = R(p); return [Math.round(d.at[0] + x), Math.round(d.at[1] + y)]; }));
  return { lines, pen: strokePen(d.size, font) };
}

function circlePts(c, r, n = 48) {
  const out = [];
  for (let i = 0; i <= n; i++) { const t = (i / n) * 2 * Math.PI; out.push([Math.round(c[0] + r * Math.cos(t)), Math.round(c[1] + r * Math.sin(t))]); }
  return out;
}

/** An arc through start, mid and end as a polyline. */
export function arcPolyline(start, mid, end, n = 32) {
  const k = arcCircle(start, mid, end);
  if (!k) return [start, end];
  const ang = (p) => Math.atan2(p[1] - k.c[1], p[0] - k.c[0]);
  const a0 = ang(start), a1 = ang(end), am = ang(mid);
  const norm = (x) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  let sweep = norm(a1 - a0);
  if (norm(am - a0) > sweep) sweep -= 2 * Math.PI; // the other way round
  const out = [];
  for (let i = 0; i <= n; i++) { const t = a0 + (sweep * i) / n; out.push([Math.round(k.c[0] + k.r * Math.cos(t)), Math.round(k.c[1] + k.r * Math.sin(t))]); }
  return out;
}

/** The outline of a closed drawing (rect, circle, poly) as a ring of points, or null. */
export function drawingRing(d) {
  if (d.type === 'rect') return [d.a, [d.b[0], d.a[1]], d.b, [d.a[0], d.b[1]]];
  if (d.type === 'circle') return circlePts(d.c, d.r).slice(0, -1);
  if (d.type === 'poly') return d.pts;
  return null;
}

/**
 * What a drawing puts on its layer: { strokes: [{ pts, width }], fills: [ring] }. Strokes are
 * polylines drawn with a round pen of `width`; fills are closed rings (filled shapes).
 */
export function drawingGeometry(d, font = 'stroke') {
  if (d.type === 'text') { const t = textStrokes(d, font); return { strokes: t.lines.map((pts) => ({ pts, width: t.pen })), fills: [] }; }
  const width = d.width ?? defaultWidth(d.layer);
  if (d.type === 'line') return { strokes: [{ pts: d.pts, width }], fills: [] };
  if (d.type === 'arc') return { strokes: [{ pts: arcPolyline(d.start, d.mid, d.end), width }], fills: [] };
  const ring = drawingRing(d);
  if (!ring) return { strokes: [], fills: [] };
  const strokes = width > 0 ? [{ pts: [...ring, ring[0]], width }] : [];
  return { strokes, fills: d.fill === 'outline' ? [ring] : [] };
}

/** The box round a drawing (nm), including its pen. */
export function drawingBox(d, font = 'stroke') {
  const g = drawingGeometry(d, font);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of g.strokes) for (const [x, y] of s.pts) { const r = s.width / 2; x0 = Math.min(x0, x - r); y0 = Math.min(y0, y - r); x1 = Math.max(x1, x + r); y1 = Math.max(y1, y + r); }
  for (const ring of g.fills) for (const [x, y] of ring) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return x0 === Infinity ? null : { x0, y0, x1, y1 };
}

const seg2 = (p, a, b) => {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = dx || dy ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]);
};
const inRing = (p, pts) => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

/**
 * The topmost drawing under `pt` (within `tol` of a stroke, inside a filled shape, or inside a
 * text's box), among those `visible(layer)`; or null.
 */
export function hitDrawing(drawings, pt, tol, { font = 'stroke', visible = () => true } = {}) {
  for (let i = (drawings || []).length - 1; i >= 0; i--) {
    const d = drawings[i];
    if (!visible(d.layer)) continue;
    if (d.type === 'text') {
      // inside its (turned) box
      const w = strokeWidthOf(d.text, d.size, font) / 2 + tol, h = d.size / 2 + tol;
      const [x, y] = rotPt(-(d.rot || 0))([pt[0] - d.at[0], pt[1] - d.at[1]]);
      if (Math.abs(x) <= w && Math.abs(y) <= h) return d;
      continue;
    }
    const g = drawingGeometry(d, font);
    if (g.fills.some((ring) => inRing(pt, ring))) return d;
    for (const s of g.strokes) for (let k = 1; k < s.pts.length; k++) if (seg2(pt, s.pts[k - 1], s.pts[k]) <= tol + s.width / 2) return d;
  }
  return null;
}

/** Move drawings (in place) by [dx, dy]. */
export function moveDrawings(drawings, [dx, dy]) {
  const mv = ([x, y]) => [x + dx, y + dy];
  for (const d of drawings) {
    for (const k of ['a', 'b', 'c', 'at', 'start', 'mid', 'end']) if (d[k]) d[k] = mv(d[k]);
    if (d.pts) d.pts = d.pts.map(mv);
  }
}

/** Turn drawings (in place) by `deg` anticlockwise about `about` (text turns with them). */
export function rotateDrawings(drawings, deg, about) {
  const R = rotPt(deg);
  const turn = (p) => { const [x, y] = R([p[0] - about[0], p[1] - about[1]]); return [Math.round(about[0] + x), Math.round(about[1] + y)]; };
  for (const d of drawings) {
    if (d.type === 'rect' && deg % 90 === 0) { const a = turn(d.a), b = turn(d.b); d.a = [Math.min(a[0], b[0]), Math.min(a[1], b[1])]; d.b = [Math.max(a[0], b[0]), Math.max(a[1], b[1])]; continue; }
    if (d.type === 'rect') { const ring = drawingRing(d).map(turn); delete d.a; delete d.b; Object.assign(d, { type: 'poly', pts: ring }); continue; }
    for (const k of ['c', 'at', 'start', 'mid', 'end']) if (d[k]) d[k] = turn(d[k]);
    if (d.pts) d.pts = d.pts.map(turn);
    if (d.type === 'text') d.rot = (((d.rot || 0) + deg) % 360 + 360) % 360;
  }
}

/** The middle of some drawings' boxes (what R turns them about). */
export function drawingsCentre(drawings, font = 'stroke') {
  const bs = drawings.map((d) => drawingBox(d, font)).filter(Boolean);
  if (!bs.length) return [0, 0];
  const x0 = Math.min(...bs.map((b) => b.x0)), y0 = Math.min(...bs.map((b) => b.y0)), x1 = Math.max(...bs.map((b) => b.x1)), y1 = Math.max(...bs.map((b) => b.y1));
  return [Math.round((x0 + x1) / 2), Math.round((y0 + y1) / 2)];
}

/**
 * Drawings on copper, as collision items for the copper index (DRC, routing): one per stroke
 * segment (capsules) and filled ring (polygons), all with the drawing's id and no net.
 */
export function copperDrawingItems(board) {
  const copper = new Set(copperLayerNames(board.stack.copper)), font = board.textFont || 'stroke';
  const out = [];
  for (const d of board.drawings || []) {
    if (!copper.has(d.layer)) continue;
    const g = drawingGeometry(d, font);
    for (const s of g.strokes) for (let k = 1; k < s.pts.length || (k === 1 && s.pts.length === 1); k++) {
      const a = s.pts[k - 1], b = s.pts[k] || a;
      out.push({ kind: 'drawing', id: d.id, net: '', layers: new Set([d.layer]), shape: { type: 'capsule', a, b, r: s.width / 2 }, item: d });
    }
    for (const ring of g.fills) out.push({ kind: 'drawing', id: d.id, net: '', layers: new Set([d.layer]), shape: { type: 'poly', pts: ring }, item: d });
  }
  return out;
}

/** Drawings on copper as net-less tracks, so zones pour round them. */
export function copperDrawingTracks(board) {
  const out = [];
  for (const it of copperDrawingItems(board)) {
    if (it.shape.type === 'capsule') out.push({ id: `${it.id}:${out.length}`, net: '', layer: [...it.layers][0], a: it.shape.a, b: it.shape.b, width: it.shape.r * 2 });
    else { const p = it.shape.pts; for (let i = 0; i < p.length; i++) out.push({ id: `${it.id}:${out.length}`, net: '', layer: [...it.layers][0], a: p[i], b: p[(i + 1) % p.length], width: 0 }); }
  }
  return out;
}
