import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newProject, addComponent, footprintRef } from '../src/renderer/core/project.js';
import { addLabel, addWire } from '../src/renderer/core/schematic.js';
import { pinPositions } from '../src/renderer/core/project.js';
import { changeList, applyChanges } from '../src/renderer/core/annotate.js';
import { placedPads, padNets } from '../src/renderer/core/footprint.js';
import { rectOutline } from '../src/renderer/core/board.js';
import { newZone, zoneInput, fillZones } from '../src/renderer/core/zones.js';
import { fabFiles, fillRegions, gerberLayers, fabFileName } from '../src/renderer/core/fab.js';
import { makeZip, readZip } from '../src/renderer/core/zip.js';
import { strokeText, glyph } from '../src/renderer/core/strokefont.js';
import { applyPreset } from '../src/renderer/core/presets.js';
import { allFootprints } from '../src/renderer/library/footprints.js';
import { STARTER_LIBRARY } from '../src/renderer/library/starter.js';
import { mm, SCH_GRID as G } from '../src/renderer/core/units.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN = path.join(here, 'fixtures', 'fab');
const part = (n) => STARTER_LIBRARY.find((p) => p.name === n);
const fpNamed = (n) => allFootprints().find((f) => f.name === n);

/** A small board with every kind of thing the fab output must carry. */
function fixture() {
  const p = newProject('Fab Test');
  p.id = 'fixture';
  const s = p.schematic.sheets[0];
  const r1 = addComponent(p, s, part('Resistor'), [G * 10, G * 10]).comp;
  const r2 = addComponent(p, s, part('Resistor'), [G * 30, G * 10]).comp;
  const r3 = addComponent(p, s, part('Resistor'), [G * 50, G * 10]).comp;
  const j1 = addComponent(p, s, part('Resistor'), [G * 10, G * 30]).comp;
  const h1 = addComponent(p, s, part('Resistor'), [G * 30, G * 30]).comp;
  j1.footprint = footprintRef(p, { library: 'builtin', footprint: fpNamed('PinHeader_1x03_P2.54mm_Vertical') });
  h1.footprint = footprintRef(p, { library: 'user', footprint: { name: 'MountingHole_3.2mm', pads: [
    { number: '1', at: [0, 0], size: [mm(3.2), mm(3.2)], shape: 'circle', drill: mm(3.2), layers: [] },
    { number: '2', at: [mm(4), 0], size: [mm(1.7), mm(1.7)], shape: 'circle', drill: mm(1), layers: ['*.Cu', '*.Mask'] }],
    graphics: [{ type: 'circle', layer: 'F.SilkS', c: [0, 0], r: mm(2) }, { type: 'text', layer: 'F.SilkS', at: [0, mm(-3)], text: '${REF}', size: mm(1) }] } });
  const pin = (c, n) => pinPositions(p, s.symbols.find((y) => y.componentId === c.id)).find((x) => x.pin.number === n).at;
  addWire(p, s, [pin(r1, '2'), pin(r2, '1')]);
  addLabel(p, s, { at: pin(r1, '1'), net: 'GND', style: 'label', scope: 'local' });
  addLabel(p, s, { at: pin(r3, '1'), net: 'GND', style: 'label', scope: 'local' });
  applyChanges(p, changeList(p));
  const b = p.board;
  b.outline = [...rectOutline([0, 0], [mm(40), mm(30)]), { type: 'circle', c: [mm(35), mm(25)], r: mm(2), layer: 'Edge.Cuts', fill: 'none' }];
  const f = (c) => b.footprints.find((x) => x.componentId === c.id);
  f(r1).at = [mm(6), mm(6)];
  f(r2).at = [mm(16), mm(6)]; f(r2).rot = 45;
  f(r3).at = [mm(26), mm(6)]; f(r3).side = 'B';
  f(j1).at = [mm(8), mm(18)]; f(j1).rot = 30;
  f(h1).at = [mm(22), mm(20)];
  const nets = padNets(b);
  const pad = (c, n) => placedPads(p, f(c), nets).find((x) => x.number === n);
  const sig = pad(r1, '2').net;
  b.tracks.push({ id: 'tA', a: pad(r1, '2').at, b: [mm(11), mm(6)], width: mm(0.25), layer: 'F.Cu', net: sig });
  b.tracks.push({ id: 'tB', a: [mm(11), mm(6)], b: [mm(13), mm(8)], width: mm(0.25), layer: 'B.Cu', net: sig });
  b.vias.push({ id: 'v1', at: [mm(11), mm(6)], drill: mm(0.3), diameter: mm(0.6), from: 'F.Cu', to: 'B.Cu', net: sig });
  b.zones.push({ ...newZone('B.Cu', 'GND', [[mm(1), mm(1)], [mm(39), mm(1)], [mm(39), mm(29)], [mm(1), mm(29)]]), id: 'zGND' });
  const fills = fillZones(zoneInput(p));
  return { p, fills };
}

/** A small Gerber reader: apertures, flashes, strokes and regions in board nm (+Y down). */
function readGerber(text) {
  const aps = new Map(), flashes = [], strokes = [], regions = [];
  let cur = null, pos = null, inRegion = null, fs = false, units = null;
  const lines = text.split('\n').filter(Boolean);
  assert.equal(lines.at(-1), 'M02*', 'ends with M02');
  for (const l of lines) {
    if (l.startsWith('%FSLAX46Y46')) fs = true;
    else if (l === '%MOMM*%') units = 'mm';
    else if (l.startsWith('%ADD')) { const m = /^%ADD(\d+)([A-Z]),([\d.X]+)\*%$/.exec(l); assert.ok(m, `aperture ${l}`); aps.set(+m[1], { type: m[2], size: m[3].split('X').map((v) => Math.round(+v * 1e6)) }); }
    else if (/^D\d+\*$/.test(l)) { cur = +l.slice(1, -1); assert.ok(aps.has(cur), `D${cur} defined before use`); }
    else if (l === 'G36*') inRegion = [];
    else if (l === 'G37*') { assert.ok(inRegion.length >= 4, 'region has points'); assert.deepEqual(inRegion[0], inRegion.at(-1), 'region closed'); regions.push(inRegion); inRegion = null; }
    else if (/^X-?\d+Y-?\d+D0[123]\*$/.test(l)) {
      const [, x, y, d] = /^X(-?\d+)Y(-?\d+)D0([123])\*$/.exec(l);
      const q = [+x, -+y]; // back to board nm (+Y down)
      if (inRegion) { inRegion.push(q); continue; }
      if (d === '3') flashes.push({ ap: aps.get(cur), at: q });
      else if (d === '1') strokes.push({ ap: aps.get(cur), a: pos, b: q });
      pos = q;
    }
  }
  assert.ok(fs && units === 'mm', 'format and units');
  return { aps, flashes, strokes, regions };
}

const near = (a, b, tol = 2) => Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol;

test('golden files: the fixture board\'s Gerber and Excellon output matches the checked-in references', () => {
  const { p, fills } = fixture();
  const files = fabFiles(p, { fills, date: '2026-01-01T00:00:00Z', version: 'test' });
  if (process.env.UPDATE_GOLDEN) { fs.mkdirSync(GOLDEN, { recursive: true }); for (const f of files) fs.writeFileSync(path.join(GOLDEN, f.name), f.text); }
  const names = fs.readdirSync(GOLDEN).sort();
  assert.deepEqual(files.map((f) => f.name).sort(), names, 'the same files');
  for (const f of files) assert.equal(f.text, fs.readFileSync(path.join(GOLDEN, f.name), 'utf8'), `${f.name} matches its golden file (UPDATE_GOLDEN=1 npm test to refresh after a deliberate change)`);
});

test('every layer of a 2- and 4-layer stack, named by the Fab output settings', () => {
  const { p, fills } = fixture();
  const two = fabFiles(p, { fills, date: 'd', version: 'v' });
  assert.deepEqual(two.map((f) => f.name), ['Fab_Test.GTL', 'Fab_Test.GBL', 'Fab_Test.GTS', 'Fab_Test.GBS', 'Fab_Test.GTP', 'Fab_Test.GBP', 'Fab_Test.GTO', 'Fab_Test.GBO', 'Fab_Test.GKO', 'Fab_Test-PTH.drl', 'Fab_Test-NPTH.drl']);
  p.board.stack.copper = 4;
  p.board.fab = { naming: 'kicad', drillUnits: 'inch' };
  const four = fabFiles(p, { fills, date: 'd', version: 'v' });
  assert.ok(['Fab_Test-F_Cu.gbr', 'Fab_Test-In1_Cu.gbr', 'Fab_Test-In2_Cu.gbr', 'Fab_Test-B_Cu.gbr'].every((n) => four.some((f) => f.name === n)));
  assert.match(four.find((f) => f.layer === 'In1.Cu').text, /%TF\.FileFunction,Copper,L2,Inr\*%/);
  assert.match(four.find((f) => f.layer === 'B.Cu').text, /%TF\.FileFunction,Copper,L4,Bot\*%/);
  assert.match(four.find((f) => f.layer === 'PTH').text, /\nINCH\n/);
  assert.equal(gerberLayers(4).length, 11);
  assert.equal(fabFileName('x', 'Edge.Cuts'), 'x.GKO');
});

test('copper: pads of every shape, tracks, vias and zone fills land where the board has them (Y up in the file)', () => {
  const { p, fills } = fixture();
  const files = fabFiles(p, { fills, date: 'd', version: 'v' });
  const top = readGerber(files.find((f) => f.layer === 'F.Cu').text);
  const bot = readGerber(files.find((f) => f.layer === 'B.Cu').text);
  const b = p.board;
  // the via on both layers, the F.Cu track as a stroke 0.25 wide, the B.Cu one only on B.Cu
  for (const g of [top, bot]) assert.ok(g.flashes.some((x) => x.ap.type === 'C' && x.ap.size[0] === mm(0.6) && near(x.at, [mm(11), mm(6)])), 'via');
  assert.ok(top.strokes.some((s) => s.ap.size[0] === mm(0.25) && near(s.b, [mm(11), mm(6)])));
  assert.ok(bot.strokes.some((s) => near(s.a, [mm(11), mm(6)]) && near(s.b, [mm(13), mm(8)])));
  assert.ok(!top.strokes.some((s) => near(s.b, [mm(13), mm(8)])));
  // pads: each placed pad's centre is inside something drawn on its layers
  const nets = padNets(b);
  for (const bf of b.footprints) for (const pad of placedPads(p, bf, nets)) {
    const onTop = pad.layers.includes('F.Cu') || pad.layers.includes('*.Cu'), onBot = pad.layers.includes('B.Cu') || pad.layers.includes('*.Cu');
    for (const [on, g] of [[onTop, top], [onBot, bot]]) {
      if (!on) continue;
      const hit = g.flashes.some((x) => near(x.at, pad.at)) || g.strokes.some((s) => near([(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2], pad.at, 3)) || g.regions.some((r) => inside(pad.at, r));
      assert.ok(hit, `pad ${pad.number} of ${bf.id} at ${pad.at}`);
    }
  }
  // the rectangle pad of the header turned 30° is a region; the oval ones, strokes
  assert.ok(top.strokes.some((s) => s.ap.type === 'C' && s.ap.size[0] === mm(1.7)));
  // the GND zone on B.Cu: regions, none with a hole (they are cut into bands)
  assert.ok(bot.regions.length > 4);
  assert.ok(fillRegions(fills.get('zGND').polys).length === bot.regions.length - b.footprints.filter((f) => f.side === 'B').length * 0 - countPadRegions(p, 'B.Cu'));
});

function inside(pt, ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c; }
  return c;
}
function countPadRegions(p, layer) {
  const nets = padNets(p.board);
  let n = 0;
  for (const bf of p.board.footprints) for (const pad of placedPads(p, bf, nets)) {
    if (!(pad.layers.includes(layer) || pad.layers.includes('*.Cu'))) continue;
    const rot = ((pad.rot % 360) + 360) % 360, square = Math.abs(rot - Math.round(rot / 90) * 90) < 0.01;
    if (pad.shape === 'roundrect' || (pad.shape === 'rect' && !square)) n++;
  }
  return n;
}

test('mask openings grow by the margin, paste only on SMD pads, silk text in strokes, the outline with its cut-out', () => {
  const { p, fills } = fixture();
  const files = fabFiles(p, { fills, date: 'd', version: 'v' });
  const mask = files.find((f) => f.layer === 'F.Mask').text, paste = readGerber(files.find((f) => f.layer === 'F.Paste').text);
  assert.match(mask, /%TF\.FilePolarity,Negative\*%/);
  assert.ok(readGerber(mask).flashes.some((x) => x.ap.type === 'C' && x.ap.size[0] === mm(1.7) + 2 * 50_000), 'the 1.7 mm THT pad opens 1.8 mm');
  assert.ok(!paste.flashes.some((x) => x.ap.size[0] === mm(1.7)), 'no paste on THT pads');
  const silk = readGerber(files.find((f) => f.layer === 'F.SilkS').text);
  assert.ok(silk.strokes.length > 20, 'reference designators as strokes');
  const back = readGerber(files.find((f) => f.layer === 'B.SilkS').text);
  assert.ok(back.strokes.length > 5, 'R3 on the back');
  const edge = readGerber(files.find((f) => f.layer === 'Edge.Cuts').text);
  assert.ok(edge.strokes.some((s) => near(s.a, [0, 0]) || near(s.b, [0, 0])));
  assert.ok(edge.strokes.some((s) => Math.hypot(s.a[0] - mm(35), s.a[1] - mm(25)) > mm(1.9) && Math.hypot(s.a[0] - mm(35), s.a[1] - mm(25)) < mm(2.1)), 'the round cut-out');
});

test('Excellon: plated holes (vias, plated pads) and non-plated ones, by tool, Y up', () => {
  const { p, fills } = fixture();
  const files = fabFiles(p, { fills, date: 'd', version: 'v' });
  const pth = files.find((f) => f.layer === 'PTH').text, npth = files.find((f) => f.layer === 'NPTH').text;
  assert.match(pth, /T\dC0\.300/); // the via
  assert.match(pth, /X11\.000Y-6\.000/);
  assert.match(pth, /T\dC1\.000/); // the plated mounting pad
  assert.match(npth, /T1C3\.200/);
  assert.match(npth, /X22\.000Y-20\.000/);
  assert.match(npth, /TF\.FileFunction,NonPlated,1,2,NPTH/);
  assert.equal((pth.match(/^X/gm) || []).length, 1 + 3 + 1); // via, three header pins, the plated pad
});

test('the fab zip holds every file, intact', () => {
  const { p, fills } = fixture();
  const files = fabFiles(p, { fills, date: 'd', version: 'v' });
  const z = makeZip(files, new Date(2026, 0, 2, 3, 4, 6));
  const back = readZip(z);
  assert.deepEqual(back.map((f) => f.name), files.map((f) => f.name));
  assert.ok(back.every((f, i) => f.ok && f.text === files[i].text));
});

test('a preset\'s naming and drill units follow through; the stroke font covers what boards print', () => {
  const { p, fills } = fixture();
  applyPreset(p, 'oshpark-2');
  assert.ok(fabFiles(p, { fills, date: 'd', version: 'v' }).every((f) => /\.(G..|G\d|drl)$/.test(f.name)));
  for (const ch of 'R1C10U3V+5V GND 10k 4.7µF 100nF 1N4148 J?') assert.ok(glyph(ch), ch);
  const pl = strokeText('HH', { at: [0, 0], size: mm(1) });
  assert.ok(pl.length >= 3);
  const xs = pl.flat().map((q) => q[0]);
  assert.ok(Math.abs(Math.min(...xs) + Math.max(...xs)) < 2, 'centred');
  const m = strokeText('HH', { at: [0, 0], size: mm(1), mirror: true });
  assert.equal(m[0][0][0], -pl[0][0][0], 'mirrored for the back');
});

test('vector font metrics (#79): Eagle\'s text height, capital and advance; screen and Gerber agree', async () => {
  const { strokeWidthOf, vectorLayout, strokeText, strokePen, CAP_RATIO, ADVANCE_RATIO, PEN_RATIO } = await import('../src/renderer/core/strokefont.js');
  // Eagle at size 1.778: a T 1.627 tall between stroke centres and 1.085 wide, pen 0.15, advance 1.397
  const size = 1_778_000, T = strokeText('T', { at: [0, 0], size });
  const ys = T.flat().map((q) => q[1]), xs = T.flat().map((q) => q[0]);
  assert.ok(Math.abs(Math.max(...ys) - Math.min(...ys) - 1_627_000) < 40_000, `cap ${Math.max(...ys) - Math.min(...ys)}`);
  assert.ok(Math.abs(Math.max(...xs) - Math.min(...xs) - 1_085_000) < 40_000, `width ${Math.max(...xs) - Math.min(...xs)}`);
  assert.equal(strokePen(size), Math.round(size * PEN_RATIO));
  // the 6th character starts 5 advances in: where Eagle's pin-name boxes start
  assert.ok(Math.abs(5 * size * ADVANCE_RATIO - 6_985_000) < 5_000, 'five Eagle characters: 6.985 mm');
  assert.ok(Math.abs(strokeWidthOf('PA05/', size) - (4 * size * ADVANCE_RATIO + (4 / 6) * size * CAP_RATIO)) < 1);
  // the canvas layout of the same text, centred, is the Gerber's geometry
  const v = vectorLayout('R12', { x: 0, y: 0, px: size, align: 'center', baseline: 'middle' }).lines;
  const g = strokeText('R12', { at: [0, 0], size });
  assert.equal(v.length, g.length);
  v.forEach((pl, i) => pl.forEach((q, k) => { assert.ok(Math.abs(q[0] - g[i][k][0]) <= 1 && Math.abs(q[1] - g[i][k][1]) <= 1); }));
  // alignment and baselines
  const left = vectorLayout('AB', { x: 100, y: 50, px: 10, align: 'left', baseline: 'alphabetic' }).lines.flat();
  assert.ok(Math.abs(Math.min(...left.map((q) => q[0])) - 100) < 1e-9 && Math.abs(Math.max(...left.map((q) => q[1])) - 50) < 1e-9, 'left, on the baseline');
  const right = vectorLayout('AB', { x: 100, y: 50, px: 10, align: 'right', baseline: 'top' }).lines.flat();
  assert.ok(Math.abs(Math.max(...right.map((q) => q[0])) - 100) < 1e-9 && Math.abs(Math.min(...right.map((q) => q[1])) - 50) < 1e-9, 'right, hanging from the top');
});
