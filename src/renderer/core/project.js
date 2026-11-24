// Project model: factories, helpers and the Native format (.ecad).
// Schema: docs/formats/ecad.md and ecad.schema.json (checked by test/formats.test.js). Terms: CONTEXT.md.
//   - Parts are generic and hold Units (ADR-0005), embedded as frozen copies (ADR-0004).
//   - A Component's Footprint is a live property: a Preferred footprint or any other (ADR-0008).
//   - All coordinates are integer nm, +Y down (ADR-0003).
import { mm, mil } from './units.js';
import { place } from './geom.js';
import { ECAD_SCHEMA } from './ecad-schema.js';
import { checkSchema } from './schema-check.js';

export const FORMAT = 'electrocad';
// Goes up with every format change. Before 1.0 files of other versions are refused (ADR-0014).
// 3: Parts keyed by Library origin, Project footprints table, no Unit.fields, Board object shapes.
// 4: text in Symbol and Footprint graphics (#13).
// 5: Schematic markup, Sheet paper sizes and the title block (#59).
export const VERSION = 7;

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
    parts: {}, components: {}, footprints: {},
    schematic: { sheets: [newSheet('Sheet 1')] },
    board: newBoard(),
    fieldStyles: defaultFieldStyles(),
    titleBlock: { title: '', company: '', author: '', revision: '', date: '', comment: '' },
  };
}

// Classic is embedded in every new Project (ADR-0012); kept here, not imported from fields.js,
// so the file format does not depend on the placer.
const CLASSIC_STYLE = {
  id: 'classic', name: 'Classic', builtin: true, arrangement: 'stacked',
  show: { reference: true, value: true, footprint: false, mpn: false, hideValueIfPartName: false },
  text: { size: 1_270_000, bold: false, italic: false, gap: 500_000 },
  valueFormat: 'as-typed',
  placement: { horizontal: ['split', 'above', 'below', 'right', 'left'], vertical: ['right', 'left', 'above', 'below'] },
};
const defaultFieldStyles = () => ({ default: 'classic', styles: { classic: structuredClone(CLASSIC_STYLE) } });

export function newSheet(name) {
  return { id: uid('s'), name, symbols: [], wires: [], labels: [], noConnects: [], drawings: [], paper: { size: 'A4', orientation: 'landscape' }, grid: { main: mil(50), alt: mil(25) }, origin: [0, 0] };
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
    grid: { main: mm(0.5), alt: mm(0.1) },
    origin: [0, 0],
    annotation: { components: {}, nets: {} },
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
  const key = partKey(part);
  if (!project.parts[key]) {
    const { category, manufacturer, ...copy } = structuredClone(part); // Library-only (the picker's categories and grouping)
    void category; void manufacturer;
    project.parts[key] = { ...copy, id: key };
  }
  const stored = project.parts[key];
  const unit = opts.unit || 0;
  if (!stored.units[unit]) throw new RangeError(`${stored.name} has no Unit ${unit}`);
  let comp = opts.component;
  if (!comp) {
    const firstFp = Object.keys(stored.footprints || {})[0];
    comp = {
      id: uid('c'), partId: stored.id, ref: nextRef(project, stored.prefix),
      value: opts.value ?? stored.defaultValue ?? stored.name,
      mpn: null,
      footprint: opts.footprint ? footprintRef(project, opts.footprint) : firstFp ? { fpId: firstFp } : null,
      fields: {},
    };
    project.components[comp.id] = comp;
  }
  const sym = { id: uid('y'), componentId: comp.id, unit, at, rot: opts.rot || 0, mirror: !!opts.mirror };
  sheet.symbols.push(sym);
  return { comp, sym };
}

export const partOf = (project, comp) => (comp ? project.parts[comp.partId] : null);

/**
 * The key a Library Part is stored under in a Project: its Library origin
 * ("builtin-mini/resistor@1"), so Parts from different Libraries never clash. A Part without an
 * origin (made in the Project) keeps its own id.
 */
export const partKey = (part) => (part.origin ? `${part.origin.library}/${part.origin.partId}@${part.origin.version}` : part.id);

/**
 * Store a Footprint in the Project's footprints table (once: an identical one already there is
 * reused) and return its key, "library/name" (with ~2, ~3… when a different Footprint has that name).
 */
export function addFootprint(project, library, footprint) {
  project.footprints ||= {};
  const base = `${library}/${footprint.name}`;
  const same = JSON.stringify(footprint);
  for (let i = 1; ; i++) {
    const key = i === 1 ? base : `${base}~${i}`;
    const there = project.footprints[key];
    if (!there) { project.footprints[key] = { library, footprint: structuredClone(footprint) }; return key; }
    if (there.library === library && JSON.stringify(there.footprint) === same) return key;
  }
}

/**
 * A Component's footprint reference from a choice: { fpId } (Preferred), { fpKey } (already in the
 * table) or { library, footprint } (any other: stored in the table). null clears it.
 */
export function footprintRef(project, choice) {
  if (!choice) return null;
  if (choice.fpId) return { fpId: choice.fpId };
  if (choice.fpKey) return { fpKey: choice.fpKey };
  return { fpKey: addFootprint(project, choice.library || 'user', choice.footprint) };
}

/** The Component's Footprint object, whether Preferred (in its Part) or any other (in the Project's table). */
export function footprintOf(project, comp) {
  const fp = comp && comp.footprint;
  if (!fp) return null;
  if (fp.fpKey) return project.footprints?.[fp.fpKey]?.footprint || null;
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
  const usedFp = new Set(Object.values(project.components).map((c) => c.footprint?.fpKey).filter(Boolean));
  for (const k of Object.keys(project.footprints || {})) if (!usedFp.has(k)) delete project.footprints[k];
}

// ---------------------------------------------------------------- Native format

export const FILE_EXTENSION = 'ecad';

/**
 * Write a Project as text: JSON indented one space, with short arrays of plain values (points,
 * layer lists, slot lists) on one line so a moved point is a one-line change in a diff.
 */
export const serialize = (project) => pretty(project, '') + '\n';

const INLINE_MAX = 90;
const plain = (v) => v === null || typeof v !== 'object' || (Array.isArray(v) && v.every(plain));
const inline = (v) => (Array.isArray(v) ? `[${v.map(inline).join(', ')}]` : JSON.stringify(v));
function pretty(v, pad) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  const inner = pad + ' ';
  if (Array.isArray(v)) {
    if (!v.length) return '[]';
    if (v.every(plain)) { const one = inline(v); if (one.length + inner.length <= INLINE_MAX) return one; }
    return `[\n${v.map((x) => inner + pretty(x, inner)).join(',\n')}\n${pad}]`;
  }
  const keys = Object.keys(v).filter((k) => v[k] !== undefined);
  if (!keys.length) return '{}';
  return `{\n${keys.map((k) => `${inner}${JSON.stringify(k)}: ${pretty(v[k], inner)}`).join(',\n')}\n${pad}}`;
}

/** Parse a .ecad file. Throws ProjectFileError with a user-facing message when it can't be opened. */
export function deserialize(text) {
  let p;
  try { p = JSON.parse(text); } catch { throw new ProjectFileError('This file is not an ElectroCAD project (it is not valid JSON).'); }
  if (!p || typeof p !== 'object' || p.format !== FORMAT) throw new ProjectFileError('This file is not an ElectroCAD project.');
  if (!Number.isInteger(p.version)) throw new ProjectFileError('This project file has no valid version number.');
  if (p.version > VERSION) {
    throw new ProjectFileError(`This project was saved by a newer version of ElectroCAD (file version ${p.version}; this app reads version ${VERSION}). Update ElectroCAD to open it.`);
  }
  if (p.version < VERSION) {
    // before 1.0 the format changes without migrations (ADR-0014)
    throw new ProjectFileError(`This project was saved by an earlier development version of ElectroCAD (file version ${p.version}; this app reads version ${VERSION}). Before version 1.0, older project files can't be opened.`);
  }
  validate(p);
  return p;
}

/**
 * Everything wrong with a parsed Project, in plain words: the schema (core/ecad-schema.js), then
 * what a schema can't say (unique ids and references, keys that must point at something).
 * Returns a list; empty means the Project is sound.
 */
export function projectProblems(p) {
  const raw = checkSchema(ECAD_SCHEMA, p);
  const sheetName = (i) => p?.schematic?.sheets?.[i]?.name;
  const where = (path) => path.replace(/^\$\.?/, '')
    .replace(/^schematic\.sheets\[(\d+)\]/, (_, i) => `sheet "${sheetName(+i) ?? +i + 1}"`)
    .replace(/\.(symbols|wires|labels|noConnects)\[(\d+)\]/g, (_, k, i) => ` ${k.replace(/s$/, '').replace('noConnect', 'no-connect')} ${+i + 1}`)
    .replace(/^components\.([^.]+)/, (_, id) => `component ${p.components?.[id]?.ref ?? id}`) || 'the file';
  const out = raw.map((e) => { const i = e.indexOf(': '); return `${where(e.slice(0, i))}: ${e.slice(i + 2)}`; });
  if (out.length) return out;
  // what the schema can't check
  const ids = new Map();
  const seen = (id, what) => { if (ids.has(id)) out.push(`${what} has the same id (${id}) as ${ids.get(id)}`); else ids.set(id, what); };
  const refs = new Map();
  for (const [key, c] of Object.entries(p.components)) {
    const what = `component ${c.ref}`;
    if (c.id !== key) out.push(`${what} is stored under the key ${key} but has the id ${c.id}`);
    seen(c.id, what);
    if (refs.has(c.ref)) out.push(`two components are called ${c.ref}`); else refs.set(c.ref, c.id);
    const part = p.parts[c.partId];
    if (!part) { out.push(`${what} uses a part that isn't in the file (${c.partId})`); continue; }
    if (c.footprint?.fpId && !part.footprints?.[c.footprint.fpId]) out.push(`${what} uses footprint ${c.footprint.fpId}, which its part doesn't have`);
    if (c.footprint?.fpKey && !p.footprints[c.footprint.fpKey]) out.push(`${what} uses footprint ${c.footprint.fpKey}, which isn't in the file`);
    if (c.fieldStyle && !p.fieldStyles.styles[c.fieldStyle]) out.push(`${what} uses the field style ${c.fieldStyle}, which isn't in the file`);
  }
  for (const [key, part] of Object.entries(p.parts)) if (part.id !== key) out.push(`part ${part.name} is stored under the key ${key} but has the id ${part.id}`);
  if (!p.fieldStyles.styles[p.fieldStyles.default]) out.push(`the default field style ${p.fieldStyles.default} isn't in the file`);
  const names = new Set();
  for (const s of p.schematic.sheets) {
    const what = `sheet "${s.name}"`;
    seen(s.id, what);
    if (names.has(s.name.toLowerCase())) out.push(`two sheets are called ${s.name}`); else names.add(s.name.toLowerCase());
    s.symbols.forEach((y, i) => {
      seen(y.id, `${what} symbol ${i + 1}`);
      const c = p.components[y.componentId];
      if (!c) out.push(`${what} symbol ${i + 1} belongs to a component that isn't in the file`);
      else if (!p.parts[c.partId]?.units[y.unit]) out.push(`${what}: ${c.ref} is placed as unit ${y.unit + 1}, which its part doesn't have`);
    });
    s.wires.forEach((w, i) => seen(w.id, `${what} wire ${i + 1}`));
    s.labels.forEach((l, i) => {
      seen(l.id, `${what} label ${l.net}`);
      if ((l.style === 'power' || l.style === 'gnd') && l.scope !== 'global') out.push(`${what}: the power symbol ${l.net} must be global`);
      if (!l.net.trim() || /\s/.test(l.net)) out.push(`${what} label ${i + 1}: "${l.net}" isn't a usable net name`);
    });
    s.noConnects.forEach((n, i) => seen(n.id, `${what} no-connect ${i + 1}`));
    s.drawings.forEach((d, i) => seen(d.id, `${what} drawing ${i + 1}`));
  }
  const placed = new Set(p.schematic.sheets.flatMap((s) => s.symbols.map((y) => y.componentId)));
  for (const c of Object.values(p.components)) if (!placed.has(c.id)) out.push(`component ${c.ref} isn't placed on any sheet`);
  return out;
}

function validate(p) {
  const problems = projectProblems(p);
  if (!problems.length) return;
  const shown = problems.slice(0, 6).map((x) => `• ${x}`).join('\n');
  const more = problems.length > 6 ? `\n…and ${problems.length - 6} more.` : '';
  throw new ProjectFileError(`This project file is damaged, so it wasn't opened:\n${shown}${more}`);
}
