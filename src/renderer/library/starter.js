// The built-in starter Library (#12): generated, not hand-drawn, and no third-party library is
// bundled. Symbols follow KiCad's conventions so Pins land on the 50 mil grid (local frame, nm,
// +Y down); Footprints come from ./footprints.js. `category` and `manufacturer` are Library-only
// (the picker's category select and grouping); they aren't copied into Projects. Generic parts
// (passives, connectors, discretes made by everyone) have no manufacturer.
//
// For chip parts the 0805 Footprint is the first Preferred footprint (the default for a new
// Component); the picker shows the choices in size order.
import { mm } from '../core/units.js';
import { CHIP_ORDER, chip, AXIAL_RESISTOR, AXIAL_INDUCTOR, AXIAL_DIODE, DISC_CAPACITOR, RADIAL_ELECTROLYTIC, LED_5MM, pinHeader, soic, dip, sot23, sot223 } from './footprints.js';

const G = mm(1.27); // one schematic grid step
const LIB = 'builtin';
const origin = (partId) => ({ library: LIB, partId, version: 1 });
const round = (p) => p.map((v) => Math.round(v));

// ---------------------------------------------------------------- symbol pieces

const twoPin = (len, pinLen, names = ['~', '~']) => [
  { number: '1', name: names[0], at: [-len, 0], dir: 'R', length: pinLen, type: 'passive' },
  { number: '2', name: names[1], at: [len, 0], dir: 'L', length: pinLen, type: 'passive' },
];

/** A polyline approximating a circular arc (Symbols are drawn from lines). */
function arcPts(cx, cy, rad, from, to, steps = 12) {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const a = from + ((to - from) * i) / steps;
    return round([cx + rad * Math.cos(a), cy + rad * Math.sin(a)]);
  });
}

/** Preferred footprints for a chip part: 0805 first (the default), then the other sizes and a THT one. */
function chipFootprints(prefix, tht) {
  const fps = { [`${prefix}_0805`]: chip(prefix, '0805') };
  for (const s of CHIP_ORDER) if (s !== '0805') fps[`${prefix}_${s}`] = chip(prefix, s);
  fps[`${prefix}_THT`] = tht;
  return fps;
}

// ---------------------------------------------------------------- Passives

export const RESISTOR = {
  id: 'resistor', name: 'Resistor', prefix: 'R', defaultValue: '10k', category: 'Passives', keywords: 'resistor res r passive',
  origin: origin('resistor'),
  units: [{
    name: 'A', hidePinNumbers: true, hidePinNames: true,
    graphics: [{ type: 'rect', a: [-2 * G, -0.8 * G], b: [2 * G, 0.8 * G], fill: 'background' }],
    pins: twoPin(4 * G, 2 * G),
  }],
  footprints: chipFootprints('R', AXIAL_RESISTOR()),
  pinMap: {},
};

export const CAPACITOR = {
  id: 'capacitor', name: 'Capacitor', prefix: 'C', defaultValue: '100n', category: 'Passives', keywords: 'capacitor cap c passive ceramic',
  origin: origin('capacitor'),
  units: [{
    name: 'A', hidePinNumbers: true, hidePinNames: true,
    graphics: [
      { type: 'line', pts: [[-0.4 * G, -1.6 * G], [-0.4 * G, 1.6 * G]], width: 2 },
      { type: 'line', pts: [[0.4 * G, -1.6 * G], [0.4 * G, 1.6 * G]], width: 2 },
    ],
    pins: twoPin(3 * G, 2.6 * G),
  }],
  footprints: chipFootprints('C', DISC_CAPACITOR()),
  pinMap: {},
};

export const CAPACITOR_POLARISED = {
  id: 'capacitor-polarised', name: 'Capacitor (polarised)', prefix: 'C', defaultValue: '10u', category: 'Passives', keywords: 'capacitor cap c polarised polarized electrolytic tantalum',
  origin: origin('capacitor-polarised'),
  units: [{
    name: 'A', hidePinNumbers: true, hidePinNames: true,
    graphics: [
      { type: 'line', pts: [[-0.4 * G, -1.6 * G], [-0.4 * G, 1.6 * G]], width: 2 },
      { type: 'line', pts: arcPts(2.4 * G, 0, 2.2 * G, Math.PI - 0.8, Math.PI + 0.8), width: 2 },
      { type: 'line', pts: [[-1.6 * G, -1.4 * G], [-1.0 * G, -1.4 * G]] },
      { type: 'line', pts: [[-1.3 * G, -1.7 * G], [-1.3 * G, -1.1 * G]] },
    ].map((g) => ({ ...g, pts: g.pts.map(round) })),
    pins: twoPin(3 * G, 2.6 * G, ['+', '-']),
  }],
  footprints: { CP_THT: RADIAL_ELECTROLYTIC(), C_1206: chip('C', '1206') },
  pinMap: {},
};

export const INDUCTOR = {
  id: 'inductor', name: 'Inductor', prefix: 'L', defaultValue: '10u', category: 'Passives', keywords: 'inductor coil choke l passive',
  origin: origin('inductor'),
  units: [{
    name: 'A', hidePinNumbers: true, hidePinNames: true,
    // four bumps from -2G to 2G
    graphics: [{ type: 'line', pts: [0, 1, 2, 3].flatMap((i) => arcPts(-1.5 * G + i * G, 0, 0.5 * G, Math.PI, 2 * Math.PI, 8).slice(i ? 1 : 0)) }],
    pins: twoPin(4 * G, 2 * G),
  }],
  footprints: chipFootprints('L', AXIAL_INDUCTOR()),
  pinMap: {},
};

// ---------------------------------------------------------------- Semiconductors

const diodeBody = [
  { type: 'poly', pts: [[-G, -G], [G, 0], [-G, G], [-G, -G]], fill: 'background' },
  { type: 'line', pts: [[G, -G], [G, G]], width: 1.5 },
];
// anode (pin 2) on the left, cathode (pin 1) on the right, as in KiCad's Device:D and Device:LED
const diodePins = [
  { number: '2', name: 'A', at: [-3 * G, 0], dir: 'R', length: 2 * G, type: 'passive' },
  { number: '1', name: 'K', at: [3 * G, 0], dir: 'L', length: 2 * G, type: 'passive' },
];

export const LED = {
  id: 'led', name: 'LED', prefix: 'D', defaultValue: 'LED', category: 'Semiconductors', keywords: 'led diode light',
  origin: origin('led'),
  units: [{
    name: 'A', hidePinNumbers: true, hidePinNames: true,
    graphics: [
      ...diodeBody,
      { type: 'line', pts: [[-0.2 * G, -1.4 * G], [0.6 * G, -2.2 * G]] },
      { type: 'line', pts: [[0.2 * G, -2.2 * G], [0.6 * G, -2.2 * G], [0.6 * G, -1.8 * G]] },
      { type: 'line', pts: [[0.5 * G, -1.4 * G], [1.3 * G, -2.2 * G]] },
      { type: 'line', pts: [[0.9 * G, -2.2 * G], [1.3 * G, -2.2 * G], [1.3 * G, -1.8 * G]] },
    ],
    pins: diodePins,
  }],
  footprints: chipFootprints('LED', LED_5MM()),
  pinMap: {},
};

export const DIODE = {
  id: 'diode', name: 'Diode', prefix: 'D', defaultValue: '1N4148', category: 'Semiconductors', keywords: 'diode rectifier d 1n4148 1n4007',
  origin: origin('diode'),
  units: [{ name: 'A', hidePinNumbers: true, hidePinNames: true, graphics: diodeBody, pins: diodePins }],
  footprints: chipFootprints('D', AXIAL_DIODE()),
  pinMap: {},
};

/** A three-terminal transistor in a circle: control on the left, the other two top and bottom. */
function transistor({ id, name, value, manufacturer, keywords, left, top, bottom, arrow }) {
  const lines = [
    { type: 'circle', c: [Math.round(0.6 * G), 0], r: Math.round(2.7 * G), fill: 'none' },
    { type: 'line', pts: [[-G, -1.5 * G], [-G, 1.5 * G]].map(round), width: 2 },
    { type: 'line', pts: [[-G, -0.5 * G], [2 * G, -2 * G]].map(round) },
    { type: 'line', pts: [[-G, 0.5 * G], [2 * G, 2 * G]].map(round) },
    { type: 'poly', pts: arrow.map(round), fill: 'outline' },
  ];
  return {
    id, name, prefix: 'Q', defaultValue: value, category: 'Semiconductors', manufacturer, keywords,
    origin: origin(id),
    units: [{
      name: 'A', hidePinNumbers: true, hidePinNames: true, graphics: lines,
      pins: [
        { ...left, at: [-4 * G, 0], dir: 'R', length: 3 * G },
        { ...top, at: [2 * G, -4 * G], dir: 'D', length: 2 * G },
        { ...bottom, at: [2 * G, 4 * G], dir: 'U', length: 2 * G },
      ],
    }],
    footprints: { SOT23: sot23() },
    pinMap: {},
  };
}

// BC847 / BC857 / 2N7002 in SOT-23: pad 1 = B (G), 2 = E (S), 3 = C (D)
export const NPN = transistor({ id: 'npn', name: 'NPN transistor', value: 'BC847', manufacturer: 'Nexperia', keywords: 'npn transistor bjt bc847 q',
  left: { number: '1', name: 'B', type: 'input' }, top: { number: '3', name: 'C', type: 'passive' }, bottom: { number: '2', name: 'E', type: 'passive' },
  arrow: [[2 * G, 2 * G], [1.1 * G, 1.9 * G], [1.6 * G, 1.3 * G], [2 * G, 2 * G]] });
export const PNP = transistor({ id: 'pnp', name: 'PNP transistor', value: 'BC857', manufacturer: 'Nexperia', keywords: 'pnp transistor bjt bc857 q',
  left: { number: '1', name: 'B', type: 'input' }, top: { number: '2', name: 'E', type: 'passive' }, bottom: { number: '3', name: 'C', type: 'passive' },
  arrow: [[-0.6 * G, -0.7 * G], [0.4 * G, -0.9 * G], [0, -1.5 * G], [-0.6 * G, -0.7 * G]] });
export const NMOS = transistor({ id: 'nmos', name: 'N-MOSFET', value: '2N7002', manufacturer: 'Nexperia', keywords: 'mosfet nmos n-channel fet transistor 2n7002 q',
  left: { number: '1', name: 'G', type: 'input' }, top: { number: '3', name: 'D', type: 'passive' }, bottom: { number: '2', name: 'S', type: 'passive' },
  arrow: [[-0.4 * G, 0.6 * G], [0.4 * G, 0.95 * G], [0.2 * G, 0.25 * G], [-0.4 * G, 0.6 * G]] });

// ---------------------------------------------------------------- Connectors

/** Conn_01xN / Conn_02xN pin headers, as KiCad's Connector_Generic, with 2.54 mm headers. */
function connector(rows, n) {
  const id = `conn-${rows}x${n}`;
  const nn = String(n).padStart(2, '0');
  const name = `Conn_0${rows}x${nn}`;
  const y = (i) => (2 * i - (n - 1)) * G;
  const pins = [];
  for (let i = 0; i < n; i++) {
    if (rows === 1) pins.push({ number: String(i + 1), name: `Pin_${i + 1}`, at: [-4 * G, y(i)], dir: 'R', length: 2 * G, type: 'passive' });
    else {
      pins.push({ number: String(2 * i + 1), name: `Pin_${2 * i + 1}`, at: [-4 * G, y(i)], dir: 'R', length: 2 * G, type: 'passive' });
      pins.push({ number: String(2 * i + 2), name: `Pin_${2 * i + 2}`, at: [4 * G, y(i)], dir: 'L', length: 2 * G, type: 'passive' });
    }
  }
  const top = y(0) - G, bot = y(n - 1) + G;
  return {
    id, name, prefix: 'J', defaultValue: name, category: 'Connectors',
    keywords: `connector header pin conn ${rows}x${n} ${rows === 1 ? 'single row' : 'dual row'}`,
    origin: origin(id),
    units: [{ name: 'A', hidePinNumbers: false, hidePinNames: true, graphics: [{ type: 'rect', a: [-2 * G, top], b: [rows === 1 ? G : 2 * G, bot], fill: 'background' }], pins }],
    footprints: { [`PinHeader_${rows}x${nn}`]: pinHeader(rows, n) },
    pinMap: {},
  };
}
export const CONNECTORS = [
  ...Array.from({ length: 10 }, (_, i) => connector(1, i + 1)),
  ...Array.from({ length: 9 }, (_, i) => connector(2, i + 2)),
];

// ---------------------------------------------------------------- ICs

/** One amplifier of an op-amp: a triangle with − above + on the left and the output on the right. */
const opAmpUnit = (name, minus, plus, out) => ({
  name, hidePinNumbers: false, hidePinNames: false,
  graphics: [{ type: 'poly', pts: [[-3 * G, -3 * G], [3 * G, 0], [-3 * G, 3 * G], [-3 * G, -3 * G]], fill: 'background' }],
  pins: [
    { number: minus, name: '-', at: [-5 * G, -G], dir: 'R', length: 2 * G, type: 'input' },
    { number: plus, name: '+', at: [-5 * G, G], dir: 'R', length: 2 * G, type: 'input' },
    { number: out, name: '~', at: [5 * G, 0], dir: 'L', length: 2 * G, type: 'output' },
  ],
});
/** A power Unit: V+ on top, V− (or GND) at the bottom. */
const powerUnit = (name, top, bottom, [topName, bottomName] = ['V+', 'V-']) => ({
  name, hidePinNumbers: false, hidePinNames: false,
  graphics: [{ type: 'rect', a: [-1.5 * G, -2 * G], b: [1.5 * G, 2 * G], fill: 'background' }],
  pins: [
    { number: top, name: topName, at: [0, -4 * G], dir: 'D', length: 2 * G, type: 'power_in' },
    { number: bottom, name: bottomName, at: [0, 4 * G], dir: 'U', length: 2 * G, type: 'power_in' },
  ],
});

// LM324: four op-amps (Units A–D) and a power Unit (E), sharing one package (ADR-0005)
export const LM324 = {
  id: 'lm324', name: 'LM324', prefix: 'U', defaultValue: 'LM324', category: 'ICs', manufacturer: 'Texas Instruments', keywords: 'lm324 op-amp opamp quad amplifier ic',
  origin: origin('lm324'),
  units: [opAmpUnit('A', '2', '3', '1'), opAmpUnit('B', '6', '5', '7'), opAmpUnit('C', '9', '10', '8'), opAmpUnit('D', '13', '12', '14'), powerUnit('E', '4', '11')],
  footprints: { SOIC14: soic(14), DIP14: dip(14) },
  pinMap: {},
};

export const LM358 = {
  id: 'lm358', name: 'LM358', prefix: 'U', defaultValue: 'LM358', category: 'ICs', manufacturer: 'Texas Instruments', keywords: 'lm358 op-amp opamp dual amplifier ic',
  origin: origin('lm358'),
  units: [opAmpUnit('A', '2', '3', '1'), opAmpUnit('B', '6', '5', '7'), powerUnit('C', '8', '4')],
  footprints: { SOIC8: soic(8), DIP8: dip(8) },
  pinMap: {},
};

export const NE555 = {
  id: 'ne555', name: 'NE555', prefix: 'U', defaultValue: 'NE555', category: 'ICs', manufacturer: 'Texas Instruments', keywords: 'ne555 555 timer oscillator ic',
  origin: origin('ne555'),
  units: [{
    name: 'A', hidePinNumbers: false, hidePinNames: false,
    graphics: [{ type: 'rect', a: [-4 * G, -4 * G], b: [4 * G, 4 * G], fill: 'background' }],
    pins: [
      { number: '4', name: 'R', at: [-7 * G, -3 * G], dir: 'R', length: 3 * G, type: 'input' },
      { number: '2', name: 'TR', at: [-7 * G, -G], dir: 'R', length: 3 * G, type: 'input' },
      { number: '6', name: 'THR', at: [-7 * G, G], dir: 'R', length: 3 * G, type: 'input' },
      { number: '5', name: 'CV', at: [-7 * G, 3 * G], dir: 'R', length: 3 * G, type: 'input' },
      { number: '3', name: 'Q', at: [7 * G, -G], dir: 'L', length: 3 * G, type: 'output' },
      { number: '7', name: 'DIS', at: [7 * G, G], dir: 'L', length: 3 * G, type: 'open_collector' },
      { number: '8', name: 'VCC', at: [0, -7 * G], dir: 'D', length: 3 * G, type: 'power_in' },
      { number: '1', name: 'GND', at: [0, 7 * G], dir: 'U', length: 3 * G, type: 'power_in' },
    ],
  }],
  footprints: { SOIC8: soic(8), DIP8: dip(8) },
  pinMap: {},
};

/** One 2-input NAND gate: a D shape with a bubble on the output. */
const nandUnit = (name, a, b, y) => ({
  name, hidePinNumbers: false, hidePinNames: true,
  graphics: [
    { type: 'line', pts: [[0, -2 * G], [-2 * G, -2 * G], [-2 * G, 2 * G], [0, 2 * G]] },
    { type: 'line', pts: arcPts(0, 0, 2 * G, -Math.PI / 2, Math.PI / 2) },
    { type: 'circle', c: [Math.round(2.5 * G), 0], r: Math.round(0.5 * G), fill: 'none' },
  ],
  pins: [
    { number: a, name: 'A', at: [-5 * G, -G], dir: 'R', length: 3 * G, type: 'input' },
    { number: b, name: 'B', at: [-5 * G, G], dir: 'R', length: 3 * G, type: 'input' },
    { number: y, name: 'Y', at: [5 * G, 0], dir: 'L', length: 2 * G, type: 'output' },
  ],
});

export const HC00 = {
  id: '74hc00', name: '74HC00', prefix: 'U', defaultValue: '74HC00', category: 'ICs', manufacturer: 'Nexperia', keywords: '74hc00 nand gate logic quad 7400 ic',
  origin: origin('74hc00'),
  units: [nandUnit('A', '1', '2', '3'), nandUnit('B', '4', '5', '6'), nandUnit('C', '9', '10', '8'), nandUnit('D', '12', '13', '11'), powerUnit('E', '14', '7', ['VCC', 'GND'])],
  footprints: { SOIC14: soic(14), DIP14: dip(14) },
  pinMap: {},
};

// ---------------------------------------------------------------- Power

export const AMS1117 = {
  id: 'ams1117-3.3', name: 'AMS1117-3.3', prefix: 'U', defaultValue: 'AMS1117-3.3', category: 'Power', manufacturer: 'Advanced Monolithic Systems', keywords: 'ams1117 ldo regulator 3.3v 3v3 linear power',
  origin: origin('ams1117-3.3'),
  units: [{
    name: 'A', hidePinNumbers: false, hidePinNames: false,
    graphics: [{ type: 'rect', a: [-3 * G, -2 * G], b: [3 * G, 2 * G], fill: 'background' }],
    pins: [
      { number: '3', name: 'VI', at: [-6 * G, 0], dir: 'R', length: 3 * G, type: 'power_in' },
      { number: '2', name: 'VO', at: [6 * G, 0], dir: 'L', length: 3 * G, type: 'power_out' },
      { number: '1', name: 'GND', at: [0, 5 * G], dir: 'U', length: 3 * G, type: 'power_in' },
    ],
  }],
  footprints: { SOT223: sot223() },
  pinMap: {},
};

// ---------------------------------------------------------------- the Library

export const CATEGORIES = ['Passives', 'Semiconductors', 'Connectors', 'ICs', 'Power'];

export const STARTER_LIBRARY = [
  RESISTOR, CAPACITOR, CAPACITOR_POLARISED, INDUCTOR,
  LED, DIODE, NPN, PNP, NMOS,
  ...CONNECTORS,
  LM324, LM358, NE555, HC00,
  AMS1117,
];

/** The name a Part is grouped under for a grouping ('category' or 'manufacturer'). */
export const groupOf = (part, by) => (by === 'manufacturer' ? part.manufacturer || 'Generic' : part.category || 'Other');

/**
 * Group Parts for the picker's tree: [{ key, parts }] in a stable order (categories in CATEGORIES
 * order; manufacturers alphabetically with Generic last). Empty groups are left out.
 */
export function groupParts(parts, by) {
  const groups = new Map();
  for (const p of parts) { const k = groupOf(p, by); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); }
  const rank = (k) => (by === 'category' ? (CATEGORIES.indexOf(k) + 1 || CATEGORIES.length + 1) : k === 'Generic' ? 2 : 1);
  return [...groups].map(([key, list]) => ({ key, parts: list })).sort((a, b) => rank(a.key) - rank(b.key) || a.key.localeCompare(b.key));
}

/**
 * Parts in `category` ('All' or a category) whose name, keywords or default Value contain every
 * word of the query. "All" searches every category.
 */
export function searchParts(parts, query, category = 'All') {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  return parts.filter((p) => {
    if (category !== 'All' && p.category !== category) return false;
    const hay = `${p.name} ${p.keywords || ''} ${p.prefix} ${p.defaultValue || ''} ${p.manufacturer || ''}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}
