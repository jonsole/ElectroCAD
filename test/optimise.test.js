// Track optimisation (#104, #96 T3-T7): straight runs and arcs of one circle merge at free joins,
// zero-length segments and doubled-back spikes go; joins at vias, pads or a third track, and
// locked tracks, are left alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newProject } from '../src/renderer/core/project.js';
import { optimiseTracks } from '../src/renderer/core/optimise.js';
import { trackArc } from '../src/renderer/core/trackGeom.js';
import { mm } from '../src/renderer/core/units.js';

const W = mm(0.25);
const tr = (id, a, b, extra = {}) => ({ id, a: a.map(mm), b: b.map(mm), width: W, layer: 'F.Cu', net: 'N', ...extra });
const opt = (tracks, extra = {}, scope = null) => { const p = newProject('O'); Object.assign(p.board, { tracks }, extra); optimiseTracks(p, p.board, scope); return p.board.tracks; };

test("T3: straight runs merge into one segment, keeping the first one's id", () => {
  const out = opt([tr('a', [0, 0], [5, 0]), tr('b', [5, 0], [8, 0]), tr('c', [8, 0], [10, 0])]);
  assert.equal(out.length, 1);
  assert.deepEqual([out[0].a, out[0].b].map(String).sort(), [[0, 0], [mm(10), 0]].map(String).sort());
  // diagonal too; a bend doesn't merge
  assert.equal(opt([tr('a', [0, 0], [3, 3]), tr('b', [3, 3], [6, 6])]).length, 1);
  assert.equal(opt([tr('a', [0, 0], [5, 0]), tr('b', [5, 0], [5, 5])]).length, 2);
});

test('not merged: different width, net or layer; a via, pad or third track at the join; locked (T7)', () => {
  assert.equal(opt([tr('a', [0, 0], [5, 0]), tr('b', [5, 0], [10, 0], { width: mm(0.5) })]).length, 2);
  assert.equal(opt([tr('a', [0, 0], [5, 0]), tr('b', [5, 0], [10, 0], { net: 'M' })]).length, 2);
  assert.equal(opt([tr('a', [0, 0], [5, 0]), tr('b', [5, 0], [10, 0], { layer: 'B.Cu' })]).length, 2);
  assert.equal(opt([tr('a', [0, 0], [5, 0]), tr('b', [5, 0], [10, 0])], { vias: [{ id: 'v', at: [mm(5), 0], drill: mm(0.3), diameter: mm(0.6), net: 'N' }] }).length, 2);
  assert.equal(opt([tr('a', [0, 0], [5, 0]), tr('b', [5, 0], [10, 0]), tr('c', [5, 0], [5, 5])]).length, 3);
  assert.equal(opt([tr('a', [0, 0], [5, 0], { locked: true }), tr('b', [5, 0], [10, 0])]).length, 2);
});

test('T4 zero length goes; T5 a doubled-back spike folds out', () => {
  assert.equal(opt([tr('a', [0, 0], [5, 0]), tr('z', [5, 0], [5, 0]), tr('b', [5, 0], [5, 5])]).length, 2);
  // out to 8 and back to 6: one segment 0..6
  const s = opt([tr('a', [0, 0], [8, 0]), tr('b', [8, 0], [6, 0])]);
  assert.equal(s.length, 1);
  assert.deepEqual([s[0].a, s[0].b].map(String).sort(), [[0, 0], [mm(6), 0]].map(String).sort());
});

test('T6: arcs of one circle turning the same way merge into one arc', () => {
  // a half circle of radius 5 about (5, 0) in two quarters
  const R = mm(5), k = Math.round(R * Math.SQRT1_2);
  const q1 = { id: 'q1', a: [0, 0], mid: [R - k, -k], b: [R, -R], width: W, layer: 'F.Cu', net: 'N' };
  const q2 = { id: 'q2', a: [R, -R], mid: [R + k, -k], b: [2 * R, 0], width: W, layer: 'F.Cu', net: 'N' };
  const out = opt([q1, q2]);
  assert.equal(out.length, 1);
  const a = trackArc(out[0]);
  assert.ok(Math.abs(a.r - R) < 5 && Math.abs(Math.abs(a.sweep) - Math.PI) < 1e-3);
  // an S (turning opposite ways) doesn't
  const q3 = { id: 'q3', a: [R, -R], mid: [R + k, -2 * R + k], b: [2 * R, -2 * R], width: W, layer: 'F.Cu', net: 'N' };
  assert.equal(opt([q1, q3]).length, 2);
});

test('scope: only joins at the touched tracks are looked at', () => {
  const tracks = [tr('a', [0, 0], [5, 0]), tr('b', [5, 0], [10, 0]), tr('c', [0, 5], [5, 5]), tr('d', [5, 5], [10, 5])];
  assert.equal(opt(tracks, {}, new Set(['a'])).length, 3);
});
