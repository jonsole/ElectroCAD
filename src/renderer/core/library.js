// User Libraries (#13): the user's own Parts, kept outside Projects (folders on desktop,
// IndexedDB in the browser, through the platform bridge). DOM-free.
//
// A Library file (.ecadlib) is JSON:
//   { format: 'electrocad-library', version: 2, id, name, parts: { [partId]: Part },
//     footprints: { [footprintId]: Footprint } }
// A Part is the Native format's Part (core/ecad-schema.js) plus the Library-only keys `category`
// and `manufacturer`. Its origin is { library: <Library id>, partId, version }; the version goes
// up each time the Part is saved with changes, so a Project records which edition it used.
import { SCH_GRID as G } from './units.js';
import { ECAD_SCHEMA } from './ecad-schema.js';
import { checkSchema } from './schema-check.js';

export const LIBRARY_FORMAT = 'electrocad-library';
export const LIBRARY_VERSION = 2; // 2: Footprints (#19)
export const LIBRARY_EXTENSION = 'ecadlib';
export const PIN_TYPES = ['passive', 'input', 'output', 'bidirectional', 'tri_state', 'power_in', 'power_out', 'open_collector', 'open_emitter', 'unspecified', 'no_connect'];
export const PART_CATEGORIES = ['Passives', 'Semiconductors', 'Connectors', 'ICs', 'Power', 'Other'];

export class LibraryError extends Error {
  constructor(message) { super(message); this.name = 'LibraryError'; }
}

/** A lower-case id from a name ("My parts" -> "my-parts"), unique among `taken`. */
export function slugId(name, taken = []) {
  const base = String(name || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'item';
  const used = new Set(taken);
  let id = base;
  for (let i = 2; used.has(id); i++) id = `${base}-${i}`;
  return id;
}

export function newLibrary(name, takenIds = []) {
  const n = String(name || '').trim() || 'My parts';
  return { format: LIBRARY_FORMAT, version: LIBRARY_VERSION, id: slugId(n, takenIds), name: n, parts: {}, footprints: {} };
}

/** A new Part in `library`: one Unit with a body rectangle and no Pins yet. */
export function newPart(library, name = 'New part') {
  const id = slugId(name, Object.keys(library.parts));
  return {
    id, name, prefix: 'U', defaultValue: name, category: 'ICs', keywords: '',
    origin: { library: library.id, partId: id, version: 0 },
    units: [newUnit(0)],
    footprints: {},
    pinMap: {},
  };
}

export const unitName = (i) => String.fromCharCode(65 + i);

/** A Unit whose Pins are all power inputs (a 74xx or op-amp power gate). */
export const isPowerUnit = (u) => !!u?.pins?.length && u.pins.every((p) => p.type === 'power_in');

/**
 * What follows a Reference for a Unit, on Parts with more than one Unit: the Unit's own name when
 * it's a short label unique in the Part (A, B, P, -1… as Eagle names gates), else A, B… by position.
 * Power-only Units don't count: a Part with one ordinary Unit and a power Unit shows a bare
 * Reference on the ordinary one (IC9, not IC9A), and the power Unit keeps its tag (IC9P).
 */
export function unitLetter(part, unit = 0) {
  if (!part || part.units.length <= 1) return '';
  const i = unit || 0, u = part.units[i];
  if (!isPowerUnit(u) && part.units.filter((x) => !isPowerUnit(x)).length <= 1) return '';
  const name = String(u?.name ?? '');
  const short = (n) => /^[^\s]{1,4}$/.test(n);
  const names = part.units.map((x) => String(x.name ?? ''));
  return short(name) && names.every(short) && new Set(names).size === names.length ? name : unitName(i);
}

export function newUnit(index) {
  return { name: unitName(index), hidePinNumbers: false, hidePinNames: false, graphics: [{ type: 'rect', a: [-4 * G, -4 * G], b: [4 * G, 4 * G], fill: 'background' }], pins: [] };
}

/** Add a Unit (a copy of the body of Unit `copyFrom`, without its Pins). Returns its index. */
export function addUnit(part, copyFrom = null) {
  const u = copyFrom != null && part.units[copyFrom]
    ? { ...structuredClone(part.units[copyFrom]), pins: [] }
    : newUnit(part.units.length);
  part.units.push(u);
  part.units.forEach((x, i) => { x.name = unitName(i); });
  return part.units.length - 1;
}

export function removeUnit(part, index) {
  if (part.units.length < 2) throw new LibraryError('A part keeps at least one unit.');
  part.units.splice(index, 1);
  part.units.forEach((x, i) => { x.name = unitName(i); });
}

/** The lowest whole Pin number not used by any Unit. */
export function nextPinNumber(part) {
  const used = new Set(part.units.flatMap((u) => u.pins.map((p) => p.number)));
  let n = 1;
  while (used.has(String(n))) n++;
  return String(n);
}

/** Which way a Pin placed at `at` should point: into the body, from the side it is on. */
export function pinDirToward([x, y]) {
  if (Math.abs(x) >= Math.abs(y)) return x <= 0 ? 'R' : 'L';
  return y <= 0 ? 'D' : 'U';
}

/** Add a Pin at a grid point with the next free number, pointing into the body. */
export function addPin(part, unitIndex, at, opts = {}) {
  const pin = { number: nextPinNumber(part), name: '~', at: [snapG(at[0]), snapG(at[1])], dir: pinDirToward(at), length: 2 * G, type: 'passive', ...opts };
  part.units[unitIndex].pins.push(pin);
  return pin;
}

const snapG = (v) => Math.round(v / G) * G;

/**
 * Everything wrong with a Part, in plain words (an empty list means it can be saved):
 * the schema shape, a name, a usable prefix, Pin numbers unique across Units, every Unit with a
 * Pin, Pins on the 50 mil grid, and every Pin with a Pad on each Preferred footprint.
 */
export function partProblems(part) {
  const out = [];
  if (!part || typeof part !== 'object') return ['This is not a part.'];
  if (!String(part.name || '').trim()) out.push('The part needs a name.');
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(String(part.prefix || ''))) out.push('The prefix must be letters (and digits), e.g. R, U or SW.');
  if (!Array.isArray(part.units) || !part.units.length) { out.push('The part needs at least one unit.'); return out; }
  const { category, manufacturer, ...native } = part;
  void category; void manufacturer;
  const schemaErrors = checkSchema({ ...ECAD_SCHEMA, ...ECAD_SCHEMA.$defs.part, $defs: ECAD_SCHEMA.$defs }, native);
  for (const e of schemaErrors.slice(0, 5)) out.push(`Damaged: ${e.replace(/^\$\.?/, '')}`);
  const seen = new Map();
  part.units.forEach((u, i) => {
    const label = part.units.length > 1 ? `Unit ${unitName(i)}` : 'The part';
    if (!u.pins.length) out.push(`${label} has no pins.`);
    for (const p of u.pins) {
      const n = String(p.number ?? '').trim();
      if (!n) { out.push(`${label} has a pin without a number.`); continue; }
      if (seen.has(n)) out.push(`Pin number ${n} is used twice (${seen.get(n)} and ${part.units.length > 1 ? `unit ${unitName(i)}` : 'again'}).`);
      else seen.set(n, part.units.length > 1 ? `unit ${unitName(i)}` : 'once');
      if (p.at.some((v) => v % G !== 0)) out.push(`Pin ${n} is off the 50 mil grid, so wires can't reach it.`);
    }
  });
  for (const [fpId, fp] of Object.entries(part.footprints || {})) {
    const pads = new Set(fp.pads.map((p) => p.number));
    const missing = [...seen.keys()].filter((n) => !pads.has(part.pinMap?.[fpId]?.[n] ?? n));
    if (missing.length) out.push(`${fp.name} has no pad for pin${missing.length === 1 ? '' : 's'} ${missing.join(', ')}.`);
  }
  return out;
}

/**
 * Save a Part into a Library: refused with a LibraryError listing the problems when it isn't
 * sound; otherwise stored with its origin pointing at this Library and the version raised when
 * the content changed. Returns the stored Part.
 */
export function savePart(library, part) {
  const problems = partProblems(part);
  if (problems.length) throw new LibraryError(`This part can't be saved yet:\n• ${problems.join('\n• ')}`);
  const before = library.parts[part.id];
  const strip = (p) => { const { origin, ...rest } = p; void origin; return JSON.stringify(rest); };
  const changed = !before || strip(before) !== strip(part);
  const version = (before?.origin?.version || part.origin?.version || 0) + (changed ? 1 : 0);
  const stored = { ...structuredClone(part), origin: { library: library.id, partId: part.id, version: Math.max(1, version) } };
  library.parts[part.id] = stored;
  return stored;
}

export function renameLibrary(library, name) {
  const n = String(name || '').trim();
  if (!n) throw new LibraryError('A library needs a name.');
  library.name = n; // the id stays, so Projects' Library origins still match
}

export const serializeLibrary = (library) => JSON.stringify(library, null, 1) + '\n';

/** Read a Library file. Throws LibraryError with a user-facing message. */
export function parseLibrary(text) {
  let j;
  try { j = JSON.parse(text); } catch { throw new LibraryError('This file is not an ElectroCAD library (it is not valid JSON).'); }
  if (!j || j.format !== LIBRARY_FORMAT) throw new LibraryError('This file is not an ElectroCAD library.');
  // version 1 had no Footprints; it reads as a version 2 Library with none (nothing is lost)
  if (j.version === 1 && !j.footprints) { j.footprints = {}; j.version = LIBRARY_VERSION; }
  if (j.version !== LIBRARY_VERSION) throw new LibraryError(`This library was saved by a different version of ElectroCAD (library version ${j.version}; this app reads ${LIBRARY_VERSION}).`);
  if (typeof j.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,40}$/.test(j.id) || typeof j.name !== 'string' || !j.parts || typeof j.parts !== 'object' || !j.footprints || typeof j.footprints !== 'object') throw new LibraryError('This library file is damaged.');
  for (const [id, fp] of Object.entries(j.footprints)) {
    const bad = footprintSchemaErrors(fp);
    if (bad.length) throw new LibraryError(`This library file is damaged: footprint ${fp?.name || id} (${bad[0]}).`);
  }
  for (const [id, p] of Object.entries(j.parts)) {
    const problems = partProblems(p).filter((x) => x.startsWith('Damaged'));
    if (p.id !== id || problems.length) throw new LibraryError(`This library file is damaged: part ${p.name || id}${problems.length ? ` (${problems[0]})` : ''}.`);
  }
  return j;
}

// ---------------------------------------------------------------- Footprints (#19)

/** Layers a Pad can be on: SMD pads on the top; through-hole pads on every copper and mask layer. */
export const SMD_LAYERS = ['F.Cu', 'F.Paste', 'F.Mask'];
export const THT_LAYERS = ['*.Cu', '*.Mask'];
/** Layers a Footprint's graphics can be drawn on (its own side; flipping puts them on B.*). */
export const FOOTPRINT_LAYERS = ['F.SilkS', 'F.CrtYd', 'F.Fab'];
export const PAD_SHAPES = ['rect', 'roundrect', 'circle', 'oval'];

export function newFootprint(name = 'New footprint') {
  return { name, pads: [], graphics: [] };
}

const footprintSchemaErrors = (fp) => checkSchema({ ...ECAD_SCHEMA, ...ECAD_SCHEMA.$defs.footprint, $defs: ECAD_SCHEMA.$defs }, fp).map((e) => e.replace(/^\$\.?/, ''));

/**
 * What is wrong with a Footprint: `errors` stop it being saved, `warnings` don't.
 *  errors: no name, no pads, a pad without a number, sizes not above zero, a through-hole pad
 *          without a drill or with a drill as big as the pad, damage (the schema)
 *  warnings: pad numbers used twice (they are joined: one Net), no courtyard
 */
export function footprintProblems(fp) {
  const errors = [], warnings = [];
  if (!fp || typeof fp !== 'object') return { errors: ['This is not a footprint.'], warnings };
  if (!String(fp.name || '').trim()) errors.push('The footprint needs a name.');
  for (const e of footprintSchemaErrors(fp).slice(0, 3)) errors.push(`Damaged: ${e}`);
  const pads = Array.isArray(fp.pads) ? fp.pads : [];
  if (!pads.length) errors.push('The footprint has no pads.');
  const count = new Map();
  for (const p of pads) {
    const n = String(p.number ?? '').trim();
    if (!n) { errors.push('A pad has no number.'); continue; }
    count.set(n, (count.get(n) || 0) + 1);
    if (!(p.size?.[0] > 0 && p.size?.[1] > 0)) errors.push(`Pad ${n} needs a width and height above zero.`);
    const tht = (p.layers || []).includes('*.Cu');
    if (tht && !(p.drill > 0)) errors.push(`Through-hole pad ${n} needs a drill.`);
    if (p.drill > 0 && p.size && p.drill >= Math.min(p.size[0], p.size[1])) errors.push(`Pad ${n}'s drill is as big as the pad: no copper is left around it.`);
    if (!tht && p.drill > 0) errors.push(`Pad ${n} has a drill but is SMD: make it through-hole.`);
  }
  const twice = [...count].filter(([, c]) => c > 1).map(([n]) => n);
  if (twice.length) warnings.push(`Pad number${twice.length === 1 ? '' : 's'} ${twice.join(', ')} ${twice.length === 1 ? 'is' : 'are'} used more than once: those pads are joined (one net), as for a tab.`);
  if (!(fp.graphics || []).some((g) => /CrtYd$/.test(g.layer || ''))) warnings.push('There is no courtyard (F.CrtYd): DRC can\'t check that parts keep apart.');
  return { errors, warnings };
}

/**
 * Save a Footprint into a Library under `id` (a new id from its name when null). Refused with a
 * LibraryError when it has errors. Returns the id.
 */
export function saveFootprint(library, fp, id = null) {
  const { errors } = footprintProblems(fp);
  if (errors.length) throw new LibraryError(`This footprint can't be saved yet:\n• ${errors.join('\n• ')}`);
  library.footprints ||= {};
  const key = id || slugId(fp.name, Object.keys(library.footprints));
  library.footprints[key] = structuredClone({ name: fp.name, pads: fp.pads, graphics: fp.graphics || [] });
  return key;
}

/** Every Footprint in these Libraries: [{ library, id, footprint }]. */
export const libraryFootprints = (libraries) => libraries.flatMap((l) => Object.entries(l.footprints || {}).map(([id, footprint]) => ({ library: l, id, footprint })));
