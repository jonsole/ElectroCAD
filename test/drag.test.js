// Dragging Tracks (#31): segment and corner drags keep the geometry and connectivity, and in
// Shove mode push other nets' copper aside, clear, springing back; locked copper never moves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newProject } from '../src/renderer/core/project.js';
import { copperIndex, shapeDistance } from '../src/renderer/core/collision.js';
import { dragSegment, dragCorner, dragEnd, cornerAt, dragResult, STRETCH } from '../src/renderer/core/drag.js';
import { rectOutline } from '../src/renderer/core/board.js';
import { mm } from '../src/renderer/core/units.js';

const W = mm(0.25);
const tr = (id, a, b, net = 'N', layer = 'F.Cu') => ({ id, a: a.map(mm), b: b.map(mm), width: W, layer, net });
function project(tracks, extra = {}) {
  const p = newProject('D');
  p.board.outline = rectOutline([0, 0], [mm(40), mm(30)]);
  p.board.rules = { ...p.board.rules, clearance: mm(0.2) };
  p.board.tracks = tracks;
  Object.assign(p.board, extra);
  return p;
}
const angle = (t) => { const dx = t.b[0] - t.a[0], dy = t.b[1] - t.a[1]; return dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy); };
/** the net's segments still run end to end, from `from` to `to` */
function runs(tracks, net, from, to) {
  const ends = new Map();
  for (const t of tracks.filter((x) => x.net === net)) for (const q of [t.a, t.b]) { const k = q.join(','); ends.set(k, (ends.get(k) || 0) + 1); }
  const odd = [...ends].filter(([, n]) => n % 2).map(([k]) => k).sort();
  assert.deepEqual(odd, [from.map(mm).join(','), to.map(mm).join(',')].sort());
}

test('segment drag: square neighbours lengthen to follow, keeping 90°', () => {
  const p = project([tr('l', [5, 5], [5, 15]), tr('m', [5, 15], [15, 15]), tr('r', [15, 15], [15, 5])]);
  const r = dragSegment(p, p.board, 'm', [mm(3), mm(2)]); // only the sideways (y) part counts
  const m = r.tracks.find((t) => t.id === 'm');
  assert.deepEqual([m.a, m.b], [[mm(5), mm(17)], [mm(15), mm(17)]]);
  assert.ok(r.tracks.every(angle));
  runs(r.tracks, 'N', [5, 5], [15, 5]);
  assert.equal(r.tracks.length, 3, 'no jogs needed');
});

test('segment drag: 45° neighbours slide along their own lines, staying 45°', () => {
  const p = project([tr('l', [0, 0], [5, 5]), tr('m', [5, 5], [15, 5]), tr('r', [15, 5], [20, 0])]);
  const r = dragSegment(p, p.board, 'm', [0, mm(2)]);
  const m = r.tracks.find((t) => t.id === 'm');
  assert.deepEqual([m.a, m.b], [[mm(7), mm(7)], [mm(13), mm(7)]]);
  assert.ok(r.tracks.every(angle));
  runs(r.tracks, 'N', [0, 0], [20, 0]);
});

test('segment drag: an end on a via (or with no single neighbour) gets a square jog', () => {
  const p = project([tr('m', [5, 15], [15, 15])], { vias: [{ id: 'v', at: [mm(5), mm(15)], drill: mm(0.3), diameter: mm(0.6), from: 'F.Cu', to: 'B.Cu', net: 'N' }] });
  const r = dragSegment(p, p.board, 'm', [0, mm(-2)]);
  assert.equal(r.tracks.length, 3);
  assert.ok(r.tracks.every(angle));
  runs(r.tracks, 'N', [5, 15], [15, 15]);
});

test('corner drag: the two segments are redrawn to the new corner at 45°', () => {
  const p = project([tr('a', [0, 0], [10, 0]), tr('b', [10, 0], [10, 10])]);
  assert.deepEqual(cornerAt(p, p.board, [mm(10.1), 0], mm(0.3)), { at: [mm(10), 0], layer: 'F.Cu' });
  assert.equal(cornerAt(p, p.board, [mm(5), 0], mm(0.3)), null, 'not a corner');
  const r = dragCorner(p, p.board, [mm(10), 0], [mm(13), mm(4)]);
  assert.ok(r.tracks.every(angle));
  runs(r.tracks, 'N', [0, 0], [10, 10]);
  assert.ok(r.tracks.some((t) => t.a.join() === [mm(13), mm(4)].join() || t.b.join() === [mm(13), mm(4)].join()), 'through the new corner');
});

test('corner drag at a junction: every track meeting there follows (a T, a star)', () => {
  const p = project([tr('a', [0, 0], [10, 0]), tr('b', [10, 0], [20, 0]), tr('c', [10, 0], [10, 10])]);
  assert.deepEqual(cornerAt(p, p.board, [mm(10.1), 0], mm(0.3)), { at: [mm(10), 0], layer: 'F.Cu' });
  const to = [mm(11), mm(3)];
  const r = dragCorner(p, p.board, [mm(10), 0], to);
  assert.ok(r.tracks.every(angle));
  // each far end still joins the new corner, through the redrawn tracks
  const k = (q) => q.join(','), adj = new Map();
  for (const t of r.tracks) for (const [x, y] of [[t.a, t.b], [t.b, t.a]]) { if (!adj.has(k(x))) adj.set(k(x), []); adj.get(k(x)).push(k(y)); }
  const reach = new Set([k(to)]), q = [k(to)];
  while (q.length) for (const n of adj.get(q.pop()) || []) if (!reach.has(n)) { reach.add(n); q.push(n); }
  for (const far of [[0, 0], [20, 0], [10, 10]]) assert.ok(reach.has(k(far.map(mm))), `${far} joined`);
  assert.ok(!r.tracks.some((t) => [t.a, t.b].some((q2) => q2[0] === mm(10) && q2[1] === 0)), 'nothing left at the old corner');
  // not where a via is
  const v = project([tr('a', [0, 0], [10, 0]), tr('b', [10, 0], [10, 10])], { vias: [{ id: 'v', at: [mm(10), 0], drill: mm(0.3), diameter: mm(0.6), from: 'F.Cu', to: 'B.Cu', net: 'N' }] });
  assert.equal(cornerAt(v, v.board, [mm(10), 0], mm(0.3)), null);
});

test('Shove: dragging pushes other nets\' tracks clear and they spring back; locked ones stop it', () => {
  const tracks = () => [tr('l', [5, 5], [5, 15]), tr('m', [5, 15], [25, 15]), tr('r', [25, 15], [25, 5]), tr('o', [2, 15.9], [30, 15.9], 'O')];
  const p = project(tracks());
  const index = copperIndex(p);
  const near = dragResult(p, dragSegment(p, p.board, 'm', [0, mm(0.6)]), { shove: true, index });
  assert.ok(near.ok, near.reason);
  assert.ok(near.moved.has('o'));
  const m = near.tracks.find((t) => t.id === 'm'), o = near.tracks.filter((t) => t.net === 'O');
  for (const s of o) assert.ok(shapeDistance({ type: 'capsule', a: m.a, b: m.b, r: W / 2 }, { type: 'capsule', a: s.a, b: s.b, r: W / 2 }) >= mm(0.2) - 2);
  runs(near.tracks, 'O', [2, 15.9], [30, 15.9]);
  // spring-back: a smaller drag pushes nothing
  const small = dragResult(p, dragSegment(p, p.board, 'm', [0, mm(0.2)]), { shove: true, index });
  assert.ok(small.ok && !small.moved.size);
  // without Shove nothing else moves (Free / Walkaround)
  assert.equal(dragResult(p, dragSegment(p, p.board, 'm', [0, mm(0.6)])).tracks.find((t) => t.id === 'o').a[1], mm(15.9));
  // a locked track in the way: the drag can't go there
  const q = project(tracks().map((t) => (t.id === 'o' ? { ...t, locked: true } : t)));
  assert.equal(dragResult(q, dragSegment(q, q.board, 'm', [0, mm(0.6)]), { shove: true, index: copperIndex(q) }).ok, false);
});

test('the routing mode governs edits (#96, #99): Free stretches, Shove/Walkaround use the bend style', () => {
  const at = (t, x, y) => [t.a, t.b].some((q) => q[0] === mm(x) && q[1] === mm(y));
  // E2 Free: the segment moves whole, its neighbours stretch at any angle
  let p = project([tr('a', [0, 0], [10, 0]), tr('b', [10, 0], [10, 10]), tr('c', [10, 10], [20, 10])]);
  let r = dragSegment(p, p.board, 'b', [mm(2), mm(1)], STRETCH);
  const g = (id) => r.tracks.find((t) => t.id === id);
  assert.deepEqual([g('b').a, g('b').b], [[mm(12), mm(1)], [mm(12), mm(11)]]);
  assert.ok(at(g('a'), 12, 1) && at(g('a'), 0, 0) && at(g('c'), 12, 11) && at(g('c'), 20, 10));
  assert.equal(r.tracks.length, 3);
  // E3 Free: the corner moves, each track stays one straight segment
  p = project([tr('a', [0, 0], [10, 0]), tr('b', [10, 0], [10, 10])]);
  r = dragCorner(p, p.board, [mm(10), 0], [mm(13), mm(4)], null, STRETCH);
  assert.equal(r.tracks.length, 2);
  assert.ok(r.tracks.every((t) => at(t, 13, 4)));
  // E3 with bend 0 (90°, horizontal first): every leg square
  r = dragCorner(p, p.board, [mm(10), 0], [mm(13), mm(4)], null, { corner: '90', posture: 'a' });
  assert.ok(r.tracks.length > 2 && r.tracks.every((t) => t.a[0] === t.b[0] || t.a[1] === t.b[1]), JSON.stringify(r.tracks.map((t) => [t.a, t.b])));
  // E4: a free end, redrawn from its far end with 45° (bend 1), or stretched
  p = project([tr('e', [0, 0], [10, 0])]);
  r = dragEnd(p.board, 'e', [mm(10), 0], [mm(14), mm(3)], { corner: '45', posture: 'a' });
  assert.equal(r.tracks.length, 2);
  assert.ok(r.tracks.every(angle));
  assert.equal(dragEnd(p.board, 'e', [mm(10), 0], [mm(14), mm(3)], STRETCH).tracks.length, 1);
});

test("Walkaround refuses an edit into another net's clearance; Free allows it and reports it", () => {
  const p = project([tr('a', [0, 0], [10, 0]), tr('b', [10, 0], [10, 10]), tr('o', [12, 0], [12, 10], 'O')]);
  const index = copperIndex(p);
  const r = dragSegment(p, p.board, 'b', [mm(1.8), 0], STRETCH);
  assert.equal(dragResult(p, r, { mode: 'walkaround', index }).ok, false);
  const free = dragResult(p, r, { mode: 'free', index });
  assert.ok(free.ok && free.collisions.includes('b'));
  assert.ok(dragResult(p, dragSegment(p, p.board, 'b', [mm(0.5), 0], STRETCH), { mode: 'walkaround', index }).ok);
});
