// Push-and-shove (#29, #30, #108, ADR-0006): new copper pushes other Nets' Tracks and Vias aside to
// keep clearance, as KiCad's interactive router does.
//
// Tracks are pushed as whole **lines**: one Net's copper on one layer between two joints (a pad, a
// Via, a junction of three or more ends, a change of width, or a free end), as a chain of points.
// Every pusher segment has a **hull**: the segment grown by its half-width, the clearance and the
// pushed line's half-width, with octagonal caps, so its edges run at 0°, 45° and 90° (hullOf).
// Where a line runs into a hull, the stretch inside is replaced by the hull's outline on the side the
// push travels (walkHull): the line goes round the pusher at the clearance, in 45° and 90° pieces,
// its joints staying put. A pushed line pushes the lines it now crowds in turn, in the same
// direction, never back into the lines that pushed it (the cascade). Pads, copper drawings, locked
// copper and arc Tracks (#93) never move: a push that needs them to fails, and the router walks
// round instead. A Via in the way moves clear in a 45° direction (viaMove), its Tracks' ends going
// with it (#30). The shove is worked out afresh from the Board as it was for every cursor position,
// so pushed copper springs back as the cursor withdraws. DOM-free.
import { shapeDistance, shapeBox, clearanceBetween, pairKind, maxClearance } from './collision.js';
import { outlineSegments } from './walkaround.js';
import { uid } from './project.js';
import { trackShape } from './trackGeom.js';
import ClipperLib from 'clipper-lib';

const MAX_PUSHES = 400;   // give up past this many pushes in one shove
const MAX_PER_LINE = 24;  // or when one line is pushed this many times over
const SLACK = 2_000;      // nm beyond the clearance, so rounding never leaves a pushed line short
const OCT = 1 / Math.cos(Math.PI / 8); // an octagon's corner radius over its inner radius
const low = (s) => String(s || '').toLowerCase();
const cap = trackShape;
const boxesMeet = (a, b, m = 0) => a.x0 - m <= b.x1 && a.x1 + m >= b.x0 && a.y0 - m <= b.y1 && a.y1 + m >= b.y0;
const sameAt = (p, q) => p[0] === q[0] && p[1] === q[1];
const keyOf = (layer, p) => `${layer}|${p[0]},${p[1]}`;

// ---- geometry -------------------------------------------------------------------------------

/** Convex hull (counter-clockwise in +Y-down screen terms: the cross product positive) of points. */
function convexHull(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  upper.pop(); lower.pop();
  return lower.concat(upper);
}

/**
 * The hull round segment a-b at distance R: the convex hull of two octagons (inner radius R) on its
 * ends, so it holds every point within R of the segment and its edges run at 45° steps (plus the
 * segment's own direction).
 */
export function hullOf(a, b, R) {
  const k = R * OCT, pts = [];
  for (const c of sameAt(a, b) ? [a] : [a, b]) for (let i = 0; i < 8; i++) {
    const ang = Math.PI / 8 + (i * Math.PI) / 4;
    pts.push([c[0] + k * Math.cos(ang), c[1] + k * Math.sin(ang)]);
  }
  return convexHull(pts);
}

/** Is p inside polygon `poly` (even-odd), and further than `eps` from its edges? */
export function insidePoly(poly, p, eps = 1) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    const q = nearestOnSeg(p, a, b);
    if (Math.hypot(p[0] - q[0], p[1] - q[1]) <= eps) return false;
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/**
 * The outline round a group of pusher segments ([{ a, b }]) at distance R: the union of their
 * hulls, as rings of points (outer rings only: a pusher closing a loop leaves a hole, which a line
 * pushed from outside never reaches).
 */
export function groupHull(segs, R) {
  const CL = ClipperLib;
  const c = new CL.Clipper();
  for (const s of segs) c.AddPath(hullOf(s.a, s.b, R).map(([x, y]) => ({ X: Math.round(x), Y: Math.round(y) })), CL.PolyType.ptSubject, true);
  const out = new CL.Paths();
  c.Execute(CL.ClipType.ctUnion, out, CL.PolyFillType.pftNonZero, CL.PolyFillType.pftNonZero);
  const rings = out.filter((r) => CL.Clipper.Orientation(r)).map((r) => r.map((q) => [q.X, q.Y]));
  return rings.length ? rings : out.map((r) => r.map((q) => [q.X, q.Y]));
}

/** Where segment p-q crosses segment a-b: { s (along p-q), t (along a-b) } or null. */
function segCross(p, q, a, b) {
  const rx = q[0] - p[0], ry = q[1] - p[1], sx = b[0] - a[0], sy = b[1] - a[1];
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-9) return null;
  const s = ((a[0] - p[0]) * sy - (a[1] - p[1]) * sx) / den;
  const t = ((a[0] - p[0]) * ry - (a[1] - p[1]) * rx) / den;
  return s >= 0 && s <= 1 && t >= 0 && t <= 1 ? { s, t } : null;
}

/** The point of segment a-b nearest to p. */
function nearestOnSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)) : 0;
  return [a[0] + t * dx, a[1] + t * dy];
}

const centroid = (pts) => { let x = 0, y = 0; for (const p of pts) { x += p[0]; y += p[1]; } return [x / pts.length, y / pts.length]; };
const pathLength = (pts) => { let s = 0; for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return s; };

/**
 * A line's points tidied: whole nanometres, no repeats, no points in the middle of a straight run,
 * no spikes folding back, no pieces shorter than `tiny`. Its two ends never change.
 */
export function tidy(pts, tiny = 100) {
  let p = pts.map((q) => [Math.round(q[0]), Math.round(q[1])]);
  for (let pass = 0; pass < 8; pass++) {
    const out = [p[0]];
    for (let i = 1; i < p.length; i++) {
      const q = p[i], last = out[out.length - 1];
      if (i < p.length - 1 && Math.hypot(q[0] - last[0], q[1] - last[1]) < tiny) continue;
      if (sameAt(q, last)) continue;
      out.push(q);
    }
    if (out.length > 1 && !sameAt(out[out.length - 1], p[p.length - 1])) out.push(p[p.length - 1]);
    // collinear middles (a straight run, or one folding back on itself)
    const st = [out[0]];
    for (let i = 1; i < out.length - 1; i++) {
      const a = st[st.length - 1], b = out[i], c = out[i + 1];
      const cr = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (Math.abs(cr) <= Math.hypot(c[0] - a[0], c[1] - a[1]) * 2) continue;
      st.push(b);
    }
    st.push(out[out.length - 1]);
    const same = st.length === p.length && st.every((q, i) => sameAt(q, p[i]));
    p = st;
    if (same) break;
  }
  return p;
}

/**
 * Line `pts` walked round polygon `ring`: the stretch from where it first enters to where it last
 * leaves replaced by the ring's outline, on the side `choose` picks from the two ({ fwd, back,
 * inside: the old stretch }). Returns { pts, old, path }, null when the line doesn't cross the ring,
 * 'joint' when an end of it lies inside (it can't move), or 'blocked' when `choose` takes neither.
 */
export function walkHull(pts, ring, choose) {
  if (insidePoly(ring, pts[0]) || insidePoly(ring, pts[pts.length - 1])) return 'joint';
  const n = ring.length;
  const hits = []; // { u: position along the line, at, h: position round the ring }
  for (let i = 1; i < pts.length; i++) {
    for (let j = 0; j < n; j++) {
      const x = segCross(pts[i - 1], pts[i], ring[j], ring[(j + 1) % n]);
      if (!x) continue;
      hits.push({ u: i - 1 + x.s, i, at: [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * x.s, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * x.s], h: j + x.t });
    }
  }
  if (hits.length < 2) return null;
  hits.sort((p, q) => p.u - q.u);
  const E = hits[0], X = hits[hits.length - 1];
  if (X.u - E.u < 1e-9) return null;
  // round the ring forwards (the way its points go) and backwards from E to X
  const fwd = [E.at], back = [E.at];
  const xf = X.h <= E.h ? X.h + n : X.h, xb = X.h >= E.h ? X.h - n : X.h;
  for (let k = Math.floor(E.h) + 1; k <= xf && k <= Math.floor(E.h) + n; k++) fwd.push(ring[k % n]);
  fwd.push(X.at);
  for (let k = Number.isInteger(E.h) ? E.h - 1 : Math.floor(E.h); k > xb && k > E.h - n; k--) back.push(ring[((k % n) + n) % n]);
  back.push(X.at);
  const inside = [E.at, ...pts.slice(E.i, X.i), X.at];
  const path = choose(fwd, back, inside);
  if (!path) return 'blocked';
  return { pts: [...pts.slice(0, E.i), ...path, ...pts.slice(X.i)], old: inside, path };
}

/**
 * Which way round a pusher's outline a line goes, for walkHull: `segs` the pusher's centre line
 * pieces, `dir` the way its push travels. A line that doesn't cross the pusher goes round on its own
 * side (the way whose loop with the old stretch holds none of the pusher); one the pusher pierces
 * (a route's head driven into it) goes the way the push travels, else the shorter way.
 */
export function sideChooser(segs, dir, anchors = []) {
  return (fwd0, back0, inside) => {
    // never round an anchored end of the pusher (a joint, or where a route or drag is tied on):
    // the line would have to cross what it's tied to
    const rounds = (path) => { const loop = [...path, ...inside.slice().reverse()]; return anchors.some((q) => insidePoly(loop, q, 0)); };
    const okF = !rounds(fwd0), okB = !rounds(back0);
    if (!okF && !okB) return null;
    if (okF !== okB) return okF ? fwd0 : back0;
    const fwd = fwd0, back = back0;
    let crossed = false;
    for (let i = 1; i < inside.length && !crossed; i++) for (const s of segs) if (segCross(inside[i - 1], inside[i], s.a, s.b)) { crossed = true; break; }
    if (!crossed) {
      const probes = [];
      for (const s of segs) { probes.push(s.a, s.b, [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2]); }
      const inLoop = (path) => { const loop = [...path, ...inside.slice().reverse()]; return probes.filter((q) => insidePoly(loop, q, 0)).length; };
      const nf = inLoop(fwd), nb = inLoop(back);
      if (nf !== nb) return nf < nb ? fwd : back;
    }
    if (dir) {
      const ci = centroid(inside), cf = centroid(fwd), cb = centroid(back);
      const sf = (cf[0] - ci[0]) * dir[0] + (cf[1] - ci[1]) * dir[1], sb = (cb[0] - ci[0]) * dir[0] + (cb[1] - ci[1]) * dir[1];
      if (Math.abs(sf - sb) > 1) return sf > sb ? fwd : back;
    }
    return pathLength(fwd) <= pathLength(back) ? fwd : back;
  };
}

/**
 * Where Via `v` goes to be `need` clear of pusher `p` (edge to edge): straight away from the
 * pusher's nearest point, along the nearest of the eight 45° directions, as little as it takes.
 */
export function viaMove(v, p, need) {
  const q = nearestOnSeg(v.at, p.a, p.b);
  let dx = v.at[0] - q[0], dy = v.at[1] - q[1];
  if (p.dir && dx * p.dir[0] + dy * p.dir[1] < 0 && Math.hypot(dx, dy) < (p.r + v.diameter / 2)) { dx = p.dir[0]; dy = p.dir[1]; }
  if (!dx && !dy) { dx = p.dir ? p.dir[0] : -(p.b[1] - p.a[1]); dy = p.dir ? p.dir[1] : p.b[0] - p.a[0]; if (!dx && !dy) dx = 1; } // dead centre
  const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  const ux = Math.cos(ang), uy = Math.sin(ang);
  const R = p.r + need + v.diameter / 2 + SLACK;
  const clear = (k) => { const c = [v.at[0] + ux * k, v.at[1] + uy * k], n = nearestOnSeg(c, p.a, p.b); return Math.hypot(c[0] - n[0], c[1] - n[1]) >= R; };
  let hi = R * 2 + Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1]);
  if (!clear(hi)) return null;
  let lo = 0;
  for (let i = 0; i < 40 && hi - lo > 100; i++) { const m = (lo + hi) / 2; if (clear(m)) hi = m; else lo = m; }
  return [Math.round(v.at[0] + ux * hi), Math.round(v.at[1] + uy * hi)];
}

/** The ways from a to b in one or two pieces at 45° steps (one when a-b is itself at 45°). */
export function elbows(a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], ax = Math.abs(dx), ay = Math.abs(dy), sx = Math.sign(dx), sy = Math.sign(dy);
  if (!ax || !ay || ax === ay) return [[a, b]];
  const d = Math.min(ax, ay), st = ax > ay ? [sx * (ax - ay), 0] : [0, sy * (ay - ax)];
  return [[a, [a[0] + st[0], a[1] + st[1]], b], [a, [a[0] + sx * d, a[1] + sy * d], b]];
}

/**
 * Line `pts` straightened: a stretch replaced by one or two 45° pieces (elbows) when that's fewer
 * pieces, no longer, and `clear(path)` says it's clear of other copper. Its ends stay put.
 */
export function smooth(pts, clear, maxPasses = 40) {
  let p = pts;
  for (let pass = 0; pass < maxPasses; pass++) {
    let done = false;
    for (let i = 0; i < p.length - 2 && !done; i++) {
      for (let j = p.length - 1; j > i + 1 && !done; j--) {
        const old = p.slice(i, j + 1), len = pathLength(old);
        for (const cand of elbows(p[i], p[j])) {
          if (cand.length >= old.length || pathLength(cand) > len + 1_000 || !clear(cand)) continue;
          p = [...p.slice(0, i), ...cand, ...p.slice(j + 1)];
          done = true;
          break;
        }
      }
    }
    if (!done) break;
  }
  return p;
}

// ---- lines ----------------------------------------------------------------------------------

/**
 * The Board's Tracks as lines: [{ id, net, layer, width, pts, ids (its Tracks, in order), base (a
 * Track to copy), fixed (it can't move: locked or arc) }], cut at every joint. `jointAt(layer, p)`
 * says where a pad or Via makes a joint.
 */
export function linesOf(tracks, jointAt) {
  const ends = new Map();
  for (const t of tracks) for (const p of [t.a, t.b]) { const k = keyOf(t.layer, p); if (!ends.has(k)) ends.set(k, []); ends.get(k).push(t); }
  const isJoint = (t, p) => {
    const here = ends.get(keyOf(t.layer, p));
    if (here.length !== 2) return true;
    const [u, w] = here;
    if (u === w || low(u.net) !== low(w.net) || u.width !== w.width) return true;
    return jointAt(t.layer, p);
  };
  const used = new Set(), lines = [];
  const walk = (start, from) => {
    const ids = [], pts = [from], segs = [];
    let t = start, p = from;
    for (;;) {
      used.add(t); segs.push(t); ids.push(t.id);
      const q = sameAt(t.a, p) ? t.b : t.a;
      pts.push(q);
      if (isJoint(t, q)) break;
      const nx = ends.get(keyOf(t.layer, q)).find((u) => u !== t);
      if (!nx || used.has(nx)) break;
      t = nx; p = q;
    }
    const fixed = segs.some((s) => s.locked || s.mid);
    lines.push({ id: ids[0], net: start.net, layer: start.layer, width: start.width, pts, orig: pts.slice(), ids, segs, base: start, fixed });
  };
  for (const t of tracks) if (!used.has(t)) { if (isJoint(t, t.a)) walk(t, t.a); else if (isJoint(t, t.b)) walk(t, t.b); }
  for (const t of tracks) if (!used.has(t)) walk(t, t.a); // closed loops
  return lines;
}

const lineSegs = (L) => { const out = []; for (let i = 1; i < L.pts.length; i++) out.push([L.pts[i - 1], L.pts[i]]); return out; };
const lineBox = (L) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of L.pts) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
  const w = L.width / 2;
  return { x0: x0 - w, y0: y0 - w, x1: x1 + w, y1: y1 + w };
};
/** The shortest distance between line L's copper and capsule `c` (edge to edge). */
const lineDistance = (L, c) => {
  if (L.pts.length < 2) return Infinity;
  let d = Infinity;
  for (const [a, b] of lineSegs(L)) d = Math.min(d, shapeDistance(c, { type: 'capsule', a, b, r: L.width / 2 }));
  return d;
};

// ---- the shove ------------------------------------------------------------------------------

/**
 * Shove other Nets' Tracks and Vias out of the way of `pushers` (the new copper: [{ a, b, r,
 * layers, net, kind: 'track' | 'via', dir? (the way the push travels: a drag's or a route head's
 * direction), tip? (its `b` is a route's free tip, which pushed lines may go round; the new copper's
 * other ends are tied, and they never do) }]). `board` is the Board as it was; `fixed` the copper index items that never move
 * (pads and drawings: see fixedItems); `locked`, more Track and Via ids that mustn't move. Returns
 * { ok, tracks, vias (the Board's, pushed), moved (ids of the Tracks that moved), movedVias } or
 * { ok: false, reason }. `before`: the Tracks before a stepped push began (dragResult), so tidying
 * keeps to what the whole push changed.
 */
export function shove(board, pushers, { fixed = [], locked = new Set(), copper = null, before = null } = {}) {
  const viaLayers = new Set(copper || (board.stack?.copper === 4 ? ['F.Cu', 'In1.Cu', 'In2.Cu', 'B.Cu'] : ['F.Cu', 'B.Cu']));
  const vias = (board.vias || []).map((v) => ({ ...v }));
  const srcTracks = board.tracks || [];
  const pads = fixed.filter((it) => it.kind === 'pad');
  const padAt = (layer, p) => pads.some((it) => it.layers.has(layer) && shapeDistance({ type: 'capsule', a: p, b: p, r: 0 }, it.shape) <= 0);
  const viaKeys = new Set(vias.map((v) => `${v.at[0]},${v.at[1]}`));
  const lines = linesOf(srcTracks, (layer, p) => viaKeys.has(`${p[0]},${p[1]}`) || padAt(layer, p));
  for (const L of lines) if (L.ids.some((id) => locked.has(id))) L.fixed = true;
  // `before`: the Tracks as they were when a stepped drag began, which tidying keeps to
  if (before) {
    const was = new Map(linesOf(before, () => false).map((L) => [L.id, L.pts]));
    for (const L of lines) if (was.has(L.id)) L.orig = was.get(L.id);
  }

  // where each line's ends meet a Via, so a moved Via takes them with it
  const heads = pushers.map((p) => ({ ...p, layers: new Set(p.layers), owner: 'head' }));
  const anc = new Map(); // owner -> the owners that pushed it (directly or not)
  const pushesOf = new Map();
  const movedLines = new Set(), movedVias = new Set();
  const dirOf = new Map(); // owner -> the way it was pushed
  let pushes = 0;

  // clearances by net pair, and each line's box, worked out once
  const needs = new Map();
  const needOf = (pn, tn, pk, tk) => { const k = `${low(pn)}|${low(tn)}|${pk}|${tk}`; let v = needs.get(k); if (v === undefined) { v = clearanceBetween(board, pn, tn, pk, tk); needs.set(k, v); } return v; };
  for (const L of lines) { L.box = lineBox(L); L.lnet = low(L.net); }
  for (const v of vias) v.lnet = low(v.net);
  const reach = maxClearance(board); // no two items further apart than this can clash
  const setPts = (L, pts) => { L.pts = pts; L.box = lineBox(L); };

  // the pushers now, by owner: the new copper ('head'), every moved line's segments and every
  // moved Via; `rank` is the order they began pushing in, which is the order they push in
  const segsBy = new Map([['head', heads]]);
  const rank = new Map([['head', 0]]);
  const ownerSegs = (id) => {
    const L = lines.find((x) => x.id === id);
    if (L) return lineSegs(L).map(([a, b]) => ({ a, b, r: L.width / 2, layers: new Set([L.layer]), net: L.net, kind: 'track', owner: L.id, dir: dirOf.get(L.id), line: L }));
    const v = vias.find((x) => x.id === id);
    return [{ a: v.at, b: v.at, r: v.diameter / 2, layers: viaLayers, net: v.net, kind: 'via', owner: v.id, dir: dirOf.get(v.id), via: v }];
  };
  const active = () => [...segsBy.values()].flat();
  const isAnc = (owner, id) => owner === id || !!anc.get(owner)?.has(id);
  const pushedBy = (id, owner, dir) => {
    const s = anc.get(id) || new Set();
    s.add(owner); for (const x of anc.get(owner) || []) s.add(x);
    anc.set(id, s);
    if (dir && !dirOf.has(id)) dirOf.set(id, dir);
  };

  // what crowds what: { p (a pusher segment), i (its index), L or v (what it crowds), d, need }
  let clashes = [];
  const check = (p, i, T) => {
    const pc = p.cap ||= { type: 'capsule', a: p.a, b: p.b, r: p.r };
    p.lnet ??= low(p.net);
    if (T.pts) {
      const L = T;
      if (L === p.line || !p.layers.has(L.layer) || (p.net && L.lnet === p.lnet)) return;
      if (!boxesMeet(p.box ||= shapeBox(pc), L.box, reach) || isAnc(p.owner, L.id)) return;
      const need = needOf(p.net, L.net, p.kind, 'track');
      if (!boxesMeet(p.box, L.box, need)) return;
      const d = lineDistance(L, pc);
      if (d < need) clashes.push({ p, i, L, d, need });
      return;
    }
    const v = T;
    if (v === p.via || (p.net && v.lnet === p.lnet)) return;
    const vc = { type: 'capsule', a: v.at, b: v.at, r: v.diameter / 2 };
    if (!boxesMeet(p.box ||= shapeBox(pc), shapeBox(vc), reach) || isAnc(p.owner, v.id) || ![...p.layers].some((l) => viaLayers.has(l))) return;
    const need = needOf(p.net, v.net, p.kind, 'via');
    if (!boxesMeet(p.box ||= shapeBox(pc), shapeBox(vc), need)) return;
    const d = shapeDistance(pc, vc);
    if (d < need) clashes.push({ p, i, v, d, need });
  };
  const scanPusher = (segs) => segs.forEach((p, i) => { for (const L of lines) check(p, i, L); for (const v of vias) check(p, i, v); });
  /** Owner `id` (a line or Via) changed: its old clashes go, and both what it now pushes and what now pushes it are found. */
  const changedOwner = (id) => {
    clashes = clashes.filter((c) => c.p.owner !== id && (c.L ? c.L.id : c.v.id) !== id);
    if (!rank.has(id)) rank.set(id, rank.size);
    const segs = ownerSegs(id);
    segsBy.set(id, segs);
    scanPusher(segs);
    const T = lines.find((x) => x.id === id) || vias.find((x) => x.id === id);
    for (const [o, ss] of segsBy) if (o !== id) ss.forEach((p, i) => check(p, i, T));
  };

  /** Push line L clear of pusher p (it crowds it by `need`): true, or a reason it can't. */
  const pushLine = (L, p, need) => {
    if (L.fixed) return L.segs.some((s) => s.mid) && !L.segs.some((s) => s.locked || locked.has(s.id)) ? 'arc' : 'locked';
    const n = (pushesOf.get(L.id) || 0) + 1;
    if (n > MAX_PER_LINE) return 'loop';
    if (++pushes > MAX_PUSHES) return 'too many pushes';
    pushesOf.set(L.id, n);
    // the whole pusher (all its pieces on this layer) at once: the union of their hulls
    const group = segsBy.get(p.owner).filter((q) => q.layers.has(L.layer));
    const R = Math.max(...group.map((q) => q.r)) + need + L.width / 2 + SLACK;
    const rings = groupHull(group, R);
    const dir = group.find((q) => q.dir)?.dir || null;
    // the pusher's tied ends: a pushing line's two joints; the new copper's ends but a route's tip
    const count = new Map();
    for (const q of group) if (!sameAt(q.a, q.b)) for (const e of [q.a, q.b]) { const k = `${e[0]},${e[1]}`; count.set(k, (count.get(k) || 0) + 1); }
    const tips = new Set(group.filter((q) => q.tip).map((q) => `${q.b[0]},${q.b[1]}`));
    const anchors = p.line ? [p.line.pts[0], p.line.pts[p.line.pts.length - 1]] : [...count].filter(([k, c]) => c === 1 && !tips.has(k)).map(([k]) => k.split(',').map(Number));
    const choose = sideChooser(group, dir, anchors);
    let pts = L.pts, old = null, path = null;
    for (let k = 0; k < 2 * rings.length; k++) {
      let any = false;
      for (const ring of rings) {
        const w = walkHull(pts, ring, choose);
        if (w === 'joint') return 'no room';
        if (w === 'blocked') return 'no room';
        if (!w) continue;
        pts = tidy(w.pts); any = true;
        if (!old) { old = w.old; path = w.path; }
      }
      if (!any) break;
    }
    if (!old) return 'no room';
    // the way it went, for the lines it pushes in turn
    const co = centroid(old), cn = centroid(path);
    const dl = Math.hypot(cn[0] - co[0], cn[1] - co[1]);
    setPts(L, pts);
    pushedBy(L.id, p.owner, dl ? [(cn[0] - co[0]) / dl, (cn[1] - co[1]) / dl] : p.dir);
    movedLines.add(L);
    changedOwner(L.id);
    return true;
  };

  /** Move Via v clear of pusher p, its lines' ends going with it: true or a reason. */
  const pushVia = (v, p, need) => {
    if (v.locked || locked.has(v.id)) return 'locked';
    const n = (pushesOf.get(v.id) || 0) + 1;
    if (n > MAX_PER_LINE || ++pushes > MAX_PUSHES) return 'loop';
    pushesOf.set(v.id, n);
    const to = viaMove(v, p, need);
    if (!to) return 'no room';
    const from = v.at, ends = [];
    for (const L of lines) {
      if (low(L.net) !== low(v.net)) continue;
      const a = sameAt(L.pts[0], from), b = sameAt(L.pts[L.pts.length - 1], from);
      if (!a && !b) continue;
      if (L.fixed) return L.segs.some((s) => s.mid) ? 'arc' : 'locked';
      if (a) L.pts[0] = to;
      if (b) L.pts[L.pts.length - 1] = to;
      setPts(L, tidy(L.pts));
      movedLines.add(L);
      pushedBy(L.id, v.id, null);
      ends.push(L.id);
    }
    const dl = Math.hypot(to[0] - from[0], to[1] - from[1]);
    pushedBy(v.id, p.owner, dl ? [(to[0] - from[0]) / dl, (to[1] - from[1]) / dl] : null);
    v.at = to;
    movedVias.add(v.id);
    changedOwner(v.id);
    for (const id of ends) changedOwner(id);
    return true;
  };

  scanPusher(heads);
  while (clashes.length) {
    // the first pusher (in the order they began pushing) pushes the nearest thing it crowds: the
    // ones beyond are then pushed by that one
    let best = clashes[0];
    for (const c of clashes) {
      const rc = rank.get(c.p.owner), rb = rank.get(best.p.owner);
      if (rc < rb || (rc === rb && (c.i < best.i || (c.i === best.i && c.d < best.d)))) best = c;
    }
    const res = best.L ? pushLine(best.L, best.p, best.need) : pushVia(best.v, best.p, best.need);
    if (res !== true) return { ok: false, reason: res };
  }

  // tidy the pushed lines (as KiCad's optimiser): a stretch that can be one or two 45° pieces,
  // no longer than it was and clear of everything, becomes that
  const edges0 = outlineSegments(board.outline || []), edgeGap = board.rules?.edgeClearance || 0;
  const clearPath = (cand, L) => {
    for (let i = 1; i < cand.length; i++) {
      const c = { type: 'capsule', a: cand[i - 1], b: cand[i], r: L.width / 2 }, b = shapeBox(c);
      for (const M of lines) {
        if (M === L || M.layer !== L.layer || low(M.net) === low(L.net)) continue;
        const need = clearanceBetween(board, L.net, M.net, 'track', 'track');
        if (boxesMeet(b, lineBox(M), need) && lineDistance(M, c) < need) return false;
      }
      for (const p of heads) {
        if (!p.layers.has(L.layer) || (p.net && low(p.net) === low(L.net))) continue;
        if (shapeDistance(c, { type: 'capsule', a: p.a, b: p.b, r: p.r }) < clearanceBetween(board, p.net, L.net, p.kind, 'track')) return false;
      }
      for (const v of vias) {
        if (low(v.net) === low(L.net)) continue;
        if (shapeDistance(c, { type: 'capsule', a: v.at, b: v.at, r: v.diameter / 2 }) < clearanceBetween(board, L.net, v.net, 'track', 'via')) return false;
      }
      for (const it of fixed) {
        if (!it.layers.has(L.layer) || (it.net && low(it.net) === low(L.net))) continue;
        const need = clearanceBetween(board, L.net, it.net, 'track', pairKind(it));
        if (boxesMeet(b, it.box || shapeBox(it.shape), need) && shapeDistance(c, it.shape) < need) return false;
      }
      for (const [a, e] of edges0) if (shapeDistance(c, { type: 'capsule', a, b: e, r: 0 }) < edgeGap) return false;
    }
    return true;
  };
  // every line the push has moved (since a stepped drag began, too), over again while any changes:
  // an outer line straightened makes room for the next one in
  const tidyLines = lines.filter((L) => movedLines.has(L) || (L.orig !== L.pts && (L.orig.length !== L.pts.length || L.orig.some((q, i) => !sameAt(q, L.pts[i])))));
  for (let pass = 0; pass < 4; pass++) {
  let anyTidied = false;
  for (const L of tidyLines) {
    // only within the stretch the push changed (its box), so the rest of the line stays where it was
    // (grown by how far the push took it, so a corner can straighten back onto the line it left)
    const offBy = (q) => { let d = Infinity; for (let i = 1; i < L.orig.length; i++) { const n = nearestOnSeg(q, L.orig[i - 1], L.orig[i]); d = Math.min(d, Math.hypot(q[0] - n[0], q[1] - n[1])); } return d; };
    const keep = new Set();
    let grow = 0;
    L.pts.forEach((q, i) => { const d = offBy(q); if (d > 10) { keep.add(i - 1); keep.add(i); keep.add(i + 1); grow = Math.max(grow, d); } });
    const ins = [...keep].filter((i) => i >= 0 && i < L.pts.length).map((i) => L.pts[i]);
    if (!ins.length) continue;
    grow = Math.max(2 * grow, 2 * (L.width + reach));
    const bx = { x0: Math.min(...ins.map((q) => q[0])), y0: Math.min(...ins.map((q) => q[1])), x1: Math.max(...ins.map((q) => q[0])), y1: Math.max(...ins.map((q) => q[1])) };
    const inBox = (q) => q[0] >= bx.x0 - grow - 1 && q[0] <= bx.x1 + grow + 1 && q[1] >= bx.y0 - grow - 1 && q[1] <= bx.y1 + grow + 1;
    const was = L.pts;
    L.pts = tidy(smooth(L.pts, (cand) => cand.every(inBox) && clearPath(cand, L)));
    if (L.pts.length === was.length && L.pts.every((q, i) => sameAt(q, was[i]))) L.pts = was;
    if (L.pts !== was) { anyTidied = true; movedLines.add(L); }
  }
  if (!anyTidied) break;
  }

  // the Board's Tracks: moved lines rebuilt from their points, keeping their Tracks' ids
  const moved = new Set();
  const replaced = new Map();
  for (const L of movedLines) {
    const segs = [];
    for (let i = 1; i < L.pts.length; i++) {
      const src = L.segs[Math.min(i - 1, L.segs.length - 1)];
      segs.push({ ...L.base, ...src, id: i - 1 < L.ids.length ? L.ids[i - 1] : uid('t'), a: L.pts[i - 1], b: L.pts[i] });
    }
    for (const s of segs) delete s.mid;
    replaced.set(L.segs[0], segs);
    for (const s of L.segs.slice(1)) replaced.set(s, []);
    for (const id of L.ids) moved.add(id);
  }
  const tracks = [];
  const boxes = new WeakMap(), boxOf = (u) => { let x = boxes.get(u); if (!x) { x = shapeBox(cap(u)); boxes.set(u, x); } return x; };
  for (const t of srcTracks) { const r = replaced.get(t); if (r) tracks.push(...r); else tracks.push({ ...t }); }

  // what moved must be clear of everything now: what can't move, the new copper, the other
  // Tracks and Vias, and the board's edge
  const movedIds = new Set();
  for (const L of movedLines) for (const s of replaced.get(L.segs[0])) movedIds.add(s.id);
  const pushed = tracks.filter((t) => movedIds.has(t.id));
  const edge = board.rules?.edgeClearance || 0;
  const edges = outlineSegments(board.outline || []);
  for (const t of pushed) {
    const c = cap(t), b = shapeBox(c);
    for (const it of fixed) {
      if (!it.layers.has(t.layer) || (it.net && low(it.net) === low(t.net))) continue;
      const need = clearanceBetween(board, t.net, it.net, 'track', pairKind(it));
      if (boxesMeet(b, it.box || shapeBox(it.shape), need) && shapeDistance(c, it.shape) < need) return { ok: false, reason: 'fixed', at: it.id };
    }
    for (const p of heads) {
      if (!p.layers.has(t.layer) || (p.net && low(p.net) === low(t.net))) continue;
      if (shapeDistance(c, { type: 'capsule', a: p.a, b: p.b, r: p.r }) < clearanceBetween(board, p.net, t.net, p.kind, 'track') - 1) return { ok: false, reason: 'pusher' };
    }
    for (const u of tracks) {
      if (u === t || u.layer !== t.layer || low(u.net) === low(t.net)) continue;
      if (!boxesMeet(b, boxOf(u), reach)) continue;
      if (shapeDistance(c, cap(u)) < needOf(t.net, u.net, 'track', 'track') - 1) return { ok: false, reason: 'tracks' };
    }
    for (const v of vias) {
      if (low(v.net) === low(t.net)) continue;
      if (shapeDistance(c, { type: 'capsule', a: v.at, b: v.at, r: v.diameter / 2 }) < clearanceBetween(board, t.net, v.net, 'track', 'via') - 1) return { ok: false, reason: 'vias' };
    }
    for (const [a, e] of edges) if (shapeDistance(c, { type: 'capsule', a, b: e, r: 0 }) < edge) return { ok: false, reason: 'edge' };
  }
  for (const v of vias) {
    if (!movedVias.has(v.id)) continue;
    const c = { type: 'capsule', a: v.at, b: v.at, r: v.diameter / 2 }, b = shapeBox(c);
    for (const it of fixed) {
      if (it.net && low(it.net) === low(v.net)) continue;
      const need = clearanceBetween(board, v.net, it.net, 'via', pairKind(it));
      if (boxesMeet(b, it.box || shapeBox(it.shape), need) && shapeDistance(c, it.shape) < need) return { ok: false, reason: 'fixed', at: it.id };
    }
    for (const p of heads) {
      if (p.net && low(p.net) === low(v.net)) continue;
      if (shapeDistance(c, { type: 'capsule', a: p.a, b: p.b, r: p.r }) < clearanceBetween(board, p.net, v.net, p.kind, 'via') - 1) return { ok: false, reason: 'pusher' };
    }
    for (const u of vias) {
      if (u === v || low(u.net) === low(v.net)) continue;
      if (shapeDistance(c, { type: 'capsule', a: u.at, b: u.at, r: u.diameter / 2 }) < clearanceBetween(board, v.net, u.net, 'via', 'via') - 1) return { ok: false, reason: 'vias' };
    }
    for (const u of tracks) {
      if (low(u.net) === low(v.net) || !boxesMeet(b, boxOf(u), reach)) continue;
      if (shapeDistance(c, cap(u)) < needOf(v.net, u.net, 'via', 'track') - 1) return { ok: false, reason: 'tracks' };
    }
    for (const [a, e] of edges) if (shapeDistance(c, { type: 'capsule', a, b: e, r: 0 }) < edge) return { ok: false, reason: 'edge' };
  }
  return { ok: true, tracks, vias, moved, movedVias };
}

/** The copper that never moves in a shove: the index's items other than Tracks and Vias (pads, drawings). */
export const fixedItems = (index) => index.items.filter((it) => it.kind !== 'track' && it.kind !== 'via');
