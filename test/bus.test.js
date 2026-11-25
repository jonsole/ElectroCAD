// Busses (#64): names and members, entries that join by name only, ERC, and editing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newProject, pinPositions, serialize, deserialize } from '../src/renderer/core/project.js';
import { placeSymbol, addWire, addBus, addLabel, renameBus, moveSelection, deleteItems, copySelection, pasteClip, itemsInRect } from '../src/renderer/core/schematic.js';
import { busMembers, busGroups } from '../src/renderer/core/bus.js';
import { buildNetlist, junctions } from '../src/renderer/core/netlist.js';
import { runErc } from '../src/renderer/core/erc.js';
import { RESISTOR } from '../src/renderer/library/mini.js';
import { SCH_GRID as G } from '../src/renderer/core/units.js';

test('bus names list their members: ranges, lists, overbars, KiCad groups', () => {
  assert.deepEqual(busMembers('D[0..3]'), ['D0', 'D1', 'D2', 'D3']);
  assert.deepEqual(busMembers('A[2..0]'), ['A2', 'A1', 'A0']);
  assert.deepEqual(busMembers('D_ASR[0..1],~{D_TEST},D_PC5/SDAT1'), ['D_ASR0', 'D_ASR1', '~{D_TEST}', 'D_PC5/SDAT1']);
  assert.deepEqual(busMembers('~{A},~{B}'), ['~{A}', '~{B}']);
  assert.deepEqual(busMembers('{SDA SCL}'), ['SDA', 'SCL']);
  assert.deepEqual(busMembers('I2C{SDA SCL}'), ['I2C.SDA', 'I2C.SCL']);
  assert.deepEqual(busMembers('A, B,,A'), ['A', 'B']);
  assert.deepEqual(busMembers(''), []);
});

// R1 pin 1 enters a bus with a slanted stub, at the point where R2's wire crosses the bus
function crossing() {
  const p = newProject(), s = p.schematic.sheets[0];
  const r1 = placeSymbol(p, s, RESISTOR, [G * 10, G * 20]).sym;
  const r2 = placeSymbol(p, s, RESISTOR, [G * 60, G * 30]).sym;
  const pin = (y, n) => pinPositions(p, y).find((x) => x.pin.number === n).at;
  const a = pin(r1, '1');
  const bx = a[0] + 10 * G, X = [bx, a[1] + 5 * G];
  addBus(p, s, [[bx, a[1] - 20 * G], [bx, a[1] + 20 * G]], 'D[0..1]');
  addWire(p, s, [a, [bx - 5 * G, a[1]]]);
  s.wires.push({ id: 'entry', a: [bx - 5 * G, a[1]], b: X }); // the 45° entry
  const q = pin(r2, '1');
  addWire(p, s, [q, [q[0], X[1]], [bx - 15 * G, X[1]]]); // runs straight across the bus at X
  return { p, s, r1, r2, a, q, X };
}

test('a wire ending on a bus joins the bus by name only, not a wire crossing it there', () => {
  const { p, s, r1, r2, X } = crossing();
  const nl = buildNetlist(p);
  const netOf = (y, n) => nl.nets.find((x) => x.pins.some((q) => q.componentId === y.componentId && q.pin === n));
  assert.notEqual(netOf(r1, '1'), netOf(r2, '1'));
  assert.ok(!junctions(p, s).some((j) => j[0] === X[0] && j[1] === X[1]), 'no junction dot there');
  // without the bus, the end landing on R2's wire joins it
  s.busses = [];
  const nl2 = buildNetlist(p);
  const n2 = (y, n) => nl2.nets.find((x) => x.pins.some((q) => q.componentId === y.componentId && q.pin === n));
  assert.equal(n2(r1, '1'), n2(r2, '1'));
});

test('ERC: an unnamed bus, and a net entering a bus that doesn\'t list it', () => {
  const { p, s, a } = crossing();
  const busRules = () => runErc(p).filter((v) => /^bus/.test(v.rule)).map((v) => v.rule);
  addLabel(p, s, { at: a, net: 'D0' });
  assert.deepEqual(busRules(), []);
  s.labels[0].net = 'CLK';
  const v = runErc(p).filter((x) => x.rule === 'bus-member');
  assert.equal(v.length, 1);
  assert.match(v[0].message, /CLK enters bus D\[0\.\.1\], which doesn't list it/);
  assert.equal(v[0].items[0], 'entry');
  renameBus(p, s, s.busses[0].id, '');
  assert.deepEqual(busRules(), ['bus-unnamed']);
  // a bus label names no net
  renameBus(p, s, s.busses[0].id, 'CLK,D1');
  const l = addLabel(p, s, { at: s.busses[0].a, net: 'CLK,D1' }); l.bus = true;
  assert.deepEqual(busRules(), []);
  assert.ok(!buildNetlist(p).nets.some((n) => /CLK,D1/.test(n.name)));
});

test('editing: a run joined to a bus takes its name; rename covers every segment and its labels', () => {
  const p = newProject(), s = p.schematic.sheets[0];
  addBus(p, s, [[0, 0], [10 * G, 0]], 'A[0..7]');
  const more = addBus(p, s, [[10 * G, 0], [10 * G, 10 * G]]);
  assert.equal(more[0].name, 'A[0..7]');
  assert.equal(busGroups(s).length, 1);
  const l = addLabel(p, s, { at: [5 * G, 0], net: 'A[0..7]' }); l.bus = true;
  renameBus(p, s, more[0].id, 'B[0..3]');
  assert.deepEqual(s.busses.map((b) => b.name), ['B[0..3]', 'B[0..3]']);
  assert.equal(l.net, 'B[0..3]');
  // apart: a second bus keeps its own name
  addBus(p, s, [[0, 20 * G], [10 * G, 20 * G]], 'C');
  assert.equal(busGroups(s).length, 2);
});

test('editing: move takes entries and labels along; copy, paste, box select and delete', () => {
  const { p, s, X } = crossing();
  const bus = s.busses[0];
  const l = addLabel(p, s, { at: [bus.a[0], bus.a[1] + G], net: 'D[0..1]' }); l.bus = true;
  moveSelection(p, s, [bus.id], [G, 0]);
  assert.equal(bus.a[0], X[0] + G);
  const entry = s.wires.find((w) => w.id === 'entry');
  assert.deepEqual(entry.b, [X[0] + G, X[1]], 'the entry end stays on the bus');
  assert.equal(l.at[0], X[0] + G, 'its label goes along');
  const clip = copySelection(p, s, [bus.id]);
  assert.equal(clip.busses.length, 1);
  const ids = pasteClip(p, s, clip, [5 * G, 0]);
  assert.equal(s.busses.length, 2);
  assert.equal(s.busses[1].name, 'D[0..1]');
  assert.ok(itemsInRect(p, s, { x0: bus.a[0] - 1, y0: bus.a[1] - 1, x1: bus.b[0] + 1, y1: bus.b[1] + 1 }).includes(bus.id));
  deleteItems(p, ids);
  assert.equal(s.busses.length, 1);
  // saved and opened again
  const back = deserialize(serialize(p));
  assert.deepEqual(back.schematic.sheets[0].busses, s.busses);
});
