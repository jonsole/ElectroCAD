// Dragging routed Tracks (#31): a segment slides sideways, its neighbours keeping their own
// directions (they lengthen or shorten to meet it, so 45° and 90° stay 45° and 90°); where a
// neighbour can't (the end is on a pad, a Via or a junction, or the neighbour runs the same way), a
// short square jog joins the old end to the moved segment. A corner (a bend or a junction) moves to the
// pointer, every segment meeting there redrawn to it with a 45° corner. In Shove mode other Nets' copper is
// pushed aside as the drag goes (core/shove.js), springing back as it returns. An arc Track (#93)
// dragged by its middle changes its bulge, its ends staying put; its corners move keeping its
// shape. DOM-free.
import { uid } from './project.js';
import { cornerPath } from './router.js';
import { shove, fixedItems } from './shove.js';

const STEP = 200_000;  // nm: the longest step a pushing drag takes (#108)
const MAX_STEPS = 16;
const low = (s) => String(s || '').toLowerCase();
import { copperLayerNames } from './board.js';
import { placedPads, padNets } from './footprint.js';
import { trackShape, trackPoints, withEnds } from './trackGeom.js';

const eq = (p, q) => p[0] === q[0] && p[1] === q[1];

/**
 * How an edit reshapes tracks (#96's mode rule): `{ free: true }` (Free mode: stretch at any
 * angle) or `{ corner, posture }` (Shove / Walkaround: redraw with the bend style; the default is
 * 45°, straight first from the far end).
 */
export const STRETCH = { free: true };
const DEFAULT_STYLE = { corner: '45', posture: 'a' };

/**
 * Tracks like `proto` from `from` along corner path `pts` (points carrying `mid` are arcs): the
 * first keeps proto's id when `keepId`.
 */
export function pathTracks(proto, from, pts, keepId) {
  const out = [];
  let prev = from;
  pts.forEach((p) => {
    if (eq(prev, p)) return;
    const { mid: _m, ...base } = proto;
    const t = { ...base, id: keepId && !out.length ? proto.id : uid('t'), a: [prev[0], prev[1]], b: [p[0], p[1]] };
    if (p.mid) t.mid = p.mid;
    out.push(t); prev = p;
  });
  return out;
}

/** The corner path from `far` to `to` in `style` (redrawn), or straight (stretch). */
export const pathFor = (far, to, style) => (style.free ? [to] : cornerPath(far, to, style.corner === 'free' ? 'any' : style.corner, style.posture));
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
export function dragSegment(project, board, id, delta, style = DEFAULT_STYLE) {
  const t = (board.tracks || []).find((x) => x.id === id);
  if (!t) return null;
  if (t.mid) return dragBulge(board, t, delta);
  if (style.free) return moveSegment(project, board, t, delta);
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

/**
 * Free mode (E2): segment `t` moves whole by `delta` in any direction; every other segment of its
 * net ending at either end stretches to follow (an arc keeping its shape). Where an end is on a
 * pad or via, a straight piece joins the old point to the moved one.
 */
function moveSegment(project, board, t, delta) {
  if (!delta[0] && !delta[1]) return { tracks: board.tracks, changed: [] };
  const out = (board.tracks || []).filter((x) => x.id !== t.id).map((x) => ({ ...x }));
  const changed = [];
  const moved = { ...t, a: [t.a[0] + delta[0], t.a[1] + delta[1]], b: [t.b[0] + delta[0], t.b[1] + delta[1]] };
  for (const end of ['a', 'b']) {
    const P = t[end], P2 = moved[end];
    const m = meeting(board, project, P, t.layer, t.net, t.id);
    if (m.fixed) { const j = { ...t, id: uid('t'), a: end === 'a' ? P : P2, b: end === 'a' ? P2 : P }; out.push(j); changed.push(j); continue; }
    for (const sg of m.segs) {
      const i = out.findIndex((x) => x.id === sg.id);
      const x = out[i];
      out[i] = withEnds(x, eq(x.a, P) ? P2 : x.a, eq(x.b, P) ? P2 : x.b);
      changed.push(out[i]);
    }
  }
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
 * The Board's Tracks with the corner at `at` (where two or more segments of one Net meet on a
 * layer, a bend or a junction, with no pad or Via there) moved to `to`: every segment meeting
 * there follows, redrawn from its far end to `to` with a 45° corner (an arc keeping its shape).
 * Returns { tracks, changed } or null when `at` isn't such a corner.
 */
export function dragCorner(project, board, at, to, layer = null, style = DEFAULT_STYLE) {
  const segs = (board.tracks || []).filter((t) => (!layer || t.layer === layer) && (eq(t.a, at) || eq(t.b, at)));
  if (segs.length < 2 || segs.some((t) => t.net !== segs[0].net || t.layer !== segs[0].layer)) return null;
  if (meeting(board, project, at, segs[0].layer, segs[0].net).fixed) return null;
  const out = (board.tracks || []).filter((x) => !segs.includes(x)).map((x) => ({ ...x }));
  const changed = [];

  // an arc (#93) keeps its shape, its end at the corner moving to `to`
  const arc = (sg) => { const m = withEnds(sg, eq(sg.a, at) ? to : sg.a, eq(sg.b, at) ? to : sg.b); out.push(m); changed.push(m); };
  // E3: each straight one redrawn from its far end to `to` with the bend style, or (Free) stretched
  segs.forEach((sg) => {
    const far = eq(sg.a, at) ? sg.b : sg.a;
    if (sg.mid || style.free) { arc(sg); return; }
    for (const t of pathTracks(sg, far, pathFor(far, to, style), true)) { out.push(t); changed.push(t); }
  });
  return { tracks: out, changed };
}

/**
 * The Board's Tracks with Track `id`'s free end at `at` moved to `to` (a Select drag of the end):
 * the segment stretches and swings to it, an arc keeping its shape. Returns { tracks, changed },
 * or null when there's no such Track or the end would land on its other end.
 */
export function dragEnd(board, id, at, to, style = STRETCH) {
  const t = (board.tracks || []).find((x) => x.id === id);
  if (!t) return null;
  const atA = eq(t.a, at);
  // E4: Shove / Walkaround redraw it from its far end with the bend style
  if (!style.free && !t.mid) {
    const far = atA ? t.b : t.a;
    if (eq(far, to)) return null;
    const pieces = pathTracks(t, far, pathFor(far, to, style), true);
    const out = (board.tracks || []).filter((x) => x.id !== id).map((x) => ({ ...x }));
    return { tracks: [...out, ...pieces], changed: pieces };
  }
  const moved = withEnds(t, atA ? to : t.a, atA ? t.b : to);
  if (eq(moved.a, moved.b)) return null;
  const out = (board.tracks || []).map((x) => (x.id === id ? moved : { ...x }));
  return { tracks: out, changed: [moved] };
}

/**
 * The Board with Via `id` moved to `to` (#106, V1): the Tracks on every layer that end on it
 * follow, stretched (Free) or redrawn from their far ends with the bend style; arcs keep their
 * shape; locked Tracks stay. Returns { tracks, vias, changed (Tracks and the Via) } or null.
 */
export function dragVia(board, id, to, style = DEFAULT_STYLE) {
  const v = (board.vias || []).find((x) => x.id === id);
  if (!v || v.locked) return null;
  const at = v.at;
  const moved = { ...v, at: to };
  const vias = (board.vias || []).map((x) => (x.id === id ? moved : x));
  const out = [], changed = [moved];
  for (const t of board.tracks || []) {
    const ea = eq(t.a, at), eb = eq(t.b, at);
    if ((!ea && !eb) || t.locked) { out.push(t); continue; }
    if (style.free || t.mid || (ea && eb)) { const m = withEnds(t, ea ? to : t.a, eb ? to : t.b); out.push(m); changed.push(m); continue; }
    const far = ea ? t.b : t.a;
    if (eq(far, to)) continue; // folded onto its far end: nothing left of it
    const pieces = pathTracks(t, far, pathFor(far, to, style), true);
    out.push(...pieces); changed.push(...pieces);
  }
  return { tracks: out, vias, changed };
}

/** The corner under `p` (within `tol`): { at, layer } where two or more segments of one Net meet with no pad or Via there. */
export function cornerAt(project, board, p, tol, hidden = new Set()) {
  const ends = new Map();
  for (const t of board.tracks || []) {
    if (hidden.has(t.layer)) continue;
    for (const q of [t.a, t.b]) if (Math.hypot(q[0] - p[0], q[1] - p[1]) <= tol) { const k = `${key(q)}|${t.layer}`; if (!ends.has(k)) ends.set(k, { at: q, layer: t.layer, segs: [] }); ends.get(k).segs.push(t); }
  }
  for (const e of ends.values()) if (e.segs.length >= 2 && e.segs.every((t) => t.net === e.segs[0].net) && !meeting(board, project, e.at, e.layer, e.segs[0].net).fixed) return { at: e.at, layer: e.layer };
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
export function dragResult(project, r, { shove: pushing = false, index = null, mode = null, from = null, dir = null, partial = null, dist = 0 } = {}) {
  const board = project.board;
  if (!r) return { ok: false };
  const vias = r.vias || board.vias;
  const md = mode || (pushing ? 'shove' : 'free');
  const all = copperLayerNames(board.stack.copper);
  // a moved Via is copper on every layer (#106)
  const shapeOf = (s) => (s.at ? { type: 'capsule', a: s.at, b: s.at, r: s.diameter / 2 } : trackShape(s));
  const layersOf = (s) => (s.at ? all : [s.layer]);
  const hitsOf = (s) => layersOf(s).flatMap((l) => index.collisions(board, shapeOf(s), l, s.net, new Set([s.id]), s.at ? 'via' : 'track'));
  // the edited copper that comes too close to other nets' (what Free shows red, Walkaround refuses)
  const clashes = () => (index ? r.changed.filter((s) => hitsOf(s).length).map((s) => s.id) : []);
  if (md === 'free') return { ok: true, tracks: r.tracks, vias, moved: new Set(), collisions: clashes() };
  if (md === 'walkaround') { const c = clashes(); return c.length ? { ok: false, reason: 'clearance' } : { ok: true, tracks: r.tracks, vias, moved: new Set(), collisions: [] }; }
  // an arc pushes as the pieces of its centre line; a Via as a disc on every layer
  const pushersOf = (rr) => rr.changed.flatMap((s) => {
    // `from`: where the dragged copper started, so everything it pushes goes the one way (#107)
    if (s.at) return [{ a: s.at, b: s.at, r: s.diameter / 2, layers: all, net: s.net, kind: 'via', via: s, ...(from ? { from } : {}), ...(dir ? { dir } : {}) }];
    const pts = trackPoints(s, 20_000);
    return pts.slice(1).map((b, i) => ({ a: pts[i], b, r: s.width / 2, layers: [s.layer], net: s.net, kind: 'track', ...(from ? { from } : {}), ...(dir ? { dir } : {}) }));
  });
  const fixed = index ? (index._fixed ||= fixedItems(index)) : [];
  // a long drag pushes in short steps from where it started (#108): `partial(f)` is the drag a
  // fraction f of the way. Each step pushes on from the last, so a track is never jumped over (and
  // crossed) by the dragged copper; it's still worked out afresh from the Board as it was, so the
  // push springs back as the pointer returns
  const steps = partial && dist ? Math.min(MAX_STEPS, Math.ceil(dist / Math.max(STEP, board.rules?.clearance || 0))) : 1;
  let res = null, prev = null;
  // one push straight there first; only when that can't be done, in steps
  for (const n of steps > 1 ? [1, steps] : [1]) {
  res = null; prev = null;
  for (let k = 1; k <= n; k++) {
    const rk = k === n ? r : partial(k / n);
    if (!rk) continue;
    const net = low(rk.changed[0]?.net);
    // the dragged net's copper as this step has it, the rest as the last step pushed it
    const tracks = prev ? [...rk.tracks.filter((t) => low(t.net) === net), ...prev.tracks.filter((t) => low(t.net) !== net)] : rk.tracks;
    const ids = new Set(rk.changed.filter((s) => s.at).map((s) => s.id));
    const vs = prev ? prev.vias.map((v) => (ids.has(v.id) ? (rk.vias || board.vias).find((u) => u.id === v.id) : v)) : rk.vias || board.vias;
    res = shove({ ...board, tracks, vias: vs }, pushersOf(rk), { fixed, copper: all, before: n > 1 ? board.tracks : null });
    if (!res.ok) break;
    if (prev) { for (const id of prev.moved) res.moved.add(id); for (const id of prev.movedVias) res.movedVias.add(id); }
    prev = res;
  }
  if (res.ok) break;
  }
  if (!res.ok) return { ok: false, reason: res.reason };
  // what was dragged must be clear of what can't move too
  if (index) {
    for (const s of r.changed) {
      if (hitsOf(s).some((it) => it.kind !== 'track' && it.kind !== 'via')) return { ok: false, reason: 'fixed' };
    }
  }
  return { ok: true, tracks: res.tracks, vias: res.vias, moved: res.moved, collisions: [] };
}
