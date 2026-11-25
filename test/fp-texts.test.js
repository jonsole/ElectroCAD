// A placed Footprint's own Reference / Value text (#65): overrides in the Footprint's frame that
// move, turn and flip with it, used by the silk Gerbers; Eagle's smashed NAME / VALUE imported.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newProject, addComponent, footprintRef, serialize, deserialize } from '../src/renderer/core/project.js';
import { changeList, applyChanges } from '../src/renderer/core/annotate.js';
import { rectOutline } from '../src/renderer/core/board.js';
import { moveFootprints, rotateFootprints, flipFootprints, fpTransform } from '../src/renderer/core/footprint.js';
import { fabFiles } from '../src/renderer/core/fab.js';
import { checkSchema } from '../src/renderer/core/schema-check.js';
import { ECAD_SCHEMA } from '../src/renderer/core/ecad-schema.js';
import { fieldDefault, fieldPlacement, placedFieldTexts, setFieldOverride, fpInverse, worldRot, localRot, fieldStrings } from '../src/renderer/core/fpTexts.js';
import { importEagle } from '../src/renderer/io/eagle/index.js';
import { STARTER_LIBRARY } from '../src/renderer/library/starter.js';
import { mm, SCH_GRID as G } from '../src/renderer/core/units.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const part = (n) => STARTER_LIBRARY.find((p) => p.name === n);

function board() {
  const p = newProject('Texts');
  const s = p.schematic.sheets[0];
  const c = addComponent(p, s, part('Resistor'), [G * 10, G * 10]).comp;
  // a footprint with its own ${REF} text on the silk
  c.footprint = footprintRef(p, { library: 'user', footprint: { name: 'R_own', pads: [
    { number: '1', at: [-mm(1), 0], size: [mm(1), mm(1)], shape: 'rect', layers: ['F.Cu', 'F.Mask'] },
    { number: '2', at: [mm(1), 0], size: [mm(1), mm(1)], shape: 'rect', layers: ['F.Cu', 'F.Mask'] }],
    graphics: [{ type: 'text', layer: 'F.SilkS', at: [0, -mm(1.5)], text: '${REF}', size: mm(1) }, { type: 'rect', layer: 'F.CrtYd', a: [-mm(2), -mm(1)], b: [mm(2), mm(1)] }] } });
  applyChanges(p, changeList(p));
  p.board.outline = rectOutline([0, 0], [mm(40), mm(30)]);
  const bf = p.board.footprints[0];
  bf.at = [mm(20), mm(15)];
  return { p, bf, ref: c.ref };
}

test('defaults: the Footprint\'s own text, else the automatic ones; world <-> footprint frame', () => {
  const { p, bf } = board();
  const fp = p.footprints[Object.keys(p.footprints)[0]].footprint;
  assert.deepEqual(fieldDefault(fp, 'ref'), { at: [0, -mm(1.5)], rot: 0, size: mm(1), layer: 'F.SilkS', own: true });
  const v = fieldDefault(fp, 'value');
  assert.equal(v.own, false); assert.equal(v.layer, 'F.Fab'); assert.deepEqual(v.at, [0, mm(1) + 600_000]);
  for (const f of [{ ...bf, rot: 0 }, { ...bf, rot: 37 }, { ...bf, rot: 90, side: 'B' }, { ...bf, rot: 200, side: 'B' }]) {
    const T = fpTransform(f), I = fpInverse(f);
    for (const q of [[mm(1), mm(2)], [-mm(3), mm(0.5)]]) { const b = I(T(q)); assert.ok(Math.abs(b[0] - q[0]) <= 1 && Math.abs(b[1] - q[1]) <= 1, JSON.stringify([f.rot, f.side, q, b])); }
    for (const r of [0, 90, 15]) assert.ok(Math.abs(((worldRot(f, localRot(f, r)) - r) % 360 + 360) % 360) < 0.02);
  }
});

test('an override moves, turns and flips with its Footprint; reset puts it back', () => {
  const { p, bf } = board();
  setFieldOverride(p, bf.id, 'ref', { at: [mm(3), 0] });
  assert.deepEqual(bf.texts.ref, { at: [mm(3), 0], rot: 0, size: mm(1), layer: 'F.SilkS' });
  const here = () => placedFieldTexts(p, bf, fieldStrings(p, bf))[0];
  assert.deepEqual(here().at, [mm(23), mm(15)]);
  moveFootprints(p, [bf.id], [mm(1), mm(1)]);
  assert.deepEqual(here().at, [mm(24), mm(16)]);
  rotateFootprints(p, [bf.id], 90);
  assert.deepEqual(here().at, [mm(21), mm(13)]); assert.equal(here().rot, 90, 'turns with it');
  flipFootprints(p, [bf.id]);
  assert.equal(here().layer, 'B.SilkS', 'on the back');
  assert.equal(here().rot, 270, 'mirrored');
  setFieldOverride(p, bf.id, 'value', { hidden: true });
  assert.equal(placedFieldTexts(p, bf, fieldStrings(p, bf)).find((d) => d.key === 'value').hidden, true);
  setFieldOverride(p, bf.id, 'ref', null); setFieldOverride(p, bf.id, 'value', null);
  assert.equal(bf.texts, undefined, 'reset leaves nothing behind');
  assert.equal(fieldPlacement(p.footprints[Object.keys(p.footprints)[0]].footprint, bf, 'ref').overridden, false);
});

test('the silk Gerber draws the override in place of the Footprint\'s own text, and nothing when hidden', () => {
  const { p, bf } = board();
  const gto = () => fabFiles(p, { date: 'd', version: 'v' }).find((f) => f.name.endsWith('.GTO')).text;
  const xs = (t) => [...t.matchAll(/X(-?\d+)Y(-?\d+)D0[12]/g)].map((m) => +m[1] / 1e6);
  const before = xs(gto());
  assert.ok(before.length && Math.max(...before) < 23, 'R1 drawn round x = 20 mm');
  setFieldOverride(p, bf.id, 'ref', { at: [mm(10), 0] });
  const moved = xs(gto());
  assert.ok(moved.some((x) => x > 29) && !moved.some((x) => x > 21.5 && x < 28), 'R1 now at x = 30 mm, not at 20');
  setFieldOverride(p, bf.id, 'ref', { hidden: true });
  assert.ok(!xs(gto()).some((x) => x > 21.5), 'hidden');
  assert.deepEqual(checkSchema(ECAD_SCHEMA, JSON.parse(serialize(p))), []);
  assert.deepEqual(deserialize(serialize(p)).board.footprints[0].texts, bf.texts);
});

test('Eagle: smashed NAME / VALUE become the footprints\' own text, display="off" hidden; instance attributes pin fields', () => {
  const dir = path.join(here, 'fixtures', 'eagle');
  let brd = fs.readFileSync(path.join(dir, 'regulator.brd'), 'utf8');
  brd = brd.replace('<element name="R1" library="rcl" package="R0805" value="330" x="10" y="30"/>',
    '<element name="R1" library="rcl" package="R0805" value="330" x="10" y="30" smashed="yes">\n<attribute name="NAME" x="12" y="33" size="1.27" layer="25"/>\n<attribute name="VALUE" x="12" y="27" size="1.27" layer="27" display="off"/>\n</element>');
  let sch = fs.readFileSync(path.join(dir, 'regulator.sch'), 'utf8');
  sch = sch.replace('<instance part="R1" gate="G$1" x="50.8" y="76.2"/>', '<instance part="R1" gate="G$1" x="50.8" y="76.2" smashed="yes">\n<attribute name="NAME" x="45.72" y="81.28" size="1.778" layer="95"/>\n</instance>');
  const { project, report } = importEagle({ sch, brd, name: 'reg' });
  const comp = Object.values(project.components).find((c) => c.ref === 'R1');
  const bf = project.board.footprints.find((f) => f.componentId === comp.id);
  assert.equal(bf.texts.value.hidden, true);
  // R2 is smashed with its NAME deleted: Eagle shows no Reference
  const brd2 = brd.replace('<element name="R2" library="rcl" package="0207/10" value="10k" x="40" y="30" rot="R90"/>', '<element name="R2" library="rcl" package="0207/10" value="10k" x="40" y="30" rot="R90" smashed="yes">\n<attribute name="VALUE" x="41" y="28" size="1.27" layer="27"/>\n</element>');
  const p2 = importEagle({ sch, brd: brd2, name: 'reg' }).project;
  const r2 = p2.board.footprints.find((f) => p2.components[f.componentId].ref === 'R2');
  assert.equal(r2.texts.ref.hidden, true); assert.ok(!r2.texts.value.hidden);
  const d = placedFieldTexts(project, bf, fieldStrings(project, bf)).find((x) => x.key === 'ref');
  // anchored bottom-left at (12, 33): the centre is up and to the right of it
  assert.ok(d.at[0] > mm(12) && d.at[0] < mm(14) && d.at[1] < -mm(33) && d.at[1] > -mm(34.2), JSON.stringify(d.at));
  assert.equal(d.layer, 'F.SilkS'); assert.equal(d.rot, 0);
  const sym = project.schematic.sheets.flatMap((s) => s.symbols).find((y) => y.componentId === comp.id);
  assert.ok(sym.fieldPins?.reference, 'the moved NAME is a pinned field');
  assert.ok(report.some((x) => /smashed/.test(x)), report.join('\n'));
});
