// Through-hole pads on inner layers (#82): their own (round) size there, in the inner Gerbers, zone
// clearance and the collision index; and a zone's minimum width, which takes away slivers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newProject, addComponent, footprintRef } from '../src/renderer/core/project.js';
import { changeList, applyChanges } from '../src/renderer/core/annotate.js';
import { rectOutline, setCopperLayers } from '../src/renderer/core/board.js';
import { newZone, zoneInput, fillZones } from '../src/renderer/core/zones.js';
import { fabFiles } from '../src/renderer/core/fab.js';
import { copperIndex } from '../src/renderer/core/collision.js';
import { padOnLayer, padByLayers, placedPads, padNets } from '../src/renderer/core/footprint.js';
import { STARTER_LIBRARY } from '../src/renderer/library/starter.js';
import { mm, SCH_GRID as G } from '../src/renderer/core/units.js';

const part = (n) => STARTER_LIBRARY.find((p) => p.name === n);

function board() {
  const p = newProject('Inner');
  const s = p.schematic.sheets[0];
  const c = addComponent(p, s, part('Resistor'), [G * 10, G * 10]).comp;
  c.footprint = footprintRef(p, { library: 'user', footprint: { name: 'TH', pads: [
    { number: '1', at: [0, 0], shape: 'rect', size: [mm(1.7), mm(1.7)], drill: mm(1), innerSize: mm(1.4), layers: ['*.Cu', '*.Mask'] },
    { number: '2', at: [mm(2.54), 0], shape: 'circle', size: [mm(1.7), mm(1.7)], drill: mm(1), layers: ['*.Cu', '*.Mask'] }], graphics: [] } });
  applyChanges(p, changeList(p));
  setCopperLayers(p, 4);
  p.board.outline = rectOutline([0, 0], [mm(20), mm(20)]);
  p.board.footprints[0].at = [mm(10), mm(10)];
  return p;
}

test('a pad with an inner size is round, that size, on the inner layers only', () => {
  const pad = { shape: 'rect', size: [10, 10], innerSize: 8, at: [0, 0] };
  assert.deepEqual(padOnLayer(pad, 'In1.Cu').size, [8, 8]); assert.equal(padOnLayer(pad, 'In2.Cu').shape, 'circle');
  assert.equal(padOnLayer(pad, 'F.Cu'), pad); assert.equal(padOnLayer({ ...pad, innerSize: undefined }, 'In1.Cu').shape, 'rect');
  const parts = padByLayers(pad, ['F.Cu', 'In1.Cu', 'In2.Cu', 'B.Cu']);
  assert.deepEqual(parts.map((x) => x.layers), [['F.Cu', 'B.Cu'], ['In1.Cu', 'In2.Cu']]);
});

test('inner Gerbers flash the inner size; outer ones the pad; the collision index has both', () => {
  const p = board();
  const files = Object.fromEntries(fabFiles(p, { date: 'd', version: 'v' }).map((f) => [f.layer, f.text]));
  assert.match(files['In1.Cu'], /%ADD\d+C,1\.400000\*%/, 'a 1.4 mm round flash inside');
  assert.ok(!/R,1\.700000X1\.700000/.test(files['In1.Cu']), 'not the square pad');
  assert.match(files['F.Cu'], /R,1\.700000X1\.700000/, 'the square pad outside');
  const items = copperIndex(p).items.filter((it) => it.kind === 'pad' && it.item.number === '1');
  assert.equal(items.length, 2);
  assert.ok(items.some((it) => it.layers.has('In1.Cu') && it.shape.type === 'capsule' && it.shape.r === mm(0.7)));
});

test('an inner zone keeps its clearance from the inner size, not the outer pad', () => {
  const p = board();
  p.board.zones.push({ ...newZone('In1.Cu', 'OTHER', [[mm(1), mm(1)], [mm(19), mm(1)], [mm(19), mm(19)], [mm(1), mm(19)]]), id: 'z', keepIslands: true, clearance: mm(0.2) });
  const fill = fillZones(zoneInput(p)).get('z');
  // the hole round pad 1 (at 10, 10): its nearest fill point is the inner radius + clearance away
  const pts = fill.polys.flatMap((poly) => poly.slice(1)).flat();
  const d = Math.min(...pts.map(([x, y]) => Math.hypot(x - mm(10), y - mm(10))));
  assert.ok(d > mm(0.7 + 0.2) - mm(0.02) && d < mm(0.85 + 0.2), `clearance ring at ${d / 1e6} mm`);
});

test('a zone\'s minimum width takes away copper narrower than it', () => {
  const p = board();
  // two vias of another net 1.0 mm apart: with 0.2 mm clearance the copper between them is 0.0-0.1 mm wide
  p.board.vias.push({ id: 'a', at: [mm(5), mm(5)], drill: mm(0.3), diameter: mm(0.6), from: 'F.Cu', to: 'B.Cu', net: 'X' });
  p.board.vias.push({ id: 'b', at: [mm(6.05), mm(5)], drill: mm(0.3), diameter: mm(0.6), from: 'F.Cu', to: 'B.Cu', net: 'Y' });
  const z = { ...newZone('In2.Cu', 'GND', [[mm(1), mm(1)], [mm(19), mm(1)], [mm(19), mm(19)], [mm(1), mm(19)]]), id: 'z', keepIslands: true, clearance: mm(0.2) };
  p.board.zones.push(z);
  const between = (f) => f.polys.some((poly) => poly.some((ring) => ring.some(([x, y]) => x > mm(5.45) && x < mm(5.6) && Math.abs(y - mm(5)) < mm(0.1))));
  assert.ok(between(fillZones(zoneInput(p)).get('z')), 'without a minimum width a sliver runs between them');
  z.minWidth = mm(0.254);
  assert.ok(!between(fillZones(zoneInput(p)).get('z')), 'with 0.254 mm it is gone');
});

test('a through-hole pad of the zone\'s own net gets its thermal spokes on an inner plane (not mistaken for a hole)', () => {
  const p = board();
  // pad 1 on net PWR (the Board's record of the Schematic)
  const net = 'PWR';
  p.board.annotation.nets = { ...(p.board.annotation.nets || {}), [net]: [`${p.board.footprints[0].componentId}:1`] };
  // a zone clearance large enough that a mistaken "hole" round the drill would cover the spokes' way out
  const z = { ...newZone('In1.Cu', net, [[mm(1), mm(1)], [mm(19), mm(1)], [mm(19), mm(19)], [mm(1), mm(19)]]), id: 'z', clearance: mm(0.4) };
  p.board.zones.push(z);
  const fill = fillZones(zoneInput(p)).get('z');
  const th = fill.thermals.filter((t) => t.spokes > 0);
  assert.ok(th.length === 1 && th[0].spokes >= 2, `spokes: ${JSON.stringify(fill.thermals)}`);
});
