// The small built-in Library for ticket #4: Resistor, Capacitor, LED. The full generated
// starter Library arrives with #12. Symbols follow KiCad's conventions so the Pins land on
// the 50 mil grid: coordinates are integer nm in the Symbol's local frame (+Y down).
import { mm } from '../core/units.js';

const G = mm(1.27); // one schematic grid step

// Symbol graphics primitives (local coordinates):
//   { type: 'rect', a: [x, y], b: [x, y], fill: 'none' | 'background' | 'outline' }
//   { type: 'line', pts: [[x, y], ...] }   { type: 'poly', pts: [...], fill }   { type: 'circle', c, r, fill }
// Pins: `at` is the connection tip; `dir` points from the tip into the body ('L','R','U','D').
// Fields aren't positioned here: Field styles place them (ADR-0012).

const chip0805 = (name) => ({
  name,
  pads: [
    { number: '1', at: [-mm(0.9125), 0], shape: 'roundrect', size: [mm(1.025), mm(1.4)], layers: ['F.Cu', 'F.Paste', 'F.Mask'] },
    { number: '2', at: [mm(0.9125), 0], shape: 'roundrect', size: [mm(1.025), mm(1.4)], layers: ['F.Cu', 'F.Paste', 'F.Mask'] },
  ],
  graphics: [{ type: 'rect', layer: 'F.CrtYd', a: [-mm(1.68), -mm(0.95)], b: [mm(1.68), mm(0.95)] }],
});

const twoPin = (len) => [
  { number: '1', name: '~', at: [-len, 0], dir: 'R', length: 0, type: 'passive' },
  { number: '2', name: '~', at: [len, 0], dir: 'L', length: 0, type: 'passive' },
];

export const RESISTOR = {
  id: 'mini-resistor', name: 'Resistor', prefix: 'R', defaultValue: '10k', keywords: 'resistor res r passive',
  origin: { library: 'builtin-mini', partId: 'resistor', version: 1 },
  units: [{
    name: 'A', hidePinNumbers: true, hidePinNames: true,
    graphics: [{ type: 'rect', a: [-2 * G, -0.8 * G], b: [2 * G, 0.8 * G], fill: 'background' }],
    pins: twoPin(4 * G).map((p) => ({ ...p, length: 2 * G })),
  }],
  footprints: { R_0805: chip0805('R_0805_2012Metric') },
  pinMap: { R_0805: { 1: '1', 2: '2' } },
};

export const CAPACITOR = {
  id: 'mini-capacitor', name: 'Capacitor', prefix: 'C', defaultValue: '100n', keywords: 'capacitor cap c passive',
  origin: { library: 'builtin-mini', partId: 'capacitor', version: 1 },
  units: [{
    name: 'A', hidePinNumbers: true, hidePinNames: true,
    graphics: [
      { type: 'line', pts: [[-0.4 * G, -1.6 * G], [-0.4 * G, 1.6 * G]], width: 2 },
      { type: 'line', pts: [[0.4 * G, -1.6 * G], [0.4 * G, 1.6 * G]], width: 2 },
    ],
    pins: twoPin(3 * G).map((p) => ({ ...p, length: 2.6 * G })),
  }],
  footprints: { C_0805: chip0805('C_0805_2012Metric') },
  pinMap: { C_0805: { 1: '1', 2: '2' } },
};

// LED: anode (pin 2) on the left, cathode (pin 1) on the right, as in KiCad's Device:LED.
export const LED = {
  id: 'mini-led', name: 'LED', prefix: 'D', defaultValue: 'LED', keywords: 'led diode light',
  origin: { library: 'builtin-mini', partId: 'led', version: 1 },
  units: [{
    name: 'A', hidePinNumbers: true, hidePinNames: true,
    graphics: [
      { type: 'poly', pts: [[-G, -G], [G, 0], [-G, G], [-G, -G]], fill: 'background' },
      { type: 'line', pts: [[G, -G], [G, G]], width: 1.5 },
      { type: 'line', pts: [[-0.2 * G, -1.4 * G], [0.6 * G, -2.2 * G]] },
      { type: 'line', pts: [[0.2 * G, -2.2 * G], [0.6 * G, -2.2 * G], [0.6 * G, -1.8 * G]] },
      { type: 'line', pts: [[0.5 * G, -1.4 * G], [1.3 * G, -2.2 * G]] },
      { type: 'line', pts: [[0.9 * G, -2.2 * G], [1.3 * G, -2.2 * G], [1.3 * G, -1.8 * G]] },
    ],
    pins: [
      { number: '2', name: 'A', at: [-3 * G, 0], dir: 'R', length: 2 * G, type: 'passive' },
      { number: '1', name: 'K', at: [3 * G, 0], dir: 'L', length: 2 * G, type: 'passive' },
    ],
  }],
  footprints: { LED_0805: chip0805('LED_0805_2012Metric') },
  pinMap: { LED_0805: { 1: '1', 2: '2' } },
};

export const MINI_LIBRARY = [RESISTOR, CAPACITOR, LED];

/** Parts whose name or keywords contain every word of the query. */
export function searchParts(parts, query) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return parts;
  return parts.filter((p) => { const hay = `${p.name} ${p.keywords || ''} ${p.prefix}`.toLowerCase(); return words.every((w) => hay.includes(w)); });
}
