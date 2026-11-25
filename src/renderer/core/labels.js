// Net labels, Global labels and Power symbols (#7): their shapes in the label's local frame,
// used for drawing, hit testing and keeping fields clear of them. DOM-free; text width comes
// from a `measure(text, sizeNm)` function.
//
// A label is { id, at, rot, net, scope: 'local' | 'global', style: 'label' | 'power' | 'gnd',
// shape?: 'text' | 'flag', size? }. `at` is its connection point. Power symbols (+5V, GND) are always
// global. How a Net or Global label looks is its `shape` (#81): 'text', the name written on the
// wire, or 'flag', the pointed box; with no shape it follows the scope (local: text, global:
// flag). Scope alone decides what it joins. `size` is its text height (default LABEL_TEXT).
import { mm, SCH_GRID as G } from './units.js';
import { rot90 } from './geom.js';
import { estimateWidth } from './fields.js';

export const LABEL_TEXT = mm(1.27);

/** Common Power symbol names offered when placing one. */
export const POWER_NAMES = ['+3V3', '+5V', '+12V', 'VCC', 'VDD', 'VBAT', '+1V8', '-12V'];

export const isPower = (l) => l.style === 'power' || l.style === 'gnd';
export const labelKind = (l) => (isPower(l) ? 'power' : l.scope === 'global' ? 'global' : 'local');
/** How a label is drawn: 'power' | 'gnd' | 'text' | 'flag' (#81). */
export const labelLook = (l) => (isPower(l) ? l.style : l.shape === 'text' || l.shape === 'flag' ? l.shape : l.scope === 'global' ? 'flag' : 'text');
/** A label's text height (nm). */
export const labelSize = (l) => (l.size > 0 ? l.size : LABEL_TEXT);

/**
 * The shape of a label in its local frame (rotation 0: a label reads to the right of its point,
 * a power arrow points up, a ground points down). Returns { lines: [[pts]], polys: [[pts]],
 * text: { at, align, base } , box } where coordinates are nm relative to `at`.
 */
export function labelShape(label, measure = estimateWidth, refs = null) {
  const T = labelSize(label);
  const w = measure(labelText(label, refs), T);
  if (label.style === 'power') {
    const top = -1.6 * G;
    return {
      lines: [[[0, 0], [0, top]], [[-0.8 * G, top], [0.8 * G, top]]],
      polys: [],
      text: { at: [0, top - T * 0.8], align: 'center' },
      box: { x0: Math.min(-0.8 * G, -w / 2), y0: top - T * 1.5, x1: Math.max(0.8 * G, w / 2), y1: 0 },
    };
  }
  if (label.style === 'gnd') {
    return {
      lines: [[[0, 0], [0, G]], [[-G, G], [G, G]], [[-0.6 * G, 1.4 * G], [0.6 * G, 1.4 * G]], [[-0.2 * G, 1.8 * G], [0.2 * G, 1.8 * G]]],
      polys: [],
      text: { at: [0, 1.8 * G + T * 0.85], align: 'center' },
      box: { x0: Math.min(-G, -w / 2), y0: 0, x1: Math.max(G, w / 2), y1: 1.8 * G + T * 1.5 },
    };
  }
  if (labelLook(label) === 'flag') {
    const hh = T * 0.8, pad = T * 0.35;
    const x1 = hh + pad * 2 + w;
    const flag = [[0, 0], [hh, -hh], [x1, -hh], [x1, hh], [hh, hh], [0, 0]];
    return { lines: [], polys: [flag], text: { at: [hh + pad, 0], align: 'left' }, box: { x0: 0, y0: -hh, x1, y1: hh } };
  }
  // text on the wire: the name sitting just above its point, with a short tick under it
  return {
    lines: [[[0, 0], [Math.min(w, G * 0.6), 0]]],
    polys: [],
    text: { at: [mm(0.3) * T / LABEL_TEXT, -T * 0.55], align: 'left' },
    box: { x0: 0, y0: -T * 1.2, x1: w + mm(0.4) * T / LABEL_TEXT, y1: mm(0.2) },
  };
}

/**
 * Local → world offset for a label's shape. Net and Global labels keep their text readable: at
 * 180° and 270° they are drawn mirrored left-right at 0° / 90° instead of upside down, so the text
 * reads left-to-right or bottom-to-top and still sits above the Wire. Power symbols turn freely.
 */
export function labelFrame(label) {
  const rot = ((label.rot || 0) % 360 + 360) % 360;
  if (isPower(label) || rot < 180) return { rot, flip: false, apply: (p) => rot90(p, rot) };
  const r = rot - 180;
  return { rot: r, flip: true, apply: (p) => rot90([-p[0], p[1]], r) };
}

/** World-space bounding box of a label (with its sheet references, #76, when given). */
export function labelBounds(label, measure = estimateWidth, refs = null) {
  const { box } = labelShape(label, measure, refs);
  const f = labelFrame(label);
  const pts = [[box.x0, box.y0], [box.x1, box.y0], [box.x1, box.y1], [box.x0, box.y1]].map(f.apply);
  const xs = pts.map((p) => p[0] + label.at[0]), ys = pts.map((p) => p[1] + label.at[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/** The topmost label on `sheet` under world point `pt` (within `tol`), or null. `refsOf(label)`: its sheet references (#76). */
export function hitLabel(sheet, pt, tol = 0, measure = estimateWidth, refsOf = null) {
  for (let i = (sheet.labels || []).length - 1; i >= 0; i--) {
    const l = sheet.labels[i];
    const b = labelBounds(l, measure, refsOf ? refsOf(l) : null);
    if (pt[0] >= b.x0 - tol && pt[0] <= b.x1 + tol && pt[1] >= b.y0 - tol && pt[1] <= b.y1 + tol) return l;
  }
  return null;
}

// ---------------------------------------------------------------- sheet references (#76)

/** What a label shows: its net name, then the other sheets its net is on, e.g. "D_A8 [3,5]". */
export const labelText = (label, refs = null) => (refs?.length ? `${label.net || '?'} [${refs.join(',')}]` : label.net || '?');

/** Whether a label shows sheet references: its own choice, else the Schematic's (Global labels only). */
export const showsRefs = (project, label) => label.style === 'label' && label.scope === 'global' && (label.showRefs ?? !!project.schematic.showSheetRefs);

/**
 * Where each sheet number in a label's references is drawn: [{ sheet (1-based), box }] in world
 * coordinates, for clicking one to go to that sheet.
 */
export function labelRefBoxes(label, refs, measure = estimateWidth) {
  if (!refs?.length) return [];
  const T = labelSize(label), sh = labelShape(label, measure, refs), f = labelFrame(label);
  const full = labelText(label, refs), w = measure(full, T);
  const out = [];
  let from = `${label.net || '?'} [`;
  for (const n of refs) {
    const a = measure(from, T), b = measure(from + n, T);
    // in the label's frame; text reads from text.at (mirrored labels read from the far end)
    const x = (o) => (f.flip ? sh.text.at[0] + (w - o) : sh.text.at[0] + o);
    const y0 = sh.text.at[1] - T * 0.6, y1 = sh.text.at[1] + T * 0.6;
    const pts = [[x(a), y0], [x(b), y0], [x(b), y1], [x(a), y1]].map(f.apply).map(([px, py]) => [px + label.at[0], py + label.at[1]]);
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    out.push({ sheet: n, box: { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) } });
    from += `${n},`;
  }
  return out;
}

/** Why a label name can't be used, or null. */
export function validateLabelName(name) {
  const n = String(name ?? '').trim();
  if (!n) return "A label needs a name.";
  if (/\s/.test(n)) return 'Use no spaces in a net name (e.g. VIN or EN_3V3).';
  return null;
}

/**
 * The net names a label's name box offers: for a Power symbol the common power nets plus every
 * power net in the Project (so a new one, e.g. +3V3 typed once, is offered on every other Power
 * symbol); for Net and Global labels every label net in the Project. Sorted naturally, no repeats.
 */
export function netNameChoices(project, label) {
  const power = isPower(label);
  // one entry per Net name regardless of case, in the Project's spelling (ADR-0013)
  const names = new Map();
  for (const s of project.schematic.sheets) {
    for (const x of s.labels || []) if (x.style !== 'gnd' && isPower(x) === power && x.net) {
      const k = x.net.trim().toLowerCase();
      if (!names.has(k)) names.set(k, x.net.trim());
    }
  }
  if (power) for (const n of POWER_NAMES) if (!names.has(n.toLowerCase())) names.set(n.toLowerCase(), n);
  return [...names.values()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }) || a.localeCompare(b));
}

/**
 * The spelling to store for a typed net name: when a label elsewhere in the Project already uses
 * the same name apart from case, its spelling (the most used one); otherwise the name as typed,
 * trimmed. `exceptId` is the label being renamed, which doesn't count (ADR-0013).
 */
export function canonicalNetName(project, typed, exceptId = null) {
  const name = String(typed ?? '').trim();
  const k = name.toLowerCase();
  const counts = new Map();
  for (const s of project.schematic.sheets) {
    for (const x of s.labels || []) {
      const n = String(x.net || '').trim();
      if (x.id !== exceptId && n.toLowerCase() === k) counts.set(n, (counts.get(n) || 0) + 1);
    }
  }
  if (!counts.size || counts.has(name)) return name;
  return [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
}

/** The choices to show for what is typed: all of them until the text changes, then those containing it. */
export function filterNetNames(names, typed, original) {
  const t = String(typed ?? '').trim().toLowerCase();
  if (!t || t === String(original ?? '').trim().toLowerCase()) return names;
  return names.filter((n) => n.toLowerCase().includes(t));
}
