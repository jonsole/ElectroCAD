// The Ratsnest (#17): airwires for every unrouted connection. DOM-free.
//
// For each Net, the Pads on it (from the Board's annotation record) and the copper carrying it
// (Tracks and Vias with that Net name) form islands: a Track end inside a Pad (on a layer the Pad
// has) or on another Track's end or a Via joins them. The airwires are a minimum spanning tree
// over the islands, each edge the shortest Pad-to-Pad (or copper end) distance between two
// islands. Recomputed on every change, so it follows a drag live.
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

/**
 * Airwires: [{ net, a, b }] (board points), plus per-Net counts { [net]: unrouted } for status.
 * `board` defaults to the Project's (pass a preview while dragging).
 */
export function ratsnest(project, board = project.board) {
  const nets = padNets(board);
  const view = { ...project, board };
  const byNet = new Map(); // low(net) -> { name, nodes: [{ kind, pts, pad?, item? }] }
  const node = (net) => { const k = low(net); if (!byNet.has(k)) byNet.set(k, { name: net, nodes: [] }); return byNet.get(k); };
  for (const bf of board.footprints) for (const pad of placedPads(view, bf, nets)) if (pad.net) node(pad.net).nodes.push({ kind: 'pad', pts: [pad.at], pad });
  for (const t of board.tracks || []) if (t.net) node(t.net).nodes.push({ kind: 'track', pts: [t.a, t.b], item: t });
  for (const v of board.vias || []) if (v.net) node(v.net).nodes.push({ kind: 'via', pts: [v.at], item: v });
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
