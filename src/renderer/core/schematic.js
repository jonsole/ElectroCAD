// Schematic editing commands (DOM-free). Each is a mutation the editor runs inside one
// History transaction, so every user action is exactly one undo step.
import { addComponent, partOf, pruneOrphans, uid, pinPositions, nextRef, newSheet, addFootprint } from './project.js';
import { compareRefs } from './netlist.js';
import { labelBounds } from './labels.js';
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
  const want = new Set(ids);
  for (const s of project.schematic.sheets) for (const l of s.labels || []) if (want.has(l.id)) l.rot = ((l.rot || 0) + 90) % 360;
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
    s.labels = (s.labels || []).filter((l) => !gone.has(l.id));
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

/**
 * Add a Net label, Global label or Power symbol at a grid point. `scope` is 'local' or 'global';
 * Power symbols (style 'power' / 'gnd') are always global. Returns the label.
 */
export function addLabel(project, sheet, { at, net, rot = 0, scope = 'local', style = 'label' }) {
  sheet.labels ||= [];
  const power = style === 'power' || style === 'gnd';
  const l = { id: uid('l'), at: snapPt(at, SCH_GRID), rot, net: String(net).trim(), scope: power ? 'global' : scope, style };
  sheet.labels.push(l);
  return l;
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

// ---------------------------------------------------------------- moving with rubber-banding Wires (#8)

const add2 = (p, d) => [p[0] + d[0], p[1] + d[1]];
const ptKey = (p) => p[0] + ',' + p[1];

/**
 * Move Symbols and Wires by `delta` (grid-snapped by the caller). Wires attached to what moves
 * follow and stay orthogonal:
 *   - a Wire whose both ends move (or that is selected) moves as a whole;
 *   - a Wire with one moving end stretches; if its far end is a plain corner (joined only to
 *     Wires running across it), that corner slides along so the shape is kept; otherwise a corner
 *     is added so nothing goes diagonal.
 * Connectivity is unchanged.
 */
export function moveSelection(project, sheet, ids, delta) {
  if (!delta[0] && !delta[1]) return;
  const sel = new Set(ids);
  const movingSyms = sheet.symbols.filter((y) => sel.has(y.id));
  // points that move: Pins of moving Symbols and ends of selected Wires (old positions)
  const moving = new Set();
  for (const y of movingSyms) for (const { at } of pinPositions(project, y)) moving.add(ptKey(at));
  for (const w of sheet.wires) if (sel.has(w.id)) { moving.add(ptKey(w.a)); moving.add(ptKey(w.b)); }
  const labels = sheet.labels || [];
  const movingLabels = labels.filter((l) => sel.has(l.id));
  for (const y of movingSyms) y.at = add2(y.at, delta);

  const fixedPins = new Set();
  for (const y of sheet.symbols) if (!sel.has(y.id)) for (const { at } of pinPositions(project, y)) fixedPins.add(ptKey(at));

  const whole = [], stretch = [];
  for (const w of sheet.wires) {
    const am = moving.has(ptKey(w.a)), bm = moving.has(ptKey(w.b));
    if (sel.has(w.id) || (am && bm)) whole.push(w);
    else if (am || bm) stretch.push({ w, end: am ? 'a' : 'b' });
  }
  // a Wire end resting in the middle of a Wire that moves as a whole (a T-join) moves with it
  for (const w of sheet.wires) {
    if (whole.includes(w) || stretch.some((x) => x.w === w)) continue;
    const onMoving = (pt) => whole.some((m) => onSegment(pt, m.a, m.b));
    const am = onMoving(w.a), bm = onMoving(w.b);
    if (am && bm) whole.push(w);
    else if (am || bm) { moving.add(ptKey(am ? w.a : w.b)); stretch.push({ w, end: am ? 'a' : 'b' }); }
  }
  // a moving Wire end that sits on a Pin of a part that isn't moving stays connected: a short
  // run (with a corner if needed, leaving the Pin along the Wire's own direction) joins them
  const tethers = [];
  for (const w of whole) {
    const axis = w.a[1] === w.b[1] ? 'h' : 'v';
    for (const end of ['a', 'b']) {
      const P = w[end];
      if (!fixedPins.has(ptKey(P))) continue;
      const E = add2(P, delta);
      if (P[0] === E[0] || P[1] === E[1]) tethers.push({ id: uid('w'), a: P, b: E });
      else {
        const C = axis === 'h' ? [P[0], E[1]] : [E[0], P[1]]; // step across first, then along
        tethers.push({ id: uid('w'), a: P, b: C }, { id: uid('w'), a: C, b: E });
      }
    }
  }
  // labels sitting on Wires that move as a whole go along (unless selected: they move anyway)
  for (const l of labels) if (!sel.has(l.id) && whole.some((w) => onSegment(l.at, w.a, w.b))) movingLabels.push(l);
  for (const w of whole) { w.a = add2(w.a, delta); w.b = add2(w.b, delta); }
  for (const l of movingLabels) l.at = add2(l.at, delta);
  const added = [];
  const slid = new Map(); // corner key -> new point (so two Wires sharing a corner agree)
  for (const { w, end } of stretch) {
    const other = end === 'a' ? 'b' : 'a';
    const A = w[end], B = w[other];
    const horiz = A[1] === B[1];
    const A2 = add2(A, delta);
    const B2 = horiz ? [B[0], B[1] + delta[1]] : [B[0] + delta[0], B[1]];
    const bKey = ptKey(B);
    // can B slide? only if it's a plain corner: no fixed Pin there, not moving, not mid-Wire,
    // and every other Wire at B runs across this one (so it can stretch along its own axis)
    const others = sheet.wires.filter((x) => x !== w && (ptKey(x.a) === bKey || ptKey(x.b) === bKey));
    const midWire = sheet.wires.some((x) => x !== w && onSegment(B, x.a, x.b) && ptKey(x.a) !== bKey && ptKey(x.b) !== bKey);
    const across = others.every((x) => (horiz ? x.a[0] === x.b[0] : x.a[1] === x.b[1]) && !whole.includes(x) && !stretch.some((s) => s.w === x));
    // sliding moves the whole run sideways, which would break a T-join resting on it
    const tJoinOnIt = sheet.wires.some((x) => x !== w && [x.a, x.b].some((pt) => ptKey(pt) !== ptKey(A) && ptKey(pt) !== bKey && onSegment(pt, A, B)))
      || [...fixedPins].some((k) => { const [x, y] = k.split(',').map(Number); return k !== bKey && k !== ptKey(A) && onSegment([x, y], A, B); });
    const canSlide = (B2[0] !== B[0] || B2[1] !== B[1]) && others.length > 0 && !fixedPins.has(bKey) && !moving.has(bKey) && !midWire && across && !tJoinOnIt;
    if (canSlide || (B2[0] === B[0] && B2[1] === B[1])) {
      const target = slid.get(bKey) || B2;
      slid.set(bKey, target);
      w[end] = A2; w[other] = target;
      for (const x of others) { if (ptKey(x.a) === bKey) x.a = target; else x.b = target; }
    } else {
      // keep the original run on its line (so T-joins onto it stay connected): B runs along the
      // original axis to a corner level with the moved end, then a short run reaches A2
      const C = horiz ? [A2[0], B[1]] : [B[0], A2[1]];
      w[end] = C; w[other] = B;
      added.push({ id: uid('w'), a: C, b: A2 });
    }
  }
  sheet.wires.push(...added, ...tethers);
  // tidy: drop zero-length runs
  sheet.wires = sheet.wires.filter((w) => w.a[0] !== w.b[0] || w.a[1] !== w.b[1]);
}

// ---------------------------------------------------------------- copy / paste / box select (#8)

/** A clipboard of the selected Symbols (with their Components and Parts) and the selected Wires. */
export function copySelection(project, sheet, ids) {
  const sel = new Set(ids);
  const symbols = sheet.symbols.filter((y) => sel.has(y.id)).map((y) => structuredClone(y));
  const components = {}, parts = {}, footprints = {};
  for (const y of symbols) {
    const c = project.components[y.componentId];
    components[c.id] = structuredClone(c);
    parts[c.partId] = structuredClone(project.parts[c.partId]);
    const k = c.footprint?.fpKey;
    if (k && project.footprints?.[k]) footprints[k] = structuredClone(project.footprints[k]);
  }
  const wires = sheet.wires.filter((w) => sel.has(w.id)).map((w) => structuredClone(w));
  const labels = (sheet.labels || []).filter((l) => sel.has(l.id)).map((l) => structuredClone(l));
  return { kind: 'electrocad-schematic-clip', symbols, wires, labels, components, parts, footprints };
}

/**
 * Paste a clipboard onto `sheet`, offset by `delta`. Pasted Components get new ids and the next
 * free Reference designators; Units of one copied Component stay together. Returns new item ids.
 */
export function pasteClip(project, sheet, clip, delta) {
  const newComp = new Map();
  for (const [id, part] of Object.entries(clip.parts)) if (!project.parts[id]) project.parts[id] = structuredClone(part);
  const ids = [];
  const order = [...clip.symbols].sort((a, b) => compareRefs(clip.components[a.componentId].ref, clip.components[b.componentId].ref));
  for (const y of order) {
    const src = clip.components[y.componentId];
    if (!newComp.has(src.id)) {
      const prefix = project.parts[src.partId].prefix;
      const c = { ...structuredClone(src), id: uid('c'), ref: nextRef(project, prefix) };
      // a table Footprint comes along; the key can differ if this Project has another of that name
      const k = src.footprint?.fpKey;
      if (k && clip.footprints?.[k]) c.footprint = { fpKey: addFootprint(project, clip.footprints[k].library, clip.footprints[k].footprint) };
      project.components[c.id] = c;
      newComp.set(src.id, c);
    }
    const sym = { ...structuredClone(y), id: uid('y'), componentId: newComp.get(src.id).id, at: add2(y.at, delta) };
    sheet.symbols.push(sym);
    ids.push(sym.id);
  }
  for (const w of clip.wires) {
    const nw = { id: uid('w'), a: add2(w.a, delta), b: add2(w.b, delta) };
    sheet.wires.push(nw);
    ids.push(nw.id);
  }
  sheet.labels ||= [];
  for (const l of clip.labels || []) {
    const nl = { ...structuredClone(l), id: uid('l'), at: add2(l.at, delta) };
    sheet.labels.push(nl);
    ids.push(nl.id);
  }
  return ids;
}

/** Bounding box of selected items (Symbols and Wires), or null. */
export function itemsBounds(project, sheet, ids) {
  const sel = new Set(ids);
  const boxes = [];
  for (const y of sheet.symbols) if (sel.has(y.id)) boxes.push(symbolBounds(project, y));
  for (const w of sheet.wires) if (sel.has(w.id)) boxes.push({ x0: Math.min(w.a[0], w.b[0]), y0: Math.min(w.a[1], w.b[1]), x1: Math.max(w.a[0], w.b[0]), y1: Math.max(w.a[1], w.b[1]) });
  for (const l of sheet.labels || []) if (sel.has(l.id)) boxes.push(labelBounds(l));
  if (!boxes.length) return null;
  return { x0: Math.min(...boxes.map((b) => b.x0)), y0: Math.min(...boxes.map((b) => b.y0)), x1: Math.max(...boxes.map((b) => b.x1)), y1: Math.max(...boxes.map((b) => b.y1)) };
}

/**
 * Items in a rectangle. 'window' (dragged left to right) takes only items fully inside;
 * 'crossing' (right to left) takes anything that touches it — the KiCad convention.
 */
export function itemsInRect(project, sheet, r, mode = 'window') {
  const inside = (b) => b.x0 >= r.x0 && b.x1 <= r.x1 && b.y0 >= r.y0 && b.y1 <= r.y1;
  const touches = (b) => b.x0 <= r.x1 && b.x1 >= r.x0 && b.y0 <= r.y1 && b.y1 >= r.y0;
  const segTouches = (a, b) => {
    if (inside({ x0: Math.min(a[0], b[0]), y0: Math.min(a[1], b[1]), x1: Math.max(a[0], b[0]), y1: Math.max(a[1], b[1]) })) return true;
    // orthogonal segment vs rect
    return touches({ x0: Math.min(a[0], b[0]), y0: Math.min(a[1], b[1]), x1: Math.max(a[0], b[0]), y1: Math.max(a[1], b[1]) });
  };
  const out = [];
  for (const y of sheet.symbols) { const b = symbolBounds(project, y); if (b && (mode === 'window' ? inside(b) : touches(b))) out.push(y.id); }
  for (const w of sheet.wires) {
    const b = { x0: Math.min(w.a[0], w.b[0]), y0: Math.min(w.a[1], w.b[1]), x1: Math.max(w.a[0], w.b[0]), y1: Math.max(w.a[1], w.b[1]) };
    if (mode === 'window' ? inside(b) : segTouches(w.a, w.b)) out.push(w.id);
  }
  for (const l of sheet.labels || []) { const b = labelBounds(l); if (mode === 'window' ? inside(b) : touches(b)) out.push(l.id); }
  return out;
}

// ---------------------------------------------------------------- tidying Wires

/**
 * Tidy a Sheet's Wires without changing what connects to what:
 *   - drop zero-length runs and exact duplicates;
 *   - runs on the same line that overlap become one run covering both (no hidden segments);
 *   - runs on the same line that meet end to end become one, when nothing else connects at the
 *     meeting point (no Pin, no third Wire end, no Wire passing through it).
 * Returns true if anything changed.
 */
export function cleanupWires(project, sheet) {
  let changed = false;
  const pinKeys = new Set(sheet.symbols.flatMap((y) => pinPositions(project, y).map((x) => ptKey(x.at))));
  const axisOf = (w) => (w.a[1] === w.b[1] ? 'h' : w.a[0] === w.b[0] ? 'v' : null);
  const lineOf = (w) => (axisOf(w) === 'h' ? 'h' + w.a[1] : 'v' + w.a[0]);
  const lo = (w) => (axisOf(w) === 'h' ? Math.min(w.a[0], w.b[0]) : Math.min(w.a[1], w.b[1]));
  const hi = (w) => (axisOf(w) === 'h' ? Math.max(w.a[0], w.b[0]) : Math.max(w.a[1], w.b[1]));
  const make = (w, a, b) => (axisOf(w) === 'h' ? { id: w.id, a: [a, w.a[1]], b: [b, w.a[1]] } : { id: w.id, a: [w.a[0], a], b: [w.a[0], b] });
  for (let guard = 0; guard < 1000; guard++) {
    let step = false;
    // zero length and duplicates
    const seen = new Set();
    const kept = [];
    for (const w of sheet.wires) {
      if (w.a[0] === w.b[0] && w.a[1] === w.b[1]) { step = true; continue; }
      const k = [ptKey(w.a), ptKey(w.b)].sort().join('|');
      if (seen.has(k)) { step = true; continue; }
      seen.add(k); kept.push(w);
    }
    sheet.wires = kept;
    // overlapping or end-to-end runs on the same line
    outer: for (let i = 0; i < sheet.wires.length; i++) {
      const w = sheet.wires[i];
      const ax = axisOf(w);
      if (!ax) continue;
      for (let j = i + 1; j < sheet.wires.length; j++) {
        const x = sheet.wires[j];
        if (axisOf(x) !== ax || lineOf(x) !== lineOf(w)) continue;
        const [l1, h1, l2, h2] = [lo(w), hi(w), lo(x), hi(x)];
        if (h1 < l2 || h2 < l1) continue; // apart
        if (h1 === l2 || h2 === l1) {
          // they meet at one point: merge only if nothing else connects there
          const v = h1 === l2 ? h1 : h2;
          const P = ax === 'h' ? [v, w.a[1]] : [w.a[0], v];
          const k = ptKey(P);
          if (pinKeys.has(k)) continue;
          const ends = sheet.wires.reduce((n, y) => n + (ptKey(y.a) === k) + (ptKey(y.b) === k), 0);
          if (ends !== 2) continue;
          if (sheet.wires.some((y) => y !== w && y !== x && onSegment(P, y.a, y.b))) continue;
        }
        sheet.wires[i] = make(w, Math.min(l1, l2), Math.max(h1, h2));
        sheet.wires.splice(j, 1);
        step = true;
        break outer;
      }
    }
    if (!step) break;
    changed = true;
  }
  return changed;
}

// ------------------------------------------------------------------ Sheets (#7)

/** Add a Sheet after `afterId` (or at the end). Its name is the first free "Sheet N". */
export function addSheet(project, afterId = null) {
  const sheets = project.schematic.sheets;
  const names = new Set(sheets.map((s) => s.name));
  let n = sheets.length + 1;
  while (names.has(`Sheet ${n}`)) n++;
  const s = newSheet(`Sheet ${n}`);
  const i = afterId ? sheets.findIndex((x) => x.id === afterId) : -1;
  sheets.splice(i >= 0 ? i + 1 : sheets.length, 0, s);
  return s;
}

/** Why a Sheet name can't be used, or null. */
export function validateSheetName(project, sheetId, name) {
  const n = String(name ?? '').trim();
  if (!n) return 'A sheet needs a name.';
  if (n.includes('/')) return 'Use no "/" in a sheet name.';
  if (project.schematic.sheets.some((s) => s.id !== sheetId && s.name.toLowerCase() === n.toLowerCase())) return `There is already a sheet called ${n}.`;
  return null;
}

export function renameSheet(project, sheetId, name) {
  const bad = validateSheetName(project, sheetId, name);
  if (bad) throw new Error(bad);
  project.schematic.sheets.find((s) => s.id === sheetId).name = String(name).trim();
}

/** Move a Sheet by `by` places (−1 earlier, +1 later), clamped. */
export function moveSheet(project, sheetId, by) {
  const sheets = project.schematic.sheets;
  const i = sheets.findIndex((s) => s.id === sheetId);
  const j = Math.max(0, Math.min(sheets.length - 1, i + by));
  if (i < 0 || i === j) return false;
  const [s] = sheets.splice(i, 1);
  sheets.splice(j, 0, s);
  return true;
}

/** Delete a Sheet and its Components (the last Sheet can't be deleted). */
export function deleteSheet(project, sheetId) {
  const sheets = project.schematic.sheets;
  if (sheets.length < 2) throw new Error('A project keeps at least one sheet.');
  const i = sheets.findIndex((s) => s.id === sheetId);
  if (i < 0) return;
  sheets.splice(i, 1);
  pruneOrphans(project);
}
