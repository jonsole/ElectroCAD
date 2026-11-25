// Forward annotation (#16): Schematic -> Board. DOM-free.
//
//   changeList(project)        -> { changes, warnings, target }
//   applyChanges(project, list) -> the Board updated, in place (the caller wraps it in one undo step)
//
// The Board keeps a record of what it was last told (`board.annotation`: each Component's
// Reference and Value, and the Pads on each Net). The Board draws References, Values and Pad nets
// from that record, so Schematic edits reach the Board only when annotated. The change list is the
// difference between that record (plus which Components have a Footprint on the Board) and the
// Schematic now. Footprint swaps are not in it: they apply at once (ADR-0008).
import { pruneApprovals } from './drcApprovals.js';
import { buildNetlist, compareRefs } from './netlist.js';
import { footprintOf, uid } from './project.js';
import { mm } from './units.js';
import { outlineBounds } from './board.js';
import { footprintBox } from './footprint.js';

const padKey = (componentId, pad) => `${componentId}:${pad}`;
const low = (s) => s.toLowerCase();

/** What the Board should know now: placed Components that have a Footprint, and the Pads on each Net. */
export function annotationOf(project) {
  const placed = new Set();
  for (const sh of project.schematic.sheets) for (const y of sh.symbols) placed.add(y.componentId);
  const components = {};
  for (const id of placed) {
    const c = project.components[id];
    if (c && footprintOf(project, c)) components[id] = { ref: c.ref, value: c.value || '' };
  }
  const nets = {};
  for (const n of buildNetlist(project).nets) {
    const pads = [...new Set(n.pins.filter((p) => components[p.componentId]).map((p) => padKey(p.componentId, p.pad)))].sort();
    if (pads.length) nets[n.name] = pads;
  }
  return { components, nets };
}

/**
 * The changes the Schematic implies for the Board. Each change is one of:
 *   { kind: 'add', componentId, ref, value, footprint }       a Footprint to place
 *   { kind: 'remove', componentId, ref }                       a Footprint whose Component is gone
 *   { kind: 'ref', componentId, from, to }                     a Reference renamed
 *   { kind: 'value', componentId, ref, from, to }              a Value changed
 *   { kind: 'net-add', net, pads } / { kind: 'net-remove', net, pads }
 *   { kind: 'net-rename', from, to }                           board copper follows the new name
 *   { kind: 'net-pads', net, added, removed }                  Pads joined or left a Net
 * Pads are shown as "R1.2" (the Reference after this annotation). `warnings` are plain-language
 * notes (a placed Component without a Footprint). `target` is the new record applyChanges stores.
 */
export function changeList(project) {
  const board = project.board;
  const old = board.annotation || { components: {}, nets: {} };
  const target = annotationOf(project);
  const changes = [];
  const onBoard = new Set(board.footprints.filter((f) => f.componentId).map((f) => f.componentId)); // board-only ones (#74) aren't the Schematic's
  const refOf = (id) => target.components[id]?.ref || old.components[id]?.ref || project.components[id]?.ref || '?';
  const padName = (k) => { const i = k.lastIndexOf(':'); return `${refOf(k.slice(0, i))}.${k.slice(i + 1)}`; };
  const byRef = (a, b) => compareRefs(a.ref || a.to || '', b.ref || b.to || '');

  // Components
  const comp = [];
  for (const [id, c] of Object.entries(target.components)) {
    if (!onBoard.has(id)) { comp.push({ kind: 'add', componentId: id, ref: c.ref, value: c.value, footprint: footprintOf(project, project.components[id]).name }); continue; }
    const was = old.components[id];
    if (was && was.ref !== c.ref) comp.push({ kind: 'ref', componentId: id, from: was.ref, to: c.ref });
    if (was && was.value !== c.value) comp.push({ kind: 'value', componentId: id, ref: c.ref, from: was.value, to: c.value });
  }
  for (const id of onBoard) if (!target.components[id]) comp.push({ kind: 'remove', componentId: id, ref: old.components[id]?.ref || project.components[id]?.ref || '?' });
  comp.sort(byRef);
  changes.push(...comp);

  // Nets: match old and new by name (regardless of case); unmatched ones pair up as renames by shared Pads
  const oldByLow = new Map(Object.keys(old.nets).map((n) => [low(n), n]));
  const newByLow = new Map(Object.keys(target.nets).map((n) => [low(n), n]));
  const pairs = []; // [oldName, newName]
  for (const [k, n] of newByLow) if (oldByLow.has(k)) pairs.push([oldByLow.get(k), n]);
  const goneOld = [...oldByLow].filter(([k]) => !newByLow.has(k)).map(([, n]) => n);
  const freshNew = new Set([...newByLow].filter(([k]) => !oldByLow.has(k)).map(([, n]) => n));
  const shared = (a, b) => { const s = new Set(old.nets[a]); return target.nets[b].filter((p) => s.has(p)).length; };
  for (const o of goneOld) {
    let best = null, bn = 0;
    for (const n of freshNew) { const k = shared(o, n); if (k > bn) { bn = k; best = n; } }
    if (best) { freshNew.delete(best); pairs.push([o, best]); }
    else changes.push({ kind: 'net-remove', net: o, pads: old.nets[o].map(padName) });
  }
  for (const n of freshNew) changes.push({ kind: 'net-add', net: n, pads: target.nets[n].map(padName) });
  for (const [o, n] of pairs) {
    if (o !== n) changes.push({ kind: 'net-rename', from: o, to: n });
    const was = new Set(old.nets[o]), now = new Set(target.nets[n]);
    const added = target.nets[n].filter((p) => !was.has(p)), removed = old.nets[o].filter((p) => !now.has(p));
    if (added.length || removed.length) changes.push({ kind: 'net-pads', net: n, added: added.map(padName), removed: removed.map(padName) });
  }

  const warnings = [];
  const placed = new Set();
  for (const sh of project.schematic.sheets) for (const y of sh.symbols) placed.add(y.componentId);
  const noFp = [...placed].map((id) => project.components[id]).filter((c) => c && !footprintOf(project, c)).map((c) => c.ref).sort(compareRefs);
  if (noFp.length) warnings.push(`${noFp.join(', ')} ${noFp.length === 1 ? 'has' : 'have'} no Footprint, so ${noFp.length === 1 ? 'it stays' : 'they stay'} off the Board. Choose one in the inspector.`);
  // Reference/Value-only edits to the record still count as a change (nothing else to show for them)
  const recordChanged = !changes.length && JSON.stringify(old) !== JSON.stringify(target);
  return { changes, warnings, target, recordChanged };
}

/** Does the list change anything? (Re-running after an apply gives an empty list.) */
export const isEmpty = (list) => !list.changes.length && !list.recordChanged;

/**
 * Apply a change list to the Board (in place): place new Footprints in a group beside the
 * Outline, remove Footprints whose Component is gone, rename Nets on copper and Net classes, and
 * store the new record.
 */
export function applyChanges(project, list) {
  const board = project.board;
  const removed = new Set(list.changes.filter((c) => c.kind === 'remove').map((c) => c.componentId));
  board.footprints = board.footprints.filter((f) => !f.componentId || !removed.has(f.componentId));
  const renames = new Map(list.changes.filter((c) => c.kind === 'net-rename').map((c) => [low(c.from), c.to]));
  if (renames.size) {
    for (const x of [...board.tracks, ...board.vias, ...board.zones]) if (renames.has(low(x.net))) x.net = renames.get(low(x.net));
    for (const nc of Object.values(board.netClasses || {})) if (nc.nets) nc.nets = nc.nets.map((n) => renames.get(low(n)) || n);
  }
  const adds = list.changes.filter((c) => c.kind === 'add');
  if (adds.length) placeGroup(project, adds.map((c) => c.componentId));
  board.annotation = structuredClone(list.target);
  pruneApprovals(project); // approvals of removed footprints go too (#69)
  return board;
}

/**
 * New Footprints arrive in rows to the right of the Outline (or at the origin when there is
 * none), sorted by Reference, 2 mm apart, each on the main grid.
 */
function placeGroup(project, ids) {
  const board = project.board;
  const b = outlineBounds(board.outline);
  const gap = mm(2);
  const x0 = b ? b.x1 + mm(5) : board.origin[0];
  const y0 = b ? b.y0 : board.origin[1];
  const rowWidth = Math.max(mm(30), b ? (b.x1 - b.x0) : mm(60));
  const g = board.grid?.main || mm(0.5);
  const onGrid = (v) => Math.ceil(v / g) * g;
  const comps = ids.map((id) => project.components[id]).sort((a, c) => compareRefs(a.ref, c.ref));
  let x = x0, y = y0, rowH = 0;
  for (const c of comps) {
    const box = footprintBox(footprintOf(project, c));
    const w = box.x1 - box.x0, ht = box.y1 - box.y0;
    if (x > x0 && x + w > x0 + rowWidth) { x = x0; y += rowH + gap; rowH = 0; }
    // the Footprint's box sits with its top-left at (x, y)
    board.footprints.push({ id: uid('f'), componentId: c.id, at: [onGrid(x - box.x0), onGrid(y - box.y0)], rot: 0, side: 'F', locked: false });
    x += w + gap; rowH = Math.max(rowH, ht);
  }
}
