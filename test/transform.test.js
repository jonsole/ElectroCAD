import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ViewTransform, gridSpacing, rulerStep, rulerLabel, MIN_SCALE, MAX_SCALE } from '../src/renderer/view/transform.js';
import { mm, mil, SCH_GRID } from '../src/renderer/core/units.js';

test('screen and world round-trip', () => {
  const v = new ViewTransform({ scale: 4 / 1e6, ox: 100, oy: 50 });
  assert.deepEqual(v.toScreen([mm(10), mm(5)]), [140, 70]);
  assert.deepEqual(v.toWorld([140, 70]), [mm(10), mm(5)]);
});

test('zoomAt keeps the world point under the cursor fixed', () => {
  const v = new ViewTransform({ scale: 4 / 1e6, ox: 13, oy: -7 });
  const before = v.toWorld([321, 123]);
  v.zoomAt(321, 123, 1.7);
  const after = v.toWorld([321, 123]);
  assert.ok(Math.abs(after[0] - before[0]) < 1e-6 && Math.abs(after[1] - before[1]) < 1e-6);
  assert.ok(Math.abs(v.scale - 6.8 / 1e6) < 1e-15);
});

test('zoom is clamped', () => {
  const v = new ViewTransform();
  v.zoomAt(0, 0, 1e9); assert.equal(v.scale, MAX_SCALE);
  v.zoomAt(0, 0, 1e-18); assert.equal(v.scale, MIN_SCALE);
});

test('pan moves the view in screen space', () => {
  const v = new ViewTransform({ scale: 1e-5 });
  v.pan(30, -20);
  assert.deepEqual(v.toScreen([0, 0]), [30, -20]);
});

test('fit centres a rectangle and fits it inside the margin', () => {
  const v = new ViewTransform();
  v.fit({ x0: 0, y0: 0, x1: mm(297), y1: mm(210) }, 1000, 800, 40);
  const [a, b] = [v.toScreen([0, 0]), v.toScreen([mm(297), mm(210)])];
  assert.ok(Math.abs((a[0] + b[0]) / 2 - 500) < 1e-6 && Math.abs((a[1] + b[1]) / 2 - 400) < 1e-6);
  assert.ok(Math.abs(b[0] - a[0] - 920) < 1e-6, 'width limited by the horizontal margin');
});

test('grid spacing starts at the snap grid and coarsens when lines get too close', () => {
  assert.deepEqual(gridSpacing(SCH_GRID, 10 / 1e6), { minor: SCH_GRID, major: SCH_GRID * 10 }); // 12.7 px apart
  assert.equal(gridSpacing(SCH_GRID, 2 / 1e6).minor, SCH_GRID * 5); // 2.54 px -> x5 = 12.7 px
  assert.equal(gridSpacing(mil(50), 0.05 / 1e6).minor % mil(50), 0); // always a multiple of the snap grid
});

test('ruler steps are 1/2/5 x 10^n mm and at least the minimum spacing apart', () => {
  for (const scale of [0.5e-6, 1e-6, 4e-6, 37e-6, 900e-6]) {
    const step = rulerStep(scale);
    assert.ok(step * scale >= 56, `spacing at ${scale}`);
    const mmStep = step / 1e6;
    const lead = mmStep / 10 ** Math.floor(Math.log10(mmStep) + 1e-9);
    assert.ok([1, 2, 5].some((m) => Math.abs(lead - m) < 1e-9), `nice step ${mmStep}`);
  }
  assert.equal(rulerLabel(mm(12.5)), '12.5');
  assert.equal(rulerLabel(100_000), '0.1');
});
