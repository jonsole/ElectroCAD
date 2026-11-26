// Routing from and to copper other than pads (#87, #88, #89): Vias, Track ends and points along
// a Track (T-junctions, which split the Track on commit and which the ratsnest counts as joined).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newProject, addComponent, pinPositions } from '../src/renderer/core/project.js';
import { addWire } from '../src/renderer/core/schematic.js';
import { changeList, applyChanges } from '../src/renderer/core/annotate.js';
import { placedPads } from '../src/renderer/core/footprint.js';
import { ratsnest } from '../src/renderer/core/ratsnest.js';
import { startRoute, click, commit } from '../src/renderer/core/router.js';
import { copperTarget, trackOnOtherLayer, splitTrackAt } from '../src/renderer/core/routeEnds.js';
import { STARTER_LIBRARY } from '../src/renderer/library/starter.js';
import { mm, SCH_GRID as G } from '../src/renderer/core/units.js';

const part = (n) => STARTER_LIBRARY.find((p) => p.name === n);
const W = mm(0.25), tol = mm(0.05);
const tr = (id, a, b, net, layer = 'F.Cu', extra = {}) => ({ id, a, b, width: W, layer, net, ...extra });

/** Two resistors joined by a wire, footprints 10 mm apart in a row. */
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
  return { p, from: pad(f1, '2'), to: pad(f2, '1') };
}
const unrouted = (p) => Object.values(ratsnest(p).unrouted).reduce((x, y) => x + y, 0);

test('copperTarget: a via first, then a track end, then a point along a track; nets only', () => {
  const b = { tracks: [tr('t', [0, 0], [mm(10), 0], 'A'), tr('u', [0, mm(5)], [mm(10), mm(5)], ''), tr('k', [0, mm(8)], [mm(10), mm(8)], 'K', 'B.Cu')], vias: [{ id: 'v', at: [mm(10), 0], diameter: mm(0.6), drill: mm(0.3), net: 'A' }] };
  assert.equal(copperTarget(b, [mm(10), mm(0.1)], tol, 'F.Cu').kind, 'via');
  assert.equal(copperTarget(b, [mm(10), mm(0.1)], tol, 'B.Cu').kind, 'via'); // on every layer
  assert.deepEqual(copperTarget(b, [mm(0.05), 0], tol, 'F.Cu'), { kind: 'end', at: [0, 0], net: 'A', layer: 'F.Cu', id: 't' });
  assert.equal(copperTarget(b, [mm(4), mm(0.1)], tol, 'F.Cu'), null); // along needs asking for
  assert.deepEqual(copperTarget(b, [mm(4), mm(0.1)], tol, 'F.Cu', { along: true }), { kind: 'along', at: [mm(4), 0], net: 'A', layer: 'F.Cu', id: 't' });
  assert.equal(copperTarget(b, [mm(4), mm(5)], tol, 'F.Cu', { along: true }), null); // no net
  assert.equal(copperTarget(b, [mm(4), mm(8)], tol, 'F.Cu', { along: true }), null); // another layer
  assert.equal(trackOnOtherLayer(b, [mm(4), mm(8)], tol, 'F.Cu').id, 'k');
  assert.equal(copperTarget(b, [mm(4), mm(8)], tol, 'F.Cu', { along: true, hidden: new Set(['B.Cu']) }), null);
});

test('splitTrackAt makes two tracks meeting there, keeping width, layer, net and lock', () => {
  const b = { tracks: [tr('t', [0, 0], [mm(10), 0], 'A', 'B.Cu', { locked: true })] };
  assert.equal(splitTrackAt(b, 't', [0, 0]), null);                     // an end: nothing to split
  const piece = splitTrackAt(b, 't', [mm(4), 0], 'n');
  assert.deepEqual(b.tracks, [tr('t', [0, 0], [mm(4), 0], 'A', 'B.Cu', { locked: true }), tr('n', [mm(4), 0], [mm(10), 0], 'A', 'B.Cu', { locked: true })]);
  assert.equal(piece.id, 'n');
});

test('a route from a track end to a pad clears the airwire (#87)', () => {
  const { p, from, to } = board();
  p.board.tracks.push(tr('s', from.at, [mm(3), 0], from.net));
  const before = unrouted(p);
  const at = copperTarget(p.board, [mm(3), mm(0.05)], tol, 'F.Cu');
  assert.equal(at.net, from.net);
  let st = startRoute(p, at.at, 'F.Cu', at.net, { corner: '90' });
  assert.equal(st.from, null);
  st = click(p, st, to.at);
  commit(p, st);
  assert.equal(unrouted(p), before - 1);
});

test('a route from a pad finishing on a via of its net clears the airwire (#88)', () => {
  const { p, from, to } = board();
  p.board.tracks.push(tr('s', to.at, [mm(4), mm(4)], to.net));
  p.board.vias.push({ id: 'v', at: [mm(4), mm(4)], diameter: mm(0.6), drill: mm(0.3), from: 'F.Cu', to: 'B.Cu', net: to.net });
  const before = unrouted(p);
  const at = copperTarget(p.board, [mm(4), mm(4.1)], tol, 'F.Cu');
  assert.equal(at.kind, 'via');
  let st = startRoute(p, from.at, 'F.Cu', from.net, { corner: '90', pad: from });
  st = click(p, st, at.at);
  commit(p, st);
  assert.equal(unrouted(p), before - 1);
});

test('a T-junction: branching off a track splits it on commit, and the ratsnest joins a T (#89)', () => {
  const { p, from, to } = board();
  // a track from the first pad that passes under the second, not ending on it
  p.board.tracks.push(tr('s', from.at, [mm(15), 0], from.net));
  const before = unrouted(p);
  assert.ok(before >= 1);
  const at = copperTarget(p.board, [mm(10), mm(0.05)], tol, 'F.Cu', { along: true });
  assert.equal(at.kind, 'along');
  let st = startRoute(p, at.at, 'F.Cu', at.net, { corner: '90' });
  st = { ...click(p, st, to.at), joins: [{ id: at.id, at: at.at }] };
  commit(p, st);
  assert.equal(unrouted(p), before - 1);
  const pieces = p.board.tracks.filter((t) => t.id === 's' || (t.a[0] === mm(10) && t.a[1] === 0 && t.b[0] === mm(15)));
  assert.equal(pieces.length, 2);                                        // split at the T
  // an unsplit T (as imported) counts as joined too
  const q = board();
  q.p.board.tracks.push(tr('s', q.from.at, [mm(15), 0], q.from.net), tr('b', [mm(10), 0], q.to.at, q.to.net));
  assert.equal(unrouted(q.p), 0);
});
