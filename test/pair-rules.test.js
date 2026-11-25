// Clearance per object pair (#68): the rule, DRC for each pair, the Zone fill, the router and the
// Eagle import.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newProject } from '../src/renderer/core/project.js';
import { CopperIndex, padShape, clearanceBetween, pairKind, pairKey, PAIR_KEYS, shapeDistance } from '../src/renderer/core/collision.js';
import { startRoute, step } from '../src/renderer/core/router.js';
import { runDrc } from '../src/renderer/core/drc.js';
import { setPairRule, applyPreset, FAB_PRESETS } from '../src/renderer/core/presets.js';
import { rectOutline } from '../src/renderer/core/board.js';
import { newZone, zoneInput, fillZones } from '../src/renderer/core/zones.js';
import { mm } from '../src/renderer/core/units.js';

const board = (rules = {}, netClasses = {}) => ({ rules: { clearance: mm(0.2), ...rules }, netClasses });

test('the rule: classes without pairs; a pair replaces the Default class; a larger explicit class wins', () => {
  assert.deepEqual(PAIR_KEYS, ['track-track', 'track-pad', 'track-via', 'pad-pad', 'pad-via', 'via-via']);
  assert.equal(pairKey('via', 'track'), 'track-via');
  assert.deepEqual([pairKind({ kind: 'track' }), pairKind({ kind: 'zone' }), pairKind({ kind: 'drawing' }), pairKind({ kind: 'pad', item: { drill: 0 } }), pairKind({ kind: 'via' })], ['track', 'track', 'track', 'pad', 'via']);
  // no pairs: as before (a class with a smaller clearance keeps it between its own nets)
  const fine = { Fine: { clearance: mm(0.1), nets: ['A', 'B'] }, Wide: { clearance: mm(0.5), nets: ['HV'] } };
  assert.equal(clearanceBetween(board({}, fine), 'X', 'Y', 'track', 'pad'), mm(0.2));
  assert.equal(clearanceBetween(board({}, fine), 'A', 'B', 'track', 'track'), mm(0.1));
  assert.equal(clearanceBetween(board({}, fine), 'A', 'HV'), mm(0.5));
  // with pairs: the pair instead of the Default class's clearance
  const b = board({ pairs: { 'track-track': mm(0.1), 'pad-pad': mm(0.3) } }, fine);
  assert.equal(clearanceBetween(b, 'X', 'Y', 'track', 'track'), mm(0.1));
  assert.equal(clearanceBetween(b, 'X', 'Y', 'pad', 'pad'), mm(0.3));
  assert.equal(clearanceBetween(b, 'X', 'Y', 'track', 'pad'), mm(0.2), 'an unset pair: the classes');
  assert.equal(clearanceBetween(b, 'X', 'HV', 'track', 'track'), mm(0.5), 'a larger class wins');
  assert.equal(clearanceBetween(b, 'A', 'B', 'pad', 'pad'), mm(0.3), 'a smaller class doesn\'t lower a pair');
  assert.equal(clearanceBetween(b, 'X', 'Y'), mm(0.2), 'no kinds: no pair rule');
});

test('setPairRule sets and clears; a fab preset clears them', () => {
  const p = newProject('R');
  setPairRule(p, 'pad-via', mm(0.25));
  assert.equal(p.board.rules.pairs['pad-via'], mm(0.25));
  assert.throws(() => setPairRule(p, 'pad-smd', mm(1)), /Unknown object pair/);
  assert.throws(() => setPairRule(p, 'pad-pad', 0), /more than 0/);
  setPairRule(p, 'pad-via', null);
  assert.ok(!('pairs' in p.board.rules));
  setPairRule(p, 'via-via', mm(0.3));
  applyPreset(p, FAB_PRESETS[0].id);
  assert.ok(!('pairs' in p.board.rules));
});

// two pieces of copper of different nets `gap` apart, of the given kinds, on a board
function pairBoard(k1, k2, gap) {
  const p = newProject('P');
  const b = p.board;
  b.outline = rectOutline([0, 0], [mm(30), mm(20)]);
  b.rules = { ...b.rules, clearance: mm(0.2) };
  const W = mm(0.25), D = mm(0.6);
  const left = { track: (x) => b.tracks.push({ id: 'A', a: [mm(5), mm(10)], b: [x - W / 2, mm(10)], width: W, layer: 'F.Cu', net: 'A' }), via: (x) => b.vias.push({ id: 'A', at: [x - D / 2, mm(10)], diameter: D, drill: mm(0.3), net: 'A' }) };
  const right = { track: (x) => b.tracks.push({ id: 'B', a: [x + W / 2, mm(10)], b: [mm(25), mm(10)], width: W, layer: 'F.Cu', net: 'B' }), via: (x) => b.vias.push({ id: 'B', at: [x + D / 2, mm(10)], diameter: D, drill: mm(0.3), net: 'B' }) };
  const x = mm(15);
  left[k1](x - gap / 2); right[k2](x + gap / 2);
  return { p, b };
}

for (const [k1, k2] of [['track', 'track'], ['track', 'via'], ['via', 'via']]) {
  test(`DRC: ${k1}–${k2} clearance from its pair rule`, () => {
    const { p, b } = pairBoard(k1, k2, mm(0.15));
    // one problem per pair of items (two vias meet on every copper layer)
    const runDrcOnce = (q) => [...new Map(runDrc(q).map((v) => [v.rule + (v.items || []).join(), v])).values()];
    assert.equal(runDrcOnce(p).filter((v) => v.rule === 'clearance').length, 1, 'under the 0.2 mm clearance');
    b.rules.pairs = { [pairKey(k1, k2)]: mm(0.12) };
    assert.equal(runDrcOnce(p).filter((v) => v.rule === 'clearance').length, 0, 'a smaller pair rule allows it');
    b.rules.pairs = { [pairKey(k1, k2)]: mm(0.18) };
    const v = runDrcOnce(p).filter((x) => x.rule === 'clearance');
    assert.equal(v.length, 1);
    assert.match(v[0].message, new RegExp(`0\\.18 mm needed \\(${k1}–${k2} rule\\)`));
    // other pairs don't apply
    b.rules.pairs = Object.fromEntries(PAIR_KEYS.filter((k) => k !== pairKey(k1, k2)).map((k) => [k, mm(0.05)]));
    assert.equal(runDrcOnce(p).filter((x) => x.rule === 'clearance').length, 1);
  });
}

test('DRC: pad pairs (track–pad, pad–via, pad–pad), SMD pads counting as pads', () => {
  const p = newProject('P');
  const b = p.board;
  b.rules = { ...b.rules, clearance: mm(0.2) };
  // pads by hand: a stand-in index item reaches pairKind as 'pad' whatever its drill
  const smd = { kind: 'pad', item: { drill: 0 } }, tht = { kind: 'pad', item: { drill: mm(0.8) } };
  assert.equal(pairKind(smd), 'pad');
  assert.equal(pairKind(tht), 'pad');
  b.rules.pairs = { 'track-pad': mm(0.3), 'pad-via': mm(0.35), 'pad-pad': mm(0.4) };
  assert.equal(clearanceBetween(b, 'A', 'B', 'track', pairKind(smd)), mm(0.3));
  assert.equal(clearanceBetween(b, 'A', 'B', pairKind(tht), 'via'), mm(0.35));
  assert.equal(clearanceBetween(b, 'A', 'B', pairKind(smd), pairKind(tht)), mm(0.4));
  // and through the index DRC uses
  const index = new CopperIndex([{ kind: 'pad', id: 'p', net: 'B', layers: new Set(['F.Cu']), shape: padShape({ at: [mm(1), 0], size: [mm(1), mm(1)], shape: 'rect', rot: 0 }), item: { drill: 0 } }]);
  const at = (gap) => ({ type: 'capsule', a: [mm(0.5) - gap - mm(0.125), 0], b: [mm(-2), 0], r: mm(0.125) });
  assert.equal(index.collisions(b, at(mm(0.25)), 'F.Cu', 'A').length, 1, '0.25 mm from the pad: under track–pad 0.3');
  assert.equal(index.collisions(b, at(mm(0.32)), 'F.Cu', 'A').length, 0);
  assert.equal(index.collisions(b, { type: 'capsule', a: [mm(0.5) - mm(0.33) - mm(0.3), 0], b: [mm(0.5) - mm(0.33) - mm(0.3), 0], r: mm(0.3) }, 'F.Cu', 'A', new Set(), 'via').length, 1, 'a via 0.33 mm off: under pad–via 0.35');
});

test('Zone fill keeps each pair\'s clearance (its copper counts as track)', () => {
  const p = newProject('Z');
  const b = p.board;
  b.outline = rectOutline([0, 0], [mm(20), mm(20)]);
  b.rules = { ...b.rules, clearance: mm(0.2), pairs: { 'track-track': mm(0.5), 'track-via': mm(0.9) } };
  b.tracks.push({ id: 't', a: [mm(4), mm(5)], b: [mm(16), mm(5)], width: mm(0.25), layer: 'F.Cu', net: 'SIG' });
  b.vias.push({ id: 'v', at: [mm(10), mm(14)], diameter: mm(0.6), drill: mm(0.3), net: 'SIG' });
  const z = newZone('F.Cu', '', [[0, 0], [mm(20), 0], [mm(20), mm(20)], [0, mm(20)]]);
  b.zones.push(z);
  const f = fillZones(zoneInput(p)).get(z.id);
  const gapTo = (shape) => Math.min(...f.polys.flatMap((poly) => poly.flatMap((ring) => ring.map((q, i) => shapeDistance(shape, { type: 'capsule', a: q, b: ring[(i + 1) % ring.length], r: 0 })))));
  const tg = gapTo({ type: 'capsule', a: [mm(4), mm(5)], b: [mm(16), mm(5)], r: mm(0.125) }), vg = gapTo({ type: 'capsule', a: [mm(10), mm(14)], b: [mm(10), mm(14)], r: mm(0.3) });
  assert.ok(tg >= mm(0.5) - 2_000 && tg < mm(0.6), `track gap ${tg}`);
  assert.ok(vg >= mm(0.9) - 2_000 && vg < mm(1.0), `via gap ${vg}`);
});

test('the router keeps a smaller track–track clearance than track–pad', () => {
  const p = newProject('W');
  p.board.rules = { ...p.board.rules, clearance: mm(0.2), pairs: { 'track-track': mm(0.1), 'track-pad': mm(0.5) } };
  const trackIdx = new CopperIndex([{ kind: 'track', id: 't1', net: 'GND', layers: new Set(['F.Cu']), shape: { type: 'capsule', a: [mm(5), mm(-2)], b: [mm(5), mm(8)], r: mm(0.125) }, item: {} }]);
  const padIdx = new CopperIndex([{ kind: 'pad', id: 'p1', net: 'GND', layers: new Set(['F.Cu']), shape: padShape({ at: [mm(5), mm(3)], size: [mm(0.25), mm(10)], shape: 'rect', rot: 0 }), item: { drill: 0 } }]);
  const gap = (index, it) => {
    const v = step(p, startRoute(p, [0, 0], 'F.Cu', 'SIG'), [mm(10), 0], 'walkaround', index);
    assert.equal(v.blocked, false);
    return Math.min(...v.segments.map((s) => shapeDistance({ type: 'capsule', a: s.a, b: s.b, r: v.state.width / 2 }, it)));
  };
  const gt = gap(trackIdx, trackIdx.items[0].shape), gp = gap(padIdx, padIdx.items[0].shape);
  assert.ok(gt >= mm(0.1) - 1_000 && gt < mm(0.2), `round the track: ${gt}`);
  assert.ok(gp >= mm(0.5) - 1_000, `round the pad: ${gp}`);
});
