// Push-and-shove (#29, ADR-0006): new copper pushes other Nets' Tracks aside to keep clearance.
//
// A pushed Track keeps its two ends (so what it connects stays connected): the stretch beside the
// pusher is lifted clear of it in a bump, a raised run parallel to the Track joined back by two
// 45° ramps (shove(), bumpOf()). The bump is new copper of the Track's Net, so it may push the next
// Track in turn: the push travels through a chain of parallel Tracks. Pads, Vias, copper
// drawings and locked Tracks never move; when a push would need them to (or a bump doesn't fit
// in its Track, or the push goes round in circles), the shove fails and the router falls back to
// walking round. It is worked out afresh from the Board as it was for every cursor position, so
// pushed copper springs back as the cursor withdraws. DOM-free.
import { shapeDistance, shapeBox, clearanceBetween, pairKind } from './collision.js';
import { outlineSegments } from './walkaround.js';
import { uid } from './project.js';

const MAX_PUSHES = 400;    // give up past this many pushes in one shove
const MAX_PER_TRACK = 6;   // or when one Track is pushed this many times over (times 4 pushers)
const SLACK = 2_000;       // nm beyond the clearance, so rounding never leaves a pushed Track short
const low = (s) => String(s || '').toLowerCase();

const cap = (t) => ({ type: 'capsule', a: t.a, b: t.b, r: t.width / 2 });
const boxesMeet = (a, b, m = 0) => a.x0 - m <= b.x1 && a.x1 + m >= b.x0 && a.y0 - m <= b.y1 && a.y1 + m >= b.y0;

/** Do segments p1-p2 and q1-q2 cross (their centre lines)? */
function crosses(p1, p2, q1, q2) {
  const o = (a, b, c) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
  return o(p1, p2, q1) * o(p1, p2, q2) < 0 && o(q1, q2, p1) * o(q1, q2, p2) < 0;
}

/**
 * The bump that lifts Track `t` clear of its pushers (`ps`: capsules { a, b, r, need }, each
 * `need` apart edge to edge, all on one side of it): the Track's points [a, …, b] with one bump
 * covering them all, or null when it can't be (a pusher crosses the Track or is on the other side,
 * or the bump would reach past the Track's ends).
 */
export function bumpOf(t, ps) {
  if (!Array.isArray(ps)) ps = [ps];
  const A = t.a, B = t.b;
  const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
  if (!L || !ps.length) return null;
  if (ps.some((p) => crosses(A, B, p.a, p.b))) return null;
  const tx = (B[0] - A[0]) / L, ty = (B[1] - A[1]) / L;
  // the normal pointing away from the (first) pusher; every pusher must be on that side
  let nx = -ty, ny = tx;
  const side = (p) => ((p.a[0] + p.b[0]) / 2 - A[0]) * nx + ((p.a[1] + p.b[1]) / 2 - A[1]) * ny;
  if (side(ps[0]) > 0) { nx = -nx; ny = -ny; }
  let h = -Infinity, uLo = Infinity, uHi = -Infinity;
  for (const p of ps) {
    if (side(p) > t.width / 2) return null; // pushed from both sides
    const R = p.r + p.need + t.width / 2 + SLACK;
    const us = [p.a, p.b].map((q) => (q[0] - A[0]) * tx + (q[1] - A[1]) * ty);
    const vs = [p.a, p.b].map((q) => (q[0] - A[0]) * nx + (q[1] - A[1]) * ny);
    h = Math.max(h, Math.max(...vs) + R);
    uLo = Math.min(uLo, Math.min(...us) - R); uHi = Math.max(uHi, Math.max(...us) + R);
  }
  if (!(h > 0)) return null;
  const s0 = uLo - h, s1 = uHi + h;
  if (s0 < 0 || s1 > L) return null; // the bump doesn't fit in this Track
  const at = (u, v) => [Math.round(A[0] + tx * u + nx * v), Math.round(A[1] + ty * u + ny * v)];
  return [A, at(s0, 0), at(uLo, h), at(uHi, h), at(s1, 0), B].filter((q, i, all) => !i || q[0] !== all[i - 1][0] || q[1] !== all[i - 1][1]);
}

/**
 * Shove other Nets' Tracks out of the way of `pushers` (the new copper: [{ a, b, r, layers, net,
 * kind: 'track' | 'via' }]). `board` is the Board as it was; `fixed` the copper index items that
 * never move (pads, Vias, drawings: copperIndex(project).items without the Tracks); `locked`, more
 * Track ids that mustn't move. A Track pushed again is bumped once round everything pushing it.
 * Returns { ok, tracks (the Board's Tracks, pushed), moved (ids of the Tracks that moved) } or
 * { ok: false, reason }.
 */
export function shove(board, pushers, { fixed = [], locked = new Set() } = {}) {
  const tracks = (board.tracks || []).map((t) => ({ ...t }));
  const origin = new Map(tracks.map((t) => [t, t.id])); // working segment -> the Track it came from
  const orig = new Map((board.tracks || []).map((t) => [t.id, t]));
  const pushedBy = new Map(); // Track id -> its pushers so far
  const segsOf = new Map(); // Track id -> its current segments
  const moved = new Set();
  const heads = pushers.map((p) => ({ ...p, layers: new Set(p.layers) }));
  const queue = [...heads];
  let pushes = 0;
  for (let qi = 0; qi < queue.length; qi++) {
    const p = queue[qi];
    if (p.dead) continue; // a bump since replaced
    const pc = { type: 'capsule', a: p.a, b: p.b, r: p.r };
    const pb = shapeBox(pc);
    for (let i = 0; i < tracks.length; i++) {
      const t = tracks[i];
      const id = origin.get(t);
      if (!p.layers.has(t.layer) || id === p.owner || (p.net && low(t.net) === low(p.net))) continue;
      const need = clearanceBetween(board, p.net, t.net, p.kind, 'track');
      if (!boxesMeet(pb, shapeBox(cap(t)), need)) continue;
      if (shapeDistance(pc, cap(t)) >= need) continue;
      if (locked.has(id) || t.locked) return { ok: false, reason: 'locked' };
      if (++pushes > MAX_PUSHES) return { ok: false, reason: 'too many pushes' };
      const list = [...(pushedBy.get(id) || []), { a: p.a, b: p.b, r: p.r, need }];
      if (list.length > MAX_PER_TRACK * 4) return { ok: false, reason: 'loop' };
      pushedBy.set(id, list);
      const pts = bumpOf(orig.get(id), list);
      if (!pts) return { ok: false, reason: 'no room' };
      // the Track's old segments make way for the new ones
      const old = segsOf.get(id) || [t];
      for (const q of queue) if (q.owner === id) q.dead = true;
      const first = tracks.indexOf(old[0]);
      for (const o of old) tracks.splice(tracks.indexOf(o), 1);
      const segs = [];
      for (let k = 1; k < pts.length; k++) segs.push({ ...orig.get(id), id: k === 1 ? id : uid('t'), a: pts[k - 1], b: pts[k] });
      tracks.splice(Math.min(first, tracks.length), 0, ...segs);
      for (const sg of segs) origin.set(sg, id);
      segsOf.set(id, segs);
      moved.add(id);
      // the bump is new copper too: it pushes whatever it now comes too close to
      for (const sg of segs) queue.push({ a: sg.a, b: sg.b, r: sg.width / 2, layers: new Set([sg.layer]), net: sg.net, kind: 'track', owner: id });
      i = -1; // the list changed: look again from the start for this pusher
    }
  }
  // what moved must be clear of everything now: what can't move, the new copper, the other
  // Tracks, and the board's edge
  const pushed = tracks.filter((t) => moved.has(origin.get(t)));
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
      if (shapeDistance(c, cap(u)) < clearanceBetween(board, t.net, u.net, 'track', 'track') - 1) return { ok: false, reason: 'tracks' };
    }
    for (const [a, e] of edges) if (shapeDistance(c, { type: 'capsule', a, b: e, r: 0 }) < edge) return { ok: false, reason: 'edge' };
  }
  return { ok: true, tracks, moved };
}

/** The copper that never moves in a shove: the index's items other than Tracks. */
export const fixedItems = (index) => index.items.filter((it) => it.kind !== 'track');
