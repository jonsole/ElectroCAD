// Schematic editing commands (DOM-free). Each is a mutation the editor runs inside one
// History transaction, so every user action is exactly one undo step.
import { addComponent, partOf, pruneOrphans, uid, pinPositions } from './project.js';
import { place, eq, distToSegment2, onSegment, rot90 } from './geom.js';
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
export function deleteSymbols(project, ids) { deleteItems(project, ids); }

/** Delete Symbols and Wires by id (one command for a mixed selection). */
export function deleteItems(project, ids) {
  const gone = new Set(ids);
  for (const s of project.schematic.sheets) {
    s.symbols = s.symbols.filter((y) => !gone.has(y.id));
    s.wires = s.wires.filter((w) => !gone.has(w.id));
  }
  pruneOrphans(project);
}

/**
 * Add a Wire through `points` (a polyline of orthogonal or diagonal runs) as segments. Points
 * snap to the grid, zero-length runs are dropped and straight runs merged. Returns the new
 * segments.
 */
export function addWire(project, sheet, points) {
  const pts = [];
  for (const p of points.map((q) => snapPt(q, SCH_GRID))) {
    if (pts.length && eq(pts[pts.length - 1], p)) continue;
    if (pts.length >= 2) {
      const [a, b] = [pts[pts.length - 2], pts[pts.length - 1]];
      const cross = (b[0] - a[0]) * (p[1] - b[1]) - (b[1] - a[1]) * (p[0] - b[0]);
      const sameWay = (b[0] - a[0]) * (p[0] - b[0]) + (b[1] - a[1]) * (p[1] - b[1]) > 0;
      if (cross === 0 && sameWay) { pts[pts.length - 1] = p; continue; } // straight on: extend
    }
    pts.push(p);
  }
  const segs = [];
  for (let i = 1; i < pts.length; i++) segs.push({ id: uid('w'), a: pts[i - 1], b: pts[i] });
  sheet.wires.push(...segs);
  return segs;
}

/** The Wire on `sheet` nearest to `pt` within `tol` nm, or null. */
export function hitWire(sheet, pt, tol) {
  let best = null, bestD = tol * tol;
  for (const w of sheet.wires) {
    const d = distToSegment2(pt, w.a, w.b);
    if (d <= bestD) { best = w; bestD = d; }
  }
  return best;
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

// ---------------------------------------------------------------- wire routing

const segAxis = (a, b) => (a[1] === b[1] && a[0] !== b[0] ? 'h' : a[0] === b[0] && a[1] !== b[1] ? 'v' : null);

/**
 * Which way a new Wire run should start from `from`: the direction it is already going (the last
 * run of the Wire being drawn), else the direction of an existing Wire ending at `from`, else
 * straight out of a Pin at `from`, else horizontal. Returns 'h' or 'v'.
 */
export function preferredAxis(project, sheet, from, drawn = []) {
  if (drawn.length >= 2) {
    const ax = segAxis(drawn[drawn.length - 2], drawn[drawn.length - 1]);
    if (ax) return ax;
  }
  for (const w of sheet.wires) {
    if (eq(w.a, from) || eq(w.b, from)) { const ax = segAxis(w.a, w.b); if (ax) return ax; }
  }
  for (const sym of sheet.symbols) {
    for (const { pin, at } of pinPositions(project, sym)) {
      if (!eq(at, from)) continue;
      const d = { L: [-1, 0], R: [1, 0], U: [0, -1], D: [0, 1] }[pin.dir] || [1, 0];
      const w = rot90(d, sym.rot, sym.mirror);
      return w[0] !== 0 ? 'h' : 'v';
    }
  }
  return 'h';
}

/**
 * Orthogonal route from `from` to `to` with at most one corner. `axis` 'h' goes horizontal
 * first, 'v' vertical first; with `auto`, the preferred axis is tried first and the other is
 * used when the preferred one would run through a Pin (connecting it by accident).
 * Returns the points after `from`.
 */
export function routeWire(project, sheet, from, to, { axis = 'h', auto = true } = {}) {
  if (from[0] === to[0] || from[1] === to[1]) return [to];
  const h = [[to[0], from[1]], to], v = [[from[0], to[1]], to];
  const first = axis === 'v' ? v : h, second = axis === 'v' ? h : v;
  if (!auto) return first;
  const pins = sheet.symbols.flatMap((y) => pinPositions(project, y).map((x) => x.at)).filter((q) => !eq(q, from) && !eq(q, to));
  const crosses = ([c]) => pins.some((q) => onSegment(q, from, c) || onSegment(q, c, to));
  return !crosses(first) ? first : !crosses(second) ? second : first;
}
