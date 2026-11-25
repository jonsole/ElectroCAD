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
import { importEagle, eagleKind } from '../src/renderer/io/eagle/index.js';
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
  // Eagle's own transform: mirror X, then rotate anticlockwise (Y up), then translate; we're Y down
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
      let x = Number(c.attr('x')), y = Number(c.attr('y'));
      if (mirror) x = -x;
      const t = (rot * Math.PI) / 180;
      const ex = Number(el.attr('x')) + x * Math.cos(t) - y * Math.sin(t), ey = Number(el.attr('y')) + x * Math.sin(t) + y * Math.cos(t);
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
