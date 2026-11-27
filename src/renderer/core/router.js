// The router (#20), with the step-wise interface ADR-0006 asks for:
//   step(project, state, cursor, mode) -> { segments, collisions, state }   the proposed copper
//   click(project, state, point)        -> new state (a corner fixed)
//   commit(project, state)              -> the Tracks added to the Board
// Free mode draws what the corner style says and only reports collisions; Walkaround (#22) detours
// the tentative run round other Nets' copper (core/walkaround.js); Shove (#29) pushes other Nets'
// Tracks aside (core/shove.js) and proposes them, moved, as `shoved`; when it can't, it falls back
// to walking round. DOM-free.
//
// state: { net, layer, width, points: [start, corner…], bend: Eagle style (BENDS) or null, corner: '90' | '45' | 'any', posture: 'a' | 'b',
//          chamfer: nm,  Eagle-style mitre length (0: none); mitre: 'straight' (cut off every bend of
//          90° or sharper) | 'round' (every bend an arc of that radius, #95)
//          runs: [{ layer, points }],  the runs already finished on other layers (#21)
//          vias: [{ at }],  where they change layer
//          pair: [layerA, layerB], via: { drill, diameter },
//          joins: [{ id, at }]  Tracks it starts or finishes part-way along (split on commit, #89) }
import { uid } from './project.js';
import { netRules } from './collision.js';
import { Obstacles, walkPath } from './walkaround.js';
import { shove, fixedItems } from './shove.js';
import { copperLayerNames } from './board.js';
import { splitTrackAt } from './routeEnds.js';
import { trackShape, trackPoints } from './trackGeom.js';

/**
 * A corner point reached by an arc (#94): the point, carrying the arc's middle as `mid`. The
 * segment from the point before to it is that arc. Plain [x, y] everywhere else.
 */
const arcTo = (p, mid, w = p.w) => Object.assign([p[0], p[1]], { mid }, w ? { w } : {});
/** A corner point carrying the width `w` of the leg that ends at it (R4); plain where it has none. */
const withW = (p, w) => (w ? Object.assign([p[0], p[1]], p.mid ? { mid: p.mid } : {}, { w }) : p);
/**
 * A route's points as segments { a, b, mid?, width }: an arc where the point reached carries
 * `mid`, the width that point carries (else `width`, the route's current one, for the leg to
 * the pointer).
 */
const segOf = (a, b, width) => ({ a: [a[0], a[1]], b: [b[0], b[1]], ...(b.mid ? { mid: b.mid } : {}), width: b.w || width });

export const ROUTE_MODES = [['shove', 'Shove'], ['walkaround', 'Walkaround'], ['free', 'Free']];

export const CORNERS = [['90', '90°'], ['45', '45°'], ['any', 'Any']];

/**
 * Eagle's wire-bend styles (#91), each a corner style and posture: 0 horizontal then vertical,
 * 1 horizontal then 45°, 2 straight, 3 45° then horizontal, 4 vertical then horizontal,
 * 5 arc then horizontal, 6 horizontal then arc (#94: a quarter circle tangent to the straight),
 * 7 freehand (#92: the track follows the pointer's path, `stroke`).
 * "Horizontal" for the 45° styles is the way's major axis. `mirror` is what / swaps to.
 */
export const BENDS = [
  { id: 0, corner: '90', posture: 'a', mirror: 4, name: 'horizontal then vertical' },
  { id: 1, corner: '45', posture: 'a', mirror: 3, name: 'horizontal then 45°' },
  { id: 2, corner: 'any', posture: 'a', mirror: 2, name: 'straight, any angle' },
  { id: 3, corner: '45', posture: 'b', mirror: 1, name: '45° then horizontal' },
  { id: 4, corner: '90', posture: 'b', mirror: 0, name: 'vertical then horizontal' },
  { id: 5, corner: 'arc', posture: 'a', mirror: 6, name: 'arc then horizontal' },
  { id: 6, corner: 'arc', posture: 'b', mirror: 5, name: 'horizontal then arc' },
  { id: 7, corner: 'free', posture: 'a', mirror: 7, name: 'freehand' },
];
export const bendOf = (id) => BENDS.find((b) => b.id === id) || BENDS[1];

/** A saved bend preference: a style number, or an old corner setting ('90', '45', 'any'). */
export function bendFromPref(v) {
  if (typeof v === 'number' && BENDS.some((b) => b.id === v)) return v;
  return { 90: 0, 45: 1, any: 2 }[v] ?? 1;
}

/** The next (or, with `dir` -1, previous) bend style: Eagle's right-click cycle. */
export function cycleBend(id, dir = 1) {
  const i = BENDS.findIndex((b) => b.id === id);
  return BENDS[(((i < 0 ? 1 : i) + dir) % BENDS.length + BENDS.length) % BENDS.length].id;
}

/**
 * Freehand (#92): the pointer moved to `p`. It's added to the stroke once `step` from its last
 * point; coming back within `step` of an earlier point takes the stroke back to there.
 */
export function strokeTo(state, p, step) {
  const stroke = state.stroke || [];
  const from = stroke.length ? stroke[stroke.length - 1] : state.points[state.points.length - 1];
  const s2 = step * step;
  const near = (q) => (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 < s2;
  if (near(state.points[state.points.length - 1])) return stroke.length ? { ...state, stroke: [] } : state;
  for (let i = 0; i < stroke.length - 1; i++) if (near(stroke[i])) return { ...state, stroke: stroke.slice(0, i + 1) };
  if (near(from)) return state;
  return { ...state, stroke: [...stroke, p] };
}

/** Ramer–Douglas–Peucker: the points of polyline `pts` that keep it within `tol` (ends kept). */
export function simplifyPath(pts, tol) {
  if (pts.length < 3) return pts.slice();
  const keep = new Array(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    const a = pts[i], b = pts[j], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
    let worst = -1, k = -1;
    for (let m = i + 1; m < j; m++) {
      const q = pts[m];
      const d = L ? Math.abs(dx * (q[1] - a[1]) - dy * (q[0] - a[0])) / L : Math.hypot(q[0] - a[0], q[1] - a[1]);
      if (d > worst) { worst = d; k = m; }
    }
    if (worst > tol) { keep[k] = true; stack.push([i, k], [k, j]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/** The route state's corner style and posture for bend style `id`. */
export const withBend = (state, id) => ({ ...state, bend: id, corner: bendOf(id).corner, posture: bendOf(id).posture });

/**
 * The corner points from `a` to `b` (not including a): one bend for 90° and 45° routing, none
 * for any-angle. Posture 'a' goes straight first (horizontal for 90°, along the major axis for
 * 45°), 'b' bends first.
 */
export function cornerPath(a, b, corner = '45', posture = 'a') {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  if (corner === 'any' || !dx || !dy) return [b];
  if (corner === 'arc') {
    // a quarter circle of radius min(|dx|, |dy|) tangent to a straight run along the major axis:
    // posture 'a' (bend 5) the arc first, 'b' (bend 6) the straight first
    const r = Math.min(Math.abs(dx), Math.abs(dy));
    const M = Math.abs(dx) >= Math.abs(dy) ? [Math.sign(dx), 0] : [0, Math.sign(dy)];
    const m = Math.abs(dx) >= Math.abs(dy) ? [0, Math.sign(dy)] : [Math.sign(dx), 0];
    const k = r * Math.SQRT1_2;
    if (posture === 'a') {
      const c = [a[0] + M[0] * r, a[1] + M[1] * r], e = [c[0] + m[0] * r, c[1] + m[1] * r];
      const mid = [Math.round(c[0] - M[0] * k + m[0] * k), Math.round(c[1] - M[1] * k + m[1] * k)];
      return e[0] === b[0] && e[1] === b[1] ? [arcTo(b, mid)] : [arcTo(e, mid), b];
    }
    const s0 = [b[0] - M[0] * r - m[0] * r, b[1] - M[1] * r - m[1] * r], c = [s0[0] + m[0] * r, s0[1] + m[1] * r];
    const mid = [Math.round(c[0] + M[0] * k - m[0] * k), Math.round(c[1] + M[1] * k - m[1] * k)];
    return s0[0] === a[0] && s0[1] === a[1] ? [arcTo(b, mid)] : [s0, arcTo(b, mid)];
  }
  if (corner === '90') return [posture === 'a' ? [b[0], a[1]] : [a[0], b[1]], b];
  const ax = Math.abs(dx), ay = Math.abs(dy), sx = Math.sign(dx), sy = Math.sign(dy);
  if (ax === ay) return [b];
  const diag = Math.min(ax, ay);
  const straight = ax > ay ? [sx * (ax - ay), 0] : [0, sy * (ay - ax)];
  const elbow = posture === 'a' ? [a[0] + straight[0], a[1] + straight[1]] : [a[0] + sx * diag, a[1] + sy * diag];
  return [elbow, b];
}

/**
 * How far a pad reaches from its centre along an axis direction `dir` ([±1, 0] or [0, ±1]): half
 * its size across that way. Null for a pad turned off the 90° steps (no square way out of it).
 */
export function padReach(pad, dir) {
  if (!pad?.size) return null;
  const rot = (((pad.rot || 0) % 360) + 360) % 360;
  if (Math.abs(rot - Math.round(rot / 90) * 90) > 0.01) return null;
  const [w, h] = Math.round(rot / 90) % 2 ? [pad.size[1], pad.size[0]] : pad.size;
  return dir[0] ? w / 2 : h / 2;
}

const unit = (v) => [Math.sign(v[0]), Math.sign(v[1])];
const major = (d) => (Math.abs(d[0]) >= Math.abs(d[1]) ? [Math.sign(d[0]), 0] : [0, Math.sign(d[1])]);
const minor = (d) => (Math.abs(d[0]) >= Math.abs(d[1]) ? [0, Math.sign(d[1])] : [Math.sign(d[0]), 0]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const along = (p, dir, n) => [Math.round(p[0] + dir[0] * n), Math.round(p[1] + dir[1] * n)];

/** Drop repeated points and the points in the middle of straight runs. */
function straighten(pts) {
  const out = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (q && q[0] === p[0] && q[1] === p[1]) continue;
    if (out.length >= 2) {
      const a = out[out.length - 2];
      const u = unit([q[0] - a[0], q[1] - a[1]]), v = unit([p[0] - q[0], p[1] - q[1]]);
      if ((q[0] - a[0]) * (p[1] - q[1]) === (q[1] - a[1]) * (p[0] - q[0]) && u[0] === v[0] && u[1] === v[1]) { out[out.length - 1] = p; continue; }
    }
    out.push(p);
  }
  return out;
}

/**
 * The corner points from `a` to `b` (not including a), as cornerPath, but leaving the pad `from`
 * (at a) and entering the pad `to` (at b) square to the pad, never at 45°: the run at a pad goes
 * straight along one of its axes past its edge (by `stand`, a track width, so the copper meets the
 * pad square) before it bends. Posture 'a' leaves along the way's major axis, 'b' along its minor
 * one. 90° and any-angle routing are left as they are.
 */
export function routePath(a, b, corner = '45', posture = 'a', from = null, to = null, stand = 0) {
  if (corner !== '45' || (!from && !to) || (a[0] === b[0] && a[1] === b[1])) return cornerPath(a, b, corner, posture);
  let s = a, t = b;
  if (from) {
    const d = [b[0] - a[0], b[1] - a[1]];
    const dir = posture === 'b' && (minor(d)[0] || minor(d)[1]) ? minor(d) : major(d);
    const r = padReach(from, dir);
    if (r != null) s = along(a, dir, r + stand);
  }
  if (to) {
    const dir = major([b[0] - s[0], b[1] - s[1]]);
    const r0 = padReach(to, [-dir[0], -dir[1]]), r = r0 == null ? null : r0 + stand;
    if (r != null && dot([b[0] - s[0], b[1] - s[1]], dir) > r) t = along(b, dir, -r);
  }
  return straighten([a, s, ...cornerPath(s, t, '45', s === a ? posture : 'a'), b]).slice(1);
}

/** Start routing from a pad's centre (or a point) on a layer, for a Net: width from its Net class. */
export function startRoute(project, at, layer, net, { bend = null, corner = '45', posture = 'a', chamfer = 0, mitre = 'straight', pair = null, pad = null } = {}) {
  const r = netRules(project.board, net);
  if (bend != null) ({ corner, posture } = bendOf(bend));
  return { bend, mitre, net, layer, width: r.trackWidth, points: [at], from: pad ? { size: pad.size, rot: pad.rot || 0 } : null, corner, posture, chamfer, runs: [], vias: [], pair: pair || defaultPair(project.board, layer), via: { drill: r.viaDrill, diameter: r.viaDiameter } };
}

/** The layer pairs a via can join while routing (through vias: any two copper layers). */
export function layerPairs(copper) {
  const ls = copper === 4 ? ['F.Cu', 'In1.Cu', 'In2.Cu', 'B.Cu'] : ['F.Cu', 'B.Cu'];
  const out = [];
  for (let i = 0; i < ls.length; i++) for (let j = i + 1; j < ls.length; j++) out.push([ls[i], ls[j]]);
  return out;
}
const defaultPair = (board, layer) => (layer === 'F.Cu' || layer === 'B.Cu' || board.stack.copper !== 4 ? ['F.Cu', 'B.Cu'] : ['In1.Cu', 'In2.Cu']);

/** The layer a via goes to from `layer`: the other one of the pair (or the pair's first). */
export const nextLayer = (pair, layer) => (layer === pair[0] ? pair[1] : layer === pair[1] ? pair[0] : pair[0]);

/**
 * V while routing: fix the track to `at`, drop a via there and carry on from it on the other
 * layer of the pair (or `to`).
 */
export function switchLayer(project, state, at, to = null, tail = null) {
  const s1 = click(project, state, at, tail);
  const end = s1.points[s1.points.length - 1];
  return { ...s1, runs: [...s1.runs, { layer: s1.layer, points: s1.points }], vias: [...s1.vias, { at: [end[0], end[1]] }], layer: to || nextLayer(s1.pair, s1.layer), points: [[end[0], end[1]]], stroke: [], stops: [], lead: null, forced: false };
}

/**
 * Chamfer the bends of a path (Eagle's negative mitre): each corner that turns 90° or more is cut
 * back by `length` along both of its segments (at most half of either) and joined with a straight
 * segment. The first and last points stay.
 */
export function chamferPath(pts, length) {
  if (!(length > 0) || pts.length < 3) return pts;
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i], a = pts[i - 1], b = pts[i + 1];
    if (p.mid || b.mid) { out.push(p); continue; } // an arc's end (#94): left as it is
    const u = [a[0] - p[0], a[1] - p[1]], v = [b[0] - p[0], b[1] - p[1]];
    const lu = Math.hypot(...u), lv = Math.hypot(...v);
    if (!lu || !lv) { out.push(p); continue; }
    const cos = (u[0] * v[0] + u[1] * v[1]) / (lu * lv); // the inside angle: 90° corner -> 0, sharper -> > 0
    if (cos < -1e-9) { out.push(p); continue; } // gentler than 90° (a 45° bend): left as it is
    const c = Math.min(length, lu / 2, lv / 2);
    out.push(withW([Math.round(p[0] + (u[0] / lu) * c), Math.round(p[1] + (u[1] / lu) * c)], p.w), withW([Math.round(p[0] + (v[0] / lv) * c), Math.round(p[1] + (v[1] / lv) * c)], b.w));
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/**
 * Round the bends of a path (#95, Eagle's positive mitre): each bend, of any angle, becomes an
 * arc of `radius` tangent to both segments, smaller where a segment is too short for it (it may
 * take at most half of either). The arc's end carries `mid` (see arcTo). The first and last
 * points stay; an arc's own ends are left as they are.
 */
export function roundPath(pts, radius) {
  if (!(radius > 0) || pts.length < 3) return pts;
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i], a = out[out.length - 1], b = pts[i + 1];
    if (p.mid || b.mid) { out.push(p); continue; }
    const u = [a[0] - p[0], a[1] - p[1]], v = [b[0] - p[0], b[1] - p[1]];
    const lu = Math.hypot(...u), lv = Math.hypot(...v);
    if (!lu || !lv) { out.push(p); continue; }
    const cos = Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / (lu * lv)));
    const phi = Math.acos(cos); // the inside angle: π in a straight line
    if (phi > Math.PI - 1e-6 || phi < 1e-6) { out.push(p); continue; }
    // the cut back along each segment for this radius: r / tan(φ/2), at most half of either
    const half = Math.tan(phi / 2);
    const cut = Math.min(radius / half, lu / 2, lv / 2);
    const r = cut * half;
    const uu = [u[0] / lu, u[1] / lu], vv = [v[0] / lv, v[1] / lv];
    const p1 = [Math.round(p[0] + uu[0] * cut), Math.round(p[1] + uu[1] * cut)];
    const p2 = [Math.round(p[0] + vv[0] * cut), Math.round(p[1] + vv[1] * cut)];
    // the arc's middle: along the bisector, r short of the centre (r / sin(φ/2) from p)
    const w = [uu[0] + vv[0], uu[1] + vv[1]], lw = Math.hypot(...w);
    const k = r / Math.sin(phi / 2) - r;
    const mid = [Math.round(p[0] + (w[0] / lw) * k), Math.round(p[1] + (w[1] / lw) * k)];
    out.push(withW(p1, p.w), arcTo(p2, mid, b.w));
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** A route's path with its bends mitred: chamfered (straight) or rounded (#95), by `state.mitre`. */
export const mitrePath = (pts, state) => (state.mitre === 'round' && state.corner !== 'free' ? roundPath(pts, state.chamfer) : chamferPath(pts, state.chamfer));

/**
 * What a walkaround Track keeps clear of, from the last fixed corner: other Nets' copper and the
 * Outline edge, less anything already too close to that corner (the walk can't mend that).
 * Cached on the index, which the editor rebuilds whenever a route starts.
 */
function obstaclesFor(project, state, index, margin = 0) {
  const from = state.points[state.points.length - 1];
  const k = `${state.layer}|${state.net}|${state.width}|${from.join(',')}|${margin}`;
  index._walk ||= new Map();
  if (!index._walk.has(k)) {
    if (index._walk.size > 32) index._walk.clear();
    const near = index.collisions(project.board, { type: 'capsule', a: from, b: from, r: state.width / 2 }, state.layer, state.net);
    index._walk.set(k, new Obstacles(project, index, state.layer, state.net, state.width, { ignore: new Set(near.map((it) => it.id)), margin }));
  }
  return index._walk.get(k);
}

const unitOf = (v) => { const L = Math.hypot(v[0], v[1]); return L ? [v[0] / L, v[1] / L] : null; };

/**
 * Which way the route is heading at its last fixed corner (a unit vector): along its last fixed
 * segment (an arc's tangent at its end), or `state.lead` before there is one (the Track it
 * carries on from); null at a pad or a via.
 */
export function heading(state) {
  const n = state.points.length;
  if (n < 2) return state.lead || null;
  const p = state.points[n - 1];
  let q = state.points[n - 2];
  if (p.mid) { const pts = trackPoints({ a: q, mid: p.mid, b: p }, 2_000); q = pts[pts.length - 2]; }
  return unitOf([p[0] - q[0], p[1] - q[1]]);
}

/** The direction a path from `from` sets off in (an arc's tangent). */
function setsOff(from, path) {
  const p = path[0];
  if (!p) return null;
  if (p.mid) { const pts = trackPoints({ a: from, mid: p.mid, b: p }, 2_000); return unitOf([pts[1][0] - from[0], pts[1][1] - from[1]]); }
  return unitOf([p[0] - from[0], p[1] - from[1]]);
}

/**
 * The posture for the leg from the last fixed corner to `cursor`: the one whose first segment
 * carries on the way the route is heading, as schematic wires do, where the bend style can;
 * else the style's own. `state.forced` (/ pressed for this leg) keeps the style's.
 */
export function legPosture(state, cursor) {
  if (state.forced || state.corner === 'any' || state.corner === 'free') return state.posture;
  const h = heading(state);
  if (!h) return state.posture;
  const from = state.points[state.points.length - 1];
  for (const ps of state.posture === 'a' ? ['a', 'b'] : ['b', 'a']) {
    const d = setsOff(from, cornerPath(from, cursor, state.corner, ps));
    if (d && d[0] * h[0] + d[1] * h[1] > 0.999) return ps;
  }
  return state.posture;
}

/**
 * The tentative corners from the last fixed one towards `cursor` (not including it): the corner
 * style's path in Free mode; in Walkaround mode a clear path round other Nets' copper, which
 * stops short (`blocked`) when there is no way round.
 */
export function tentative(project, state, cursor, mode = 'free', index = null, to = null) {
  const last = state.points[state.points.length - 1];
  const from = state.points.length === 1 && !state.runs?.length ? state.from : null; // still at the start pad
  if (state.corner === 'free') {
    // freehand (#92): the stroke so far, then the pointer, simplified
    const pts = simplifyPath([last, ...(state.stroke || []), cursor], state.width / 4);
    if (mode !== 'walkaround' || !index) return { tail: pts.slice(1), blocked: false };
    const obs = obstaclesFor(project, state, index);
    for (let i = 1; i < pts.length; i++) if (!obs.clear(pts[i - 1], pts[i])) return { tail: pts.slice(1, i), blocked: true };
    return { tail: pts.slice(1), blocked: false };
  }
  // the first leg carries on the way the route is heading where it can (legPosture)
  const lead = legPosture(state, cursor);
  const finish = (p) => routePath(p, cursor, state.corner, p === last ? lead : state.posture, p === last ? from : null, to, state.width);
  if (mode !== 'walkaround' || !index) return { tail: finish(last), blocked: false };
  const exit = from && state.corner === '45' ? (dir) => { const r = padReach(from, dir); return r == null ? null : r + state.width; } : null;
  let obs = obstaclesFor(project, state, index);
  let w = walkPath(obs, last, cursor, { corner: state.corner, finish, exit });
  if (state.chamfer > 0) {
    // a chamfer cuts the inside of a bend, towards what the path hugs: widen the berth and look again
    const pts = mitrePath([...state.points, ...w.path.slice(1)], state);
    const from = Math.max(0, mitrePath(state.points, state).length - 2);
    if (!obs.pathClear(pts.slice(from))) {
      obs = obstaclesFor(project, state, index, Math.ceil(state.chamfer * Math.SQRT1_2));
      w = walkPath(obs, last, cursor, { corner: state.corner, finish, exit });
    }
  }
  return { tail: w.path.slice(1), blocked: w.blocked };
}

/**
 * The proposed copper for the cursor: the fixed segments, then the tentative ones to the cursor.
 * `to` is the pad under the cursor the track would finish on (entered square, not at 45°).
 */
export function step(project, state, cursor, mode = 'free', index = null, to = null) {
  if (mode === 'shove' && index) {
    // the corner style's path, other Nets' Tracks pushed aside; else walk round as Walkaround does
    const v = stepWith(project, state, cursor, 'free', index, to);
    const r = shoveFor(project, state, v.segments, index);
    if (r.ok) {
      // the shove moved (and checked) every Track and Via in the way: only copper that can't move can block
      const clear = (s) => !index.collisions(project.board, trackShape(s), s.layer, state.net).some((it) => it.kind !== 'track' && it.kind !== 'via');
      if (v.segments.every(clear)) {
        for (const s of v.segments) s.collides = false;
        return { ...v, collisions: [], shoved: r.moved.size || r.movedVias.size ? r.tracks : null, shovedVias: r.movedVias.size ? r.vias : null, shovedIds: r.moved, shovedViaIds: r.movedVias };
      }
    }
    return { ...stepWith(project, state, cursor, 'walkaround', index, to), shoveFailed: r.reason || 'blocked' };
  }
  return stepWith(project, state, cursor, mode, index, to);
}

/**
 * The shove for a route's segments (and its vias): what they push, from the Board as it was.
 * The index caches the copper that never moves.
 */
export function shoveFor(project, state, segments, index) {
  const all = copperLayerNames(project.board.stack.copper);
  const pushers = [
    // an arc pushes as the pieces of its centre line
    ...segments.flatMap((s) => { const p = s.mid ? trackPoints(s, 20_000) : [s.a, s.b]; return p.slice(1).map((b, i) => ({ a: p[i], b, r: (s.width || state.width) / 2, layers: [s.layer], net: state.net, kind: 'track' })); }),
    ...(state.vias || []).map((v) => ({ a: v.at, b: v.at, r: (state.via?.diameter || 0) / 2, layers: all, net: state.net, kind: 'via' })),
  ];
  index._fixed ||= fixedItems(index);
  return shove(project.board, pushers, { fixed: index._fixed, copper: all });
}

function stepWith(project, state, cursor, mode, index, to) {
  const { tail, blocked } = tentative(project, state, cursor, mode, index, to);
  const pts = mitrePath([...state.points, ...tail], state);
  const nFixed = mitrePath(state.points, state).length;
  const segments = [];
  // runs finished on other layers, then this layer's
  for (const run of state.runs || []) {
    const rp = mitrePath(run.points, state);
    for (let i = 1; i < rp.length; i++) if (rp[i][0] !== rp[i - 1][0] || rp[i][1] !== rp[i - 1][1]) segments.push({ ...segOf(rp[i - 1], rp[i], state.width), fixed: true, layer: run.layer });
  }
  for (let i = 1; i < pts.length; i++) if (pts[i][0] !== pts[i - 1][0] || pts[i][1] !== pts[i - 1][1]) segments.push({ ...segOf(pts[i - 1], pts[i], state.width), fixed: i < nFixed - 1, layer: state.layer });
  let collisions = [];
  if (index) {
    const seen = new Map();
    for (const s of segments) {
      const hits = index.collisions(project.board, trackShape({ ...s, width: s.width || state.width }), s.layer, state.net);
      s.collides = hits.length > 0;
      for (const h of hits) seen.set(h.id, h);
    }
    collisions = [...seen.values()];
  }
  return { segments, collisions, state, tail, blocked, end: tail.length ? tail[tail.length - 1] : state.points[state.points.length - 1] };
}

/**
 * Fix the tentative corner(s) up to `point`: the corner style's path, or `tail` (the corners
 * step() proposed, e.g. a walkaround's detour) when given.
 */
export function click(project, state, point, tail = null) {
  const last = state.points[state.points.length - 1];
  if (!tail && last[0] === point[0] && last[1] === point[1]) return state;
  const add = tail || tentative(project, state, point).tail;
  if (!add.length) return state.stroke?.length ? { ...state, stroke: [] } : state;
  // freehand: a click fixes the stroke so far, and Backspace takes back all of it (`stops`)
  const free = state.corner === 'free' ? { stroke: [], stops: [...(state.stops || []), state.points.length] } : {};
  // each fixed corner carries the width of the leg that ends at it (R4: the width can change mid-route)
  return { ...state, ...free, forced: false, points: [...state.points, ...add.map((p) => withW(p, p.w || state.width))] };
}

/** Take back the last fixed segment (the start stays); at a via, take the via back and return to the layer before. */
export function back(state) {
  const stop = state.stops?.[state.stops.length - 1];
  if (stop != null && stop < state.points.length) return { ...state, stroke: [], stops: state.stops.slice(0, -1), points: state.points.slice(0, stop) };
  if (state.points.length > 1) return { ...state, stroke: [], points: state.points.slice(0, -1) };
  if (!state.runs?.length) return state;
  const prev = state.runs[state.runs.length - 1];
  return { ...state, runs: state.runs.slice(0, -1), vias: state.vias.slice(0, -1), layer: prev.layer, points: prev.points };
}

export const flipPosture = (state) => (state.bend != null ? withBend(state, bendOf(state.bend).mirror) : { ...state, posture: state.posture === 'a' ? 'b' : 'a' });

/**
 * The Tracks for the fixed points, added to the Board (in place). With `shove` (#29), the other
 * Nets' Tracks they push are moved first, as the route showed them. Returns the new Tracks.
 */
export function commit(project, state, { shove: pushing = false, index = null } = {}) {
  const tracks = [];
  if (pushing && index) {
    const segs = [];
    for (const run of [...(state.runs || []), { layer: state.layer, points: state.points }]) {
      const pts = mitrePath(run.points, state);
      for (let i = 1; i < pts.length; i++) if (pts[i][0] !== pts[i - 1][0] || pts[i][1] !== pts[i - 1][1]) segs.push({ ...segOf(pts[i - 1], pts[i], state.width), layer: run.layer });
    }
    const r = shoveFor(project, state, segs, index);
    if (r.ok && (r.moved.size || r.movedVias.size)) { project.board.tracks = r.tracks; project.board.vias = r.vias; }
  }
  // T-junctions (#89): the Tracks the route starts or finishes part-way along are split there
  for (const j of state.joins || []) splitTrackAt(project.board, j.id, j.at);
  for (const run of [...(state.runs || []), { layer: state.layer, points: state.points }]) {
    const pts = mitrePath(run.points, state);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      if (a[0] === b[0] && a[1] === b[1]) continue;
      tracks.push({ id: uid('t'), ...segOf(a, b, state.width), layer: run.layer, net: state.net });
    }
  }
  project.board.tracks.push(...tracks);
  const vias = (state.vias || []).map((v) => newVia(project, v.at, state.net, state.via));
  project.board.vias.push(...vias);
  return tracks;
}

/** A through via (v1: F.Cu to B.Cu, ADR-0015), sized by its Net class unless given. */
export function newVia(project, at, net, size = null) {
  const r = netRules(project.board, net);
  return { id: uid('v'), at, drill: size?.drill || r.viaDrill, diameter: size?.diameter || r.viaDiameter, from: 'F.Cu', to: 'B.Cu', net: net || '' };
}
