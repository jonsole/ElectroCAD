// Walkaround routing (#22): the tentative Track from the last fixed corner to the cursor detours
// around foreign copper (Tracks, Vias, pads of other Nets) and the Outline's edge clearance, at
// 45° or 90°, the shorter way round, and never comes closer than the clearance. Nothing existing
// moves. When no legal path is found it stops at the first obstacle on the straight way.
//
// The search is A* over an octilinear lattice anchored on the start point, with a small cost for
// each bend so paths come out as a few long runs that hug the obstacles' clearance contour. A node
// finishes the search when the ordinary corner path from it to the cursor is clear, so a free
// cursor costs one check, and the corner style's own posture is kept wherever it fits. Every
// segment is checked exactly (capsule against shape) with the collision engine. DOM-free.
import { trackPoints } from './trackGeom.js';
import { shapeDistance, shapeBox, clearanceBetween, pairKind } from './collision.js';
import { arcCircle } from './geom.js';

const low = (s) => String(s || '').toLowerCase();
const CELL = 1_000_000; // 1 mm buckets for the obstacle field
const MAX_NODES = 25_000; // give up (and stop at the obstacle) past this many expanded nodes

// ---------------------------------------------------------------- the Outline as segments

/** The Outline's edges as straight segments (circles and arcs as short chords). */
export function outlineSegments(outline = []) {
  const segs = [];
  const poly = (pts, close) => { for (let i = 1; i < pts.length; i++) segs.push([pts[i - 1], pts[i]]); if (close && pts.length > 2) segs.push([pts[pts.length - 1], pts[0]]); };
  for (const s of outline) {
    if (s.type === 'line') poly(s.pts, false);
    else if (s.type === 'rect') poly([s.a, [s.b[0], s.a[1]], s.b, [s.a[0], s.b[1]]], true);
    else if (s.type === 'circle') poly(Array.from({ length: 48 }, (_, i) => [Math.round(s.c[0] + s.r * Math.cos((i / 48) * 2 * Math.PI)), Math.round(s.c[1] + s.r * Math.sin((i / 48) * 2 * Math.PI))]), true);
    else if (s.type === 'arc') {
      const c = arcCircle(s.start, s.mid, s.end);
      if (!c) { poly([s.start, s.end], false); continue; }
      const ang = (p) => Math.atan2(p[1] - c.c[1], p[0] - c.c[0]);
      const a0 = ang(s.start), am = ang(s.mid);
      const a1 = ang(s.end);
      // sweep from start through mid to end
      const norm = (x) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      let sweep = norm(a1 - a0);
      if (norm(am - a0) > sweep) sweep -= 2 * Math.PI;
      const n = Math.max(2, Math.ceil(Math.abs(sweep) / (Math.PI / 24)));
      const pts = [s.start];
      for (let i = 1; i < n; i++) { const a = a0 + (sweep * i) / n; pts.push([Math.round(c.c[0] + c.r * Math.cos(a)), Math.round(c.c[1] + c.r * Math.sin(a))]); }
      pts.push(s.end);
      poly(pts, false);
    } else if (s.pts) poly(s.pts, true);
  }
  return segs;
}

// ---------------------------------------------------------------- the obstacle field

/**
 * What a Track of `net`, `width` wide on `layer`, must keep clear of: the index's copper of other
 * Nets (each with its clearance) and the Outline's edges (edge clearance). `ignore` holds item ids
 * that don't count (copper already too close to the start, which the walk can't make better).
 */
export class Obstacles {
  constructor(project, index, layer, net, width, { ignore = new Set(), margin = 0 } = {}) {
    const board = project.board;
    this.r = width / 2;
    this.items = [];
    this.cells = new Map();
    this.maxNeed = 0;
    for (const it of index?.items || []) {
      if (ignore.has(it.id) || !it.layers.has(layer)) continue;
      if (net && low(it.net) === low(net)) continue;
      this._add({ id: it.id, kind: it.kind, shape: it.shape, need: clearanceBetween(board, net, it.net, 'track', pairKind(it)) + margin, item: it });
    }
    const edge = board.rules?.edgeClearance || 0;
    for (const [a, b] of outlineSegments(board.outline)) this._add({ id: `edge:${a.join(',')}:${b.join(',')}`, kind: 'edge', shape: { type: 'capsule', a, b, r: 0 }, need: edge + margin });
  }

  _add(o) {
    o.box = shapeBox(o.shape);
    this.items.push(o);
    this.maxNeed = Math.max(this.maxNeed, o.need);
    for (const k of this._keys(o.box)) { if (!this.cells.has(k)) this.cells.set(k, []); this.cells.get(k).push(o); }
  }

  *_keys(b) {
    for (let x = Math.floor(b.x0 / CELL); x <= Math.floor(b.x1 / CELL); x++) for (let y = Math.floor(b.y0 / CELL); y <= Math.floor(b.y1 / CELL); y++) yield `${x},${y}`;
  }

  /** The obstacles the segment ab (this Track's width) comes too close to. */
  hits(a, b, first = false) {
    const shape = { type: 'capsule', a, b, r: this.r };
    const m = this.maxNeed + this.r;
    const g = { x0: Math.min(a[0], b[0]) - m, y0: Math.min(a[1], b[1]) - m, x1: Math.max(a[0], b[0]) + m, y1: Math.max(a[1], b[1]) + m };
    const out = [], seen = new Set();
    for (const k of this._keys(g)) for (const o of this.cells.get(k) || []) {
      if (seen.has(o)) continue;
      seen.add(o);
      if (o.box.x0 > g.x1 || o.box.x1 < g.x0 || o.box.y0 > g.y1 || o.box.y1 < g.y0) continue;
      if (shapeDistance(shape, o.shape) < o.need) { out.push(o); if (first) return out; }
    }
    return out;
  }

  /** Is the segment ab clear? */
  clear(a, b) { return !this.hits(a, b, true).length; }

  /** Is a whole path clear? */
  pathClear(pts) {
    for (let i = 1; i < pts.length; i++) {
      if (pts[i].mid) { // an arc (#94): along its flattened centre line
        const q = trackPoints({ a: pts[i - 1], mid: pts[i].mid, b: pts[i] }, 20_000);
        if (!this.pathClear(q)) return false;
      } else if (!this.clear(pts[i - 1], pts[i])) return false;
    }
    return true;
  }
}

// ---------------------------------------------------------------- the search

const DIRS8 = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

/** A binary heap of [f, value]. */
class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(f, v) {
    const a = this.a; a.push([f, v]);
    let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top[1];
  }
}

/** Drop the points in the middle of straight runs. */
export function simplify(pts) {
  const out = [];
  for (const p of pts) {
    if (out.length && out[out.length - 1][0] === p[0] && out[out.length - 1][1] === p[1]) continue;
    if (out.length >= 2) {
      const a = out[out.length - 2], b = out[out.length - 1];
      if (!p.mid && !b.mid && (b[0] - a[0]) * (p[1] - b[1]) - (b[1] - a[1]) * (p[0] - b[0]) === 0 && (b[0] - a[0]) * (p[0] - b[0]) + (b[1] - a[1]) * (p[1] - b[1]) >= 0) { out[out.length - 1] = p; continue; }
    }
    out.push(p);
  }
  return out;
}

/** The farthest point along `path` (from its start) that keeps the whole prefix clear. */
export function clearPrefix(obs, path) {
  const out = [path[0]];
  for (let i = 1; i < path.length; i++) {
    const a = out[out.length - 1], b = path[i];
    if (obs.clear(a, b)) { out.push(b); continue; }
    // the clear length of ab is a prefix (a longer capsule covers a shorter one): bisect it
    let lo = 0, hi = 1;
    for (let k = 0; k < 24; k++) { const t = (lo + hi) / 2; if (obs.clear(a, [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t)])) lo = t; else hi = t; }
    const p = [Math.round(a[0] + (b[0] - a[0]) * lo), Math.round(a[1] + (b[1] - a[1]) * lo)];
    if (p[0] !== a[0] || p[1] !== a[1]) out.push(p);
    break;
  }
  return out;
}

/**
 * The walkaround path from `a` to `b`: [a, …corners, end], where end is b, or where the way
 * stops at an obstacle (`blocked: true`) when no clear path was found.
 *  - corner: '90' | '45' | 'any' (any-angle finishes with a straight segment from the last corner)
 *  - finish(from): the corner points from `from` to b the editor would draw (its posture), or null
 *  - step: lattice pitch, nm
 *  - exit(dir): how far the first run must go straight along an axis direction (out of the start
 *    pad, so it isn't left at 45°), or null for no such rule
 */
export function walkPath(obs, a, b, { corner = '45', finish, step: pitch, exit = null } = {}) {
  const fin = finish || ((p) => [b]);
  const tryFinish = (p) => { const tail = fin(p); return tail && obs.pathClear([p, ...tail]) ? tail : null; };
  // the straight way first
  const direct = tryFinish(a);
  if (direct) return { path: simplify([a, ...direct]), blocked: false };
  if (!obs.clear(a, a)) return { path: [a], blocked: true }; // already too close to something
  if (!obs.clear(b, b)) return { path: simplify(clearPrefix(obs, [a, ...(fin(a) || [b])])), blocked: true }; // the cursor is on foreign copper
  const g = Math.max(10_000, Math.round(pitch || Math.max(25_000, Math.min(250_000, (obs.maxNeed + obs.r) / 2))));
  const dirs = corner === '90' ? DIRS8.filter((_, i) => i % 2 === 0) : DIRS8;
  const dist = (dx, dy) => (corner === '90' ? Math.abs(dx) + Math.abs(dy) : corner === 'any' ? Math.hypot(dx, dy) : Math.max(Math.abs(dx), Math.abs(dy)) + (Math.SQRT2 - 1) * Math.min(Math.abs(dx), Math.abs(dy)));
  const H = (x, y) => dist(b[0] - (a[0] + x * g), b[1] - (a[1] + y * g));
  // a bounding window round the two ends, so a wall with no way round ends the search
  const span = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const pad = Math.max(3_000_000, span * 0.75);
  const win = { x0: Math.floor((Math.min(a[0], b[0]) - pad - a[0]) / g), x1: Math.ceil((Math.max(a[0], b[0]) + pad - a[0]) / g), y0: Math.floor((Math.min(a[1], b[1]) - pad - a[1]) / g), y1: Math.ceil((Math.max(a[1], b[1]) + pad - a[1]) / g) };
  const BEND = g * 0.6; // a bend costs a little more than a short step, so runs stay long
  const key = (x, y, d) => `${x},${y},${d}`;
  const best = new Map();
  const heap = new Heap();
  const start = { x: 0, y: 0, d: -1, cost: 0, prev: null };
  const pt = (x, y) => [a[0] + x * g, a[1] + y * g];
  const exits = exit ? dirs.map(([dx, dy], d) => ((dx && dy) ? null : { d, dx, dy, r: exit([dx, dy]) })).filter((e) => e && e.r != null) : [];
  if (exits.length) {
    // out of the start pad square: straight along an axis to its edge (on the lattice), then free
    for (const e of exits) {
      const k = Math.max(1, Math.ceil(e.r / g)), x = e.dx * k, y = e.dy * k;
      if (!obs.clear(a, pt(x, y))) continue;
      best.set(key(x, y, e.d), k * g);
      heap.push(k * g + H(x, y), { x, y, d: e.d, cost: k * g, prev: start });
    }
  } else {
    heap.push(H(0, 0), start);
    best.set(key(0, 0, -1), 0);
  }
  let n = 0;
  const edgeOk = new Map();
  while (heap.size && n < MAX_NODES) {
    const node = heap.pop();
    if (node.cost > (best.get(key(node.x, node.y, node.d)) ?? Infinity)) continue;
    n++;
    const here = pt(node.x, node.y);
    if (node.prev) {
      const tail = tryFinish(here);
      if (tail) {
        const pts = [];
        for (let m = node; m; m = m.prev) pts.push(pt(m.x, m.y));
        pts.reverse();
        return { path: simplify([...pts, ...tail]), blocked: false };
      }
    }
    for (let d = 0; d < dirs.length; d++) {
      const [dx, dy] = dirs[d];
      const x = node.x + dx, y = node.y + dy;
      if (x < win.x0 || x > win.x1 || y < win.y0 || y > win.y1) continue;
      const turn = node.d >= 0 && node.d !== d ? BEND * (Math.abs(((d - node.d + dirs.length + dirs.length / 2) % dirs.length) - dirs.length / 2) >= dirs.length / 4 ? 2 : 1) : 0;
      if (node.d >= 0 && (d + dirs.length / 2) % dirs.length === node.d) continue; // no doubling back
      const cost = node.cost + g * (dx && dy ? Math.SQRT2 : 1) + turn;
      const k = key(x, y, d);
      if (cost >= (best.get(k) ?? Infinity)) continue;
      const ek = `${node.x},${node.y}>${x},${y}`;
      let ok = edgeOk.get(ek);
      if (ok === undefined) { ok = obs.clear(here, pt(x, y)); edgeOk.set(ek, ok); }
      if (!ok) continue;
      best.set(k, cost);
      heap.push(cost + H(x, y), { x, y, d, cost, prev: node });
    }
  }
  // no way round: stop at the obstacle on the straight way
  const straight = fin(a) || [b];
  return { path: simplify(clearPrefix(obs, [a, ...straight])), blocked: true };
}
