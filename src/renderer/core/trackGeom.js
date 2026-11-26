// Track geometry (#93): a Track is straight from `a` to `b`, or an arc through an optional `mid`
// point, as Edge.Cuts arcs are (start, mid, end; ADR-0015). Everything that measures a Track's
// copper goes through here: its centre line as points (an arc flattened finely enough that the
// error is under a micron), its shape for the collision engine, its length, the point on it
// nearest a point, splitting it and moving its ends. DOM-free.
import { arcCircle } from './geom.js';

const TOL = 1000; // nm: how far a flattened arc may stray from the true one
const TAU = 2 * Math.PI;
const norm = (x) => ((x % TAU) + TAU) % TAU;

export const isArc = (t) => !!t.mid;

/**
 * The circle of an arc Track: { c, r, a0 (angle at a), sweep (signed, a to b through mid) }, or
 * null for a straight Track (or three points in a line).
 */
export function trackArc(t) {
  if (!t.mid) return null;
  const k = arcCircle(t.a, t.mid, t.b);
  if (!k || !Number.isFinite(k.r)) return null;
  const ang = (p) => Math.atan2(p[1] - k.c[1], p[0] - k.c[0]);
  const a0 = ang(t.a), a1 = ang(t.b), am = ang(t.mid);
  let sweep = norm(a1 - a0);
  if (norm(am - a0) > sweep) sweep -= TAU; // the other way round
  return { c: k.c, r: k.r, a0, sweep };
}

const at = (k, ang) => [Math.round(k.c[0] + k.r * Math.cos(ang)), Math.round(k.c[1] + k.r * Math.sin(ang))];

/** The centre line as points, a first and b last: [a, b] when straight. */
export function trackPoints(t, tol = TOL) {
  const k = trackArc(t);
  if (!k) return [t.a, t.b];
  const step = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - tol / k.r)));
  const n = Math.max(2, Math.min(720, Math.ceil(Math.abs(k.sweep) / (step || 0.01))));
  const out = [t.a];
  for (let i = 1; i < n; i++) out.push(at(k, k.a0 + (k.sweep * i) / n));
  out.push(t.b);
  return out;
}

/**
 * The Track's copper as a collision shape: a capsule when straight, a chain of capsules along
 * the flattened arc otherwise ({ type: 'chain', pts, r, a, b }).
 */
export function trackShape(t) {
  if (!t.mid) return { type: 'capsule', a: t.a, b: t.b, r: t.width / 2 };
  return { type: 'chain', pts: trackPoints(t), r: t.width / 2, a: t.a, b: t.b };
}

/** Length along the centre line. */
export function trackLength(t) {
  const k = trackArc(t);
  return k ? k.r * Math.abs(k.sweep) : Math.hypot(t.b[0] - t.a[0], t.b[1] - t.a[1]);
}

/** The box round the copper (bulge and width included). */
export function trackBox(t) {
  const pts = trackPoints(t, 10_000), w = (t.width || 0) / 2;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return { x0: Math.min(...xs) - w, y0: Math.min(...ys) - w, x1: Math.max(...xs) + w, y1: Math.max(...ys) + w };
}

/**
 * The point on the centre line nearest `p`: { at, d (distance), s (0 at a, 1 at b) }.
 */
export function nearestOnTrack(t, p) {
  const k = trackArc(t);
  if (!k) {
    const dx = t.b[0] - t.a[0], dy = t.b[1] - t.a[1], L2 = dx * dx + dy * dy;
    const s = L2 ? Math.max(0, Math.min(1, ((p[0] - t.a[0]) * dx + (p[1] - t.a[1]) * dy) / L2)) : 0;
    const q = [Math.round(t.a[0] + dx * s), Math.round(t.a[1] + dy * s)];
    return { at: q, d: Math.hypot(p[0] - q[0], p[1] - q[1]), s };
  }
  // the angle of p, measured from a the way the arc goes, clamped to the arc
  const ang = Math.atan2(p[1] - k.c[1], p[0] - k.c[0]);
  const rel = k.sweep >= 0 ? norm(ang - k.a0) : -norm(k.a0 - ang);
  const span = Math.abs(k.sweep);
  let s = Math.abs(rel) / span;
  if (s > 1) { // off the arc: whichever end is nearer
    const da = Math.hypot(p[0] - t.a[0], p[1] - t.a[1]), db = Math.hypot(p[0] - t.b[0], p[1] - t.b[1]);
    return da <= db ? { at: t.a, d: da, s: 0 } : { at: t.b, d: db, s: 1 };
  }
  const q = s <= 0 ? t.a : s >= 1 ? t.b : at(k, k.a0 + k.sweep * s);
  return { at: q, d: Math.hypot(p[0] - q[0], p[1] - q[1]), s };
}

/** The point a fraction `s` of the way along (0 at a, 1 at b). */
export function pointAlong(t, s) {
  const k = trackArc(t);
  if (!k) return [Math.round(t.a[0] + (t.b[0] - t.a[0]) * s), Math.round(t.a[1] + (t.b[1] - t.a[1]) * s)];
  return s <= 0 ? t.a : s >= 1 ? t.b : at(k, k.a0 + k.sweep * s);
}

/**
 * Track `t` cut at `p` (on it): the two pieces' geometry [{ a, b, mid? }, { a, b, mid? }], an arc
 * giving two arcs of the same circle.
 */
export function splitGeometry(t, p) {
  if (!t.mid) return [{ a: t.a, b: p }, { a: p, b: t.b }];
  const s = nearestOnTrack(t, p).s;
  return [{ a: t.a, b: p, mid: pointAlong(t, s / 2) }, { a: p, b: t.b, mid: pointAlong(t, (1 + s) / 2) }];
}

/**
 * An arc Track's `mid` once its ends move to `a2`, `b2`: the same bulge in proportion to the
 * chord (its sagitta scales with the chord's length), so the arc keeps its shape. Straight: null.
 */
export function midFor(t, a2, b2) {
  if (!t.mid) return null;
  const cx = (t.a[0] + t.b[0]) / 2, cy = (t.a[1] + t.b[1]) / 2;
  const dx = t.b[0] - t.a[0], dy = t.b[1] - t.a[1], L = Math.hypot(dx, dy);
  const dx2 = b2[0] - a2[0], dy2 = b2[1] - a2[1], L2 = Math.hypot(dx2, dy2);
  if (!L || !L2) return null;
  // the sagitta (signed, along the chord's left normal) and how far mid sits along the chord
  const h = ((t.mid[0] - cx) * -dy + (t.mid[1] - cy) * dx) / L;
  const u = ((t.mid[0] - cx) * dx + (t.mid[1] - cy) * dy) / L;
  const f = L2 / L;
  const m = [(a2[0] + b2[0]) / 2, (a2[1] + b2[1]) / 2];
  return [Math.round(m[0] + (dx2 / L2) * u * f + (-dy2 / L2) * h * f), Math.round(m[1] + (dy2 / L2) * u * f + (dx2 / L2) * h * f)];
}

/** Track `t` with its ends moved to `a2`, `b2`, an arc keeping its shape. */
export function withEnds(t, a2, b2) {
  const mid = midFor(t, a2, b2);
  const out = { ...t, a: a2, b: b2 };
  if (mid) out.mid = mid; else delete out.mid;
  return out;
}
