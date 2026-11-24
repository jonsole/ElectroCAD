import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newProject, addComponent, pinPositions, padForPin, serialize } from '../src/renderer/core/project.js';
import { History } from '../src/renderer/core/history.js';
import { MINI_LIBRARY, RESISTOR, CAPACITOR, LED, searchParts } from '../src/renderer/library/mini.js';
import { placeSymbol, rotateSymbols, mirrorSymbols, deleteSymbols, symbolBounds } from '../src/renderer/core/schematic.js';
import { SCH_GRID, mm } from '../src/renderer/core/units.js';

const onGrid = ([x, y]) => x % SCH_GRID === 0 && y % SCH_GRID === 0;

test('mini Library parts are valid: Pins on the grid, a Pin map for every Pin, Pads to match', () => {
  for (const part of MINI_LIBRARY) {
    const pins = part.units.flatMap((u) => u.pins);
    for (const pin of pins) assert.ok(onGrid(pin.at), `${part.name} pin ${pin.number} off grid`);
    assert.equal(new Set(pins.map((x) => x.number)).size, pins.length, `${part.name}: pin numbers are unique across Units`);
    for (const [fpId, fp] of Object.entries(part.footprints)) {
      const pads = new Set(fp.pads.map((p) => p.number));
      // a missing Pin map entry means Pin n -> Pad n
      for (const pin of pins) assert.ok(pads.has(part.pinMap?.[fpId]?.[pin.number] ?? pin.number), `${part.name} pin ${pin.number} has no pad on ${fpId}`);
    }
  }
});

test('Pins stay on the grid when a Symbol placed on the grid is rotated or mirrored', () => {
  const p = newProject();
  const sheet = p.schematic.sheets[0];
  for (const part of MINI_LIBRARY) {
    for (const rot of [0, 90, 180, 270]) {
      for (const mirror of [false, true]) {
        const { sym } = addComponent(p, sheet, part, [SCH_GRID * 20, SCH_GRID * 30], { rot, mirror });
        for (const { at } of pinPositions(p, sym)) assert.ok(onGrid(at), `${part.name} rot ${rot} mirror ${mirror}`);
      }
    }
  }
});

test('search matches names and keywords', () => {
  assert.deepEqual(searchParts(MINI_LIBRARY, 'cap').map((p) => p.name), ['Capacitor', 'Capacitor (polarised)']);
  assert.deepEqual(searchParts(MINI_LIBRARY, 'diode').map((p) => p.name), ['LED', 'Diode']);
  assert.deepEqual(searchParts(MINI_LIBRARY, 'cap', 'Semiconductors'), [], 'a category narrows the search');
  assert.deepEqual(searchParts(MINI_LIBRARY, '', 'Power').map((p) => p.name), ['AMS1117-3.3']);
  assert.equal(searchParts(MINI_LIBRARY, '').length, MINI_LIBRARY.length);
  assert.deepEqual(searchParts(MINI_LIBRARY, 'op-amp').map((p) => p.name), ['LM324', 'LM358']);
});

test('placing snaps to the grid and allocates Reference designators per prefix', () => {
  const p = newProject();
  const s = p.schematic.sheets[0];
  const a = placeSymbol(p, s, RESISTOR, [mm(10.1), mm(9.9)]);
  const b = placeSymbol(p, s, RESISTOR, [mm(30), mm(10)]);
  const c = placeSymbol(p, s, CAPACITOR, [mm(50), mm(10)]);
  const d = placeSymbol(p, s, LED, [mm(70), mm(10)], { rot: 90 });
  assert.deepEqual([a, b, c, d].map((x) => x.comp.ref), ['R1', 'R2', 'C1', 'D1']);
  assert.ok(onGrid(a.sym.at), 'snapped to the 50 mil grid');
  assert.equal(d.sym.rot, 90);
  assert.equal(a.comp.value, '10k');
  assert.deepEqual(a.comp.footprint, { fpId: 'R_0805' });
  assert.equal(padForPin(p, d.comp, '2'), '2');
});

test('each placement is one undo step; undo and redo restore exactly', () => {
  let project = newProject();
  const h = new History(() => project, (x) => { project = x; });
  const empty = serialize(project);
  h.transact('Place R1', (p) => placeSymbol(p, p.schematic.sheets[0], RESISTOR, [mm(10), mm(10)]));
  const one = serialize(project);
  h.transact('Place R2', (p) => placeSymbol(p, p.schematic.sheets[0], RESISTOR, [mm(30), mm(10)]));
  assert.equal(Object.keys(project.components).length, 2);
  h.undo();
  assert.equal(serialize(project), one);
  h.undo();
  assert.equal(serialize(project), empty);
  assert.equal(h.canUndo, false);
  h.redo(); h.redo();
  assert.deepEqual(Object.values(project.components).map((c) => c.ref).sort(), ['R1', 'R2']);
  // a new edit after undo clears redo, and the freed designator is reused
  h.undo();
  h.transact('Place C1', (p) => placeSymbol(p, p.schematic.sheets[0], CAPACITOR, [mm(30), mm(10)]));
  assert.equal(h.canRedo, false);
  h.transact('Place R', (p) => placeSymbol(p, p.schematic.sheets[0], RESISTOR, [mm(50), mm(10)]));
  assert.deepEqual(Object.values(project.components).map((c) => c.ref).sort(), ['C1', 'R1', 'R2']);
});

test('rotate and mirror selected Symbols; delete removes them and their Components', () => {
  const p = newProject();
  const s = p.schematic.sheets[0];
  const a = placeSymbol(p, s, RESISTOR, [mm(10), mm(10)]);
  const b = placeSymbol(p, s, LED, [mm(30), mm(10)]);
  rotateSymbols(p, [a.sym.id]);
  assert.equal(a.sym.rot, 90);
  rotateSymbols(p, [a.sym.id]); rotateSymbols(p, [a.sym.id]); rotateSymbols(p, [a.sym.id]);
  assert.equal(a.sym.rot, 0);
  mirrorSymbols(p, [b.sym.id]);
  assert.equal(b.sym.mirror, true);
  deleteSymbols(p, [a.sym.id]);
  assert.deepEqual(s.symbols.map((y) => y.id), [b.sym.id]);
  assert.deepEqual(Object.values(p.components).map((c) => c.ref), ['D1']);
  assert.deepEqual(Object.keys(p.parts), ['builtin/led@1'], 'unused Parts are dropped too; Parts are keyed by Library origin');
});

test('symbol bounds follow rotation and cover the Pins', () => {
  const p = newProject();
  const { sym } = placeSymbol(p, p.schematic.sheets[0], RESISTOR, [mm(50), mm(50)]);
  let b = symbolBounds(p, sym);
  assert.ok(b.x1 - b.x0 >= 8 * SCH_GRID && b.y1 - b.y0 < 3 * SCH_GRID, JSON.stringify(b));
  rotateSymbols(p, [sym.id]);
  b = symbolBounds(p, sym);
  assert.ok(b.y1 - b.y0 >= 8 * SCH_GRID && b.x1 - b.x0 < 3 * SCH_GRID, JSON.stringify(b));
});
