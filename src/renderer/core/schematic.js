// Schematic editing commands (DOM-free). Each is a mutation the editor runs inside one
// History transaction, so every user action is exactly one undo step.
import { addComponent, partOf, pruneOrphans } from './project.js';
import { place } from './geom.js';
import { snapPt, SCH_GRID } from './units.js';

/** Place a new Component's Unit on `sheet`, snapped to the 50 mil grid. */
export function placeSymbol(project, sheet, part, at, opts = {}) {
  return addComponent(project, sheet, part, snapPt(at, SCH_GRID), opts);
}

function symbolsById(project, ids) {
  const want = new Set(ids);
  return project.schematic.sheets.flatMap((s) => s.symbols).filter((y) => want.has(y.id));
}

/** Rotate 90° counter-clockwise (on screen) about each Symbol's own origin. */
export function rotateSymbols(project, ids) {
  for (const y of symbolsById(project, ids)) y.rot = ((y.rot || 0) + 90) % 360;
}

/** Mirror left-right. */
export function mirrorSymbols(project, ids) {
  for (const y of symbolsById(project, ids)) y.mirror = !y.mirror;
}

/** Delete Symbols; Components left with no placed Unit, and Parts nobody uses, go too. */
export function deleteSymbols(project, ids) {
  const gone = new Set(ids);
  for (const s of project.schematic.sheets) s.symbols = s.symbols.filter((y) => !gone.has(y.id));
  pruneOrphans(project);
}

/** The local-frame points that outline a Unit: its graphics and Pin tips. */
function unitPoints(unit) {
  const pts = [];
  for (const g of unit.graphics) {
    if (g.type === 'rect') pts.push(g.a, g.b, [g.a[0], g.b[1]], [g.b[0], g.a[1]]);
    else if (g.type === 'circle') pts.push([g.c[0] - g.r, g.c[1] - g.r], [g.c[0] + g.r, g.c[1] + g.r]);
    else if (g.pts) pts.push(...g.pts);
  }
  for (const pin of unit.pins) pts.push(pin.at);
  return pts;
}

/** World-space bounding box of a placed Symbol (graphics and Pins). */
export function symbolBounds(project, sym) {
  const part = partOf(project, project.components[sym.componentId]);
  const unit = part && part.units[sym.unit || 0];
  if (!unit) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of unitPoints(unit)) {
    const [x, y] = place(p, sym.at, sym.rot, sym.mirror);
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  return { x0, y0, x1, y1 };
}

/** Topmost Symbol on `sheet` under world point `pt`, within `tol` nm of its bounds. */
export function hitSymbol(project, sheet, pt, tol = 0) {
  for (let i = sheet.symbols.length - 1; i >= 0; i--) {
    const b = symbolBounds(project, sheet.symbols[i]);
    if (b && pt[0] >= b.x0 - tol && pt[0] <= b.x1 + tol && pt[1] >= b.y0 - tol && pt[1] <= b.y1 + tol) return sheet.symbols[i];
  }
  return null;
}
