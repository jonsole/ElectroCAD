// Design rule check (#25): a pure function of the Project and its Zone fills, returning the
// places where the Board breaks its Design rules (board.rules and the Net classes) or isn't
// finished. Uses the collision engine for copper clearance. DOM-free.
//
//   runDrc(project, fills?) -> [{ id, rule, severity: 'error' | 'warning', message, at, box, layer?, items, show? }]
//
// at: [x, y] where to look (null when there's no one place); box: the area to zoom to.
// show (#80): what to draw for it. shapes: the items' copper (collision shapes: capsule | poly);
// gap: { a, b, d }, the closest points of the two shapes' edges and the distance between them;
// need: the clearance or size the rule asks for; outlines / overlap: courtyard rings and their
// overlap; wire: an unrouted connection [a, b]; label: a short note to draw (sizes).
import ClipperLib from 'clipper-lib';
import { copperIndex, shapeDistance, shapeBox, clearanceBetween, netRules, pointSeg2 } from './collision.js';
import { fpTransform, flipLayer, placedPads, padNets } from './footprint.js';
import { footprintOf } from './project.js';
import { checkOutline } from './board.js';
import { outlineSegments } from './walkaround.js';
import { boardArea } from './zones.js';
import { netClassOf } from './netclasses.js';
import { ratsnest } from './ratsnest.js';
import { changeList, isEmpty } from './annotate.js';

/** The checks, in the order the panel lists them, with plain names. */
export const DRC_RULES = [
  ['clearance', 'Clearance'],
  ['edge', 'Edge clearance'],
  ['width', 'Track width'],
  ['ring', 'Annular ring'],
  ['hole', 'Hole size'],
  ['courtyard', 'Courtyard overlap'],
  ['outline', 'Board outline'],
  ['unrouted', 'Unrouted'],
  ['annotation', 'Schematic/Board mismatch'],
];

const mmText = (nm) => `${+(nm / 1e6).toFixed(3)} mm`;
const mid = (a, b) => [Math.round((a[0] + b[0]) / 2), Math.round((a[1] + b[1]) / 2)];
const boxAround = (p, r) => ({ x0: p[0] - r, y0: p[1] - r, x1: p[0] + r, y1: p[1] + r });
const merge = (a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });

// ---------------------------------------------------------------- geometry

function closestOnSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)) : 0;
  return [a[0] + t * dx, a[1] + t * dy];
}
/** The closest pair of points between segments ab and cd. */
function closestSegs(a, b, c, d) {
  const cands = [[a, closestOnSeg(a, c, d)], [b, closestOnSeg(b, c, d)], [closestOnSeg(c, a, b), c], [closestOnSeg(d, a, b), d]];
  // crossing: the crossing point
  const den = (b[0] - a[0]) * (d[1] - c[1]) - (b[1] - a[1]) * (d[0] - c[0]);
  if (den) {
    const t = ((c[0] - a[0]) * (d[1] - c[1]) - (c[1] - a[1]) * (d[0] - c[0])) / den;
    const u = ((c[0] - a[0]) * (b[1] - a[1]) - (c[1] - a[1]) * (b[0] - a[0])) / den;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) { const p = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]; return [p, p]; }
  }
  let best = cands[0], bd = Infinity;
  for (const [p, q] of cands) { const dd = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2; if (dd < bd) { bd = dd; best = [p, q]; } }
  return best;
}
const edges = (s) => (s.type === 'capsule' ? [[s.a, s.b]] : s.pts.map((p, i) => [p, s.pts[(i + 1) % s.pts.length]]));
/** Where two shapes come closest (the midpoint between them). */
function nearestPoint(s, t) {
  let best = null, bd = Infinity;
  for (const [a, b] of edges(s)) for (const [c, d] of edges(t)) {
    const [p, q] = closestSegs(a, b, c, d);
    const dd = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2;
    if (dd < bd) { bd = dd; best = mid(p, q); }
  }
  return best;
}

/**
 * The closest points of two shapes' edges (capsules include their radius) and the distance between
 * them (0 or less when they touch or overlap): { a, b, d }.
 */
export function closestPair(s, t) {
  let best = null, bd = Infinity;
  for (const [a, b] of edges(s)) for (const [c, d] of edges(t)) {
    const [p, q] = closestSegs(a, b, c, d);
    const dd = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2;
    if (dd < bd) { bd = dd; best = [p, q]; }
  }
  const [p, q] = best, L = Math.sqrt(bd);
  const rs = s.type === 'capsule' ? s.r : 0, rt = t.type === 'capsule' ? t.r : 0;
  const ux = L ? (q[0] - p[0]) / L : 1, uy = L ? (q[1] - p[1]) / L : 0;
  const r2 = (v) => Math.round(v);
  return { a: [r2(p[0] + ux * rs), r2(p[1] + uy * rs)], b: [r2(q[0] - ux * rt), r2(q[1] - uy * rt)], d: Math.round(shapeDistance(s, t)) };
}

function inRings(p, rings) {
  let inside = false;
  for (const pts of rings) for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// ---------------------------------------------------------------- naming things

function namer(project) {
  const board = project.board;
  const ref = (bf) => board.annotation?.components?.[bf.componentId]?.ref || project.components[bf.componentId]?.ref || '?';
  const net = (n) => (n ? n : 'no net');
  return (it) => {
    if (it.kind === 'pad') return `${ref(it.footprint)} pad ${it.item.number} (${net(it.net)})`;
    if (it.kind === 'via') return `via (${net(it.net)})`;
    if (it.kind === 'zone') return `zone (${net(it.net)})`;
    if (it.kind === 'drawing') return it.item.type === 'text' ? `board text "${it.item.text}"` : `board ${it.item.type === 'poly' ? 'polygon' : it.item.type === 'rect' ? 'rectangle' : it.item.type}`;
    return `track (${net(it.net)})`; // the layer is in the violation's heading
  };
}

// ---------------------------------------------------------------- the checks

/** The checks that look at copper in one place: a live re-check (#85) runs them over an area only. */
export const LOCAL_RULES = new Set(['clearance', 'edge', 'width', 'ring', 'hole', 'courtyard']);
/** Board-wide checks a re-check leaves as they were: a board edit can't change them. */
const KEPT_RULES = new Set(['annotation']);

const inBox = (p, b) => p && p[0] >= b.x0 && p[0] <= b.x1 && p[1] >= b.y0 && p[1] <= b.y1;
const boxesMeet = (a, b) => a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0;
const grow = (b, m) => ({ x0: b.x0 - m, y0: b.y0 - m, x1: b.x1 + m, y1: b.y1 + m });

/** Is result `v` one an area re-check of `areas` stands for (a local check whose place is in one)? */
export const inAreas = (v, areas) => LOCAL_RULES.has(v.rule) && !!v.at && areas.some((b) => inBox(v.at, b));

/**
 * After a re-check of `areas` (#85): the old results with the local ones there and every board-wide
 * one replaced by `fresh`, in the usual order.
 */
export function mergeDrc(old, fresh, areas) {
  const keep = old.filter((v) => (LOCAL_RULES.has(v.rule) && !inAreas(v, areas)) || KEPT_RULES.has(v.rule));
  return sortDrc([...keep, ...fresh]);
}

const sortDrc = (list) => {
  const order = Object.fromEntries(DRC_RULES.map(([k], i) => [k, i]));
  return list.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1) || order[a.rule] - order[b.rule]);
};

/**
 * Run every check. `fills`: the Zone fills (id -> { polys }) to check too (the editor waits for
 * any refill in progress first). `areas` (boxes, #85): check the copper only there (results placed
 * inside them, the same as a full run gives there), and the board-wide checks in full; merge with
 * mergeDrc.
 */
export function runDrc(project, fills = new Map(), { areas = null, rats = null } = {}) {
  const board = project.board;
  const rules = board.rules;
  const maxC = Math.max(rules.clearance || 0, rules.edgeClearance || 0, ...Object.values(board.netClasses || {}).map((c) => c.clearance || 0));
  // the copper that can make a problem placed in the areas: within the largest clearance of them
  const reach = areas && areas.map((b) => grow(b, maxC + 1_000_000));
  const near = (b) => !reach || reach.some((r) => boxesMeet(b, r));
  const out = [];
  const add = (v) => out.push({ layer: null, items: [], ...v, id: `${v.rule}:${(v.items || []).join('|')}:${v.at ? v.at.join(',') : ''}` });
  const name = namer(project);
  const index = copperIndex(project, board);

  // copper clearance, per Net class (Zones' fills by their edges: they are made with holes round foreign copper)
  for (const z of board.zones || []) {
    const f = fills.get(z.id);
    if (!f) continue;
    for (const poly of f.polys) for (const ring of poly) for (let i = 0; i < ring.length; i++) {
      const shape = { type: 'capsule', a: ring[i], b: ring[(i + 1) % ring.length], r: 0 };
      if (reach && !near(shapeBox(shape))) continue;
      index.add({ kind: 'zone', id: z.id, net: z.net, layer: z.layer, layers: new Set([z.layer]), shape, item: z });
    }
  }
  const pairs = new Map();
  // a re-check looks from the copper near its areas (it still meets everything in the index)
  const local = reach ? index.items.filter((it) => near(it.box)) : index.items;
  for (const it of local) {
    for (const layer of it.layers) {
      for (const other of index.collisions(board, it.shape, layer, it.net, new Set([it.id]))) {
        if (it.kind === 'zone' && other.kind === 'zone') continue; // zone against zone: their priorities decide
        if (it.kind === 'drawing' && other.kind === 'drawing') continue; // drawings may overlap one another
        const key = [it.id, other.id].sort().join('|') + '@' + layer;
        const d = shapeDistance(it.shape, other.shape);
        const prev = pairs.get(key);
        if (!prev || d < prev.d) pairs.set(key, { a: it, b: other, d, layer });
      }
    }
  }
  for (const { a, b, d, layer } of pairs.values()) {
    const need = clearanceBetween(board, a.net, b.net);
    const at = nearestPoint(a.shape, b.shape);
    const cls = [...new Set([netClassOf(board, a.net), netClassOf(board, b.net)])].join('/');
    // the halo goes round the item that isn't a zone edge (or the first)
    const [h1, h2] = a.kind === 'zone' && b.kind !== 'zone' ? [b, a] : [a, b];
    const show = { shapes: [h1.shape, h2.shape], gap: closestPair(h1.shape, h2.shape), need };
    add({ rule: 'clearance', severity: 'error', layer, at, box: boxAround(at, Math.max(need * 6, 1_500_000)), items: [a.id, b.id], show,
      message: `${name(a)} and ${name(b)} ${d <= 0 ? 'touch' : `are ${mmText(Math.max(0, d))} apart`}; ${mmText(need)} needed (${cls}).` });
  }

  // the board outline, and copper too near its edge or off the board
  const oc = checkOutline(board.outline || []);
  if ((board.outline || []).length && !oc.closed) {
    for (const p of oc.openEnds.length ? oc.openEnds : [null]) add({ rule: 'outline', severity: 'error', at: p, box: p ? boxAround(p, 3_000_000) : null, message: `The Outline isn't closed${p ? ' here' : ''}: ${oc.problems.join(' ')}` });
  }
  const segs = outlineSegments(board.outline || []);
  const area = oc.closed ? boardArea(board.outline) : null;
  const rings = area ? area.map((path) => path.map((q) => [q.X, q.Y])) : null;
  const edge = rules.edgeClearance || 0;
  const edgeSeen = new Set(); // a drawing is one item made of many segments: report it once
  for (const it of local) {
    if (it.kind === 'zone') continue; // fills are cut back from the edge
    if (it.kind === 'drawing') { if (edgeSeen.has(it.id)) continue; }
    const probe = it.shape.type === 'capsule' ? it.shape.a : it.shape.pts[0];
    if (rings && !inRings(probe, rings)) {
      edgeSeen.add(it.id);
      add({ rule: 'edge', severity: 'error', at: probe, box: boxAround(probe, 2_000_000), items: [it.id], layer: [...it.layers][0], show: { shapes: [it.shape] }, message: `${name(it)} is off the board.` });
      continue;
    }
    let worst = null;
    for (const [a, b] of segs) {
      const e = { type: 'capsule', a, b, r: 0 };
      const d = shapeDistance(it.shape, e);
      if (d < edge && (!worst || d < worst.d)) worst = { d, e };
    }
    if (worst) {
      const at = nearestPoint(it.shape, worst.e);
      edgeSeen.add(it.id);
      add({ rule: 'edge', severity: 'error', at, box: boxAround(at, Math.max(edge * 6, 1_500_000)), items: [it.id], layer: [...it.layers][0], show: { shapes: [it.shape, worst.e], gap: closestPair(it.shape, worst.e), need: edge }, message: `${name(it)} is ${mmText(Math.max(0, worst.d))} from the board edge; ${mmText(edge)} needed.` });
    }
  }

  // track width (narrower than its Net class's), annular ring and hole size
  for (const t of board.tracks || []) {
    const need = netRules(board, t.net).trackWidth;
    if (t.width < need) { const at = mid(t.a, t.b); add({ rule: 'width', severity: 'error', at, box: merge(boxAround(t.a, 1_000_000), boxAround(t.b, 1_000_000)), items: [t.id], layer: t.layer, show: { shapes: [{ type: 'capsule', a: t.a, b: t.b, r: t.width / 2 }], label: `${mmText(t.width)} wide · ${mmText(need)} needed`, labelAt: at }, message: `Track (${t.net || 'no net'}) is ${mmText(t.width)} wide; its ${netClassOf(board, t.net)} class needs ${mmText(need)}.` }); }
  }
  const holes = [];
  for (const v of board.vias || []) holes.push({ id: v.id, at: v.at, drill: v.drill, copper: v.diameter, what: `Via (${v.net || 'no net'})` });
  const nets = padNets(board), view = { ...project, board };
  for (const bf of board.footprints || []) {
    for (const pad of placedPads(view, bf, nets)) {
      if (!(pad.drill > 0)) continue;
      const tht = pad.layers.some((l) => /Cu$/.test(l));
      holes.push({ id: `${bf.id}:${pad.number}:${pad.at.join(',')}`, at: pad.at, drill: pad.drill, copper: tht ? Math.min(...pad.size) : null, what: `${name({ kind: 'pad', footprint: bf, item: pad, net: pad.net })}` });
    }
  }
  for (const hl of holes) {
    const drillShape = { type: 'capsule', a: hl.at, b: hl.at, r: hl.drill / 2 };
    if (hl.drill < rules.minHole) add({ rule: 'hole', severity: 'error', at: hl.at, box: boxAround(hl.at, 2_000_000), items: [hl.id], show: { shapes: [drillShape], label: `${mmText(hl.drill)} drill · ${mmText(rules.minHole)} minimum`, labelAt: hl.at }, message: `${hl.what}: ${mmText(hl.drill)} drill is under the ${mmText(rules.minHole)} minimum hole.` });
    if (hl.copper != null) {
      const ring = (hl.copper - hl.drill) / 2;
      if (ring < rules.annularRing) add({ rule: 'ring', severity: 'error', at: hl.at, box: boxAround(hl.at, 2_000_000), items: [hl.id], show: { shapes: [{ type: 'capsule', a: hl.at, b: hl.at, r: hl.copper / 2 }, drillShape], label: `ring ${mmText(Math.max(0, ring))} · ${mmText(rules.annularRing)} needed`, labelAt: hl.at }, message: `${hl.what}: annular ring ${mmText(Math.max(0, ring))}; ${mmText(rules.annularRing)} needed.` });
    }
  }

  // courtyards of Footprints on the same side that overlap
  const yards = [];
  for (const bf of board.footprints || []) {
    const fp = footprintOf(project, project.components[bf.componentId]);
    if (!fp) continue;
    const T = fpTransform(bf);
    const paths = [];
    for (const g of fp.graphics || []) {
      if (!/CrtYd$/.test(g.layer || '')) continue;
      let pts = null;
      if (g.type === 'rect') pts = [g.a, [g.b[0], g.a[1]], g.b, [g.a[0], g.b[1]]];
      else if (g.type === 'poly' || (g.type === 'line' && g.pts.length > 2)) pts = g.pts;
      else if (g.type === 'circle') pts = Array.from({ length: 32 }, (_, i) => [g.c[0] + g.r * Math.cos((i / 32) * 2 * Math.PI), g.c[1] + g.r * Math.sin((i / 32) * 2 * Math.PI)]);
      if (pts) paths.push(pts.map(T).map(([x, y]) => ({ X: Math.round(x), Y: Math.round(y) })));
    }
    if (paths.length) yards.push({ bf, side: bf.side === 'B' ? 'B' : 'F', paths, box: shapeBox({ type: 'poly', pts: paths.flat().map((q) => [q.X, q.Y]) }) });
  }
  for (let i = 0; i < yards.length; i++) for (let j = i + 1; j < yards.length; j++) {
    const a = yards[i], b = yards[j];
    if (reach && !(near(a.box) && near(b.box))) continue; // an overlap lies inside both courtyards
    if (a.side !== b.side || a.box.x0 >= b.box.x1 || b.box.x0 >= a.box.x1 || a.box.y0 >= b.box.y1 || b.box.y0 >= a.box.y1) continue;
    const c = new ClipperLib.Clipper();
    c.AddPaths(a.paths, ClipperLib.PolyType.ptSubject, true);
    c.AddPaths(b.paths, ClipperLib.PolyType.ptClip, true);
    const sol = new ClipperLib.Paths();
    c.Execute(ClipperLib.ClipType.ctIntersection, sol, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
    const overlap = sol.reduce((s, p) => s + Math.abs(ClipperLib.Clipper.Area(p)), 0);
    if (overlap <= 1e6) continue; // more than touching (1 µm²·10⁶)
    const ob = shapeBox({ type: 'poly', pts: sol.flat().map((q) => [q.X, q.Y]) });
    const at = [Math.round((ob.x0 + ob.x1) / 2), Math.round((ob.y0 + ob.y1) / 2)];
    const ref = (bf) => board.annotation?.components?.[bf.componentId]?.ref || project.components[bf.componentId]?.ref || '?';
    const ring = (p) => p.map((q) => [q.X, q.Y]);
    add({ rule: 'courtyard', severity: 'error', at, box: merge(a.box, b.box), items: [a.bf.id, b.bf.id], layer: `${a.side}.CrtYd`, show: { outlines: [...a.paths.map(ring), ...b.paths.map(ring)], overlap: sol.map(ring) }, message: `${ref(a.bf)} and ${ref(b.bf)} courtyards overlap (${a.side === 'B' ? 'back' : 'front'}).` });
  }

  // unrouted connections
  for (const w of (rats || ratsnest(project, board, fills)).wires) {
    const at = mid(w.a, w.b);
    add({ rule: 'unrouted', severity: 'warning', at, box: merge(boxAround(w.a, 1_500_000), boxAround(w.b, 1_500_000)), items: [w.net], show: { wire: [w.a, w.b] }, message: `${w.net} is not routed here (${mmText(Math.round(Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1])))}).` });
  }

  // the Schematic has changes the Board hasn't had (Forward annotation pending)
  const ch = areas ? null : changeList(project); // a re-check keeps the last result (mergeDrc)
  if (ch && !isEmpty(ch) && ch.changes.length) {
    add({ rule: 'annotation', severity: 'warning', at: null, box: null, message: `The Schematic has ${ch.changes.length} change${ch.changes.length === 1 ? '' : 's'} the Board doesn't: Update from Schematic (F8).` });
  }

  // a re-check gives the local results placed in its areas, and every board-wide one
  return sortDrc(areas ? out.filter((v) => !LOCAL_RULES.has(v.rule) || inAreas(v, areas)) : out);
}

/** Counts by severity: { error, warning }. */
export const drcCounts = (list) => ({ error: list.filter((v) => v.severity === 'error').length, warning: list.filter((v) => v.severity === 'warning').length });

export { pointSeg2 };
