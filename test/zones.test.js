import { test } from 'node:test';
import assert from 'node:assert/strict';
import ClipperLib from 'clipper-lib';
import { newProject } from '../src/renderer/core/project.js';
import { newZone, zoneInput, fillZones, fillZone, zoneSignatures, boardArea } from '../src/renderer/core/zones.js';
import { shapeDistance, padShape } from '../src/renderer/core/collision.js';
import { rectOutline } from '../src/renderer/core/board.js';
import { mm } from '../src/renderer/core/units.js';

const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const pad = (key, at, net, size = [mm(1), mm(1)], layers = ['F.Cu']) => ({ key, at, size, shape: 'rect', rot: 0, net, layers });
const areaOf = (f) => f.polys.reduce((s, poly) => s + poly.reduce((t, ring) => t + ClipperLib.Clipper.Area(ring.map(([X, Y]) => ({ X, Y }))), 0), 0);
/** The smallest distance from a fill's edges to a shape (a fill ring as a closed polyline). */
function gapTo(f, shape) {
  let m = Infinity;
  for (const poly of f.polys) for (const ring of poly) for (let i = 0; i < ring.length; i++) m = Math.min(m, shapeDistance({ type: 'capsule', a: ring[i], b: ring[(i + 1) % ring.length], r: 0 }, shape));
  return m;
}
const inFill = (f, p) => f.polys.some((poly) => inRing(p, poly[0]) && !poly.slice(1).some((h) => inRing(p, h)));
function inRing(p, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, yi] = pts[i], [xj, yj] = pts[j]; if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside; }
  return inside;
}

function setup() {
  const p = newProject('Z');
  p.board.outline = rectOutline([mm(-5), mm(-5)], [mm(40), mm(30)]);
  return p;
}

test('the fill keeps clearance from other nets\' tracks, vias and pads, by net class', () => {
  const p = setup();
  const z = newZone('F.Cu', 'GND', rect(0, 0, mm(20), mm(10)), { connect: 'solid' });
  p.board.zones.push(z);
  p.board.tracks.push({ id: 't', a: [mm(2), mm(5)], b: [mm(18), mm(5)], width: mm(0.25), layer: 'F.Cu', net: 'SIG' });
  p.board.tracks.push({ id: 'tb', a: [mm(2), mm(8)], b: [mm(18), mm(8)], width: mm(0.25), layer: 'B.Cu', net: 'SIG' }); // other layer
  p.board.vias.push({ id: 'v', at: [mm(10), mm(2)], drill: mm(0.3), diameter: mm(0.6), from: 'F.Cu', to: 'B.Cu', net: 'SIG' });
  const input = zoneInput(p);
  input.pads.push(pad('U1:1', [mm(15), mm(2)], 'VCC'), pad('G:1', [mm(1), mm(1)], 'GND'));
  let f = fillZones(input).get(z.id);
  const c = p.board.rules.clearance;
  const track = { type: 'capsule', a: [mm(2), mm(5)], b: [mm(18), mm(5)], r: mm(0.125) };
  assert.ok(Math.abs(gapTo(f, track) - c) < 10_000, `track gap ${gapTo(f, track)}`);
  assert.ok(gapTo(f, { type: 'capsule', a: [mm(10), mm(2)], b: [mm(10), mm(2)], r: mm(0.3) }) >= c - 10_000);
  assert.ok(gapTo(f, padShape(input.pads[0])) >= c - 10_000);
  assert.ok(inFill(f, [mm(10), mm(8)]), 'the B.Cu track doesn\'t cut the F.Cu zone');
  // a Net class with more clearance, and the Zone's own clearance
  p.board.netClasses.Fat = { trackWidth: mm(0.25), clearance: mm(0.5), viaDrill: mm(0.3), viaDiameter: mm(0.6), nets: ['SIG'] };
  const withPads = () => { const i = zoneInput(p); i.pads.push(...input.pads); return i; };
  f = fillZones(withPads()).get(z.id);
  assert.ok(gapTo(f, track) >= mm(0.5) - 10_000);
  z.clearance = mm(0.8);
  f = fillZones(withPads()).get(z.id);
  assert.ok(gapTo(f, track) >= mm(0.8) - 10_000);
  // and the board edge, by the edge clearance
  const z2 = newZone('F.Cu', '', rect(mm(-10), mm(-10), mm(0), mm(0)));
  p.board.zones = [z2];
  f = fillZones(zoneInput(p)).get(z2.id);
  assert.equal(inFill(f, [mm(-4.6), mm(-2)]), true);
  assert.equal(inFill(f, [mm(-4.8), mm(-2)]), false);               // within 0.3 mm of the edge
});

test('thermal reliefs: four spokes in the open, fewer where a spoke would break clearance', () => {
  const p = setup();
  const z = newZone('F.Cu', 'GND', rect(0, 0, mm(20), mm(10)));
  p.board.zones.push(z);
  const input = zoneInput(p);
  input.pads.push(pad('U1:1', [mm(5), mm(5)], 'GND'));
  input.pads.push(pad('U1:2', [mm(12), mm(5)], 'GND'));
  // a foreign track hugging pad 2's right side: no spoke that way
  input.tracks.push({ id: 't', a: [mm(13.3), mm(1)], b: [mm(13.3), mm(9)], width: mm(0.25), layer: 'F.Cu', net: 'SIG' });
  const f = fillZones(input).get(z.id);
  const sp = Object.fromEntries(f.thermals.map((t) => [t.key, t.spokes]));
  assert.equal(sp['U1:1'], 4);
  assert.equal(sp['U1:2'], 3);
  // the gap round the pad is clear, except where the spokes cross it
  assert.equal(inFill(f, [mm(5.75), mm(5.75)]), false);              // a corner of the gap
  assert.equal(inFill(f, [mm(5.75), mm(5)]), true);                  // on the spoke
  // solid: no reliefs
  z.connect = 'solid';
  const s = fillZones(input).get(z.id);
  assert.equal(inFill(s, [mm(5.75), mm(5.75)]), true);
  assert.equal(s.thermals.length, 0);
});

test('priority: the higher-priority zone wins where they overlap, the other keeps clear of it', () => {
  const p = setup();
  const lo = newZone('F.Cu', 'GND', rect(0, 0, mm(20), mm(10)), { priority: 0 });
  const hi = newZone('F.Cu', 'VCC', rect(mm(10), 0, mm(30), mm(10)), { priority: 1 });
  p.board.zones.push(lo, hi);
  const input = zoneInput(p);
  input.pads.push(pad('A:1', [mm(2), mm(5)], 'GND'), pad('B:1', [mm(25), mm(5)], 'VCC'));
  const fills = fillZones(input);
  assert.ok(inFill(fills.get(hi.id), [mm(15), mm(5)]));
  assert.ok(!inFill(fills.get(lo.id), [mm(15), mm(5)]));
  assert.ok(inFill(fills.get(lo.id), [mm(9.5), mm(5)]));
  assert.ok(!inFill(fills.get(lo.id), [mm(9.9), mm(5)]));             // the clearance to VCC
  // swapped priorities: the other way round
  lo.priority = 2;
  const again = fillZones(input);
  assert.ok(inFill(again.get(lo.id), [mm(15), mm(5)]));
  assert.ok(!inFill(again.get(hi.id), [mm(15), mm(5)]));
  // same Net: both fill, no gap
  hi.net = 'GND'; input.pads[1].net = 'GND';
  const sameNet = fillZones(input);
  assert.ok(inFill(sameNet.get(hi.id), [mm(15), mm(5)]) && inFill(sameNet.get(lo.id), [mm(15), mm(5)]));
});

test('keepIslands keeps the pieces with none of the zone\'s own copper', () => {
  const p = setup();
  const z = newZone('F.Cu', 'GND', rect(0, 0, mm(20), mm(10)), { connect: 'solid' });
  z.keepIslands = true;
  p.board.zones.push(z);
  p.board.tracks.push({ id: 'w', a: [mm(10), mm(-1)], b: [mm(10), mm(11)], width: mm(0.5), layer: 'F.Cu', net: 'SIG' });
  const input = zoneInput(p);
  input.pads.push(pad('A:1', [mm(3), mm(5)], 'GND'));
  const f = fillZones(input).get(z.id);
  assert.equal(f.polys.length, 2);
  assert.equal(f.islands, 0);
});

test('islands with none of the zone\'s own copper are removed', () => {
  const p = setup();
  const z = newZone('F.Cu', 'GND', rect(0, 0, mm(20), mm(10)), { connect: 'solid' });
  p.board.zones.push(z);
  // a wall of foreign track cuts the zone in two; only the left part has a GND pad
  p.board.tracks.push({ id: 'w', a: [mm(10), mm(-1)], b: [mm(10), mm(11)], width: mm(0.5), layer: 'F.Cu', net: 'SIG' });
  const input = zoneInput(p);
  input.pads.push(pad('A:1', [mm(3), mm(5)], 'GND'));
  const f = fillZones(input).get(z.id);
  assert.equal(f.polys.length, 1);
  assert.equal(f.islands, 1);
  assert.ok(inFill(f, [mm(5), mm(5)]) && !inFill(f, [mm(15), mm(5)]));
  // a GND track on the right keeps that island
  input.tracks.push({ id: 'g', a: [mm(14), mm(5)], b: [mm(16), mm(5)], width: mm(0.25), layer: 'F.Cu', net: 'GND' });
  const g = fillZones(input).get(z.id);
  assert.equal(g.polys.length, 2);
  // a zone with no Net keeps every piece
  z.net = '';
  assert.equal(fillZones(zoneInput(p)).get(z.id).polys.length, 2);
});

test('signatures change only for zones an edit touched', () => {
  const p = setup();
  const a = newZone('F.Cu', 'GND', rect(0, 0, mm(10), mm(10)));
  const b = newZone('F.Cu', 'GND', rect(mm(20), 0, mm(30), mm(10)));
  p.board.zones.push(a, b);
  const s0 = zoneSignatures(zoneInput(p));
  p.board.tracks.push({ id: 't', a: [mm(2), mm(5)], b: [mm(8), mm(5)], width: mm(0.25), layer: 'F.Cu', net: 'SIG' });
  const s1 = zoneSignatures(zoneInput(p));
  assert.notEqual(s0.get(a.id), s1.get(a.id));
  assert.equal(s0.get(b.id), s1.get(b.id));
  p.board.tracks[0].layer = 'B.Cu';
  const s2 = zoneSignatures(zoneInput(p));
  assert.equal(s2.get(a.id), s0.get(a.id));
  // a higher-priority zone moving over b changes b
  const c = newZone('F.Cu', 'VCC', rect(mm(40), 0, mm(50), mm(10)), { priority: 5 });
  p.board.zones.push(c);
  const s3 = zoneSignatures(zoneInput(p));
  c.outline = rect(mm(25), 0, mm(35), mm(10));
  const s4 = zoneSignatures(zoneInput(p));
  assert.notEqual(s3.get(b.id), s4.get(b.id));
  assert.equal(s3.get(a.id), s4.get(a.id));
});

test('the board area follows the outline, cut-outs as holes', () => {
  const area = boardArea([...rectOutline([0, 0], [mm(10), mm(10)]), { type: 'circle', c: [mm(5), mm(5)], r: mm(2), layer: 'Edge.Cuts', fill: 'none' }]);
  assert.equal(area.length, 2);
  assert.equal(boardArea([]), null);
  const p = setup();
  p.board.outline = [...rectOutline([0, 0], [mm(20), mm(20)]), { type: 'circle', c: [mm(10), mm(10)], r: mm(3), layer: 'Edge.Cuts', fill: 'none' }];
  const z = newZone('F.Cu', '', rect(0, 0, mm(20), mm(20)));
  const f = fillZone(zoneInput(p), z);
  assert.ok(!inFill(f, [mm(10), mm(10)]) && inFill(f, [mm(5), mm(5)]));
  assert.ok(areaOf(f) < mm(20) * mm(20));
});

import { ZoneFiller } from '../src/renderer/board/zoneFiller.js';

test('refill: only changed zones are sent, superseded results are thrown away, whenFilled waits', async () => {
  const p = setup();
  const a = newZone('F.Cu', '', rect(0, 0, mm(10), mm(10)));
  const b = newZone('F.Cu', '', rect(mm(20), 0, mm(30), mm(10)));
  p.board.zones.push(a, b);
  let calls = 0;
  const f = new ZoneFiller(() => { calls++; }, { worker: () => null });
  assert.deepEqual(f.update(p).sort(), [a.id, b.id].sort());
  assert.ok(f.busy);
  await f.whenFilled();
  assert.ok(f.fills.has(a.id) && f.fills.has(b.id) && calls === 1);
  assert.deepEqual(f.update(p), []);                                   // nothing changed
  p.board.tracks.push({ id: 't', a: [mm(2), mm(5)], b: [mm(8), mm(5)], width: mm(0.25), layer: 'F.Cu', net: 'SIG' });
  assert.deepEqual(f.update(p), [a.id]);                               // only the zone the track is in
  // a second edit before the first result: the first result is superseded
  p.board.tracks[0].b = [mm(9), mm(5)];
  const first = f.seq;
  f.update(p);
  f._done({ seq: first, fills: [[a.id, { polys: [], thermals: [], islands: 0 }]] });
  assert.ok(f.busy, 'the old result was dropped');
  await f.whenFilled();
  assert.ok(f.fills.get(a.id).polys.length > 0);
  // a dragged board: the touched zone is stale
  const moved = structuredClone(p.board); moved.tracks[0].a = [mm(1), mm(5)];
  assert.deepEqual([...f.staleIds(zoneInput(p, moved))], [a.id]);
  // deleted zones drop their fills
  p.board.zones = [b];
  f.update(p);
  assert.ok(!f.fills.has(a.id));
});

test('refill (#73): each layer goes to its own worker, with that layer\'s copper, and the fills are the same as all at once', async () => {
  const p = setup();
  const f1 = newZone('F.Cu', 'GND', rect(0, 0, mm(20), mm(20)));
  const f2 = newZone('F.Cu', 'VCC', rect(mm(5), mm(5), mm(15), mm(15)), { priority: 1 });
  const b1 = newZone('B.Cu', 'GND', rect(0, 0, mm(20), mm(20)));
  p.board.zones.push(f1, f2, b1);
  p.board.tracks.push({ id: 'tf', a: [mm(2), mm(2)], b: [mm(18), mm(2)], width: mm(0.25), layer: 'F.Cu', net: 'SIG' });
  p.board.tracks.push({ id: 'tb', a: [mm(2), mm(18)], b: [mm(18), mm(18)], width: mm(0.25), layer: 'B.Cu', net: 'SIG' });
  p.board.vias.push({ id: 'v', at: [mm(10), mm(3)], diameter: mm(0.6), drill: mm(0.3), net: 'SIG' });
  const sent = [];
  // a stand-in Worker that answers on a timer, as the real one does
  const fake = () => { const w = { postMessage(m) { sent.push(m); setTimeout(() => w.onmessage({ data: { seq: m.seq, fills: [...fillZones(m.input, m.ids, new Map(m.known))] } }), 0); } }; return w; };
  const f = new ZoneFiller(() => {}, { worker: fake });
  f.update(p);
  await f.whenFilled();
  assert.equal(sent.length, 2, 'one message per layer');
  const front = sent.find((m) => m.ids.includes(f1.id)), back = sent.find((m) => m.ids.includes(b1.id));
  assert.deepEqual(front.ids.sort(), [f1.id, f2.id].sort());
  assert.ok(front.input.tracks.every((t) => t.layer === 'F.Cu') && back.input.tracks.every((t) => t.layer === 'B.Cu'));
  assert.equal(f.workers.size, 2);
  const all = fillZones(zoneInput(p));
  for (const id of [f1.id, f2.id, b1.id]) assert.deepEqual(f.fills.get(id), all.get(id));
});
