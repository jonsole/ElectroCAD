// Live DRC (#85): re-checking only the areas an edit changed, merged into the last results, gives
// the same list as a full run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newProject, addComponent, pinPositions } from '../src/renderer/core/project.js';
import { addWire } from '../src/renderer/core/schematic.js';
import { changeList, applyChanges } from '../src/renderer/core/annotate.js';
import { rectOutline } from '../src/renderer/core/board.js';
import { runDrc, mergeDrc, inAreas } from '../src/renderer/core/drc.js';
import { boardItems, changedAreas } from '../src/renderer/core/drcLive.js';
import { ratsnest } from '../src/renderer/core/ratsnest.js';
import { STARTER_LIBRARY } from '../src/renderer/library/starter.js';
import { mm, SCH_GRID as G } from '../src/renderer/core/units.js';

const part = (n) => STARTER_LIBRARY.find((p) => p.name === n);

function board() {
  const p = newProject('Live');
  const s = p.schematic.sheets[0];
  const cs = [0, 1, 2, 3, 4, 5].map((i) => addComponent(p, s, part('Resistor'), [G * (10 + 20 * i), G * 10]).comp);
  const pin = (c, n) => pinPositions(p, s.symbols.find((y) => y.componentId === c.id)).find((x) => x.pin.number === n).at;
  for (let i = 0; i < 5; i++) addWire(p, s, [pin(cs[i], '2'), pin(cs[i + 1], '1')]);
  applyChanges(p, changeList(p));
  const b = p.board;
  b.outline = rectOutline([0, 0], [mm(40), mm(20)]);
  b.footprints.forEach((f, i) => { f.at = [mm(4 + (i % 3) * 6), mm(4 + Math.floor(i / 3) * 6)]; });
  return p;
}

test('a re-check of the changed areas, merged, is the same as a full run (random edits)', () => {
  const p = board(), b = p.board;
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let list = runDrc(p), items = boardItems(p);
  const ids = (l) => l.map((v) => v.id).sort();
  let local = 0, gaps = 0;
  for (let i = 0; i < 60; i++) {
    const kind = rnd();
    if (kind < 0.35 || !b.tracks.length) {
      // a new track somewhere, often near others
      // half the time just clear of another track: a gap the rules don't allow, not an overlap
      const near = b.tracks.length && rnd() < 0.5 ? b.tracks[Math.floor(rnd() * b.tracks.length)] : null;
      const x = near ? near.a[0] : mm(2 + rnd() * 30), y = near ? near.a[1] + near.width / 2 + mm(0.1 + rnd() * 0.15) + mm(0.1) : mm(2 + rnd() * 14);
      b.tracks.push({ id: `t${i}`, a: [x, y], b: [x + mm(rnd() * 6), y + mm((rnd() - 0.5) * 3)], width: mm(0.15 + rnd() * 0.2), layer: rnd() < 0.7 ? 'F.Cu' : 'B.Cu', net: rnd() < 0.5 ? 'A' : 'B' });
    } else if (kind < 0.55) {
      const t = b.tracks[Math.floor(rnd() * b.tracks.length)];
      const dx = mm((rnd() - 0.5) * 2), dy = rnd() < 0.5 ? mm((rnd() - 0.5) * 2) : mm((rnd() - 0.5) * 0.4);
      t.a = [t.a[0] + dx, t.a[1] + dy]; t.b = [t.b[0] + dx, t.b[1] + dy];
    } else if (kind < 0.65) {
      b.tracks.splice(Math.floor(rnd() * b.tracks.length), 1);
    } else if (kind < 0.8) {
      b.vias.push({ id: `v${i}`, at: [mm(2 + rnd() * 30), mm(2 + rnd() * 14)], drill: mm(0.3), diameter: mm(0.6), from: 'F.Cu', to: 'B.Cu', net: 'C' });
    } else {
      // move a footprint (pads, holes and its courtyard)
      const f = b.footprints[Math.floor(rnd() * b.footprints.length)];
      f.at = [f.at[0] + mm((rnd() - 0.5) * 4), f.at[1] + mm((rnd() - 0.5) * 4)];
    }
    const next = boardItems(p), ch = changedAreas(items, next);
    items = next;
    assert.equal(ch.full, false);
    const fresh = runDrc(p, new Map(), { areas: ch.areas, rats: ratsnest(p, b, new Map()) });
    assert.ok(fresh.every((v) => !['clearance', 'edge', 'width', 'ring', 'hole', 'courtyard'].includes(v.rule) || inAreas(v, ch.areas)));
    list = mergeDrc(list, fresh, ch.areas);
    const full = runDrc(p);
    assert.deepEqual(ids(list), ids(full), `edit ${i}`);
    local += fresh.length;
    gaps += fresh.filter((v) => v.rule === 'clearance' && v.show?.gap?.d > 0).length;
  }
  assert.ok(local > 0, 'the edits made problems to find');
  assert.ok(gaps > 0, 'some were gaps between copper, not overlaps');
});

test('changes that reach the whole board ask for a full run', () => {
  const p = board();
  const a = boardItems(p);
  p.board.rules = { ...p.board.rules, clearance: mm(0.3) };
  assert.equal(changedAreas(a, boardItems(p)).full, true);
  const c = boardItems(p);
  p.board.outline = rectOutline([0, 0], [mm(30), mm(20)]);
  assert.equal(changedAreas(c, boardItems(p)).full, true);
  assert.equal(changedAreas(null, c).full, true);
  // an unchanged board: nothing to re-check
  assert.deepEqual(changedAreas(boardItems(p), boardItems(p)), { full: false, areas: [] });
});
