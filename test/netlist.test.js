import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newProject, pinPositions } from '../src/renderer/core/project.js';
import { placeSymbol, addWire, deleteItems, rotateSymbols, mirrorSymbols } from '../src/renderer/core/schematic.js';
import { buildNetlist, junctions, compareRefs } from '../src/renderer/core/netlist.js';
import { RESISTOR, CAPACITOR, LED } from '../src/renderer/library/mini.js';
import { mm, SCH_GRID as G } from '../src/renderer/core/units.js';

const pinAt = (p, sym, number) => pinPositions(p, sym).find((x) => x.pin.number === number).at;
const netOf = (nl, ref, pin) => nl.nets.find((n) => n.pins.some((x) => x.ref === ref && x.pin === pin));
const names = (net) => net.pins.map((x) => `${x.ref}.${x.pin}`).sort();

function series() {
  const p = newProject();
  const s = p.schematic.sheets[0];
  const r1 = placeSymbol(p, s, RESISTOR, [mm(20.32), mm(25.4)]).sym;
  const r2 = placeSymbol(p, s, RESISTOR, [mm(40.64), mm(25.4)]).sym;
  addWire(p, s, [pinAt(p, r1, '2'), pinAt(p, r2, '1')]);
  return { p, s, r1, r2 };
}

test('two resistors in series share one Net, named after the lowest Reference designator and Pad', () => {
  const { p } = series();
  const nl = buildNetlist(p);
  assert.equal(nl.nets.length, 1);
  assert.deepEqual(names(nl.nets[0]), ['R1.2', 'R2.1']);
  assert.equal(nl.nets[0].name, 'Net-(R1-Pad2)');
  assert.deepEqual(nl.unconnected.map((x) => `${x.ref}.${x.pin}`), ['R1.1', 'R2.2']);
});

test('a Wire may bend: an L-shaped wire still joins its ends', () => {
  const p = newProject();
  const s = p.schematic.sheets[0];
  const r1 = placeSymbol(p, s, RESISTOR, [mm(20.32), mm(25.4)]).sym;
  const c1 = placeSymbol(p, s, CAPACITOR, [mm(50.8), mm(50.8)], { rot: 90 }).sym;
  // rotated 90° CCW, C1's pin 2 is the upper one (pin 1 is below); wire to the near pin
  const a = pinAt(p, r1, '2'), b = pinAt(p, c1, '2');
  addWire(p, s, [a, [b[0], a[1]], b]);
  assert.deepEqual(names(buildNetlist(p).nets[0]), ['C1.2', 'R1.2']);
});

test('a T-join: a Wire ending in the middle of another Wire connects to it', () => {
  const { p, s, r1 } = series();
  const c1 = placeSymbol(p, s, CAPACITOR, [mm(30.48), mm(38.1)], { rot: 90 }).sym;
  const top = pinAt(p, c1, '2'); // the upper Pin after rotating 90°
  addWire(p, s, [top, [top[0], mm(25.4)]]); // ends mid-wire between R1 and R2
  const net = netOf(buildNetlist(p), 'R1', '2');
  assert.deepEqual(names(net), ['C1.2', 'R1.2', 'R2.1']);
  void r1;
  // and the T-join gets a Junction dot
  assert.deepEqual(junctions(p, s), [[top[0], mm(25.4)]]);
});

test('a Pin lying on a Wire connects to it (as in KiCad)', () => {
  const p = newProject();
  const s = p.schematic.sheets[0];
  const c1 = placeSymbol(p, s, CAPACITOR, [mm(50.8), mm(50.8)], { rot: 90 }).sym;
  const [a, b] = [pinAt(p, c1, '1'), pinAt(p, c1, '2')];
  addWire(p, s, [[a[0], a[1] + mm(5.08)], [b[0], b[1] - mm(5.08)]]); // runs straight through both Pins
  assert.deepEqual(names(buildNetlist(p).nets[0]), ['C1.1', 'C1.2'], 'the capacitor is shorted');
});

test('crossing Wires without a junction stay separate Nets', () => {
  const p = newProject();
  const s = p.schematic.sheets[0];
  const a = placeSymbol(p, s, RESISTOR, [mm(20.32), mm(30.48)]).sym;
  const b = placeSymbol(p, s, RESISTOR, [mm(60.96), mm(30.48)]).sym;
  const c = placeSymbol(p, s, RESISTOR, [mm(40.64), mm(15.24)], { rot: 90 }).sym;
  const d = placeSymbol(p, s, RESISTOR, [mm(40.64), mm(45.72)], { rot: 90 }).sym;
  addWire(p, s, [pinAt(p, a, '2'), pinAt(p, b, '1')]);         // horizontal
  addWire(p, s, [pinAt(p, c, '1'), pinAt(p, d, '2')]);         // vertical, crossing it
  const nl = buildNetlist(p);
  assert.equal(nl.nets.length, 2);
  assert.notEqual(netOf(nl, 'R1', '2'), netOf(nl, 'R3', '1'));
  assert.deepEqual(junctions(p, s), []);
});

test('three or more Wire ends at one point join and get a Junction', () => {
  const p = newProject();
  const s = p.schematic.sheets[0];
  const r1 = placeSymbol(p, s, RESISTOR, [mm(20.32), mm(25.4)]).sym;
  const r2 = placeSymbol(p, s, RESISTOR, [mm(60.96), mm(25.4)]).sym;
  const r3 = placeSymbol(p, s, RESISTOR, [mm(40.64), mm(45.72)], { rot: 90 }).sym;
  const mid = [mm(40.64), mm(25.4)];
  addWire(p, s, [pinAt(p, r1, '2'), mid]);
  addWire(p, s, [pinAt(p, r2, '1'), mid]);
  addWire(p, s, [pinAt(p, r3, '2'), mid]);
  assert.deepEqual(names(buildNetlist(p).nets[0]), ['R1.2', 'R2.1', 'R3.2']);
  assert.deepEqual(junctions(p, s), [mid]);
});

test('rotated and mirrored Symbols connect at their transformed Pins', () => {
  const p = newProject();
  const s = p.schematic.sheets[0];
  const led = placeSymbol(p, s, LED, [mm(30.48), mm(30.48)]).sym;
  const r = placeSymbol(p, s, RESISTOR, [mm(30.48), mm(55.88)], { rot: 90 }).sym;
  rotateSymbols(p, [led.id]); mirrorSymbols(p, [led.id]);
  addWire(p, s, [pinAt(p, led, '1'), [pinAt(p, led, '1')[0], pinAt(p, r, '2')[1]], pinAt(p, r, '2')]);
  const net = netOf(buildNetlist(p), 'D1', '1');
  assert.ok(net, 'D1 cathode is on a Net');
  assert.deepEqual(names(net), ['D1.1', 'R1.2']);
});

test('generated Net names are stable when unrelated things change', () => {
  const { p, s } = series();
  const before = buildNetlist(p).nets.map((n) => n.name);
  placeSymbol(p, s, CAPACITOR, [mm(80), mm(80)]);
  assert.deepEqual(buildNetlist(p).nets.map((n) => n.name), before);
});

test('deleting a Wire splits the Net again', () => {
  const { p, s } = series();
  deleteItems(p, [s.wires[0].id]);
  assert.equal(buildNetlist(p).nets.length, 0);
});

test('addWire snaps points, drops zero-length and merges straight runs', () => {
  const p = newProject();
  const s = p.schematic.sheets[0];
  const w = addWire(p, s, [[G * 2 + 10, G], [G * 2, G], [G * 5, G], [G * 8, G], [G * 8, G * 4]]);
  assert.deepEqual(w.map((x) => [x.a, x.b]), [[[G * 2, G], [G * 8, G]], [[G * 8, G], [G * 8, G * 4]]]);
});

test('references sort naturally', () => {
  assert.deepEqual(['R10', 'C2', 'R2', 'R1'].sort(compareRefs), ['C2', 'R1', 'R2', 'R10']);
});

// ---------------------------------------------------------------- wire corners (follow the direction)
import { preferredAxis, routeWire } from '../src/renderer/core/schematic.js';

test('a new run carries on in the direction the wire is already going', () => {
  const p = newProject();
  const s = p.schematic.sheets[0];
  // drawn so far: right, then down -> the next corner goes down first
  assert.equal(preferredAxis(p, s, [G * 10, G * 10], [[0, 0], [G * 10, 0], [G * 10, G * 10]]), 'v');
  assert.deepEqual(routeWire(p, s, [G * 10, G * 10], [G * 20, G * 20], { axis: 'v' }), [[G * 10, G * 20], [G * 20, G * 20]]);
  // drawn so far: down, then right -> horizontal first
  assert.equal(preferredAxis(p, s, [G * 10, G * 10], [[0, 0], [0, G * 10], [G * 10, G * 10]]), 'h');
});

test('starting from the end of an existing Wire continues its direction', () => {
  const p = newProject();
  const s = p.schematic.sheets[0];
  addWire(p, s, [[G * 10, G * 0], [G * 10, G * 10]]); // vertical, ends at (10,10)
  assert.equal(preferredAxis(p, s, [G * 10, G * 10], [[G * 10, G * 10]]), 'v');
});

test('starting from a Pin leaves straight out of the part', () => {
  const p = newProject();
  const s = p.schematic.sheets[0];
  const h = placeSymbol(p, s, RESISTOR, [G * 20, G * 20]).sym;            // pins point left/right
  const v = placeSymbol(p, s, RESISTOR, [G * 40, G * 20], { rot: 90 }).sym; // pins point up/down
  assert.equal(preferredAxis(p, s, pinAt(p, h, '2'), [pinAt(p, h, '2')]), 'h');
  assert.equal(preferredAxis(p, s, pinAt(p, v, '1'), [pinAt(p, v, '1')]), 'v');
});

test('the preferred corner gives way when it would run through a Pin', () => {
  const p = newProject();
  const s = p.schematic.sheets[0];
  const c = placeSymbol(p, s, CAPACITOR, [G * 30, G * 10], { rot: 90 }).sym; // pins at (30,7) and (30,13)
  const from = [G * 10, G * 13], to = [G * 30, G * 7];
  // horizontal-first would run along y=13 into the lower Pin; go vertical first instead
  const r = routeWire(p, s, from, to, { axis: 'h' });
  assert.deepEqual(r, [[G * 10, G * 7], [G * 30, G * 7]]);
  void c;
});
