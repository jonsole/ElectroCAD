// Board-only Footprints (#74): a mounting hole or fiducial on the Board with no Schematic part.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newProject, addComponent, pinPositions, serialize, deserialize, projectProblems, nextRef, pruneOrphans } from '../src/renderer/core/project.js';
import { addWire } from '../src/renderer/core/schematic.js';
import { changeList, applyChanges } from '../src/renderer/core/annotate.js';
import { placedPads, padNets, bfFootprint, bfRef, isBoardOnly } from '../src/renderer/core/footprint.js';
import { addBoardOnly, setBoardOnly, deleteBoardOnly, refPrefix, refProblem } from '../src/renderer/core/boardOnly.js';
import { mountingHole, fiducial, allFootprints } from '../src/renderer/library/footprints.js';
import { rectOutline } from '../src/renderer/core/board.js';
import { runDrc } from '../src/renderer/core/drc.js';
import { newZone, zoneInput, fillZones } from '../src/renderer/core/zones.js';
import { ratsnest } from '../src/renderer/core/ratsnest.js';
import { importEagle } from '../src/renderer/io/eagle/index.js';
import { STARTER_LIBRARY } from '../src/renderer/library/starter.js';
import { mm, SCH_GRID as G } from '../src/renderer/core/units.js';

const part = (n) => STARTER_LIBRARY.find((p) => p.name === n);
function board() {
  const p = newProject('B');
  const s = p.schematic.sheets[0];
  const r1 = addComponent(p, s, part('Resistor'), [G * 10, G * 10]).comp;
  addComponent(p, s, part('Resistor'), [G * 30, G * 10]);
  const pin = (c, n) => pinPositions(p, s.symbols.find((y) => y.componentId === c.id)).find((x) => x.pin.number === n).at;
  addWire(p, s, [pin(r1, '1'), [G * 10 - G * 4, G * 10]]);
  p.schematic.sheets[0].labels.push({ id: 'g', at: [G * 10 - G * 4, G * 10], rot: 0, net: 'GND', scope: 'global', style: 'gnd' });
  applyChanges(p, changeList(p));
  p.board.outline = rectOutline([0, 0], [mm(40), mm(30)]);
  p.board.footprints[0].at = [mm(10), mm(10)]; p.board.footprints[1].at = [mm(10), mm(20)];
  return p;
}

test('the library has mounting holes and fiducials; References are suggested from the footprint', () => {
  const names = allFootprints().map((f) => f.name);
  for (const n of ['MountingHole_3.2mm_M3', 'MountingHole_3.2mm_M3_Pad', 'MountingHole_2.2mm_M2', 'Fiducial_1mm']) assert.ok(names.includes(n), n);
  assert.deepEqual(mountingHole('M3').pads[0].layers, ['*.Mask'], 'plain: no copper');
  assert.equal(mountingHole('M3', true).pads[0].drill, mm(3.2));
  assert.equal(mountingHole('M3').graphics[0].type, 'circle', 'a round courtyard');
  assert.deepEqual([refPrefix('MountingHole_3.2mm_M3'), refPrefix('Fiducial_1mm'), refPrefix('LOGO_ACME'), refPrefix('DRILEGEND'), refPrefix('Thing')], ['H', 'FID', 'LOGO', 'LEG', 'M']);
});

test('placing: its own Reference and footprint; References are unique across parts and the Board', () => {
  const p = board();
  const h1 = addBoardOnly(p, 'builtin', mountingHole('M3', true), [mm(30), mm(5)]);
  const h2 = addBoardOnly(p, 'builtin', mountingHole('M3', true), [mm(35), mm(5)]);
  const f1 = addBoardOnly(p, 'builtin', fiducial(1), [mm(30), mm(25)]);
  assert.deepEqual([h1.ref, h2.ref, f1.ref], ['H1', 'H2', 'FID1']);
  assert.ok(isBoardOnly(h1) && !h1.componentId);
  assert.equal(bfFootprint(p, h1).name, 'MountingHole_3.2mm_M3_Pad');
  assert.equal(bfRef(p, h1), 'H1');
  assert.equal(nextRef(p, 'H'), 'H3');
  assert.match(refProblem(p, h2.id, 'H1'), /already on the Board/);
  assert.match(refProblem(p, h2.id, 'R1'), /part on the Schematic/);
  assert.throws(() => setBoardOnly(p, h2.id, { ref: 'h1' }), /already on the Board/);
  setBoardOnly(p, h2.id, { ref: 'MH2', value: 'M3', bom: true });
  assert.deepEqual([h2.ref, h2.value, h2.bom], ['MH2', 'M3', true]);
  setBoardOnly(p, h2.id, { value: '', bom: false });
  assert.ok(!('value' in h2) && !('bom' in h2), 'In BOM is off by default, and cleared');
  // the footprint table keeps its entry while a board-only footprint uses it
  pruneOrphans(p);
  assert.ok(p.footprints[h1.fpKey]);
  // saved and opened: sound
  const back = deserialize(serialize(p));
  assert.deepEqual(projectProblems(JSON.parse(serialize(back))), []);
  assert.equal(back.board.footprints.filter((f) => !f.componentId).length, 3);
  deleteBoardOnly(p, [h1.id, p.board.footprints[0].id]);
  assert.ok(!p.board.footprints.some((f) => f.id === h1.id));
  assert.equal(p.board.footprints.filter((f) => f.componentId).length, 2, 'a Schematic part\'s footprint isn\'t deleted this way');
});

test('Update from Schematic leaves board-only footprints alone', () => {
  const p = board();
  const h = addBoardOnly(p, 'builtin', mountingHole('M3'), [mm(30), mm(5)]);
  const list = changeList(p);
  assert.ok(!list.changes.some((c) => c.componentId === h.id || c.ref === 'H1'), JSON.stringify(list.changes));
  // remove a part from the Schematic: its footprint goes, the hole stays
  p.schematic.sheets[0].symbols.splice(1, 1);
  pruneOrphans(p);
  applyChanges(p, changeList(p));
  assert.ok(p.board.footprints.some((f) => f.id === h.id));
  assert.equal(p.board.footprints.filter((f) => f.componentId).length, 1);
});

test('pad nets: a plated mounting hole on GND joins the GND net and a GND zone connects to it', () => {
  const p = board();
  const h = addBoardOnly(p, 'builtin', mountingHole('M3', true), [mm(30), mm(15)]);
  setBoardOnly(p, h.id, { padNet: ['1', 'GND'] });
  assert.equal(padNets(p.board).get(`${h.id}:1`), 'GND');
  assert.equal(placedPads(p, h).find((q) => q.number === '1').net, 'GND');
  assert.ok(ratsnest(p).wires.some((w) => w.net === 'GND'), 'unrouted to R1 on GND');
  const z = newZone('F.Cu', 'GND', [[0, 0], [mm(40), 0], [mm(40), mm(30)], [0, mm(30)]]);
  p.board.zones.push(z);
  const fills = fillZones(zoneInput(p));
  const th = fills.get(z.id).thermals.find((t) => t.key === `${h.id}:1`);
  assert.ok(th && th.spokes >= 2, 'thermal spokes to the hole');
  assert.ok(!ratsnest(p, p.board, fills).wires.some((w) => w.net === 'GND'), 'the zone joins them');
  setBoardOnly(p, h.id, { padNet: ['1', ''] });
  assert.ok(!('padNets' in h));
});

test('DRC checks them: clearance from another net, and courtyard overlaps', () => {
  const p = board();
  const h = addBoardOnly(p, 'builtin', mountingHole('M3', true), [mm(30), mm(15)]);
  p.board.tracks.push({ id: 't', a: [mm(30) + mm(3.05), mm(10)], b: [mm(30) + mm(3.05), mm(20)], width: mm(0.25), layer: 'F.Cu', net: 'SIG' });
  const v = runDrc(p).filter((x) => x.rule === 'clearance');
  assert.ok(v.some((x) => /H1/.test(x.message)), v.map((x) => x.message));
  h.at = [mm(10), mm(10)]; // on R1
  assert.ok(runDrc(p).some((x) => x.rule === 'courtyard' && /H1/.test(x.message)));
});

test('Eagle: an element with no Schematic part comes over as a board-only footprint, its pads on their signals\' nets', () => {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'eagle');
  const SCH = fs.readFileSync(path.join(dir, 'regulator.sch'), 'utf8');
  const BRD = fs.readFileSync(path.join(dir, 'regulator.brd'), 'utf8')
    .replace('<element name="R1" library="rcl" package="R0805" value="330" x="10" y="30"/>', '<element name="R1" library="rcl" package="R0805" value="330" x="10" y="30"/><element name="MH1" library="rcl" package="R0805" value="SPACER" x="40" y="5" rot="R90"/>')
    .replace('<signal name="GND">\n<contactref element="U1" pad="2"/>', '<signal name="GND">\n<contactref element="MH1" pad="1"/><contactref element="U1" pad="2"/>');
  const { project, report, check } = importEagle({ sch: SCH, brd: BRD, name: 'reg' });
  const mh = project.board.footprints.find((f) => f.ref === 'MH1');
  assert.ok(mh && !mh.componentId);
  assert.equal(mh.value, 'SPACER');
  assert.equal(mh.rot, 90);
  assert.ok(project.footprints[mh.fpKey]);
  assert.deepEqual(mh.padNets, { 1: 'GND' });
  assert.ok(report.some((r) => /board-only footprints: MH1/.test(r)));
  assert.ok(!report.some((r) => /left off/.test(r)));
  assert.ok(check.schematic.ok && !check.signals.length, JSON.stringify(check));
  assert.deepEqual(projectProblems(JSON.parse(serialize(project))), []);
});
