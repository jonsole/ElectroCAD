// Field styles and automatic field placement (ADR-0012). DOM-free: text width comes from a
// `measure(text, sizeNm) -> widthNm` function the caller provides (canvas in the app, an
// estimate in tests).
//
// Each placed Symbol's fields form a block (stacked lines, or one line). The placer tries the
// style's candidate slots in order and takes the first that overlaps nothing: other Symbols'
// bodies and Pins, Wires (inflated by half a grid), and fields already placed. If every slot
// overlaps, it takes the one with the least overlap and flags it.
import { labelBounds } from './labels.js';
import { mm, SCH_GRID, snapPt } from './units.js';
import { place, unplace, shapePoints } from './geom.js';
import { partOf, footprintOf } from './project.js';
import { compareRefs } from './netlist.js';
import { formatValue } from './values.js';
import { unitLetter } from './library.js';

export const FIELD_STYLE_FORMAT = 'electrocad-field-style';
export const SLOTS = ['split', 'above', 'below', 'right', 'left'];
export const SLOT_LABEL = { split: 'Reference above, Value below', above: 'Above', below: 'Below', right: 'Right', left: 'Left' };
export const VALUE_FORMATS = { 'as-typed': 'As typed', rkm: 'RKM (4k7, 2R2, 100n)', si: 'SI (4.7k, 100nF)' };

/** Thrown for Field style files that can't be imported. */
export class FieldStyleError extends Error {
  constructor(message) { super(message); this.name = 'FieldStyleError'; }
}

const base = {
  builtin: true,
  arrangement: 'stacked',
  show: { reference: true, value: true, footprint: false, mpn: false, hideValueIfPartName: false },
  text: { size: mm(1.27), bold: false, italic: false, gap: mm(0.5) },
  valueFormat: 'as-typed',
};

export const BUILTIN_FIELD_STYLES = [
  { ...base, id: 'classic', name: 'Classic', placement: { horizontal: ['split', 'above', 'below', 'right', 'left'], vertical: ['right', 'left', 'above', 'below'] } },
  { ...base, id: 'compact', name: 'Compact', arrangement: 'one-line', show: { ...base.show, hideValueIfPartName: true },
    text: { ...base.text, size: mm(1.0), gap: mm(0.4) }, placement: { horizontal: ['above', 'below', 'right', 'left'], vertical: ['right', 'left', 'above', 'below'] } },
  { ...base, id: 'stacked-right', name: 'Stacked right', placement: { horizontal: ['right', 'left', 'above', 'below'], vertical: ['right', 'left', 'above', 'below'] } },
  { ...base, id: 'rkm', name: 'RKM values', valueFormat: 'rkm', placement: { horizontal: ['split', 'above', 'below', 'right', 'left'], vertical: ['right', 'left', 'above', 'below'] } },
];

export const DEFAULT_FIELD_STYLE = 'classic';
export const builtinFieldStyle = (id) => BUILTIN_FIELD_STYLES.find((s) => s.id === id) || null;

/** The Field style a Component uses: its own override, else the Project default. */
export function styleFor(project, comp) {
  const fs = project.fieldStyles || { default: DEFAULT_FIELD_STYLE, styles: {} };
  const id = (comp && comp.fieldStyle) || fs.default;
  return fs.styles[id] || builtinFieldStyle(id) || builtinFieldStyle(DEFAULT_FIELD_STYLE);
}

/** Copy a style into the Project (as Parts are, ADR-0004) so the file looks the same anywhere. */
function embed(project, style) {
  project.fieldStyles ||= { default: DEFAULT_FIELD_STYLE, styles: {} };
  project.fieldStyles.styles[style.id] = structuredClone(style);
}

/** Set the Project's default Field style. */
export function setDefaultFieldStyle(project, style) {
  embed(project, style);
  project.fieldStyles.default = style.id;
}

/** Give Components their own Field style, or clear it (style null) to follow the Project default. */
export function setComponentFieldStyle(project, componentIds, style) {
  if (style) embed(project, style);
  for (const id of componentIds) {
    const c = project.components[id];
    if (!c) continue;
    if (style) c.fieldStyle = style.id; else delete c.fieldStyle;
  }
}

// ---------------------------------------------------------------- pinned fields (#53)
//
// A field dragged by hand is pinned: its text centre is stored on the Symbol in the Symbol's own
// frame (sym.fieldPins[key] = [x, y]), so it follows the Symbol when it moves, rotates or mirrors,
// while the text itself stays upright. The placer never moves it, and it is an obstacle for others.

const findSymbol = (project, id) => project.schematic.sheets.flatMap((s) => s.symbols).find((y) => y.id === id);

/** Pin a field's text centre at world point `at`, snapped to a quarter grid. */
export function pinField(project, symbolId, key, at) {
  const sym = findSymbol(project, symbolId);
  if (!sym) return null;
  const w = snapPt(at, SCH_GRID / 4);
  sym.fieldPins = { ...(sym.fieldPins || {}), [key]: unplace(w, sym.at, sym.rot || 0, !!sym.mirror) };
  return w;
}

/** Where a pinned field's text centre is in the world, or null when it isn't pinned. */
export function pinnedFieldAt(sym, key) {
  const local = sym.fieldPins && sym.fieldPins[key];
  return local ? place(local, sym.at, sym.rot || 0, !!sym.mirror) : null;
}

export const hasPinnedFields = (sym) => !!(sym.fieldPins && Object.keys(sym.fieldPins).length);

/** Re-apply style: unpin every field of these Symbols so the Field style places them again. */
export function unpinFields(project, symbolIds) {
  const want = new Set(symbolIds);
  let n = 0;
  for (const s of project.schematic.sheets) for (const y of s.symbols) if (want.has(y.id) && y.fieldPins) { n += Object.keys(y.fieldPins).length; delete y.fieldPins; }
  return n;
}

// ---------------------------------------------------------------- placement

const box = (x0, y0, x1, y1, owner = null) => ({ x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1), owner });
const overlap = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));

function symbolGeometry(project, sym) {
  const comp = project.components[sym.componentId];
  const part = partOf(project, comp);
  const unit = part && part.units[sym.unit || 0];
  if (!unit) return null;
  const P = (p) => place(p, sym.at, sym.rot, sym.mirror);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = ([x, y]) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  const body = [];
  for (const g of unit.graphics) {
    if (g.type === 'text') continue; // text isn't body: fields may sit over it
    const pts = shapePoints(g);
    const w = pts.map(P);
    w.forEach(add);
    // inflate by a stroke so thin lines (a capacitor's plates) still take up space
    const t = mm(0.3);
    if (w.length) body.push(box(Math.min(...w.map((p) => p[0])) - t, Math.min(...w.map((p) => p[1])) - t, Math.max(...w.map((p) => p[0])) + t, Math.max(...w.map((p) => p[1])) + t));
  }
  const DIRS = { L: [-1, 0], R: [1, 0], U: [0, -1], D: [0, 1] };
  const pins = unit.pins.map((pin) => {
    const d = DIRS[pin.dir] || [0, 0];
    const a = P(pin.at), b = P([pin.at[0] + d[0] * pin.length, pin.at[1] + d[1] * pin.length]);
    add(a); add(b);
    const t = mm(0.25);
    return box(a[0] - t, a[1] - t, b[0] + t, b[1] + t);
  });
  return { comp, part, unit, bounds: box(x0, y0, x1, y1), body, pins };
}

/** The text lines a style shows for a Component, in order: [{ key, text }]. */
export function fieldLines(project, comp, part, style, unitIndex = 0) {
  const lines = [];
  const ref = comp.ref + unitLetter(part, unitIndex);
  if (style.show.reference) lines.push({ key: 'reference', text: ref });
  const hideValue = style.show.hideValueIfPartName && String(comp.value).trim().toLowerCase() === String(part.name).trim().toLowerCase();
  // resistors are the only parts whose Value is in ohms (RKM's 'R' decimal point)
  const resistance = /^R(?![A-Z])/i.test(part.prefix || '') && !/^(RLY|RV)/i.test(part.prefix || '');
  if (style.show.value && comp.value && !hideValue) lines.push({ key: 'value', text: formatValue(comp.value, style.valueFormat, { resistance }) });
  if (style.show.footprint && comp.footprint) {
    const fp = footprintOf(project, comp)?.name || comp.footprint.fpId || comp.footprint.fpKey;
    if (fp) lines.push({ key: 'footprint', text: fp });
  }
  if (style.show.mpn && comp.mpn && comp.mpn.number) lines.push({ key: 'mpn', text: comp.mpn.number });
  return lines;
}

/**
 * Lay a block of lines out in a slot around bounds `b`. Returns [{ key, text, x, y, align, box }]:
 * x,y is the text anchor (baseline middle), box the space it takes.
 */
function layout(slot, lines, style, b, measure) {
  const { size, gap } = style.text;
  const lh = Math.round(size * 1.25);
  const oneLine = style.arrangement === 'one-line';
  const blocks = oneLine ? [{ lines, text: lines.map((l) => l.text).join(' ') }] : lines.map((l) => ({ lines: [l], text: l.text }));
  const widths = blocks.map((bk) => measure(bk.text, size));
  const W = Math.max(0, ...widths), H = lh * blocks.length;
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
  const at = (x0, y0, align) => blocks.map((bk, i) => {
    const w = widths[i];
    const left = align === 'left' ? x0 : align === 'right' ? x0 + W - w : x0 + (W - w) / 2;
    const y = y0 + i * lh;
    return { keys: bk.lines.map((l) => l.key), text: bk.text, x: align === 'left' ? left : align === 'right' ? left + w : left + w / 2, y: y + lh / 2, align, box: box(left, y, left + w, y + lh) };
  });
  switch (slot) {
    case 'above': return at(cx - W / 2, b.y0 - gap - H, 'center');
    case 'below': return at(cx - W / 2, b.y1 + gap, 'center');
    case 'right': return at(b.x1 + gap, cy - H / 2, 'left');
    case 'left': return at(b.x0 - gap - W, cy - H / 2, 'right');
    case 'split': {
      if (blocks.length < 2) return layout('above', lines, style, b, measure);
      const [first, ...rest] = blocks;
      const restLines = rest.flatMap((bk) => bk.lines);
      const top = layout('above', first.lines, { ...style, arrangement: 'stacked' }, b, measure);
      const bottom = layout('below', restLines, { ...style, arrangement: 'stacked' }, b, measure);
      return [...top, ...bottom];
    }
    default: return at(cx - W / 2, b.y0 - gap - H, 'center');
  }
}

/**
 * Place every Symbol's fields on a Sheet. Returns Map(symbolId -> { items, slot, flagged,
 * overlapWith }), where items are [{ keys, text, x, y, align, box }] in world nm.
 */
export function placeFields(project, sheet, { measure, wires = sheet.wires, refs = null } = {}) {
  const geo = new Map();
  for (const sym of sheet.symbols) { const g = symbolGeometry(project, sym); if (g) geo.set(sym.id, g); }
  // fixed obstacles: bodies, Pins, Wires (inflated by half a grid)
  const fixed = [];
  for (const [id, g] of geo) { for (const b of [...g.body, ...g.pins]) fixed.push({ ...b, owner: id }); }
  const half = SCH_GRID / 2;
  for (const w of wires) fixed.push(box(Math.min(w.a[0], w.b[0]) - half / 2, Math.min(w.a[1], w.b[1]) - half / 2, Math.max(w.a[0], w.b[0]) + half / 2, Math.max(w.a[1], w.b[1]) + half / 2, 'wire'));
  for (const l of sheet.labels || []) { const b = labelBounds(l, measure, refs?.get(l.id)); fixed.push(box(b.x0, b.y0, b.x1, b.y1, 'label')); }
  const placed = [];
  const out = new Map();
  // pinned fields first: they never move, and every other field keeps clear of them
  const pinnedItems = new Map();
  for (const sym of sheet.symbols) {
    const g = geo.get(sym.id);
    if (!g || !hasPinnedFields(sym)) continue;
    const style = styleFor(project, g.comp);
    const lh = Math.round(style.text.size * 1.25);
    const items = [];
    for (const line of fieldLines(project, g.comp, g.part, style, sym.unit || 0)) {
      const at = pinnedFieldAt(sym, line.key);
      if (!at) continue;
      const w = measure(line.text, style.text.size);
      items.push({ keys: [line.key], text: line.text, x: at[0], y: at[1], align: 'center', pinned: true, box: box(at[0] - w / 2, at[1] - lh / 2, at[0] + w / 2, at[1] + lh / 2) });
    }
    pinnedItems.set(sym.id, items);
    for (const it of items) placed.push({ ...it.box, owner: sym.id });
  }
  const order = [...sheet.symbols].filter((s) => geo.has(s.id))
    .sort((a, b) => compareRefs(geo.get(a.id).comp.ref, geo.get(b.id).comp.ref) || (a.unit || 0) - (b.unit || 0) || (a.id < b.id ? -1 : 1));
  for (const sym of order) {
    const g = geo.get(sym.id);
    const style = styleFor(project, g.comp);
    const pinned = pinnedItems.get(sym.id) || [];
    const lines = fieldLines(project, g.comp, g.part, style, sym.unit || 0).filter((l) => !pinned.some((it) => it.keys[0] === l.key));
    if (!lines.length) { out.set(sym.id, { items: pinned, slot: null, flagged: false }); continue; }
    const vertical = (sym.rot || 0) % 180 !== 0;
    const slots = (vertical ? style.placement.vertical : style.placement.horizontal).filter((s) => SLOTS.includes(s));
    let best = null;
    for (const slot of slots.length ? slots : ['above']) {
      const items = layout(slot, lines, style, g.bounds, measure);
      let score = 0, withWhom = null;
      for (const it of items) {
        for (const o of fixed) { if (o.owner === sym.id) continue; const a = overlap(it.box, o); if (a > 0) { score += a; withWhom ||= o.owner; } }
        for (const o of placed) { const a = overlap(it.box, o); if (a > 0) { score += a; withWhom ||= o.owner === sym.id ? 'own' : o.owner; } }
      }
      if (!best || score < best.score) best = { slot, items, score, withWhom };
      if (score === 0) break;
    }
    for (const it of best.items) placed.push({ ...it.box, owner: sym.id });
    const ownerRef = (owner) => (owner === 'wire' ? 'a wire' : geo.get(owner)?.comp.ref || null);
    out.set(sym.id, { items: [...pinned, ...best.items], slot: best.slot, flagged: best.score > 0, overlapWith: best.score > 0 ? ownerRef(best.withWhom) : null });
  }
  return out;
}

/** Plain-language warnings for fields that couldn't find a free spot. */
export function fieldWarnings(project, sheet, placement) {
  const out = [];
  for (const sym of sheet.symbols) {
    const r = placement.get(sym.id);
    if (r && r.flagged) out.push(`${project.components[sym.componentId].ref} fields overlap ${r.overlapWith || 'something'}`);
  }
  return out;
}

/** Rough text width for tests and DOM-free callers: 0.6 x size per character. */
export const estimateWidth = (text, size) => Math.round(String(text).length * size * 0.6);

// ---------------------------------------------------------------- custom styles: copy, import, export

let counter = 1;
const newId = () => 'fs' + Date.now().toString(36) + (counter++).toString(36) + Math.random().toString(36).slice(2, 5);

export function duplicateFieldStyle(style, taken = []) {
  const names = new Set(taken.map((s) => s.name));
  let name = `${style.name} (copy)`;
  for (let i = 2; names.has(name); i++) name = `${style.name} (copy ${i})`;
  const copy = structuredClone(style);
  delete copy.builtin;
  return { ...copy, id: newId(), name };
}

export function exportFieldStyle(style) {
  const { id, builtin, ...rest } = style;
  void id; void builtin;
  return JSON.stringify({ format: FIELD_STYLE_FORMAT, version: 1, ...rest }, null, 2) + '\n';
}

/** Validate and read a Field style file; missing settings are filled from Classic. */
export function importFieldStyle(text, taken = []) {
  let j;
  try { j = JSON.parse(text); } catch { throw new FieldStyleError('This file is not an ElectroCAD field style (it is not valid JSON).'); }
  if (!j || j.format !== FIELD_STYLE_FORMAT) throw new FieldStyleError('This file is not an ElectroCAD field style.');
  const c = builtinFieldStyle('classic');
  const pl = j.placement || {};
  for (const k of ['horizontal', 'vertical']) {
    if (pl[k] !== undefined && (!Array.isArray(pl[k]) || !pl[k].length || pl[k].some((s) => !SLOTS.includes(s)))) {
      throw new FieldStyleError(`placement.${k} must be a list of: ${SLOTS.join(', ')}.`);
    }
  }
  if (j.valueFormat !== undefined && !VALUE_FORMATS[j.valueFormat]) throw new FieldStyleError(`valueFormat must be one of: ${Object.keys(VALUE_FORMATS).join(', ')}.`);
  if (j.arrangement !== undefined && !['stacked', 'one-line'].includes(j.arrangement)) throw new FieldStyleError('arrangement must be "stacked" or "one-line".');
  const t = { ...c.text, ...(j.text || {}) };
  if (!(t.size >= mm(0.3) && t.size <= mm(10))) throw new FieldStyleError('text.size must be between 0.3 and 10 mm (in nanometres).');
  const s = {
    name: typeof j.name === 'string' && j.name.trim() ? j.name.trim().slice(0, 60) : 'Imported style',
    arrangement: j.arrangement || c.arrangement,
    show: { ...c.show, ...(j.show || {}) },
    text: { size: Math.round(t.size), bold: !!t.bold, italic: !!t.italic, gap: Math.max(0, Math.round(t.gap || 0)) },
    valueFormat: j.valueFormat || c.valueFormat,
    placement: { horizontal: pl.horizontal || c.placement.horizontal, vertical: pl.vertical || c.placement.vertical },
  };
  const names = new Set(taken.map((x) => x.name));
  let name = s.name;
  for (let i = 2; names.has(name); i++) name = `${s.name} (${i})`;
  return { ...s, id: newId(), name };
}

/**
 * Which field is at world point `pt` (within `tol` nm), from a placeFields result. For a
 * one-line block ("R1 10k") the half under the point decides: the Reference designator's text
 * width (from `measure`) splits it. Returns { symbolId, key, item } or null.
 */
export function hitField(project, placement, pt, tol = 0, measure = estimateWidth) {
  for (const [symbolId, r] of placement) {
    for (const it of r.items) {
      const b = it.box;
      if (pt[0] < b.x0 - tol || pt[0] > b.x1 + tol || pt[1] < b.y0 - tol || pt[1] > b.y1 + tol) continue;
      if (it.keys.length === 1) return { symbolId, key: it.keys[0], item: it };
      // one line: split at the end of the first field's text plus the space
      const first = it.text.split(' ')[0];
      const sym = project.schematic.sheets.flatMap((s) => s.symbols).find((y) => y.id === symbolId);
      const style = styleFor(project, sym && project.components[sym.componentId]);
      const split = b.x0 + measure(first + ' ', style.text.size);
      return { symbolId, key: pt[0] <= split ? it.keys[0] : it.keys[1] || it.keys[0], item: it };
    }
  }
  return null;
}
