// Push-and-shove (#29, #30, ADR-0006): new copper pushes other Nets' Tracks and Vias aside to keep
// clearance.
//
// A pushed Track keeps its two ends (so what it connects stays connected): the stretch beside the
// pusher is lifted clear of it in a bump, a raised run parallel to the Track joined back by two
// 45° ramps (shove(), bumpOf()). The bump is new copper of the Track's Net, so it may push the next
// Track in turn: the push travels through a chain of parallel Tracks. Pads, copper drawings and
// locked Tracks and Vias never move, nor do arc Tracks (#93); when a push would need them to (or a bump doesn't fit
// in its Track, or the push goes round in circles), the shove fails and the router falls back to
// walking round. A Via in the way moves clear in a 45° direction (viaMove), its Tracks' ends
// going with it (#30). It is worked out afresh from the Board as it was for every cursor position, so
// pushed copper springs back as the cursor withdraws. DOM-free.
import { shapeDistance, shapeBox, clearanceBetween, pairKind } from './collision.js';
import { outlineSegments } from './walkaround.js';
import { uid } from './project.js';
import { trackShape } from './trackGeom.js';

const MAX_PUSHES = 400;    // give up past this many pushes in one shove
const MAX_PER_TRACK = 6;   // or when one Track is pushed this many times over (times 4 pushers)
const SLACK = 2_000;       // nm beyond the clearance, so rounding never leaves a pushed Track short
const low = (s) => String(s || '').toLowerCase();

const cap = trackShape; // a capsule, or a chain along an arc Track (#93)
const boxesMeet = (a, b, m = 0) => a.x0 - m <= b.x1 && a.x1 + m >= b.x0 && a.y0 - m <= b.y1 && a.y1 + m >= b.y0;

/** Do segments p1-p2 and q1-q2 cross (their centre lines)? */
function crosses(p1, p2, q1, q2) {
  const o = (a, b, c) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
  return o(p1, p2, q1) * o(p1, p2, q2) < 0 && o(q1, q2, p1) * o(q1, q2, p2) < 0;
}

/**
 * The bump that lifts Track `t` clear of its pushers (`ps`: capsules { a, b, r, need }, each
 * `need` apart edge to edge, all on one side of it): the Track's points [a, …, b] with one bump
 * covering them all, or null when it can't be (a pusher is on the other side, or the bump would
 * reach past the Track's ends). A pusher crossing the Track pushes it ahead of its tip (`b`).
 */
export function bumpOf(t, ps) {
  const o = pushOffset(t, ps);
  if (!o) return null;
  const { A, B, L, tx, ty, nx, ny, h, uLo, uHi } = o;
  const s0 = uLo - h, s1 = uHi + h;
  if (s0 < 0 || s1 > L) return null; // the bump doesn't fit in this Track
  const at = (u, v) => [Math.round(A[0] + tx * u + nx * v), Math.round(A[1] + ty * u + ny * v)];
  return [A, at(s0, 0), at(uLo, h), at(uHi, h), at(s1, 0), B].filter((q, i, all) => !i || q[0] !== all[i - 1][0] || q[1] !== all[i - 1][1]);
}

/**
 * Which way and how far Track `t` must go to clear its pushers `ps`: { nx, ny (the unit normal away
 * from them), h (how far), uLo, uHi (the stretch along it they cover) }, or null when they're on
 * both sides of it.
 */
export function pushOffset(t, ps) {
  if (!Array.isArray(ps)) ps = [ps];
  const A = t.a, B = t.b;
  const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
  if (!L || !ps.length) return null;
  const tx = (B[0] - A[0]) / L, ty = (B[1] - A[1]) / L;
  // the normal pointing away from the (first) pusher; every pusher must be on that side. A pusher
  // that crosses the Track (a route's head driven into it) pushes it ahead of its tip: it comes
  // from the side its start is on, and the bump clears the tip on the far side
  let nx = -ty, ny = tx;
  // `p.from`: where a chained push comes from (the line of the Track whose bump this is)
  const from = (p) => p.from || (crosses(A, B, p.a, p.b) ? p.a : [(p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2]);
  const side = (p) => { const q = from(p); return (q[0] - A[0]) * nx + (q[1] - A[1]) * ny; };
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
  return { A, B, L, tx, ty, nx, ny, h, uLo, uHi };
}

/** Where line p + s·d meets line q + t·e (null when parallel). */
function intersect(p, d, q, e) {
  const den = d[0] * e[1] - d[1] * e[0];
  if (Math.abs(den) < 1e-9) return null;
  const s = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / den;
  return [Math.round(p[0] + d[0] * s), Math.round(p[1] + d[1] * s)];
}

/** The point of segment a-b nearest to p. */
function nearestOnSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)) : 0;
  return [a[0] + t * dx, a[1] + t * dy];
}

/**
 * Where Via `v` goes to be `need` clear of pusher `p` (edge to edge): straight away from the
 * pusher's nearest point, along the nearest of the eight 45° directions, as little as it takes.
 */
export function viaMove(v, p, need) {
  const q = nearestOnSeg(v.at, p.a, p.b);
  let dx = v.at[0] - q[0], dy = v.at[1] - q[1];
  if (!dx && !dy) { dx = -(p.b[1] - p.a[1]); dy = p.b[0] - p.a[0]; if (!dx && !dy) dx = 1; } // dead centre: off sideways
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

/**
 * Shove other Nets' Tracks and Vias out of the way of `pushers` (the new copper: [{ a, b, r,
 * layers, net, kind: 'track' | 'via' }]). `board` is the Board as it was; `fixed` the copper index
 * items that never move (pads and drawings: see fixedItems); `locked`, more Track and Via ids
 * that mustn't move. A Track pushed again is bumped once round everything pushing it. A Via (#30)
 * moves clear, the ends of its own Net's Tracks that meet it going with it, and pushes in turn on
 * every layer. Returns { ok, tracks, vias (the Board's, pushed), moved (ids of the Tracks that
 * moved), movedVias } or { ok: false, reason }.
 */
export function shove(board, pushers, { fixed = [], locked = new Set(), copper = null } = {}) {
  const viaLayers = new Set(copper || (board.stack?.copper === 4 ? ['F.Cu', 'In1.Cu', 'In2.Cu', 'B.Cu'] : ['F.Cu', 'B.Cu']));
  const vias = (board.vias || []).map((v) => ({ ...v }));
  const viaPushes = new Map();
  const movedVias = new Set();
  const tracks = (board.tracks || []).map((t) => ({ ...t }));
  const origin = new Map(tracks.map((t) => [t, t.id])); // working segment -> the Track it came from
  const orig = new Map((board.tracks || []).map((t) => [t.id, t]));
  const pushedBy = new Map(); // Track id -> its pushers so far
  const segsOf = new Map(); // Track id -> its current segments
  const moved = new Set();
  const heads = pushers.map((p) => ({ ...p, layers: new Set(p.layers) }));
  const sameAt = (q, P) => q[0] === P[0] && q[1] === P[1];
  // a pad or via at P on `layer`: what a sliding segment's end can't drag along
  const fixedAt = (P, layer) => vias.some((v) => sameAt(v.at, P)) || fixed.some((it) => it.kind === 'pad' && it.layers.has(layer) && shapeDistance({ type: 'capsule', a: P, b: P, r: 0 }, it.shape) <= 0);
  /** Slide Track `id` (its working segment `t`) clear of pushers `ps`; false when it can't. */
  const slide = (id, t, ps) => {
    if ((segsOf.get(id) || [t]).length !== 1) return false; // already bumped: leave it
    const o = orig.get(id), off = pushOffset(o, ps);
    if (!off) return false;
    const d = [Math.round(off.nx * off.h), Math.round(off.ny * off.h)], dir = [o.b[0] - o.a[0], o.b[1] - o.a[1]];
    const A2 = [o.a[0] + d[0], o.a[1] + d[1]], B2 = [o.b[0] + d[0], o.b[1] + d[1]];
    const ends = { a: A2, b: B2 }, changed = [];
    for (const end of ['a', 'b']) {
      const P = o[end], P2 = ends[end];
      const nbs = tracks.filter((u) => u !== t && u.layer === t.layer && low(u.net) === low(t.net) && (sameAt(u.a, P) || sameAt(u.b, P)));
      const nb = nbs.length === 1 && !fixedAt(P, t.layer) && !nbs[0].locked && !nbs[0].mid && (segsOf.get(origin.get(nbs[0])) || [nbs[0]]).length === 1 && !locked.has(origin.get(nbs[0])) ? nbs[0] : null;
      let done = false;
      if (nb) {
        const far = sameAt(nb.a, P) ? nb.b : nb.a, e = [P[0] - far[0], P[1] - far[1]];
        const X = intersect(A2, dir, far, e);
        if (X && (X[0] - far[0]) * e[0] + (X[1] - far[1]) * e[1] > 0) {
          if (sameAt(nb.a, P)) nb.a = X; else nb.b = X;
          ends[end] = X;
          const nid = origin.get(nb);
          orig.set(nid, { ...nb }); moved.add(nid); changed.push(nb);
          done = true;
        }
      }
      if (!done) { // a short jog from where it was joined
        const j = { ...o, id: uid('t'), a: end === 'a' ? P : P2, b: end === 'a' ? P2 : P };
        tracks.push(j); origin.set(j, id); changed.push(j);
      }
    }
    t.a = ends.a; t.b = ends.b;
    orig.set(id, { ...o, a: ends.a, b: ends.b });
    segsOf.set(id, [t]); moved.add(id); changed.push(t);
    for (const q of queue) if (q.owner === id) q.dead = true;
    const away = [(o.a[0] + o.b[0]) / 2, (o.a[1] + o.b[1]) / 2];
    for (const sg of changed) queue.push({ a: sg.a, b: sg.b, r: sg.width / 2, layers: new Set([sg.layer]), net: sg.net, kind: 'track', owner: origin.get(sg), from: away });
    return true;
  };
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
      if (t.mid) return { ok: false, reason: 'arc' }; // an arc Track isn't bent: walk round it
      if (++pushes > MAX_PUSHES) return { ok: false, reason: 'too many pushes' };
      const list = [...(pushedBy.get(id) || []), { a: p.a, b: p.b, r: p.r, need, from: p.from }];
      if (list.length > MAX_PER_TRACK * 4) return { ok: false, reason: 'loop' };
      pushedBy.set(id, list);
      const pts = bumpOf(orig.get(id), list);
      if (!pts) {
        // too short for a bump (a short diagonal between two runs): slide the whole segment over,
        // its neighbours following along their own lines, as dragging a segment does (#107)
        if (!slide(id, t, list)) return { ok: false, reason: 'no room' };
        i = -1;
        continue;
      }
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
      // the bump pushes on away from the Track's own line, so a push ripples on through a bundle
      // the same way even where a bump reaches past the next Track's line
      const o = orig.get(id), away = [(o.a[0] + o.b[0]) / 2, (o.a[1] + o.b[1]) / 2];
      for (const sg of segs) queue.push({ a: sg.a, b: sg.b, r: sg.width / 2, layers: new Set([sg.layer]), net: sg.net, kind: 'track', owner: id, from: away });
      i = -1; // the list changed: look again from the start for this pusher
    }
    // Vias in the way move clear (#30), taking their Tracks' ends with them
    for (const v of vias) {
      if (v === p.via || (p.net && low(v.net) === low(p.net)) || ![...p.layers].some((l) => viaLayers.has(l))) continue;
      const need = clearanceBetween(board, p.net, v.net, p.kind, 'via');
      const vc = { type: 'capsule', a: v.at, b: v.at, r: v.diameter / 2 };
      if (!boxesMeet(pb, shapeBox(vc), need) || shapeDistance(pc, vc) >= need) continue;
      if (v.locked || locked.has(v.id)) return { ok: false, reason: 'locked' };
      const n = (viaPushes.get(v.id) || 0) + 1;
      if (n > MAX_PER_TRACK || ++pushes > MAX_PUSHES) return { ok: false, reason: 'loop' };
      viaPushes.set(v.id, n);
      const to = viaMove(v, p, need);
      if (!to) return { ok: false, reason: 'no room' };
      const from = v.at;
      // the ends of its own Net's Tracks that meet it go with it
      const same = (q) => q[0] === from[0] && q[1] === from[1];
      for (const t of [...tracks]) {
        if (low(t.net) !== low(v.net) || (!same(t.a) && !same(t.b))) continue;
        if (t.mid) return { ok: false, reason: 'arc' };
        const id = origin.get(t);
        const o = orig.get(id);
        if (o && (same(o.a) || same(o.b))) orig.set(id, { ...o, a: same(o.a) ? to : o.a, b: same(o.b) ? to : o.b });
        if (same(t.a)) t.a = to; if (same(t.b)) t.b = to;
        moved.add(id);
        queue.push({ a: t.a, b: t.b, r: t.width / 2, layers: new Set([t.layer]), net: t.net, kind: 'track', owner: id });
      }
      v.at = to;
      movedVias.add(v.id);
      queue.push({ a: to, b: to, r: v.diameter / 2, layers: new Set(viaLayers), net: v.net, kind: 'via', via: v });
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
      if (low(u.net) === low(v.net)) continue;
      if (shapeDistance(c, cap(u)) < clearanceBetween(board, v.net, u.net, 'via', 'track') - 1) return { ok: false, reason: 'tracks' };
    }
    for (const [a, e] of edges) if (shapeDistance(c, { type: 'capsule', a, b: e, r: 0 }) < edge) return { ok: false, reason: 'edge' };
  }
  return { ok: true, tracks, vias, moved, movedVias };
}

/** The copper that never moves in a shove: the index's items other than Tracks and Vias (pads, drawings). */
export const fixedItems = (index) => index.items.filter((it) => it.kind !== 'track' && it.kind !== 'via');
