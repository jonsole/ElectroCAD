// Fab presets (#24): Generic plus popular hobby board houses, each for 2 and 4 copper layers.
// Applying one copies its values into the Board's Design rules (board.rules) and Fab output
// settings (board.fab); every value stays editable afterwards, and board.preset only records which
// preset they came from (shown for reference, with "edited" once they differ). DOM-free.
//
// The values are each house's standard-price capabilities from its published design rules, kept a
// little inside the absolute minimums (cheaper and more forgiving); check the house's current
// capabilities page before ordering. Sources (checked 2026-11):
//   JLCPCB  jlcpcb.com/capabilities/pcb-capabilities
//   PCBWay  pcbway.com/capabilities.html
//   OSH Park docs.oshpark.com/services (2-layer: 6/6 mil, 10 mil drill, 5 mil ring, 15 mil edge;
//           4-layer: 5/5 mil, 8 mil drill, 4 mil ring)
import { PAIR_KEYS } from './collision.js';
import { mm } from './units.js';

const mil = (n) => Math.round(n * 25_400);

/** The rule keys a preset fills, in the order the dialog shows them, with their labels. */
export const RULE_FIELDS = [
  ['clearance', 'Clearance', 'The least gap between copper of different nets'],
  ['trackWidth', 'Track width', 'The width new tracks get (a net class can set its own)'],
  ['viaDrill', 'Via drill', 'The drill of new vias'],
  ['viaDiameter', 'Via diameter', 'The copper diameter of new vias'],
  ['minHole', 'Minimum hole', 'The smallest drill the fab makes at standard price'],
  ['annularRing', 'Annular ring', 'The least copper left round a hole'],
  ['edgeClearance', 'Edge clearance', 'The least gap from copper to the board edge'],
];

const FAB_DEFAULT = { naming: 'protel', drillUnits: 'mm' };

const r = (clearance, trackWidth, viaDrill, viaDiameter, minHole, annularRing, edgeClearance) => ({ clearance, trackWidth, viaDrill, viaDiameter, minHole, annularRing, edgeClearance });

/** { id, fab, name, copper, rules, fab output settings, note } */
export const FAB_PRESETS = [
  { id: 'generic-2', fab: 'Generic', copper: 2, rules: r(mm(0.2), mm(0.25), mm(0.3), mm(0.6), mm(0.3), mm(0.13), mm(0.3)), output: FAB_DEFAULT, note: 'Comfortable values most board houses make at standard price.' },
  { id: 'generic-4', fab: 'Generic', copper: 4, rules: r(mm(0.15), mm(0.2), mm(0.3), mm(0.6), mm(0.3), mm(0.13), mm(0.3)), output: FAB_DEFAULT, note: 'Comfortable values most board houses make at standard price.' },
  { id: 'jlcpcb-2', fab: 'JLCPCB', copper: 2, rules: r(mm(0.15), mm(0.15), mm(0.3), mm(0.6), mm(0.3), mm(0.15), mm(0.3)), output: FAB_DEFAULT, note: 'Minimums 0.127 mm track and gap, 0.3 mm via drill at standard price, 0.13 mm annular ring.' },
  { id: 'jlcpcb-4', fab: 'JLCPCB', copper: 4, rules: r(mm(0.1), mm(0.1), mm(0.3), mm(0.6), mm(0.3), mm(0.15), mm(0.3)), output: FAB_DEFAULT, note: 'Minimums 0.09 mm track and gap on multilayer boards; vias under 0.3 mm cost extra.' },
  { id: 'pcbway-2', fab: 'PCBWay', copper: 2, rules: r(mm(0.15), mm(0.15), mm(0.3), mm(0.6), mm(0.3), mm(0.15), mm(0.3)), output: FAB_DEFAULT, note: 'Minimums 0.1 mm track and gap (0.15 mm suggested for cost); holes under 0.2 mm cost extra.' },
  { id: 'pcbway-4', fab: 'PCBWay', copper: 4, rules: r(mm(0.127), mm(0.127), mm(0.3), mm(0.6), mm(0.3), mm(0.15), mm(0.3)), output: FAB_DEFAULT, note: 'Minimums 0.1 mm track and gap; holes under 0.2 mm cost extra.' },
  { id: 'oshpark-2', fab: 'OSH Park', copper: 2, rules: r(mil(6), mil(6), mil(10), mil(20), mil(10), mil(5), mil(15)), output: FAB_DEFAULT, note: '6 mil track and gap, 10 mil drill, 5 mil annular ring, 15 mil from the board edge.' },
  { id: 'oshpark-4', fab: 'OSH Park', copper: 4, rules: r(mil(5), mil(5), mil(8), mil(16), mil(8), mil(4), mil(15)), output: FAB_DEFAULT, note: '5 mil track and gap, 8 mil drill, 4 mil annular ring, 15 mil from the board edge.' },
].map((p) => ({ ...p, name: `${p.fab} ${p.copper}-layer` }));

/** The board houses, in order, for the picker. */
export const FABS = [...new Set(FAB_PRESETS.map((p) => p.fab))];

export const presetById = (id) => FAB_PRESETS.find((p) => p.id === id) || null;
/** The preset of `fab` for a board with `copper` layers. */
export const presetFor = (fab, copper) => FAB_PRESETS.find((p) => p.fab === fab && p.copper === copper) || FAB_PRESETS.find((p) => p.fab === fab) || null;

/** Old ids ('generic') name the Generic preset of the board's layer count. */
function resolve(board) {
  const p = presetById(board.preset);
  if (p) return p;
  const fab = FABS.find((f) => f.toLowerCase().replace(/\s/g, '') === String(board.preset || '').toLowerCase());
  return fab ? presetFor(fab, board.stack.copper) : null;
}

/** Copy a preset's rules and output settings into the Board (in place). Returns the preset. */
export function applyPreset(project, id) {
  const p = presetById(id);
  if (!p) throw new Error(`No fab preset "${id}".`);
  const b = project.board;
  b.rules = { ...b.rules, ...p.rules };
  if (!p.rules.pairs) delete b.rules.pairs; // a preset's clearance is for every pair of objects (#68)
  b.fab = { ...(b.fab || {}), ...p.output };
  b.preset = p.id;
  return p;
}

/**
 * What the Board's rules are based on, for display: { preset, name, edited, mismatch } where
 * `edited` lists the rule keys changed since, and `mismatch` says the preset is for another layer
 * count.
 */
export function presetState(board) {
  const p = resolve(board);
  if (!p) return { preset: null, name: board.preset ? String(board.preset) : 'Custom', edited: [], mismatch: false };
  const edited = RULE_FIELDS.map(([k]) => k).filter((k) => board.rules[k] !== p.rules[k]);
  return { preset: p, name: p.name, edited, mismatch: p.copper !== board.stack.copper };
}

/**
 * Set (nm, positive) or clear (null) the clearance between different nets for a pair of object
 * kinds (#68): `key` 'track-track', 'track-pad', 'track-via', 'pad-pad', 'pad-via' or 'via-via'.
 */
export function setPairRule(project, key, nm) {
  if (!PAIR_KEYS.includes(key)) throw new Error(`Unknown object pair "${key}".`);
  const pairs = { ...(project.board.rules.pairs || {}) };
  if (nm == null) delete pairs[key];
  else if (!(nm > 0)) throw new Error('Clearances must be more than 0.');
  else pairs[key] = Math.round(nm);
  const rules = { ...project.board.rules, pairs };
  if (!Object.keys(pairs).length) delete rules.pairs;
  project.board.rules = rules;
}

/** Set one design rule (nm, positive). Checks the via keeps its annular ring sensible. */
export function setRule(project, key, nm) {
  if (!RULE_FIELDS.some(([k]) => k === key)) throw new Error(`Unknown rule "${key}".`);
  if (!(nm > 0) && !(key === 'edgeClearance' && nm === 0)) throw new Error('Rules must be more than 0.');
  const rules = { ...project.board.rules, [key]: Math.round(nm) };
  if (rules.viaDiameter <= rules.viaDrill) throw new Error('The via diameter must be larger than its drill.');
  project.board.rules = rules;
}

/** The Fab output settings, with defaults. */
export const fabSettings = (board) => ({ ...FAB_DEFAULT, ...(board.fab || {}) });
