// Box selection on the Board, as on the Schematic: what a box dragged on empty space takes, and
// moving Tracks and Vias with a group. Dragged left to right it's a window (only what lies wholly
// inside); right to left a crossing box (anything it touches). DOM-free.
import { footprintOutline } from './footprint.js';
import { outlineBounds, copperLayerNames } from './board.js';
import { drawingBox } from './boardDrawings.js';
import { trackBox, trackShape } from './trackGeom.js';
import { shapeDistance } from './collision.js';

const inside = (b, r) => b.x0 >= r.x0 && b.y0 >= r.y0 && b.x1 <= r.x1 && b.y1 <= r.y1;
const meets = (b, r) => b.x0 <= r.x1 && b.x1 >= r.x0 && b.y0 <= r.y1 && b.y1 >= r.y0;
const boxOf = (pts) => { const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]); return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }; };

/**
 * What box `r` ({ x0, y0, x1, y1 }, nm) takes on `board`: { fps, copper (Track and Via ids), zones,
 * drawings, outline (indices) }. `mode`: 'window' (wholly inside) or 'crossing' (touching);
 * `hidden`: layers not shown, whose items are left out.
 */
export function boardItemsInBox(project, board, r, mode = 'window', hidden = new Set()) {
  const take = (b) => (mode === 'window' ? inside(b, r) : meets(b, r));
  const rect = { type: 'poly', pts: [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]] };
  const out = { fps: [], copper: [], zones: [], drawings: [], outline: [] };
  for (const bf of board.footprints || []) {
    if (hidden.has(bf.side === 'B' ? 'B.Cu' : 'F.Cu') && hidden.has(bf.side === 'B' ? 'B.SilkS' : 'F.SilkS')) continue;
    const pts = footprintOutline(project, bf);
    if (pts.length && take(boxOf(pts))) out.fps.push(bf.id);
  }
  for (const t of board.tracks || []) {
    if (hidden.has(t.layer)) continue;
    const b = trackBox(t);
    // a crossing box takes a Track its copper touches, not just its box
    if (mode === 'window' ? inside(b, r) : meets(b, r) && shapeDistance(trackShape(t), rect) <= 0) out.copper.push(t.id);
  }
  const cu = copperLayerNames(board.stack?.copper || 2);
  for (const v of board.vias || []) {
    if (cu.every((l) => hidden.has(l))) continue;
    const h = v.diameter / 2;
    if (take({ x0: v.at[0] - h, y0: v.at[1] - h, x1: v.at[0] + h, y1: v.at[1] + h })) out.copper.push(v.id);
  }
  for (const z of board.zones || []) if (!hidden.has(z.layer) && z.outline?.length && take(boxOf(z.outline))) out.zones.push(z.id);
  for (const d of board.drawings || []) { const b = !hidden.has(d.layer) && drawingBox(d, board.textFont || 'stroke'); if (b && take(b)) out.drawings.push(d.id); }
  if (!hidden.has('Edge.Cuts')) (board.outline || []).forEach((sh, i) => { const b = outlineBounds([sh]); if (b && take(b)) out.outline.push(i); });
  return out;
}

/** Move the Tracks and Vias (ids) by d, in place; locked ones stay. */
export function moveCopper(board, ids, [dx, dy]) {
  const mv = (p) => [p[0] + dx, p[1] + dy];
  for (const t of board.tracks || []) if (ids.has(t.id) && !t.locked) { t.a = mv(t.a); t.b = mv(t.b); if (t.mid) t.mid = mv(t.mid); }
  for (const v of board.vias || []) if (ids.has(v.id) && !v.locked) v.at = mv(v.at);
}
