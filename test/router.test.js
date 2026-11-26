import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newProject, addComponent, pinPositions } from '../src/renderer/core/project.js';
import { addWire } from '../src/renderer/core/schematic.js';
import { changeList, applyChanges } from '../src/renderer/core/annotate.js';
import { placedPads } from '../src/renderer/core/footprint.js';
import { ratsnest } from '../src/renderer/core/ratsnest.js';
import { CopperIndex, copperIndex, shapeDistance, padShape, netRules, clearanceBetween } from '../src/renderer/core/collision.js';
import { cornerPath, chamferPath, startRoute, step, click, back, flipPosture, commit, bendOf, cycleBend, bendFromPref, withBend, strokeTo, simplifyPath, roundPath } from '../src/renderer/core/router.js';
import { trackArc } from '../src/renderer/core/trackGeom.js';
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

test('Eagle bend styles 0–4 map to corner style and posture; right-click cycles, / mirrors (#91)', () => {
  const a = [0, 0], b = [mm(10), mm(4)];
  const legs = (id) => cornerPath(a, b, bendOf(id).corner, bendOf(id).posture);
  assert.deepEqual(legs(0), [[mm(10), 0], b]);          // horizontal, vertical
  assert.deepEqual(legs(1), [[mm(6), 0], b]);           // horizontal, 45°
  assert.deepEqual(legs(2), [b]);                       // straight
  assert.deepEqual(legs(3), [[mm(4), mm(4)], b]);       // 45°, horizontal
  assert.deepEqual(legs(4), [[0, mm(4)], b]);           // vertical, horizontal
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map((i) => bendOf(i).mirror), [4, 3, 2, 1, 0, 6, 5, 7]);
  assert.equal(cycleBend(0), 1); assert.equal(cycleBend(4), 5); assert.equal(cycleBend(6), 7); assert.equal(cycleBend(7), 0); assert.equal(cycleBend(0, -1), 7);
  assert.deepEqual(['90', '45', 'any', 3, 'junk'].map(bendFromPref), [0, 1, 2, 3, 1]);
  const { p, from } = board();
  let st = startRoute(p, from.at, 'F.Cu', from.net, { bend: 3 });
  assert.equal(st.corner, '45'); assert.equal(st.posture, 'b');
  st = flipPosture(st);
  assert.equal(st.bend, 1); assert.equal(st.posture, 'a');
  assert.deepEqual(withBend(st, 4).corner, '90');
});

test('arc bend styles 5 and 6 (#94): a quarter circle tangent to a straight, every quadrant', () => {
  const r = mm(4);
  for (const [dx, dy] of [[10, 4], [-10, 4], [10, -4], [-10, -4], [4, 10], [-4, -10]]) {
    const a = [mm(1), mm(2)], b = [a[0] + mm(dx), a[1] + mm(dy)];
    const major = Math.abs(dx) > Math.abs(dy) ? [Math.sign(dx), 0] : [0, Math.sign(dy)];
    // 5: arc from a, then straight to b along the major axis
    const [e, b5] = cornerPath(a, b, 'arc', 'a');
    assert.ok(e.mid && !b5.mid); assert.deepEqual([b5[0], b5[1]], b);
    let k = trackArc({ a, mid: e.mid, b: [e[0], e[1]] });
    assert.ok(Math.abs(k.r - r) < 2, `r ${k.r}`);
    assert.ok(Math.abs(k.c[0] - (a[0] + major[0] * r)) < 2 && Math.abs(k.c[1] - (a[1] + major[1] * r)) < 2, 'centre beside the start');
    const u = [e[0] - k.c[0], e[1] - k.c[1]], v = [b[0] - e[0], b[1] - e[1]];
    assert.ok(Math.abs(u[0] * v[0] + u[1] * v[1]) < 1e-3 * Math.hypot(...u) * Math.hypot(...v), 'tangent to the straight');
    assert.ok(Math.abs(Math.abs(k.sweep) - Math.PI / 2) < 1e-3);
    // 6: straight from a, then the arc into b
    const [s0, b6] = cornerPath(a, b, 'arc', 'b');
    assert.ok(!s0.mid && b6.mid); assert.deepEqual([b6[0], b6[1]], b);
    k = trackArc({ a: s0, mid: b6.mid, b });
    assert.ok(Math.abs(k.r - r) < 2);
    const w = [s0[0] - k.c[0], s0[1] - k.c[1]], z = [s0[0] - a[0], s0[1] - a[1]];
    assert.ok(Math.abs(w[0] * z[0] + w[1] * z[1]) < 1e-3 * Math.hypot(...w) * Math.hypot(...z), 'tangent to the straight');
  }
  assert.deepEqual(cornerPath([0, 0], [mm(5), 0], 'arc', 'a'), [[mm(5), 0]]);     // in line: straight
  // routed pad to pad with style 5: an arc track and a straight one, joined end to end
  const { p, from, to } = board();
  let st = startRoute(p, from.at, 'F.Cu', from.net, { bend: 5 });
  st = click(p, st, to.at);
  const ts = commit(p, st);
  assert.equal(ts.length, 2);
  assert.ok(ts[0].mid && !ts[1].mid && !('mid' in ts[1]));
  assert.deepEqual(ts[0].b, ts[1].a); assert.deepEqual(ts[1].b, to.at);
  assert.ok(Array.isArray(ts[0].b) && ts[0].b.mid === undefined, 'plain points on the Board');
  assert.equal(ratsnest(p).wires.length, 0);
});

test('rounded mitre (#95): every bend becomes a tangent arc of the radius, smaller on a short leg', () => {
  const R = mm(1);
  const check = (pts, r) => {
    const out = roundPath(pts, R);
    assert.equal(out.length, 4);
    const [, p1, p2] = out;
    assert.ok(p2.mid && !p1.mid);
    const k = trackArc({ a: p1, mid: p2.mid, b: p2 });
    assert.ok(Math.abs(k.r - r) < 20, `radius ${k.r} vs ${r}`);
    // tangent: the radius at each end is square to its segment
    const t1 = [p1[0] - pts[0][0], p1[1] - pts[0][1]], r1 = [p1[0] - k.c[0], p1[1] - k.c[1]];
    const t2 = [pts[2][0] - p2[0], pts[2][1] - p2[1]], r2 = [p2[0] - k.c[0], p2[1] - k.c[1]];
    for (const [t, rr] of [[t1, r1], [t2, r2]]) assert.ok(Math.abs(t[0] * rr[0] + t[1] * rr[1]) < 1e-3 * Math.hypot(...t) * Math.hypot(...rr));
    return out;
  };
  check([[0, 0], [mm(10), 0], [mm(10), mm(10)]], R);               // 90°
  check([[0, 0], [mm(10), 0], [mm(15), mm(5)]], R);                // 45°
  const short = check([[0, 0], [mm(0.5), 0], [mm(0.5), mm(10)]], mm(0.25)); // a 0.5 mm leg: half of it
  assert.deepEqual([short[1][0], short[1][1]], [mm(0.25), 0]);
  assert.deepEqual(roundPath([[0, 0], [mm(5), 0], [mm(9), 0]], R), [[0, 0], [mm(5), 0], [mm(9), 0]]); // in line
  // routed and committed: straights joined by an arc Track
  const { p, from, to } = board();
  let st = startRoute(p, from.at, 'F.Cu', from.net, { bend: 0, chamfer: R, mitre: 'round' });
  st = click(p, st, to.at);
  const ts = commit(p, st);
  assert.equal(ts.length, 3); assert.equal(ts.filter((t) => t.mid).length, 1);
  assert.equal(ratsnest(p).wires.length, 0);
});

test('freehand (#92): a stroke simplifies to few points, keeps a curve, and backs up', () => {
  const line = Array.from({ length: 101 }, (_, i) => [i * mm(0.1), (i % 2) * 1000]);   // 10 mm, 1 µm wobble
  assert.equal(simplifyPath(line, mm(0.05)).length, 2);
  const arc = Array.from({ length: 91 }, (_, i) => [Math.round(mm(5) * Math.cos(i * Math.PI / 180)), Math.round(mm(5) * Math.sin(i * Math.PI / 180))]);
  const s = simplifyPath(arc, mm(0.05));
  assert.ok(s.length > 4 && s.length < 20, `${s.length} points`);
  // every point of the curve is within the tolerance of the simplified path
  const dseg = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy, t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2)); return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); };
  for (const p of arc) assert.ok(Math.min(...s.slice(1).map((b, i) => dseg(p, s[i], b))) <= mm(0.05) + 1);
  // the stroke grows a step at a time and backs up to an earlier point
  const { p, from } = board();
  let st = startRoute(p, [0, 0], 'F.Cu', from.net, { bend: 7 });
  assert.equal(st.corner, 'free');
  st = strokeTo(st, [mm(0.05), 0], mm(0.1)); assert.equal((st.stroke || []).length, 0);    // under a step
  for (const q of [[mm(1), 0], [mm(2), mm(1)], [mm(3), mm(3)]]) st = strokeTo(st, q, mm(0.1));
  assert.equal(st.stroke.length, 3);
  st = strokeTo(st, [mm(1), mm(0.02)], mm(0.1)); assert.equal(st.stroke.length, 1);         // back along it
  // off-grid, not 45° steps: the committed path is the stroke
  for (const q of [[mm(2.3), mm(1.7)], [mm(4.1), mm(1.9)]]) st = strokeTo(st, q, mm(0.1));
  const r = step(p, st, [mm(5.37), mm(3.11)], 'free');
  assert.deepEqual(r.tail, [[mm(1), 0], [mm(2.3), mm(1.7)], [mm(4.1), mm(1.9)], [mm(5.37), mm(3.11)]]);
  st = click(p, st, [mm(5.37), mm(3.11)], r.tail);
  assert.equal(st.points.length, 5); assert.deepEqual(st.stroke, []);
  assert.equal(back(st).points.length, 1);                                                // Backspace takes the whole stretch back
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

test('routing across a layer change yields tracks on both layers joined by a via with the right Net (#21)', async () => {
  const { switchLayer, layerPairs, nextLayer } = await import('../src/renderer/core/router.js');
  const { p, from, to } = board();
  let st = startRoute(p, from.at, 'F.Cu', from.net, { corner: '90' });
  st = click(p, st, [mm(3), 0]);
  st = switchLayer(p, st, [mm(3), mm(2)]);                              // fixed to the cursor, via there, now on B.Cu
  assert.equal(st.layer, 'B.Cu');
  assert.deepEqual(st.vias, [{ at: [mm(3), mm(2)] }]);
  const shown = step(p, st, [mm(5), mm(2)], 'free', copperIndex(p));
  assert.deepEqual([...new Set(shown.segments.map((s) => s.layer))], ['F.Cu', 'B.Cu']);
  st = back(st);                                                        // back through the via
  assert.equal(st.layer, 'F.Cu'); assert.equal(st.vias.length, 0);
  st = switchLayer(p, st, [mm(3), mm(2)]);
  st = click(p, st, to.at);
  const before = p.board.vias.length;
  const tracks = commit(p, st);
  assert.ok(tracks.some((t) => t.layer === 'F.Cu') && tracks.some((t) => t.layer === 'B.Cu'));
  assert.equal(p.board.vias.length, before + 1);
  const v = p.board.vias.at(-1);
  assert.deepEqual([v.at, v.net, v.from, v.to, v.drill, v.diameter], [[mm(3), mm(2)], from.net, 'F.Cu', 'B.Cu', mm(0.3), mm(0.6)]);
  // layer pairs on a 4-layer board
  assert.equal(layerPairs(2).length, 1);
  assert.equal(layerPairs(4).length, 6);
  assert.equal(nextLayer(['In1.Cu', 'In2.Cu'], 'In1.Cu'), 'In2.Cu');
  assert.equal(nextLayer(['F.Cu', 'In1.Cu'], 'B.Cu'), 'F.Cu');
});

test('a standalone via takes the Net it lands on; U-style connection selection; width and layer edits', async () => {
  const { placeVia, connection, setTrackWidth, setTrackLayer, setViaSize } = await import('../src/renderer/core/copper.js');
  const { switchLayer } = await import('../src/renderer/core/router.js');
  const { p, from } = board();
  let st = startRoute(p, from.at, 'F.Cu', from.net, { corner: '90' });
  st = click(p, st, [mm(3), 0]);
  st = switchLayer(p, st, [mm(3), mm(2)]);
  st = click(p, st, [mm(6), mm(2)]);
  commit(p, st);
  const tracks = p.board.tracks;
  const via = placeVia(p, [mm(4.5), mm(2)]);                            // on the B.Cu track
  assert.equal(via.net, from.net);
  assert.equal(placeVia(p, [mm(50), mm(50)]).net, '');                 // nowhere: no Net
  const all = connection(p.board, [tracks.at(-1).id]);
  assert.ok(tracks.every((t) => all.has(t.id)) && all.has(p.board.vias[0].id), [...all]);
  assert.ok(!all.has(p.board.vias.at(-1).id));
  setTrackWidth(p, [tracks[0].id], mm(0.5));
  assert.equal(tracks[0].width, mm(0.5));
  assert.throws(() => setTrackWidth(p, [tracks[0].id], 0), RangeError);
  setTrackLayer(p, [tracks[0].id], 'B.Cu');
  assert.equal(tracks[0].layer, 'B.Cu');
  setViaSize(p, [via.id], { drill: mm(0.4), diameter: mm(0.8) });
  assert.equal(via.diameter, mm(0.8));
  assert.throws(() => setViaSize(p, [via.id], { diameter: mm(0.3) }), RangeError);
});
