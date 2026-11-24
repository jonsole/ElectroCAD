import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newProject, addComponent, footprintRef, nextRef, pinPositions, padForPin, footprintOf, pruneOrphans,
  serialize, deserialize, VERSION, FORMAT, ProjectFileError,
} from '../src/renderer/core/project.js';
import { mm, SCH_GRID } from '../src/renderer/core/units.js';

// A two-Unit Part: an op-amp section (A) and a power Unit (B), with one Preferred footprint
// whose Pin map is not the identity, so the tests can tell the two mappings apart.
const opamp = () => ({
  id: 'part-opamp', name: 'Dual op-amp', prefix: 'U', defaultValue: 'LM358',
  origin: { library: 'starter', partId: 'opamp-dual', version: 1 },
  units: [
    { name: 'A', graphics: [], pins: [
      { number: '1', name: 'OUT', at: [mm(7.62), 0], dir: 'L', length: mm(2.54), type: 'output' },
      { number: '2', name: '-', at: [-mm(7.62), -mm(2.54)], dir: 'R', length: mm(2.54), type: 'input' },
      { number: '3', name: '+', at: [-mm(7.62), mm(2.54)], dir: 'R', length: mm(2.54), type: 'input' },
    ] },
    { name: 'B', graphics: [], pins: [
      { number: '8', name: 'V+', at: [0, -mm(5.08)], dir: 'D', length: mm(2.54), type: 'power_in' },
      { number: '4', name: 'V-', at: [0, mm(5.08)], dir: 'U', length: mm(2.54), type: 'power_in' },
    ] },
  ],
  footprints: { 'SOIC-8': { name: 'SOIC-8', pads: [], graphics: [] } },
  pinMap: { 'SOIC-8': { 1: '1', 2: '2', 3: '3', 4: '4', 8: '8' } },
});
const resistor = () => ({
  id: 'part-r', name: 'Resistor', prefix: 'R', defaultValue: '10k',
  units: [{ name: 'A', graphics: [], pins: [
    { number: '1', name: '~', at: [-mm(3.81), 0], dir: 'R', length: mm(1.27), type: 'passive' },
    { number: '2', name: '~', at: [mm(3.81), 0], dir: 'L', length: mm(1.27), type: 'passive' },
  ] }],
  footprints: { R_0603: { name: 'R_0603', pads: [], graphics: [] }, R_0805: { name: 'R_0805', pads: [], graphics: [] } },
  pinMap: { R_0603: { 1: '2', 2: '1' }, R_0805: { 1: '1', 2: '2' } }, // 0603's map swapped on purpose
});

test('a new Project follows the v1 schema', () => {
  const p = newProject('Blinky');
  assert.equal(p.format, FORMAT);
  assert.equal(p.version, VERSION);
  assert.equal(p.name, 'Blinky');
  assert.deepEqual(p.parts, {});
  assert.deepEqual(p.components, {});
  assert.equal(p.schematic.sheets.length, 1);
  const s = p.schematic.sheets[0];
  for (const k of ['symbols', 'wires', 'labels', 'noConnects']) assert.deepEqual(s[k], [], k);
  assert.equal(p.board.stack.copper, 2);
  assert.equal(p.board.preset, 'generic');
  for (const k of ['outline', 'footprints', 'tracks', 'vias', 'zones']) assert.deepEqual(p.board[k], [], k);
  assert.ok(p.board.rules.annularRing > 0);
});

test('placing a Part embeds a frozen copy, allocates a Reference designator and uses the first Preferred footprint', () => {
  const p = newProject();
  const sheet = p.schematic.sheets[0];
  const part = resistor();
  const { comp, sym } = addComponent(p, sheet, part, [SCH_GRID * 10, SCH_GRID * 10]);
  assert.equal(comp.ref, 'R1');
  assert.equal(comp.value, '10k');
  assert.equal(comp.mpn, null);
  assert.deepEqual(comp.footprint, { fpId: 'R_0603' });
  assert.equal(sym.unit, 0);
  part.name = 'changed later in the library';
  assert.equal(p.parts['part-r'].name, 'Resistor', 'the Project keeps its own frozen copy');
  assert.equal(addComponent(p, sheet, resistor(), [0, 0]).comp.ref, 'R2');
});

test('a Footprint can be chosen at placement', () => {
  const p = newProject();
  const { comp } = addComponent(p, p.schematic.sheets[0], resistor(), [0, 0], { footprint: { fpId: 'R_0805' } });
  assert.deepEqual(comp.footprint, { fpId: 'R_0805' });
});

test('Units of a multi-Unit Part are placed on one Component', () => {
  const p = newProject();
  const sheet = p.schematic.sheets[0];
  const { comp, sym: a } = addComponent(p, sheet, opamp(), [0, 0]);
  const { comp: same, sym: b } = addComponent(p, sheet, opamp(), [mm(50), 0], { component: comp, unit: 1 });
  assert.equal(same, comp);
  assert.equal(comp.ref, 'U1');
  assert.deepEqual([a.unit, b.unit], [0, 1]);
  assert.equal(Object.keys(p.components).length, 1);
  assert.deepEqual(pinPositions(p, b).map((x) => x.pin.number), ['8', '4']);
});

test('Pins map to Pads through the Preferred footprint Pin map, or by number for any other Footprint', () => {
  const p = newProject();
  const { comp } = addComponent(p, p.schematic.sheets[0], resistor(), [0, 0]); // R_0603, swapped map
  assert.equal(padForPin(p, comp, '1'), '2');
  comp.footprint = { fpId: 'R_0805' };
  assert.equal(padForPin(p, comp, '1'), '1');
  comp.footprint = footprintRef(p, { library: 'mine', footprint: { name: 'R_Custom', pads: [], graphics: [] } });
  assert.deepEqual(comp.footprint, { fpKey: 'mine/R_Custom' }, 'stored once in the Project footprints table');
  assert.equal(padForPin(p, comp, '2'), '2', 'identity Pin map for a non-preferred Footprint');
  assert.equal(footprintOf(p, comp).name, 'R_Custom');
});

test('pin positions follow the Symbol transform', () => {
  const p = newProject();
  const { sym } = addComponent(p, p.schematic.sheets[0], resistor(), [mm(100), mm(50)], { rot: 90 });
  const pts = pinPositions(p, sym).map((x) => x.at);
  assert.deepEqual(pts, [[mm(100), mm(50) + mm(3.81)], [mm(100), mm(50) - mm(3.81)]]);
});

test('nextRef skips used designators', () => {
  const p = newProject();
  p.components.a = { ref: 'R1' }; p.components.b = { ref: 'R3' };
  assert.equal(nextRef(p, 'R'), 'R2');
});

test('pruneOrphans removes Components with no placed Units and Parts nobody uses', () => {
  const p = newProject();
  const sheet = p.schematic.sheets[0];
  addComponent(p, sheet, resistor(), [0, 0]);
  addComponent(p, sheet, opamp(), [0, 0]);
  sheet.symbols = sheet.symbols.filter((s) => p.components[s.componentId].ref !== 'U1');
  pruneOrphans(p);
  assert.deepEqual(Object.values(p.components).map((c) => c.ref), ['R1']);
  assert.deepEqual(Object.keys(p.parts), ['part-r']);
});

test('save and reopen gives an identical Project', () => {
  const p = newProject('Round trip');
  const sheet = p.schematic.sheets[0];
  const { comp } = addComponent(p, sheet, opamp(), [mm(20), mm(20)]);
  addComponent(p, sheet, opamp(), [mm(60), mm(20)], { component: comp, unit: 1 });
  comp.mpn = { manufacturer: 'TI', number: 'LM358DR' };
  sheet.wires.push({ id: 'w1', a: [0, 0], b: [mm(10), 0] });
  sheet.labels.push({ id: 'l1', at: [mm(10), 0], rot: 0, net: 'VCC', scope: 'global', style: 'power' });
  sheet.noConnects.push({ id: 'n1', at: [mm(5), mm(5)] });
  p.board.vias.push({ id: 'v1', at: [mm(3), mm(4)], drill: mm(0.3), diameter: mm(0.6), from: 'F.Cu', to: 'B.Cu', net: 'VCC' });
  const text = serialize(p);
  const back = deserialize(text);
  assert.deepEqual(back, p);
  assert.equal(serialize(back), text, 'saving again produces the same file');
});

test('a file from a newer version is refused with a clear message', () => {
  const p = newProject();
  p.version = VERSION + 1;
  assert.throws(() => deserialize(serialize(p)), (err) => err instanceof ProjectFileError && /newer version/i.test(err.message));
});

test('files that are not ElectroCAD Projects are refused', () => {
  assert.throws(() => deserialize('not json'), ProjectFileError);
  assert.throws(() => deserialize('{"format":"kicad"}'), (e) => e instanceof ProjectFileError && /not an ElectroCAD project/i.test(e.message));
  const broken = newProject(); delete broken.schematic;
  assert.throws(() => deserialize(JSON.stringify(broken)), (e) => e instanceof ProjectFileError && /schematic/i.test(e.message));
});
