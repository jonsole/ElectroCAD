import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newProject, addComponent, serialize, deserialize, ProjectFileError, VERSION } from '../src/renderer/core/project.js';
import { projectMeta, sortNewestFirst, importProject, duplicateProject, exportFileName, hasBoardContent, describeMeta } from '../src/renderer/core/store.js';

const part = { id: 'p-r', name: 'Resistor', prefix: 'R', defaultValue: '10k', origin: null,
  units: [{ name: 'A', graphics: [], pins: [] }], footprints: {}, pinMap: {} };

test('card metadata counts Components and copper layers', () => {
  const p = newProject('Blinky');
  addComponent(p, p.schematic.sheets[0], part, [0, 0]);
  addComponent(p, p.schematic.sheets[0], part, [0, 0]);
  p.board.stack.copper = 4;
  const meta = projectMeta(p, { modified: 1234, thumb: 'data:image/png;base64,xx' });
  assert.deepEqual(meta, { id: p.id, name: 'Blinky', modified: 1234, components: 2, layers: 4, thumb: 'data:image/png;base64,xx' });
  assert.equal(describeMeta(meta), '2 components · 4-layer');
  assert.equal(describeMeta({ ...meta, components: 1, layers: 2 }), '1 component · 2-layer');
});

test('projects list newest first, then by name', () => {
  const list = [{ id: 'a', name: 'B', modified: 1 }, { id: 'b', name: 'A', modified: 3 }, { id: 'c', name: 'C', modified: 3 }];
  assert.deepEqual(sortNewestFirst(list).map((m) => m.id), ['b', 'c', 'a']);
});

test('importing a file keeps its id unless the store already has it', () => {
  const p = newProject('From disk');
  const text = serialize(p);
  assert.equal(importProject(text, new Set()).id, p.id);
  const again = importProject(text, new Set([p.id]));
  assert.notEqual(again.id, p.id);
  assert.equal(again.name, 'From disk');
});

test('importing refuses newer and damaged files with the project-file error', () => {
  const p = newProject(); p.version = VERSION + 1;
  assert.throws(() => importProject(serialize(p), new Set()), ProjectFileError);
  assert.throws(() => importProject('{}', new Set()), ProjectFileError);
});

test('duplicating makes a separate Project with a copy name', () => {
  const p = newProject('Amp');
  addComponent(p, p.schematic.sheets[0], part, [0, 0]);
  const d = duplicateProject(p, ['Amp', 'Amp (copy)']);
  assert.notEqual(d.id, p.id);
  assert.equal(d.name, 'Amp (copy 2)');
  assert.deepEqual(d.components, p.components);
  d.components[Object.keys(d.components)[0]].value = '1k';
  assert.equal(Object.values(p.components)[0].value, '10k', 'the copy does not share objects with the original');
  assert.equal(deserialize(serialize(d)).name, 'Amp (copy 2)');
});

test('export file names are safe and end in .ecad', () => {
  assert.equal(exportFileName({ name: 'My: board/v2?' }), 'My- board-v2-.ecad');
  assert.equal(exportFileName({ name: '' }), 'Untitled.ecad');
});

test('the Board is used for thumbnails once it has an Outline or Footprints', () => {
  const p = newProject();
  assert.equal(hasBoardContent(p), false);
  p.board.outline.push({ type: 'rect' });
  assert.equal(hasBoardContent(p), true);
});
