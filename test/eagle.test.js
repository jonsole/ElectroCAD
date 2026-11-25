// Eagle import (#36, and the reading half of #35): the XML reader, Eagle's arcs, and the
// regulator fixture (2 sheets, a multi-gate op-amp with one gate mirrored, power symbols, a
// rotated through-hole part, a locked part and one mirrored onto the bottom, a Net class, a curved
// track, a via and a bottom polygon) checked against Eagle's own geometry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseXml } from '../src/renderer/io/xml.js';
import { arcMid, arcPoints, len, rotOf, Report } from '../src/renderer/io/eagle/common.js';
import { packageToFootprint } from '../src/renderer/io/eagle/library.js';
import { importEagle, eagleKind, importLog, eagleVersion } from '../src/renderer/io/eagle/index.js';
import { ratsnest } from '../src/renderer/core/ratsnest.js';
import { serialize, deserialize } from '../src/renderer/core/project.js';
import { buildNetlist } from '../src/renderer/core/netlist.js';
import { placedPads, padNets } from '../src/renderer/core/footprint.js';
import { checkOutline } from '../src/renderer/core/board.js';
import { runDrc } from '../src/renderer/core/drc.js';
import { zoneInput, fillZones } from '../src/renderer/core/zones.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'eagle');
const SCH = fs.readFileSync(path.join(dir, 'regulator.sch'), 'utf8');
const BRD = fs.readFileSync(path.join(dir, 'regulator.brd'), 'utf8');
const near = (a, b, tol = 2) => Math.abs(a - b) <= tol;

test('xml: elements, attributes, entities, comments, CDATA and self-closing tags', () => {
  const r = parseXml('<?xml version="1.0"?><!DOCTYPE eagle SYSTEM "eagle.dtd"><!-- hi --><eagle a="1 &amp; 2"><b x=\'3\'/><c>t &lt; <![CDATA[<raw>]]></c><b x="4"></b></eagle>');
  const e = r;
  assert.equal(e.name, 'eagle');
  assert.equal(e.attr('a'), '1 & 2');
  assert.deepEqual(e.all('b').map((b) => b.attr('x')), ['3', '4']);
  assert.equal(e.child('c').text, 't < <raw>');
  assert.equal(e.path('c').name, 'c');
  assert.throws(() => parseXml('<a><b></a>'));
});

test('units and rotations', () => {
  assert.equal(len('8mil'), 203_200);
  assert.equal(len('0.35mm'), 350_000);
  assert.equal(len('0.01inch'), 254_000);
  assert.deepEqual(rotOf('MR90'), { rot: 90, mirror: true, spin: false });
  assert.deepEqual(rotOf('R-90'), { rot: 270, mirror: false, spin: false });
  assert.deepEqual(rotOf(undefined), { rot: 0, mirror: false, spin: false });
});

test('arcs: Eagle curves are anticlockwise in Y up, so clockwise on screen (Y down)', () => {
  const M = 1e6;
  // a quarter circle from (1,0) to (0,1) mm in Eagle (Y up), centre the origin: mid at 45°
  const a = [M, 0], b = [0, -M];
  const m = arcMid(a, b, 90);
  assert.ok(near(m[0], M * Math.SQRT1_2) && near(m[1], -M * Math.SQRT1_2), String(m));
  // the long way round (270°) passes through the opposite side
  const l = arcMid(a, b, -270);
  assert.ok(near(l[0], -M * Math.SQRT1_2) && near(l[1], M * Math.SQRT1_2), String(l));
  // a half circle
  const h = arcMid([M, 0], [-M, 0], 180);
  assert.ok(near(h[0], 0) && near(h[1], -M), String(h));
  // the points stay on the circle and end where they should
  const ps = arcPoints(a, b, 90);
  assert.deepEqual(ps[0], a); assert.deepEqual(ps.at(-1), b);
  for (const p of ps) assert.ok(near(Math.hypot(p[0], p[1]), M, 3));
});

test('library: a package becomes a Footprint, with what changed reported', () => {
  const pkg = parseXml('<package name="X"><smd name="1" x="-1" y="0.5" dx="1" dy="2" layer="1" roundness="100" rot="R90"/><pad name="2" x="2" y="0" drill="0.8" shape="octagon"/><wire x1="0" y1="0" x2="1" y2="0" width="0.2" layer="21"/><hole x="0" y="2" drill="1"/></package>');
  const report = new Report();
  const fp = packageToFootprint(pkg, { report });
  const p1 = fp.pads.find((p) => p.number === '1'), p2 = fp.pads.find((p) => p.number === '2');
  assert.deepEqual(p1.at, [-1e6, -500_000]);
  assert.equal(p1.layers.includes('F.Cu'), true);
  assert.equal(p2.drill > 0, true);
  assert.ok(fp.pads.some((p) => !p.number || p.type === 'np_thru_hole' || p.plated === false), 'the hole is a non-plated pad');
  assert.ok(report.list().some((t) => /ctagonal/.test(t)));
});

test('eagleKind tells schematic, board and library apart', () => {
  assert.equal(eagleKind(SCH), 'sch');
  assert.equal(eagleKind(BRD), 'brd');
  assert.equal(eagleKind('<?xml version="1.0"?><eagle version="9"><drawing><library></library></drawing></eagle>'), 'lbr');
  assert.equal(eagleKind('{"format":"ecad"}'), null);
});

test('schematic: the Netlist matches Eagle\'s nets pin for pin', () => {
  const r = importEagle({ sch: SCH, name: 'reg' });
  assert.equal(r.check.schematic.ok, true, JSON.stringify(r.check.schematic.mismatches));
  const p = deserialize(serialize(r.project));
  assert.equal(p.schematic.sheets.length, 2);
  assert.deepEqual(Object.values(p.components).map((c) => c.ref).sort(), ['R1', 'R2', 'U1', 'U2']);
  const nets = Object.fromEntries(buildNetlist(p).nets.map((n) => [n.name, n.pins.map((x) => `${x.ref}.${x.pin}`).sort()]));
  // U1's GND is on two pads (Eagle connect "2 4"): stacked pins, both on GND
  assert.deepEqual(nets.GND, ['R2.1', 'U1.2', 'U1.4', 'U2.4', 'U2.6'].sort());
  assert.deepEqual(nets.VCC, ['R1.1', 'U1.1', 'U2.8'].sort());
  assert.deepEqual(nets.VOUT, ['R2.2', 'U1.3', 'U2.3'].sort());
  assert.deepEqual(nets.AOUT, ['U2.1', 'U2.2', 'U2.5'].sort());
  // power symbols are power labels, not parts
  const labels = p.schematic.sheets.flatMap((s) => s.labels || []);
  assert.ok(labels.some((l) => l.net === 'GND' && l.style === 'gnd'), JSON.stringify(labels.map((l) => [l.net, l.style])));
  assert.ok(labels.some((l) => l.net === 'VCC' && l.style === 'power'));
  // the frame isn't a part
  assert.ok(!Object.values(p.components).some((c) => /FRAME/i.test(c.value || '')));
});

test('board: every pad lands where Eagle puts it, on the right side and net', () => {
  const r = importEagle({ sch: SCH, brd: BRD, name: 'reg' });
  assert.deepEqual(r.check.signals, []);
  const p = deserialize(serialize(r.project)), b = p.board;
  // Eagle's own transform: rotate anticlockwise (Y up), then mirror X, then translate; we're Y down
  const xml = parseXml(BRD), pk = new Map();
  for (const lib of xml.path('drawing/board/libraries').all('library')) for (const g of lib.path('packages').all('package')) pk.set(`${lib.attr('name')}/${g.attr('name')}`, g);
  const nets = padNets(b);
  let n = 0;
  for (const el of xml.path('drawing/board/elements').all('element')) {
    const fp = b.footprints.find((f) => p.components[f.componentId].ref === el.attr('name'));
    const { rot, mirror } = rotOf(el.attr('rot'));
    assert.equal(fp.side, mirror ? 'B' : 'F', el.attr('name'));
    assert.equal(!!fp.locked, el.attr('locked') === 'yes', el.attr('name'));
    const placed = new Map(placedPads(p, fp, nets).map((q) => [q.number, q]));
    for (const c of pk.get(`${el.attr('library')}/${el.attr('package')}`).children.filter((c) => c.name === 'smd' || c.name === 'pad')) {
      const x = Number(c.attr('x')), y = Number(c.attr('y'));
      const t = (rot * Math.PI) / 180;
      let rx = x * Math.cos(t) - y * Math.sin(t);
      const ry = x * Math.sin(t) + y * Math.cos(t);
      if (mirror) rx = -rx; // Eagle turns first, then mirrors
      const ex = Number(el.attr('x')) + rx, ey = Number(el.attr('y')) + ry;
      const q = placed.get(c.attr('name'));
      assert.ok(q, `${el.attr('name')}.${c.attr('name')}`);
      assert.ok(near(q.at[0], ex * 1e6, 5) && near(q.at[1], -ey * 1e6, 5), `${el.attr('name')}.${c.attr('name')}: ${q.at} vs ${[ex, -ey]}`);
      n++;
    }
  }
  assert.equal(n, 2 + 2 + 4 + 8);
  // copper: tracks on their signals, the via, the bottom GND zone, the Power class
  assert.ok(b.tracks.length >= 4 && b.tracks.every((t) => ['VCC', 'VOUT'].includes(t.net)));
  assert.ok(b.tracks.filter((t) => t.net === 'VOUT').length > 3, 'the curved track is several segments');
  assert.ok(b.tracks.filter((t) => t.net === 'VCC').every((t) => t.width === 600_000));
  assert.equal(b.vias.length, 1); assert.equal(b.vias[0].net, 'GND');
  assert.equal(b.zones.length, 1); assert.equal(b.zones[0].layer, 'B.Cu'); assert.equal(b.zones[0].net, 'GND');
  assert.deepEqual(b.netClasses.Power.nets, ['VCC']);
  // the outline closes (with its arc corner) and has the round cut-out
  const oc = checkOutline(b.outline);
  assert.equal(oc.closed, true, oc.problems.join(' '));
  // the design rules come over (8 mil clearance, 10 mil track, 0.35 mm drill)
  assert.equal(b.rules.clearance, 203_200);
  assert.equal(b.rules.trackWidth, 254_000);
  // DRC finds nothing but what isn't routed yet
  const v = runDrc(p, fillZones(zoneInput(p)));
  assert.deepEqual([...new Set(v.map((x) => x.rule))], ['unrouted'], v.map((x) => x.message).join('\n'));
});

test('board alone: a stub Schematic carries the board\'s nets', () => {
  const r = importEagle({ brd: BRD, name: 'reg' });
  const p = deserialize(serialize(r.project));
  assert.ok(r.report.some((t) => /stub Schematic/.test(t)));
  assert.equal(p.board.footprints.length, 4);
  const nets = Object.fromEntries(buildNetlist(p).nets.map((n) => [n.name, n.pins.length]));
  assert.equal(nets.GND, 5); assert.equal(nets.VCC, 3); assert.equal(nets.VOUT, 3);
  assert.deepEqual(r.check.signals, []);
});

test('loss report: inner layers past two and blind vias', () => {
  const brd = BRD.replace('<signal name="AOUT">', '<signal name="AOUT"><wire x1="1" y1="1" x2="2" y2="1" width="0.2" layer="2"/><wire x1="1" y1="2" x2="2" y2="2" width="0.2" layer="3"/><wire x1="1" y1="3" x2="2" y2="3" width="0.2" layer="4"/><via x="3" y="3" extent="1-2" drill="0.3"/>');
  const r = importEagle({ sch: SCH, brd, name: 'reg' });
  assert.equal(r.project.board.stack.copper, 4);
  assert.ok(r.report.some((t) => /Inner copper layers past two/.test(t)), r.report.join('\n'));
  assert.ok(r.report.some((t) => /Blind and buried vias \(1-2\)/.test(t)));
  assert.ok(r.project.board.tracks.some((t) => t.layer === 'In1.Cu') && r.project.board.tracks.some((t) => t.layer === 'In2.Cu'));
});

test('a file that isn\'t Eagle XML is refused', () => {
  assert.throws(() => importEagle({}));
});

// ---- regressions found importing a real design (a 4-layer ECU board, Eagle 7.7)

test('a mirrored part turns before it mirrors: MR90 puts pad 1 where Eagle does', () => {
  // R1 (an 0805, pads at x = ±0.95) on the bottom at MR90: Eagle turns pad 1 to (0, -0.95) and then
  // mirrors X (no change), so pad 1 is at y = 30 - 0.95 and pad 2 at y = 30 + 0.95
  const brd = BRD.replace('<element name="R1" library="rcl" package="R0805" value="330" x="10" y="30"/>', '<element name="R1" library="rcl" package="R0805" value="330" x="10" y="30" rot="MR90"/>');
  const r = importEagle({ sch: SCH, brd, name: 'reg' });
  const p = r.project, f = p.board.footprints.find((x) => p.components[x.componentId].ref === 'R1');
  const pads = Object.fromEntries(placedPads(p, f, padNets(p.board)).map((q) => [q.number, q.at]));
  assert.equal(f.side, 'B');
  assert.deepEqual(pads['1'], [10e6, -29.05e6]);
  assert.deepEqual(pads['2'], [10e6, -30.95e6]);
});

test('a device with named pads keeps its Pin map when the board brings its own package', () => {
  // 78XX gets a first device numbered 1..4 and its SOT223 device names its pads VI/G1/VO/G2
  const named = (t) => t.replace('<package name="SOT223">\n<smd name="1"', '<package name="SOT223">\n<smd name="VI"').replace('<smd name="2" x="0" y="-3.15"', '<smd name="G1" x="0" y="-3.15"').replace('<smd name="3" x="2.3" y="-3.15"', '<smd name="VO" x="2.3" y="-3.15"').replace('<smd name="4" x="0" y="3.15"', '<smd name="G2" x="0" y="3.15"');
  const sch = named(SCH).replace('<devices><device name="SOT223" package="SOT223"><connects><connect gate="G$1" pin="IN" pad="1"/><connect gate="G$1" pin="GND" pad="2 4"/><connect gate="G$1" pin="OUT" pad="3"/>',
    '<devices><device name="N" package="SO8"><connects><connect gate="G$1" pin="IN" pad="1"/><connect gate="G$1" pin="GND" pad="2 4"/><connect gate="G$1" pin="OUT" pad="3"/></connects><technologies><technology name="05"/></technologies></device><device name="SOT223" package="SOT223"><connects><connect gate="G$1" pin="IN" pad="VI"/><connect gate="G$1" pin="GND" pad="G1 G2"/><connect gate="G$1" pin="OUT" pad="VO"/>');
  const brd = named(BRD).replace('<contactref element="U1" pad="1"/>', '<contactref element="U1" pad="VI"/>').replace('<contactref element="U1" pad="3"/>', '<contactref element="U1" pad="VO"/>').replace('<contactref element="U1" pad="2"/><contactref element="U1" pad="4"/>', '<contactref element="U1" pad="G1"/><contactref element="U1" pad="G2"/>');
  assert.notEqual(sch, SCH); assert.notEqual(brd, BRD);
  const r = importEagle({ sch, brd, name: 'reg' });
  assert.equal(r.check.schematic.ok, true, r.check.schematic.mismatches.join('\n'));
  assert.deepEqual(r.check.signals, [], (r.check.signalDetails || []).join('\n'));
  const p = r.project, f = p.board.footprints.find((x) => p.components[x.componentId].ref === 'U1');
  const nets = Object.fromEntries(placedPads(p, f, padNets(p.board)).map((q) => [q.number, q.net]));
  assert.deepEqual(nets, { VI: 'VCC', G1: 'GND', VO: 'VOUT', G2: 'GND' });
});

test('a bus entry ending on another net\'s wire doesn\'t join the two nets', () => {
  // a stub of N$1 whose end lands on VOUT's wire (sheet 1, y = 76.2 from x = 96.52 to 104.14)
  const sch = SCH.replace('<net name="N$1" class="0">\n<segment>', '<net name="N$1" class="0">\n<segment><wire x1="99.06" y1="78.74" x2="99.06" y2="76.2" width="0.1524" layer="91"/></segment>\n<segment>');
  assert.notEqual(sch, SCH);
  const r = importEagle({ sch, name: 'reg' });
  assert.equal(r.check.schematic.ok, true, r.check.schematic.mismatches.join('\n'));
  assert.ok(r.report.some((t) => /Wire stubs \(bus entries\)/.test(t)), r.report.join('\n'));
  assert.ok(!r.project.schematic.sheets.flatMap((s) => s.labels).some((l) => l.net === 'N$1' && l.at[0] === 99_060_000));
});

test('the merge check: nets Eagle keeps apart but we join are reported', () => {
  // the same stub, but drawn by hand onto the sheet after import: verify must catch it
  const sch = SCH.replace('<net name="N$1" class="0">\n<segment><pinref part="R1" gate="G$1" pin="2"/>\n<wire x1="55.88" y1="76.2" x2="60.96" y2="76.2"', '<net name="N$1" class="0">\n<segment><pinref part="R1" gate="G$1" pin="2"/>\n<wire x1="55.88" y1="76.2" x2="81.28" y2="76.2"');
  assert.notEqual(sch, SCH);
  // R1's N$1 wire now runs into U1's IN pin (VCC); the pin is foreign and the wire long, so it's pulled back
  const r = importEagle({ sch, name: 'reg' });
  assert.equal(r.check.schematic.ok, true, r.check.schematic.mismatches.join('\n'));
  assert.ok(r.report.some((t) => /pulled back/.test(t)), r.report.join('\n'));
});

test('hidden power gates are placed, with power labels on their pins', () => {
  // U2's gate P (addlevel=request) not placed and nothing wired to it: Eagle joins V+ and V- by name
  const sch = SCH.replace('<instance part="U2" gate="P" x="101.6" y="38.1"/>', '').replace('<pinref part="U2" gate="P" pin="V-"/>', '').replace('<pinref part="U2" gate="P" pin="V+"/>', '');
  const r = importEagle({ sch, name: 'reg' });
  const p = r.project, u2 = Object.values(p.components).find((c) => c.ref === 'U2');
  assert.ok(p.schematic.sheets.some((s) => s.symbols.some((y) => y.componentId === u2.id && y.unit === 2)));
  const nets = Object.fromEntries(buildNetlist(p).nets.map((n) => [n.name, n.pins.map((x) => `${x.ref}.${x.pin}`)]));
  assert.deepEqual(nets['V+'], ['U2.8']);
  assert.deepEqual(nets['V-'], ['U2.4']);
  assert.ok(r.report.some((t) => /Hidden power gates were placed.*U2 P/.test(t)), r.report.join('\n'));
});

test('a Zone fill joins what it reaches: a plane-connected net isn\'t unrouted', () => {
  const r = importEagle({ sch: SCH, brd: BRD, name: 'reg' });
  const p = r.project, fills = fillZones(zoneInput(p));
  const gnd = (rats) => rats.wires.filter((w) => w.net === 'GND').length;
  assert.ok(gnd(ratsnest(p, p.board, fills)) < gnd(ratsnest(p, p.board)), 'the bottom GND pour connects the via and the THT pad');
});

test('the import log: files, versions, checks, DRC and every note', () => {
  const r = importEagle({ sch: SCH, brd: BRD, name: 'regulator' });
  const files = { sch: { name: 'regulator.sch', text: SCH }, brd: { name: 'regulator.brd', text: BRD } };
  const before = importLog(r, { files, app: { version: '1.2.3', build: 'abc' }, date: new Date('2026-11-25T12:00:00Z') });
  assert.match(before, /ElectroCAD 1\.2\.3 \(abc\) · 2026-11-25 12:00 UTC/);
  assert.match(before, /Schematic: regulator\.sch \(Eagle 9\.6\.2|Schematic: regulator\.sch \(Eagle [\d.]+/);
  assert.match(before, /\[ok\] The Netlist matches Eagle's nets/);
  assert.match(before, /\[ok\] Every board signal matches/);
  assert.match(before, /\[\.\.\] DRC: not run yet/);
  for (const t of r.report) assert.ok(before.includes(`- ${t}`), t);
  const p = r.project, drc = runDrc(p, fillZones(zoneInput(p)));
  const after = importLog(r, { files, drc });
  assert.match(after, /DRC: 0 errors, \d+ warnings\. Positions are Eagle's/);
  assert.match(after, /Unrouted: \d+\n {4}- \(\d+\.\d{3}, \d+\.\d{3}\) \w+ is not routed here/);
  assert.equal(eagleVersion('<?xml version="1.0"?><eagle version="7.7.0">'), '7.7.0');
});

test('net labels: a mirrored label reads the other way (MR180 as R0, MR0 as R180)', async () => {
  const { labelRot } = await import('../src/renderer/io/eagle/schematic.js');
  assert.deepEqual(['R0', 'R90', 'R180', 'R270', 'MR0', 'MR90', 'MR180', 'MR270', undefined].map(labelRot), [0, 90, 180, 270, 180, 90, 0, 270, 0]);
  // and on a sheet: VOUT's label on sheet 1, mirrored at 180, runs to the right like an unturned one
  const sch = SCH.replace('<label x="103.0" y="77.0" size="1.778" layer="95"/>', '<label x="103.0" y="77.0" size="1.778" layer="95" rot="MR180"/>');
  assert.notEqual(sch, SCH);
  const r = importEagle({ sch, name: 'reg' });
  const l = r.project.schematic.sheets[0].labels.find((x) => x.net === 'VOUT' && x.style === 'label');
  assert.equal(l.rot, 0);
});

test('polygons: thermal gap from slThermalIsolate, outline grown by half the pen, isolate, thermals and orphans (#60)', () => {
  // the fixture's bottom GND polygon: width 0.254, isolate 0.3, vertices at 1..49 x 1..39 mm
  const z = importEagle({ sch: SCH, brd: BRD, name: 'reg' }).project.board.zones[0];
  assert.equal(z.clearance, 300_000);
  assert.equal(z.connect, 'thermal');
  assert.equal(z.thermal.spoke, 254_000);
  assert.equal(z.thermal.gap, 254_000, 'no slThermalIsolate in the fixture: Eagle\'s default 10 mil');
  assert.equal(z.keepIslands, undefined);
  // copper reaches 0.127 mm past the vertices
  const xs = z.outline.map((q) => q[0]), ys = z.outline.map((q) => q[1]);
  assert.ok(Math.abs(Math.min(...xs) - (1e6 - 127_000)) <= 1 && Math.abs(Math.max(...xs) - (49e6 + 127_000)) <= 1, `${Math.min(...xs)} ${Math.max(...xs)}`);
  assert.ok(Math.abs(Math.min(...ys) - (-39e6 - 127_000)) <= 1 && Math.abs(Math.max(...ys) - (-1e6 + 127_000)) <= 1);
  // the board's own rule, solid connection and kept islands
  const brd = BRD.replace('<param name="mdWireWire"', '<param name="slThermalIsolate" value="7mil"/><param name="mdWireWire"')
    .replace('<polygon width="0.254" layer="16" isolate="0.3" rank="1" thermals="yes">', '<polygon width="0.4" layer="16" rank="1" thermals="no" orphans="yes">');
  assert.notEqual(brd, BRD);
  const y = importEagle({ sch: SCH, brd, name: 'reg' }).project.board.zones[0];
  assert.equal(y.thermal.gap, 177_800);
  assert.equal(y.connect, 'solid');
  assert.equal(y.clearance, 0, 'no isolate: the board\'s clearance rules apply');
  assert.equal(y.keepIslands, true);
  assert.equal(y.thermal.spoke, 400_000);
});

test('Eagle parts: a multi-gate op-amp keeps A, B; its power gate is P, as Eagle names it (#62)', async () => {
  const { unitLetter } = await import('../src/renderer/core/library.js');
  const p = importEagle({ sch: SCH, name: 'reg' }).project;
  const u2 = Object.values(p.components).find((c) => c.ref === 'U2'), part = p.parts[u2.partId];
  assert.deepEqual(part.units.map((_, i) => unitLetter(part, i)), ['A', 'B', 'P']);
  const r1 = Object.values(p.components).find((c) => c.ref === 'R1');
  assert.equal(unitLetter(p.parts[r1.partId], 0), '');
});

test('Eagle rectangles and polygons import filled, in symbols and packages (#72)', () => {
  const p = importEagle({ sch: SCH, brd: BRD, name: 'reg' }).project;
  const pkg = parseXml('<package name="R"><rectangle x1="-1" y1="-0.5" x2="1" y2="0.5" layer="21"/><polygon width="0.1" layer="21"><vertex x="0" y="0"/><vertex x="1" y="0"/><vertex x="1" y="1"/></polygon><smd name="1" x="0" y="0" dx="1" dy="1" layer="1"/></package>');
  const fp = packageToFootprint(pkg);
  assert.deepEqual(fp.graphics.filter((g) => (g.type === 'rect' || g.type === 'poly') && g.layer === 'F.SilkS').map((g) => [g.type, g.fill]), [['rect', 'outline'], ['poly', 'outline']]);
  assert.ok(p.schematic.sheets.length > 0);
});

test('a label the import adds for a named net goes clear of pins (#75)', async () => {
  const { pinPositions } = await import('../src/renderer/core/project.js');
  // R1's stub net, given a real name and no label: Eagle names it, so the import must add a label
  const sch = SCH.replace('<net name="N$1" class="0">', '<net name="R1_OUT" class="0">');
  assert.notEqual(sch, SCH);
  const r = importEagle({ sch, name: 'reg' });
  assert.equal(r.check.schematic.ok, true, r.check.schematic.mismatches.join('\n'));
  const s = r.project.schematic.sheets[0];
  const l = s.labels.find((x) => x.net === 'R1_OUT');
  assert.ok(l, 'a label was added');
  const pins = new Set(s.symbols.flatMap((y) => pinPositions(r.project, y).map((q) => q.at.join(','))));
  assert.ok(!pins.has(l.at.join(',')), `not on a pin: ${l.at}`);
  // R1's wire runs from its pin 2 to a loose end 5.08 mm to the right: the label takes the loose end, reading right
  const w = s.wires.find((x) => pins.has(x.a.join(',')) !== pins.has(x.b.join(',')) && (x.a[0] === l.at[0] || x.b[0] === l.at[0]));
  assert.ok(w, 'the label sits on the end of R1\'s wire');
  const pinEnd = pins.has(w.a.join(',')) ? w.a : w.b, loose = pinEnd === w.a ? w.b : w.a;
  assert.deepEqual(l.at, loose);
  assert.equal(loose[0] - pinEnd[0], 5_080_000);
  assert.equal(l.rot, 0);
  assert.ok(r.report.some((t) => /got one, placed clear of pins/.test(t)), r.report.join('\n'));
});

test('Eagle symbols carry Eagle\'s pin text: names 1.778 mm, 1.905 mm in from the pin (#79)', async () => {
  const p = importEagle({ sch: SCH, name: 'reg' }).project;
  for (const part of Object.values(p.parts)) for (const u of part.units) {
    if (!u.pins.length) continue;
    assert.equal(u.pinNameSize, 1_778_000, part.name);
    assert.equal(u.pinNameOffset, 1_905_000, part.name);
  }
  // the import picks the vector font (Eagle's metrics) for both the schematic and the board
  assert.equal(p.schematic.textFont, 'vector');
  assert.equal(p.board.textFont, 'vector');
  const { measureText, setTextStyle, projectTextStyle } = await import('../src/renderer/schematic/render.js');
  const { strokeWidthOf } = await import('../src/renderer/core/strokefont.js');
  setTextStyle(projectTextStyle(p));
  try { assert.equal(measureText('PA05/SERCOM0_1', 1_778_000), Math.round(strokeWidthOf('PA05/SERCOM0_1', 1_778_000, 'vector'))); }
  finally { setTextStyle('sans'); }
});

test('plain Eagle labels come over as text on the wire, xref labels as flags, both at Eagle\'s size (#81)', () => {
  const sch = SCH.replace('<label x="81.28" y="83.82" size="1.778" layer="95"/>', '<label x="81.28" y="83.82" size="1.27" layer="95" xref="yes"/>');
  const { project, check } = importEagle({ sch, name: 'reg' });
  const ls = project.schematic.sheets.flatMap((s) => s.labels).filter((l) => l.style === 'label');
  const look = (l) => l.shape || (l.scope === 'global' ? 'flag' : 'text');
  assert.ok(ls.some((l) => look(l) === 'flag' && !l.size), 'the xref label: a flag at 1.27 mm (the default)');
  assert.ok(ls.filter((l) => look(l) === 'text').every((l) => l.size === 1_778_000 || !l.size));
  assert.ok(ls.some((l) => look(l) === 'text' && l.size === 1_778_000), 'plain labels keep 1.778 mm');
  assert.ok(check.schematic.ok, JSON.stringify(check.schematic.mismatches));
  // sheet references (#76): only xref labels show them, so the project default is off
  assert.equal(project.schematic.showSheetRefs, false);
  assert.ok(ls.every((l) => !l.showRefs || (l.scope === 'global' && look(l) === 'flag')));
});
