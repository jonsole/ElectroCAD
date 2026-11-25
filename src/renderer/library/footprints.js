// Footprint generators for the built-in starter Library (#12). No third-party library is
// bundled: every Footprint here is computed from a few dimensions, with pad sizes following
// IPC-7351 nominal land patterns as KiCad's generated libraries do. Names follow KiCad's, so
// exports and imports line up. All lengths integer nm (ADR-0003); +Y down; origin at the centre.
import { mm } from '../core/units.js';

const SMD = ['F.Cu', 'F.Paste', 'F.Mask'];
const THT = ['*.Cu', '*.Mask'];
const r = (v) => mm(v);

/** A courtyard rectangle around everything, with IPC's 0.25 mm excess, rounded to 0.01 mm. */
function courtyard(pads, extra = 0.25) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pads) {
    x0 = Math.min(x0, p.at[0] - p.size[0] / 2); x1 = Math.max(x1, p.at[0] + p.size[0] / 2);
    y0 = Math.min(y0, p.at[1] - p.size[1] / 2); y1 = Math.max(y1, p.at[1] + p.size[1] / 2);
  }
  const e = r(extra), q = (v) => Math.round(v / 10_000) * 10_000;
  return { type: 'rect', layer: 'F.CrtYd', a: [q(x0 - e), q(y0 - e)], b: [q(x1 + e), q(y1 + e)] };
}
const footprint = (name, pads) => ({ name, pads, graphics: [courtyard(pads)] });

// ---------------------------------------------------------------- two-terminal SMD chips

/** Chip sizes, smallest first. (An explicit list: '1206' looks like an integer, so object key order would put it first.) */
export const CHIP_ORDER = ['0402', '0603', '0805', '1206'];

/** IPC-7351 nominal (density B) lands for chip resistors/capacitors/inductors, as in KiCad. */
export const CHIP_SIZES = {
  '0402': { metric: '1005', pad: [0.54, 0.64], x: 0.51 },
  '0603': { metric: '1608', pad: [0.8, 0.95], x: 0.825 },
  '0805': { metric: '2012', pad: [1.025, 1.4], x: 0.9125 },
  '1206': { metric: '3216', pad: [1.125, 1.75], x: 1.4625 },
};

/** A chip Footprint, e.g. chip('R', '0603') -> R_0603_1608Metric. */
export function chip(prefix, size) {
  const s = CHIP_SIZES[size];
  const pad = (n, sign) => ({ number: n, at: [sign * r(s.x), 0], shape: 'roundrect', size: [r(s.pad[0]), r(s.pad[1])], layers: SMD });
  return footprint(`${prefix}_${size}_${s.metric}Metric`, [pad('1', -1), pad('2', 1)]);
}

// ---------------------------------------------------------------- two-terminal through-hole

const thtPad = (n, at, size, drill, square = false) => ({ number: n, at: at.map(r), shape: square ? 'rect' : 'circle', size: [r(size), r(size)], drill: r(drill), layers: THT });

/** Two through-hole pads `pitch` mm apart, pad 1 square (KiCad's convention for polarity). */
export function twoPinTht(name, pitch, { pad = 1.6, drill = 0.8 } = {}) {
  return footprint(name, [thtPad('1', [-pitch / 2, 0], pad, drill, true), thtPad('2', [pitch / 2, 0], pad, drill)]);
}
export const AXIAL_RESISTOR = () => twoPinTht('R_Axial_DIN0207_L6.3mm_D2.5mm_P10.16mm_Horizontal', 10.16);
export const AXIAL_INDUCTOR = () => twoPinTht('L_Axial_L6.6mm_D2.7mm_P10.16mm_Horizontal', 10.16);
export const AXIAL_DIODE = () => twoPinTht('D_DO-41_SOD81_P10.16mm_Horizontal', 10.16, { pad: 2.2, drill: 1.1 });
export const DISC_CAPACITOR = () => twoPinTht('C_Disc_D5.0mm_W2.5mm_P5.00mm', 5.0);
export const RADIAL_ELECTROLYTIC = () => twoPinTht('CP_Radial_D5.0mm_P2.00mm', 2.0);
export const LED_5MM = () => twoPinTht('LED_D5.0mm', 2.54, { pad: 1.8, drill: 0.9 });

// ---------------------------------------------------------------- pin headers

/**
 * A 2.54 mm pin header: 1xN (pins down one column) or 2xN (odd pins in the left column, even in
 * the right, as KiCad numbers them). Pad 1 is square.
 */
export function pinHeader(rows, n) {
  const pads = [];
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < rows; c++) {
      const num = rows === 1 ? i + 1 : i * 2 + c + 1;
      const x = rows === 1 ? 0 : (c - 0.5) * 2.54;
      pads.push({ number: String(num), at: [r(x), r((i - (n - 1) / 2) * 2.54)], shape: num === 1 ? 'rect' : 'oval', size: [r(1.7), r(1.7)], drill: r(1.0), layers: THT });
    }
  }
  return footprint(`PinHeader_${rows}x${String(n).padStart(2, '0')}_P2.54mm_Vertical`, pads);
}

// ---------------------------------------------------------------- IC packages

/** Dual-row package pads: 1…n/2 down the left, the rest up the right (pin 1 top left). */
function dualRow(n, pitch, x, padSize, extra = {}) {
  const half = n / 2;
  return Array.from({ length: n }, (_, i) => {
    const left = i < half;
    const row = left ? i : n - 1 - i;
    return { number: String(i + 1), at: [r(left ? -x : x), r((row - (half - 1) / 2) * pitch)], shape: 'roundrect', size: padSize.map(r), layers: SMD, ...extra };
  });
}

const SOIC_LENGTH = { 8: 4.9, 14: 8.7, 16: 9.9 };
/** SOIC-n, 3.9 mm body, 1.27 mm pitch. */
export function soic(n) {
  return footprint(`SOIC-${n}_3.9x${SOIC_LENGTH[n].toFixed(1)}mm_P1.27mm`, dualRow(n, 1.27, 2.475, [1.95, 0.6]));
}

/** DIP-n, 7.62 mm row spacing, 2.54 mm pitch, pad 1 square. */
export function dip(n) {
  const pads = dualRow(n, 2.54, 3.81, [1.6, 1.6]).map((p) => ({ ...p, shape: p.number === '1' ? 'rect' : 'circle', drill: r(0.8), layers: THT }));
  return footprint(`DIP-${n}_W7.62mm`, pads);
}

/** SOT-23 (3 pins: 1 and 2 on the left, 3 on the right). */
export function sot23() {
  const pad = (n, x, y) => ({ number: n, at: [r(x), r(y)], shape: 'roundrect', size: [r(1.475), r(0.6)], layers: SMD });
  return footprint('SOT-23', [pad('1', -1.1375, -0.95), pad('2', -1.1375, 0.95), pad('3', 1.1375, 0)]);
}

/** SOT-23-5 (1–3 down the left, 4–5 up the right). */
export function sot23_5() {
  const pad = (n, x, y) => ({ number: n, at: [r(x), r(y)], shape: 'roundrect', size: [r(1.325), r(0.6)], layers: SMD });
  return footprint('SOT-23-5', [pad('1', -1.1375, -0.95), pad('2', -1.1375, 0), pad('3', -1.1375, 0.95), pad('4', 1.1375, 0.95), pad('5', 1.1375, -0.95)]);
}

/** SOT-223 with the tab joined to pin 2 (regulators). */
export function sot223() {
  const pad = (n, x, y, w, h) => ({ number: n, at: [r(x), r(y)], shape: 'roundrect', size: [r(w), r(h)], layers: SMD });
  return footprint('SOT-223-3_TabPin2', [pad('1', -3.15, -2.3, 2, 1.5), pad('2', -3.15, 0, 2, 1.5), pad('3', -3.15, 2.3, 2, 1.5), pad('2', 3.15, 0, 2, 3.8)]);
}

/**
 * QFN-n with an exposed pad (numbered n+1): n/4 pads a side at `pitch`, numbered
 * counter-clockwise from pin 1 at the top of the left side.
 */
export function qfn(n, body, pitch) {
  const k = n / 4, d = body / 2 - 0.05, len = 0.8, w = Math.round(pitch * 0.55 * 100) / 100;
  const pads = [];
  for (let i = 0; i < n; i++) {
    const side = Math.floor(i / k), j = i % k, off = (j - (k - 1) / 2) * pitch;
    const [x, y, sw, sh] = [[-d, off, len, w], [off, d, w, len], [d, -off, len, w], [-off, -d, w, len]][side];
    pads.push({ number: String(i + 1), at: [r(x), r(y)], shape: 'roundrect', size: [r(sw), r(sh)], layers: SMD });
  }
  const ep = Math.round(body * 0.55 * 100) / 100;
  pads.push({ number: String(n + 1), at: [0, 0], shape: 'rect', size: [r(ep), r(ep)], layers: SMD });
  return footprint(`QFN-${n}-1EP_${body}x${body}mm_P${pitch}mm_EP${ep}x${ep}mm`, pads);
}

// ---------------------------------------------------------------- board-only parts (#74)

/** A round courtyard `extra` mm outside radius `rad` (nm). */
const roundYard = (rad, extra = 0.25) => ({ type: 'circle', layer: 'F.CrtYd', c: [0, 0], r: rad + r(extra) });

/**
 * A mounting hole for screw `m` (M2, M2.5, M3, M4), KiCad's names: plain (non-plated, no copper)
 * or `_Pad` (plated, with a copper ring for a ground connection), e.g. MountingHole_3.2mm_M3_Pad.
 */
export function mountingHole(m, plated = false) {
  const { d, ring } = { M2: { d: 2.2, ring: 4 }, 'M2.5': { d: 2.7, ring: 5 }, M3: { d: 3.2, ring: 6 }, M4: { d: 4.3, ring: 8 } }[m];
  const pad = plated
    ? { number: '1', at: [0, 0], shape: 'circle', size: [r(ring), r(ring)], drill: r(d), layers: THT }
    : { number: '', at: [0, 0], shape: 'circle', size: [r(d), r(d)], drill: r(d), layers: ['*.Mask'] };
  return { name: `MountingHole_${d}mm_${m}${plated ? '_Pad' : ''}`, pads: [pad], graphics: [roundYard(r(plated ? ring : d) / 2)] };
}

/** A fiducial: a round copper dot `dot` mm across, its mask opening grown by the board's mask margin. */
export function fiducial(dot = 1) {
  return { name: `Fiducial_${dot}mm`, pads: [{ number: '1', at: [0, 0], shape: 'circle', size: [r(dot), r(dot)], layers: ['F.Cu', 'F.Mask'] }], graphics: [roundYard(r(dot) / 2 + r(0.5))] };
}

/** Every generated Footprint, for "Other…" (any Footprint, identity Pin map). */
export function allFootprints() {
  const out = [];
  for (const p of ['R', 'C', 'L', 'LED', 'D']) for (const s of CHIP_ORDER) out.push(chip(p, s));
  out.push(AXIAL_RESISTOR(), AXIAL_INDUCTOR(), AXIAL_DIODE(), DISC_CAPACITOR(), RADIAL_ELECTROLYTIC(), LED_5MM());
  for (let n = 1; n <= 10; n++) out.push(pinHeader(1, n));
  for (let n = 2; n <= 20; n++) out.push(pinHeader(2, n));
  for (const n of [8, 14, 16]) out.push(soic(n), dip(n));
  out.push(sot23(), sot23_5(), sot223());
  for (const [n, b, p] of [[16, 3, 0.5], [20, 4, 0.5], [24, 4, 0.5], [32, 5, 0.5]]) out.push(qfn(n, b, p));
  for (const m of ['M2', 'M2.5', 'M3', 'M4']) out.push(mountingHole(m), mountingHole(m, true));
  out.push(fiducial(1), fiducial(1.5));
  return out;
}
