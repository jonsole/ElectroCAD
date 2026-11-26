// Shove (#29): new copper pushes other Nets' Tracks aside, through chains, never moving pads,
// Vias or locked copper; what it leaves is clearance-legal and connects what it did.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shove, bumpOf } from '../src/renderer/core/shove.js';
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

test('a bump lifts a Track clear of the pusher, with 45° ramps, keeping its ends', () => {
  const t = tr('t', [0, 0], [mm(20), 0], 'A');
  const pts = bumpOf(t, [{ a: [mm(8), mm(0.2)], b: [mm(12), mm(0.2)], r: W / 2, need: C }]);
  assert.deepEqual([pts[0], pts[pts.length - 1]], [[0, 0], [mm(20), 0]]);
  assert.equal(pts.length, 6);
  const [, r0, top0, top1, r1] = pts;
  assert.ok(top0[1] < 0 && top0[1] === top1[1], 'lifted away from the pusher (which is below +y)');
  assert.equal(Math.abs(top0[0] - r0[0]), Math.abs(top0[1] - r0[1]), 'a 45° ramp');
  assert.equal(Math.abs(r1[0] - top1[0]), Math.abs(r1[1] - top1[1]));
  // a crossing pusher can't push
  assert.equal(bumpOf(t, [{ a: [mm(10), mm(-1)], b: [mm(10), mm(1)], r: W / 2, need: C }]), null);
  // nor one too near the end for the bump to fit
  assert.equal(bumpOf(t, [{ a: [mm(0.1), mm(0.3)], b: [mm(0.2), mm(0.3)], r: W / 2, need: C }]), null);
  // pushed from both sides: can't be
  assert.equal(bumpOf(t, [{ a: [mm(8), mm(0.2)], b: [mm(12), mm(0.2)], r: W / 2, need: C }, { a: [mm(8), -mm(0.2)], b: [mm(12), -mm(0.2)], r: W / 2, need: C }]), null);
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
