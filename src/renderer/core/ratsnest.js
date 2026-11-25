// The Ratsnest (#17): airwires for every unrouted connection. DOM-free.
//
// For each Net, the Pads on it (from the Board's annotation record) and the copper carrying it
// (Tracks and Vias with that Net name) form islands: a Track end inside a Pad (on a layer the Pad
// has) or on another Track's end or a Via joins them. The airwires are a minimum spanning tree
// over the islands, each edge the shortest Pad-to-Pad (or copper end) distance between two
// islands. Recomputed on every change, so it follows a drag live. Zone fills, when given, are
// copper too: each filled region joins what it reaches on its layer (a Pad through its thermal
// spokes or solidly, a Via, a Track end), so a plane connects everything dropped onto it.
import { placedPads, padNets } from './footprint.js';

const low = (s) => s.toLowerCase();

class UF {
  constructor(n) { this.p = Array.from({ length: n }, (_, i) => i); }
  find(i) { while (this.p[i] !== i) { this.p[i] = this.p[this.p[i]]; i = this.p[i]; } return i; }
  union(a, b) { this.p[this.find(a)] = this.find(b); }
}

/** Is point `q` inside pad `pad` (its rotated rectangle, or circle)? */
function inPad(q, pad) {
  const t = (-pad.rot * Math.PI) / 180, dx = q[0] - pad.at[0], dy = q[1] - pad.at[1];
  const lx = dx * Math.cos(t) - dy * Math.sin(t), ly = dx * Math.sin(t) + dy * Math.cos(t);
  return Math.abs(lx) <= pad.size[0] / 2 && Math.abs(ly) <= pad.size[1] / 2;
}
const onLayer = (pad, layer) => pad.layers.includes(layer) || pad.layers.includes('*.Cu');
const same = (a, b) => a[0] === b[0] && a[1] === b[1];

/** Is q inside ring (even-odd)? */
function inRing(q, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > q[1]) !== (yj > q[1]) && q[0] < ((xj - xi) * (q[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/** A filled region ([outer, ...holes]) as a Ratsnest node's shape: its rings and their box. */
function region(poly) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of poly[0]) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  return { rings: poly, box: { x0, y0, x1, y1 } };
}
const inRegion = (q, r) => q[0] >= r.box.x0 && q[0] <= r.box.x1 && q[1] >= r.box.y0 && q[1] <= r.box.y1 && inRing(q, r.rings[0]) && !r.rings.slice(1).some((h) => inRing(q, h));
// a little past an edge: where thermal spokes (along a Pad's axes) meet it
const REACH = 60_000;
/** Points that show a fill reaches a Pad: its centre (solid) and just past the middle of each side (spokes). */
function padProbes(pad) {
  const t = (pad.rot * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  const hx = pad.size[0] / 2 + REACH, hy = pad.size[1] / 2 + REACH;
  return [[0, 0], [hx, 0], [-hx, 0], [0, hy], [0, -hy]].map(([x, y]) => [pad.at[0] + x * c + y * s, pad.at[1] - x * s + y * c]);
}
const viaProbes = (v) => { const r = v.diameter / 2 + REACH; return [v.at, [v.at[0] + r, v.at[1]], [v.at[0] - r, v.at[1]], [v.at[0], v.at[1] + r], [v.at[0], v.at[1] - r]]; };

/**
 * Airwires: [{ net, a, b }] (board points), plus per-Net counts { [net]: unrouted } for status.
 * `board` defaults to the Project's (pass a preview while dragging).
 */
export function ratsnest(project, board = project.board, fills = null) {
  const nets = padNets(board);
  const view = { ...project, board };
  const byNet = new Map(); // low(net) -> { name, nodes: [{ kind, pts, pad?, item? }] }
  const node = (net) => { const k = low(net); if (!byNet.has(k)) byNet.set(k, { name: net, nodes: [] }); return byNet.get(k); };
  for (const bf of board.footprints) for (const pad of placedPads(view, bf, nets)) if (pad.net) node(pad.net).nodes.push({ kind: 'pad', pts: [pad.at], pad });
  for (const t of board.tracks || []) if (t.net) node(t.net).nodes.push({ kind: 'track', pts: [t.a, t.b], item: t });
  for (const v of board.vias || []) if (v.net) node(v.net).nodes.push({ kind: 'via', pts: [v.at], item: v });
  if (fills) for (const z of board.zones || []) {
    if (!z.net || !byNet.has(low(z.net))) continue;
    for (const poly of fills.get(z.id)?.polys || []) if (poly[0]?.length > 2) node(z.net).nodes.push({ kind: 'fill', pts: [], layer: z.layer, region: region(poly) });
  }
  const wires = [];
  const unrouted = {};
  for (const { name, nodes } of byNet.values()) {
    if (nodes.filter((n) => n.kind === 'pad').length < 2) continue;
    const uf = new UF(nodes.length);
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) if (touch(nodes[i], nodes[j])) uf.union(i, j);
    // islands that hold at least one Pad need joining; bare copper islands only help
    const groups = new Map();
    nodes.forEach((n, i) => { const r = uf.find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(n); });
    const islands = [...groups.values()].filter((g) => g.some((n) => n.kind === 'pad')).map((g) => g.flatMap((n) => n.pts));
    // Prim's MST over islands, edge = closest pair of points
    const inTree = new Set([0]);
    let count = 0;
    while (inTree.size < islands.length) {
      let best = null;
      for (const i of inTree) for (let j = 0; j < islands.length; j++) {
        if (inTree.has(j)) continue;
        for (const a of islands[i]) for (const b of islands[j]) {
          const d = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
          if (!best || d < best.d) best = { d, a, b, j };
        }
      }
      inTree.add(best.j);
      wires.push({ net: name, a: best.a, b: best.b });
      count++;
    }
    if (count) unrouted[name] = count;
  }
  return { wires, unrouted };
}

function touch(x, y) {
  if (x.kind === 'fill' || y.kind === 'fill') {
    const [f, o] = x.kind === 'fill' ? [x, y] : [y, x];
    if (o.kind === 'fill') return false; // two fills of a Net join only through copper
    if (o.kind === 'pad') return onLayer(o.pad, f.layer) && padProbes(o.pad).some((q) => inRegion(q, f.region));
    if (o.kind === 'via') return viaProbes(o.item).some((q) => inRegion(q, f.region)); // Vias go through every layer
    return o.item.layer === f.layer && o.pts.some((q) => inRegion(q, f.region));
  }
  if (x.kind === 'pad' && y.kind === 'pad') return false; // Pads join only through copper
  if (x.kind === 'pad' || y.kind === 'pad') {
    const [p, o] = x.kind === 'pad' ? [x, y] : [y, x];
    if (o.kind === 'via') return inPad(o.item.at, p.pad);
    return o.pts.some((q) => inPad(q, p.pad) && onLayer(p.pad, o.item.layer));
  }
  if (x.kind === 'via' || y.kind === 'via') {
    const [v, o] = x.kind === 'via' ? [x, y] : [y, x];
    if (o.kind === 'via') return same(v.item.at, o.item.at);
    return o.pts.some((q) => Math.hypot(q[0] - v.item.at[0], q[1] - v.item.at[1]) <= v.item.diameter / 2);
  }
  return x.item.layer === y.item.layer && x.pts.some((a) => y.pts.some((b) => same(a, b)));
}
