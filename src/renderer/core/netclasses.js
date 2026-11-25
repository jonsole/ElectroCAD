// Net classes (#24): named sets of rules (track width, clearance, via drill and diameter) that
// list their Nets. A Net in no class uses the Board's Design rules (the "Default" class). The
// router takes new tracks' width and vias from a Net's class, and the collision engine, Zones and
// DRC its clearance (core/collision.js netRules). Net names match regardless of case (ADR-0013);
// a Net is in at most one class. DOM-free.
import { netRules } from './collision.js';

export { netRules };
export const DEFAULT_CLASS = 'Default';
export const CLASS_FIELDS = [['trackWidth', 'Track width'], ['clearance', 'Clearance'], ['viaDrill', 'Via drill'], ['viaDiameter', 'Via diameter']];

const low = (s) => String(s || '').toLowerCase();

/** The name of the class `net` is in (DEFAULT_CLASS when none). */
export function netClassOf(board, net) {
  for (const [name, nc] of Object.entries(board.netClasses || {})) if ((nc.nets || []).some((n) => low(n) === low(net))) return name;
  return DEFAULT_CLASS;
}

function checkName(board, name, except = null) {
  const n = String(name || '').trim();
  if (!n) throw new Error('A net class needs a name.');
  if (low(n) === low(DEFAULT_CLASS)) throw new Error('"Default" is the Board\'s Design rules: pick another name.');
  if (Object.keys(board.netClasses || {}).some((k) => k !== except && low(k) === low(n))) throw new Error(`There is already a net class called ${n}.`);
  return n;
}

/** Add a net class, starting from the Design rules (or `values`). Returns its name. */
export function addNetClass(project, name, values = {}) {
  const b = project.board;
  const n = checkName(b, name);
  const r = b.rules;
  b.netClasses = { ...(b.netClasses || {}), [n]: { trackWidth: r.trackWidth, clearance: r.clearance, viaDrill: r.viaDrill, viaDiameter: r.viaDiameter, ...values, nets: [] } };
  return n;
}

export function renameNetClass(project, from, to) {
  const b = project.board;
  if (!b.netClasses?.[from]) throw new Error(`No net class ${from}.`);
  const n = checkName(b, to, from);
  b.netClasses = Object.fromEntries(Object.entries(b.netClasses).map(([k, v]) => [k === from ? n : k, v]));
  return n;
}

/** Delete a net class: its Nets go back to the Default rules. */
export function deleteNetClass(project, name) {
  const { [name]: gone, ...rest } = project.board.netClasses || {};
  if (!gone) throw new Error(`No net class ${name}.`);
  project.board.netClasses = rest;
}

/** Set one of a class's rules (nm, positive); its via must stay larger than its drill. */
export function setNetClassRule(project, name, key, nm) {
  const nc = project.board.netClasses?.[name];
  if (!nc) throw new Error(`No net class ${name}.`);
  if (!CLASS_FIELDS.some(([k]) => k === key)) throw new Error(`Unknown rule "${key}".`);
  if (!(nm > 0)) throw new Error('Rules must be more than 0.');
  const next = { ...nc, [key]: Math.round(nm) };
  if (next.viaDiameter <= next.viaDrill) throw new Error('The via diameter must be larger than its drill.');
  project.board.netClasses = { ...project.board.netClasses, [name]: next };
}

/** Put `net` in class `name` (DEFAULT_CLASS or null: in none), taking it out of any other. */
export function assignNet(project, net, name) {
  const b = project.board;
  if (name && name !== DEFAULT_CLASS && !b.netClasses?.[name]) throw new Error(`No net class ${name}.`);
  const out = {};
  for (const [k, nc] of Object.entries(b.netClasses || {})) {
    const nets = (nc.nets || []).filter((n) => low(n) !== low(net));
    if (k === name) nets.push(net);
    out[k] = { ...nc, nets };
  }
  b.netClasses = out;
}

/** Every Net on the Board (from the annotation record, Tracks, Vias and Zones), sorted, one per name regardless of case. */
export function boardNets(board) {
  const seen = new Map();
  const add = (n) => { if (n && !seen.has(low(n))) seen.set(low(n), n); };
  for (const n of Object.keys(board.annotation?.nets || {})) add(n);
  for (const x of [...(board.tracks || []), ...(board.vias || []), ...(board.zones || [])]) add(x.net);
  for (const nc of Object.values(board.netClasses || {})) for (const n of nc.nets || []) add(n);
  return [...seen.values()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}
