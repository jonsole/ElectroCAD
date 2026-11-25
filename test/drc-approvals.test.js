// DRC approvals (#69): approve a problem, it survives unrelated edits, lapses when its items
// move or change net, is dropped when they're deleted, and can be taken away again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newProject, addComponent, pinPositions, serialize, deserialize } from '../src/renderer/core/project.js';
import { addWire } from '../src/renderer/core/schematic.js';
import { changeList, applyChanges } from '../src/renderer/core/annotate.js';
import { placedPads, padNets } from '../src/renderer/core/footprint.js';
import { rectOutline } from '../src/renderer/core/board.js';
import { runDrc, drcCounts } from '../src/renderer/core/drc.js';
import { markApproved, unapproved, approve, unapprove, pruneApprovals } from '../src/renderer/core/drcApprovals.js';
import { STARTER_LIBRARY } from '../src/renderer/library/starter.js';
import { mm, SCH_GRID as G } from '../src/renderer/core/units.js';

const part = (n) => STARTER_LIBRARY.find((p) => p.name === n);

/** Two resistors on a board, and two tracks of other nets 0.1 mm apart (a clearance error). */
function board() {
  const p = newProject('A');
  const s = p.schematic.sheets[0];
  const r1 = addComponent(p, s, part('Resistor'), [G * 10, G * 10]).comp, r2 = addComponent(p, s, part('Resistor'), [G * 30, G * 10]).comp;
  const pin = (c, n) => pinPositions(p, s.symbols.find((y) => y.componentId === c.id)).find((x) => x.pin.number === n).at;
  addWire(p, s, [pin(r1, '2'), pin(r2, '1')]);
  applyChanges(p, changeList(p));
  const b = p.board;
  b.outline = rectOutline([0, 0], [mm(30), mm(20)]);
  const f1 = b.footprints.find((f) => f.componentId === r1.id), f2 = b.footprints.find((f) => f.componentId === r2.id);
  f1.at = [mm(5), mm(5)]; f2.at = [mm(20), mm(5)];
  const nets = padNets(b);
  const pad = (f, n) => placedPads(p, f, nets).find((x) => x.number === n);
  b.tracks.push({ id: 'route', a: pad(f1, '2').at, b: pad(f2, '1').at, width: b.rules.trackWidth, layer: 'F.Cu', net: pad(f1, '2').net });
  const w = mm(0.25);
  b.tracks.push({ id: 'ta', a: [mm(5), mm(12)], b: [mm(15), mm(12)], width: w, layer: 'F.Cu', net: 'A' });
  b.tracks.push({ id: 'tb', a: [mm(5), mm(12) + w + mm(0.1)], b: [mm(15), mm(12) + w + mm(0.1)], width: w, layer: 'F.Cu', net: 'B' });
  return { p, b, f1, f2 };
}
const clearance = (p) => markApproved(p, runDrc(p)).filter((v) => v.rule === 'clearance');

test('approve: the problem is marked, keeps its note, and stops counting', () => {
  const { p } = board();
  const [v] = clearance(p);
  assert.ok(v && !v.approval);
  approve(p, v, '  Built and tested  ');
  assert.equal(p.board.drcApprovals.length, 1);
  assert.deepEqual(p.board.drcApprovals[0].items.sort(), ['ta', 'tb']);
  const [w] = clearance(p);
  assert.deepEqual(w.approval?.note, 'Built and tested');
  assert.equal(drcCounts(unapproved(markApproved(p, runDrc(p)))).error, 0, 'it no longer counts');
  // approving again replaces, not duplicates
  approve(p, w, 'again');
  assert.equal(p.board.drcApprovals.length, 1);
  // saved and opened: still approved
  const back = deserialize(serialize(p));
  assert.ok(clearance(back)[0].approval);
});

test('an approval survives unrelated edits', () => {
  const { p, b } = board();
  approve(p, clearance(p)[0]);
  b.tracks.find((t) => t.id === 'route').width += mm(0.05);            // another track
  b.vias.push({ id: 'v9', at: [mm(25), mm(15)], diameter: mm(0.6), drill: mm(0.3), net: 'X' });
  b.rules.trackWidth = mm(0.2);                                         // a rule
  assert.ok(clearance(p)[0].approval);
});

test('an approval lapses when one of its items moves, changes size or net', () => {
  for (const change of [(t) => { t.a = [t.a[0] + mm(0.5), t.a[1]]; }, (t) => { t.width += mm(0.02); }, (t) => { t.net = 'C'; }]) {
    const { p, b } = board();
    approve(p, clearance(p)[0]);
    change(b.tracks.find((t) => t.id === 'tb'));
    const v = clearance(p);
    assert.equal(v.length, 1);
    assert.ok(!v[0].approval, 'it shows again');
  }
});

test('an approval of a pad problem lapses when its footprint moves', () => {
  const { p, b, f2 } = board();
  // a foreign track touching R2's pad 2
  const pad2 = placedPads(p, f2, padNets(b)).find((x) => x.number === '2');
  b.tracks.push({ id: 'tp', a: [pad2.at[0], pad2.at[1] + mm(3)], b: pad2.at, width: mm(0.25), layer: 'F.Cu', net: 'Z' });
  const v = clearance(p).find((x) => x.items.includes('tp'));
  approve(p, v);
  assert.ok(clearance(p).find((x) => x.items.includes('tp')).approval);
  f2.rot = 180; // turned: the pad's footprint changed
  const again = clearance(p).filter((x) => x.items.includes('tp'));
  assert.ok(again.length && again.every((x) => !x.approval));
});

test('approvals of deleted items are dropped; unapprove takes one away', () => {
  const { p, b } = board();
  approve(p, clearance(p)[0], 'x');
  b.tracks = b.tracks.filter((t) => t.id !== 'tb');
  pruneApprovals(p);
  assert.ok(!('drcApprovals' in b));
  const { p: q } = board();
  const v = clearance(q)[0];
  approve(q, v);
  unapprove(q, q.board.drcApprovals[0].key);
  assert.ok(!('drcApprovals' in q.board));
  assert.ok(!clearance(q)[0].approval);
});

test('unrouted connections can be approved too (keyed by the net and where they run)', () => {
  const { p, b } = board();
  b.tracks = b.tracks.filter((t) => t.id !== 'route');
  const un = () => markApproved(p, runDrc(p)).filter((v) => v.rule === 'unrouted');
  assert.equal(un().length, 1);
  approve(p, un()[0]);
  assert.ok(un()[0].approval);
});
