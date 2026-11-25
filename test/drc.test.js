import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newProject, addComponent, pinPositions } from '../src/renderer/core/project.js';
import { addWire } from '../src/renderer/core/schematic.js';
import { changeList, applyChanges } from '../src/renderer/core/annotate.js';
import { placedPads, padNets } from '../src/renderer/core/footprint.js';
import { rectOutline } from '../src/renderer/core/board.js';
import { newZone, zoneInput, fillZones } from '../src/renderer/core/zones.js';
import { runDrc, drcCounts, DRC_RULES } from '../src/renderer/core/drc.js';
import { addNetClass, assignNet } from '../src/renderer/core/netclasses.js';
import { STARTER_LIBRARY } from '../src/renderer/library/starter.js';
import { mm, SCH_GRID as G } from '../src/renderer/core/units.js';

const part = (n) => STARTER_LIBRARY.find((p) => p.name === n);

/** Two resistors joined on the Schematic, annotated, placed and routed inside a closed outline. */
function clean() {
  const p = newProject('D');
  const s = p.schematic.sheets[0];
  const r1 = addComponent(p, s, part('Resistor'), [G * 10, G * 10]).comp, r2 = addComponent(p, s, part('Resistor'), [G * 30, G * 10]).comp;
  const pin = (c, n) => pinPositions(p, s.symbols.find((y) => y.componentId === c.id)).find((x) => x.pin.number === n).at;
  addWire(p, s, [pin(r1, '2'), pin(r2, '1')]);
  applyChanges(p, changeList(p));
  const b = p.board;
  b.outline = rectOutline([0, 0], [mm(25), mm(15)]);
  const f1 = b.footprints.find((f) => f.componentId === r1.id), f2 = b.footprints.find((f) => f.componentId === r2.id);
  f1.at = [mm(5), mm(5)]; f2.at = [mm(15), mm(5)];
  const nets = padNets(b);
  const pad = (f, n) => placedPads(p, f, nets).find((x) => x.number === n);
  const a = pad(f1, '2'), c = pad(f2, '1');
  b.tracks.push({ id: 'route', a: a.at, b: c.at, width: b.rules.trackWidth, layer: 'F.Cu', net: a.net });
  return { p, b, net: a.net, f1, f2, r1, r2, s };
}
const rules = (list) => list.map((v) => v.rule);

test('a clean routed board has no violations, with a zone filled round it', () => {
  const { p, b, net } = clean();
  assert.deepEqual(runDrc(p), []);
  // a zone of another net over the whole board, filled: still clean (the fill keeps its clearance)
  const z = newZone('F.Cu', '', [[0, 0], [mm(25), 0], [mm(25), mm(15)], [0, mm(15)]]);
  b.zones.push(z);
  const fills = fillZones(zoneInput(p));
  assert.ok(fills.get(z.id).polys.length);
  assert.deepEqual(runDrc(p, fills).map((v) => v.message), []);
  // and a zone of the track's own net, with thermal reliefs
  z.net = net;
  assert.deepEqual(runDrc(p, fillZones(zoneInput(p))).map((v) => v.message), []);
  assert.ok(DRC_RULES.length >= 8);
});

test('clearance: copper of different nets too close, per net class, with where', () => {
  const { p, b } = clean();
  b.tracks.push({ id: 'x', a: [mm(8), mm(5.35)], b: [mm(12), mm(5.35)], width: mm(0.25), layer: 'F.Cu', net: 'X' });
  let v = runDrc(p).filter((x) => x.rule === 'clearance');
  assert.equal(v.length, 1);
  assert.equal(v[0].severity, 'error');
  assert.deepEqual(v[0].items.sort(), ['route', 'x']);
  assert.ok(v[0].at[0] >= mm(8) && v[0].at[0] <= mm(12) && Math.abs(v[0].at[1] - mm(5.175)) < 10, String(v[0].at));
  assert.match(v[0].message, /0\.1 mm apart; 0\.2 mm needed/);
  // on another layer: fine; a wider net class makes a farther track fail
  b.tracks[1].layer = 'B.Cu';
  assert.equal(runDrc(p).filter((x) => x.rule === 'clearance').length, 0);
  b.tracks[1] = { ...b.tracks[1], layer: 'F.Cu', a: [mm(8), mm(5.6)], b: [mm(12), mm(5.6)] };
  assert.equal(runDrc(p).filter((x) => x.rule === 'clearance').length, 0);
  addNetClass(p, 'HV', { clearance: mm(0.5) });
  assignNet(p, 'X', 'HV');
  v = runDrc(p).filter((x) => x.rule === 'clearance');
  assert.equal(v.length, 1);
  assert.match(v[0].message, /0\.5 mm needed/);
});

test('edge clearance and copper off the board', () => {
  const { p, b } = clean();
  b.tracks.push({ id: 'e', a: [mm(2), mm(0.2)], b: [mm(4), mm(0.2)], width: mm(0.25), layer: 'F.Cu', net: 'Z' });
  b.tracks.push({ id: 'off', a: [mm(-5), mm(-5)], b: [mm(-4), mm(-5)], width: mm(0.25), layer: 'F.Cu', net: 'Z' });
  const v = runDrc(p).filter((x) => x.rule === 'edge');
  assert.equal(v.length, 2);
  assert.ok(v.some((x) => x.items[0] === 'e' && /from the board edge; 0\.3 mm needed/.test(x.message)));
  assert.ok(v.some((x) => x.items[0] === 'off' && /off the board/.test(x.message)));
});

test('track width below its net class', () => {
  const { p, b, net } = clean();
  b.tracks[0].width = mm(0.15);
  assert.deepEqual(rules(runDrc(p)), ['width']);
  b.tracks[0].width = mm(0.25);
  addNetClass(p, 'Power', { trackWidth: mm(0.5) });
  assignNet(p, net, 'Power');
  const v = runDrc(p);
  assert.deepEqual(rules(v), ['width']);
  assert.match(v[0].message, /Power class needs 0\.5 mm/);
});

test('annular ring and hole size', () => {
  const { p, b, net } = clean();
  b.vias.push({ id: 'ring', at: [mm(10), mm(5)], drill: mm(0.3), diameter: mm(0.45), from: 'F.Cu', to: 'B.Cu', net });
  b.vias.push({ id: 'hole', at: [mm(12), mm(5)], drill: mm(0.2), diameter: mm(0.6), from: 'F.Cu', to: 'B.Cu', net });
  const v = runDrc(p);
  assert.deepEqual(rules(v).sort(), ['hole', 'ring']);
  assert.equal(v.find((x) => x.rule === 'ring').items[0], 'ring');
  assert.equal(v.find((x) => x.rule === 'hole').items[0], 'hole');
  assert.match(v.find((x) => x.rule === 'ring').message, /annular ring 0\.075 mm; 0\.13 mm needed/);
});

test('courtyard overlap on the same side only', () => {
  const { p, b, f1, f2 } = clean();
  b.tracks = [];
  f2.at = [mm(6), mm(5.5)];
  let v = runDrc(p).filter((x) => x.rule === 'courtyard');
  assert.equal(v.length, 1);
  assert.deepEqual(v[0].items.sort(), [f1.id, f2.id].sort());
  f2.side = 'B';
  v = runDrc(p).filter((x) => x.rule === 'courtyard');
  assert.equal(v.length, 0);
});

test('unrouted connections, the board outline, and a pending forward annotation', () => {
  const { p, b, s, net } = clean();
  b.tracks = [];
  let v = runDrc(p);
  assert.deepEqual(rules(v), ['unrouted']);
  assert.equal(v[0].severity, 'warning');
  assert.equal(v[0].items[0], net);
  // an open outline
  b.tracks = clean().b.tracks;
  b.outline = [{ type: 'line', pts: [[0, 0], [mm(25), 0], [mm(25), mm(15)]], layer: 'Edge.Cuts' }];
  v = runDrc(p);
  assert.ok(rules(v).includes('outline'));
  // a new part on the Schematic that the Board hasn't got
  b.outline = rectOutline([0, 0], [mm(25), mm(15)]);
  addComponent(p, s, part('Resistor'), [G * 50, G * 10]);
  v = runDrc(p);
  assert.deepEqual(rules(v), ['annotation']);
  assert.equal(v[0].at, null);
  assert.deepEqual(drcCounts(v), { error: 0, warning: 1 });
});

test('what to draw (#80): the two shapes, the gap between their edges and the clearance needed', async () => {
  const { closestPair } = await import('../src/renderer/core/drc.js');
  const { p, b, f2 } = clean();
  const nets = padNets(b);
  const pad = placedPads(p, f2, nets).find((x) => x.number === '2');
  // a via of another net 0.1 mm from the pad's right edge, level with its centre
  const right = pad.at[0] + pad.size[0] / 2;
  b.vias.push({ id: 'v', at: [right + mm(0.1) + mm(0.3), pad.at[1]], drill: mm(0.3), diameter: mm(0.6), from: 'F.Cu', to: 'B.Cu', net: 'OTHER' });
  const v = runDrc(p).filter((x) => x.rule === 'clearance' && x.items.includes('v'));
  assert.equal(v.length, 1);
  const s = v[0].show;
  assert.equal(s.shapes.length, 2);
  assert.equal(s.need, b.rules.clearance);
  assert.ok(Math.abs(s.gap.d - mm(0.1)) <= 2, `gap ${s.gap.d}`);
  // the closest points: on the pad's right edge and on the via's ring, level with the pad's centre
  const [onPad, onVia] = s.shapes[0].type === 'capsule' && s.shapes[0].r === mm(0.3) ? [s.gap.b, s.gap.a] : [s.gap.a, s.gap.b];
  assert.ok(Math.abs(onPad[0] - right) <= 2 && Math.abs(onPad[1] - pad.at[1]) <= 2, `pad point ${onPad}`);
  assert.ok(Math.abs(onVia[0] - (right + mm(0.1))) <= 2 && Math.abs(onVia[1] - pad.at[1]) <= 2, `via point ${onVia}`);
  // closestPair directly: two parallel capsules 1 mm apart edge to edge
  const g = closestPair({ type: 'capsule', a: [0, 0], b: [mm(5), 0], r: mm(0.5) }, { type: 'capsule', a: [mm(1), mm(2)], b: [mm(4), mm(2)], r: mm(0.5) });
  assert.equal(g.d, mm(1)); assert.equal(g.a[1], mm(0.5)); assert.equal(g.b[1], mm(1.5));
  // the other checks carry their own: width, courtyard, unrouted
  b.tracks[0].width = mm(0.1);
  const w = runDrc(p).find((x) => x.rule === 'width');
  assert.equal(w.show.shapes[0].r, mm(0.05)); assert.match(w.show.label, /0\.1 mm wide/);
  b.tracks.length = 0;
  const u = runDrc(p).find((x) => x.rule === 'unrouted');
  assert.equal(u.show.wire.length, 2);
});
