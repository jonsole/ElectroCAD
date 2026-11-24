import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newProject, addComponent, pinPositions } from '../src/renderer/core/project.js';
import { addWire } from '../src/renderer/core/schematic.js';
import { changeList, applyChanges } from '../src/renderer/core/annotate.js';
import { placedPads } from '../src/renderer/core/footprint.js';
import { ratsnest } from '../src/renderer/core/ratsnest.js';
import { CopperIndex, copperIndex, shapeDistance, padShape, netRules, clearanceBetween } from '../src/renderer/core/collision.js';
import { cornerPath, chamferPath, startRoute, step, click, back, flipPosture, commit } from '../src/renderer/core/router.js';
import { STARTER_LIBRARY } from '../src/renderer/library/starter.js';
import { mm, SCH_GRID as G } from '../src/renderer/core/units.js';

const part = (n) => STARTER_LIBRARY.find((p) => p.name === n);
const cap = (a, b, w) => ({ type: 'capsule', a, b, r: w / 2 });

test('collision engine: track–track, track–pad, and clearance per Net class', () => {
  const p = newProject('C');
  const b = p.board;
  // two parallel tracks 0.5 mm apart (centres), 0.25 wide: 0.25 mm gap
  const t1 = cap([0, 0], [mm(10), 0], mm(0.25)), t2 = cap([0, mm(0.5)], [mm(10), mm(0.5)], mm(0.25));
  assert.equal(Math.round(shapeDistance(t1, t2)), mm(0.25));
  const idx = new CopperIndex([{ kind: 'track', id: 'x', net: 'A', layers: new Set(['F.Cu']), shape: t2 }]);
  assert.equal(idx.collisions(b, t1, 'F.Cu', 'B').length, 0);           // 0.25 gap >= 0.2 default
  assert.equal(idx.collisions(b, t1, 'F.Cu', 'A').length, 0);           // same Net: never
  assert.equal(idx.collisions(b, t1, 'B.Cu', 'B').length, 0);           // other layer
  b.netClasses.Power = { trackWidth: mm(0.5), clearance: mm(0.3), viaDrill: mm(0.4), viaDiameter: mm(0.8), nets: ['A'] };
  assert.equal(clearanceBetween(b, 'B', 'a'), mm(0.3));                 // the larger, names regardless of case
  assert.equal(netRules(b, 'A').trackWidth, mm(0.5));
  assert.equal(idx.collisions(b, t1, 'F.Cu', 'B').length, 1);           // now too close
  // a track into a rectangular pad, and past it
  const pad = padShape({ at: [mm(20), 0], size: [mm(1), mm(1)], shape: 'rect', rot: 0 });
  assert.ok(shapeDistance(cap([mm(15), 0], [mm(20), 0], mm(0.25)), pad) < 0);
  assert.equal(Math.round(shapeDistance(cap([mm(15), mm(1)], [mm(25), mm(1)], mm(0.2)), pad)), mm(0.4));
  // a turned pad and an oval
  const turned = padShape({ at: [0, 0], size: [mm(2), mm(0.5)], shape: 'rect', rot: 90 });
  assert.ok(shapeDistance(cap([0, mm(0.9)], [0, mm(0.9)], 0), turned) <= 0);
  assert.equal(padShape({ at: [0, 0], size: [mm(2), mm(1)], shape: 'oval' }).r, mm(0.5));
});

test('corner styles: 90°, 45° and any angle, with the posture flipped by /', () => {
  const a = [0, 0], b = [mm(10), mm(4)];
  assert.deepEqual(cornerPath(a, b, '90', 'a'), [[mm(10), 0], b]);
  assert.deepEqual(cornerPath(a, b, '90', 'b'), [[0, mm(4)], b]);
  assert.deepEqual(cornerPath(a, b, '45', 'a'), [[mm(6), 0], b]);       // straight, then 45°
  assert.deepEqual(cornerPath(a, b, '45', 'b'), [[mm(4), mm(4)], b]);   // 45°, then straight
  assert.deepEqual(cornerPath(a, b, 'any'), [b]);
  assert.deepEqual(cornerPath(a, [mm(5), 0], '45'), [[mm(5), 0]]);
});

test('auto chamfer cuts 90° bends by a length (as Eagle), not 45° ones', () => {
  const sq = chamferPath([[0, 0], [mm(10), 0], [mm(10), mm(10)]], mm(1));
  assert.deepEqual(sq, [[0, 0], [mm(9), 0], [mm(10), mm(1)], [mm(10), mm(10)]]);
  const short = chamferPath([[0, 0], [mm(1), 0], [mm(1), mm(10)]], mm(2));
  assert.deepEqual(short[1], [mm(0.5), 0]);                             // at most half a segment
  const soft = [[0, 0], [mm(6), 0], [mm(10), mm(4)]];
  assert.deepEqual(chamferPath(soft, mm(1)), soft);                     // a 45° bend stays
});

/** Two resistors joined by a wire, annotated, footprints in a row 10 mm apart. */
function board() {
  const p = newProject('R');
  const s = p.schematic.sheets[0];
  const r1 = addComponent(p, s, part('Resistor'), [G * 10, G * 10]).comp, r2 = addComponent(p, s, part('Resistor'), [G * 30, G * 10]).comp;
  const pin = (c, n) => pinPositions(p, s.symbols.find((y) => y.componentId === c.id)).find((x) => x.pin.number === n).at;
  addWire(p, s, [pin(r1, '2'), pin(r2, '1')]);
  applyChanges(p, changeList(p));
  const f1 = p.board.footprints.find((f) => f.componentId === r1.id), f2 = p.board.footprints.find((f) => f.componentId === r2.id);
  f1.at = [0, 0]; f2.at = [mm(10), mm(4)];
  const pad = (f, n) => placedPads(p, f).find((x) => x.number === n);
  return { p, from: pad(f1, '2'), to: pad(f2, '1'), other: pad(f1, '1') };
}

test('the router, stepped with scripted cursor points, proposes and commits the expected tracks', () => {
  const { p, from, to } = board();
  let st = startRoute(p, from.at, 'F.Cu', from.net, { corner: '90' });
  assert.equal(st.width, mm(0.25));
  const idx = copperIndex(p);
  let r = step(p, st, to.at, 'free', idx);
  assert.equal(r.segments.length, 2);                                   // an L to the pad
  assert.ok(r.segments.every((s) => !s.collides), JSON.stringify(r.collisions.map((c) => c.id)));
  st = flipPosture(st);
  r = step(p, st, to.at, 'free', idx);
  assert.deepEqual(r.segments[0].b, [from.at[0], to.at[1]]);            // the other L
  st = click(p, st, [mm(3), mm(4)]);
  assert.equal(st.points.length, 3);
  st = back(st);
  assert.equal(st.points.length, 2);
  st = click(p, { ...st, points: [from.at] }, to.at);
  const before = Object.values(ratsnest(p).unrouted).reduce((x, y) => x + y, 0);
  const tracks = commit(p, st);
  assert.equal(tracks.length, 2);
  assert.ok(tracks.every((t) => t.net === from.net && t.width === mm(0.25) && t.layer === 'F.Cu'));
  assert.equal(Object.values(ratsnest(p).unrouted).reduce((x, y) => x + y, 0), before - 1); // its airwire is gone
});

test('collisions with other Nets show while drawing', () => {
  const { p, from, other } = board();
  const st = startRoute(p, from.at, 'F.Cu', from.net, { corner: 'any' });
  const r = step(p, st, [other.at[0], other.at[1] + mm(0.1)], 'free', copperIndex(p)); // across the other pad
  assert.ok(r.segments[0].collides);
  assert.ok(r.collisions.some((c) => c.kind === 'pad' && c.item.number === '1'));
});
