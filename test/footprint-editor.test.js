import { test } from 'node:test';
import assert from 'node:assert/strict';
import { footprintProblems, saveFootprint, newLibrary, newFootprint, parseLibrary, serializeLibrary, libraryFootprints, LIBRARY_VERSION } from '../src/renderer/core/library.js';
import { GENERATORS, generatorDefaults, generatorById } from '../src/renderer/library/generators.js';
import { soic, sot223 } from '../src/renderer/library/footprints.js';
import { mm } from '../src/renderer/core/units.js';

const pad = (number, x, extra = {}) => ({ number, at: [mm(x), 0], shape: 'rect', size: [mm(1), mm(1)], layers: ['F.Cu', 'F.Paste', 'F.Mask'], ...extra });

test('footprint validation: duplicate pad numbers and a missing courtyard are warnings', () => {
  const fp = { name: 'X', pads: [pad('1', -1), pad('1', 1)], graphics: [] };
  const r = footprintProblems(fp);
  assert.deepEqual(r.errors, []);
  assert.match(r.warnings.join(), /Pad number 1 is used more than once/);
  assert.match(r.warnings.join(), /no courtyard/);
  // the built-in SOT-223 joins its tab to pin 2 on purpose: still saveable
  assert.deepEqual(footprintProblems(sot223()).errors, []);
  assert.equal(footprintProblems(soic(8)).warnings.length, 0);
});

test('footprint validation: errors stop a save', () => {
  assert.match(footprintProblems(newFootprint('Empty')).errors.join(), /no pads/);
  const tht = { name: 'T', pads: [pad('1', 0, { layers: ['*.Cu', '*.Mask'] })], graphics: [] };
  assert.match(footprintProblems(tht).errors.join(), /needs a drill/);
  tht.pads[0].drill = mm(1.2);
  assert.match(footprintProblems(tht).errors.join(), /drill is as big as the pad/);
  assert.match(footprintProblems({ name: '', pads: [pad('', 0)], graphics: [] }).errors.join(), /needs a name.*no number|no number.*needs a name|needs a name/);
  const lib = newLibrary('Mine');
  assert.throws(() => saveFootprint(lib, newFootprint('Empty')), /can't be saved/);
});

test('footprints save into a Library and read back; version 1 Libraries read with none', () => {
  const lib = newLibrary('Mine');
  const id = saveFootprint(lib, soic(8));
  assert.equal(id, 'soic-8-3-9x4-9mm-p1-27mm');
  assert.equal(saveFootprint(lib, soic(8)), 'soic-8-3-9x4-9mm-p1-27mm-2'); // a second copy gets its own id
  saveFootprint(lib, { ...soic(8), name: 'Changed' }, id);
  const back = parseLibrary(serializeLibrary(lib));
  assert.equal(back.version, LIBRARY_VERSION);
  assert.equal(back.footprints[id].name, 'Changed');
  assert.equal(libraryFootprints([back]).length, 2);
  const v1 = JSON.stringify({ format: 'electrocad-library', version: 1, id: 'old', name: 'Old', parts: {} });
  assert.deepEqual(parseLibrary(v1).footprints, {});
});

test('generators make valid footprints, with a live preview from their defaults', () => {
  for (const g of GENERATORS) {
    const fp = g.make(generatorDefaults(g));
    const r = footprintProblems(fp);
    assert.deepEqual(r.errors, [], `${g.id}: ${r.errors}`);
    assert.deepEqual(r.warnings, [], `${g.id}: ${r.warnings}`);
    assert.ok(fp.graphics.some((x) => x.layer === 'F.SilkS') && fp.graphics.some((x) => x.text === '${REF}'), g.id);
  }
  // SOIC-n with pitch, pad size and body width; the default matches the built-in SOIC-8
  const s = generatorById('soic');
  const s8 = s.make(generatorDefaults(s));
  assert.equal(s8.pads.length, 8);
  assert.deepEqual(s8.pads.map((p) => p.at), soic(8).pads.map((p) => p.at));
  const s14 = s.make({ ...generatorDefaults(s), n: 14, pitch: 0.65 });
  assert.equal(s14.pads.length, 14);
  assert.equal(s14.pads[1].at[1] - s14.pads[0].at[1], mm(0.65));
  // headers 1xN and 2xN; chips by size
  const h = generatorById('header');
  assert.equal(h.make({ ...generatorDefaults(h), rows: '2', n: 5 }).pads.length, 10);
  const c = generatorById('chip');
  const c0805 = c.make({ ...generatorDefaults(c), ...c.presets({ size: '0805' }), size: '0805' });
  assert.equal(c0805.name, 'R_0805_2012Metric');
  assert.equal(c0805.pads[1].at[0] - c0805.pads[0].at[0], mm(1.825));
});
