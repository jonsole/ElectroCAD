// Reading fab files back (#28): Gerber and Excellon readers, the rasteriser and the comparison
// used by the Gerber tab, checked on hand-written cases, the golden fab fixtures and round trips.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { readGerber, gerberShapes, apertureShape } from '../src/renderer/core/gerber/read.js';
import { readExcellon, drillShapes } from '../src/renderer/core/gerber/excellon.js';
import { identifyFile, readFabFiles, rasterize, compareLayers, alignOffset, moveShapes } from '../src/renderer/core/gerber/compare.js';
import { unzip, makeZip, crc32 } from '../src/renderer/core/zip.js';
import { packageToFootprint } from '../src/renderer/io/eagle/library.js';
import { parseXml } from '../src/renderer/io/xml.js';
import { fabFiles } from '../src/renderer/core/fab.js';
import { newProject } from '../src/renderer/core/project.js';
import { rectOutline } from '../src/renderer/core/board.js';

const GOLDEN = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fab');
const golden = () => fs.readdirSync(GOLDEN).map((name) => ({ name, text: fs.readFileSync(path.join(GOLDEN, name), 'utf8') }));
const MM = 1e6;
const near = (a, b, tol = 2) => Math.abs(a - b) <= tol;
const g = (body, head = '%FSLAX46Y46*%\n%MOMM*%\n') => readGerber(`${head}${body}\nM02*\n`);

test('gerber: format, units and zero omission', () => {
  // 2.5 inches, leading zeros omitted: X0120735 = 1.20735 in
  const a = readGerber('%FSLAX25Y25*%\n%MOIN*%\n%ADD10C,0.04400*%\nD10*\nX0120735Y0208439D03*\nM02*\n');
  assert.equal(a.units, 'in');
  assert.ok(near(a.objects[0].at[0], Math.round(1.20735 * 25.4e6)) && near(a.objects[0].at[1], -Math.round(2.08439 * 25.4e6)), String(a.objects[0].at));
  assert.equal(a.apertures.get(10).d, Math.round(0.044 * 25.4e6));
  // trailing zeros omitted: X12 in 2.4 = 12.0000
  const b = readGerber('%FSTAX24Y24*%\n%MOMM*%\n%ADD10C,1*%\nD10*\nX12Y-5D03*\nM02*\n');
  assert.deepEqual(b.objects[0].at, [12 * MM, 50 * MM]);
  // legacy: G70 inches, G54D10
  const c = readGerber('%FSLAX24Y24*%\nG70*\n%ADD10C,0.01*%\nG54D10*\nX10000Y0D03*\nM02*\n');
  assert.equal(c.units, 'in'); assert.deepEqual(c.objects[0].at, [25_400_000, 0]);
  assert.deepEqual(c.warnings, []);
});

test('gerber: standard apertures, holes and polygons', () => {
  const r = g('%ADD10C,1X0.4*%\n%ADD11R,2X1*%\n%ADD12O,2X1*%\n%ADD13P,2X6X30*%\nD10*\nX0Y0D03*\nD11*\nX5000000Y0D03*\nD12*\nX10000000Y0D03*\nD13*\nX15000000Y0D03*');
  const [c, rr, o, p] = r.objects.map((x) => x.ap);
  assert.deepEqual([c.type, c.d, c.hole], ['C', MM, 400_000]);
  assert.deepEqual([rr.type, rr.w, rr.h], ['R', 2 * MM, MM]);
  assert.equal(o.type, 'O'); assert.deepEqual([p.type, p.n, p.rot], ['P', 6, 30]);
  assert.equal(apertureShape(c)[0].rings.length, 2, 'a hole is a second ring');
  assert.equal(apertureShape(p)[0].rings[0].length, 6);
  // areas by rasterising at 10 µm
  const area = (ap) => { const f = { x0: -2 * MM, y0: -2 * MM, w: 400, h: 400, res: 10_000 }; return rasterize(apertureShape(ap).map((s) => ({ dark: s.on, rings: s.rings })), f).reduce((a, v) => a + v, 0) * 1e-4; };
  assert.ok(Math.abs(area(c) - (Math.PI * 0.25 - Math.PI * 0.04)) < 0.01, String(area(c)));
  assert.ok(Math.abs(area(rr) - 2) < 0.01);
  assert.ok(Math.abs(area(o) - (1 + Math.PI * 0.25)) < 0.01);
});

test('gerber: Eagle\'s OC8 macro, variables and arithmetic', () => {
  const r = readGerber('%FSLAX25Y25*%\n%MOIN*%\n%AMOC8*\n5,1,8,0,0,1.08239X$1,22.5*\n%\n%AMT*\n0 a comment*\n$2=$1x2*\n21,1,$2,$1,0,0,0*\n1,0,$1/2,0,0*\n%\n%ADD10OC8,0.05*%\n%ADD11T,0.1*%\nD10*\nX0Y0D03*\nD11*\nX100000Y0D03*\nM02*\n');
  const oc = r.apertures.get(10);
  assert.equal(oc.type, 'M'); assert.equal(oc.prims.length, 1); assert.equal(oc.prims[0].rings[0].length, 8);
  // the octagon's flat-to-flat width is the parameter: circumradius = 1.08239 x 0.05 / 2 in
  const R = Math.hypot(...oc.prims[0].rings[0][0]);
  assert.ok(Math.abs(R - (1.08239 * 0.05 * 25.4e6) / 2) < 3, String(R));
  const t = r.apertures.get(11);
  assert.equal(t.prims.length, 2); assert.equal(t.prims[1].on, false, 'exposure off');
  const [x0, x1] = [Math.min(...t.prims[0].rings[0].map((q) => q[0])), Math.max(...t.prims[0].rings[0].map((q) => q[0]))];
  assert.ok(near(x1 - x0, 0.2 * 25.4e6, 2), 'a centre line $2 = $1 x 2 wide');
  assert.deepEqual(r.warnings, []);
});

test('gerber: strokes, arcs (G75 and G74), regions and polarity', () => {
  const r = g('%ADD10C,0.2*%\nD10*\nX0Y0D02*\nX10000000Y0D01*\nG75*\nG02X0Y-10000000I-10000000J0D01*\nG01*\n%LPC*%\nG36*\nX0Y0D02*\nX1000000Y0D01*\nX1000000Y1000000D01*\nG03X0Y1000000I-500000J0D01*\nG01X0Y0D01*\nG37*\n%LPD*%');
  const [s, a, reg] = r.objects;
  assert.equal(s.kind, 'stroke'); assert.deepEqual([s.a, s.b], [[0, 0], [10 * MM, 0]]);
  assert.equal(a.kind, 'arc'); assert.deepEqual(a.c, [0, 0]); assert.equal(a.cw, true);
  assert.equal(reg.kind, 'region'); assert.equal(reg.dark, false);
  assert.ok(reg.pts.length > 6, 'the arc in the region is flattened');
  assert.ok(reg.pts.some((q) => near(q[0], 500_000, 2) && near(q[1], -1_500_000, 2)), 'the arc bulges up to y = 1.5 (down on the board)');
  // G74: single quadrant, I and J unsigned
  const q = g('%ADD10C,0.1*%\nD10*\nG74*\nX10000000Y0D02*\nG03X0Y10000000I10000000J0D01*');
  assert.deepEqual(q.objects[0].c, [0, 0]);
  // a full circle drawn with an arc: the pieces go all the way round
  const full = g('%ADD10C,0.1*%\nD10*\nG75*\nX1000000Y0D02*\nG02X1000000Y0I-1000000J0D01*');
  const shapes = gerberShapes(full);
  assert.ok(shapes.length >= 36, String(shapes.length));
});

test('gerber: step and repeat, offsets, and what isn\'t applied is said', () => {
  const r = g('%ADD10C,1*%\n%SRX3Y2I5J10*%\nD10*\nX0Y0D03*\n%SR*%');
  assert.equal(r.objects.length, 6);
  assert.ok(r.objects.some((o) => o.at[0] === 10 * MM && o.at[1] === -10 * MM));
  const w = g('%ADD10C,1*%\n%IPNEG*%\n%LMXY*%\nG91*\nD10*\nX1Y1D03*\nQQQ*');
  assert.ok(w.warnings.some((x) => /IPNEG/.test(x)) && w.warnings.some((x) => /LM/.test(x)) && w.warnings.some((x) => /Incremental/.test(x)) && w.warnings.some((x) => /Unknown statement/.test(x)), w.warnings.join(' | '));
});

test('excellon: units, zeros, implied and explicit decimals, slots, plating', () => {
  // Eagle's: inches, no format, 2.4 with leading zeros dropped
  const e = readExcellon('%\nM48\nM72\nT01C0.0120\n%\nT01\nX18346Y12980\nY13255\nM30\n');
  assert.equal(e.units, 'in');
  assert.equal(e.tools.get(1), Math.round(0.012 * 25.4e6));
  assert.ok(near(e.holes[0].at[0], Math.round(1.8346 * 25.4e6)) && near(e.holes[1].at[1], -Math.round(1.3255 * 25.4e6)), JSON.stringify(e.holes));
  assert.equal(e.holes[1].at[0], e.holes[0].at[0], 'X is modal');
  // LZ: leading zeros kept, so the digits are left-aligned (3.3 in mm)
  const lz = readExcellon('M48\nMETRIC,LZ\nT1C0.8\n%\nT1\nX012500Y-0034\nM30\n');
  assert.deepEqual(lz.holes[0].at, [12.5 * MM, 3.4 * MM]); // 0034 -> 003.400
  // ElectroCAD's own: decimals, an X2 plating attribute, and a G85 slot
  const own = readExcellon('M48\n; #@! TF.FileFunction,NonPlated,1,2,NPTH\nMETRIC\nT1C1.000\n%\nG90\nT1\nX1.0Y-2.0\nX3.0Y-2.0G85X5.0Y-2.0\nM30\n');
  assert.equal(own.plated, false);
  assert.deepEqual(own.holes[0].at, [MM, 2 * MM]);
  assert.deepEqual([own.slots[0].a, own.slots[0].b], [[3 * MM, 2 * MM], [5 * MM, 2 * MM]]);
  assert.equal(drillShapes(own).length, 2);
  // a routed slot
  const rt = readExcellon('M48\nMETRIC\nT2C0.6\n%\nT2\nG00X0Y0\nM15\nG01X2.0Y0\nM16\nM30\n');
  assert.equal(rt.slots.length, 1);
});

test('the golden fab files parse back to what they contain', () => {
  const files = golden();
  for (const f of files) {
    if (f.name.endsWith('.drl')) {
      const x = readExcellon(f.text);
      assert.deepEqual(x.warnings, [], f.name);
      assert.equal(x.plated, f.name.includes('-PTH'));
      continue;
    }
    const r = readGerber(f.text);
    assert.deepEqual(r.warnings, [], f.name);
    assert.equal(r.units, 'mm');
    // every flash, region and draw in the file is an object
    const count = (re) => (f.text.match(re) || []).length;
    const kinds = (k) => r.objects.filter((o) => o.kind === k).length;
    assert.equal(kinds('flash'), count(/D03\*/g), `${f.name} flashes`);
    assert.equal(kinds('region'), count(/G36\*/g), `${f.name} regions`);
    assert.ok(r.attrs.FileFunction, `${f.name} has its X2 file function`);
  }
  const top = readGerber(files.find((f) => f.name.endsWith('.GTL')).text);
  // the fixture's via at (11, 6) mm, 0.6 mm across, flashed on the top copper
  assert.ok(top.objects.some((o) => o.kind === 'flash' && o.ap.type === 'C' && o.ap.d === 600_000 && near(o.at[0], 11 * MM) && near(o.at[1], 6 * MM)));
  const pth = readExcellon(files.find((f) => f.name.endsWith('-PTH.drl')).text);
  assert.deepEqual(pth.holes.map((h) => [h.at, h.d]), [[[11 * MM, 6 * MM], 300_000], [[6.73 * MM, 15.8 * MM], MM], [[8 * MM, 18 * MM], MM], [[9.27 * MM, 20.2 * MM], MM], [[26 * MM, 20 * MM], MM]]);
});

test('identifyFile: X2 attributes first, then Protel, Eagle and descriptive names', () => {
  const x2 = '%TF.FileFunction,Copper,L2,Inr*%\n%FSLAX46Y46*%\n';
  assert.equal(identifyFile('anything.gbr', x2).layer, 'In1.Cu');
  assert.equal(identifyFile('b.gbr', '%TF.FileFunction,Soldermask,Bot*%\n%FSLAX46Y46*%').layer, 'B.Mask');
  const gb = '%FSLAX25Y25*%\n%MOIN*%\n';
  for (const [n, l] of [['x.GTL', 'F.Cu'], ['x.GBO', 'B.SilkS'], ['x.G2L', 'In1.Cu'], ['x.G3L', 'In2.Cu'], ['x.GML', 'Edge.Cuts'], ['board-F_Cu.gbr', 'F.Cu'], ['board-Edge_Cuts.gbr', 'Edge.Cuts'], ['board-B_Mask.gbr', 'B.Mask']]) assert.equal(identifyFile(n, gb).layer, l, n);
  assert.equal(identifyFile('x.XLN', 'M48\nM72\nT01C0.012\n%').kind, 'drill');
  assert.equal(identifyFile('x-NPTH.drl', 'M48\nMETRIC\n').layer, 'NPTH');
  assert.equal(identifyFile('README.txt', 'Order notes'), null);
});

test('rasterize: even-odd rings, clear polarity, and pixel centres', () => {
  const sq = (x0, y0, s) => [[x0, y0], [x0 + s, y0], [x0 + s, y0 + s], [x0, y0 + s]];
  const f = { x0: 0, y0: 0, w: 100, h: 100, res: 100_000 }; // 10 mm at 0.1 mm
  const sum = (b) => b.reduce((a, v) => a + v, 0);
  assert.equal(sum(rasterize([{ dark: true, rings: [sq(0, 0, MM)] }], f)), 100);
  assert.equal(sum(rasterize([{ dark: true, rings: [sq(0, 0, 2 * MM), sq(500_000, 500_000, MM)] }], f)), 300, 'a ring with a hole');
  assert.equal(sum(rasterize([{ dark: true, rings: [sq(0, 0, 2 * MM)] }, { dark: false, rings: [sq(0, 0, MM)] }], f)), 300, 'clear erases');
});

test('compare: a set against itself, moved, and with a change', () => {
  const A = readFabFiles(golden()).layers;
  const same = compareLayers(A, A);
  assert.ok(same.layers.every((l) => l.missing || l.stats.match === 1), JSON.stringify(same.layers.map((l) => [l.layer, l.stats?.match])));
  // the same files shifted (as another tool might place the board): aligned by the drill holes
  const B = A.map((l) => ({ ...l, shapes: moveShapes(l.shapes, [3 * MM, -2 * MM]), box: { x0: l.box.x0 + 3 * MM, y0: l.box.y0 - 2 * MM, x1: l.box.x1 + 3 * MM, y1: l.box.y1 - 2 * MM }, data: l.kind === 'drill' ? { ...l.data, holes: l.data.holes.map((h) => ({ ...h, at: [h.at[0] + 3 * MM, h.at[1] - 2 * MM] })), slots: [] } : l.data }));
  const al = alignOffset(A, B);
  assert.equal(al.by, 'drills'); assert.deepEqual(al.offset, [-3 * MM, 2 * MM]);
  const moved = compareLayers(A, B);
  assert.ok(moved.layers.filter((l) => l.layer !== 'Edge.Cuts').every((l) => l.missing || l.stats.match > 0.999), JSON.stringify(moved.layers.map((l) => [l.layer, l.stats?.match])));
  // drop the top copper's tracks from theirs: ours has copper they don't
  const C = A.map((l) => (l.layer === 'F.Cu' ? { ...l, shapes: gerberShapes({ ...l.data, objects: l.data.objects.filter((o) => o.kind !== 'stroke') }) } : l));
  const ch = compareLayers(A, C, { keepDiff: true });
  const top = ch.layers.find((l) => l.layer === 'F.Cu');
  assert.ok(top.stats.match < 0.999 && top.stats.onlyOurs > 0 && top.stats.onlyTheirs === 0, JSON.stringify(top.stats));
  assert.ok(top.diff.includes(2) && !top.diff.includes(3));
});

test('unzip: stored and deflated zips (as board houses send them)', async () => {
  const stored = makeZip([{ name: 'a.GTL', text: 'G04 hi*' }], new Date('2026-01-01'));
  assert.deepEqual((await unzip(stored)).map((e) => [e.name, e.ok, new TextDecoder().decode(e.bytes)]), [['a.GTL', true, 'G04 hi*']]);
  // a deflated entry with a data descriptor, written by hand
  const data = new TextEncoder().encode('M48\nMETRIC\n'.repeat(20)), comp = zlib.deflateRawSync(data), name = new TextEncoder().encode('d/x.drl');
  const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 6); lh.writeUInt16LE(8, 8); lh.writeUInt16LE(name.length, 26);
  const dd = Buffer.alloc(16); dd.writeUInt32LE(0x08074b50, 0); dd.writeUInt32LE(crc32(data), 4); dd.writeUInt32LE(comp.length, 8); dd.writeUInt32LE(data.length, 12);
  const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(8, 8); cd.writeUInt16LE(8, 10); cd.writeUInt32LE(crc32(data), 16); cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(data.length, 24); cd.writeUInt16LE(name.length, 28); cd.writeUInt32LE(0, 42);
  const body = Buffer.concat([lh, name, comp, dd]);
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10); eocd.writeUInt32LE(cd.length + name.length, 12); eocd.writeUInt32LE(body.length, 16);
  const zip = new Uint8Array(Buffer.concat([body, cd, name, eocd]));
  const out = await unzip(zip);
  assert.equal(out.length, 1); assert.equal(out[0].name, 'd/x.drl'); assert.equal(out[0].ok, true);
  assert.equal(new TextDecoder().decode(out[0].bytes), 'M48\nMETRIC\n'.repeat(20));
});

// ---- found comparing an imported Eagle board with the files a board house built it from

test('Eagle\'s pad shape rules: the first pad square, the rest as the library has them', () => {
  const pkg = parseXml('<package name="H"><pad name="1" x="0" y="0" drill="0.8" diameter="1.6" first="yes"/><pad name="2" x="2" y="0" drill="0.8" diameter="1.6"/></package>');
  const fp = packageToFootprint(pkg, { shapes: { top: -1, first: 0 } });
  assert.deepEqual(fp.pads.map((p) => p.shape), ['rect', 'circle']);
  const lib = packageToFootprint(pkg);
  assert.deepEqual(lib.pads.map((p) => p.shape), ['circle', 'circle']);
});

test('an untented via opens the mask; a non-plated hole opens it too', () => {
  const p = newProject('Tent');
  p.board.outline = rectOutline([0, 0], [20 * MM, 20 * MM]);
  p.board.vias.push({ id: 'v1', at: [5 * MM, 5 * MM], drill: 400_000, diameter: 800_000, from: 'F.Cu', to: 'B.Cu', net: '' });
  p.board.vias.push({ id: 'v2', at: [10 * MM, 5 * MM], drill: 400_000, diameter: 800_000, from: 'F.Cu', to: 'B.Cu', net: '', tented: false });
  const mask = readGerber(fabFiles(p, { fills: new Map(), date: 'd', version: 'v' }).find((f) => f.layer === 'F.Mask').text);
  const flashes = mask.objects.filter((o) => o.kind === 'flash');
  assert.equal(flashes.length, 1);
  assert.ok(near(flashes[0].at[0], 10 * MM) && flashes[0].ap.d === 900_000, JSON.stringify(flashes[0]));
  const hole = packageToFootprint(parseXml('<package name="M"><hole x="0" y="0" drill="0.9"/></package>'));
  assert.deepEqual(hole.pads[0].layers, ['*.Mask']);
});

test('silk: a filled rectangle or polygon is a region, an outlined one strokes (#72)', () => {
  const p = newProject('Fill');
  p.board.outline = rectOutline([0, 0], [20 * MM, 20 * MM]);
  // a footprint in the Project's table with a filled and an outlined rectangle, and a filled polygon
  const fp = { name: 'F', pads: [{ number: '1', at: [0, 0], shape: 'rect', size: [MM, MM], layers: ['F.Cu', 'F.Mask'] }], graphics: [
    { type: 'rect', a: [-2 * MM, -2 * MM], b: [-MM, -MM], fill: 'outline', layer: 'F.SilkS' },
    { type: 'rect', a: [MM, MM], b: [2 * MM, 2 * MM], layer: 'F.SilkS' },
    { type: 'poly', pts: [[3 * MM, 0], [4 * MM, 0], [4 * MM, MM]], fill: 'outline', layer: 'F.SilkS' },
  ] };
  p.footprints = { 'test:F': { library: 'test', footprint: fp } };
  const c = { id: 'c1', partId: 'x', ref: 'U1', value: '', footprint: { fpKey: 'test:F' }, fields: {} };
  p.components.c1 = c;
  p.board.footprints.push({ id: 'f1', componentId: 'c1', at: [10 * MM, 10 * MM], rot: 0, side: 'F' });
  const silk = readGerber(fabFiles(p, { fills: new Map(), date: 'd', version: 'v' }).find((f) => f.layer === 'F.SilkS').text);
  const regions = silk.objects.filter((o) => o.kind === 'region');
  assert.equal(regions.length, 2, 'the filled rectangle and the filled polygon');
  assert.ok(regions.some((r) => r.pts.some((q) => near(q[0], 8 * MM) && near(q[1], 8 * MM))), JSON.stringify(regions.map((r) => r.pts)));
  // the outlined rectangle is four strokes round (11..12, 11..12)
  assert.ok(silk.objects.filter((o) => o.kind === 'stroke' && near(Math.max(o.a[0], o.b[0]), 12 * MM)).length >= 2);
});
