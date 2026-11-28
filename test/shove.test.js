// Shove (#29): new copper pushes other Nets' Tracks aside, through chains, never moving pads,
// Vias or locked copper; what it leaves is clearance-legal and connects what it did.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shove, hullOf, walkHull, linesOf } from '../src/renderer/core/shove.js';
import { shapeDistance, padShape } from '../src/renderer/core/collision.js';
import { mm } from '../src/renderer/core/units.js';

const W = mm(0.25), C = mm(0.2);
const board = (tracks, extra = {}) => ({ rules: { clearance: C, edgeClearance: 0 }, netClasses: {}, outline: [], tracks, ...extra });
const tr = (id, a, b, net, layer = 'F.Cu') => ({ id, a, b, width: W, layer, net });
const head = (a, b, net = 'NEW', layers = ['F.Cu']) => ({ a, b, r: W / 2, layers, net, kind: 'track' });
const cap = (t) => ({ type: 'capsule', a: t.a, b: t.b, r: t.width / 2 });
/** every pair of other-net copper (tracks and the head) at least the clearance apart */
function legal(tracks, heads) {
  const all = [...tracks.map((t) => ({ s: cap(t), net: t.net, layer: t.layer })), ...heads.map((h) => ({ s: { type: 'capsule', a: h.a, b: h.b, r: h.r }, net: h.net, layer: h.layers[0] }))];
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    if (all[i].net === all[j].net || all[i].layer !== all[j].layer) continue;
    const d = shapeDistance(all[i].s, all[j].s);
    assert.ok(d >= C - 2, `${all[i].net}/${all[j].net} only ${d} apart`);
  }
}
/** each Track's pieces still run end to end from its old start to its old end */
function connected(before, after) {
  for (const t of before) {
    const pieces = after.filter((u) => u.id === t.id || u.net === t.net);
    const ends = new Map();
    for (const u of pieces) for (const p of [u.a, u.b]) { const k = p.join(','); ends.set(k, (ends.get(k) || 0) + 1); }
    assert.ok(ends.get(t.a.join(',')) >= 1 && ends.get(t.b.join(',')) >= 1, `${t.id} keeps its ends`);
    const odd = [...ends].filter(([, n]) => n % 2).map(([k]) => k).sort();
    assert.deepEqual(odd, [t.a.join(','), t.b.join(',')].sort(), `${t.id} is one unbroken run`);
  }
}

test('a line walks round a pusher\'s octagonal hull: 45° ramps, its ends kept (#108)', () => {
  const R = mm(0.5);
  const hull = hullOf([mm(8), mm(0.2)], [mm(12), mm(0.2)], R);
  const pts = [[0, 0], [mm(20), 0]];
  const w = walkHull(pts, hull, (f, b) => (Math.min(...f.map((q) => q[1])) < Math.min(...b.map((q) => q[1])) ? f : b));
  assert.ok(w && w !== 'joint');
  const out = w.pts;
  assert.deepEqual([out[0], out[out.length - 1]], pts);
  assert.ok(out.length >= 6, JSON.stringify(out));
  // every piece runs at a multiple of 45°, and the raised run clears the pusher by R
  for (let i = 1; i < out.length; i++) {
    const dx = Math.abs(out[i][0] - out[i - 1][0]), dy = Math.abs(out[i][1] - out[i - 1][1]);
    assert.ok(dx < 2 || dy < 2 || Math.abs(dx - dy) < 2, `piece ${i} at 45° steps: ${JSON.stringify(out)}`);
  }
  assert.ok(Math.min(...out.map((q) => q[1])) <= mm(0.2) - R + 1);
  // an end inside the hull can't move
  assert.equal(walkHull([[mm(10), 0], [mm(20), 0]], hull, (f) => f), 'joint');
  // lines are cut at joints: a pad, or three ends meeting
  const ls = linesOf([{ id: 'a', a: [0, 0], b: [10, 0], net: 'N', layer: 'F.Cu', width: 1 }, { id: 'b', a: [10, 0], b: [10, 10], net: 'N', layer: 'F.Cu', width: 1 }, { id: 'c', a: [10, 10], b: [20, 10], net: 'N', layer: 'F.Cu', width: 1 }], (l, p) => p[0] === 20);
  assert.equal(ls.length, 1);
  assert.deepEqual(ls[0].pts, [[0, 0], [10, 0], [10, 10], [20, 10]]);
});

test('new copper pushes a Track, and a chain of parallel Tracks; all clear and still connected', () => {
  const before = [tr('a', [0, 0], [mm(30), 0], 'A'), tr('b', [0, -mm(0.5)], [mm(30), -mm(0.5)], 'B'), tr('c', [0, -mm(1)], [mm(30), -mm(1)], 'C')];
  const h = [head([mm(12), mm(0.3)], [mm(18), mm(0.3)])];
  const r = shove(board(before), h);
  assert.ok(r.ok, r.reason);
  assert.deepEqual([...r.moved].sort(), ['a', 'b', 'c']);
  legal(r.tracks, h);
  connected(before, r.tracks);
  // copper further off isn't touched
  const far = shove(board([...before, tr('d', [0, -mm(5)], [mm(30), -mm(5)], 'D')]), h);
  assert.ok(far.ok && !far.moved.has('d'));
});

test('spring-back: the shove is worked out from the Board as it was, so a pusher further off pushes less or not at all', () => {
  const before = [tr('a', [0, 0], [mm(30), 0], 'A')];
  const near = shove(board(before), [head([mm(12), mm(0.3)], [mm(18), mm(0.3)])]);
  const away = shove(board(before), [head([mm(12), mm(1)], [mm(18), mm(1)])]);
  assert.ok(near.moved.has('a'));
  assert.ok(away.ok && !away.moved.size);
  assert.deepEqual(away.tracks, before);
});

test('pads, Vias and locked Tracks never move: a shove that would need them fails', () => {
  const before = [tr('a', [0, 0], [mm(30), 0], 'A')];
  const h = [head([mm(12), mm(0.3)], [mm(18), mm(0.3)])];
  // a pad just past where the bump would go
  const pad = { kind: 'pad', id: 'p', net: 'P', layers: new Set(['F.Cu']), shape: padShape({ at: [mm(15), -mm(0.6)], size: [mm(1), mm(0.5)], shape: 'rect', rot: 0 }), item: {} };
  assert.equal(shove(board(before), h, { fixed: [pad] }).ok, false);
  assert.equal(shove(board(before), h, { locked: new Set(['a']) }).ok, false);
  assert.equal(shove(board([{ ...before[0], locked: true }]), h).ok, false);
  // the same Net isn't pushed
  assert.equal(shove(board(before), [head([mm(12), mm(0.3)], [mm(18), mm(0.3)], 'A')]).moved.size, 0);
  // other layers aren't either
  assert.equal(shove(board([tr('a', [0, 0], [mm(30), 0], 'A', 'B.Cu')]), h).moved.size, 0);
});

// ---------------------------------------------------------------- through the router (#29)

import { newProject } from '../src/renderer/core/project.js';
import { copperIndex, CopperIndex } from '../src/renderer/core/collision.js';
import { startRoute, step, click, commit, ROUTE_MODES } from '../src/renderer/core/router.js';
import { rectOutline } from '../src/renderer/core/board.js';

function routedBoard() {
  const p = newProject('S');
  const b = p.board;
  b.outline = rectOutline([0, 0], [mm(40), mm(20)]);
  b.rules = { ...b.rules, clearance: C, trackWidth: W, edgeClearance: mm(0.3) };
  // two other-net tracks running along y = 10.4 and 10.9 mm (0.25 mm apart)
  b.tracks.push(tr('a', [mm(2), mm(10.4)], [mm(38), mm(10.4)], 'A'), tr('b', [mm(2), mm(10.9)], [mm(38), mm(10.9)], 'B'));
  return p;
}
const legalBoard = (p, segs, net) => {
  const tracks = [...p.board.tracks, ...segs.map((s, i) => ({ id: `n${i}`, a: s.a, b: s.b, width: W, layer: 'F.Cu', net }))];
  legal(tracks, []);
};

test('router: Shove is the default mode; routing alongside pushes the tracks, springs back, and commits them pushed', () => {
  assert.equal(ROUTE_MODES[0][0], 'shove');
  const p = routedBoard();
  const before = structuredClone(p.board.tracks);
  const index = copperIndex(p);
  let st = startRoute(p, [mm(10), mm(9.5)], 'F.Cu', 'NEW');
  // the cursor to the right and down a little: straight, then 45° in to 0.4 mm from track A's centre: too close, so it pushes
  const v = step(p, st, [mm(25), mm(10)], 'shove', index);
  assert.ok(v.shoved, v.shoveFailed);
  assert.equal(v.collisions.length, 0);
  assert.deepEqual([...v.shovedIds].sort(), ['a', 'b'], 'a chain of two');
  legal(v.shoved, v.segments.map((s) => ({ a: s.a, b: s.b, r: W / 2, layers: ['F.Cu'], net: 'NEW' })));
  // spring-back: the cursor withdraws and the tracks go back where they were
  const back = step(p, st, [mm(25), mm(9.5)], 'shove', index);
  assert.ok(!back.shoved);
  assert.deepEqual(p.board.tracks, before, 'nothing on the Board moved while routing');
  // commit: the route and the pushed tracks, clear and still connected
  st = click(p, st, [mm(25), mm(10)], v.tail);
  const added = commit(p, st, { shove: true, index });
  assert.ok(added.length >= 1);
  legal(p.board.tracks.map((t) => ({ ...t })), []);
  connected(before, p.board.tracks.filter((t) => t.net !== 'NEW'));
  assert.ok(p.board.tracks.some((t) => t.net === 'A' && t.a[1] !== mm(10.4)), 'track A was pushed');
});

test('router: a shove that would need a pad to move walks round instead', () => {
  const p = routedBoard();
  // a fixed pad of another net just past the tracks: there's no room to push them
  const index = copperIndex(p);
  index.add({ kind: 'pad', id: 'P1', net: 'X', layers: new Set(['F.Cu']), shape: padShape({ at: [mm(24), mm(11.5)], size: [mm(10), mm(0.6)], shape: 'rect', rot: 0 }), item: {} });
  const st = startRoute(p, [mm(10), mm(9.5)], 'F.Cu', 'NEW');
  const v = step(p, st, [mm(25), mm(10)], 'shove', index);
  assert.ok(!v.shoved && v.shoveFailed, 'no shove');
  // walkaround's answer: clear of everything, or stopped short
  legalBoard(p, v.segments, 'NEW');
  void CopperIndex;
});

// ---------------------------------------------------------------- Vias (#30)

import { viaMove } from '../src/renderer/core/shove.js';
import { placeViaPushing } from '../src/renderer/core/copper.js';

const via = (id, at, net, extra = {}) => ({ id, at, drill: mm(0.3), diameter: mm(0.6), from: 'F.Cu', to: 'B.Cu', net, ...extra });

test('vias: a route pushes a via clear, its tracks\' ends going with it', () => {
  // a via of net A with a track on each layer leaving it downwards
  const v = via('v', [mm(15), mm(10.6)], 'A');
  const ta = tr('ta', [mm(15), mm(10.6)], [mm(15), mm(18)], 'A'), tb = tr('tb', [mm(15), mm(10.6)], [mm(15), mm(18)], 'A', 'B.Cu');
  const b = board([ta, tb], { vias: [v], stack: { copper: 2 } });
  const h = [head([mm(5), mm(10)], [mm(25), mm(10)])];
  const r = shove(b, h, { copper: ['F.Cu', 'B.Cu'] });
  assert.ok(r.ok, r.reason);
  assert.ok(r.movedVias.has('v'));
  const nv = r.vias.find((x) => x.id === 'v');
  assert.equal(nv.at[0], mm(15), 'straight away from the route (down)');
  assert.ok(nv.at[1] > mm(10.6));
  assert.ok(shapeDistance({ type: 'capsule', a: nv.at, b: nv.at, r: mm(0.3) }, { type: 'capsule', a: h[0].a, b: h[0].b, r: W / 2 }) >= C - 2);
  for (const id of ['ta', 'tb']) assert.deepEqual(r.tracks.find((t) => t.id === id).a, nv.at, `${id} still meets the via`);
});

test('vias: a via dropped mid-route pushes tracks on every layer; a locked via stays', () => {
  const b = board([tr('f', [0, mm(0.6)], [mm(30), mm(0.6)], 'A'), tr('k', [0, mm(0.6)], [mm(30), mm(0.6)], 'B', 'B.Cu')], { vias: [], stack: { copper: 2 } });
  const drop = [{ a: [mm(15), 0], b: [mm(15), 0], r: mm(0.3), layers: ['F.Cu', 'B.Cu'], net: 'NEW', kind: 'via' }];
  const r = shove(b, drop, { copper: ['F.Cu', 'B.Cu'] });
  assert.ok(r.ok, r.reason);
  assert.deepEqual([...r.moved].sort(), ['f', 'k'], 'both layers');
  legal(r.tracks.filter((t) => t.layer === 'F.Cu'), [{ ...drop[0], layers: ['F.Cu'] }]);
  legal(r.tracks.filter((t) => t.layer === 'B.Cu'), [{ ...drop[0], layers: ['B.Cu'] }]);
  // a locked via in the way: no shove
  const lb = board([], { vias: [via('v', [mm(15), mm(10.5)], 'A', { locked: true })], stack: { copper: 2 } });
  assert.equal(shove(lb, [head([mm(5), mm(10)], [mm(25), mm(10)])]).ok, false);
  assert.ok(viaMove(via('v', [mm(15), mm(10.5)], 'A'), { a: [mm(5), mm(10)], b: [mm(25), mm(10)], r: W / 2 }, C)[1] > mm(10.5));
});

test('vias: the Via tool in Shove mode pushes what it lands near', () => {
  const p = newProject('V');
  p.board.outline = rectOutline([0, 0], [mm(40), mm(20)]);
  p.board.rules = { ...p.board.rules, clearance: C };
  p.board.tracks.push(tr('a', [mm(2), mm(10.5)], [mm(38), mm(10.5)], 'A'));
  const { via: v, pushed } = placeViaPushing(p, [mm(20), mm(10)], 0, { shove: true });
  assert.equal(pushed, 1);
  assert.ok(p.board.vias.includes(v));
  legal(p.board.tracks, [{ a: v.at, b: v.at, r: v.diameter / 2, layers: ['F.Cu'], net: v.net || 'none' }]);
  // without shove the track stays where it was
  const q = newProject('V2');
  q.board.tracks.push(tr('a', [mm(2), mm(10.5)], [mm(38), mm(10.5)], 'A'));
  assert.equal(placeViaPushing(q, [mm(20), mm(10)]).pushed, 0);
  assert.equal(q.board.tracks[0].a[1], mm(10.5));
});

test('a route driven into a bundle pushes every track ahead of it, rippling through (#107)', () => {
  // three parallel tracks of different nets 0.5 mm apart; a head comes down across the first two
  const before = [0, 1, 2].map((i) => tr('n' + i, [0, mm(i * 0.5)], [mm(40), mm(i * 0.5)], 'N' + i));
  const r = shove(board(before), [{ ...head([mm(20), -mm(5)], [mm(20), mm(0.7)]), tip: true }]);
  assert.ok(r.ok, r.reason);
  assert.deepEqual([...r.moved].sort(), ['n0', 'n1', 'n2']);
  // every pushed track keeps its ends and stays clear of the head and of each other
  const hc = { type: 'capsule', a: [mm(20), -mm(5)], b: [mm(20), mm(0.7)], r: W / 2 };
  for (const t of r.tracks) assert.ok(shapeDistance(hc, { type: 'capsule', a: t.a, b: t.b, r: W / 2 }) >= C - 2, `${t.id} clear of the head`);
  for (const t of r.tracks) for (const u of r.tracks) if (t.net !== u.net) assert.ok(shapeDistance({ type: 'capsule', a: t.a, b: t.b, r: W / 2 }, { type: 'capsule', a: u.a, b: u.b, r: W / 2 }) >= C - 2);
  for (const id of ['n0', 'n1', 'n2']) {
    const segs = r.tracks.filter((t) => t.net === before.find((b) => b.id === id).net);
    const xs = segs.flatMap((t) => [t.a[0], t.b[0]]);
    assert.ok(Math.min(...xs) === 0 && Math.max(...xs) === mm(40), `${id} keeps its ends`);
  }
});
