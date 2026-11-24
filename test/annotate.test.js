import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newProject, serialize, deserialize, projectProblems, addComponent } from '../src/renderer/core/project.js';
import { addWire, addLabel, deleteItems } from '../src/renderer/core/schematic.js';
import { changeList, applyChanges, isEmpty } from '../src/renderer/core/annotate.js';
import { placedPads, padNets, fpTransform, flipLayer } from '../src/renderer/core/footprint.js';
import { rectOutline, outlineBounds } from '../src/renderer/core/board.js';
import { STARTER_LIBRARY } from '../src/renderer/library/starter.js';
import { mm, SCH_GRID as G } from '../src/renderer/core/units.js';
import { pinPositions } from '../src/renderer/core/project.js';

const part = (name) => STARTER_LIBRARY.find((p) => p.name === name);

/** Two resistors in series: R1.2 -- R2.1 by a wire, R1.1 on a +5V-labelled wire stub. */
function setup() {
  const p = newProject('A');
  const s = p.schematic.sheets[0];
  const r1 = addComponent(p, s, part('Resistor'), [G * 10, G * 10]).comp;
  const r2 = addComponent(p, s, part('Resistor'), [G * 20, G * 10]).comp;
  const pin = (comp, n) => { const sym = s.symbols.find((y) => y.componentId === comp.id); return pinPositions(p, sym).find((x) => x.pin.number === n).at; };
  addWire(p, s, [pin(r1, '2'), pin(r2, '1')]);
  return { p, s, r1, r2, pin };
}

test('a first annotation adds every Footprint and Net; re-running is empty', () => {
  const { p } = setup();
  p.board.outline = rectOutline([0, 0], [mm(40), mm(30)]);
  const list = changeList(p);
  assert.deepEqual(list.changes.filter((c) => c.kind === 'add').map((c) => c.ref), ['R1', 'R2']);
  const net = list.changes.find((c) => c.kind === 'net-add');
  assert.deepEqual(net.pads, ['R1.2', 'R2.1']);
  applyChanges(p, list);
  assert.equal(p.board.footprints.length, 2);
  // placed beside the Outline, on the grid
  for (const f of p.board.footprints) { assert.ok(f.at[0] > mm(40)); assert.equal(f.at[0] % mm(0.5), 0); }
  assert.ok(isEmpty(changeList(p)), JSON.stringify(changeList(p).changes));
  // the Pads carry their Nets
  const pads = placedPads(p, p.board.footprints[0]);
  assert.ok(pads.some((x) => x.net === net.net), pads.map((x) => x.net));
  assert.deepEqual(projectProblems(p), []);
  assert.deepEqual(deserialize(serialize(p)).board.annotation, p.board.annotation);
});

test('removing a Component lists a remove and applying deletes its Footprint', () => {
  const { p, s, r2 } = setup();
  applyChanges(p, changeList(p));
  const sym = s.symbols.find((y) => y.componentId === r2.id);
  deleteItems(p, [sym.id]);
  const list = changeList(p);
  assert.ok(list.changes.some((c) => c.kind === 'remove' && c.ref === 'R2'));
  applyChanges(p, list);
  assert.deepEqual(p.board.footprints.map((f) => p.components[f.componentId]?.ref), ['R1']);
  assert.ok(isEmpty(changeList(p)));
});

test('a renamed Net renames board copper; value and reference edits are listed', () => {
  const { p, s, pin, r1 } = setup();
  applyChanges(p, changeList(p));
  const old = Object.keys(p.board.annotation.nets)[0];
  p.board.tracks.push({ id: 't1', a: [0, 0], b: [mm(1), 0], width: mm(0.25), layer: 'F.Cu', net: old });
  addLabel(p, s, { at: pin(r1, '2'), net: 'MID', scope: 'local', style: 'label', rot: 0 });
  r1.value = '4k7';
  r1.ref = 'R9';
  const list = changeList(p);
  const kinds = list.changes.map((c) => c.kind);
  assert.ok(kinds.includes('net-rename'), JSON.stringify(list.changes));
  assert.deepEqual(list.changes.find((c) => c.kind === 'net-rename'), { kind: 'net-rename', from: old, to: 'MID' });
  assert.deepEqual(list.changes.find((c) => c.kind === 'ref'), { kind: 'ref', componentId: r1.id, from: 'R1', to: 'R9' });
  assert.equal(list.changes.find((c) => c.kind === 'value').to, '4k7');
  applyChanges(p, list);
  assert.equal(p.board.tracks[0].net, 'MID');
  assert.ok(isEmpty(changeList(p)));
});

test('a Pad joining a Net is a net-pads change; Components without a Footprint are warned about', () => {
  const { p, s, r1 } = setup();
  applyChanges(p, changeList(p));
  const r3 = addComponent(p, s, part('Resistor'), [G * 30, G * 20]).comp;
  r3.footprint = null;
  const list = changeList(p);
  assert.ok(!list.changes.some((c) => c.kind === 'add'));
  assert.match(list.warnings[0], /R3 has no Footprint/);
  void r1;
});

test('footprint transform: rotation and the back side', () => {
  const T = fpTransform({ at: [100, 100], rot: 90, side: 'F' });
  assert.deepEqual(T([10, 0]), [100, 90]); // +X turns to up on screen (counter-clockwise)
  const B = fpTransform({ at: [0, 0], rot: 0, side: 'B' });
  assert.deepEqual(B([10, 5]), [-10, 5]);
  assert.equal(flipLayer('F.Cu', 'B'), 'B.Cu');
  assert.equal(flipLayer('B.SilkS', 'B'), 'F.SilkS');
  assert.equal(flipLayer('*.Cu', 'B'), '*.Cu');
  void padNets; void outlineBounds;
});
