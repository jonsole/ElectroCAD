// The router (#20), with the step-wise interface ADR-0006 asks for:
//   step(project, state, cursor, mode) -> { segments, collisions, state }   the proposed copper
//   click(project, state, point)        -> new state (a corner fixed)
//   commit(project, state)              -> the Tracks added to the Board
// Free mode draws what the corner style says and only reports collisions; Walkaround (#22) detours
// the tentative run round other Nets' copper (core/walkaround.js); Shove (#29) will propose other
// copper through the same interface. DOM-free.
//
// state: { net, layer, width, points: [start, corner…], corner: '90' | '45' | 'any', posture: 'a' | 'b',
//          chamfer: nm,  Eagle-style mitre length cut off every bend of 90° or sharper (0: none)
//          runs: [{ layer, points }],  the runs already finished on other layers (#21)
//          vias: [{ at }],  where they change layer
//          pair: [layerA, layerB], via: { drill, diameter } }
import { uid } from './project.js';
import { netRules } from './collision.js';
import { Obstacles, walkPath } from './walkaround.js';

export const ROUTE_MODES = [['walkaround', 'Walkaround'], ['free', 'Free']];

export const CORNERS = [['90', '90°'], ['45', '45°'], ['any', 'Any']];

/**
 * The corner points from `a` to `b` (not including a): one bend for 90° and 45° routing, none
 * for any-angle. Posture 'a' goes straight first (horizontal for 90°, along the major axis for
 * 45°), 'b' bends first.
 */
export function cornerPath(a, b, corner = '45', posture = 'a') {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  if (corner === 'any' || !dx || !dy) return [b];
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
export function startRoute(project, at, layer, net, { corner = '45', posture = 'a', chamfer = 0, pair = null, pad = null } = {}) {
  const r = netRules(project.board, net);
  return { net, layer, width: r.trackWidth, points: [at], from: pad ? { size: pad.size, rot: pad.rot || 0 } : null, corner, posture, chamfer, runs: [], vias: [], pair: pair || defaultPair(project.board, layer), via: { drill: r.viaDrill, diameter: r.viaDiameter } };
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
  return { ...s1, runs: [...s1.runs, { layer: s1.layer, points: s1.points }], vias: [...s1.vias, { at: end }], layer: to || nextLayer(s1.pair, s1.layer), points: [end] };
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
    const u = [a[0] - p[0], a[1] - p[1]], v = [b[0] - p[0], b[1] - p[1]];
    const lu = Math.hypot(...u), lv = Math.hypot(...v);
    if (!lu || !lv) { out.push(p); continue; }
    const cos = (u[0] * v[0] + u[1] * v[1]) / (lu * lv); // the inside angle: 90° corner -> 0, sharper -> > 0
    if (cos < -1e-9) { out.push(p); continue; } // gentler than 90° (a 45° bend): left as it is
    const c = Math.min(length, lu / 2, lv / 2);
    out.push([Math.round(p[0] + (u[0] / lu) * c), Math.round(p[1] + (u[1] / lu) * c)], [Math.round(p[0] + (v[0] / lv) * c), Math.round(p[1] + (v[1] / lv) * c)]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

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

/**
 * The tentative corners from the last fixed one towards `cursor` (not including it): the corner
 * style's path in Free mode; in Walkaround mode a clear path round other Nets' copper, which
 * stops short (`blocked`) when there is no way round.
 */
export function tentative(project, state, cursor, mode = 'free', index = null, to = null) {
  const last = state.points[state.points.length - 1];
  const from = state.points.length === 1 && !state.runs?.length ? state.from : null; // still at the start pad
  const finish = (p) => routePath(p, cursor, state.corner, state.posture, p === last ? from : null, to, state.width);
  if (mode !== 'walkaround' || !index) return { tail: finish(last), blocked: false };
  const exit = from && state.corner === '45' ? (dir) => { const r = padReach(from, dir); return r == null ? null : r + state.width; } : null;
  let obs = obstaclesFor(project, state, index);
  let w = walkPath(obs, last, cursor, { corner: state.corner, finish, exit });
  if (state.chamfer > 0) {
    // a chamfer cuts the inside of a bend, towards what the path hugs: widen the berth and look again
    const pts = chamferPath([...state.points, ...w.path.slice(1)], state.chamfer);
    const from = Math.max(0, chamferPath(state.points, state.chamfer).length - 2);
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
  const { tail, blocked } = tentative(project, state, cursor, mode, index, to);
  const pts = chamferPath([...state.points, ...tail], state.chamfer);
  const nFixed = chamferPath(state.points, state.chamfer).length;
  const segments = [];
  // runs finished on other layers, then this layer's
  for (const run of state.runs || []) {
    const rp = chamferPath(run.points, state.chamfer);
    for (let i = 1; i < rp.length; i++) if (rp[i][0] !== rp[i - 1][0] || rp[i][1] !== rp[i - 1][1]) segments.push({ a: rp[i - 1], b: rp[i], fixed: true, layer: run.layer });
  }
  for (let i = 1; i < pts.length; i++) if (pts[i][0] !== pts[i - 1][0] || pts[i][1] !== pts[i - 1][1]) segments.push({ a: pts[i - 1], b: pts[i], fixed: i < nFixed - 1, layer: state.layer });
  let collisions = [];
  if (index) {
    const seen = new Map();
    for (const s of segments) {
      const hits = index.collisions(project.board, { type: 'capsule', a: s.a, b: s.b, r: state.width / 2 }, s.layer, state.net);
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
  if (tail) return tail.length ? { ...state, points: [...state.points, ...tail] } : state;
  if (last[0] === point[0] && last[1] === point[1]) return state;
  return { ...state, points: [...state.points, ...tentative(project, state, point).tail] };
}

/** Take back the last fixed segment (the start stays); at a via, take the via back and return to the layer before. */
export function back(state) {
  if (state.points.length > 1) return { ...state, points: state.points.slice(0, -1) };
  if (!state.runs?.length) return state;
  const prev = state.runs[state.runs.length - 1];
  return { ...state, runs: state.runs.slice(0, -1), vias: state.vias.slice(0, -1), layer: prev.layer, points: prev.points };
}

export const flipPosture = (state) => ({ ...state, posture: state.posture === 'a' ? 'b' : 'a' });

/** The Tracks for the fixed points, added to the Board (in place). Returns them. */
export function commit(project, state) {
  const tracks = [];
  for (const run of [...(state.runs || []), { layer: state.layer, points: state.points }]) {
    const pts = chamferPath(run.points, state.chamfer);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      if (a[0] === b[0] && a[1] === b[1]) continue;
      tracks.push({ id: uid('t'), a, b, width: state.width, layer: run.layer, net: state.net });
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
