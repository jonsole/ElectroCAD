import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newLibrary, newPart, addUnit, removeUnit, addPin, nextPinNumber, pinDirToward, partProblems, savePart, renameLibrary, serializeLibrary, parseLibrary, slugId, LibraryError } from '../src/renderer/core/library.js';
import { newProject, serialize, deserialize } from '../src/renderer/core/project.js';
import { placeSymbol } from '../src/renderer/core/schematic.js';
import { arcCircle } from '../src/renderer/core/geom.js';
import { soic } from '../src/renderer/library/footprints.js';
import { SCH_GRID as G } from '../src/renderer/core/units.js';

const lib = () => newLibrary('My parts');
const sensor = (L) => {
  const p = newPart(L, 'Temp sensor');
  p.prefix = 'U';
  addPin(p, 0, [-6 * G, -2 * G]); addPin(p, 0, [-6 * G, 2 * G]); addPin(p, 0, [6 * G, 0]);
  return p;
};

test('ids come from names and stay unique', () => {
  assert.equal(slugId('My parts'), 'my-parts');
  assert.equal(slugId('My parts', ['my-parts']), 'my-parts-2');
  assert.equal(slugId('  Ünïcode / Ops!  '), 'unicode-ops');
  assert.equal(lib().id, 'my-parts');
});

test('Pins get the next free number and point into the body', () => {
  const p = newPart(lib(), 'X');
  assert.deepEqual(addPin(p, 0, [-6 * G, 0]), { number: '1', name: '~', at: [-6 * G, 0], dir: 'R', length: 2 * G, type: 'passive' });
  assert.equal(addPin(p, 0, [6 * G + 100, 0]).at[0], 6 * G, 'snapped to the grid');
  assert.equal(nextPinNumber(p), '3');
  assert.deepEqual([[-5, 0], [5, 0], [0, -5], [0, 5]].map((x) => pinDirToward(x)), ['R', 'L', 'D', 'U']);
});

test('validation: duplicate Pin numbers, Units without Pins, off-grid Pins, a bad prefix, missing Pads', () => {
  const L = lib();
  const p = sensor(L);
  assert.deepEqual(partProblems(p), []);
  addUnit(p);
  assert.deepEqual(p.units.map((u) => u.name), ['A', 'B']);
  assert.ok(partProblems(p).includes('Unit B has no pins.'));
  addPin(p, 1, [-6 * G, 0], { number: '2' });
  assert.ok(partProblems(p).some((x) => /Pin number 2 is used twice \(unit A and unit B\)/.test(x)), partProblems(p).join(' | '));
  p.units[1].pins[0].number = '4';
  p.units[1].pins[0].at = [-6 * G + 5, 0];
  assert.ok(partProblems(p).some((x) => /Pin 4 is off the 50 mil grid/.test(x)));
  p.units[1].pins[0].at = [-6 * G, 0];
  p.prefix = '1x';
  assert.ok(partProblems(p).some((x) => /prefix/.test(x)));
  p.prefix = 'U';
  p.footprints = { SOIC8: soic(8) };
  assert.deepEqual(partProblems(p), []);
  p.footprints = { SOIC8: { ...soic(8), pads: soic(8).pads.slice(0, 2) } };
  assert.ok(partProblems(p).some((x) => /no pad for pins 3, 4/.test(x)), partProblems(p).join(' | '));
  removeUnit(p, 1);
  assert.throws(() => removeUnit(p, 0), /at least one unit/);
});

test('saving: refused while broken; the version goes up only when the Part changed', () => {
  const L = lib();
  const p = newPart(L, 'Empty');
  assert.throws(() => savePart(L, p), (e) => e instanceof LibraryError && /has no pins/.test(e.message));
  const s = sensor(L);
  const v1 = savePart(L, s);
  assert.deepEqual(v1.origin, { library: 'my-parts', partId: 'temp-sensor', version: 1 });
  assert.equal(savePart(L, v1).origin.version, 1, 'unchanged: same version');
  const edited = structuredClone(v1); edited.defaultValue = 'TMP36';
  assert.equal(savePart(L, edited).origin.version, 2);
});

test('a Library round-trips, keeps its id when renamed, and refuses damaged files', () => {
  const L = lib();
  savePart(L, sensor(L));
  renameLibrary(L, 'Sensors');
  const back = parseLibrary(serializeLibrary(L));
  assert.equal(back.id, 'my-parts');
  assert.equal(back.name, 'Sensors');
  assert.equal(back.parts['temp-sensor'].units[0].pins.length, 3);
  assert.throws(() => parseLibrary('{'), /not valid JSON/);
  assert.throws(() => parseLibrary('{"format":"x"}'), /not an ElectroCAD library/);
  const bad = JSON.parse(serializeLibrary(L)); bad.parts['temp-sensor'].units[0].pins[0].dir = 'Q';
  assert.throws(() => parseLibrary(JSON.stringify(bad)), /damaged: part Temp sensor/);
  assert.throws(() => renameLibrary(L, ' '), /needs a name/);
});

test('placing a Part from a user Library records its Library origin; text and arcs save in Projects', () => {
  const L = lib();
  const s = sensor(L);
  s.units[0].graphics.push({ type: 'text', at: [0, 0], text: 'T', size: G }, { type: 'arc', start: [-G, -G], mid: [0, -2 * G], end: [G, -G] });
  const stored = savePart(L, s);
  const p = newProject();
  const { comp } = placeSymbol(p, p.schematic.sheets[0], stored, [0, 0]);
  assert.equal(comp.partId, 'my-parts/temp-sensor@1');
  assert.deepEqual(p.parts[comp.partId].origin, { library: 'my-parts', partId: 'temp-sensor', version: 1 });
  assert.ok(!('category' in p.parts[comp.partId]));
  assert.equal(deserialize(serialize(p)).parts[comp.partId].units[0].graphics.length, 3);
});

test('an arc is drawn through its three points', () => {
  const c = arcCircle([-10, 0], [0, -10], [10, 0]);
  assert.deepEqual(c.c.map(Math.round), [0, 0]);
  assert.equal(Math.round(c.r), 10);
  assert.equal(arcCircle([0, 0], [1, 1], [2, 2]), null, 'in line: no circle');
});
