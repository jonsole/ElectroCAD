// What a route can start or finish on besides a Pad: a Via (on every copper layer, #87, #88), a
// Track end (#87, #88), or a point along a Track (a T-junction, #89), which splits the Track there
// when the route is committed. DOM-free.
import { uid } from './project.js';

const d2 = (p, q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2;

/** The point of segment a–b nearest `p`, and how far along it is (0 at a, 1 at b). */
function nearestOn(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
  const s = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2)) : 0;
  return { at: [Math.round(a[0] + dx * s), Math.round(a[1] + dy * s)], s };
}

/**
 * The copper under `p` a route on `layer` can join: { kind: 'via' | 'end' | 'along', at, net,
 * layer, id }, or null. A Via is on every layer; a Track only on its own. Vias first, then Track
 * ends (within `tol` of the end), then a point along a Track (`along: true` to allow it; the
 * point is `p` moved onto the Track's centre line). Copper with no net is left out. `hidden`:
 * layers not shown.
 */
export function copperTarget(board, p, tol, layer, { along = false, hidden = new Set() } = {}) {
  const vias = (hidden.has('F.Cu') && hidden.has('B.Cu')) ? [] : board.vias || [];
  const via = vias.filter((v) => v.net && d2(p, v.at) <= (v.diameter / 2 + tol) ** 2).sort((a, b) => d2(p, a.at) - d2(p, b.at))[0];
  if (via) return { kind: 'via', at: via.at, net: via.net, layer, id: via.id };
  const ts = (board.tracks || []).filter((t) => t.net && t.layer === layer && !hidden.has(t.layer));
  let best = null;
  for (const t of ts) for (const q of [t.a, t.b]) {
    const d = d2(p, q);
    if (d <= Math.max(tol, t.width / 2) ** 2 && (!best || d < best.d)) best = { d, t, q };
  }
  if (best) return { kind: 'end', at: best.q, net: best.t.net, layer, id: best.t.id };
  if (!along) return null;
  for (const t of ts) {
    const n = nearestOn(p, t.a, t.b);
    if (d2(p, n.at) > (t.width / 2 + tol) ** 2) continue;
    // at an end it is that end
    if (n.s <= 0 || n.s >= 1 || d2(n.at, t.a) === 0 || d2(n.at, t.b) === 0) return { kind: 'end', at: n.s < 0.5 ? t.a : t.b, net: t.net, layer, id: t.id };
    return { kind: 'along', at: n.at, net: t.net, layer, id: t.id };
  }
  return null;
}

/** A Track of a net on another layer than `layer` under `p` (to say which layer to make active). */
export function trackOnOtherLayer(board, p, tol, layer, hidden = new Set()) {
  return (board.tracks || []).find((t) => t.net && t.layer !== layer && !hidden.has(t.layer) && d2(p, nearestOn(p, t.a, t.b).at) <= (t.width / 2 + tol) ** 2) || null;
}

/**
 * Split Track `id` at `at` (a T-junction): it becomes two Tracks meeting there, each keeping its
 * width, layer, net and lock. The first keeps the id. Returns the new piece, or null when `at` is
 * an end (nothing to split) or there is no such Track.
 */
export function splitTrackAt(board, id, at, newId = uid('t')) {
  const t = (board.tracks || []).find((x) => x.id === id);
  if (!t || d2(t.a, at) === 0 || d2(t.b, at) === 0) return null;
  const piece = { ...t, id: newId, a: at, b: t.b };
  t.b = at;
  board.tracks.push(piece);
  return piece;
}
