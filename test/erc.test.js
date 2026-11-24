import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newProject, pinPositions, footprintRef } from '../src/renderer/core/project.js';
import { placeSymbol, addWire, addLabel, toggleNoConnect, moveSelection, deleteItems, copySelection, pasteClip, unitSuggestion } from '../src/renderer/core/schematic.js';
import { runErc } from '../src/renderer/core/erc.js';
import { estimateWidth } from '../src/renderer/core/fields.js';
import { RESISTOR, CAPACITOR, LED, LM324 } from '../src/renderer/library/mini.js';
import { SCH_GRID as G } from '../src/renderer/core/units.js';

const setup = () => { const p = newProject(); return { p, s: p.schematic.sheets[0] }; };
const pin = (p, sym, n) => pinPositions(p, sym).find((x) => x.pin.number === n).at;
const rules = (p, opts) => runErc(p, opts).map((v) => `${v.severity}:${v.rule}`);
const placeUnit = (p, s, at) => { const { componentId, unit } = unitSuggestion(p, LM324); return placeSymbol(p, s, LM324, at, { unit, component: componentId ? p.components[componentId] : undefined }).sym; };

test('a clean design has no violations', () => {
  const { p, s } = setup();
  const r = placeSymbol(p, s, RESISTOR, [G * 10, G * 10], { rot: 90 }).sym;
  const c = placeSymbol(p, s, CAPACITOR, [G * 30, G * 10], { rot: 90 }).sym;
  const d = placeSymbol(p, s, LED, [G * 10, G * 30], { rot: 90 }).sym;
  const top = (y) => [pin(p, y, '1'), pin(p, y, '2')].sort((a, b) => a[1] - b[1]);
  addLabel(p, s, { at: top(r)[0], net: '+5V', style: 'power' });
  addLabel(p, s, { at: top(c)[0], net: '+5V', style: 'power' });
  addWire(p, s, [top(r)[1], top(d)[0]]);
  addLabel(p, s, { at: top(d)[1], net: 'GND', style: 'gnd' });
  addLabel(p, s, { at: top(c)[1], net: 'GND', style: 'gnd' });
  assert.deepEqual(runErc(p), []);
});

test('unconnected Pins are errors; a no-connect marker silences them', () => {
  const { p, s } = setup();
  const r = placeSymbol(p, s, RESISTOR, [G * 10, G * 10]).sym;
  assert.deepEqual(rules(p), ['error:unconnected-pin', 'error:unconnected-pin']);
  const v = runErc(p)[0];
  assert.match(v.message, /R1 pin \d isn't connected/);
  assert.equal(v.sheetId, s.id);
  toggleNoConnect(p, s, pin(p, r, '1'));
  toggleNoConnect(p, s, pin(p, r, '2'));
  assert.deepEqual(rules(p), []);
  toggleNoConnect(p, s, pin(p, r, '2')); // a second press takes it away
  assert.deepEqual(rules(p), ['error:unconnected-pin']);
});

test('no-connect markers: on a connected Pin, or on no Pin, are warnings', () => {
  const { p, s } = setup();
  const a = placeSymbol(p, s, RESISTOR, [G * 10, G * 10]).sym;
  const b = placeSymbol(p, s, RESISTOR, [G * 30, G * 10]).sym;
  addWire(p, s, [pin(p, a, '2'), pin(p, b, '1')]);
  toggleNoConnect(p, s, pin(p, a, '1')); toggleNoConnect(p, s, pin(p, b, '2'));
  toggleNoConnect(p, s, pin(p, a, '2'));
  toggleNoConnect(p, s, [G * 50, G * 50]);
  assert.deepEqual(rules(p).sort(), ['warning:no-connect-connected', 'warning:stray-no-connect']);
});

test('no-connect markers move, copy and delete with their Symbol', () => {
  const { p, s } = setup();
  const a = placeSymbol(p, s, RESISTOR, [G * 10, G * 10]).sym;
  toggleNoConnect(p, s, pin(p, a, '1'));
  moveSelection(p, s, [a.id], [G * 3, G * 2]);
  assert.deepEqual(s.noConnects[0].at, pin(p, a, '1'));
  pasteClip(p, s, copySelection(p, s, [a.id]), [0, G * 10]);
  assert.equal(s.noConnects.length, 2);
  deleteItems(p, [a.id]);
  assert.equal(s.noConnects.length, 1, "the deleted Symbol's marker goes too");
});

test('a Net that reaches a single Pin is a warning', () => {
  const { p, s } = setup();
  const a = placeSymbol(p, s, RESISTOR, [G * 10, G * 10]).sym;
  toggleNoConnect(p, s, pin(p, a, '1'));
  addWire(p, s, [pin(p, a, '2'), [pin(p, a, '2')[0] + G * 5, pin(p, a, '2')[1]]]);
  assert.deepEqual(rules(p), ['warning:single-pin-net']);
});

test('two outputs on one Net are an error; power inputs need a supply', () => {
  const { p, s } = setup();
  const ua = placeUnit(p, s, [G * 20, G * 20]);
  const ub = placeUnit(p, s, [G * 20, G * 40]);
  for (let i = 0; i < 3; i++) placeUnit(p, s, [G * (50 + i * 20), G * 20]); // C, D and the power Unit E
  addWire(p, s, [pin(p, ua, '1'), [pin(p, ua, '1')[0] + G * 5, pin(p, ua, '1')[1]], [pin(p, ua, '1')[0] + G * 5, pin(p, ub, '7')[1]], pin(p, ub, '7')]);
  const out = runErc(p).filter((v) => v.rule === 'output-conflict');
  assert.equal(out.length, 1);
  assert.match(out[0].message, /driven by 2 outputs: U1A pin 1, U1B pin 7/);
  const ue = s.symbols.find((y) => y.unit === 4);
  addLabel(p, s, { at: pin(p, ue, '4'), net: 'VA' }); // a plain label is not a supply
  const r = placeSymbol(p, s, RESISTOR, [G * 90, G * 60]).sym;
  addLabel(p, s, { at: pin(p, r, '1'), net: 'VA' });
  assert.ok(runErc(p).some((v) => v.rule === 'power-undriven' && /U1E pin 4 \(V\+\) is a power input/.test(v.message)));
  addLabel(p, s, { at: pin(p, ue, '4'), net: 'VA', style: 'power' }); // a Power symbol is
  assert.ok(!runErc(p).some((v) => v.rule === 'power-undriven' && /pin 4/.test(v.message)));
});

test('different names on one Net are an error; mixed case is a warning with a fix', () => {
  const { p, s } = setup();
  const a = placeSymbol(p, s, RESISTOR, [G * 10, G * 10]).sym;
  const b = placeSymbol(p, s, RESISTOR, [G * 30, G * 10]).sym;
  toggleNoConnect(p, s, pin(p, a, '1')); toggleNoConnect(p, s, pin(p, b, '2'));
  addWire(p, s, [pin(p, a, '2'), pin(p, b, '1')]);
  addLabel(p, s, { at: pin(p, a, '2'), net: 'EN' });
  addLabel(p, s, { at: pin(p, b, '1'), net: 'en' });
  addLabel(p, s, { at: pin(p, b, '1'), net: 'En' });
  const v = runErc(p);
  assert.deepEqual(v.map((x) => x.rule), ['mixed-spelling'], 'case only: not a conflict');
  assert.equal(v[0].fix.label, 'Rename to EN');
  v[0].fix.apply(p);
  assert.deepEqual(s.labels.map((l) => l.net), ['EN', 'EN', 'EN']);
  assert.deepEqual(runErc(p), []);
  addLabel(p, s, { at: pin(p, a, '2'), net: 'ENABLE' });
  assert.deepEqual(rules(p), ['error:label-conflict']);
});

test('a Pin with no Pad on the Footprint is an error; no Footprint is a warning', () => {
  const { p, s } = setup();
  const { comp, sym } = placeSymbol(p, s, RESISTOR, [G * 10, G * 10]);
  toggleNoConnect(p, s, pin(p, sym, '1')); toggleNoConnect(p, s, pin(p, sym, '2'));
  comp.footprint = footprintRef(p, { library: 'mine', footprint: { name: 'One_pad', pads: [{ number: '1', at: [0, 0], shape: 'rect', size: [G, G], layers: ['F.Cu'] }] } });
  const v = runErc(p);
  assert.deepEqual(v.map((x) => x.rule), ['pin-without-pad']);
  assert.match(v[0].message, /R1 pin 2 has no pad 2 on One_pad/);
  comp.footprint = null;
  assert.deepEqual(rules(p), ['warning:no-footprint']);
});

test('a power Unit left unplaced is an error; other Units a warning', () => {
  const { p, s } = setup();
  placeUnit(p, s, [G * 20, G * 20]);
  const v = runErc(p).filter((x) => x.rule === 'unit-not-placed');
  assert.equal(v.length, 1);
  assert.equal(v[0].severity, 'error');
  assert.match(v[0].message, /U1B, U1C, U1D, U1E aren't placed, so the chip has no power connection/);
});

test('field overlaps are warnings when the caller can measure text', () => {
  const { p, s } = setup();
  for (let i = 0; i < 8; i++) placeSymbol(p, s, RESISTOR, [G * 10, G * 10]); // stacked on top of each other: no free spot left
  assert.ok(!rules(p).includes('warning:field-overlap'));
  assert.ok(rules(p, { measure: estimateWidth }).includes('warning:field-overlap'));
});

test('violations are sorted errors first and point at a Sheet and a place', () => {
  const { p, s } = setup();
  placeSymbol(p, s, RESISTOR, [G * 10, G * 10]);
  toggleNoConnect(p, s, [G * 40, G * 40]);
  const v = runErc(p);
  assert.deepEqual(v.map((x) => x.severity), ['error', 'error', 'warning']);
  for (const x of v) { assert.equal(x.sheetId, s.id); assert.equal(x.at.length, 2); assert.ok(x.id); }
});
