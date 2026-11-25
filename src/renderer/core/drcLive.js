// Live DRC (#85): what changed on the Board since the last check, as the areas to re-check. Each
// item the copper checks look at (Tracks, Vias, Footprints, Zones, copper drawings) gets a
// signature and a box; an edit's areas are the old and new boxes of the items it changed. Changes
// that reach the whole board (rules, Net classes, the stack, the Outline, the Board's record of the
// Schematic) ask for a full run instead. DOM-free.
import { footprintOutline, placedPads, padNets, bfFootprint } from './footprint.js';
import { footprintOf } from './project.js';
import { drawingBox } from './boardDrawings.js';
import { copperLayerNames } from './board.js';
import { maxClearance } from './collision.js';

const box = (pts, m = 0) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return x0 === Infinity ? null : { x0: x0 - m, y0: y0 - m, x1: x1 + m, y1: y1 + m };
};

/**
 * Every item the copper checks look at: key -> { sig, box }, and `global`, a signature of what
 * affects the whole board.
 */
export function boardItems(project, board = project.board) {
  const items = new Map();
  for (const t of board.tracks || []) items.set(`t:${t.id}`, { sig: JSON.stringify(t), box: box([t.a, t.b], t.width / 2) });
  for (const v of board.vias || []) items.set(`v:${v.id}`, { sig: JSON.stringify(v), box: box([v.at], v.diameter / 2) });
  const nets = padNets(board), view = { ...project, board };
  for (const bf of board.footprints || []) {
    const comp = project.components[bf.componentId];
    const pads = placedPads(view, bf, nets);
    const pts = [...footprintOutline(view, bf), ...pads.flatMap((p) => { const r = Math.hypot(...p.size) / 2; return [[p.at[0] - r, p.at[1] - r], [p.at[0] + r, p.at[1] + r]]; })];
    items.set(`f:${bf.id}`, { sig: JSON.stringify([bf.at, bf.rot, bf.side, comp?.footprint, bfFootprint(project, bf)?.name, bf.fpKey, bf.padNets]), box: box(pts) });
  }
  for (const z of board.zones || []) items.set(`z:${z.id}`, { sig: JSON.stringify(z), box: box(z.outline) });
  const copper = new Set(copperLayerNames(board.stack.copper));
  for (const d of board.drawings || []) if (copper.has(d.layer)) items.set(`d:${d.id}`, { sig: JSON.stringify(d), box: drawingBox(d, board.textFont || 'stroke') });
  const global = JSON.stringify([board.rules, board.netClasses, board.stack, board.outline, board.textFont, board.annotation]);
  // a problem is placed between its two items: re-check as far round a change as the largest clearance
  const margin = maxClearance(board) + 100_000;
  return { items, global, margin };
}

/**
 * The areas to re-check after the board went from `prev` to `next` (boardItems results): the old
 * and new boxes of every item added, removed or changed, grown by the largest clearance (a problem
 * is placed between its two items). `full`: the change reaches the whole board.
 */
export function changedAreas(prev, next) {
  if (!prev || prev.global !== next.global) return { full: true, areas: [] };
  const areas = [], m = next.margin || 0;
  const add = (b) => b && areas.push({ x0: b.x0 - m, y0: b.y0 - m, x1: b.x1 + m, y1: b.y1 + m });
  for (const [k, n] of next.items) { const p = prev.items.get(k); if (!p || p.sig !== n.sig) { add(p?.box); add(n.box); } }
  for (const [k, p] of prev.items) if (!next.items.has(k)) add(p.box);
  return { full: false, areas };
}
