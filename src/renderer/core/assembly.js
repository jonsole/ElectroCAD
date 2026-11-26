// Assembly files (#27): the BOM and the pick-and-place list, as CSV, for the fab zip. DOM-free.
//
// BOM: one row per group of identical parts (Part, Value, Footprint, MPN and manufacturer, and
// custom fields alike), with the quantity and the sorted Reference designators. It lists every
// Component on the Schematic, and the board-only Footprints (#74) marked In BOM.
//
// Pick-and-place: one row per Footprint on the Board (the same ones), at its origin, in mm in the
// Gerbers' own coordinates (X right, Y up, the same origin), so the placement lines up with the
// copper. Rotation is the Footprint's, counter-clockwise as seen from the top; a back-side one is
// marked Bottom.
import { compareRefs } from './netlist.js';
import { footprintOf, partOf } from './project.js';
import { bfFootprint, bfRef, bfValue } from './footprint.js';
import { fabBaseName } from './fab.js';

/** A CSV field: quoted when it holds a comma, quote or line break (RFC 4180). */
const field = (v) => { const s = String(v ?? ''); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const csv = (rows) => rows.map((r) => r.map(field).join(',')).join('\r\n') + '\r\n';
const mmText = (nm) => (nm / 1e6).toFixed(4);

/** What goes in the BOM: { ref, value, footprint, part, mpn, manufacturer, fields } per item. */
export function bomItems(project) {
  const items = [];
  for (const c of Object.values(project.components)) {
    items.push({ ref: c.ref, value: c.value || '', footprint: footprintOf(project, c)?.name || '', part: partOf(project, c)?.name || '', mpn: c.mpn?.number || '', manufacturer: c.mpn?.manufacturer || '', fields: c.fields || {} });
  }
  for (const bf of project.board?.footprints || []) {
    if (bf.componentId || !bf.bom) continue;
    items.push({ ref: bf.ref, value: bf.value || '', footprint: bfFootprint(project, bf)?.name || '', part: '', mpn: '', manufacturer: '', fields: {} });
  }
  return items;
}

/**
 * The BOM as rows: [{ quantity, refs: [..sorted], value, footprint, part, mpn, manufacturer,
 * fields }], identical items grouped, ordered by their first Reference.
 */
export function bomRows(project) {
  const groups = new Map();
  for (const it of bomItems(project)) {
    const fields = Object.fromEntries(Object.entries(it.fields).sort(([a], [b]) => a.localeCompare(b)));
    const key = JSON.stringify([it.part, it.value, it.footprint, it.mpn, it.manufacturer, fields]);
    if (!groups.has(key)) groups.set(key, { ...it, fields, refs: [] });
    groups.get(key).refs.push(it.ref);
  }
  const rows = [...groups.values()].map(({ ref, ...g }) => ({ ...g, refs: g.refs.sort(compareRefs), quantity: g.refs.length }));
  return rows.sort((a, b) => compareRefs(a.refs[0], b.refs[0]));
}

/** The BOM CSV: Quantity, References, Value, Footprint, MPN, Manufacturer, Part, then each custom field. */
export function bomCsv(project) {
  const rows = bomRows(project);
  const extra = [...new Set(rows.flatMap((r) => Object.keys(r.fields)))].sort((a, b) => a.localeCompare(b));
  return csv([
    ['Quantity', 'References', 'Value', 'Footprint', 'MPN', 'Manufacturer', 'Part', ...extra],
    ...rows.map((r) => [r.quantity, r.refs.join(', '), r.value, r.footprint, r.mpn, r.manufacturer, r.part, ...extra.map((k) => r.fields[k] ?? '')]),
  ]);
}

/** The pick-and-place rows: [{ ref, value, footprint, x, y (mm, Y up), rotation, side }], by Reference. */
export function placementRows(project) {
  const out = [];
  for (const bf of project.board?.footprints || []) {
    if (!bf.componentId && !bf.bom) continue; // board-only Footprints only when they're in the BOM
    const fp = bfFootprint(project, bf);
    if (!fp) continue;
    out.push({ ref: bfRef(project, bf), value: bfValue(project, bf), footprint: fp.name, x: bf.at[0], y: -bf.at[1], rotation: Math.round((bf.rot || 0) * 100) / 100, side: bf.side === 'B' ? 'Bottom' : 'Top' });
  }
  return out.sort((a, b) => compareRefs(a.ref, b.ref));
}

/** The pick-and-place CSV: Designator, Value, Footprint, Mid X, Mid Y (mm), Rotation (degrees), Side. */
export function placementCsv(project) {
  return csv([
    ['Designator', 'Value', 'Footprint', 'Mid X (mm)', 'Mid Y (mm)', 'Rotation', 'Side'],
    ...placementRows(project).map((r) => [r.ref, r.value, r.footprint, mmText(r.x), mmText(r.y), r.rotation.toFixed(2), r.side]),
  ]);
}

/** The assembly files for the fab zip: [{ name, kind: 'bom' | 'pnp', text }]. */
export function assemblyFiles(project, { bom = true, pnp = true } = {}) {
  const base = fabBaseName(project);
  return [
    ...(bom ? [{ name: `${base}-bom.csv`, kind: 'bom', layer: 'BOM', text: bomCsv(project) }] : []),
    ...(pnp ? [{ name: `${base}-pnp.csv`, kind: 'pnp', layer: 'PnP', text: placementCsv(project) }] : []),
  ];
}
