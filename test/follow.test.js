// Tracks follow what they're joined to (#100, #96 E6, E8, O1): moving, rotating or flipping a
// footprint, or moving copper, brings along the ends of the tracks on it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newProject, addComponent, pinPositions } from '../src/renderer/core/project.js';
import { addWire } from '../src/renderer/core/schematic.js';
import { changeList, applyChanges } from '../src/renderer/core/annotate.js';
import { placedPads, moveFootprints, rotateFootprints } from '../src/renderer/core/footprint.js';
import { ratsnest } from '../src/renderer/core/ratsnest.js';
import { followMoves, pushClear } from '../src/renderer/core/follow.js';
import { moveCopper } from '../src/renderer/core/boardSelect.js';
import { STARTER_LIBRARY } from '../src/renderer/library/starter.js';
import { mm, SCH_GRID as G } from '../src/renderer/core/units.js';

const part = (n) => STARTER_LIBRARY.find((p) => p.name === n);
const W = mm(0.25);

/** R1 and R2 joined by an L: R1.2 right to a corner, down to R2.1's row, right to R2.1. */
function board() {
  const p = newProject('F');
  const s = p.schematic.sheets[0];
  const rs = [10, 30].map((x) => addComponent(p, s, part('Resistor'), [G * x, G * 10]).comp);
  const pin = (c, n) => pinPositions(p, s.symbols.find((y) => y.componentId === c.id)).find((x) => x.pin.number === n).at;
  addWire(p, s, [pin(rs[0], '2'), pin(rs[1], '1')]);
  applyChanges(p, changeList(p));
  const f = rs.map((c) => p.board.footprints.find((x) => x.componentId === c.id));
  f[0].at = [0, 0]; f[1].at = [mm(10), mm(6)];
  const a = placedPads(p, f[0]).find((x) => x.number === '2').at, b = placedPads(p, f[1]).find((x) => x.number === '1').at;
  const net = placedPads(p, f[0]).find((x) => x.number === '2').net;
  p.board.tracks = [
    { id: 't1', a, b: [mm(5), a[1]], width: W, layer: 'F.Cu', net },
    { id: 't2', a: [mm(5), a[1]], b: [mm(5), b[1]], width: W, layer: 'F.Cu', net },
    { id: 't3', a: [mm(5), b[1]], b, width: W, layer: 'F.Cu', net },
  ];
  return { p, f, net };
}
const snap = (p) => ({ footprints: structuredClone(p.board.footprints), tracks: structuredClone(p.board.tracks), vias: structuredClone(p.board.vias) });
const angle = (t) => { const dx = t.b[0] - t.a[0], dy = t.b[1] - t.a[1]; return dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy); };

test('moving a footprint: Free stretches the track on its pad, staying joined', () => {
  const { p, f } = board();
  assert.equal(ratsnest(p).wires.length, 0);
  const before = snap(p);
  moveFootprints(p, [f[0].id], [mm(-1), mm(-2)]);
  const r = followMoves(p, before, { free: true });
  assert.equal(r.changed.length, 1);
  assert.equal(p.board.tracks.length, 3);
  assert.equal(ratsnest(p).wires.length, 0, 'still routed');
});

test('moving a footprint in Shove/Walkaround: the last segment is redrawn with the bend style', () => {
  const { p, f } = board();
  const before = snap(p);
  moveFootprints(p, [f[0].id], [mm(-1), mm(-2)]);
  followMoves(p, before, { corner: '45', posture: 'a' });
  assert.ok(p.board.tracks.length > 3);
  assert.ok(p.board.tracks.every(angle));
  assert.equal(ratsnest(p).wires.length, 0);
});

test('rotating a footprint brings the track end round with the pad', () => {
  const { p, f } = board();
  const before = snap(p);
  rotateFootprints(p, [f[0].id], 90);
  followMoves(p, before, { free: true });
  assert.equal(ratsnest(p).wires.length, 0);
});

test('a locked track stays put and the connection breaks (O1)', () => {
  const { p, f } = board();
  p.board.tracks[0].locked = true;
  const before = snap(p);
  moveFootprints(p, [f[0].id], [mm(-1), mm(-2)]);
  const r = followMoves(p, before, { free: true });
  assert.equal(r.kept, 1);
  assert.deepEqual(p.board.tracks[0], before.tracks[0]);
  assert.equal(ratsnest(p).wires.length, 1);
});

test('moving copper brings along unselected tracks joined to it (E8)', () => {
  const { p } = board();
  const before = snap(p);
  moveCopper(p.board, new Set(['t2']), [mm(1), 0]);
  const r = followMoves(p, before, { free: true });
  assert.equal(r.changed.length, 2);
  assert.equal(ratsnest(p).wires.length, 0);
});

test("Shove pushes other nets' tracks clear of changed copper (pushClear)", () => {
  const { p } = board();
  const c = { id: 'c', a: [mm(-10), mm(12)], b: [mm(10), mm(12)], width: W, layer: 'F.Cu', net: 'N2' };
  p.board.tracks.push(c, { id: 'o', a: [mm(-15), mm(12.3)], b: [mm(15), mm(12.3)], width: W, layer: 'F.Cu', net: 'OTHER' });
  assert.equal(pushClear(p, [c]), 1);
  assert.ok(p.board.tracks.filter((t) => t.net === 'OTHER').every((t) => Math.min(Math.abs(t.a[1] - mm(12)), Math.abs(t.b[1] - mm(12))) >= mm(0.2) || t.a[0] < mm(-10) || t.b[0] > mm(10)));
});
