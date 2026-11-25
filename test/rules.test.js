import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newProject } from '../src/renderer/core/project.js';
import { FAB_PRESETS, FABS, applyPreset, presetState, presetFor, setRule, RULE_FIELDS, fabSettings } from '../src/renderer/core/presets.js';
import { addNetClass, renameNetClass, deleteNetClass, setNetClassRule, assignNet, netClassOf, boardNets, DEFAULT_CLASS } from '../src/renderer/core/netclasses.js';
import { netRules, clearanceBetween } from '../src/renderer/core/collision.js';
import { startRoute, newVia } from '../src/renderer/core/router.js';
import { mm } from '../src/renderer/core/units.js';

test('every fab has a 2- and a 4-layer preset with every rule, sane', () => {
  assert.ok(FABS.length >= 3);
  for (const fab of FABS) for (const n of [2, 4]) {
    const p = presetFor(fab, n);
    assert.equal(p.copper, n);
    for (const [k] of RULE_FIELDS) assert.ok(p.rules[k] > 0, `${p.id} ${k}`);
    assert.ok(p.rules.viaDiameter - p.rules.viaDrill >= 2 * p.rules.annularRing, `${p.id}: the via keeps its annular ring`);
    assert.ok(p.rules.viaDrill >= p.rules.minHole, `${p.id}: the via drill is a hole the fab makes`);
  }
  assert.equal(new Set(FAB_PRESETS.map((p) => p.id)).size, FAB_PRESETS.length);
});

test('a new board starts on the Generic preset, unedited', () => {
  const p = newProject('R');
  const st = presetState(p.board);
  assert.equal(st.name, 'Generic 2-layer');
  assert.deepEqual(st.edited, []);
  assert.equal(st.mismatch, false);
  // an old file's "generic" reads as the Generic preset of its layer count
  p.board.preset = 'generic';
  assert.equal(presetState(p.board).preset.id, 'generic-2');
});

test('applying a preset sets the expected rules and output settings; rules stay editable', () => {
  const p = newProject('R');
  applyPreset(p, 'oshpark-2');
  const r = p.board.rules;
  assert.equal(r.clearance, 152_400);      // 6 mil
  assert.equal(r.trackWidth, 152_400);
  assert.equal(r.viaDrill, 254_000);       // 10 mil
  assert.equal(r.viaDiameter, 508_000);
  assert.equal(r.minHole, 254_000);
  assert.equal(r.annularRing, 127_000);    // 5 mil
  assert.equal(r.edgeClearance, 381_000);  // 15 mil
  assert.equal(p.board.preset, 'oshpark-2');
  assert.deepEqual(fabSettings(p.board), { naming: 'protel', drillUnits: 'mm' });
  applyPreset(p, 'jlcpcb-4');
  assert.equal(p.board.rules.clearance, mm(0.1));
  assert.equal(presetState(p.board).mismatch, true); // a 4-layer preset on a 2-layer board
  // edit a rule: still JLCPCB, marked edited
  setRule(p, 'trackWidth', mm(0.3));
  assert.equal(p.board.rules.trackWidth, mm(0.3));
  assert.deepEqual(presetState(p.board).edited, ['trackWidth']);
  assert.equal(presetState(p.board).name, 'JLCPCB 4-layer');
  assert.throws(() => setRule(p, 'viaDiameter', mm(0.2)), /larger than its drill/);
  assert.throws(() => setRule(p, 'clearance', 0), /more than 0/);
  assert.throws(() => applyPreset(p, 'nope'), /No fab preset/);
});

test('net classes: create, assign nets (one class each), rename, delete; lookup by net', () => {
  const p = newProject('R');
  const b = p.board;
  addNetClass(p, 'Power', { trackWidth: mm(0.5), clearance: mm(0.3) });
  assert.equal(b.netClasses.Power.viaDrill, b.rules.viaDrill);   // the rest from the Design rules
  assert.throws(() => addNetClass(p, 'power'), /already/);
  assert.throws(() => addNetClass(p, 'Default'), /Design rules/);
  assignNet(p, 'VCC', 'Power');
  assignNet(p, 'GND', 'Power');
  assert.equal(netClassOf(b, 'vcc'), 'Power');                    // regardless of case
  assert.equal(netClassOf(b, 'SIG'), DEFAULT_CLASS);
  assert.equal(netRules(b, 'VCC').trackWidth, mm(0.5));
  assert.equal(netRules(b, 'SIG').trackWidth, b.rules.trackWidth);
  assert.equal(clearanceBetween(b, 'SIG', 'GND'), mm(0.3));
  // a net is in one class at a time
  addNetClass(p, 'Fine');
  assignNet(p, 'GND', 'Fine');
  assert.deepEqual(b.netClasses.Power.nets, ['VCC']);
  assert.deepEqual(b.netClasses.Fine.nets, ['GND']);
  assignNet(p, 'GND', DEFAULT_CLASS);
  assert.equal(netClassOf(b, 'GND'), DEFAULT_CLASS);
  setNetClassRule(p, 'Power', 'viaDiameter', mm(1));
  assert.equal(b.netClasses.Power.viaDiameter, mm(1));
  assert.throws(() => setNetClassRule(p, 'Power', 'viaDiameter', mm(0.1)), /larger than its drill/);
  renameNetClass(p, 'Power', 'Supply');
  assert.equal(netClassOf(b, 'VCC'), 'Supply');
  deleteNetClass(p, 'Supply');
  assert.equal(netClassOf(b, 'VCC'), DEFAULT_CLASS);
  b.annotation.nets = { GND: [], 'Net-(R1-Pad2)': [] };
  b.tracks.push({ id: 't', a: [0, 0], b: [1, 0], width: 1, layer: 'F.Cu', net: 'gnd' });
  assert.deepEqual(boardNets(b), ['GND', 'Net-(R1-Pad2)']);
});

test('routing takes its width and vias from the net class', () => {
  const p = newProject('R');
  addNetClass(p, 'Power', { trackWidth: mm(0.6), viaDrill: mm(0.4), viaDiameter: mm(0.9) });
  assignNet(p, 'VCC', 'Power');
  const st = startRoute(p, [0, 0], 'F.Cu', 'vcc');
  assert.equal(st.width, mm(0.6));
  assert.deepEqual(st.via, { drill: mm(0.4), diameter: mm(0.9) });
  assert.equal(newVia(p, [0, 0], 'VCC').diameter, mm(0.9));
  assert.equal(startRoute(p, [0, 0], 'F.Cu', 'SIG').width, p.board.rules.trackWidth);
});
