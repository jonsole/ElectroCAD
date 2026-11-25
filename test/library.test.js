import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chip, pinHeader, soic, dip, sot23, sot223, qfn, allFootprints, CHIP_SIZES } from '../src/renderer/library/footprints.js';
import { STARTER_LIBRARY, CATEGORIES, RESISTOR, LM358, HC00, AMS1117, CONNECTORS } from '../src/renderer/library/starter.js';
import { newProject, footprintOf, padForPin } from '../src/renderer/core/project.js';
import { placeSymbol } from '../src/renderer/core/schematic.js';
import { mm } from '../src/renderer/core/units.js';

const xs = (fp) => fp.pads.map((p) => p.at[0]);
const ys = (fp) => fp.pads.map((p) => p.at[1]);

test('chip Footprints: two pads with IPC-7351 nominal lands, named as KiCad does', () => {
  for (const [size, s] of Object.entries(CHIP_SIZES)) {
    const fp = chip('R', size);
    assert.equal(fp.name, `R_${size}_${s.metric}Metric`);
    assert.deepEqual(fp.pads.map((p) => p.number), ['1', '2']);
    assert.equal(fp.pads[1].at[0] - fp.pads[0].at[0], mm(2 * s.x), size);
    assert.deepEqual(fp.pads[0].size, [mm(s.pad[0]), mm(s.pad[1])]);
  }
  assert.deepEqual(chip('C', '0603').pads[0].size, [mm(0.8), mm(0.95)]);
});

test('pin headers: 2.54 mm pitch, pad 1 square, 2xN numbered across the rows', () => {
  const h1 = pinHeader(1, 4);
  assert.equal(h1.name, 'PinHeader_1x04_P2.54mm_Vertical');
  assert.deepEqual(ys(h1).map((y, i, a) => (i ? y - a[i - 1] : 0)).slice(1), [mm(2.54), mm(2.54), mm(2.54)]);
  assert.equal(h1.pads[0].shape, 'rect');
  assert.ok(h1.pads.every((p) => p.drill === mm(1.0)));
  const h2 = pinHeader(2, 5);
  assert.equal(h2.pads.length, 10);
  const p = (n) => h2.pads.find((x) => x.number === String(n));
  assert.equal(p(1).at[1], p(2).at[1], 'pins 1 and 2 share a row');
  assert.equal(p(2).at[0] - p(1).at[0], mm(2.54));
});

test('IC packages: pad count, pitch and numbering', () => {
  for (const n of [8, 14, 16]) {
    const s = soic(n);
    assert.equal(s.pads.length, n);
    assert.equal(s.pads[1].at[1] - s.pads[0].at[1], mm(1.27));
    assert.ok(s.pads[0].at[0] < 0 && s.pads[n - 1].at[0] > 0 && s.pads[n - 1].at[1] === s.pads[0].at[1], 'pin n faces pin 1');
    const d = dip(n);
    assert.equal(d.pads[1].at[1] - d.pads[0].at[1], mm(2.54));
    assert.equal(d.pads[n - 1].at[0] - d.pads[0].at[0], mm(7.62));
  }
  assert.deepEqual(sot23().pads.map((p) => p.number), ['1', '2', '3']);
  assert.deepEqual(sot223().pads.map((p) => p.number), ['1', '2', '3', '2'], 'the tab is pin 2');
  const q = qfn(16, 3, 0.5);
  assert.equal(q.pads.length, 17, '16 + exposed pad');
  assert.equal(q.pads[16].number, '17');
  assert.equal(q.pads[1].at[1] - q.pads[0].at[1], mm(0.5));
  assert.ok(q.pads[0].at[0] < 0 && q.pads[4].at[1] > 0 && q.pads[8].at[0] > 0 && q.pads[12].at[1] < 0, 'counter-clockwise from the left side');
  const names = allFootprints().map((f) => f.name);
  assert.equal(new Set(names).size, names.length, 'Footprint names are unique');
});

test('the starter Library: every Part in a category, Pins on the grid, every Pin with a Pad', () => {
  const ids = STARTER_LIBRARY.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const part of STARTER_LIBRARY) {
    assert.ok(CATEGORIES.includes(part.category), part.name);
    assert.ok(Object.keys(part.footprints).length, part.name);
    const pins = part.units.flatMap((u) => u.pins);
    for (const [fpId, fp] of Object.entries(part.footprints)) {
      const pads = new Set(fp.pads.map((p) => p.number));
      for (const pin of pins) assert.ok(pads.has(part.pinMap?.[fpId]?.[pin.number] ?? pin.number), `${part.name} pin ${pin.number} on ${fpId}`);
      assert.equal(new Set(pins.map((x) => x.number)).size, pads.size, `${part.name} on ${fpId}: every Pad has a Pin`);
    }
  }
  assert.equal(CONNECTORS.length, 19);
  assert.deepEqual([LM358, HC00].map((p) => p.units.length), [3, 5], 'multi-Unit ICs carry a power Unit');
  assert.ok(AMS1117.units[0].pins.some((p) => p.type === 'power_out'));
});

test('a dropped Component gets the chosen Footprint: Preferred by key, or any other into the table', () => {
  const p = newProject(); const s = p.schematic.sheets[0];
  const a = placeSymbol(p, s, RESISTOR, [0, 0]);
  assert.deepEqual(a.comp.footprint, { fpId: 'R_0805' }, 'default: the first Preferred footprint');
  const b = placeSymbol(p, s, RESISTOR, [0, 0], { footprint: { fpId: 'R_0402' } });
  assert.equal(footprintOf(p, b.comp).name, 'R_0402_1005Metric');
  const c = placeSymbol(p, s, RESISTOR, [0, 0], { footprint: { library: 'builtin', footprint: soic(8) } });
  assert.deepEqual(c.comp.footprint, { fpKey: 'builtin/SOIC-8_3.9x4.9mm_P1.27mm' });
  assert.equal(padForPin(p, c.comp, '2'), '2');
});

import { groupParts, groupOf, searchParts } from '../src/renderer/library/starter.js';

test('the picker tree groups Parts by category or manufacturer', () => {
  const byCat = groupParts(STARTER_LIBRARY, 'category');
  assert.deepEqual(byCat.map((g) => g.key), CATEGORIES);
  assert.equal(byCat.reduce((n, g) => n + g.parts.length, 0), STARTER_LIBRARY.length);
  const byMfr = groupParts(STARTER_LIBRARY, 'manufacturer');
  assert.deepEqual(byMfr.map((g) => g.key), ['Advanced Monolithic Systems', 'Nexperia', 'Texas Instruments', 'Generic']);
  assert.deepEqual(byMfr.find((g) => g.key === 'Texas Instruments').parts.map((p) => p.name), ['LM324', 'LM358', 'NE555']);
  assert.equal(groupOf(RESISTOR, 'manufacturer'), 'Generic');
  assert.deepEqual(searchParts(STARTER_LIBRARY, 'nexperia').map((p) => p.name), ['NPN transistor', 'PNP transistor', 'N-MOSFET', '74HC00'], 'search finds manufacturers');
  const p = newProject();
  placeSymbol(p, p.schematic.sheets[0], LM358, [0, 0]);
  assert.ok(!('manufacturer' in Object.values(p.parts)[0]), 'Library-only keys stay in the Library');
});

test('unit letters: power-only Units don\'t count (IC9, not IC9A) (#62)', async () => {
  const { unitLetter, isPowerUnit } = await import('../src/renderer/core/library.js');
  const pin = (type) => ({ number: '1', name: 'x', type });
  const logic = { name: 'A', pins: [pin('input'), pin('output')] }, power = { name: 'P', pins: [pin('power_in'), pin('power_in')] };
  assert.equal(isPowerUnit(power), true);
  assert.equal(isPowerUnit(logic), false);
  assert.equal(isPowerUnit({ pins: [] }), false);
  // one ordinary Unit and a power Unit: a bare Reference on the ordinary one, a letter on the power one
  const single = { units: [logic, power] };
  assert.equal(unitLetter(single, 0), '');
  assert.equal(unitLetter(single, 1), 'P', 'the power Unit by its own name');
  // two ordinary Units and a power Unit: tags on all, by name
  const dual = { units: [logic, { ...logic, name: 'B' }, power] };
  assert.deepEqual([0, 1, 2].map((i) => unitLetter(dual, i)), ['A', 'B', 'P']);
  // names that aren't short, distinct labels fall back to A, B… by position
  assert.deepEqual([0, 1].map((i) => unitLetter({ units: [{ ...logic, name: 'Left half' }, { ...logic, name: 'Right half' }] }, i)), ['A', 'B']);
  assert.deepEqual([0, 1].map((i) => unitLetter({ units: [{ ...logic, name: 'X' }, { ...logic, name: 'X' }] }, i)), ['A', 'B']);
  // Eagle-style gate names
  assert.deepEqual([0, 1].map((i) => unitLetter({ units: [{ ...logic, name: '-1' }, { ...logic, name: '-2' }] }, i)), ['-1', '-2']);
  // one Unit: no letter
  assert.equal(unitLetter({ units: [logic] }, 0), '');
  assert.equal(unitLetter(null, 0), '');
});
