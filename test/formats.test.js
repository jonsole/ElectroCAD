// The documented file formats (docs/formats/) match what the app writes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkSchema } from './fixtures/schema-check.js';
import { sampleProject, readableIds } from './fixtures/sample-project.js';
import { newProject, serialize, deserialize, VERSION } from '../src/renderer/core/project.js';
import { buildNetlist } from '../src/renderer/core/netlist.js';

const schema = JSON.parse(readFileSync(new URL('../docs/formats/ecad.schema.json', import.meta.url), 'utf8'));
const valid = (p) => assert.deepEqual(checkSchema(schema, JSON.parse(serialize(p))), []);

test('the schema is for the current format version', () => {
  assert.equal(schema.properties.version.const, VERSION);
});

test('a new Project matches the schema', () => valid(newProject()));

test('a Project using every feature written today matches the schema', () => valid(sampleProject()));

test('the schema catches keys it does not describe, and wrong values', () => {
  const p = JSON.parse(serialize(sampleProject()));
  p.schematic.sheets[0].labels[0].colour = 'red';
  p.schematic.sheets[1].symbols[0].rot = 45;
  const errors = checkSchema(schema, p);
  assert.ok(errors.some((e) => /"colour" is not described/.test(e)), errors.join('\n'));
  assert.ok(errors.some((e) => /rot: 45 is not one of/.test(e)), errors.join('\n'));
});

test('docs/formats/example.ecad is current: it opens, matches the schema and equals the sample', () => {
  const text = readFileSync(new URL('../docs/formats/example.ecad', import.meta.url), 'utf8');
  const p = deserialize(text);
  assert.deepEqual(checkSchema(schema, p), []);
  assert.equal(text, serialize(readableIds(sampleProject())), 'regenerate it: node tools/write-format-example.js');
  assert.deepEqual(buildNetlist(p).nets.map((n) => n.name).sort(), ['+3V3', 'GND', 'LED_A']);
});
