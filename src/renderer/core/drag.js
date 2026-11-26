// Dragging routed Tracks (#31): a segment slides sideways, its neighbours keeping their own
// directions (they lengthen or shorten to meet it, so 45° and 90° stay 45° and 90°); where a
// neighbour can't (the end is on a pad, a Via or a junction, or the neighbour runs the same way), a
// short square jog joins the old end to the moved segment. A corner moves to the pointer, the two
// segments meeting there redrawn to it with 45° corners. In Shove mode other Nets' copper is
// pushed aside as the drag goes (core/shove.js), springing back as it returns. An arc Track (#93)
// dragged by its middle changes its bulge, its ends staying put; its corners move keeping its
// shape. DOM-free.
import { uid } from './project.js';
import { cornerPath } from './router.js';
import { shove, fixedItems } from './shove.js';
import { copperLayerNames } from './board.js';
import { placedPads, padNets } from './footprint.js';
import { trackShape, trackPoints, withEnds } from './trackGeom.js';

const eq = (p, q) => p[0] === q[0] && p[1] === q[1];
const key = (p) => `${p[0]},${p[1]}`;

/** What meets point `p` on `layer`: the other segments of `net` ending there, and whether a pad or Via is there. */
function meeting(board, project, p, layer, net, except) {
  const segs = (board.tracks || []).filter((t) => t.id !== except && t.layer === layer && t.net === net && (eq(t.a, p) || eq(t.b, p)));
  const via = (board.vias || []).some((v) => eq(v.at, p));
  let pad = false;
  if (project) {
    const nets = padNets(board), view = { ...project, board };
    pad = (board.footprints || []).some((bf) => placedPads(view, bf, nets).some((q) => eq(q.at, p)));
  }
  return { segs, fixed: via || pad };
}

/** Where line p + s·d meets line q + t·e (null when parallel). */
function intersect(p, d, q, e) {
  const den = d[0] * e[1] - d[1] * e[0];
  if (!den) return null;
  const s = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / den;
  return [Math.round(p[0] + d[0] * s), Math.round(p[1] + d[1] * s)];
}

/**
 * The Board's Tracks with segment `id` slid by `delta` (only its sideways part counts). Returns
 * { tracks, changed: the new and reshaped segments } or null when it can't (no such segment).
 */
export function dragSegment(project, board, id, delta) {
  const t = (board.tracks || []).find((x) => x.id === id);
  if (!t) return null;
  if (t.mid) return dragBulge(board, t, delta);
  const dx = t.b[0] - t.a[0], dy = t.b[1] - t.a[1], L = Math.hypot(dx, dy);
  if (!L) return null;
  const n = [-dy / L, dx / L];
  const k = delta[0] * n[0] + delta[1] * n[1];
  const off = [Math.round(n[0] * k), Math.round(n[1] * k)];
  if (!off[0] && !off[1]) return { tracks: board.tracks, changed: [] };
  const A2 = [t.a[0] + off[0], t.a[1] + off[1]], B2 = [t.b[0] + off[0], t.b[1] + off[1]];
  const out = (board.tracks || []).filter((x) => x.id !== id).map((x) => ({ ...x }));
  const changed = [];
  const moved = { ...t, a: A2, b: B2 };
  // each end: a neighbour that can follow along its own line, or a jog from the old end
  for (const end of ['a', 'b']) {
    const P = t[end], P2 = moved[end];
    const m = meeting(board, project, P, t.layer, t.net, t.id);
    // an arc neighbour has no line to follow: a jog joins it
    const nb = !m.fixed && m.segs.length === 1 && !m.segs[0].mid ? out.find((x) => x.id === m.segs[0].id) : null;
    let joined = false;
    if (nb) {
      const far = eq(nb.a, P) ? nb.b : nb.a;
      const e = [P[0] - far[0], P[1] - far[1]];
      const X = intersect(A2, [dx, dy], far, e);
      // it must stay pointing the same way (not fold back past its far end)
      if (X && (X[0] - far[0]) * e[0] + (X[1] - far[1]) * e[1] > 0) {
        if (eq(nb.a, P)) nb.a = X; else nb.b = X;
        moved[end] = X;
        changed.push(nb);
        joined = true;
      }
    }
    if (!joined) {
      const jog = { ...t, id: uid('t'), a: end === 'a' ? P : P2, b: end === 'a' ? P2 : P };
      out.push(jog); changed.push(jog);
    }
  }
  if (eq(moved.a, moved.b)) return null;
  out.push(moved); changed.push(moved);
  return { tracks: out, changed };
}

/** An arc Track dragged by its middle (#93): `mid` moves with the pointer, the ends stay. */
function dragBulge(board, t, delta) {
  if (!delta[0] && !delta[1]) return { tracks: board.tracks, changed: [] };
  const mid = [t.mid[0] + delta[0], t.mid[1] + delta[1]];
  const out = (board.tracks || []).filter((x) => x.id !== t.id).map((x) => ({ ...x }));
  // three points in a line: it's straight now
  const straight = Math.abs((t.b[0] - t.a[0]) * (mid[1] - t.a[1]) - (t.b[1] - t.a[1]) * (mid[0] - t.a[0])) < 1e3 * Math.hypot(t.b[0] - t.a[0], t.b[1] - t.a[1]);
  const moved = { ...t, mid };
  if (straight) delete moved.mid;
  out.push(moved);
  return { tracks: out, changed: [moved] };
}

/**
 * The Board's Tracks with the corner at `at` (where exactly two segments of one Net meet on a
 * layer, with no pad or Via there) moved to `to`: the two segments redrawn from their far ends to
 * `to` with 45° corners. Returns { tracks, changed } or null when `at` isn't such a corner.
 */
export function dragCorner(project, board, at, to, layer = null) {
  const segs = (board.tracks || []).filter((t) => (!layer || t.layer === layer) && (eq(t.a, at) || eq(t.b, at)));
  if (segs.length !== 2 || segs[0].net !== segs[1].net || segs[0].layer !== segs[1].layer) return null;
  if (meeting(board, project, at, segs[0].layer, segs[0].net).fixed) return null;
  const out = (board.tracks || []).filter((x) => !segs.includes(x)).map((x) => ({ ...x }));
  const changed = [];
  const run = (from, pts, proto, keepId) => {
    let prev = from;
    pts.forEach((p, i) => { if (eq(prev, p)) return; const s = { ...proto, id: i === 0 && keepId ? proto.id : uid('t'), a: prev, b: p }; out.push(s); changed.push(s); prev = p; });
  };
  const [s1, s2] = segs;
  const far1 = eq(s1.a, at) ? s1.b : s1.a, far2 = eq(s2.a, at) ? s2.b : s2.a;
  // an arc (#93) keeps its shape, its end at the corner moving to `to`
  const arc = (sg) => { const m = withEnds(sg, eq(sg.a, at) ? to : sg.a, eq(sg.b, at) ? to : sg.b); out.push(m); changed.push(m); };
  if (s1.mid) arc(s1); else run(far1, cornerPath(far1, to, '45', 'a'), s1, true);
  if (s2.mid) arc(s2); else run(to, cornerPath(to, far2, '45', 'b'), s2, true);
  return { tracks: out, changed };
}

/** The corner under `p` (within `tol`): { at, layer } where two segments of one Net meet with nothing else there. */
export function cornerAt(project, board, p, tol, hidden = new Set()) {
  const ends = new Map();
  for (const t of board.tracks || []) {
    if (hidden.has(t.layer)) continue;
    for (const q of [t.a, t.b]) if (Math.hypot(q[0] - p[0], q[1] - p[1]) <= tol) { const k = `${key(q)}|${t.layer}`; if (!ends.has(k)) ends.set(k, { at: q, layer: t.layer, segs: [] }); ends.get(k).segs.push(t); }
  }
  for (const e of ends.values()) if (e.segs.length === 2 && e.segs[0].net === e.segs[1].net && !meeting(board, project, e.at, e.layer, e.segs[0].net).fixed) return { at: e.at, layer: e.layer };
  return null;
}

/**
 * The free Track end under `p` (within `tol`, or the Track's half-width): an end of a Track with
 * a net where nothing else is (no other segment of its net on its layer, no pad, no Via), which a
 * drag carries on routing from. Returns { at, track } or null.
 */
export function freeEndAt(project, board, p, tol, hidden = new Set()) {
  let best = null;
  for (const t of board.tracks || []) {
    if (!t.net || hidden.has(t.layer)) continue;
    for (const q of [t.a, t.b]) {
      const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (d <= Math.max(tol, t.width / 2) && (!best || d < best.d)) best = { d, t, q };
    }
  }
  if (!best) return null;
  const m = meeting(board, project, best.q, best.t.layer, best.t.net, best.t.id);
  return m.fixed || m.segs.length ? null : { at: best.q, track: best.t };
}

/**
 * A drag's result for the Board (`r` from dragSegment / dragCorner): in Shove mode, other Nets'
 * Tracks and Vias pushed out of the way of what changed. Returns { ok, tracks, vias, moved } or
 * { ok: false } when it can't be pushed clear (`index`: copperIndex of the Board as it was).
 */
export function dragResult(project, r, { shove: pushing = false, index = null } = {}) {
  const board = project.board;
  if (!r) return { ok: false };
  if (!pushing) return { ok: true, tracks: r.tracks, vias: board.vias, moved: new Set() };
  const all = copperLayerNames(board.stack.copper);
  // an arc pushes as the pieces of its centre line
  const pushers = r.changed.flatMap((s) => { const pts = trackPoints(s, 20_000); return pts.slice(1).map((b, i) => ({ a: pts[i], b, r: s.width / 2, layers: [s.layer], net: s.net, kind: 'track' })); });
  const res = shove({ ...board, tracks: r.tracks }, pushers, { fixed: index ? (index._fixed ||= fixedItems(index)) : [], copper: all });
  if (!res.ok) return { ok: false, reason: res.reason };
  // what was dragged must be clear of what can't move too
  if (index) {
    for (const s of r.changed) {
      const hits = index.collisions(board, trackShape(s), s.layer, s.net).filter((it) => it.kind !== 'track' && it.kind !== 'via');
      if (hits.length) return { ok: false, reason: 'fixed' };
    }
  }
  return { ok: true, tracks: res.tracks, vias: res.vias, moved: res.moved };
}
