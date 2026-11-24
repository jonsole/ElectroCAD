// Resize handles for shapes (schematic markup and the Board Outline). DOM-free; lengths nm.
//
// Shapes are the shared ones: line { pts } (and the Symbol editor's poly { pts }), rect { a, b }, circle { c, r }, arc { start, mid, end }.
// shapeHandles() lists the handles; dragHandle() returns the shape with one handle moved to a
// point. On the Outline, dragOutlineHandle() also keeps the loop closed: the neighbours that
// share a moved end follow it.

const mid = (a, b) => [Math.round((a[0] + b[0]) / 2), Math.round((a[1] + b[1]) / 2)];
const same = (a, b) => a[0] === b[0] && a[1] === b[1];

/** The handles of a shape: [{ key, at, cursor }]. Text has none (its size is in the inspector). */
export function shapeHandles(s) {
  switch (s.type) {
    case 'poly':
      return s.pts.map((p, i) => ({ key: `p${i}`, at: p, cursor: 'move' }));
    case 'line': {
      const hs = s.pts.map((p, i) => ({ key: `p${i}`, at: p, cursor: 'move' }));
      if (s.pts.length === 2) hs.push({ key: 'side', at: mid(s.pts[0], s.pts[1]), cursor: 'move', side: true });
      return hs;
    }
    case 'rect': {
      const x0 = Math.min(s.a[0], s.b[0]), y0 = Math.min(s.a[1], s.b[1]), x1 = Math.max(s.a[0], s.b[0]), y1 = Math.max(s.a[1], s.b[1]);
      const mx = Math.round((x0 + x1) / 2), my = Math.round((y0 + y1) / 2);
      return [
        { key: 'nw', at: [x0, y0], cursor: 'nwse-resize' }, { key: 'n', at: [mx, y0], cursor: 'ns-resize' },
        { key: 'ne', at: [x1, y0], cursor: 'nesw-resize' }, { key: 'e', at: [x1, my], cursor: 'ew-resize' },
        { key: 'se', at: [x1, y1], cursor: 'nwse-resize' }, { key: 's', at: [mx, y1], cursor: 'ns-resize' },
        { key: 'sw', at: [x0, y1], cursor: 'nesw-resize' }, { key: 'w', at: [x0, my], cursor: 'ew-resize' },
      ];
    }
    case 'circle':
      return [[1, 0, 'ew'], [0, 1, 'ns'], [-1, 0, 'ew'], [0, -1, 'ns']].map(([dx, dy, c], i) => ({ key: `r${i}`, at: [s.c[0] + dx * s.r, s.c[1] + dy * s.r], cursor: `${c}-resize` }));
    case 'arc':
      return [{ key: 'start', at: s.start, cursor: 'move' }, { key: 'mid', at: s.mid, cursor: 'move' }, { key: 'end', at: s.end, cursor: 'move' }];
    default:
      return [];
  }
}

/** The handle of `s` within `tol` of `pt`, or null. */
export function hitHandle(s, pt, tol) {
  let best = null, bd = Infinity;
  for (const h of shapeHandles(s)) {
    const d = Math.max(Math.abs(h.at[0] - pt[0]), Math.abs(h.at[1] - pt[1]));
    if (d <= tol && d < bd) { best = h; bd = d; }
  }
  return best;
}

/**
 * An arc with new ends that keeps its shape: the middle point keeps its place relative to the
 * chord (scaled with it), so a quarter circle stays a quarter circle.
 */
export function arcWithEnds(s, start, end) {
  const c0 = [s.end[0] - s.start[0], s.end[1] - s.start[1]];
  const L0 = Math.hypot(...c0);
  const c1 = [end[0] - start[0], end[1] - start[1]];
  const L1 = Math.hypot(...c1);
  if (!L0 || !L1) return { ...s, start, end, mid: mid(start, end) };
  const u0 = [c0[0] / L0, c0[1] / L0], n0 = [-u0[1], u0[0]];
  const u1 = [c1[0] / L1, c1[1] / L1], n1 = [-u1[1], u1[0]];
  const m0 = mid(s.start, s.end);
  const d = [s.mid[0] - m0[0], s.mid[1] - m0[1]];
  const t = (d[0] * u0[0] + d[1] * u0[1]) / L0, hgt = (d[0] * n0[0] + d[1] * n0[1]) / L0;
  const m1 = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
  return { ...s, start, end, mid: [Math.round(m1[0] + (u1[0] * t + n1[0] * hgt) * L1), Math.round(m1[1] + (u1[1] * t + n1[1] * hgt) * L1)] };
}

/**
 * Move handle `key` of shape `s` to `pt`; returns a new shape. A rectangle may be dragged past
 * its opposite side (it flips); a circle's radius is the distance to its centre; a line's side
 * handle moves the whole line square to itself.
 */
export function dragHandle(s, key, pt) {
  switch (s.type) {
    case 'poly':
    case 'line': {
      if (key === 'side') {
        const [a, b] = s.pts;
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (!L) return s;
        const n = [-(b[1] - a[1]) / L, (b[0] - a[0]) / L];
        const m = mid(a, b);
        const k = (pt[0] - m[0]) * n[0] + (pt[1] - m[1]) * n[1];
        const off = [Math.round(n[0] * k), Math.round(n[1] * k)];
        return { ...s, pts: s.pts.map((p) => [p[0] + off[0], p[1] + off[1]]) };
      }
      const i = +key.slice(1);
      return { ...s, pts: s.pts.map((p, k) => (k === i ? pt : p)) };
    }
    case 'rect': {
      let x0 = Math.min(s.a[0], s.b[0]), y0 = Math.min(s.a[1], s.b[1]), x1 = Math.max(s.a[0], s.b[0]), y1 = Math.max(s.a[1], s.b[1]);
      if (key.includes('n')) y0 = pt[1];
      if (key.includes('s')) y1 = pt[1];
      if (key.includes('w')) x0 = pt[0];
      if (key.includes('e')) x1 = pt[0];
      return { ...s, a: [Math.min(x0, x1), Math.min(y0, y1)], b: [Math.max(x0, x1), Math.max(y0, y1)] };
    }
    case 'circle':
      return { ...s, r: Math.max(1, Math.round(Math.hypot(pt[0] - s.c[0], pt[1] - s.c[1]))) };
    case 'arc':
      if (key === 'mid') return { ...s, mid: pt };
      return key === 'start' ? arcWithEnds(s, pt, s.end) : arcWithEnds(s, s.start, pt);
    default:
      return s;
  }
}

/** Where a segment's ends are, as [first, last]; null for closed shapes. */
const endsOf = (s) => (s.type === 'line' ? [s.pts[0], s.pts[s.pts.length - 1]] : s.type === 'arc' ? [s.start, s.end] : null);

/** Move one end of a segment (0 = first, 1 = last) to `to`; arcs keep their shape. */
function moveEnd(s, which, to) {
  if (s.type === 'arc') return which === 0 ? arcWithEnds(s, to, s.end) : arcWithEnds(s, s.start, to);
  const pts = [...s.pts];
  pts[which === 0 ? 0 : pts.length - 1] = to;
  return { ...s, pts };
}

const translate = (s, [dx, dy]) => {
  const mv = (p) => [p[0] + dx, p[1] + dy];
  return s.type === 'arc' ? { ...s, start: mv(s.start), mid: mv(s.mid), end: mv(s.end) } : { ...s, pts: s.pts.map(mv) };
};

/**
 * Drag a handle of Outline shape `index` to `pt`, keeping loops closed; returns a new outline.
 * - An end handle: the other segments ending at that point follow it.
 * - A line's side handle moves the line square to itself; at each end, a neighbouring arc (a
 *   rounded corner) moves with it unchanged and the segment beyond it stretches, so dragging a
 *   rounded rectangle's side resizes it and keeps its corners round.
 */
export function dragOutlineHandle(outline, index, key, pt) {
  const s = outline[index];
  const out = outline.slice();
  const ends = endsOf(s);
  const followers = (p, skip) => out.map((x, i) => ({ x, i })).filter(({ x, i }) => !skip.has(i) && endsOf(x)).flatMap(({ x, i }) => endsOf(x).map((e, w) => (same(e, p) ? { i, w } : null)).filter(Boolean));
  if (!ends) { out[index] = dragHandle(s, key, pt); return out; }
  if (s.type === 'line' && key === 'side') {
    const moved = dragHandle(s, key, pt);
    const delta = [moved.pts[0][0] - s.pts[0][0], moved.pts[0][1] - s.pts[0][1]];
    out[index] = moved;
    const done = new Set([index]);
    for (const p of ends) {
      for (const { i, w } of followers(p, done)) {
        const n = out[i];
        done.add(i);
        if (n.type === 'arc') {
          // the corner moves whole; whatever meets its far end stretches to follow
          const far = endsOf(n)[1 - w];
          out[i] = translate(n, delta);
          const to = [far[0] + delta[0], far[1] + delta[1]];
          for (const f of followers(far, done)) { out[f.i] = moveEnd(out[f.i], f.w, to); done.add(f.i); }
        } else out[i] = moveEnd(n, w, [p[0] + delta[0], p[1] + delta[1]]);
      }
    }
    return out;
  }
  out[index] = dragHandle(s, key, pt);
  // which end moved, if any: the line's first/last point or the arc's start/end
  const which = s.type === 'arc' ? { start: 0, end: 1 }[key] : key === 'p0' ? 0 : key === `p${s.pts.length - 1}` ? 1 : undefined;
  if (which !== undefined) {
    const was = ends[which];
    for (const { i, w } of followers(was, new Set([index]))) out[i] = moveEnd(out[i], w, pt);
  }
  return out;
}

/**
 * Object snapping: the nearest of `targets` within `tol` of `w`, else `grid(w)`.
 * Returns { at, target } where target is the point snapped onto (null when it went to the grid).
 */
export function snapPoint(w, targets, tol, grid = (p) => p) {
  let best = null, bd = tol;
  if (tol > 0) for (const t of targets) {
    const d = Math.hypot(t[0] - w[0], t[1] - w[1]);
    if (d <= bd) { bd = d; best = t; }
  }
  return best ? { at: [best[0], best[1]], target: best } : { at: grid(w), target: null };
}

/** Every handle position of `shapes` (as snap targets), skipping indices in `skip`. */
export const handlePoints = (shapes, skip = new Set()) => shapes.flatMap((s, i) => (skip.has(i) ? [] : shapeHandles(s).map((h) => h.at)));
