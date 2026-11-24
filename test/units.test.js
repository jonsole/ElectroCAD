import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newProject, newSheet } from '../src/renderer/core/project.js';
import { placeSymbol, deleteItems, addWire, placedUnits, unitSuggestion, nextUnplacedUnit, setSymbolUnit, unitLetter } from '../src/renderer/core/schematic.js';
import { buildNetlist } from '../src/renderer/core/netlist.js';
import { placeFields, estimateWidth } from '../src/renderer/core/fields.js';
import { pinPositions } from '../src/renderer/core/project.js';
import { LM324, RESISTOR } from '../src/renderer/library/mini.js';
import { SCH_GRID as G } from '../src/renderer/core/units.js';

/** Place the suggested Unit, as the editor does when you click. */
const placeNext = (p, s, part, at) => {
  const { componentId, unit } = unitSuggestion(p, part);
  return placeSymbol(p, s, part, at, { unit, component: componentId ? p.components[componentId] : undefined });
};

test('an LM324 places as U1A–U1D and the power Unit U1E, then starts U2', () => {
  const p = newProject(); const s = p.schematic.sheets[0];
  const refs = [];
  for (let i = 0; i < 6; i++) {
    const { comp, sym } = placeNext(p, s, LM324, [G * 20 * (i + 1), G * 20]);
    refs.push(comp.ref + unitLetter(LM324, sym.unit));
  }
  assert.deepEqual(refs, ['U1A', 'U1B', 'U1C', 'U1D', 'U1E', 'U2A']);
  assert.equal(Object.keys(p.components).length, 2);
  const labels = [...placeFields(p, s, { measure: estimateWidth }).values()].map((r) => r.items.find((i) => i.keys.includes('reference'))?.text);
  assert.ok(labels.includes('U1C') && labels.includes('U2A'), 'fields show the Unit letter');
});

test('the suggestion fills gaps, on any Sheet, before starting a new Component', () => {
  const p = newProject(); const s1 = p.schematic.sheets[0];
  const s2 = newSheet('Two'); p.schematic.sheets.push(s2);
  const a = placeNext(p, s1, LM324, [G * 10, G * 10]); // U1A
  placeNext(p, s2, LM324, [G * 10, G * 10]); // U1B on another Sheet
  const c = placeNext(p, s1, LM324, [G * 30, G * 10]); // U1C
  deleteItems(p, [s2.symbols[0].id]); // remove U1B
  assert.deepEqual([...placedUnits(p, a.comp.id)].sort(), [0, 2]);
  assert.deepEqual(unitSuggestion(p, LM324), { componentId: a.comp.id, unit: 1 }, 'U1B again');
  assert.equal(nextUnplacedUnit(p, a.comp.id, 2), 3, 'after C comes D');
  assert.equal(nextUnplacedUnit(p, c.comp.id, 4), 1, 'and wraps round to the gap');
  assert.deepEqual(unitSuggestion(p, RESISTOR), { componentId: null, unit: 0 }, 'single-Unit Parts always start a new Component');
});

test('deleting one Unit keeps the others; deleting the last removes the Component', () => {
  const p = newProject(); const s = p.schematic.sheets[0];
  const a = placeNext(p, s, LM324, [G * 10, G * 10]);
  const b = placeNext(p, s, LM324, [G * 30, G * 10]);
  deleteItems(p, [a.sym.id]);
  assert.ok(p.components[a.comp.id], 'U1 stays while U1B is placed');
  assert.equal(p.components[a.comp.id].ref, 'U1');
  deleteItems(p, [b.sym.id]);
  assert.equal(p.components[a.comp.id], undefined, 'gone with its last Unit');
});

test('every Unit\'s Pins map onto the one Footprint\'s Pads in the Netlist', () => {
  const p = newProject(); const s = p.schematic.sheets[0];
  const u = []; for (let i = 0; i < 5; i++) u.push(placeNext(p, s, LM324, [G * 20 * (i + 1), G * 20]).sym);
  const pin = (sym, n) => pinPositions(p, sym).find((x) => x.pin.number === n).at;
  // A's output (pin 1) to D's + input (pin 12); the power Unit's V+ (4) to C's output (8)
  addWire(p, s, [pin(u[0], '1'), [pin(u[0], '1')[0], G * 30], [pin(u[3], '12')[0], G * 30], pin(u[3], '12')]);
  addWire(p, s, [pin(u[4], '4'), [pin(u[4], '4')[0], G * 8], [pin(u[2], '8')[0], G * 8], pin(u[2], '8')]);
  const nets = buildNetlist(p).nets.map((n) => n.pins.map((x) => `${x.ref}.${x.pin}>${x.pad}`).join(' '));
  assert.ok(nets.includes('U1.1>1 U1.12>12'), nets.join(' | '));
  assert.ok(nets.includes('U1.4>4 U1.8>8'), nets.join(' | '));
  assert.equal(new Set(buildNetlist(p).unconnected.map((x) => x.componentId)).size, 1, 'one Component, one Footprint');
});

test('a Unit can be swapped for another unplaced Unit of the same Component (gate swap)', () => {
  const p = newProject(); const s = p.schematic.sheets[0];
  const a = placeNext(p, s, LM324, [G * 10, G * 10]); // U1A
  placeNext(p, s, LM324, [G * 30, G * 10]); // U1B
  assert.equal(setSymbolUnit(p, a.sym.id, 1), false, 'B is already placed');
  assert.equal(setSymbolUnit(p, a.sym.id, 3), true);
  assert.equal(a.sym.unit, 3);
  assert.equal(setSymbolUnit(p, a.sym.id, 9), false, 'no such Unit');
});
