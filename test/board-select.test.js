// Box selection on the Board and rip-up: what a box takes (window or crossing), moving tracks and
// vias with a group, and ripping a run of copper back to an airwire.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newProject, addComponent, pinPositions } from '../src/renderer/core/project.js';
import { addWire } from '../src/renderer/core/schematic.js';
import { changeList, applyChanges } from '../src/renderer/core/annotate.js';
import { placedPads } from '../src/renderer/core/footprint.js';
import { ratsnest } from '../src/renderer/core/ratsnest.js';
import { boardItemsInBox, moveCopper } from '../src/renderer/core/boardSelect.js';
import { ripupRun, ripUp } from '../src/renderer/core/copper.js';
import { STARTER_LIBRARY } from '../src/renderer/library/starter.js';
import { mm, SCH_GRID as G } from '../src/renderer/core/units.js';

const part = (n) => STARTER_LIBRARY.find((p) => p.name === n);
const W = mm(0.25);

/** R1 and R2 joined by a routed L (pad, corner, via, pad) and R3 off to the side. */
function board() {
  const p = newProject('R');
  const s = p.schematic.sheets[0];
  const rs = [10, 30, 50].map((x) => addComponent(p, s, part('Resistor'), [G * x, G * 10]).comp);
  const pin = (c, n) => pinPositions(p, s.symbols.find((y) => y.componentId === c.id)).find((x) => x.pin.number === n).at;
  addWire(p, s, [pin(rs[0], '2'), pin(rs[1], '1')]);
  applyChanges(p, changeList(p));
  const f = rs.map((c) => p.board.footprints.find((x) => x.componentId === c.id));
  f[0].at = [0, 0]; f[1].at = [mm(10), mm(5)]; f[2].at = [mm(30), mm(30)];
  const a = placedPads(p, f[0]).find((x) => x.number === '2'), b = placedPads(p, f[1]).find((x) => x.number === '1');
  const net = a.net, c1 = [mm(5), a.at[1]], v = [mm(5), mm(3)];
  p.board.tracks.push({ id: 't1', a: a.at, b: c1, width: W, layer: 'F.Cu', net }, { id: 't2', a: c1, b: v, width: W, layer: 'F.Cu', net }, { id: 't3', a: v, b: [v[0], b.at[1]], width: W, layer: 'F.Cu', net }, { id: 't4', a: [v[0], b.at[1]], b: b.at, width: W, layer: 'F.Cu', net });
  p.board.vias.push({ id: 'v1', at: v, drill: mm(0.3), diameter: mm(0.6), from: 'F.Cu', to: 'B.Cu', net });
  return { p, f, a, b };
}

test('a box takes what is wholly inside it (window) or what it touches (crossing)', () => {
  const { p, f } = board();
  // around R1 and the first part of the route: R1, t1, t2 and the via, not R2 or what reaches it
  const r = { x0: -mm(3), y0: -mm(2), x1: mm(6), y1: mm(3.5) };
  const win = boardItemsInBox(p, p.board, r, 'window');
  assert.deepEqual(win.fps, [f[0].id]);
  assert.deepEqual(win.copper.sort(), ['t1', 't2', 'v1']);
  // crossing: t3 starts inside the box too
  const cross = boardItemsInBox(p, p.board, r, 'crossing');
  assert.ok(cross.copper.includes('t3') && !cross.copper.includes('t4'));
  // a crossing box across a track's middle only, nothing else
  const thin = boardItemsInBox(p, p.board, { x0: mm(4.9), y0: mm(1), x1: mm(5.1), y1: mm(1.2) }, 'crossing');
  assert.deepEqual(thin.copper, ['t2']);
  // hidden layers are left out
  assert.ok(!boardItemsInBox(p, p.board, r, 'crossing', new Set(['F.Cu'])).copper.includes('t3'));
});

test('moving a group moves its tracks and vias (locked ones stay)', () => {
  const { p } = board();
  p.board.tracks.find((t) => t.id === 't2').locked = true;
  moveCopper(p.board, new Set(['t1', 't2', 'v1']), [mm(1), 0]);
  assert.equal(p.board.tracks.find((t) => t.id === 't1').b[0], mm(6));
  assert.equal(p.board.tracks.find((t) => t.id === 't2').a[0], mm(5));
  assert.deepEqual(p.board.vias[0].at, [mm(6), mm(3)]);
});

test('rip-up takes the run from pad to pad back to an airwire', () => {
  const { p } = board();
  assert.equal(ratsnest(p).wires.length, 0);
  const run = ripupRun(p, p.board, 't2');
  assert.deepEqual([...run].sort(), ['t1', 't2', 't3', 't4', 'v1']);
  // a stub of the net beyond the pad isn't part of this run
  const { a } = board();
  p.board.tracks.push({ id: 'stub', a: p.board.tracks[0].a, b: [a.at[0], a.at[1] - mm(3)], width: W, layer: 'F.Cu', net: p.board.tracks[0].net });
  assert.ok(!ripupRun(p, p.board, 't2').has('stub'));
  assert.deepEqual(ripUp(p.board, run), { tracks: 4, vias: 1 });
  assert.deepEqual(p.board.tracks.map((t) => t.id), ['stub']);
  assert.equal(ratsnest(p).wires.length, 1);
});
