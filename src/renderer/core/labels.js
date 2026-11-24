// Net labels, Global labels and Power symbols (#7): their shapes in the label's local frame,
// used for drawing, hit testing and keeping fields clear of them. DOM-free; text width comes
// from a `measure(text, sizeNm)` function.
//
// A label is { id, at, rot, net, scope: 'local' | 'global', style: 'label' | 'power' | 'gnd' }.
// `at` is its connection point. Power symbols (+5V, GND) are always global.
import { mm, SCH_GRID as G } from './units.js';
import { rot90 } from './geom.js';
import { estimateWidth } from './fields.js';

export const LABEL_TEXT = mm(1.27);

/** Common Power symbol names offered when placing one. */
export const POWER_NAMES = ['+3V3', '+5V', '+12V', 'VCC', 'VDD', 'VBAT', '+1V8', '-12V'];

export const isPower = (l) => l.style === 'power' || l.style === 'gnd';
export const labelKind = (l) => (isPower(l) ? 'power' : l.scope === 'global' ? 'global' : 'local');

/**
 * The shape of a label in its local frame (rotation 0: a label reads to the right of its point,
 * a power arrow points up, a ground points down). Returns { lines: [[pts]], polys: [[pts]],
 * text: { at, align, base } , box } where coordinates are nm relative to `at`.
 */
export function labelShape(label, measure = estimateWidth) {
  const T = LABEL_TEXT;
  const w = measure(label.net || '?', T);
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
  if (label.scope === 'global') {
    const hh = T * 0.8, pad = T * 0.35;
    const x1 = hh + pad * 2 + w;
    const flag = [[0, 0], [hh, -hh], [x1, -hh], [x1, hh], [hh, hh], [0, 0]];
    return { lines: [], polys: [flag], text: { at: [hh + pad, 0], align: 'left' }, box: { x0: 0, y0: -hh, x1, y1: hh } };
  }
  // a local Net label: text sitting just above its point, with a short tick under it
  return {
    lines: [[[0, 0], [Math.min(w, G * 0.6), 0]]],
    polys: [],
    text: { at: [mm(0.3), -T * 0.55], align: 'left' },
    box: { x0: 0, y0: -T * 1.2, x1: w + mm(0.4), y1: mm(0.2) },
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

/** World-space bounding box of a label. */
export function labelBounds(label, measure = estimateWidth) {
  const { box } = labelShape(label, measure);
  const f = labelFrame(label);
  const pts = [[box.x0, box.y0], [box.x1, box.y0], [box.x1, box.y1], [box.x0, box.y1]].map(f.apply);
  const xs = pts.map((p) => p[0] + label.at[0]), ys = pts.map((p) => p[1] + label.at[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/** The topmost label on `sheet` under world point `pt` (within `tol`), or null. */
export function hitLabel(sheet, pt, tol = 0, measure = estimateWidth) {
  for (let i = (sheet.labels || []).length - 1; i >= 0; i--) {
    const l = sheet.labels[i];
    const b = labelBounds(l, measure);
    if (pt[0] >= b.x0 - tol && pt[0] <= b.x1 + tol && pt[1] >= b.y0 - tol && pt[1] <= b.y1 + tol) return l;
  }
  return null;
}

/** Why a label name can't be used, or null. */
export function validateLabelName(name) {
  const n = String(name ?? '').trim();
  if (!n) return "A label needs a name.";
  if (/\s/.test(n)) return 'Use no spaces in a net name (e.g. VIN or EN_3V3).';
  return null;
}
