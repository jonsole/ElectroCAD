// Footprint generators (#19): standard packages from a few parameters, for the Footprint
// editor's Generator… dialog. Each makes a complete Footprint: pads, a fab-layer body, a silk
// outline that keeps clear of the pads, a courtyard (IPC 0.25 mm excess) and Reference / Value
// text (${REF} on silk, ${VALUE} on fab). Dimensions are mm in the parameters, nm in the result.
import { mm } from '../core/units.js';
import { CHIP_SIZES, CHIP_ORDER } from './footprints.js';

const SMD = ['F.Cu', 'F.Paste', 'F.Mask'];
const THT = ['*.Cu', '*.Mask'];
const r = (v) => mm(v);
const q = (v) => Math.round(v / 10_000) * 10_000; // 0.01 mm
const fix = (v) => +(+v).toFixed(2);

/** Courtyard, fab body, silk lines and text around `pads` and a body of bw x bh (mm, centred). */
function dress(pads, bw, bh, { silk = 'sides', pin1 = null } = {}) {
  let x0 = -r(bw) / 2, y0 = -r(bh) / 2, x1 = r(bw) / 2, y1 = r(bh) / 2;
  const box = { x0, y0, x1, y1 };
  for (const p of pads) {
    box.x0 = Math.min(box.x0, p.at[0] - p.size[0] / 2); box.x1 = Math.max(box.x1, p.at[0] + p.size[0] / 2);
    box.y0 = Math.min(box.y0, p.at[1] - p.size[1] / 2); box.y1 = Math.max(box.y1, p.at[1] + p.size[1] / 2);
  }
  const e = r(0.25);
  const g = [
    { type: 'rect', layer: 'F.CrtYd', a: [q(box.x0 - e), q(box.y0 - e)], b: [q(box.x1 + e), q(box.y1 + e)] },
    { type: 'rect', layer: 'F.Fab', a: [x0, y0], b: [x1, y1] },
  ];
  const sw = r(0.12), clear = r(0.2);
  if (silk === 'sides') {
    // lines along the top and bottom of the body, stopping short of any pad
    for (const y of [y0 - sw, y1 + sw]) {
      const inPad = pads.some((p) => Math.abs(p.at[1] - y) < p.size[1] / 2 + clear && Math.abs(p.at[0]) - p.size[0] / 2 < x1);
      if (!inPad) g.push({ type: 'line', layer: 'F.SilkS', pts: [[x0, y], [x1, y]] });
    }
  } else if (silk === 'between') {
    // chips: short lines between the pads, above and below
    const inner = Math.min(...pads.map((p) => Math.abs(p.at[0]) - p.size[0] / 2)) - clear;
    if (inner > r(0.1)) for (const y of [y0 - sw, y1 + sw]) g.push({ type: 'line', layer: 'F.SilkS', pts: [[-inner, y], [inner, y]] });
  } else if (silk === 'box') {
    const m = r(0.3);
    g.push({ type: 'rect', layer: 'F.SilkS', a: [q(box.x0 - m + e), q(box.y0 - m + e)], b: [q(box.x1 + m - e), q(box.y1 + m - e)] });
  }
  if (pin1) g.push({ type: 'circle', layer: 'F.SilkS', c: pin1, r: r(0.15), fill: 'outline' });
  const size = r(1);
  g.push({ type: 'text', layer: 'F.SilkS', at: [0, q(box.y0 - e - r(0.9))], text: '${REF}', size });
  g.push({ type: 'text', layer: 'F.Fab', at: [0, q(box.y1 + e + r(0.9))], text: '${VALUE}', size: r(0.8) });
  return g;
}

/**
 * The generators. Each has an id, a label, its parameters ({ key, label, kind: 'number' | 'int' |
 * 'select', unit, min, max, step, options, def }), optional `presets(params)` (values a select
 * fills in), and `make(params)` -> Footprint.
 */
export const GENERATORS = [
  {
    id: 'chip', label: 'Chip (R, C, L, LED)',
    params: [
      { key: 'prefix', label: 'Kind', kind: 'select', options: [['R', 'Resistor'], ['C', 'Capacitor'], ['L', 'Inductor'], ['LED', 'LED'], ['D', 'Diode']], def: 'R' },
      { key: 'size', label: 'Size', kind: 'select', options: CHIP_ORDER.map((s) => [s, `${s} (${CHIP_SIZES[s].metric} metric)`]), def: '0603' },
      { key: 'padW', label: 'Pad width', kind: 'number', unit: 'mm', min: 0.1, max: 5, step: 0.01 },
      { key: 'padH', label: 'Pad height', kind: 'number', unit: 'mm', min: 0.1, max: 5, step: 0.01 },
      { key: 'pitch', label: 'Pad centres', kind: 'number', unit: 'mm', min: 0.2, max: 10, step: 0.01 },
    ],
    presets: (p) => { const s = CHIP_SIZES[p.size]; return { padW: s.pad[0], padH: s.pad[1], pitch: +(s.x * 2).toFixed(4) }; },
    make(p) {
      const pads = ['1', '2'].map((n, i) => ({ number: n, at: [r((i ? 1 : -1) * p.pitch / 2), 0], shape: 'roundrect', size: [r(p.padW), r(p.padH)], layers: SMD }));
      const bl = +p.size.slice(0, 2) / 10 * 2.54, bw = +p.size.slice(2) / 10 * 2.54; // imperial size code: length, width (in 1/100 in)
      return { name: `${p.prefix}_${p.size}_${CHIP_SIZES[p.size].metric}Metric`, pads, graphics: dress(pads, fix(bl), fix(bw), { silk: 'between' }) };
    },
  },
  {
    id: 'soic', label: 'SOIC / SOP (gull-wing, two rows)',
    params: [
      { key: 'n', label: 'Pins', kind: 'int', min: 4, max: 64, step: 2, def: 8 },
      { key: 'pitch', label: 'Pitch', kind: 'number', unit: 'mm', min: 0.3, max: 2.54, step: 0.01, def: 1.27 },
      { key: 'span', label: 'Pad row centres', kind: 'number', unit: 'mm', min: 1, max: 20, step: 0.01, def: 4.95 },
      { key: 'padW', label: 'Pad length', kind: 'number', unit: 'mm', min: 0.2, max: 5, step: 0.01, def: 1.95 },
      { key: 'padH', label: 'Pad width', kind: 'number', unit: 'mm', min: 0.1, max: 3, step: 0.01, def: 0.6 },
      { key: 'bodyW', label: 'Body width', kind: 'number', unit: 'mm', min: 1, max: 20, step: 0.01, def: 3.9 },
    ],
    make(p) {
      const n = Math.max(4, Math.round(p.n / 2) * 2), half = n / 2;
      const pads = Array.from({ length: n }, (_, i) => {
        const left = i < half, row = left ? i : n - 1 - i;
        return { number: String(i + 1), at: [r((left ? -1 : 1) * p.span / 2), r((row - (half - 1) / 2) * p.pitch)], shape: 'roundrect', size: [r(p.padW), r(p.padH)], layers: SMD };
      });
      const bodyL = fix(half * p.pitch + 0.1 * p.pitch * 4);
      return { name: `SOIC-${n}_${fix(p.bodyW)}x${bodyL}mm_P${fix(p.pitch)}mm`, pads, graphics: dress(pads, p.bodyW, bodyL, { silk: 'sides', pin1: [r(-p.span / 2 - p.padW / 2 - 0.4), r(-(half - 1) / 2 * p.pitch)] }) };
    },
  },
  {
    id: 'header', label: 'Pin header (through-hole)',
    params: [
      { key: 'rows', label: 'Rows', kind: 'select', options: [['1', '1 row'], ['2', '2 rows']], def: '1' },
      { key: 'n', label: 'Pins per row', kind: 'int', min: 1, max: 40, step: 1, def: 4 },
      { key: 'pitch', label: 'Pitch', kind: 'number', unit: 'mm', min: 1, max: 5.08, step: 0.01, def: 2.54 },
      { key: 'pad', label: 'Pad size', kind: 'number', unit: 'mm', min: 0.5, max: 4, step: 0.01, def: 1.7 },
      { key: 'drill', label: 'Drill', kind: 'number', unit: 'mm', min: 0.3, max: 3, step: 0.01, def: 1.0 },
    ],
    make(p) {
      const rows = +p.rows, pads = [];
      for (let i = 0; i < p.n; i++) for (let c = 0; c < rows; c++) {
        const num = rows === 1 ? i + 1 : i * 2 + c + 1;
        pads.push({ number: String(num), at: [r(rows === 1 ? 0 : (c - 0.5) * p.pitch), r((i - (p.n - 1) / 2) * p.pitch)], shape: num === 1 ? 'rect' : 'oval', size: [r(p.pad), r(p.pad)], drill: r(p.drill), layers: THT });
      }
      return { name: `PinHeader_${rows}x${String(p.n).padStart(2, '0')}_P${fix(p.pitch)}mm_Vertical`, pads, graphics: dress(pads, fix(rows * p.pitch), fix(p.n * p.pitch), { silk: 'box' }) };
    },
  },
  {
    id: 'dip', label: 'DIP (through-hole, two rows)',
    params: [
      { key: 'n', label: 'Pins', kind: 'int', min: 4, max: 64, step: 2, def: 8 },
      { key: 'pitch', label: 'Pitch', kind: 'number', unit: 'mm', min: 1.27, max: 5.08, step: 0.01, def: 2.54 },
      { key: 'span', label: 'Row spacing', kind: 'number', unit: 'mm', min: 5, max: 25, step: 0.01, def: 7.62 },
      { key: 'pad', label: 'Pad size', kind: 'number', unit: 'mm', min: 0.8, max: 3, step: 0.01, def: 1.6 },
      { key: 'drill', label: 'Drill', kind: 'number', unit: 'mm', min: 0.4, max: 2, step: 0.01, def: 0.8 },
    ],
    make(p) {
      const n = Math.max(4, Math.round(p.n / 2) * 2), half = n / 2;
      const pads = Array.from({ length: n }, (_, i) => {
        const left = i < half, row = left ? i : n - 1 - i;
        return { number: String(i + 1), at: [r((left ? -1 : 1) * p.span / 2), r((row - (half - 1) / 2) * p.pitch)], shape: i === 0 ? 'rect' : 'circle', size: [r(p.pad), r(p.pad)], drill: r(p.drill), layers: THT };
      });
      const bodyW = fix(p.span - p.pad - 0.6), bodyL = fix(half * p.pitch + 0.5);
      return { name: `DIP-${n}_W${fix(p.span)}mm`, pads, graphics: dress(pads, bodyW, bodyL, { silk: 'sides', pin1: [r(-p.span / 2 + p.pad / 2 + 0.6), r(-(half - 1) / 2 * p.pitch - p.pitch / 2)] }) };
    },
  },
];

/** A generator's starting values: defaults, then what its select presets fill in. */
export function generatorDefaults(gen) {
  const p = Object.fromEntries(gen.params.map((x) => [x.key, x.def]));
  return { ...p, ...(gen.presets ? gen.presets(p) : {}) };
}

export const generatorById = (id) => GENERATORS.find((g) => g.id === id);
