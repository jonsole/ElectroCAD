// The collision engine (#20): the Board's copper as shapes in a spatial index, and clearance
// checks between them. Shared by the router (live collision highlighting) and DRC (#25). DOM-free.
//
// Shapes (nm):
//   { type: 'capsule', a, b, r }  a Track (a circle when a = b: a Via, a round pad)
//   { type: 'poly', pts }          a rectangular pad (its corners, rotated)
//   { type: 'chain', pts, r, a, b } an arc Track (#93): capsules along its flattened centre line
// An item is { kind: 'track' | 'via' | 'pad', id, net, layers: Set, shape, box }.
import { copperDrawingItems } from './boardDrawings.js';
import { placedPads, padNets, padByLayers } from './footprint.js';
import { copperLayerNames } from './board.js';
import { trackShape } from './trackGeom.js';

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
  if (t.type === 'chain' && s.type !== 'chain') return shapeDistance(t, s);
  if (s.type === 'chain') { // the nearest of its capsules
    let m = Infinity;
    for (const c of chainCapsules(s)) { m = Math.min(m, shapeDistance(c, t)); if (m <= 0) break; }
    return m;
  }
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

/** A chain's capsules, one per piece. */
export function chainCapsules(s) {
  const out = [];
  for (let i = 1; i < s.pts.length; i++) out.push({ type: 'capsule', a: s.pts[i - 1], b: s.pts[i], r: s.r });
  return out;
}

export function shapeBox(s) {
  if (s.type === 'chain') {
    const xs = s.pts.map((p) => p[0]), ys = s.pts.map((p) => p[1]);
    return { x0: Math.min(...xs) - s.r, y0: Math.min(...ys) - s.r, x1: Math.max(...xs) + s.r, y1: Math.max(...ys) + s.r };
  }
  if (s.type === 'capsule') return { x0: Math.min(s.a[0], s.b[0]) - s.r, y0: Math.min(s.a[1], s.b[1]) - s.r, x1: Math.max(s.a[0], s.b[0]) + s.r, y1: Math.max(s.a[1], s.b[1]) + s.r };
  const xs = s.pts.map((p) => p[0]), ys = s.pts.map((p) => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/** A regular octagon's chamfer: each corner cut back this fraction of the side (Eagle's octagon pads). */
export const OCTAGON = 1 - Math.SQRT1_2;

/**
 * A chamfered rectangle (#70), centred, in pad coordinates (+Y down): each corner in `corners`
 * ('tl', 'tr', 'br', 'bl'; all when absent) cut back `ratio` of the shorter side.
 */
export function chamferPts(w, h, ratio = OCTAGON, corners = null) {
  const c = Math.max(0, Math.min(0.5, ratio)) * Math.min(w, h), on = (k) => !corners || corners.includes(k);
  const x = w / 2, y = h / 2, out = [];
  const corner = (k, p, q, r) => { if (on(k)) out.push(p, r); else out.push(q); };
  corner('tl', [-x, -y + c], [-x, -y], [-x + c, -y]);
  corner('tr', [x - c, -y], [x, -y], [x, -y + c]);
  corner('br', [x, y - c], [x, y], [x - c, y]);
  corner('bl', [-x + c, y], [-x, y], [-x, y - c]);
  return out;
}

/** Is this pad a regular octagon (a square with every corner cut at the octagon's ratio)? */
export const isOctagon = (pad) => pad.shape === 'chamfer' && pad.size[0] === pad.size[1] && !pad.corners && Math.abs((pad.chamfer ?? OCTAGON) - OCTAGON) < 1e-3;

/** A placed pad as a shape: circles and ovals as capsules, rectangles (and rounded or chamfered ones) as polygons. */
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
  if (pad.shape === 'chamfer') return { type: 'poly', pts: chamferPts(w, h, pad.chamfer ?? OCTAGON, pad.corners).map(R) };
  return { type: 'poly', pts: [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(R) };
}

// ---------------------------------------------------------------- rules

/** The Net class of a Net (by name, regardless of case), or the Board's default rules. */
export function netRules(board, net) {
  const r = board.rules;
  for (const nc of Object.values(board.netClasses || {})) if ((nc.nets || []).some((n) => low(n) === low(net))) return nc;
  return { trackWidth: r.trackWidth, clearance: r.clearance, viaDrill: r.viaDrill, viaDiameter: r.viaDiameter };
}

// ---------------------------------------------------------------- clearance per object pair (#68)

/**
 * The kinds of copper a clearance can depend on, as Eagle's rules for different signals have them
 * (its SMD values are for the same signal; between nets an SMD pad is a pad).
 */
export const PAIR_KINDS = ['track', 'pad', 'via'];
/** Every pair of kinds, as rules.pairs keys: 'track-track', 'track-pad'… (in PAIR_KINDS order). */
export const PAIR_KEYS = PAIR_KINDS.flatMap((a, i) => PAIR_KINDS.slice(i).map((b) => `${a}-${b}`));
export const pairKey = (k1, k2) => (PAIR_KINDS.indexOf(k1) <= PAIR_KINDS.indexOf(k2) ? `${k1}-${k2}` : `${k2}-${k1}`);
/**
 * An index item's kind for the pair rules: a pad (through-hole or SMD) 'pad', a Via 'via';
 * Tracks, Zone fills and copper drawings 'track' (as Eagle treats a polygon's copper as wire).
 */
export const pairKind = (it) => (it.kind === 'via' ? 'via' : it.kind === 'pad' ? 'pad' : 'track');

/** An explicit Net class's clearance for `net`, or 0 for a Net in the Default class. */
function classClearance(board, net) {
  for (const nc of Object.values(board.netClasses || {})) if ((nc.nets || []).some((n) => low(n) === low(net))) return nc.clearance || 0;
  return 0;
}

/**
 * Clearance two pieces of copper must keep. Without a pair rule: the larger of their Nets'
 * classes' (the Design rules' clearance for the Default class). With one for their kinds
 * (rules.pairs, #68): that, in place of the Default class's, unless an explicit Net class asks
 * for more (as in Eagle: the larger of the class clearance and the object-pair distance).
 * `k1`, `k2`: PAIR_KINDS (omitted: no pair rule applies).
 */
export function clearanceBetween(board, n1, n2, k1 = null, k2 = null) {
  const pair = k1 && k2 ? board.rules?.pairs?.[pairKey(k1, k2)] : undefined;
  if (pair == null) return Math.max(netRules(board, n1).clearance, netRules(board, n2).clearance);
  return Math.max(pair, classClearance(board, n1), classClearance(board, n2));
}

/** The largest clearance anything on the Board can ask for (classes, pair rules, the edge). */
export function maxClearance(board) {
  const r = board.rules || {};
  return Math.max(r.clearance || 0, r.edgeClearance || 0, ...Object.values(board.netClasses || {}).map((c) => c.clearance || 0), ...Object.values(r.pairs || {}).map((v) => v || 0));
}

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
   * than their clearance. `board` gives the clearances; `ignore` is a Set of item ids; `kind`: what
   * `shape` is, for the pair rules (#68): 'track' (default), 'pad' or 'via'.
   */
  collisions(board, shape, layer, net, ignore = new Set(), kind = 'track') {
    const b = shapeBox(shape), maxC = maxClearance(board);
    return this.near(b, maxC).filter((it) => !ignore.has(it.id) && it.layers.has(layer) && (low(it.net) !== low(net) || !net) && shapeDistance(shape, it.shape) < clearanceBetween(board, net, it.net, kind, pairKind(it)));
  }
}

/** The Board's copper as an index: Tracks, Vias and pads (with their Nets from the annotation record). */
export function copperIndex(project, board = project.board) {
  const copper = copperLayerNames(board.stack.copper);
  const items = [];
  for (const t of board.tracks || []) items.push({ kind: 'track', id: t.id, net: t.net, layers: new Set([t.layer]), shape: trackShape(t), item: t });
  for (const v of board.vias || []) items.push({ kind: 'via', id: v.id, net: v.net, layers: new Set(copper), shape: { type: 'capsule', a: v.at, b: v.at, r: v.diameter / 2 }, item: v });
  const nets = padNets(board), view = { ...project, board };
  for (const bf of board.footprints) {
    for (const pad of placedPads(view, bf, nets)) {
      const layers = pad.layers.includes('*.Cu') ? copper : pad.layers.filter((l) => copper.includes(l));
      // a pad with an inner size is two items: its outer shape and its inner one (#82), one id
      for (const { pad: q, layers: ls } of padByLayers(pad, layers)) items.push({ kind: 'pad', id: `${bf.id}:${pad.number}:${pad.at.join(',')}`, net: pad.net, layers: new Set(ls), shape: padShape(q), item: pad, footprint: bf });
    }
  }
  items.push(...copperDrawingItems(board)); // text and shapes on copper (#66), with no net
  return new CopperIndex(items);
}
