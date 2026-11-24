import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newProject, addComponent, pinPositions, newSheet } from '../src/renderer/core/project.js';
import { addWire, addLabel } from '../src/renderer/core/schematic.js';
import { changeList, applyChanges } from '../src/renderer/core/annotate.js';
import { probeFromSchematic, probeFromBoard, schematicTargets, boardTargets, sheetForProbe, probeIsEmpty } from '../src/renderer/core/probe.js';
import { STARTER_LIBRARY } from '../src/renderer/library/starter.js';
import { SCH_GRID as G } from '../src/renderer/core/units.js';

const part = (n) => STARTER_LIBRARY.find((p) => p.name === n);

function setup() {
  const p = newProject('X');
  const s = p.schematic.sheets[0];
  const r1 = addComponent(p, s, part('Resistor'), [G * 10, G * 10]).comp;
  const r2 = addComponent(p, s, part('Resistor'), [G * 30, G * 10]).comp;
  const pin = (c, n) => pinPositions(p, s.symbols.find((y) => y.componentId === c.id)).find((x) => x.pin.number === n).at;
  addWire(p, s, [pin(r1, '2'), pin(r2, '1')]);
  addLabel(p, s, { at: pin(r1, '2'), net: 'Mid', scope: 'local', style: 'label' });
  applyChanges(p, changeList(p));
  return { p, s, r1, r2 };
}

test('a Symbol probes its Footprint, and a Footprint its Symbol', () => {
  const { p, s, r1 } = setup();
  const sym = s.symbols.find((y) => y.componentId === r1.id);
  const probe = probeFromSchematic(p, s, [sym.id]);
  assert.deepEqual([...probe.components], [r1.id]);
  const t = boardTargets(p, probe);
  assert.deepEqual([...t.footprints], [p.board.footprints.find((f) => f.componentId === r1.id).id]);
  const back = probeFromBoard(p, [...t.footprints]);
  assert.deepEqual([...schematicTargets(p, s, back)], [sym.id]);
});

test('a Wire or label probes its Net: the Net\'s Pads and copper on the Board, its Wires on the Schematic', () => {
  const { p, s, r1, r2 } = setup();
  const probe = probeFromSchematic(p, s, [s.wires[0].id]);
  assert.deepEqual([...probe.nets], ['mid']);
  p.board.tracks.push({ id: 'tk', a: [0, 0], b: [1, 0], width: 1, layer: 'F.Cu', net: 'MID' });
  const t = boardTargets(p, probe);
  assert.deepEqual([...t.pads].sort(), [`${r1.id}:2`, `${r2.id}:1`].sort());
  assert.deepEqual([...t.copper], ['tk']);
  // from the Board: a pad's net lights the Wire and the label
  const ids = schematicTargets(p, s, probeFromBoard(p, [], ['Mid']));
  assert.ok(ids.has(s.wires[0].id) && ids.has(s.labels[0].id));
  // the label alone probes the same Net
  assert.deepEqual([...probeFromSchematic(p, s, [s.labels[0].id]).nets], ['mid']);
  assert.ok(probeIsEmpty(probeFromSchematic(p, s, [])));
});

test('the Sheet that shows a probe', () => {
  const { p, r1 } = setup();
  const s2 = newSheet('Two');
  p.schematic.sheets.push(s2);
  assert.equal(sheetForProbe(p, probeFromBoard(p, [p.board.footprints.find((f) => f.componentId === r1.id).id]))?.name, 'Sheet 1');
});
