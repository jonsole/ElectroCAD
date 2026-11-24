import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newProject, serialize, deserialize, VERSION } from '../src/renderer/core/project.js';
import { placeSymbol, addWire } from '../src/renderer/core/schematic.js';
import {
  placeFields, estimateWidth, styleFor, setDefaultFieldStyle, setComponentFieldStyle, builtinFieldStyle,
  importFieldStyle, exportFieldStyle, duplicateFieldStyle, FieldStyleError, fieldWarnings,
} from '../src/renderer/core/fields.js';
import { RESISTOR, CAPACITOR, LED } from '../src/renderer/library/mini.js';
import { SCH_GRID as G } from '../src/renderer/core/units.js';

const measure = estimateWidth;
const boxesOf = (pl) => [...pl.values()].flatMap((r) => r.items.map((i) => i.box));
const intersects = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
function noOverlaps(pl) {
  const bs = boxesOf(pl);
  for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) if (intersects(bs[i], bs[j])) return false;
  return true;
}

test('Classic: a lone horizontal resistor gets Reference above and Value below', () => {
  const p = newProject();
  const s = p.schematic.sheets[0];
  const { sym } = placeSymbol(p, s, RESISTOR, [G * 40, G * 40]);
  const r = placeFields(p, s, { measure }).get(sym.id);
  assert.equal(r.slot, 'split');
  const ref = r.items.find((i) => i.keys.includes('reference')), val = r.items.find((i) => i.keys.includes('value'));
  assert.ok(ref.y < sym.at[1] && val.y > sym.at[1]);
  assert.equal(ref.text, 'R1'); assert.equal(val.text, '10k');
  assert.equal(r.flagged, false);
});

test('Classic: a vertical resistor stacks its fields to the right', () => {
  const p = newProject();
  const s = p.schematic.sheets[0];
  const { sym } = placeSymbol(p, s, RESISTOR, [G * 40, G * 40], { rot: 90 });
  const r = placeFields(p, s, { measure }).get(sym.id);
  assert.equal(r.slot, 'right');
  assert.ok(r.items.every((i) => i.box.x0 > sym.at[0]));
});

test('crowded neighbours: the placer moves on to the next free slot instead of overlapping', () => {
  const p = newProject();
  const s = p.schematic.sheets[0];
  // a column of vertical resistors 3 grid apart: "right" collides with the next one, so the
  // placer must find other slots; and a row of horizontal ones touching end to end
  for (let i = 0; i < 4; i++) placeSymbol(p, s, RESISTOR, [G * (20 + i * 6), G * 20], { rot: 90 });
  for (let i = 0; i < 4; i++) placeSymbol(p, s, RESISTOR, [G * (20 + i * 9), G * 40]);
  placeSymbol(p, s, LED, [G * 30, G * 55]);
  const pl = placeFields(p, s, { measure });
  assert.ok(noOverlaps(pl), 'no two field boxes intersect');
  assert.deepEqual(fieldWarnings(p, s, pl), []);
});

test('fields avoid Wires', () => {
  const p = newProject();
  const s = p.schematic.sheets[0];
  const { sym } = placeSymbol(p, s, RESISTOR, [G * 40, G * 40]);
  addWire(p, s, [[G * 30, G * 38], [G * 50, G * 38]]); // runs just above the body where the Reference would go
  const r = placeFields(p, s, { measure }).get(sym.id);
  assert.notEqual(r.slot, 'split');
  assert.equal(r.flagged, false);
});

test('when nothing is free the least-overlap slot is used and the field is flagged', () => {
  const p = newProject();
  const s = p.schematic.sheets[0];
  const { sym } = placeSymbol(p, s, RESISTOR, [G * 40, G * 40]);
  for (const dy of [-6, -4, -2, 2, 4, 6]) addWire(p, s, [[G * 25, G * (40 + dy)], [G * 55, G * (40 + dy)]]);
  for (const dx of [-6, -5, 5, 6]) addWire(p, s, [[G * (40 + dx), G * 30], [G * (40 + dx), G * 50]]);
  const pl = placeFields(p, s, { measure });
  assert.equal(pl.get(sym.id).flagged, true);
  assert.match(fieldWarnings(p, s, pl)[0], /^R1 fields overlap a wire$/);
});

test('placement is deterministic', () => {
  const p = newProject();
  const s = p.schematic.sheets[0];
  for (let i = 0; i < 6; i++) placeSymbol(p, s, RESISTOR, [G * (20 + (i % 3) * 7), G * (20 + Math.floor(i / 3) * 5)], { rot: (i % 2) * 90 });
  const a = JSON.stringify([...placeFields(p, s, { measure })]);
  const b = JSON.stringify([...placeFields(p, s, { measure })]);
  assert.equal(a, b);
});

test('Compact puts "R1 10k" on one line and hides a Value equal to the Part name', () => {
  const p = newProject();
  const s = p.schematic.sheets[0];
  const r = placeSymbol(p, s, RESISTOR, [G * 30, G * 30]).sym;
  const d = placeSymbol(p, s, LED, [G * 60, G * 30]).sym;
  setDefaultFieldStyle(p, builtinFieldStyle('compact'));
  const pl = placeFields(p, s, { measure });
  assert.deepEqual(pl.get(r.id).items.map((i) => i.text), ['R1 10k']);
  assert.deepEqual(pl.get(d.id).items.map((i) => i.text), ['D1']);
});

test('RKM values change only what is drawn', () => {
  const p = newProject();
  const s = p.schematic.sheets[0];
  const { comp, sym } = placeSymbol(p, s, RESISTOR, [G * 30, G * 30]);
  comp.value = '4.7k';
  setComponentFieldStyle(p, [comp.id], builtinFieldStyle('rkm'));
  assert.ok(placeFields(p, s, { measure }).get(sym.id).items.some((i) => i.text === '4k7'));
  assert.equal(comp.value, '4.7k');
});

test('per-Component override and clearing it', () => {
  const p = newProject();
  const s = p.schematic.sheets[0];
  const a = placeSymbol(p, s, RESISTOR, [G * 30, G * 30]).comp;
  const b = placeSymbol(p, s, RESISTOR, [G * 50, G * 30]).comp;
  setComponentFieldStyle(p, [a.id], builtinFieldStyle('stacked-right'));
  assert.equal(styleFor(p, a).id, 'stacked-right');
  assert.equal(styleFor(p, b).id, 'classic');
  setDefaultFieldStyle(p, builtinFieldStyle('compact'));
  assert.equal(styleFor(p, a).id, 'stacked-right', 'the override wins over the new default');
  assert.equal(styleFor(p, b).id, 'compact');
  setComponentFieldStyle(p, [a.id], null);
  assert.equal(styleFor(p, a).id, 'compact');
  assert.ok(p.fieldStyles.styles['stacked-right'], 'styles in use are copied into the Project');
});

test('before 1.0, a Project from an earlier format version is refused with a clear message (ADR-0014)', () => {
  const old = JSON.parse(serialize(newProject()));
  old.version = VERSION - 1;
  assert.throws(() => deserialize(JSON.stringify(old)), /earlier development version[\s\S]*Before version 1\.0/);
});

test('field style files: export/import round trip, fills gaps, refuses bad ones', () => {
  const mine = duplicateFieldStyle(builtinFieldStyle('compact'));
  mine.valueFormat = 'rkm';
  const back = importFieldStyle(exportFieldStyle(mine), [mine]);
  assert.equal(back.valueFormat, 'rkm');
  assert.equal(back.arrangement, 'one-line');
  assert.notEqual(back.id, mine.id);
  assert.equal(back.name, 'Compact (copy) (2)');
  const filled = importFieldStyle(JSON.stringify({ format: 'electrocad-field-style', version: 1, name: 'Mini' }));
  assert.deepEqual(filled.placement, builtinFieldStyle('classic').placement);
  assert.throws(() => importFieldStyle('{}'), FieldStyleError);
  assert.throws(() => importFieldStyle(JSON.stringify({ format: 'electrocad-field-style', placement: { horizontal: ['upside'] } })), /placement\.horizontal/);
  assert.throws(() => importFieldStyle(JSON.stringify({ format: 'electrocad-field-style', valueFormat: 'roman' })), /valueFormat/);
});

test('thin line graphics (capacitor plates) count as obstacles', () => {
  const p = newProject();
  const s = p.schematic.sheets[0];
  // two vertical capacitors close together with Compact one-line fields: "C1 0.1u" must not run into C2
  setDefaultFieldStyle(p, builtinFieldStyle('compact'));
  const c1 = placeSymbol(p, s, CAPACITOR, [G * 46, G * 48], { rot: 90 });
  c1.comp.value = '0.1u';
  placeSymbol(p, s, CAPACITOR, [G * 52, G * 48], { rot: 90 }).comp.value = '10u';
  const pl = placeFields(p, s, { measure });
  const c2body = { x0: G * 52 - G * 1.6, x1: G * 52 + G * 1.6, y0: G * 47.6, y1: G * 48.4 };
  for (const it of pl.get(c1.sym.id).items) assert.ok(!intersects(it.box, c2body), JSON.stringify(it.box));
});

import { hitField } from '../src/renderer/core/fields.js';

test('hitField finds the Reference and Value under a point, and splits one-line fields', () => {
  const p = newProject();
  const s = p.schematic.sheets[0];
  const { sym } = placeSymbol(p, s, RESISTOR, [G * 40, G * 40]);
  let pl = placeFields(p, s, { measure });
  const ref = pl.get(sym.id).items.find((i) => i.keys.includes('reference'));
  const val = pl.get(sym.id).items.find((i) => i.keys.includes('value'));
  const mid = (b) => [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
  assert.equal(hitField(p, pl, mid(ref.box)).key, 'reference');
  assert.equal(hitField(p, pl, mid(val.box)).key, 'value');
  assert.equal(hitField(p, pl, [G * 40, G * 40]), null, 'the body is not a field');
  setDefaultFieldStyle(p, builtinFieldStyle('compact'));
  pl = placeFields(p, s, { measure });
  const line = pl.get(sym.id).items[0]; // "R1 10k"
  assert.equal(hitField(p, pl, [line.box.x0 + 1, mid(line.box)[1]]).key, 'reference');
  assert.equal(hitField(p, pl, [line.box.x1 - 1, mid(line.box)[1]]).key, 'value');
});

test('RKM values: a capacitor valued 52 shows 52, a resistor 52R', () => {
  const p = newProject();
  const s = p.schematic.sheets[0];
  setDefaultFieldStyle(p, builtinFieldStyle('rkm'));
  const c = placeSymbol(p, s, CAPACITOR, [G * 20, G * 20]); c.comp.value = '52';
  const r = placeSymbol(p, s, RESISTOR, [G * 50, G * 20]); r.comp.value = '52';
  const pl = placeFields(p, s, { measure });
  assert.ok(pl.get(c.sym.id).items.some((i) => i.text === '52'));
  assert.ok(pl.get(r.sym.id).items.some((i) => i.text === '52R'));
});
