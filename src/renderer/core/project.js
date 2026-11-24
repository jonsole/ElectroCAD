// Project model: factories, serialisation and helpers (see docs/DESIGN.md §3).
import { mm } from './units.js';
import { place } from './geom.js';

export const FORMAT = 'electrocad';
export const VERSION = 1;

let counter = 1;
export const uid = (prefix = 'o') =>
  prefix + Date.now().toString(36) + (counter++).toString(36) + Math.random().toString(36).slice(2, 6);

export function newProject(name = 'Untitled') {
  return {
    format: FORMAT, version: VERSION, id: uid('p'), name,
    parts: {}, components: {},
    schematic: { sheets: [newSheet('Sheet 1')] },
    board: newBoard(),
  };
}

export function newSheet(name) {
  return { id: uid('s'), name, symbols: [], wires: [], labels: [] };
}

export function newBoard(copper = 2) {
  return {
    stack: { copper, thickness: mm(1.6) },
    outline: [],
    footprints: [], tracks: [], vias: [], zones: [],
    rules: { clearance: mm(0.2), trackWidth: mm(0.25), viaDrill: mm(0.3), viaDiameter: mm(0.6), minHole: mm(0.3), edgeClearance: mm(0.3) },
    netClasses: {},
  };
}

/** Copper layer names for a 2- or 4-layer stack, top to bottom. */
export const copperLayers = (copper) => (copper === 4 ? ['F.Cu', 'In1.Cu', 'In2.Cu', 'B.Cu'] : ['F.Cu', 'B.Cu']);

/** Next free reference designator for a prefix, e.g. 'R' -> 'R3'. */
export function nextRef(project, prefix) {
  let n = 1;
  const used = new Set(Object.values(project.components).map((c) => c.ref));
  while (used.has(prefix + n)) n++;
  return prefix + n;
}

/**
 * Add a Component for `part` and place its Symbol on `sheet`. The Part is copied into
 * the Project so the file stays self-contained (ADR-0004).
 */
export function addComponent(project, sheet, part, at, rot = 0) {
  if (!project.parts[part.id]) project.parts[part.id] = structuredClone(part);
  const comp = {
    id: uid('c'), partId: part.id, ref: nextRef(project, part.prefix), value: part.defaultValue || part.name,
    footprintId: Object.keys(part.footprints)[0] || null, fields: {},
  };
  project.components[comp.id] = comp;
  const sym = { id: uid('y'), componentId: comp.id, at, rot, mirror: false };
  sheet.symbols.push(sym);
  return { comp, sym };
}

/** World positions of a placed symbol's pins. */
export function pinPositions(project, sym) {
  const comp = project.components[sym.componentId];
  const part = comp && project.parts[comp.partId];
  if (!part) return [];
  return part.symbol.pins.map((pin) => ({ pin, at: place(pin.at, sym.at, sym.rot, sym.mirror) }));
}

/** Remove components that no longer have a symbol on any sheet, and parts no component uses. */
export function pruneOrphans(project) {
  const placed = new Set(project.schematic.sheets.flatMap((s) => s.symbols.map((y) => y.componentId)));
  for (const id of Object.keys(project.components)) if (!placed.has(id)) delete project.components[id];
  const used = new Set(Object.values(project.components).map((c) => c.partId));
  for (const id of Object.keys(project.parts)) if (!used.has(id)) delete project.parts[id];
}

export const serialize = (project) => JSON.stringify(project, null, 1);

export function deserialize(text) {
  const p = JSON.parse(text);
  if (p.format !== FORMAT) throw new Error('Not an ElectroCAD project');
  if (p.version > VERSION) throw new Error(`Project version ${p.version} is newer than this app (${VERSION})`);
  return p; // future: migrations for older versions go here
}
