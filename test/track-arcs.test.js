// Arc Tracks (#93): a Track with a `mid` point is an arc through a, mid and b. Its copper is
// measured along the curve (clearance, hit-testing, DRC, zones), it splits into two arcs, keeps
// its shape when its ends move, and goes into the Gerber as a true G02/G03 arc.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trackArc, trackPoints, trackShape, trackLength, nearestOnTrack, splitGeometry, withEnds, trackBox } from '../src/renderer/core/trackGeom.js';
import { shapeDistance, copperIndex } from '../src/renderer/core/collision.js';
import { newProject } from '../src/renderer/core/project.js';
import { readGerber } from '../src/renderer/core/gerber/read.js';
import { fabFiles } from '../src/renderer/core/fab.js';
import { splitTrackAt } from '../src/renderer/core/routeEnds.js';
import { dragSegment, dragCorner } from '../src/renderer/core/drag.js';
import { runDrc } from '../src/renderer/core/drc.js';
import { mm } from '../src/renderer/core/units.js';

// a half circle of radius 5 mm bulging up (-Y) from (0, 0) to (10, 0)
const R = mm(5);
const arc = { id: 'arc', a: [0, 0], mid: [R, -R], b: [2 * R, 0], width: mm(0.25), layer: 'F.Cu', net: 'A' };
const onCircle = (p, tol = 1500) => Math.abs(Math.hypot(p[0] - R, p[1]) - R) <= tol;

test('an arc track: its circle, flattened points, length, box and nearest point', () => {
  const k = trackArc(arc);
  assert.ok(Math.abs(k.r - R) < 1 && Math.abs(k.c[0] - R) < 1 && Math.abs(k.c[1]) < 1);
  const pts = trackPoints(arc);
  assert.deepEqual(pts[0], arc.a); assert.deepEqual(pts[pts.length - 1], arc.b);
  assert.ok(pts.every((p) => onCircle(p)) && pts.some((p) => p[1] < -R * 0.99), 'on the circle, through the top');
  assert.ok(pts.every((p) => p[1] <= 0), 'bulging the way mid says');
  assert.ok(Math.abs(trackLength(arc) - Math.PI * R) < 10);
  const bx = trackBox(arc);
  assert.ok(bx.y0 < -R && bx.y1 > 0 && bx.x0 < 0 && bx.x1 > 2 * R);
  const n = nearestOnTrack(arc, [R, -2 * R]);
  assert.ok(Math.abs(n.d - R) < 10 && Math.abs(n.s - 0.5) < 1e-3);
  assert.equal(nearestOnTrack(arc, [-mm(1), mm(1)]).at, arc.a);   // past an end: the end
  assert.equal(trackArc({ ...arc, mid: undefined }), null);
});

test('clearance is measured to the curve, not its chord', () => {
  // a straight track just above the arc's top: near the curve, 5 mm from the chord
  const over = { type: 'capsule', a: [mm(3), -R - mm(0.3)], b: [mm(7), -R - mm(0.3)], r: mm(0.125) };
  const d = shapeDistance(trackShape(arc), over);
  assert.ok(Math.abs(d - mm(0.05)) < 2000, `${d}`);
  assert.ok(shapeDistance({ type: 'capsule', a: arc.a, b: arc.b, r: arc.width / 2 }, over) > mm(4), 'the chord would miss it');
  // in the copper index, as DRC and the router see it
  const p = newProject('A');
  p.board.tracks = [arc, { id: 'o', a: over.a, b: over.b, width: mm(0.25), layer: 'F.Cu', net: 'B' }];
  const idx = copperIndex(p);
  const hits = idx.collisions(p.board, trackShape(arc), 'F.Cu', 'A');
  assert.deepEqual(hits.map((h) => h.id), ['o']);
  const drc = runDrc(p).filter((v) => v.rule === 'clearance');
  assert.ok(drc.some((v) => v.items.includes('arc') && v.items.includes('o')), JSON.stringify(drc.map((v) => v.message)));
});

test('splitting an arc gives two arcs of its circle; moving its ends keeps its shape', () => {
  const at = nearestOnTrack(arc, [R, -2 * R]).at;
  const [g1, g2] = splitGeometry(arc, at);
  for (const g of [g1, g2]) { assert.ok(g.mid && onCircle(g.mid) && onCircle(g.a) && onCircle(g.b)); }
  const b = { tracks: [{ ...arc }] };
  const piece = splitTrackAt(b, 'arc', at, 'arc2');
  assert.ok(piece.mid && b.tracks[0].mid);
  assert.ok(Math.abs(trackLength(b.tracks[0]) + trackLength(piece) - trackLength(arc)) < 50);
  // doubled ends: twice the radius, same half circle
  const big = withEnds(arc, [0, 0], [4 * R, 0]);
  assert.ok(Math.abs(trackArc(big).r - 2 * R) < 2);
  assert.ok(Math.abs(big.mid[1] + 2 * R) < 2);
  assert.equal(withEnds({ ...arc, mid: undefined }, [0, 0], [1, 1]).mid, undefined);
});

test('dragging an arc changes its bulge; dragging its corner keeps it an arc', () => {
  const p = newProject('A');
  const tail = { id: 's', a: arc.b, b: [3 * R, 0], width: arc.width, layer: 'F.Cu', net: 'A' };
  p.board.tracks = [{ ...arc }, tail];
  const r = dragSegment(p, p.board, 'arc', [0, mm(2)]);
  const moved = r.tracks.find((t) => t.id === 'arc');
  assert.deepEqual(moved.a, arc.a); assert.deepEqual(moved.b, arc.b);
  assert.deepEqual(moved.mid, [R, -R + mm(2)]);
  const flat = dragSegment(p, p.board, 'arc', [0, R]).tracks.find((t) => t.id === 'arc');
  assert.equal(flat.mid, undefined, 'pulled flat: straight');
  const c = dragCorner(p, p.board, arc.b, [2 * R + mm(1), mm(1)], 'F.Cu');
  const a2 = c.tracks.find((t) => t.id === 'arc');
  assert.ok(a2.mid); assert.deepEqual(a2.b, [2 * R + mm(1), mm(1)]);
  assert.ok(c.tracks.filter((t) => !t.mid).every((t) => !('mid' in t)));
});

test('Gerber: an arc track is a true circular draw that reads back on the same circle', () => {
  const p = newProject('A');
  p.board.tracks = [arc];
  const gtl = fabFiles(p, { date: 'd', version: 'v' }).find((f) => f.layer === 'F.Cu').text;
  assert.match(gtl, /G75\*/);
  assert.match(gtl, /G02\*\nX10000000Y0I5000000J0D01\*/);
  const g = readGerber(gtl);
  const o = g.objects.find((x) => x.kind === 'arc');
  assert.ok(o, 'an arc object');
  assert.ok(Math.abs(o.c[0] - R) < 2 && Math.abs(o.c[1]) < 2);
  // Y is up in the file: the arc bulges to +Y there, which (from a to b) is clockwise
  assert.equal(o.cw, true);
});
