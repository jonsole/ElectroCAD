import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newProject, addComponent, pinPositions, footprintOf } from '../src/renderer/core/project.js';
import { addWire } from '../src/renderer/core/schematic.js';
import { changeList, applyChanges, isEmpty } from '../src/renderer/core/annotate.js';
import { placedPads, moveFootprints, rotateFootprints, flipFootprints, setLocked, hitFootprint, normRot, setFootprintRotation } from '../src/renderer/core/footprint.js';
import { updateComponent } from '../src/renderer/core/components.js';
import { ratsnest } from '../src/renderer/core/ratsnest.js';
import { STARTER_LIBRARY } from '../src/renderer/library/starter.js';
import { mm, SCH_GRID as G } from '../src/renderer/core/units.js';
import { pinHeader, chip } from '../src/renderer/library/footprints.js';

const part = (n) => STARTER_LIBRARY.find((p) => p.name === n);

/** R1, R2, R3 with pin 1 of each wired together (one Net with three Pads), annotated onto the Board. */
function setup() {
  const p = newProject('F');
  const s = p.schematic.sheets[0];
  const rs = [10, 20, 30].map((x) => addComponent(p, s, part('Resistor'), [G * x, G * 10], { rot: 90 }).comp);
  const pin = (c, n) => { const y = s.symbols.find((q) => q.componentId === c.id); return pinPositions(p, y).find((x) => x.pin.number === n).at; };
  addWire(p, s, [pin(rs[0], '1'), pin(rs[1], '1')]);
  addWire(p, s, [pin(rs[1], '1'), pin(rs[2], '1')]);
  applyChanges(p, changeList(p));
  return { p, rs };
}
const fpOf = (p, c) => p.board.footprints.find((f) => f.componentId === c.id);

test('Ratsnest: a minimum spanning tree over a Net with several Pads', () => {
  const { p, rs } = setup();
  // put the three Footprints in a row, 10 mm apart: the tree is two airwires of ~10 mm, not the 20 mm one
  rs.forEach((c, i) => { fpOf(p, c).at = [mm(10 * i), 0]; });
  const { wires, unrouted } = ratsnest(p);
  const net = Object.keys(unrouted).find((n) => unrouted[n] === 2);
  assert.ok(net, JSON.stringify(unrouted));
  const ws = wires.filter((w) => w.net === net);
  assert.equal(ws.length, 2);
  for (const w of ws) assert.ok(Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) < mm(11));
  // a track joining two of the Pads leaves one airwire on that Net
  const pads = rs.map((c) => placedPads(p, fpOf(p, c)).find((x) => x.number === '1'));
  p.board.tracks.push({ id: 't', a: pads[0].at, b: pads[1].at, width: mm(0.25), layer: 'F.Cu', net });
  assert.equal(ratsnest(p).unrouted[net], 1);
  // a track on the other side doesn't touch SMD pads on the front
  p.board.tracks[0].layer = 'B.Cu';
  assert.equal(ratsnest(p).unrouted[net], 2);
});

test('move, rotate (90° and any angle), flip and lock', () => {
  const { p, rs } = setup();
  const f = fpOf(p, rs[0]);
  const at = [...f.at];
  moveFootprints(p, [f.id], [mm(1), 0]);
  assert.deepEqual(f.at, [at[0] + mm(1), at[1]]);
  rotateFootprints(p, [f.id], 90);
  assert.equal(f.rot, 90);
  setFootprintRotation(p, f.id, 372.456);
  assert.equal(f.rot, 12.46);
  assert.equal(normRot(-90), 270);
  setLocked(p, [f.id], true);
  moveFootprints(p, [f.id], [mm(5), 0]);
  rotateFootprints(p, [f.id], 90);
  flipFootprints(p, [f.id]);
  assert.equal(f.rot, 12.46);
  assert.equal(f.side, 'F');
  setLocked(p, [f.id], false);
  // two turned together keep their spacing
  const g = fpOf(p, rs[1]);
  f.rot = 0; f.at = [0, 0]; g.at = [mm(10), 0];
  rotateFootprints(p, [f.id, g.id], 90);
  assert.deepEqual([f.at, g.at], [[mm(5), mm(5)], [mm(5), mm(-5)]]);
});

test('flipping puts pads on the back layers, mirrored', () => {
  const { p, rs } = setup();
  const f = fpOf(p, rs[0]);
  f.at = [0, 0]; f.rot = 0;
  const front = placedPads(p, f);
  assert.ok(front.every((x) => x.layers.includes('F.Cu')));
  flipFootprints(p, [f.id]);
  const back = placedPads(p, f);
  assert.ok(back.every((x) => x.layers.includes('B.Cu') && x.layers.includes('B.Paste') && !x.layers.includes('F.Cu')));
  const one = (ps) => ps.find((x) => x.number === '1').at[0];
  assert.equal(one(back), -one(front)); // mirrored left-right
  assert.equal(hitFootprint(p, [0, 0])?.id, f.id);
});

test('a Footprint swap keeps placement and updates Pads and their Nets', () => {
  const { p, rs } = setup();
  const c = rs[0], f = fpOf(p, c);
  f.at = [mm(3), mm(4)]; f.rot = 45; f.side = 'B';
  const netBefore = placedPads(p, f).find((x) => x.number === '1').net;
  assert.ok(netBefore);
  updateComponent(p, c.id, { footprint: { library: 'builtin', footprint: pinHeader(1, 2) } });
  assert.match(footprintOf(p, c).name, /PinHeader_1x02/);
  assert.deepEqual([f.at, f.rot, f.side], [[mm(3), mm(4)], 45, 'B']);
  const after = placedPads(p, f);
  assert.ok(after[0].drill > 0);
  assert.equal(after.find((x) => x.number === '1').net, netBefore);
  assert.ok(isEmpty(changeList(p)), JSON.stringify(changeList(p).changes));
  void chip;
});
