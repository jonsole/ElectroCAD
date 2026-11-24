import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newProject, serialize, deserialize } from '../src/renderer/core/project.js';
import { placeSymbol, rotateSymbols, mirrorSymbols, moveSelection, copySelection, pasteClip } from '../src/renderer/core/schematic.js';
import { placeFields, pinField, unpinFields, pinnedFieldAt, hasPinnedFields, estimateWidth } from '../src/renderer/core/fields.js';
import { unplace, place } from '../src/renderer/core/geom.js';
import { RESISTOR } from '../src/renderer/library/mini.js';
import { SCH_GRID as G, snapPt } from '../src/renderer/core/units.js';

const measure = estimateWidth;
const itemOf = (p, s, sym, key) => placeFields(p, s, { measure }).get(sym.id).items.find((i) => i.keys.includes(key));

test('unplace undoes place for every rotation and mirror', () => {
  for (const rot of [0, 90, 180, 270]) for (const mirror of [false, true]) {
    const at = [G * 7, -G * 3], p = [G * 2, G * 5];
    assert.deepEqual(unplace(place(p, at, rot, mirror), at, rot, mirror), p, `${rot} ${mirror}`);
  }
});

test('a pinned field stays where it was dropped, and follows its Symbol when moved, rotated or mirrored', () => {
  const p = newProject(); const s = p.schematic.sheets[0];
  const { sym } = placeSymbol(p, s, RESISTOR, [G * 20, G * 20]);
  const drop = [G * 20 + G / 4 * 9, G * 20 - G / 4 * 7]; // a quarter-grid point
  pinField(p, sym.id, 'value', drop);
  assert.ok(hasPinnedFields(sym));
  let it = itemOf(p, s, sym, 'value');
  assert.deepEqual([it.x, it.y], drop);
  assert.equal(it.align, 'center');
  assert.ok(it.pinned);
  // drops snap to a quarter grid
  pinField(p, sym.id, 'value', [drop[0] + 1000, drop[1] - 1000]);
  assert.deepEqual(pinnedFieldAt(sym, 'value'), drop);
  // move: goes along
  moveSelection(p, s, [sym.id], [G * 4, G * 2]);
  it = itemOf(p, s, sym, 'value');
  assert.deepEqual([it.x, it.y], [drop[0] + G * 4, drop[1] + G * 2]);
  // rotate 90: turns about the Symbol's origin, text stays upright (centred)
  rotateSymbols(p, [sym.id]);
  it = itemOf(p, s, sym, 'value');
  const off = [drop[0] - G * 20, drop[1] - G * 20];
  assert.deepEqual([it.x - sym.at[0], it.y - sym.at[1]], [off[1], -off[0]]);
  assert.equal(it.align, 'center');
  // mirror: the offset flips with it
  rotateSymbols(p, [sym.id]); rotateSymbols(p, [sym.id]); rotateSymbols(p, [sym.id]);
  mirrorSymbols(p, [sym.id]);
  it = itemOf(p, s, sym, 'value');
  assert.deepEqual([it.x - sym.at[0], it.y - sym.at[1]], [-off[0], off[1]]);
});

test('only unpinned fields are re-placed, and pinned fields are obstacles for others', () => {
  const p = newProject(); const s = p.schematic.sheets[0];
  const a = placeSymbol(p, s, RESISTOR, [G * 20, G * 20]).sym;
  const b = placeSymbol(p, s, RESISTOR, [G * 20, G * 30]).sym;
  const free = itemOf(p, s, b, 'reference');
  // pin R1's value right where R2's Reference would go
  const spot = snapPt([free.x, free.y], G / 4);
  pinField(p, a.id, 'value', spot);
  const a1 = itemOf(p, s, a, 'value');
  const moved = itemOf(p, s, b, 'reference');
  assert.deepEqual([a1.x, a1.y], spot, 'the pinned field stays');
  assert.notDeepEqual([moved.x, moved.y], [free.x, free.y], "R2's Reference moved out of its way");
  // moving R2 doesn't move R1's pinned value
  moveSelection(p, s, [b.id], [G * 10, 0]);
  const a2 = itemOf(p, s, a, 'value');
  assert.deepEqual([a2.x, a2.y], spot);
});

test('Re-apply style unpins; pins survive save, reopen and copy', () => {
  const p = newProject(); const s = p.schematic.sheets[0];
  const { sym } = placeSymbol(p, s, RESISTOR, [G * 20, G * 20]);
  const auto = itemOf(p, s, sym, 'reference');
  pinField(p, sym.id, 'reference', [G * 30, G * 30]);
  const back = deserialize(serialize(p));
  assert.deepEqual(pinnedFieldAt(back.schematic.sheets[0].symbols[0], 'reference'), [G * 30, G * 30]);
  const ids = pasteClip(p, s, copySelection(p, s, [sym.id]), [G * 10, 0]);
  const copy = s.symbols.find((y) => y.id === ids[0]);
  assert.deepEqual(pinnedFieldAt(copy, 'reference'), [G * 40, G * 30], 'a copy keeps the pin, relative to itself');
  unpinFields(p, [sym.id]);
  assert.ok(!hasPinnedFields(sym));
  const again = itemOf(p, s, sym, 'reference');
  assert.deepEqual([again.x, again.y], [auto.x, auto.y], 'placed by the style again');
});
