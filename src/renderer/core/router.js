// The router (#20), with the step-wise interface ADR-0006 asks for:
//   step(project, state, cursor, mode) -> { segments, collisions, state }   the proposed copper
//   click(project, state, point)        -> new state (a corner fixed)
//   commit(project, state)              -> the Tracks added to the Board
// Free mode draws what the corner style says and only reports collisions; Walkaround (#22) and
// Shove (#29) will propose other copper through the same interface. DOM-free.
//
// state: { net, layer, width, points: [start, corner…], corner: '90' | '45' | 'any', posture: 'a' | 'b',
//          chamfer: nm }  chamfer: Eagle-style mitre length cut off every bend of 90° or sharper (0: none)
import { uid } from './project.js';
import { netRules } from './collision.js';

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

/** Start routing from a point (a pad's centre) on a layer, for a Net: width from its Net class. */
export function startRoute(project, at, layer, net, { corner = '45', posture = 'a', chamfer = 0 } = {}) {
  return { net, layer, width: netRules(project.board, net).trackWidth, points: [at], corner, posture, chamfer };
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

/** The proposed copper for the cursor: the fixed segments, then the tentative ones to the cursor. */
export function step(project, state, cursor, mode = 'free', index = null) {
  const pts = chamferPath([...state.points, ...cornerPath(state.points[state.points.length - 1], cursor, state.corner, state.posture)], state.chamfer);
  const nFixed = chamferPath(state.points, state.chamfer).length;
  const segments = [];
  for (let i = 1; i < pts.length; i++) if (pts[i][0] !== pts[i - 1][0] || pts[i][1] !== pts[i - 1][1]) segments.push({ a: pts[i - 1], b: pts[i], fixed: i < nFixed - 1 });
  let collisions = [];
  if (index && mode === 'free') {
    const seen = new Map();
    for (const s of segments) {
      const hits = index.collisions(project.board, { type: 'capsule', a: s.a, b: s.b, r: state.width / 2 }, state.layer, state.net);
      s.collides = hits.length > 0;
      for (const h of hits) seen.set(h.id, h);
    }
    collisions = [...seen.values()];
  }
  return { segments, collisions, state };
}

/** Fix the tentative corner(s) up to `point`. */
export function click(project, state, point) {
  const last = state.points[state.points.length - 1];
  if (last[0] === point[0] && last[1] === point[1]) return state;
  return { ...state, points: [...state.points, ...cornerPath(last, point, state.corner, state.posture)] };
}

/** Take back the last fixed segment (the start stays). */
export const back = (state) => (state.points.length > 1 ? { ...state, points: state.points.slice(0, -1) } : state);

export const flipPosture = (state) => ({ ...state, posture: state.posture === 'a' ? 'b' : 'a' });

/** The Tracks for the fixed points, added to the Board (in place). Returns them. */
export function commit(project, state) {
  const tracks = [];
  const pts = chamferPath(state.points, state.chamfer);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (a[0] === b[0] && a[1] === b[1]) continue;
    tracks.push({ id: uid('t'), a, b, width: state.width, layer: state.layer, net: state.net });
  }
  project.board.tracks.push(...tracks);
  return tracks;
}
