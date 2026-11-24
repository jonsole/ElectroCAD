// The documented file format (docs/formats/) matches what the app writes, and opening a file
// checks it against the same schema.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkSchema } from '../src/renderer/core/schema-check.js';
import { ECAD_SCHEMA } from '../src/renderer/core/ecad-schema.js';
import { sampleProject, readableIds } from './fixtures/sample-project.js';
import { newProject, serialize, deserialize, projectProblems, VERSION, ProjectFileError } from '../src/renderer/core/project.js';
import { buildNetlist } from '../src/renderer/core/netlist.js';

const doc = (name) => readFileSync(new URL(`../docs/formats/${name}`, import.meta.url), 'utf8');
const valid = (p) => assert.deepEqual(checkSchema(ECAD_SCHEMA, JSON.parse(serialize(p))), []);

test('the schema is for the current format version, and docs/formats/ecad.schema.json is a copy of it', () => {
  assert.equal(ECAD_SCHEMA.properties.version.const, VERSION);
  assert.deepEqual(JSON.parse(doc('ecad.schema.json')), ECAD_SCHEMA, 'regenerate it: node tools/write-format-example.js');
});

test('a new Project matches the schema', () => valid(newProject()));

test('a Project using every feature written today matches the schema', () => valid(sampleProject()));

test('the schema catches keys it does not describe, and wrong values', () => {
  const p = JSON.parse(serialize(sampleProject()));
  p.schematic.sheets[0].labels[0].colour = 'red';
  p.schematic.sheets[1].symbols[0].rot = 45;
  const errors = checkSchema(ECAD_SCHEMA, p);
  assert.ok(errors.some((e) => /"colour" is not described/.test(e)), errors.join('\n'));
  assert.ok(errors.some((e) => /rot: 45 is not one of/.test(e)), errors.join('\n'));
});

test('docs/formats/example.ecad is current: it opens, matches the schema and equals the sample', () => {
  const text = doc('example.ecad');
  const p = deserialize(text);
  assert.equal(text, serialize(readableIds(sampleProject())), 'regenerate it: node tools/write-format-example.js');
  assert.deepEqual(buildNetlist(p).nets.map((n) => n.name).sort(), ['+3V3', 'GND', 'LED_A']);
});

test('points and other short lists are written on one line', () => {
  const p = sampleProject();
  const text = serialize(p);
  assert.match(text, /"at": \[-?\d+, -?\d+\]/);
  assert.match(text, /"layers": \["F\.Cu", "F\.Paste", "F\.Mask"\]/);
  assert.deepEqual(JSON.parse(text), JSON.parse(JSON.stringify(p)), 'still plain JSON, same content');
  const plainLines = JSON.stringify(p, null, 1).split('\n').length, lines = text.split('\n').length;
  assert.ok(lines < plainLines * 0.7, `${lines} lines, against ${plainLines} with one value per line`);
});

test('opening a damaged file refuses it and says what is wrong, in plain words', () => {
  const p = JSON.parse(serialize(readableIds(sampleProject())));
  p.schematic.sheets[1].symbols[0].rot = 45;
  let err;
  try { deserialize(JSON.stringify(p)); } catch (e) { err = e; }
  assert.ok(err instanceof ProjectFileError);
  assert.match(err.message, /sheet "Indicator" symbol 1\.rot: 45 is not one of \[0,90,180,270\]/);
});

test('opening checks what the schema cannot: unique ids and refs, keys that point at something', () => {
  const base = () => JSON.parse(serialize(readableIds(sampleProject())));
  const problems = (edit) => { const p = base(); edit(p); return projectProblems(p).join('\n'); };
  assert.equal(problems(() => {}), '');
  assert.match(problems((p) => { p.components.c2.ref = p.components.c1.ref; }), /two components are called C1/);
  assert.match(problems((p) => { p.schematic.sheets[1].wires[0].id = 'c1'; }), /same id \(c1\)/);
  assert.match(problems((p) => { p.components.c2.footprint = { fpId: 'NOPE' }; }), /uses footprint NOPE, which its part doesn't have/);
  assert.match(problems((p) => { p.components.c3.footprint = { fpKey: 'User/Gone' }; }), /User\/Gone, which isn't in the file/);
  assert.match(problems((p) => { p.schematic.sheets[1].symbols[0].unit = 3; }), /unit 4, which its part doesn't have/);
  assert.match(problems((p) => { p.schematic.sheets[1].name = 'power'; }), /two sheets are called power/);
  assert.match(problems((p) => { p.fieldStyles.default = 'gone'; }), /default field style gone/);
  assert.match(problems((p) => { p.schematic.sheets[0].labels[0].scope = 'local'; }), /power symbol \+3V3 must be global/);
});

test('Parts are keyed by Library origin and table Footprints are stored once', () => {
  const p = sampleProject();
  assert.deepEqual(Object.keys(p.parts).sort(), ['builtin/capacitor@1', 'builtin/led@1', 'builtin/resistor@1']);
  assert.ok(Object.values(p.parts).every((x) => !('category' in x)), 'Library-only keys stay in the Library');
  const d1 = Object.values(p.components).find((c) => c.ref === 'D1');
  assert.deepEqual(d1.footprint, { fpKey: 'User/LED_1206' });
  assert.deepEqual(Object.keys(p.footprints), ['User/LED_1206']);
});
