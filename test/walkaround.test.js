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

// ---------------------------------------------------------------- square into and out of pads

import { routePath, padReach } from '../src/renderer/core/router.js';

const segsOf = (a, tail) => { const pts = [a, ...tail]; return pts.slice(1).map((b, i) => [pts[i], b]); };
const square = ([a, b]) => a[0] === b[0] || a[1] === b[1];

test('pad reach follows the pad size and rotation', () => {
  const pad = { size: [mm(1.6), mm(0.9)], rot: 0 };
  assert.equal(padReach(pad, [1, 0]), mm(0.8));
  assert.equal(padReach(pad, [0, -1]), mm(0.45));
  assert.equal(padReach({ ...pad, rot: 90 }, [1, 0]), mm(0.45));
  assert.equal(padReach({ ...pad, rot: -270 }, [1, 0]), mm(0.45));
  assert.equal(padReach({ ...pad, rot: 30 }, [1, 0]), null);
});

test('45° tracks leave and enter pads square, bending at the pad edge or beyond', () => {
  const pad = { size: [mm(1), mm(1)], rot: 0 };
  const a = [0, 0], b = [mm(5), mm(4)]; // nearly diagonal: the plain path would leave at 45°
  const plain = segsOf(a, routePath(a, b, '45', 'b'));
  assert.ok(!square(plain[0]));
  for (const posture of ['a', 'b']) {
    const segs = segsOf(a, routePath(a, b, '45', posture, pad, pad));
    assert.ok(square(segs[0]), `leaves square (${posture})`);
    assert.ok(square(segs[segs.length - 1]), `enters square (${posture})`);
    assert.ok(Math.hypot(segs[0][1][0], segs[0][1][1]) >= mm(0.5), 'bends at the edge or beyond');
    const [p, q] = segs[segs.length - 1];
    assert.ok(Math.hypot(q[0] - p[0], q[1] - p[1]) >= mm(0.5));
    for (const s of segs) { const dx = Math.abs(s[1][0] - s[0][0]), dy = Math.abs(s[1][1] - s[0][1]); assert.ok(!dx || !dy || dx === dy, 'octilinear'); }
  }
  // posture b leaves along the minor axis
  assert.equal(routePath(a, b, '45', 'b', pad)[0][0], 0);
  // a straight run stays one segment
  assert.deepEqual(routePath(a, [mm(5), 0], '45', 'a', pad, pad), [[mm(5), 0]]);
  // 90° and any-angle are left alone
  assert.deepEqual(routePath(a, b, 'any', 'a', pad, pad), [b]);
});

test('walkaround leaves the start pad square too', () => {
  const p = newProject('W');
  const index = new CopperIndex([pad('p1', [mm(3), mm(2.5)], [mm(2), mm(2)])]);
  const st = { ...startRoute(p, [0, 0], 'F.Cu', 'SIG', { pad: { size: [mm(1.2), mm(1.2)], rot: 0 } }) };
  const v = step(p, st, [mm(6), mm(5)], 'walkaround', index, { size: [mm(1.2), mm(1.2)], rot: 0 });
  assertLegal(p, index, v, 'SIG');
  assert.deepEqual(v.end, [mm(6), mm(5)]);
  const segs = v.segments;
  assert.ok(step(p, st, [mm(6), mm(5)], 'free', index).collisions.length, 'the straight way is blocked');
  assert.ok(square([segs[0].a, segs[0].b]), 'leaves square');
  assert.ok(square([segs[segs.length - 1].a, segs[segs.length - 1].b]), 'enters square');
});
