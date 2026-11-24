// Footprints on the Board: where a placed Footprint's pads and graphics land. DOM-free.
// A board Footprint is { id, componentId, at, rot, side, locked } (ADR-0015): its pads come
// from the Component's Footprint. On the back ('B') it is mirrored left-right and its layers
// flip (F.Cu <-> B.Cu). Rotation is degrees counter-clockwise on screen (+Y down).
import { footprintOf } from './project.js';

/** The Footprint's extent in its own frame: the courtyard when it has one, else the pads. */
export function footprintBox(fp) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  const crt = (fp?.graphics || []).find((g) => /CrtYd$/.test(g.layer || '') && g.type === 'rect');
  if (crt) { add(...crt.a); add(...crt.b); }
  else for (const p of fp?.pads || []) { add(p.at[0] - p.size[0] / 2, p.at[1] - p.size[1] / 2); add(p.at[0] + p.size[0] / 2, p.at[1] + p.size[1] / 2); }
  return x0 === Infinity ? { x0: -1e6, y0: -1e6, x1: 1e6, y1: 1e6 } : { x0, y0, x1, y1 };
}

/** local point -> board point for a placed Footprint (mirror for the back, rotate, move; rounded to nm). */
export function fpTransform(bf) {
  const t = ((bf.rot || 0) * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  const m = bf.side === 'B' ? -1 : 1;
  return ([x, y]) => {
    const lx = x * m;
    return [Math.round(bf.at[0] + lx * c + y * s), Math.round(bf.at[1] - lx * s + y * c)];
  };
}

/** A layer as it lands on the board: back-side Footprints swap F.* and B.*. */
export const flipLayer = (layer, side) => (side === 'B' ? layer.replace(/^F\./, '@').replace(/^B\./, 'F.').replace(/^@/, 'B.') : layer);

/** Pad -> Net name, from what the Board was last told (board.annotation). */
export function padNets(board) {
  const out = new Map();
  for (const [net, pads] of Object.entries(board.annotation?.nets || {})) for (const k of pads) out.set(k, net);
  return out;
}

/**
 * The pads of a board Footprint in board coordinates: { number, at, size, shape, drill, layers,
 * rot, net }. `rot` is the pad's total rotation; `layers` are flipped for the back.
 */
export function placedPads(project, bf, nets = padNets(project.board)) {
  const fp = footprintOf(project, project.components[bf.componentId]);
  if (!fp) return [];
  const T = fpTransform(bf);
  return fp.pads.map((p) => ({
    number: p.number, at: T(p.at), size: p.size, shape: p.shape, drill: p.drill || 0,
    layers: (p.layers || []).map((l) => flipLayer(l, bf.side)), rot: ((bf.rot || 0) + (p.rot || 0)) % 360,
    net: nets.get(`${bf.componentId}:${p.number}`) || '',
  }));
}
