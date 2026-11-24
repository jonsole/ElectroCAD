import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mm, mil, toMm, snap, snapPt, formatLength, SCH_GRID } from '../src/renderer/core/units.js';
import { rot90, place, onSegment, distToSegment2 } from '../src/renderer/core/geom.js';

test('units are exact integer nanometres', () => {
  assert.equal(mm(1), 1_000_000);
  assert.equal(mil(1), 25_400);
  assert.equal(SCH_GRID, 1_270_000);
  assert.equal(toMm(mm(2.54)), 2.54);
  assert.ok(Number.isInteger(mm(0.1)) && Number.isInteger(mil(0.5)));
});

test('snapping', () => {
  assert.equal(snap(1_900_000, SCH_GRID), SCH_GRID);
  assert.deepEqual(snapPt([700_000, -700_000], SCH_GRID), [SCH_GRID, -SCH_GRID]);
});

test('length formatting', () => {
  assert.equal(formatLength(mm(12.7)), '12.7 mm');
  assert.equal(formatLength(mil(50), 'mil'), '50 mil');
});

test('rot90 rotates counter-clockwise on screen (+Y down) and mirrors first', () => {
  assert.deepEqual(rot90([1, 0], 90), [0, -1]); // right -> up on screen
  assert.deepEqual(rot90([1, 0], 180), [-1, -0]);
  assert.deepEqual(rot90([1, 0], 270), [-0, 1]);
  assert.deepEqual(rot90([1, 0], 0, true), [-1, 0]);
  assert.deepEqual(rot90([1, 2], -90), rot90([1, 2], 270));
});

test('place applies rotation then translation', () => {
  assert.deepEqual(place([10, 0], [100, 100], 90, false), [100, 90]);
});

test('onSegment is exact for axis-aligned and diagonal segments', () => {
  assert.ok(onSegment([5, 0], [0, 0], [10, 0]));
  assert.ok(onSegment([0, 0], [0, 0], [10, 0]));
  assert.ok(!onSegment([11, 0], [0, 0], [10, 0]));
  assert.ok(onSegment([3, 3], [0, 0], [10, 10]));
  assert.ok(!onSegment([3, 4], [0, 0], [10, 10]));
});

test('distToSegment2 clamps to the segment ends', () => {
  assert.equal(distToSegment2([5, 3], [0, 0], [10, 0]), 9);
  assert.equal(distToSegment2([13, 4], [0, 0], [10, 0]), 25);
});
