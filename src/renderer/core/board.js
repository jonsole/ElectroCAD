// The Board (#15): the Layer stack and the Outline. DOM-free. Lengths nm, +Y down.
//
// The Outline is shapes on Edge.Cuts (ADR-0015): lines (two points each), arcs (start, mid,
// end), rectangles and circles. Rounded rectangles and polygons are stored as lines and arcs, so
// every outline is just segments. It is valid when every segment end meets exactly one other
// (closed loops); rectangles and circles are closed by themselves. One loop is the board edge,
// loops inside it are cut-outs.
import { mm } from './units.js';
import { arcCircle } from './geom.js';

// ---------------------------------------------------------------- Layer stack

/** Copper layers for 2 or 4 layers, top to bottom (KiCad names). */
export const copperLayerNames = (copper) => (copper === 4 ? ['F.Cu', 'In1.Cu', 'In2.Cu', 'B.Cu'] : ['F.Cu', 'B.Cu']);

/** Every layer of the stack, in panel order: copper, then technical layers, then Edge.Cuts. */
export function boardLayers(copper) {
  return [
    ...copperLayerNames(copper).map((name) => ({ name, kind: 'copper' })),
    ...['F.SilkS', 'B.SilkS', 'F.Mask', 'B.Mask', 'F.Paste', 'B.Paste', 'F.CrtYd', 'B.CrtYd', 'F.Fab', 'B.Fab'].map((name) => ({ name, kind: 'technical' })),
    { name: 'Edge.Cuts', kind: 'edge' },
  ];
}

/** What a layer is for, in a few words (the layer panel's tooltip). */
export const LAYER_HELP = {
  'F.Cu': 'Top copper', 'In1.Cu': 'Inner copper 1', 'In2.Cu': 'Inner copper 2', 'B.Cu': 'Bottom copper',
  'F.SilkS': 'Top silkscreen', 'B.SilkS': 'Bottom silkscreen', 'F.Mask': 'Top solder mask', 'B.Mask': 'Bottom solder mask',
  'F.Paste': 'Top paste (stencil)', 'B.Paste': 'Bottom paste', 'F.CrtYd': 'Top courtyard', 'B.CrtYd': 'Bottom courtyard',
  'F.Fab': 'Top fabrication drawing', 'B.Fab': 'Bottom fabrication drawing', 'Edge.Cuts': 'Board outline and cut-outs',
};

export const BOARD_THICKNESSES = [0.8, 1.0, 1.2, 1.6, 2.0];

/**
 * Set 2 or 4 copper layers. Going to 2 is refused (with a message) while Tracks or Zones use an
 * inner layer, so nothing is lost silently.
 */
export function setCopperLayers(project, copper) {
  if (copper !== 2 && copper !== 4) throw new RangeError('A board has 2 or 4 copper layers.');
  const b = project.board;
  if (copper === 2) {
    const inner = (x) => x.layer === 'In1.Cu' || x.layer === 'In2.Cu';
    const n = b.tracks.filter(inner).length + b.zones.filter(inner).length;
    if (n) throw new Error(`${n} track${n === 1 ? '' : 's'} or zone${n === 1 ? '' : 's'} use the inner layers. Move or delete them first.`);
  }
  b.stack.copper = copper;
}

export function setThickness(project, mmValue) {
  if (!(mmValue >= 0.2 && mmValue <= 5)) throw new RangeError('Board thickness must be between 0.2 and 5 mm.');
  project.board.stack.thickness = mm(mmValue);
}

// ---------------------------------------------------------------- Outline shapes

const line = (a, b) => ({ type: 'line', pts: [a, b], layer: 'Edge.Cuts' });
const arc = (start, mid, end) => ({ type: 'arc', start, mid, end, layer: 'Edge.Cuts' });

/**
 * A rectangle from two corners, with corners rounded to `radius` (0 for square). Square ones are
 * a single rect shape; rounded ones are four lines and four quarter arcs.
 */
export function rectOutline(a, b, radius = 0) {
  const x0 = Math.min(a[0], b[0]), y0 = Math.min(a[1], b[1]), x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1]);
  const r = Math.max(0, Math.min(radius, (x1 - x0) / 2, (y1 - y0) / 2));
  if (!r) return [{ type: 'rect', a: [x0, y0], b: [x1, y1], layer: 'Edge.Cuts' }];
  const k = Math.round(r * (1 - Math.SQRT1_2)); // a corner arc's midpoint, inset from the corner
  return [
    line([x0 + r, y0], [x1 - r, y0]), arc([x1 - r, y0], [x1 - k, y0 + k], [x1, y0 + r]),
    line([x1, y0 + r], [x1, y1 - r]), arc([x1, y1 - r], [x1 - k, y1 - k], [x1 - r, y1]),
    line([x1 - r, y1], [x0 + r, y1]), arc([x0 + r, y1], [x0 + k, y1 - k], [x0, y1 - r]),
    line([x0, y1 - r], [x0, y0 + r]), arc([x0, y0 + r], [x0 + k, y0 + k], [x0 + r, y0]),
  ];
}

export const circleOutline = (c, r) => [{ type: 'circle', c, r: Math.round(r), layer: 'Edge.Cuts', fill: 'none' }];

/**
 * A closed polygon from a list of steps: { to } for a straight segment, { mid, to } for an arc
 * through `mid`. The last step must end where the first started.
 */
export function polygonOutline(start, steps) {
  const out = [];
  let at = start;
  for (const s of steps) {
    out.push(s.mid ? arc(at, s.mid, s.to) : line(at, s.to));
    at = s.to;
  }
  return out;
}

/** The two ends of a segment, or null for shapes that close themselves. */
function ends(s) {
  if (s.type === 'line') return [s.pts[0], s.pts[s.pts.length - 1]];
  if (s.type === 'arc') return [s.start, s.end];
  return null;
}

const ptKey = (p) => `${p[0]},${p[1]}`;

/**
 * Is the Outline closed? Returns { closed, loops, openEnds, problems } where loops counts closed
 * loops (rects and circles count one each), openEnds are points used by only one segment end,
 * and problems are plain-language messages.
 */
export function checkOutline(outline) {
  const problems = [];
  if (!outline.length) return { closed: false, loops: 0, pieces: 0, cutouts: 0, openEnds: [], problems: ['There is no board outline yet: draw one on Edge.Cuts.'] };
  const degree = new Map();
  const adj = new Map();
  let loops = 0;
  for (const s of outline) {
    const e = ends(s);
    if (!e) { loops++; continue; }
    const [a, b] = e.map(ptKey);
    if (a === b) { loops++; continue; } // a closed polyline drawn as one shape
    for (const k of [a, b]) degree.set(k, (degree.get(k) || 0) + 1);
    adj.set(a, [...(adj.get(a) || []), b]);
    adj.set(b, [...(adj.get(b) || []), a]);
  }
  const openEnds = [...degree].filter(([, d]) => d === 1).map(([k]) => k.split(',').map(Number));
  const branches = [...degree].filter(([, d]) => d > 2).map(([k]) => k.split(',').map(Number));
  // count the closed loops among the segments: connected groups where every point meets two ends
  const seen = new Set();
  for (const start of degree.keys()) {
    if (seen.has(start)) continue;
    const stack = [start], group = [];
    seen.add(start);
    while (stack.length) { const k = stack.pop(); group.push(k); for (const n of adj.get(k) || []) if (!seen.has(n)) { seen.add(n); stack.push(n); } }
    if (group.every((k) => degree.get(k) === 2)) loops++;
  }
  if (openEnds.length) problems.push(`The outline is open at ${openEnds.length / 2 === 1 ? 'one gap' : `${Math.ceil(openEnds.length / 2)} gaps`}: every end must meet another.`);
  if (branches.length) problems.push('Three or more outline segments meet at one point; an outline must be simple loops.');
  // which loops are boards and which are cut-outs: a loop inside another loop's extents is a cut-out
  const boxes = outlineLoops(outline).map((l) => outlineBounds(l.map((x) => x.shape)));
  const inside = (a, b) => a !== b && a.x0 >= b.x0 && a.y0 >= b.y0 && a.x1 <= b.x1 && a.y1 <= b.y1;
  const cutouts = boxes.filter((a) => boxes.some((b) => inside(a, b))).length;
  return { closed: !openEnds.length && !branches.length && loops > 0, loops, pieces: boxes.length - cutouts, cutouts, openEnds, problems };
}

/** The Outline's extents, or null when there is none. */
export function outlineBounds(outline) {
  const pts = [];
  for (const s of outline) {
    if (s.type === 'rect') pts.push(s.a, s.b);
    else if (s.type === 'circle') pts.push([s.c[0] - s.r, s.c[1] - s.r], [s.c[0] + s.r, s.c[1] + s.r]);
    else if (s.type === 'arc') {
      const c = arcCircle(s.start, s.mid, s.end);
      pts.push(s.start, s.mid, s.end);
      if (c) for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) { const p = [Math.round(c.c[0] + c.r * Math.cos(a)), Math.round(c.c[1] + c.r * Math.sin(a))]; if (onArc(s, c, p)) pts.push(p); }
    } else if (s.pts) pts.push(...s.pts);
  }
  if (!pts.length) return null;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

function onArc(s, c, p) {
  const ang = (q) => Math.atan2(q[1] - c.c[1], q[0] - c.c[0]);
  const norm = (a) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const a0 = ang(s.start), sweep = norm(ang(s.end) - a0), viaMid = norm(ang(s.mid) - a0) <= sweep, t = norm(ang(p) - a0);
  return viaMid ? t <= sweep : t >= sweep;
}

/** Move outline shapes by `delta` (in place). */
export function moveOutline(shapes, [dx, dy]) {
  const mv = ([x, y]) => [x + dx, y + dy];
  for (const s of shapes) {
    for (const k of ['a', 'b', 'c', 'start', 'mid', 'end']) if (s[k]) s[k] = mv(s[k]);
    if (s.pts) s.pts = s.pts.map(mv);
  }
}

/** The outline shape under `pt` (within `tol`), or null. */
export function hitOutline(outline, pt, tol) {
  const d2 = (p, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const t = dx || dy ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy))) : 0;
    return (a[0] + t * dx - p[0]) ** 2 + (a[1] + t * dy - p[1]) ** 2;
  };
  for (let i = outline.length - 1; i >= 0; i--) {
    const s = outline[i];
    if (s.type === 'line') { for (let k = 1; k < s.pts.length; k++) if (d2(pt, s.pts[k - 1], s.pts[k]) <= tol * tol) return s; }
    else if (s.type === 'rect') {
      const c = [s.a, [s.b[0], s.a[1]], s.b, [s.a[0], s.b[1]]];
      if (c.some((p, k) => d2(pt, p, c[(k + 1) % 4]) <= tol * tol)) return s;
    } else if (s.type === 'circle') { if (Math.abs(Math.hypot(pt[0] - s.c[0], pt[1] - s.c[1]) - s.r) <= tol) return s; }
    else if (s.type === 'arc') { const c = arcCircle(s.start, s.mid, s.end); if (c && Math.abs(Math.hypot(pt[0] - c.c[0], pt[1] - c.c[1]) - c.r) <= tol && onArc(s, c, pt)) return s; }
  }
  return null;
}

/**
 * The Outline's closed loops, each an ordered list of { shape, reversed } that walks the loop
 * end to end (rects and circles are a loop of their own). Open chains are left out. For drawing
 * the board's fill and, later, the Gerber edge and the 3D board.
 */
export function outlineLoops(outline) {
  const loops = [];
  const segs = [];
  for (const s of outline) {
    const e = ends(s);
    if (!e || ptKey(e[0]) === ptKey(e[1])) loops.push([{ shape: s, reversed: false }]);
    else segs.push({ s, a: ptKey(e[0]), b: ptKey(e[1]) });
  }
  const used = new Set();
  for (let i = 0; i < segs.length; i++) {
    if (used.has(i)) continue;
    used.add(i);
    const loop = [{ shape: segs[i].s, reversed: false }];
    const start = segs[i].a;
    let at = segs[i].b;
    while (at !== start) {
      const j = segs.findIndex((g, k) => !used.has(k) && (g.a === at || g.b === at));
      if (j < 0) break;
      used.add(j);
      const reversed = segs[j].b === at;
      loop.push({ shape: segs[j].s, reversed });
      at = reversed ? segs[j].a : segs[j].b;
    }
    if (at === start) loops.push(loop);
  }
  return loops;
}
