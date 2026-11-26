// BOM and pick-and-place (#27): grouping, quoting, coordinates, side and rotation, board-only
// footprints, and golden files for both CSVs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newProject, addComponent, footprintRef } from '../src/renderer/core/project.js';
import { changeList, applyChanges } from '../src/renderer/core/annotate.js';
import { updateComponent } from '../src/renderer/core/components.js';
import { bomRows, bomCsv, placementRows, placementCsv, assemblyFiles } from '../src/renderer/core/assembly.js';
import { addBoardOnly, setBoardOnly } from '../src/renderer/core/boardOnly.js';
import { allFootprints, mountingHole, fiducial } from '../src/renderer/library/footprints.js';
import { STARTER_LIBRARY } from '../src/renderer/library/starter.js';
import { mm, SCH_GRID as G } from '../src/renderer/core/units.js';

const GOLDEN = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'assembly');
const part = (n) => STARTER_LIBRARY.find((p) => p.name === n);
const fpNamed = (n) => allFootprints().find((f) => f.name === n);

/** A board with grouped resistors, an MPN, a custom field, a comma in a value, a part on the back, and board-only footprints. */
function fixture() {
  const p = newProject('Assembly Test');
  const s = p.schematic.sheets[0];
  const at = (i) => [G * (10 + 10 * i), G * 10];
  const add = (name, i, patch = {}) => { const c = addComponent(p, s, part(name), at(i)).comp; updateComponent(p, c.id, patch); return c; };
  const r1 = add('Resistor', 0, { value: '10k' });
  const r2 = add('Resistor', 1, { value: '10k' });
  const r10 = add('Resistor', 2, { value: '10k', ref: 'R10' });
  const r3 = add('Resistor', 3, { value: '4k7' });
  const c1 = add('Capacitor', 4, { value: '100n, 50V', mpn: { manufacturer: 'Murata', number: 'GRM188R71H104KA93D' }, fields: { LCSC: 'C14663' } });
  const j1 = add('Resistor', 5, { value: 'HDR', ref: 'J1' });
  j1.footprint = footprintRef(p, { library: 'builtin', footprint: fpNamed('PinHeader_1x03_P2.54mm_Vertical') });
  void r1; void r2; void r10; void r3; void c1;
  applyChanges(p, changeList(p));
  const fp = (ref) => p.board.footprints.find((f) => p.components[f.componentId]?.ref === ref);
  fp('R1').at = [mm(10), mm(10)];
  fp('R2').at = [mm(12.5), mm(10)];
  fp('R3').at = [mm(15), mm(10)]; fp('R3').rot = 90;
  fp('R10').at = [mm(17.5), mm(10)];
  fp('C1').at = [mm(10), mm(15.25)]; fp('C1').rot = 45.5;
  fp('J1').at = [mm(20), mm(20)]; fp('J1').rot = 270; fp('J1').side = 'B';
  addBoardOnly(p, 'builtin', mountingHole('M3'), [mm(3), mm(3)]);            // H1: not in the BOM
  const f1 = addBoardOnly(p, 'builtin', fiducial(1), [mm(25), mm(3)]);       // FID1: in it
  setBoardOnly(p, f1.id, { bom: true, value: 'Fiducial' });
  return p;
}

test('BOM: identical parts grouped with sorted References; everything else its own row', () => {
  const rows = bomRows(fixture());
  const ten = rows.find((r) => r.value === '10k');
  assert.deepEqual([ten.quantity, ten.refs], [3, ['R1', 'R2', 'R10']], 'R10 after R2');
  assert.equal(rows.find((r) => r.value === '4k7').quantity, 1);
  const c1 = rows.find((r) => r.refs[0] === 'C1');
  assert.deepEqual([c1.mpn, c1.manufacturer, c1.fields.LCSC], ['GRM188R71H104KA93D', 'Murata', 'C14663']);
  assert.ok(rows.some((r) => r.refs[0] === 'FID1'), 'a board-only footprint in the BOM');
  assert.ok(!rows.some((r) => r.refs.includes('H1')), 'one that isn\'t, left out');
  // a different MPN splits a group
  const p = fixture();
  const r2 = Object.values(p.components).find((c) => c.ref === 'R2');
  updateComponent(p, r2.id, { mpn: { manufacturer: 'Yageo', number: 'RC0603FR-0710KL' } });
  assert.deepEqual(bomRows(p).filter((r) => r.value === '10k').map((r) => r.refs), [['R1', 'R10'], ['R2']]);
});

test('CSV: quoted where needed, a column per custom field', () => {
  const text = bomCsv(fixture());
  const lines = text.trim().split('\r\n');
  assert.equal(lines[0], 'Quantity,References,Value,Footprint,MPN,Manufacturer,Part,LCSC');
  assert.ok(lines.some((l) => l.startsWith('1,C1,"100n, 50V",')), 'a value with a comma is quoted');
  assert.ok(lines.some((l) => l.startsWith('3,"R1, R2, R10",10k,')));
  assert.ok(text.endsWith('\r\n'));
});

test('pick-and-place: mm in the Gerbers\' coordinates (Y up), rotation, side; board-only only when in the BOM', () => {
  const rows = placementRows(fixture());
  const by = (ref) => rows.find((r) => r.ref === ref);
  assert.deepEqual([by('R1').x, by('R1').y], [mm(10), -mm(10)], 'Y flipped as in the Gerbers');
  assert.equal(by('C1').rotation, 45.5);
  assert.deepEqual([by('J1').side, by('J1').rotation], ['Bottom', 270]);
  assert.equal(by('R1').side, 'Top');
  assert.ok(by('FID1') && !by('H1'));
  const lines = placementCsv(fixture()).trim().split('\r\n');
  assert.equal(lines[0], 'Designator,Value,Footprint,Mid X (mm),Mid Y (mm),Rotation,Side');
  assert.ok(lines.includes('R3,4k7,R_0805_2012Metric,15.0000,-10.0000,90.00,Top'), lines.join('\n'));
});

test('golden files: both CSVs from the fixture project', () => {
  const files = assemblyFiles(fixture());
  assert.deepEqual(files.map((f) => f.name), ['Assembly_Test-bom.csv', 'Assembly_Test-pnp.csv']);
  if (process.env.UPDATE_GOLDEN) { fs.mkdirSync(GOLDEN, { recursive: true }); for (const f of files) fs.writeFileSync(path.join(GOLDEN, f.name), f.text); }
  for (const f of files) assert.equal(f.text, fs.readFileSync(path.join(GOLDEN, f.name), 'utf8'), `${f.name} matches its golden file (UPDATE_GOLDEN=1 npm test to refresh after a deliberate change)`);
  assert.deepEqual(assemblyFiles(fixture(), { bom: false }).map((f) => f.kind), ['pnp']);
});
