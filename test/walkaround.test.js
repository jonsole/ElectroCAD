import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newProject } from '../src/renderer/core/project.js';
import { CopperIndex, padShape } from '../src/renderer/core/collision.js';
import { startRoute, step, click, commit } from '../src/renderer/core/router.js';
import { Obstacles, walkPath, outlineSegments } from '../src/renderer/core/walkaround.js';
import { rectOutline } from '../src/renderer/core/board.js';
import { mm } from '../src/renderer/core/units.js';

const pad = (id, at, size, net = 'GND') => ({ kind: 'pad', id, net, layers: new Set(['F.Cu', 'B.Cu']), shape: padShape({ at, size, shape: 'rect', rot: 0 }) });
const track = (id, a, b, w, net = 'GND') => ({ kind: 'track', id, net, layers: new Set(['F.Cu']), shape: { type: 'capsule', a, b, r: w / 2 } });

/** Every segment of the proposal is clear of every other-Net item by its clearance. */
function assertLegal(project, index, view, net) {
  for (const s of view.segments) assert.equal(index.collisions(project.board, { type: 'capsule', a: s.a, b: s.b, r: view.state.width / 2 }, s.layer, net).length, 0, `segment ${s.a} → ${s.b} collides`);
  assert.equal(view.collisions.length, 0);
}
const length = (segs) => segs.reduce((n, s) => n + Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]), 0);

test('walkaround goes round a pad of another Net, clear of it, and reaches the cursor', () => {
  const p = newProject('W');
  const index = new CopperIndex([pad('p1', [mm(5), 0], [mm(2), mm(2)])]);
  const st = startRoute(p, [0, 0], 'F.Cu', 'SIG');
  const free = step(p, st, [mm(10), 0], 'free', index);
  assert.ok(free.collisions.length);                                // straight through the pad
  const v = step(p, st, [mm(10), 0], 'walkaround', index);
  assert.equal(v.blocked, false);
  assert.deepEqual(v.end, [mm(10), 0]);
  assertLegal(p, index, v, 'SIG');
  assert.ok(v.segments.length >= 3);                                // it bends round
  for (const s of v.segments) { const dx = Math.abs(s.b[0] - s.a[0]), dy = Math.abs(s.b[1] - s.a[1]); assert.ok(!dx || !dy || dx === dy, 'octilinear'); }
  assert.ok(length(v.segments) < mm(14));                            // hugs: not a wide berth
});

test('walkaround picks the shorter side of a track in the way', () => {
  const p = newProject('W');
  // a vertical track from y = -2 to y = +8: going over the top (−y) is shorter
  const index = new CopperIndex([track('t1', [mm(5), mm(-2)], [mm(5), mm(8)], mm(0.25))]);
  const st = startRoute(p, [0, 0], 'F.Cu', 'SIG');
  const v = step(p, st, [mm(10), 0], 'walkaround', index);
  assertLegal(p, index, v, 'SIG');
  assert.deepEqual(v.end, [mm(10), 0]);
  assert.ok(Math.min(...v.segments.flatMap((s) => [s.a[1], s.b[1]])) < mm(-2), 'went over the top');
  assert.ok(Math.max(...v.segments.flatMap((s) => [s.a[1], s.b[1]])) <= 0, 'not under');
  // and the other way round when the track reaches further up
  const index2 = new CopperIndex([track('t1', [mm(5), mm(-8)], [mm(5), mm(2)], mm(0.25))]);
  const v2 = step(p, st, [mm(10), 0], 'walkaround', index2);
  assertLegal(p, index2, v2, 'SIG');
  assert.ok(Math.max(...v2.segments.flatMap((s) => [s.a[1], s.b[1]])) > mm(2), 'went underneath');
});

test('walkaround at 90° keeps to horizontal and vertical runs', () => {
  const p = newProject('W');
  const index = new CopperIndex([pad('p1', [mm(5), 0], [mm(2), mm(2)])]);
  const st = startRoute(p, [0, 0], 'F.Cu', 'SIG', { corner: '90' });
  const v = step(p, st, [mm(10), 0], 'walkaround', index);
  assertLegal(p, index, v, 'SIG');
  for (const s of v.segments) assert.ok(s.a[0] === s.b[0] || s.a[1] === s.b[1]);
});

test('walkaround stops at the obstacle when there is no way round', () => {
  const p = newProject('W');
  // the cursor is boxed in by a ring of copper
  const R = mm(1.5), c = [mm(10), 0];
  const ring = [[-R, -R, R, -R], [R, -R, R, R], [R, R, -R, R], [-R, R, -R, -R]].map(([x0, y0, x1, y1], i) => track('r' + i, [c[0] + x0, y0], [c[0] + x1, y1], mm(0.3)));
  const index = new CopperIndex(ring);
  const st = startRoute(p, [0, 0], 'F.Cu', 'SIG');
  const v = step(p, st, c, 'walkaround', index);
  assert.equal(v.blocked, true);
  assertLegal(p, index, v, 'SIG');
  assert.ok(v.end[0] > mm(7) && v.end[0] < c[0] - R, `stopped at the ring (${v.end})`);
});

test('walkaround keeps the edge clearance from the Outline', () => {
  const p = newProject('W');
  p.board.outline = rectOutline([0, 0], [mm(20), mm(10)]);
  assert.equal(outlineSegments(p.board.outline).length, 4);
  const index = new CopperIndex([]);
  const obs = new Obstacles(p, index, 'F.Cu', 'SIG', mm(0.25));
  assert.equal(obs.clear([mm(5), mm(0.2)], [mm(15), mm(0.2)]), false); // closer than 0.3 mm to the top edge
  const st = startRoute(p, [mm(2), mm(5)], 'F.Cu', 'SIG');
  const v = step(p, st, [mm(10), mm(0.1)], 'walkaround', index);       // cursor right on the edge
  assert.equal(v.blocked, true);
  assert.ok(v.end[1] >= mm(0.3) + mm(0.125) - 1);
});

test('clicking fixes the detour, and commit lays down legal Tracks', () => {
  const p = newProject('W');
  const index = new CopperIndex([pad('p1', [mm(5), 0], [mm(2), mm(2)])]);
  let st = startRoute(p, [0, 0], 'F.Cu', 'SIG', { chamfer: mm(0.5) });
  const v = step(p, st, [mm(10), 0], 'walkaround', index);
  assertLegal(p, index, v, 'SIG');
  st = click(p, st, [mm(10), 0], v.tail);
  assert.deepEqual(st.points[st.points.length - 1], [mm(10), 0]);
  const tracks = commit(p, st);
  for (const t of tracks) assert.equal(index.collisions(p.board, { type: 'capsule', a: t.a, b: t.b, r: t.width / 2 }, 'F.Cu', 'SIG').length, 0);
});

test('a free cursor is the plain corner path, posture and all', () => {
  const p = newProject('W');
  const st = startRoute(p, [0, 0], 'F.Cu', 'SIG', { posture: 'b' });
  const v = step(p, st, [mm(10), mm(4)], 'walkaround', new CopperIndex([]));
  assert.deepEqual(v.tail, [[mm(4), mm(4)], [mm(10), mm(4)]]);
  const w = walkPath(new Obstacles(p, new CopperIndex([]), 'F.Cu', 'SIG', mm(0.25)), [0, 0], [mm(3), 0]);
  assert.deepEqual(w.path, [[0, 0], [mm(3), 0]]);
});
