// The collision engine (#20): the Board's copper as shapes in a spatial index, and clearance
// checks between them. Shared by the router (live collision highlighting) and DRC (#25). DOM-free.
//
// Shapes (nm):
//   { type: 'capsule', a, b, r }  a Track (a circle when a = b: a Via, a round pad)
//   { type: 'poly', pts }          a rectangular pad (its corners, rotated)
// An item is { kind: 'track' | 'via' | 'pad', id, net, layers: Set, shape, box }.
import { placedPads, padNets } from './footprint.js';
import { copperLayerNames } from './board.js';

const low = (s) => String(s || '').toLowerCase();

// ---------------------------------------------------------------- geometry

const d2 = (p, q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2;

/** Squared distance from point p to segment ab. */
export function pointSeg2(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)) : 0;
  return d2(p, [a[0] + t * dx, a[1] + t * dy]);
}

const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
function segsCross(a, b, c, d) {
  const d1 = cross(c, d, a), d2_ = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
  return ((d1 > 0) !== (d2_ > 0)) && d1 !== 0 && d2_ !== 0 && ((d3 > 0) !== (d4 > 0)) && d3 !== 0 && d4 !== 0;
}

/** Distance between segments ab and cd (0 when they cross). */
export function segSeg(a, b, c, d) {
  if (segsCross(a, b, c, d)) return 0;
  return Math.sqrt(Math.min(pointSeg2(a, c, d), pointSeg2(b, c, d), pointSeg2(c, a, b), pointSeg2(d, a, b)));
}

function inPoly(p, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Edge-to-edge distance between two shapes (0 or less when they touch or overlap). */
export function shapeDistance(s, t) {
  if (s.type === 'poly' && t.type !== 'poly') return shapeDistance(t, s);
  if (s.type === 'capsule' && t.type === 'capsule') return segSeg(s.a, s.b, t.a, t.b) - s.r - t.r;
  if (s.type === 'capsule') { // capsule – poly
    if (inPoly(s.a, t.pts) || inPoly(s.b, t.pts)) return -s.r;
    let m = Infinity;
    for (let i = 0; i < t.pts.length; i++) m = Math.min(m, segSeg(s.a, s.b, t.pts[i], t.pts[(i + 1) % t.pts.length]));
    return m - s.r;
  }
  // poly – poly
  if (t.pts.some((p) => inPoly(p, s.pts)) || s.pts.some((p) => inPoly(p, t.pts))) return -1;
  let m = Infinity;
  for (let i = 0; i < s.pts.length; i++) for (let j = 0; j < t.pts.length; j++) m = Math.min(m, segSeg(s.pts[i], s.pts[(i + 1) % s.pts.length], t.pts[j], t.pts[(j + 1) % t.pts.length]));
  return m;
}

export function shapeBox(s) {
  if (s.type === 'capsule') return { x0: Math.min(s.a[0], s.b[0]) - s.r, y0: Math.min(s.a[1], s.b[1]) - s.r, x1: Math.max(s.a[0], s.b[0]) + s.r, y1: Math.max(s.a[1], s.b[1]) + s.r };
  const xs = s.pts.map((p) => p[0]), ys = s.pts.map((p) => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/** A placed pad as a shape: circles and ovals as capsules, rectangles (and rounded ones) as polygons. */
export function padShape(pad) {
  const [w, h] = pad.size;
  const t = ((pad.rot || 0) * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  const R = ([x, y]) => [Math.round(pad.at[0] + x * c + y * s), Math.round(pad.at[1] - x * s + y * c)];
  if (pad.shape === 'circle') return { type: 'capsule', a: pad.at, b: pad.at, r: w / 2 };
  if (pad.shape === 'oval') {
    const r = Math.min(w, h) / 2, half = Math.abs(w - h) / 2;
    const [a, b] = w >= h ? [[-half, 0], [half, 0]] : [[0, -half], [0, half]];
    return { type: 'capsule', a: R(a), b: R(b), r };
  }
  return { type: 'poly', pts: [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(R) };
}

// ---------------------------------------------------------------- rules

/** The Net class of a Net (by name, regardless of case), or the Board's default rules. */
export function netRules(board, net) {
  const r = board.rules;
  for (const nc of Object.values(board.netClasses || {})) if ((nc.nets || []).some((n) => low(n) === low(net))) return nc;
  return { trackWidth: r.trackWidth, clearance: r.clearance, viaDrill: r.viaDrill, viaDiameter: r.viaDiameter };
}

/** Clearance two Nets must keep: the larger of their classes'. */
export const clearanceBetween = (board, n1, n2) => Math.max(netRules(board, n1).clearance, netRules(board, n2).clearance);

// ---------------------------------------------------------------- the index

const CELL = 2_000_000; // 2 mm buckets

export class CopperIndex {
  constructor(items = []) { this.items = []; this.cells = new Map(); for (const it of items) this.add(it); }

  add(it) {
    it.box ||= shapeBox(it.shape);
    this.items.push(it);
    for (const k of this._keys(it.box)) { if (!this.cells.has(k)) this.cells.set(k, []); this.cells.get(k).push(it); }
  }

  *_keys(b) {
    for (let x = Math.floor(b.x0 / CELL); x <= Math.floor(b.x1 / CELL); x++) for (let y = Math.floor(b.y0 / CELL); y <= Math.floor(b.y1 / CELL); y++) yield `${x},${y}`;
  }

  /** Items whose box comes within `margin` of box b. */
  near(b, margin = 0) {
    const g = { x0: b.x0 - margin, y0: b.y0 - margin, x1: b.x1 + margin, y1: b.y1 + margin };
    const out = new Set();
    for (const k of this._keys(g)) for (const it of this.cells.get(k) || []) if (it.box.x0 <= g.x1 && it.box.x1 >= g.x0 && it.box.y0 <= g.y1 && it.box.y1 >= g.y0) out.add(it);
    return [...out];
  }

  /**
   * Copper on `layer` that `shape` (carrying `net`) comes too close to: other Nets' items nearer
   * than their clearance. `board` gives the clearances; `ignore` is a Set of item ids.
   */
  collisions(board, shape, layer, net, ignore = new Set()) {
    const b = shapeBox(shape), maxC = Math.max(board.rules.clearance, ...Object.values(board.netClasses || {}).map((c) => c.clearance));
    return this.near(b, maxC).filter((it) => !ignore.has(it.id) && it.layers.has(layer) && (low(it.net) !== low(net) || !net) && shapeDistance(shape, it.shape) < clearanceBetween(board, net, it.net));
  }
}

/** The Board's copper as an index: Tracks, Vias and pads (with their Nets from the annotation record). */
export function copperIndex(project, board = project.board) {
  const copper = copperLayerNames(board.stack.copper);
  const items = [];
  for (const t of board.tracks || []) items.push({ kind: 'track', id: t.id, net: t.net, layers: new Set([t.layer]), shape: { type: 'capsule', a: t.a, b: t.b, r: t.width / 2 }, item: t });
  for (const v of board.vias || []) items.push({ kind: 'via', id: v.id, net: v.net, layers: new Set(copper), shape: { type: 'capsule', a: v.at, b: v.at, r: v.diameter / 2 }, item: v });
  const nets = padNets(board), view = { ...project, board };
  for (const bf of board.footprints) {
    for (const pad of placedPads(view, bf, nets)) {
      const layers = pad.layers.includes('*.Cu') ? copper : pad.layers.filter((l) => copper.includes(l));
      items.push({ kind: 'pad', id: `${bf.id}:${pad.number}:${pad.at.join(',')}`, net: pad.net, layers: new Set(layers), shape: padShape(pad), item: pad, footprint: bf });
    }
  }
  return new CopperIndex(items);
}
