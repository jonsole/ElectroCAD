import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mm } from '../src/renderer/core/units.js';
import { shapeHandles, hitHandle, dragHandle, arcWithEnds, dragOutlineHandle } from '../src/renderer/core/handles.js';
import { rectOutline, polygonOutline, checkOutline, outlineBounds } from '../src/renderer/core/board.js';

const rect = { type: 'rect', a: [0, 0], b: [mm(10), mm(6)] };

test('handles: rectangles have corners and sides; circles four; arcs three; lines their points', () => {
  assert.equal(shapeHandles(rect).length, 8);
  assert.deepEqual(shapeHandles(rect).find((h) => h.key === 'e').at, [mm(10), mm(3)]);
  assert.equal(shapeHandles({ type: 'circle', c: [0, 0], r: 5 }).length, 4);
  assert.deepEqual(shapeHandles({ type: 'arc', start: [0, 0], mid: [1, 1], end: [2, 0] }).map((h) => h.key), ['start', 'mid', 'end']);
  assert.deepEqual(shapeHandles({ type: 'line', pts: [[0, 0], [4, 0], [4, 4]] }).map((h) => h.key), ['p0', 'p1', 'p2']);
  assert.deepEqual(shapeHandles({ type: 'line', pts: [[0, 0], [4, 0]] }).map((h) => h.key), ['p0', 'p1', 'side']);
  assert.deepEqual(shapeHandles({ type: 'text', at: [0, 0] }), []);
  assert.equal(hitHandle(rect, [mm(10.1), mm(5.9)], mm(0.2)).key, 'se');
  assert.equal(hitHandle(rect, [mm(5), mm(5)], mm(0.2)), null);
});

test('dragging rectangle handles resizes; past the opposite side it flips', () => {
  assert.deepEqual(dragHandle(rect, 'e', [mm(15), mm(99)]), { ...rect, b: [mm(15), mm(6)] });
  assert.deepEqual(dragHandle(rect, 'nw', [mm(2), mm(1)]), { ...rect, a: [mm(2), mm(1)] });
  const flipped = dragHandle(rect, 'w', [mm(12), 0]);
  assert.deepEqual([flipped.a, flipped.b], [[mm(10), 0], [mm(12), mm(6)]]);
});

test('circle radius, line points and the side handle', () => {
  assert.equal(dragHandle({ type: 'circle', c: [0, 0], r: 5 }, 'r1', [0, mm(3)]).r, mm(3));
  assert.deepEqual(dragHandle({ type: 'line', pts: [[0, 0], [10, 0], [10, 10]] }, 'p1', [20, 0]).pts, [[0, 0], [20, 0], [10, 10]]);
  // the side handle moves a line square to itself only
  assert.deepEqual(dragHandle({ type: 'line', pts: [[0, 0], [100, 0]] }, 'side', [70, 30]).pts, [[0, 30], [100, 30]]);
});

test('moving an arc end keeps its shape; the middle handle bends it', () => {
  const a = { type: 'arc', start: [0, mm(10)], mid: [mm(5), 0], end: [mm(10), mm(10)] }; // a half-ish bulge upward
  const b = arcWithEnds(a, [0, mm(10)], [mm(20), mm(10)]);
  assert.deepEqual(b.mid, [mm(10), mm(-10)]); // twice as wide, twice as tall
  assert.deepEqual(dragHandle(a, 'mid', [mm(5), mm(2)]).mid, [mm(5), mm(2)]);
});

test('Outline: dragging a corner drags the neighbouring end; the loop stays closed', () => {
  const tri = polygonOutline([0, 0], [{ to: [mm(10), 0] }, { to: [mm(10), mm(10)] }, { to: [0, 0] }]);
  const out = dragOutlineHandle(tri, 0, 'p1', [mm(12), 0]);
  assert.deepEqual(out[0].pts[1], [mm(12), 0]);
  assert.deepEqual(out[1].pts[0], [mm(12), 0]);
  assert.ok(checkOutline(out).closed);
  assert.deepEqual(tri[0].pts[1], [mm(10), 0]); // the original is untouched
});

test('Outline: dragging a rounded rectangle\'s side resizes it and keeps the corners round', () => {
  const rr = rectOutline([0, 0], [mm(40), mm(30)], mm(3));
  const right = rr.findIndex((s) => s.type === 'line' && s.pts[0][0] === mm(40) && s.pts[1][0] === mm(40));
  const out = dragOutlineHandle(rr, right, 'side', [mm(50), mm(15)]);
  assert.ok(checkOutline(out).closed, checkOutline(out).problems.join());
  assert.deepEqual(outlineBounds(out), { x0: 0, y0: 0, x1: mm(50), y1: mm(30) });
  // the corners are moved, not reshaped
  const arcs = out.filter((s) => s.type === 'arc');
  const before = rr.filter((s) => s.type === 'arc');
  const moved = arcs.filter((s, i) => s.start[0] !== before[i].start[0]);
  assert.equal(moved.length, 2);
  for (const s of moved) { const i = arcs.indexOf(s); assert.equal(s.start[0] - before[i].start[0], mm(10)); assert.equal(s.mid[0] - before[i].mid[0], mm(10)); }
});

test('Outline: rectangles and circles resize on their own', () => {
  const out = dragOutlineHandle(rectOutline([0, 0], [mm(10), mm(10)]), 0, 'se', [mm(20), mm(5)]);
  assert.deepEqual(out[0].b, [mm(20), mm(5)]);
});

test('polygons (Symbol graphics) have a handle per point', () => {
  const tri = { type: 'poly', pts: [[0, 0], [10, 0], [5, 8]], fill: 'outline' };
  assert.deepEqual(shapeHandles(tri).map((h) => h.key), ['p0', 'p1', 'p2']);
  assert.deepEqual(dragHandle(tri, 'p2', [5, 12]).pts[2], [5, 12]);
});
