// Chamfered pads (#70): a rectangle with its corners cut; a square at 0.2929 is a regular octagon,
// as Eagle's octagon pads are. Collision shape, Gerber (OC8-style polygon aperture or a region).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chamferPts, padShape, isOctagon, OCTAGON, shapeDistance } from '../src/renderer/core/collision.js';
import { newProject, addComponent, footprintRef } from '../src/renderer/core/project.js';
import { changeList, applyChanges } from '../src/renderer/core/annotate.js';
import { rectOutline } from '../src/renderer/core/board.js';
import { fabFiles } from '../src/renderer/core/fab.js';
import { readGerber } from '../src/renderer/core/gerber/read.js';
import { STARTER_LIBRARY } from '../src/renderer/library/starter.js';
import { mm, SCH_GRID as G } from '../src/renderer/core/units.js';

test('a regular octagon: eight equal sides, flat to flat as wide as the pad', () => {
  const d = mm(2), pts = chamferPts(d, d);
  assert.equal(pts.length, 8);
  const sides = pts.map((p, i) => Math.hypot(pts[(i + 1) % 8][0] - p[0], pts[(i + 1) % 8][1] - p[1]));
  for (const s of sides) assert.ok(Math.abs(s - sides[0]) < 1, `sides ${sides}`);
  assert.equal(Math.max(...pts.map((p) => p[0])) - Math.min(...pts.map((p) => p[0])), d);
  // some corners only
  assert.equal(chamferPts(d, d, 0.25, ['tl']).length, 5);
  assert.ok(isOctagon({ shape: 'chamfer', size: [d, d] }) && !isOctagon({ shape: 'chamfer', size: [d, mm(1)] }));
});

test('the collision shape is the octagon: a point near a corner is clear of it, unlike a square', () => {
  const pad = { shape: 'chamfer', size: [mm(2), mm(2)], at: [0, 0] };
  const s = padShape(pad);
  assert.equal(s.type, 'poly'); assert.equal(s.pts.length, 8);
  const corner = { type: 'capsule', a: [mm(0.95), mm(0.95)], b: [mm(0.95), mm(0.95)], r: 0 };
  assert.ok(shapeDistance(s, corner) > 0, 'outside the cut corner');
  assert.ok(shapeDistance(padShape({ ...pad, shape: 'rect' }), corner) <= 0, 'inside a square');
  // turned: still eight points, round the pad
  assert.equal(padShape({ ...pad, rot: 30 }).pts.length, 8);
});

test('Gerber: an octagon pad is an 8-sided polygon aperture (mask grown); other chamfers are regions', async () => {
  const p = newProject('Oct');
  const c = addComponent(p, p.schematic.sheets[0], STARTER_LIBRARY.find((q) => q.name === 'Resistor'), [G * 10, G * 10]).comp;
  c.footprint = footprintRef(p, { library: 'user', footprint: { name: 'OCT', pads: [
    { number: '1', at: [0, 0], shape: 'chamfer', size: [mm(1.6), mm(1.6)], drill: mm(0.8), layers: ['*.Cu', '*.Mask'] },
    { number: '2', at: [mm(2.54), 0], shape: 'chamfer', size: [mm(2), mm(1)], chamfer: 0.25, corners: ['tl', 'br'], layers: ['F.Cu', 'F.Mask'] }], graphics: [] } });
  applyChanges(p, changeList(p));
  p.board.outline = rectOutline([0, 0], [mm(10), mm(10)]);
  p.board.footprints[0].at = [mm(5), mm(5)];
  const f = Object.fromEntries(fabFiles(p, { date: 'd', version: 'v' }).map((x) => [x.name.split('.').pop(), x.text]));
  assert.match(f.GTL, /%ADD\d+P,1\.731\d*X8X22\.5\*%/, 'P aperture, circumscribed 1.6 / cos 22.5°');
  assert.match(f.GTS, /%ADD\d+P,1\.84\d*X8X22\.5\*%/, 'the mask opening, grown');
  assert.match(f.GTL, /G36\*/, 'the part-chamfered pad is a region');
  // placed on the board, the pad keeps its chamfer and corners (two cut: six points)
  const { placedPads, padNets } = await import('../src/renderer/core/footprint.js');
  const placed = placedPads(p, p.board.footprints[0], padNets(p.board)).find((q) => q.number === '2');
  assert.equal(placed.chamfer, 0.25); assert.deepEqual(placed.corners, ['tl', 'br']);
  assert.equal(padShape(placed).pts.length, 6);
  // the reader turns the aperture back into an octagon of the right size
  const g = readGerber(f.GTL);
  assert.ok(g.apertures && [...(g.apertures.values ? g.apertures.values() : Object.values(g.apertures))].some((a) => a.type === 'P' && a.n === 8));
});
