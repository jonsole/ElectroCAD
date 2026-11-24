import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newProject, newSheet, serialize, deserialize } from '../src/renderer/core/project.js';
import { addDrawing, deleteItems, moveSelection, copySelection, pasteClip, itemsInRect, rotateSymbols } from '../src/renderer/core/schematic.js';
import { paperRect, titleBlockLayout, expandVariables, textVariables, drawingBounds, hitDrawing, rotateDrawing, drawingDefaults, PAPER_SIZES } from '../src/renderer/core/drawings.js';
import { mm, SCH_GRID as G } from '../src/renderer/core/units.js';

const setup = () => { const p = newProject('Amp'); return { p, s: p.schematic.sheets[0] }; };
const text = (over = {}) => ({ type: 'text', at: [G * 10, G * 10], text: 'Hello', ...drawingDefaults('text'), ...over });

test('paper sizes and orientation set the sheet frame', () => {
  const s = newSheet('X');
  assert.deepEqual(paperRect(s), { x0: 0, y0: 0, x1: mm(297), y1: mm(210) }, 'A4 landscape by default');
  s.paper = { size: 'A3', orientation: 'portrait' };
  assert.deepEqual(paperRect(s), { x0: 0, y0: 0, x1: mm(297), y1: mm(420) });
  assert.ok(PAPER_SIZES.Letter && PAPER_SIZES.Tabloid);
});

test('the title block sits in the bottom-right corner and shows sheet n of N', () => {
  const { p, s } = setup();
  const s2 = newSheet('Power'); p.schematic.sheets.push(s2);
  const tb = titleBlockLayout(s2);
  const r = paperRect(s2);
  assert.equal(tb.box.x1, r.x1 - mm(5));
  assert.equal(tb.box.y1, r.y1 - mm(5));
  const cell = (k) => tb.cells.find((c) => c.key === k);
  assert.equal(cell('number').value(p, s2), '2 of 2');
  assert.equal(cell('sheet').value(p, s2), 'Power');
  assert.equal(cell('title').value(p, s2), 'Amp', 'no title: the Project name');
  p.titleBlock.title = 'Headphone amp';
  assert.equal(cell('title').value(p, s), 'Headphone amp');
  for (const c of tb.cells) assert.ok(c.box.x0 >= tb.box.x0 && c.box.x1 <= tb.box.x1 && c.box.y0 >= tb.box.y0 && c.box.y1 <= tb.box.y1, c.key);
});

test('text variables expand; unknown ones are left as typed', () => {
  const { p, s } = setup();
  p.titleBlock.revision = 'C';
  p.schematic.sheets.push(newSheet('Two'));
  assert.equal(expandVariables('${TITLE} rev ${REV}, sheet ${SHEET_NUMBER}/${SHEET_COUNT} (${SHEET_NAME}) ${NOPE}', p, s), 'Amp rev C, sheet 1/2 (Sheet 1) ${NOPE}');
  assert.ok(Object.keys(textVariables(p, s)).includes('COMPANY'));
});

test('text notes: bounds follow alignment, lines and rotation', () => {
  const m = (t, size) => t.length * size; // 1 size per character
  const d = text({ text: 'ab\nabcd' });
  let b = drawingBounds(d, m);
  assert.equal(b.x0, G * 10); assert.equal(b.x1 - b.x0, 4 * d.size);
  assert.ok(b.y1 - b.y0 >= 2 * d.size, 'two lines');
  d.align = 'right'; b = drawingBounds(d, m);
  assert.equal(b.x1, G * 10);
  d.align = 'left'; d.rot = 90; b = drawingBounds(d, m);
  assert.equal(b.y1, G * 10, 'turned 90°: the text runs up the sheet from its anchor');
  assert.equal(b.y1 - b.y0, 4 * d.size);
});

test('hit testing: outlines on their line, tinted shapes inside, arcs on their sweep', () => {
  const { p, s } = setup();
  const r = addDrawing(p, s, { type: 'rect', a: [0, 0], b: [G * 10, G * 10], ...drawingDefaults('rect') });
  assert.equal(hitDrawing(s, [G * 5, 0], G / 4), r);
  assert.equal(hitDrawing(s, [G * 5, G * 5], G / 4), null, 'an outline is empty inside');
  r.fill = 'tint';
  assert.equal(hitDrawing(s, [G * 5, G * 5], G / 4), r);
  const a = addDrawing(p, s, { type: 'arc', start: [G * 20, 0], mid: [G * 25, -G * 5], end: [G * 30, 0], ...drawingDefaults('arc') });
  assert.equal(hitDrawing(s, [G * 25, -G * 5], G / 4), a, 'on the arc');
  assert.equal(hitDrawing(s, [G * 25, G * 5], G / 4), null, 'the other half of the circle is not the arc');
  const l = addDrawing(p, s, { type: 'line', pts: [[0, G * 20], [G * 10, G * 20]], ...drawingDefaults('line') });
  assert.equal(hitDrawing(s, [G * 5, G * 20], G / 4), l);
});

test('markup moves, rotates, copies, deletes and box-selects with everything else', () => {
  const { p, s } = setup();
  const t = addDrawing(p, s, text());
  const r = addDrawing(p, s, { type: 'rect', a: [0, 0], b: [G * 4, G * 2], ...drawingDefaults('rect') });
  moveSelection(p, s, [t.id, r.id], [G, G * 2]);
  assert.deepEqual(t.at, [G * 11, G * 12]);
  assert.deepEqual([r.a, r.b], [[G, G * 2], [G * 5, G * 4]]);
  rotateSymbols(p, [t.id, r.id]);
  assert.equal(t.rot, 90);
  const rb = drawingBounds(r);
  assert.deepEqual([rb.x1 - rb.x0, rb.y1 - rb.y0], [G * 2, G * 4], 'the box turned about its centre');
  const ids = pasteClip(p, s, copySelection(p, s, [t.id]), [0, G * 10]);
  assert.equal(s.drawings.length, 3);
  assert.equal(s.drawings.find((d) => d.id === ids[0]).at[1], G * 22);
  const box = drawingBounds(r);
  assert.ok(itemsInRect(p, s, { x0: box.x0 - 1, y0: box.y0 - 1, x1: box.x1 + 1, y1: box.y1 + 1 }, 'window').includes(r.id));
  deleteItems(p, [r.id]);
  assert.equal(s.drawings.length, 2);
});

test('markup, paper and the title block survive save and load', () => {
  const { p, s } = setup();
  addDrawing(p, s, text({ text: 'Rev ${REV}' }));
  s.paper = { size: 'Letter', orientation: 'portrait' };
  p.titleBlock.author = 'Me';
  const back = deserialize(serialize(p));
  assert.equal(back.schematic.sheets[0].drawings[0].text, 'Rev ${REV}', 'stored raw');
  assert.deepEqual(back.schematic.sheets[0].paper, { size: 'Letter', orientation: 'portrait' });
  assert.equal(back.titleBlock.author, 'Me');
  const d = structuredClone(s.drawings[0]); rotateDrawing(d); rotateDrawing(d);
  assert.equal(d.rot, 0, 'text turns between 0 and 90 only');
});
