// Board drawings (#66): text and shapes on the Board's own layers, in the board view's geometry,
// the Gerbers, zones and DRC, and Eagle's <plain> text and graphics imported as them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newProject } from '../src/renderer/core/project.js';
import { rectOutline } from '../src/renderer/core/board.js';
import { newZone, zoneInput, fillZones } from '../src/renderer/core/zones.js';
import { fabFiles } from '../src/renderer/core/fab.js';
import { runDrc } from '../src/renderer/core/drc.js';
import { checkSchema } from '../src/renderer/core/schema-check.js';
import { ECAD_SCHEMA } from '../src/renderer/core/ecad-schema.js';
import { serialize, deserialize } from '../src/renderer/core/project.js';
import { strokeWidthOf } from '../src/renderer/core/strokefont.js';
import {
  textCentre, textStrokes, drawingGeometry, drawingBox, hitDrawing, moveDrawings, rotateDrawings, copperDrawingItems, drawingLayers,
} from '../src/renderer/core/boardDrawings.js';
import { importEagle } from '../src/renderer/io/eagle/index.js';
import { mm } from '../src/renderer/core/units.js';

const here = path.dirname(fileURLToPath(import.meta.url));

function board(drawings) {
  const p = newProject('Drawings');
  p.board.outline = rectOutline([0, 0], [mm(40), mm(30)]);
  p.board.drawings = drawings;
  return p;
}
const text = (o = {}) => ({ id: 'd1', type: 'text', layer: 'F.SilkS', text: 'HELLO', at: [mm(20), mm(15)], size: mm(1), rot: 0, ...o });
const box = (lines) => { const xs = lines.flat().map((q) => q[0]), ys = lines.flat().map((q) => q[1]); return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }; };

test('text: centred on at, turned anticlockwise, mirrored on the back', () => {
  const t = text();
  const b = box(textStrokes(t).lines);
  assert.ok(Math.abs((b.x0 + b.x1) / 2 - t.at[0]) <= 1 && Math.abs((b.y0 + b.y1) / 2 - t.at[1]) <= 1, 'centred');
  assert.ok(b.x1 - b.x0 > b.y1 - b.y0, 'reads across');
  const up = box(textStrokes(text({ rot: 90 })).lines);
  assert.ok(up.y1 - up.y0 > up.x1 - up.x0, 'turned 90° it reads upwards');
  // the first letter (H) is at the left on the front and at the right on the back
  const first = (d) => textStrokes(d).lines[0][0][0];
  assert.ok(first(text()) < t.at[0] && first(text({ layer: 'B.SilkS' })) > t.at[0]);
  // a box round the text picks it; outside doesn't
  assert.equal(hitDrawing([t], [mm(20.5), mm(15.2)], 0)?.id, 'd1');
  assert.equal(hitDrawing([t], [mm(30), mm(15)], 0), null);
  assert.equal(hitDrawing([t], [mm(20), mm(15)], 0, { visible: (l) => l !== 'F.SilkS' }), null, 'not on a hidden layer');
});

test('textCentre: Eagle\'s anchors (bottom-left by default) and rotation', () => {
  const size = mm(1.778), w = strokeWidthOf('ABC', size, 'vector'), cap = size * 0.9;
  const c = textCentre('ABC', { at: [0, 0], size, font: 'vector' });
  assert.deepEqual(c, [Math.round(w / 2), Math.round(-cap / 2)], 'up and to the right of a bottom-left anchor');
  assert.deepEqual(textCentre('ABC', { at: [0, 0], size, align: 'center', font: 'vector' }), [0, 0]);
  const r = textCentre('ABC', { at: [0, 0], size, rot: 90, font: 'vector' });
  assert.ok(Math.abs(r[0] - Math.round(-cap / 2)) <= 1 && Math.abs(r[1] - Math.round(-w / 2)) <= 1, `turned 90°: ${r}`);
  const m = textCentre('ABC', { at: [0, 0], size, mirror: true, font: 'vector' });
  assert.equal(m[0], -Math.round(w / 2), 'mirrored: to the left');
});

test('shapes: geometry, fill, box, hit, move and rotate', () => {
  const rect = { id: 'r', type: 'rect', layer: 'F.Fab', a: [0, 0], b: [mm(4), mm(2)], width: mm(0.1) };
  const g = drawingGeometry(rect);
  assert.equal(g.strokes.length, 1); assert.equal(g.strokes[0].pts.length, 5); assert.equal(g.fills.length, 0);
  assert.equal(drawingGeometry({ ...rect, fill: 'outline' }).fills.length, 1);
  assert.deepEqual(drawingBox(rect), { x0: -mm(0.05), y0: -mm(0.05), x1: mm(4.05), y1: mm(2.05) });
  assert.equal(hitDrawing([rect], [mm(2), mm(1)], mm(0.1)), null, 'an open rectangle is picked by its edge');
  assert.equal(hitDrawing([{ ...rect, fill: 'outline' }], [mm(2), mm(1)], mm(0.1))?.id, 'r', 'a filled one anywhere inside');
  assert.equal(hitDrawing([rect], [mm(2), mm(2.05)], mm(0.1))?.id, 'r');
  const line = { id: 'l', type: 'line', layer: 'F.SilkS', pts: [[0, 0], [mm(1), 0]] };
  assert.equal(drawingGeometry(line).strokes[0].width, mm(0.15), 'silk default pen');
  moveDrawings([line, rect], [mm(1), mm(2)]);
  assert.deepEqual(line.pts, [[mm(1), mm(2)], [mm(2), mm(2)]]); assert.deepEqual(rect.a, [mm(1), mm(2)]);
  const t = text({ at: [mm(1), 0] });
  rotateDrawings([t, line], 90, [0, 0]);
  assert.deepEqual(t.at, [0, -mm(1)]); assert.equal(t.rot, 90);
  assert.deepEqual(line.pts[0], [mm(2), -mm(1)]);
  assert.ok(drawingLayers(4).includes('In1.Cu') && !drawingLayers(2).includes('In1.Cu'));
});

test('Gerbers: silk text in the GTO, a mask opening in the GTS, copper text NonConductor in the GTL', () => {
  const p = board([
    text(),
    { id: 'm', type: 'rect', layer: 'F.Mask', a: [mm(2), mm(2)], b: [mm(6), mm(4)], width: 0, fill: 'outline' },
    text({ id: 'cu', layer: 'F.Cu', text: 'REV A', at: [mm(10), mm(25)] }),
  ]);
  const files = Object.fromEntries(fabFiles(p, { date: 'd', version: 'v' }).map((f) => [f.name.split('.').pop(), f.text]));
  const strokes = (txt) => (txt.match(/D01\*/g) || []).length;
  const plain = Object.fromEntries(fabFiles(board([]), { date: 'd', version: 'v' }).map((f) => [f.name.split('.').pop(), f.text]));
  assert.ok(strokes(files.GTO) > strokes(plain.GTO) + 10, 'HELLO is drawn in strokes on the top silk');
  assert.equal(strokes(files.GBO), strokes(plain.GBO), 'nothing on the bottom silk');
  assert.match(files.GTS, /G36\*/, 'the mask rectangle is a region');
  assert.match(files.GTL, /AperFunction,NonConductor/);
  assert.ok(strokes(files.GTL) > strokes(plain.GTL));
});

test('zones pour round copper drawings, and DRC keeps other copper clear of them', () => {
  const cu = text({ id: 'cu', layer: 'B.Cu', text: 'GND PLANE', at: [mm(20), mm(15)], size: mm(2) });
  const p = board([cu]);
  // keepIslands: there are no GND pads to tie the pour to
  p.board.zones.push({ ...newZone('B.Cu', 'GND', [[mm(1), mm(1)], [mm(39), mm(1)], [mm(39), mm(29)], [mm(1), mm(29)]]), id: 'z', keepIslands: true });
  const fills = fillZones(zoneInput(p));
  const items = copperDrawingItems(p.board);
  assert.ok(items.length > 10 && items.every((it) => it.id === 'cu' && it.net === '' && it.layers.has('B.Cu')));
  const rings = fills.get('z').polys.flat();
  assert.ok(rings.length > 1, 'the fill has holes round the letters');
  // and without the text it has none
  const none = board([]); none.board.zones = p.board.zones;
  assert.equal(fillZones(zoneInput(none)).get('z').polys.flat().length, 1);
  assert.equal(runDrc(p, fills).filter((v) => v.rule === 'clearance').length, 0, 'the pour keeps its clearance');
  // a track over the text is a clearance error naming it, once
  p.board.tracks.push({ id: 't', a: [mm(15), mm(15)], b: [mm(25), mm(15)], width: mm(0.25), layer: 'B.Cu', net: 'SIG' });
  const v = runDrc(p, new Map()).filter((x) => x.rule === 'clearance');
  assert.equal(v.length, 1, JSON.stringify(v.map((x) => x.message)));
  assert.match(v[0].message, /board text "GND PLANE"/);
  // silk drawings are not copper
  assert.equal(copperDrawingItems(board([text()]).board).length, 0);
});

test('drawings are saved with the Project and pass the schema', () => {
  const p = board([text(), { id: 'c', type: 'circle', layer: 'B.Fab', c: [0, 0], r: mm(1), width: mm(0.1), fill: 'outline' },
    { id: 'a', type: 'arc', layer: 'F.SilkS', start: [0, 0], mid: [mm(1), mm(1)], end: [mm(2), 0] }, { id: 'q', type: 'poly', layer: 'F.Cu', pts: [[0, 0], [mm(1), 0], [0, mm(1)]], fill: 'outline' }]);
  const back = deserialize(serialize(p));
  assert.deepEqual(back.board.drawings, p.board.drawings);
  assert.deepEqual(checkSchema(ECAD_SCHEMA, JSON.parse(serialize(p))), []);
});

test('Eagle import: <plain> text and graphics become Board drawings', () => {
  const dir = path.join(here, 'fixtures', 'eagle');
  const r = importEagle({ sch: fs.readFileSync(path.join(dir, 'regulator.sch'), 'utf8'), brd: fs.readFileSync(path.join(dir, 'regulator.brd'), 'utf8'), name: 'reg' });
  const t = r.project.board.drawings.find((d) => d.type === 'text');
  assert.equal(t.text, 'REG v1'); assert.equal(t.layer, 'F.SilkS'); assert.equal(t.rot, 0);
  // anchored bottom-left at (2, 2) mm: the centre is up and right of it
  const w = strokeWidthOf('REG v1', mm(1.27), 'vector');
  assert.deepEqual(t.at, [mm(2) + Math.round(w / 2), -mm(2) - Math.round(mm(1.27) * 0.9 / 2)]);
  assert.ok(!r.report.some((x) => /layer 21/.test(x)), r.report.join('\n'));
});

test('Eagle import: bottom text, turned text kept readable, multi-line text, rectangles, circles and wires', () => {
  const brd = fs.readFileSync(path.join(here, 'fixtures', 'eagle', 'regulator.brd'), 'utf8').replace('</plain>', [
    '<text x="10" y="10" size="1" layer="22" rot="MR0">BACK</text>',
    '<text x="20" y="10" size="1" layer="21" rot="R180">UPSIDE</text>',
    '<text x="20" y="20" size="1" layer="21" rot="SR180">SPUN</text>',
    '<text x="30" y="10" size="1" layer="51">ONE\nTWO</text>',
    '<rectangle x1="1" y1="1" x2="3" y2="2" layer="29"/>',
    '<circle x="5" y="5" radius="1" width="0" layer="1"/>',
    '<wire x1="0" y1="5" x2="10" y2="5" width="0.2" layer="21"/>',
    '<wire x1="0" y1="6" x2="10" y2="6" width="0.2" layer="21" curve="90"/>',
    '</plain>'].join('\n'));
  const { project, report } = importEagle({ brd, name: 'x' });
  const ds = project.board.drawings, byText = (s) => ds.find((d) => d.text === s);
  assert.equal(byText('BACK').layer, 'B.SilkS');
  assert.ok(byText('BACK').at[0] < mm(10), 'mirrored text runs left of its anchor');
  assert.equal(byText('UPSIDE').rot, 0, 'R180 is drawn the right way up');
  assert.ok(byText('UPSIDE').at[0] < mm(20), '…from the opposite corner');
  assert.equal(byText('SPUN').rot, 180, 'spun text stays upside down');
  assert.equal(byText('ONE').layer, 'F.Fab'); assert.ok(byText('ONE').at[1] < byText('TWO').at[1], 'lines go down the page');
  assert.ok(ds.some((d) => d.type === 'rect' && d.layer === 'F.Mask' && d.fill === 'outline'));
  assert.ok(ds.some((d) => d.type === 'circle' && d.layer === 'F.Cu' && d.fill === 'outline'));
  assert.ok(ds.some((d) => d.type === 'line' && d.width === mm(0.2)));
  assert.ok(ds.some((d) => d.type === 'arc'));
  assert.ok(!report.some((x) => /Board drawings/.test(x)), report.join('\n'));
});
