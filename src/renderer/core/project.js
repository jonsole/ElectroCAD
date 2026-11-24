// Project model: factories, helpers and the Native format (.ecad).
// Schema: docs/DESIGN.md §3 and the spec (issue #1). Terms: CONTEXT.md.
//   - Parts are generic and hold Units (ADR-0005), embedded as frozen copies (ADR-0004).
//   - A Component's Footprint is a live property: a Preferred footprint or any other (ADR-0008).
//   - All coordinates are integer nm, +Y down (ADR-0003).
import { mm } from './units.js';
import { place } from './geom.js';

export const FORMAT = 'electrocad';
export const VERSION = 1;

/** Thrown when a file can't be opened as a Project; the message is shown to the user. */
export class ProjectFileError extends Error {
  constructor(message) { super(message); this.name = 'ProjectFileError'; }
}

let counter = 1;
export const uid = (prefix = 'o') =>
  prefix + Date.now().toString(36) + (counter++).toString(36) + Math.random().toString(36).slice(2, 6);

// ---------------------------------------------------------------- factories

export function newProject(name = 'Untitled') {
  return {
    format: FORMAT, version: VERSION, id: uid('p'), name,
    parts: {}, components: {},
    schematic: { sheets: [newSheet('Sheet 1')] },
    board: newBoard(),
  };
}

export function newSheet(name) {
  return { id: uid('s'), name, symbols: [], wires: [], labels: [], noConnects: [] };
}

export function newBoard(copper = 2) {
  return {
    stack: { copper, thickness: mm(1.6) },
    preset: 'generic',
    outline: [],
    footprints: [], tracks: [], vias: [], zones: [],
    rules: {
      clearance: mm(0.2), trackWidth: mm(0.25), viaDrill: mm(0.3), viaDiameter: mm(0.6),
      minHole: mm(0.3), annularRing: mm(0.13), edgeClearance: mm(0.3),
    },
    netClasses: {},
  };
}

/** Copper layer names for a 2- or 4-layer stack, top to bottom. */
export const copperLayers = (copper) => (copper === 4 ? ['F.Cu', 'In1.Cu', 'In2.Cu', 'B.Cu'] : ['F.Cu', 'B.Cu']);

// ---------------------------------------------------------------- Components

/** Next free Reference designator for a prefix, e.g. 'R' -> 'R3'. */
export function nextRef(project, prefix) {
  let n = 1;
  const used = new Set(Object.values(project.components).map((c) => c.ref));
  while (used.has(prefix + n)) n++;
  return prefix + n;
}

/**
 * Place a Unit of `part` on `sheet`. Creates a new Component unless `opts.component` is given
 * (placing another Unit of an existing Component). The Part is copied into the Project the
 * first time it is used (ADR-0004).
 * @param {object} [opts]
 * @param {number} [opts.unit=0]       index into part.units
 * @param {object} [opts.component]    existing Component to add a Unit to
 * @param {object} [opts.footprint]    { fpId } or { library, footprint }; defaults to the first Preferred footprint
 * @param {string} [opts.value]
 * @param {number} [opts.rot=0]
 * @param {boolean} [opts.mirror=false]
 */
export function addComponent(project, sheet, part, at, opts = {}) {
  if (!project.parts[part.id]) project.parts[part.id] = structuredClone(part);
  const stored = project.parts[part.id];
  const unit = opts.unit || 0;
  if (!stored.units[unit]) throw new RangeError(`${stored.name} has no Unit ${unit}`);
  let comp = opts.component;
  if (!comp) {
    const firstFp = Object.keys(stored.footprints || {})[0];
    comp = {
      id: uid('c'), partId: stored.id, ref: nextRef(project, stored.prefix),
      value: opts.value ?? stored.defaultValue ?? stored.name,
      mpn: null,
      footprint: opts.footprint ? structuredClone(opts.footprint) : firstFp ? { fpId: firstFp } : null,
      fields: {},
    };
    project.components[comp.id] = comp;
  }
  const sym = { id: uid('y'), componentId: comp.id, unit, at, rot: opts.rot || 0, mirror: !!opts.mirror };
  sheet.symbols.push(sym);
  return { comp, sym };
}

export const partOf = (project, comp) => (comp ? project.parts[comp.partId] : null);

/** The Component's Footprint object, whether Preferred (by id) or any other (embedded). */
export function footprintOf(project, comp) {
  const fp = comp && comp.footprint;
  if (!fp) return null;
  if (fp.footprint) return fp.footprint;
  return partOf(project, comp)?.footprints?.[fp.fpId] || null;
}

/** Pad number for a Pin: the Preferred footprint's Pin map, else the identity map (Pin n -> Pad n). */
export function padForPin(project, comp, pinNumber) {
  const fp = comp && comp.footprint;
  if (fp && fp.fpId) {
    const map = partOf(project, comp)?.pinMap?.[fp.fpId];
    if (map && map[pinNumber] != null) return String(map[pinNumber]);
  }
  return String(pinNumber);
}

/** World positions of a placed Unit's Pins. */
export function pinPositions(project, sym) {
  const part = partOf(project, project.components[sym.componentId]);
  const unit = part && part.units[sym.unit || 0];
  if (!unit) return [];
  return unit.pins.map((pin) => ({ pin, at: place(pin.at, sym.at, sym.rot, sym.mirror) }));
}

/** Remove Components with no placed Unit on any Sheet, and Parts no Component uses. */
export function pruneOrphans(project) {
  const placed = new Set(project.schematic.sheets.flatMap((s) => s.symbols.map((y) => y.componentId)));
  for (const id of Object.keys(project.components)) if (!placed.has(id)) delete project.components[id];
  const used = new Set(Object.values(project.components).map((c) => c.partId));
  for (const id of Object.keys(project.parts)) if (!used.has(id)) delete project.parts[id];
}

// ---------------------------------------------------------------- Native format

export const FILE_EXTENSION = 'ecad';

export const serialize = (project) => JSON.stringify(project, null, 1) + '\n';

// Migrations from older file versions: MIGRATIONS[n] turns a version-n project into n+1.
const MIGRATIONS = {};

/** Parse a .ecad file. Throws ProjectFileError with a user-facing message when it can't. */
export function deserialize(text) {
  let p;
  try { p = JSON.parse(text); } catch { throw new ProjectFileError('This file is not an ElectroCAD project (it is not valid JSON).'); }
  if (!p || typeof p !== 'object' || p.format !== FORMAT) throw new ProjectFileError('This file is not an ElectroCAD project.');
  if (!Number.isInteger(p.version) || p.version < 1) throw new ProjectFileError('This project file has no valid version number.');
  if (p.version > VERSION) {
    throw new ProjectFileError(`This project was saved by a newer version of ElectroCAD (file version ${p.version}; this app reads up to ${VERSION}). Update ElectroCAD to open it.`);
  }
  while (p.version < VERSION) {
    const step = MIGRATIONS[p.version];
    if (!step) throw new ProjectFileError(`Project file version ${p.version} can't be upgraded.`);
    p = step(p);
  }
  validate(p);
  return p;
}

function validate(p) {
  const need = (cond, what) => { if (!cond) throw new ProjectFileError(`This project file is damaged: ${what}.`); };
  need(typeof p.name === 'string', 'the name is missing');
  need(p.parts && typeof p.parts === 'object', 'the Parts are missing');
  need(p.components && typeof p.components === 'object', 'the Components are missing');
  need(p.schematic && Array.isArray(p.schematic.sheets) && p.schematic.sheets.length > 0, 'the schematic has no Sheets');
  for (const s of p.schematic.sheets) {
    need(['symbols', 'wires', 'labels', 'noConnects'].every((k) => Array.isArray(s[k])), `Sheet "${s.name}" is incomplete`);
    for (const y of s.symbols) need(p.components[y.componentId], `a Symbol on "${s.name}" refers to a missing Component`);
  }
  for (const c of Object.values(p.components)) need(p.parts[c.partId], `Component ${c.ref} refers to a missing Part`);
  const b = p.board;
  need(b && b.stack && (b.stack.copper === 2 || b.stack.copper === 4), 'the board layer stack is missing or not 2/4 layers');
  need(['outline', 'footprints', 'tracks', 'vias', 'zones'].every((k) => Array.isArray(b[k])), 'the board is incomplete');
}
