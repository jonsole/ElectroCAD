import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newProject, serialize, deserialize, projectProblems } from '../src/renderer/core/project.js';
import { mm } from '../src/renderer/core/units.js';
import { copperLayerNames, boardLayers, setCopperLayers, setThickness, rectOutline, circleOutline, polygonOutline, checkOutline, outlineBounds, hitOutline, moveOutline } from '../src/renderer/core/board.js';

test('layer stack lists for 2 and 4 copper layers', () => {
  assert.deepEqual(copperLayerNames(2), ['F.Cu', 'B.Cu']);
  assert.deepEqual(copperLayerNames(4), ['F.Cu', 'In1.Cu', 'In2.Cu', 'B.Cu']);
  const two = boardLayers(2).map((l) => l.name), four = boardLayers(4).map((l) => l.name);
  assert.equal(four.length, two.length + 2);
  assert.equal(two.at(-1), 'Edge.Cuts');
  for (const n of ['F.SilkS', 'B.Mask', 'F.Paste', 'B.CrtYd', 'F.Fab']) assert.ok(two.includes(n), n);
  assert.deepEqual(boardLayers(4).filter((l) => l.kind === 'copper').map((l) => l.name), copperLayerNames(4));
});

test('setCopperLayers switches the stack and refuses to drop used inner layers', () => {
  const p = newProject('B');
  setCopperLayers(p, 4);
  assert.equal(p.board.stack.copper, 4);
  p.board.tracks.push({ layer: 'In1.Cu' });
  assert.throws(() => setCopperLayers(p, 2), /inner layers/);
  p.board.tracks = [];
  setCopperLayers(p, 2);
  assert.equal(p.board.stack.copper, 2);
  assert.throws(() => setCopperLayers(p, 3), RangeError);
  setThickness(p, 1.0);
  assert.equal(p.board.stack.thickness, mm(1));
  assert.throws(() => setThickness(p, 9), RangeError);
});

test('a rectangle outline is closed; rounded corners are lines and arcs that close', () => {
  const sq = rectOutline([mm(50), mm(40)], [0, 0]);
  assert.equal(sq.length, 1);
  assert.deepEqual(sq[0].a, [0, 0]);
  assert.ok(checkOutline(sq).closed);
  const rr = rectOutline([0, 0], [mm(50), mm(40)], mm(3));
  assert.equal(rr.length, 8);
  const c = checkOutline(rr);
  assert.ok(c.closed, c.problems.join());
  assert.equal(c.loops, 1);
  assert.deepEqual(outlineBounds(rr), { x0: 0, y0: 0, x1: mm(50), y1: mm(40) });
});

test('a polygon outline with an arc segment must close', () => {
  const steps = [{ to: [mm(30), 0] }, { mid: [mm(40), mm(10)], to: [mm(30), mm(20)] }, { to: [0, mm(20)] }];
  const open = polygonOutline([0, 0], steps);
  const o = checkOutline(open);
  assert.equal(o.closed, false);
  assert.equal(o.openEnds.length, 2);
  assert.match(o.problems[0], /open at one gap/);
  const closed = polygonOutline([0, 0], [...steps, { to: [0, 0] }]);
  assert.ok(checkOutline(closed).closed);
  assert.equal(outlineBounds(closed).x1, mm(40)); // the arc bulges past its end points
});

test('cut-outs count as extra loops; branches and an empty outline are problems', () => {
  const outline = [...rectOutline([0, 0], [mm(50), mm(50)]), ...circleOutline([mm(25), mm(25)], mm(3))];
  assert.equal(checkOutline(outline).loops, 2);
  assert.ok(checkOutline(outline).closed);
  const empty = checkOutline([]);
  assert.equal(empty.closed, false);
  assert.match(empty.problems[0], /no board outline/);
  const tri = polygonOutline([0, 0], [{ to: [mm(10), 0] }, { to: [mm(10), mm(10)] }, { to: [0, 0] }]);
  tri.push(...polygonOutline([0, 0], [{ to: [0, mm(5)] }]));
  const b = checkOutline(tri);
  assert.equal(b.closed, false);
  assert.ok(b.problems.some((m) => /Three or more/.test(m)));
});

test('hit-testing and moving outline shapes', () => {
  const outline = rectOutline([0, 0], [mm(20), mm(10)], mm(2));
  assert.equal(hitOutline(outline, [mm(10), mm(0.05)], mm(0.2)), outline[0]);
  assert.equal(hitOutline(outline, [mm(10), mm(5)], mm(0.2)), null);
  const corner = hitOutline(outline, [mm(20) - mm(2) + mm(2) * Math.SQRT1_2, mm(2) - mm(2) * Math.SQRT1_2], mm(0.2));
  assert.equal(corner?.type, 'arc');
  moveOutline(outline, [mm(1), mm(1)]);
  assert.deepEqual(outlineBounds(outline), { x0: mm(1), y0: mm(1), x1: mm(21), y1: mm(11) });
});

test('board stack and outline save and open', () => {
  const p = newProject('B');
  setCopperLayers(p, 4);
  p.board.outline = [...rectOutline([0, 0], [mm(40), mm(30)], mm(2)), ...circleOutline([mm(20), mm(15)], mm(1.6))];
  assert.deepEqual(projectProblems(p), []);
  const back = deserialize(serialize(p));
  assert.equal(back.board.stack.copper, 4);
  assert.deepEqual(back.board.outline, p.board.outline);
});

test('outlineLoops walks each closed loop end to end', async () => {
  const { outlineLoops } = await import('../src/renderer/core/board.js');
  const poly = polygonOutline([0, 0], [{ to: [mm(10), 0] }, { to: [mm(10), mm(10)] }, { to: [0, 0] }]);
  // one segment drawn backwards
  const back = poly[1]; back.pts = [back.pts[1], back.pts[0]];
  const loops = outlineLoops([poly[0], poly[2], back, ...circleOutline([mm(3), mm(3)], mm(1))]);
  assert.equal(loops.length, 2);
  const tri = loops.find((l) => l.length === 3);
  assert.deepEqual(tri.map((x) => x.reversed), [false, true, false]);
  assert.equal(outlineLoops(poly.slice(0, 2)).length, 0); // open chains are left out
});

test('loops inside another are cut-outs; side-by-side loops are separate pieces', () => {
  const a = rectOutline([0, 0], [mm(50), mm(50)]);
  const hole = circleOutline([mm(25), mm(25)], mm(3));
  const other = rectOutline([mm(60), 0], [mm(80), mm(20)]);
  const c = checkOutline([...a, ...hole, ...other]);
  assert.equal(c.cutouts, 1);
  assert.equal(c.pieces, 2);
});
