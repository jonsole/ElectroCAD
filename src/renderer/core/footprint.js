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
    number: p.number, at: T(p.at), size: p.size, shape: p.shape, drill: p.drill || 0, ...(p.innerSize ? { innerSize: p.innerSize } : {}), ...(p.chamfer != null ? { chamfer: p.chamfer } : {}), ...(p.corners ? { corners: p.corners } : {}),
    layers: (p.layers || []).map((l) => flipLayer(l, bf.side)), rot: ((bf.rot || 0) + (p.rot || 0)) % 360,
    net: nets.get(`${bf.componentId}:${p.number}`) || '',
  }));
}

/** Is this an inner copper layer (In1.Cu, In2.Cu)? */
export const isInnerLayer = (layer) => /^In\d+\.Cu$/.test(layer);

/**
 * A pad as it is on one copper layer (#82): a through-hole pad with an inner size is round, that
 * size, on the inner layers (Eagle's inner restring); everywhere else it is itself.
 */
export const padOnLayer = (pad, layer) => (pad.innerSize && isInnerLayer(layer) ? { ...pad, shape: 'circle', size: [pad.innerSize, pad.innerSize] } : pad);

/**
 * A placed pad split by the copper layers it is on, for code that keeps one shape per item: [{ pad,
 * layers }], the outer layers with the pad as it is, the inner ones with its inner shape (#82).
 */
export function padByLayers(pad, layers) {
  if (!pad.innerSize) return [{ pad, layers }];
  const inner = layers.filter(isInnerLayer), outer = layers.filter((l) => !isInnerLayer(l));
  return [...(outer.length ? [{ pad, layers: outer }] : []), ...(inner.length ? [{ pad: padOnLayer(pad, inner[0]), layers: inner }] : [])];
}

// ---------------------------------------------------------------- editing placed Footprints (#17)

/** A rotation in degrees, normalised to [0, 360) and rounded to 0.01° (ADR-0015). */
export const normRot = (deg) => { const r = Math.round((((deg % 360) + 360) % 360) * 100) / 100; return r === 360 ? 0 : r; };

/** The board Footprints with these ids that are not locked. */
const movable = (board, ids) => board.footprints.filter((f) => ids.includes(f.id) && !f.locked);

/** Move Footprints by `delta` (locked ones stay). */
export function moveFootprints(project, ids, [dx, dy]) {
  for (const f of movable(project.board, ids)) f.at = [f.at[0] + dx, f.at[1] + dy];
}

/**
 * Turn Footprints by `deg` counter-clockwise: one turns about its own origin, several about the
 * middle of their origins (so a group keeps its shape). Locked ones stay.
 */
export function rotateFootprints(project, ids, deg) {
  const fs = movable(project.board, ids);
  if (!fs.length) return;
  const c = fs.length === 1 ? fs[0].at : [fs.reduce((s, f) => s + f.at[0], 0) / fs.length, fs.reduce((s, f) => s + f.at[1], 0) / fs.length];
  const t = (deg * Math.PI) / 180, cos = Math.cos(t), sin = Math.sin(t);
  for (const f of fs) {
    const x = f.at[0] - c[0], y = f.at[1] - c[1];
    f.at = [Math.round(c[0] + x * cos + y * sin), Math.round(c[1] - x * sin + y * cos)];
    f.rot = normRot(f.rot + deg);
  }
}

/** Set one Footprint's rotation exactly. */
export function setFootprintRotation(project, id, deg) {
  const f = project.board.footprints.find((x) => x.id === id);
  if (f && !f.locked) f.rot = normRot(deg);
}

/**
 * Flip Footprints to the other side, each about its own origin: the side changes, the drawing is
 * mirrored left-right and the layers swap (F.* <-> B.*). Locked ones stay.
 */
export function flipFootprints(project, ids) {
  for (const f of movable(project.board, ids)) { f.side = f.side === 'B' ? 'F' : 'B'; f.rot = normRot(-f.rot); }
}

export function setLocked(project, ids, locked) {
  for (const f of project.board.footprints) if (ids.includes(f.id)) f.locked = !!locked;
}

/** A placed Footprint's courtyard (or pad extent) as a polygon of four board points. */
export function footprintOutline(project, bf) {
  const fp = footprintOf(project, project.components[bf.componentId]);
  const b = footprintBox(fp), T = fpTransform(bf);
  return [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]].map(T);
}

/** The topmost board Footprint under `pt` (front side first, unless `preferBack`), or null. */
export function hitFootprint(project, pt, { preferBack = false, hidden = new Set() } = {}) {
  const fs = project.board.footprints.filter((f) => !hidden.has(f.side === 'B' ? 'B.Cu' : 'F.Cu') || !hidden.has(f.side === 'B' ? 'B.CrtYd' : 'F.CrtYd'));
  const order = [...fs].sort((a, b) => ((a.side === 'B') === preferBack ? -1 : 1) - ((b.side === 'B') === preferBack ? -1 : 1));
  for (const f of order) if (insidePolygon(pt, footprintOutline(project, f))) return f;
  return null;
}

export function insidePolygon([x, y], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The pad under `pt` on a visible side: { bf, pad } or null (front first, unless `preferBack`). */
export function hitPad(project, pt, { preferBack = false } = {}) {
  const nets = padNets(project.board);
  const fs = [...project.board.footprints].sort((a, b) => ((a.side === 'B') === preferBack ? -1 : 1) - ((b.side === 'B') === preferBack ? -1 : 1));
  for (const bf of fs) {
    for (const pad of placedPads(project, bf, nets)) {
      const t = (-pad.rot * Math.PI) / 180, dx = pt[0] - pad.at[0], dy = pt[1] - pad.at[1];
      const lx = dx * Math.cos(t) - dy * Math.sin(t), ly = dx * Math.sin(t) + dy * Math.cos(t);
      if (Math.abs(lx) <= pad.size[0] / 2 && Math.abs(ly) <= pad.size[1] / 2) return { bf, pad };
    }
  }
  return null;
}
