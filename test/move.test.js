import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newProject, pinPositions } from '../src/renderer/core/project.js';
import { placeSymbol, addWire, moveSelection, copySelection, pasteClip, itemsInRect } from '../src/renderer/core/schematic.js';
import { buildNetlist } from '../src/renderer/core/netlist.js';
import { RESISTOR, CAPACITOR } from '../src/renderer/library/mini.js';
import { SCH_GRID as G } from '../src/renderer/core/units.js';

const pinAt = (p, sym, n) => pinPositions(p, sym).find((x) => x.pin.number === n).at;
const sig = (p) => JSON.stringify(buildNetlist(p).nets.map((n) => n.pins.map((x) => `${x.ref}.${x.pin}`).sort()).sort());
const orthogonal = (s) => s.wires.every((w) => w.a[0] === w.b[0] || w.a[1] === w.b[1]);
const noZero = (s) => s.wires.every((w) => w.a[0] !== w.b[0] || w.a[1] !== w.b[1]);

function seriesStraight() {
  const p = newProject();
  const s = p.schematic.sheets[0];
  const r1 = placeSymbol(p, s, RESISTOR, [G * 10, G * 10]).sym;
  const r2 = placeSymbol(p, s, RESISTOR, [G * 30, G * 10]).sym;
  addWire(p, s, [pinAt(p, r1, '2'), pinAt(p, r2, '1')]);
  return { p, s, r1, r2 };
}

test('moving a part sideways stretches the wire and keeps the Netlist', () => {
  const { p, s, r2 } = seriesStraight();
  const before = sig(p);
  moveSelection(p, s, [r2.id], [G * 5, 0]);
  assert.equal(sig(p), before);
  assert.ok(orthogonal(s) && noZero(s));
  assert.equal(s.wires.length, 1, 'still one straight run');
});

test('moving a part off the line adds a corner instead of going diagonal', () => {
  const { p, s, r2 } = seriesStraight();
  const before = sig(p);
  moveSelection(p, s, [r2.id], [G * 2, G * 6]);
  assert.equal(sig(p), before);
  assert.ok(orthogonal(s) && noZero(s), JSON.stringify(s.wires));
  assert.equal(s.wires.length, 2);
});

test('an L-shaped wire keeps its shape: the corner slides with the part', () => {
  const p = newProject();
  const s = p.schematic.sheets[0];
  const r1 = placeSymbol(p, s, RESISTOR, [G * 10, G * 10]).sym;
  const c1 = placeSymbol(p, s, CAPACITOR, [G * 30, G * 25], { rot: 90 }).sym; // upper Pin is pin 2
  const a = pinAt(p, r1, '2'), b = pinAt(p, c1, '2');
  addWire(p, s, [a, [b[0], a[1]], b]); // right, then down
  const before = sig(p);
  moveSelection(p, s, [r1.id], [0, G * 3]); // move R1 down 3: the horizontal run moves down with it
  assert.equal(sig(p), before);
  assert.ok(orthogonal(s) && noZero(s), JSON.stringify(s.wires));
  assert.equal(s.wires.length, 2, 'still an L: no extra corner');
  const horiz = s.wires.find((w) => w.a[1] === w.b[1]);
  assert.equal(horiz.a[1], a[1] + G * 3);
});

test('moving both parts and the wire between them moves everything together', () => {
  const { p, s, r1, r2 } = seriesStraight();
  const before = JSON.stringify(s.wires.map((w) => [w.a, w.b]));
  moveSelection(p, s, [r1.id, r2.id], [G * 4, G * 4]);
  const after = JSON.stringify(s.wires.map((w) => [w.a.map((v) => v - G * 4), w.b.map((v) => v - G * 4)]));
  assert.equal(after, before);
});

test('dragging a selected wire segment drags its neighbours along', () => {
  const p = newProject();
  const s = p.schematic.sheets[0];
  const r1 = placeSymbol(p, s, RESISTOR, [G * 10, G * 10]).sym;
  const r2 = placeSymbol(p, s, RESISTOR, [G * 40, G * 20]).sym;
  const a = pinAt(p, r1, '2'), b = pinAt(p, r2, '1');
  addWire(p, s, [a, [G * 25, a[1]], [G * 25, b[1]], b]); // right, down, right
  const mid = s.wires.find((w) => w.a[0] === w.b[0]); // the vertical middle run
  const before = sig(p);
  moveSelection(p, s, [mid.id], [G * 3, 0]);
  assert.equal(sig(p), before);
  assert.ok(orthogonal(s) && noZero(s), JSON.stringify(s.wires));
  assert.equal(s.wires.find((w) => w.a[0] === w.b[0]).a[0], G * 28);
});

test('copy and paste makes new Components with new Reference designators and keeps internal wires', () => {
  const { p, s, r1, r2 } = seriesStraight();
  const clip = copySelection(p, s, [r1.id, r2.id, s.wires[0].id]);
  const pasted = pasteClip(p, s, clip, [0, G * 10]);
  const refs = Object.values(p.components).map((c) => c.ref).sort();
  assert.deepEqual(refs, ['R1', 'R2', 'R3', 'R4']);
  assert.equal(s.wires.length, 2);
  assert.equal(pasted.length, 3);
  const nets = buildNetlist(p).nets.map((n) => n.pins.map((x) => `${x.ref}.${x.pin}`).sort().join());
  assert.deepEqual(nets.sort(), ['R1.2,R2.1', 'R3.2,R4.1']);
  // values and footprints come along
  const r3 = Object.values(p.components).find((c) => c.ref === 'R3');
  assert.equal(r3.value, '10k');
  assert.deepEqual(r3.footprint, { fpId: 'R_0805' });
});

test('box select: window needs the whole item inside, crossing just touching', () => {
  const { p, s, r1, r2 } = seriesStraight();
  const left = { x0: G * 4, y0: G * 7, x1: G * 16, y1: G * 13 }; // contains R1 and part of the wire
  assert.deepEqual(itemsInRect(p, s, left, 'window'), [r1.id]);
  const crossing = itemsInRect(p, s, left, 'crossing');
  assert.ok(crossing.includes(r1.id) && crossing.includes(s.wires[0].id) && !crossing.includes(r2.id));
});

test('a T-join onto a stretched wire stays connected', () => {
  const { p, s, r2 } = seriesStraight();
  const c1 = placeSymbol(p, s, CAPACITOR, [G * 20, G * 20], { rot: 90 }).sym;
  const top = pinAt(p, c1, '2');
  addWire(p, s, [top, [top[0], G * 10]]); // ends mid-wire on the R1-R2 run
  const before = sig(p);
  for (const d of [[G * 2, G * 6], [G * 5, 0], [-G * 3, G * 2], [0, -G * 4]]) {
    moveSelection(p, s, [r2.id], d);
    assert.equal(sig(p), before, `after moving R2 by ${d}`);
    assert.ok(orthogonal(s) && noZero(s), JSON.stringify(s.wires));
  }
});

test('a wire T-joined onto a moving wire follows it', () => {
  const { p, s, r1, r2 } = seriesStraight();
  const c1 = placeSymbol(p, s, CAPACITOR, [G * 20, G * 20], { rot: 90 }).sym;
  const top = pinAt(p, c1, '2');
  addWire(p, s, [top, [top[0], G * 10]]);
  const before = sig(p);
  moveSelection(p, s, [r1.id, r2.id, s.wires[0].id], [0, -G * 3]); // lift the whole series pair and its wire
  assert.equal(sig(p), before);
  assert.ok(orthogonal(s) && noZero(s), JSON.stringify(s.wires));
});

// ---------------------------------------------------------------- tidying wires after a drag
import { cleanupWires } from '../src/renderer/core/schematic.js';

test('two straight runs meeting end to end become one', () => {
  const { p, s } = seriesStraight();
  const w = s.wires[0];
  const mid = [(w.a[0] + w.b[0]) / 2, w.a[1]];
  s.wires = [{ id: 'w1', a: w.a, b: mid }, { id: 'w2', a: mid, b: w.b }];
  const before = sig(p);
  assert.ok(cleanupWires(p, s));
  assert.equal(s.wires.length, 1);
  assert.equal(sig(p), before);
});

test('overlapping runs on the same line (a hidden segment) become one covering both', () => {
  const { p, s } = seriesStraight();
  const w = s.wires[0];
  s.wires.push({ id: 'hidden', a: [w.a[0] + G, w.a[1]], b: [w.a[0] + G * 3, w.a[1]] }); // lies on top of w
  s.wires.push({ id: 'back', a: [w.b[0], w.b[1]], b: [w.b[0] - G * 2, w.b[1]] });       // doubles back over w
  const before = sig(p);
  cleanupWires(p, s);
  assert.equal(s.wires.length, 1);
  assert.equal(sig(p), before);
});

test('runs are not joined where something else connects', () => {
  const { p, s, r1 } = seriesStraight();
  const w = s.wires[0];
  const mid = [(w.a[0] + w.b[0]) / 2, w.a[1]];
  s.wires = [{ id: 'w1', a: w.a, b: mid }, { id: 'w2', a: mid, b: w.b }, { id: 'w3', a: mid, b: [mid[0], mid[1] + G * 5] }]; // a T at mid
  cleanupWires(p, s);
  assert.equal(s.wires.length, 3, 'the T stays: three ends meet there');
  // a Pin at the meeting point also stops the join
  const q = newProject();
  const t = q.schematic.sheets[0];
  const r = placeSymbol(q, t, RESISTOR, [G * 20, G * 20], { rot: 90 }).sym;
  const pp = pinAt(q, r, '1');
  t.wires = [{ id: 'a', a: [pp[0] - G * 4, pp[1]], b: pp }, { id: 'b', a: pp, b: [pp[0] + G * 4, pp[1]] }];
  cleanupWires(q, t);
  assert.equal(t.wires.length, 2);
  void r1;
});

test('a drag that leaves overlapping runs is tidied with the Netlist unchanged', () => {
  const p = newProject();
  const s = p.schematic.sheets[0];
  const r1 = placeSymbol(p, s, RESISTOR, [G * 10, G * 10]).sym;
  const r2 = placeSymbol(p, s, RESISTOR, [G * 40, G * 20]).sym;
  const a = pinAt(p, r1, '2'), b = pinAt(p, r2, '1');
  addWire(p, s, [a, [G * 25, a[1]], [G * 25, b[1]], b]); // right, down, right
  const before = sig(p);
  moveSelection(p, s, [r2.id], [0, -G * 10]); // R2 up level with R1: the middle run collapses
  cleanupWires(p, s);
  assert.equal(sig(p), before);
  assert.ok(orthogonal(s) && noZero(s));
  assert.equal(s.wires.length, 1, JSON.stringify(s.wires));
});
