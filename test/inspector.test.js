import { test } from 'node:test';
import { allFootprints } from '../src/renderer/library/footprints.js';
import assert from 'node:assert/strict';
import { newProject, padForPin, footprintOf } from '../src/renderer/core/project.js';
import { placeSymbol } from '../src/renderer/core/schematic.js';
import { validateRef, updateComponent, footprintChoices } from '../src/renderer/core/components.js';
import { History } from '../src/renderer/core/history.js';
import { MINI_LIBRARY, RESISTOR, CAPACITOR } from '../src/renderer/library/mini.js';
import { SCH_GRID as G } from '../src/renderer/core/units.js';

function two() {
  const p = newProject();
  const s = p.schematic.sheets[0];
  const r1 = placeSymbol(p, s, RESISTOR, [G * 10, G * 10]).comp;
  const r2 = placeSymbol(p, s, RESISTOR, [G * 30, G * 10]).comp;
  return { p, s, r1, r2 };
}

test('Reference designators must be unique, non-empty and without spaces', () => {
  const { p, r1 } = two();
  assert.equal(validateRef(p, r1.id, 'R7'), null);
  assert.equal(validateRef(p, r1.id, 'R1'), null, 'keeping its own is fine');
  assert.match(validateRef(p, r1.id, 'R2'), /already used by another part/);
  assert.match(validateRef(p, r1.id, '  '), /can't be empty/);
  assert.match(validateRef(p, r1.id, 'R 3'), /no spaces/);
});

test('updateComponent edits Reference designator, Value, MPN and fields; a bad reference changes nothing', () => {
  const { p, r1 } = two();
  updateComponent(p, r1.id, { ref: 'R10', value: '4.7k', mpn: { manufacturer: 'Yageo', number: 'RC0805FR-074K7L' }, fields: { Tolerance: '1%' } });
  assert.equal(r1.ref, 'R10');
  assert.equal(r1.value, '4.7k');
  assert.deepEqual(r1.mpn, { manufacturer: 'Yageo', number: 'RC0805FR-074K7L' });
  assert.deepEqual(r1.fields, { Tolerance: '1%' });
  assert.throws(() => updateComponent(p, r1.id, { ref: 'R2', value: '1k' }), /already used/);
  assert.equal(r1.value, '4.7k', 'nothing changed');
  updateComponent(p, r1.id, { mpn: { manufacturer: '', number: '' } });
  assert.equal(r1.mpn, null, 'an empty MPN clears it');
});

test('footprint choices: Preferred first, then any other Footprint from the Library', () => {
  const { p, r1 } = two();
  const ch = footprintChoices(p, r1, MINI_LIBRARY, allFootprints());
  assert.deepEqual(ch.preferred.map((c) => c.label), ['R_0805_2012Metric', 'R_0402_1005Metric', 'R_0603_1608Metric', 'R_1206_3216Metric', 'R_Axial_DIN0207_L6.3mm_D2.5mm_P10.16mm_Horizontal']);
  assert.deepEqual(ch.preferred[0].value, { fpId: 'R_0805' }, '0805 is the default');
  assert.ok(ch.other.some((c) => c.label === 'SOIC-8_3.9x4.9mm_P1.27mm'), 'every generated Footprint is offered');
  assert.ok(ch.other.some((c) => c.label === 'C_0805_2012Metric'));
  assert.ok(!ch.other.some((c) => c.label === 'R_0805_2012Metric'), 'no duplicate of a Preferred footprint');
});

test('choosing another Footprint uses the identity Pin map, and is one undo step', () => {
  let { p, r1 } = two();
  const h = new History(() => p, (x) => { p = x; });
  const other = footprintChoices(p, r1, MINI_LIBRARY).other.find((c) => c.label === 'C_0805_2012Metric');
  h.transact('Footprint', (pr) => updateComponent(pr, r1.id, { footprint: other.value }));
  const c = p.components[r1.id];
  assert.equal(footprintOf(p, c).name, 'C_0805_2012Metric');
  assert.equal(padForPin(p, c, '2'), '2');
  h.undo();
  assert.deepEqual(p.components[r1.id].footprint, { fpId: 'R_0805' });
  void CAPACITOR;
});
