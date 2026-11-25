import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newProject, newSheet, pinPositions } from '../src/renderer/core/project.js';
import { placeSymbol, addWire, addLabel, moveSelection, deleteItems, copySelection, pasteClip, itemsInRect, rotateSymbols } from '../src/renderer/core/schematic.js';
import { buildNetlist, connectedPins } from '../src/renderer/core/netlist.js';
import { labelBounds, hitLabel, validateLabelName } from '../src/renderer/core/labels.js';
import { RESISTOR } from '../src/renderer/library/mini.js';
import { SCH_GRID as G } from '../src/renderer/core/units.js';

const pinAt = (p, sym, n) => pinPositions(p, sym).find((x) => x.pin.number === n).at;
const netOf = (p, ref, pin) => buildNetlist(p).nets.find((n) => n.pins.some((x) => x.ref === ref && x.pin === pin));
const twoSheets = () => { const p = newProject(); p.schematic.sheets.push(newSheet('Sheet 2')); return { p, s1: p.schematic.sheets[0], s2: p.schematic.sheets[1] }; };

test('Net labels with the same name join on one Sheet and give the Net its name', () => {
  const p = newProject();
  const s = p.schematic.sheets[0];
  const a = placeSymbol(p, s, RESISTOR, [G * 10, G * 10]).sym;
  const b = placeSymbol(p, s, RESISTOR, [G * 40, G * 30]).sym;
  addLabel(p, s, { at: pinAt(p, a, '2'), net: 'EN' });
  addLabel(p, s, { at: pinAt(p, b, '1'), net: 'EN' });
  const net = netOf(p, 'R1', '2');
  assert.equal(net.name, 'EN');
  assert.deepEqual(net.pins.map((x) => `${x.ref}.${x.pin}`), ['R1.2', 'R2.1']);
});

test('a label on a Wire (end or middle) names that Wire\'s Net', () => {
  const p = newProject();
  const s = p.schematic.sheets[0];
  const a = placeSymbol(p, s, RESISTOR, [G * 10, G * 10]).sym;
  const b = placeSymbol(p, s, RESISTOR, [G * 30, G * 10]).sym;
  addWire(p, s, [pinAt(p, a, '2'), pinAt(p, b, '1')]);
  addLabel(p, s, { at: [G * 20, G * 10], net: 'MID' }); // middle of the wire
  assert.equal(netOf(p, 'R1', '2').name, 'MID');
});

test('local labels named alike on two Sheets stay separate; Global labels join', () => {
  const { p, s1, s2 } = twoSheets();
  const a = placeSymbol(p, s1, RESISTOR, [G * 10, G * 10]).sym;
  const b = placeSymbol(p, s2, RESISTOR, [G * 10, G * 10]).sym;
  addLabel(p, s1, { at: pinAt(p, a, '2'), net: 'EN' });
  addLabel(p, s2, { at: pinAt(p, b, '2'), net: 'EN' });
  assert.notEqual(netOf(p, 'R1', '2').pins.length, 2, 'two local EN Nets');
  assert.deepEqual(buildNetlist(p).nets.map((n) => n.name), ['Sheet 1/EN', 'Sheet 2/EN'], 'qualified by Sheet');
  s1.labels[0].scope = 'global'; s2.labels[0].scope = 'global';
  assert.deepEqual(netOf(p, 'R1', '2').pins.map((x) => x.ref), ['R1', 'R2'], 'one global EN Net');
});

test('Power symbols are global and win the Net name', () => {
  const { p, s1, s2 } = twoSheets();
  const a = placeSymbol(p, s1, RESISTOR, [G * 10, G * 10]).sym;
  const b = placeSymbol(p, s2, RESISTOR, [G * 10, G * 10]).sym;
  addLabel(p, s1, { at: pinAt(p, a, '1'), net: 'GND', style: 'gnd' });
  addLabel(p, s2, { at: pinAt(p, b, '1'), net: 'GND', style: 'gnd' });
  addLabel(p, s2, { at: pinAt(p, b, '1'), net: 'MY_GROUND', scope: 'global' }); // a second name on the same Net
  const net = netOf(p, 'R1', '1');
  assert.deepEqual(net.pins.map((x) => `${x.ref}.${x.pin}`), ['R1.1', 'R2.1']);
  assert.equal(net.name, 'GND', 'Power symbol beats Global label');
  assert.deepEqual(net.conflict, ['GND', 'MY_GROUND'], 'two names on one Net are flagged for ERC');
});

test('a label on a lone Pin makes a one-Pin Net and counts as connected', () => {
  const p = newProject();
  const s = p.schematic.sheets[0];
  const a = placeSymbol(p, s, RESISTOR, [G * 10, G * 10]).sym;
  addLabel(p, s, { at: pinAt(p, a, '1'), net: '+5V', style: 'power' });
  assert.equal(netOf(p, 'R1', '1').name, '+5V');
  assert.ok(connectedPins(p, s).has(`${a.id}:1`));
  assert.ok(buildNetlist(p).unconnected.some((x) => x.ref === 'R1' && x.pin === '2'));
});

test('labels move with the selection, ride along on moving wires, delete, copy and box-select', () => {
  const p = newProject();
  const s = p.schematic.sheets[0];
  const a = placeSymbol(p, s, RESISTOR, [G * 10, G * 10]).sym;
  const b = placeSymbol(p, s, RESISTOR, [G * 30, G * 10]).sym;
  const [w] = addWire(p, s, [pinAt(p, a, '2'), pinAt(p, b, '1')]);
  const l = addLabel(p, s, { at: [G * 20, G * 10], net: 'MID' });
  moveSelection(p, s, [a.id, b.id, w.id], [0, G * 5]);
  assert.deepEqual(l.at, [G * 20, G * 15], 'a label on a moving wire goes with it');
  assert.equal(netOf(p, 'R1', '2').name, 'MID');
  moveSelection(p, s, [l.id], [G * 2, 0]);
  assert.deepEqual(l.at, [G * 22, G * 15]);
  assert.equal(netOf(p, 'R1', '2').name, 'MID', 'still on the wire');
  const box = labelBounds(l);
  assert.ok(itemsInRect(p, s, { x0: box.x0 - 1, y0: box.y0 - 1, x1: box.x1 + 1, y1: box.y1 + 1 }, 'window').includes(l.id));
  assert.equal(hitLabel(s, [(box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2]), l);
  const ids = pasteClip(p, s, copySelection(p, s, [l.id]), [0, G * 10]);
  assert.equal(s.labels.length, 2);
  assert.equal(s.labels.find((x) => x.id === ids[0]).net, 'MID');
  deleteItems(p, [l.id]);
  assert.equal(s.labels.length, 1);
});

test('rotating a selected label turns it; names must be non-empty without spaces', () => {
  const p = newProject();
  const s = p.schematic.sheets[0];
  const l = addLabel(p, s, { at: [G * 5, G * 5], net: 'X' });
  rotateSymbols(p, [l.id]);
  assert.equal(l.rot, 90);
  assert.equal(validateLabelName('VIN'), null);
  assert.match(validateLabelName(' '), /needs a name/);
  assert.match(validateLabelName('V IN'), /no spaces/);
});

import { addSheet, renameSheet, moveSheet, deleteSheet, validateSheetName } from '../src/renderer/core/schematic.js';

test('Sheets: add after the current one, rename, reorder and delete with their Components', () => {
  const p = newProject();
  const s1 = p.schematic.sheets[0];
  const s3 = addSheet(p);
  const s2 = addSheet(p, s1.id);
  assert.deepEqual(p.schematic.sheets.map((s) => s.name), ['Sheet 1', 'Sheet 3', 'Sheet 2']);
  assert.deepEqual(p.schematic.sheets.map((s) => s.id), [s1.id, s2.id, s3.id]);
  renameSheet(p, s2.id, 'Power');
  assert.match(validateSheetName(p, s3.id, 'power'), /already/);
  assert.match(validateSheetName(p, s3.id, ''), /needs a name/);
  assert.throws(() => renameSheet(p, s3.id, 'Power'));
  moveSheet(p, s3.id, -1);
  assert.deepEqual(p.schematic.sheets.map((s) => s.name), ['Sheet 1', 'Sheet 2', 'Power']);
  placeSymbol(p, s2, RESISTOR, [G * 10, G * 10]);
  assert.equal(Object.keys(p.components).length, 1);
  deleteSheet(p, s2.id);
  assert.equal(Object.keys(p.components).length, 0, 'its Components go too');
  deleteSheet(p, s3.id);
  assert.throws(() => deleteSheet(p, s1.id), /at least one sheet/);
});

import { serialize, deserialize } from '../src/renderer/core/project.js';

test('labels and Sheets survive save and load; a damaged label is refused', () => {
  const { p, s2 } = twoSheets();
  addLabel(p, s2, { at: [G, G], net: '+3V3', style: 'power', rot: 180 });
  const back = deserialize(serialize(p));
  assert.equal(back.schematic.sheets.length, 2);
  assert.deepEqual(back.schematic.sheets[1].labels[0], s2.labels[0]);
  s2.labels[0].style = 'weird';
  assert.throws(() => deserialize(serialize(p)), /damaged[\s\S]*"weird" is not one of/);
});

import { netNameChoices, filterNetNames } from '../src/renderer/core/labels.js';

test('every Power symbol is offered every power net, including new ones', () => {
  const { p, s1, s2 } = twoSheets();
  const a = addLabel(p, s1, { at: [G, G], net: '+5V', style: 'power' });
  addLabel(p, s2, { at: [G, G], net: '+2V5', style: 'power' }); // a net typed by the user
  addLabel(p, s1, { at: [G * 3, G], net: 'GND', style: 'gnd' });
  addLabel(p, s1, { at: [G * 5, G], net: 'EN' });
  const choices = netNameChoices(p, a);
  assert.ok(choices.includes('+2V5') && choices.includes('+3V3') && choices.includes('VCC'));
  assert.ok(!choices.includes('GND') && !choices.includes('EN'), 'no ground or signal nets');
  assert.equal(new Set(choices).size, choices.length);
  assert.ok(choices.indexOf('+2V5') < choices.indexOf('+12V'), 'natural order');
  assert.deepEqual(netNameChoices(p, s1.labels[2]), ['EN'], 'labels offer label nets');
  // the box opens showing all of them; typing narrows the list
  assert.equal(filterNetNames(choices, '+5V', '+5V'), choices);
  assert.deepEqual(filterNetNames(choices, '3v', '+5V'), ['+3V3']);
});

import { canonicalNetName } from '../src/renderer/core/labels.js';

test('ADR-0013: net names match regardless of case and the Net takes one spelling', () => {
  const { p, s1, s2 } = twoSheets();
  const a = placeSymbol(p, s1, RESISTOR, [G * 10, G * 10]).sym;
  const b = placeSymbol(p, s2, RESISTOR, [G * 10, G * 10]).sym;
  const c = placeSymbol(p, s2, RESISTOR, [G * 30, G * 10]).sym;
  addLabel(p, s1, { at: pinAt(p, a, '1'), net: '+3v3', style: 'power' });
  addLabel(p, s2, { at: pinAt(p, b, '1'), net: '+3V3', style: 'power' });
  addLabel(p, s2, { at: pinAt(p, c, '1'), net: '+3V3', style: 'power' });
  const net = netOf(p, 'R1', '1');
  assert.deepEqual(net.pins.map((x) => x.ref), ['R1', 'R2', 'R3'], 'one Net');
  assert.equal(net.name, '+3V3', 'the spelling most labels use');
  assert.deepEqual(net.spellings, ['+3V3', '+3v3'], 'mixed spellings are reported for ERC');
  assert.equal(net.conflict, undefined, 'case-only differences are not a name conflict');
  // a Power symbol's spelling beats a Global label's, even when outnumbered
  addLabel(p, s1, { at: pinAt(p, a, '1'), net: '+3V3_x', scope: 'global' });
  assert.deepEqual(netOf(p, 'R1', '1').conflict, ['+3V3', '+3V3_x'], 'a different name is still a conflict');
  // local labels on one Sheet join across case; same name on two Sheets stays two Nets
  addLabel(p, s1, { at: pinAt(p, a, '2'), net: 'en' });
  addLabel(p, s2, { at: pinAt(p, b, '2'), net: 'EN' });
  addLabel(p, s2, { at: pinAt(p, c, '2'), net: 'En' });
  assert.deepEqual(netOf(p, 'R2', '2').pins.map((x) => x.ref), ['R2', 'R3'], 'en/EN/En join on Sheet 2');
  assert.equal(netOf(p, 'R1', '2').pins.length, 1, 'but not with Sheet 1');
  assert.deepEqual(buildNetlist(p).nets.map((n) => n.name).filter((n) => /en$/i.test(n)).sort(), ['Sheet 1/en', 'Sheet 2/EN'], 'qualified regardless of case');
});

test('ADR-0013: a typed name takes the spelling of a Net that already exists', () => {
  const { p, s1, s2 } = twoSheets();
  const keep = addLabel(p, s1, { at: [G, G], net: '+3V3', style: 'power' });
  const other = addLabel(p, s2, { at: [G, G], net: 'VCC', style: 'power' });
  assert.equal(canonicalNetName(p, '+3v3'), '+3V3');
  assert.equal(canonicalNetName(p, ' vcc '), 'VCC');
  assert.equal(canonicalNetName(p, '+5V'), '+5V', 'a new name is kept');
  assert.equal(canonicalNetName(p, 'vcc', other.id), 'vcc', 'the label being renamed does not count');
  keep.net = 'gnd_a';
  assert.equal(canonicalNetName(p, 'GND_A'), 'gnd_a');
  // the name box lists each Net once, in the Project's spelling
  keep.net = '+3v3';
  const choices = netNameChoices(p, keep);
  assert.ok(choices.includes('+3v3') && !choices.includes('+3V3'));
});

test('label look is separate from scope (#81): text or flag, any size; scope alone joins', async () => {
  const { labelShape, labelLook, labelSize, LABEL_TEXT } = await import('../src/renderer/core/labels.js');
  const { p, s1, s2 } = twoSheets();
  // no shape: follows the scope, as before
  const loc = addLabel(p, s1, { at: [0, 0], net: 'A' }), glob = addLabel(p, s1, { at: [0, G * 4], net: 'B', scope: 'global' });
  assert.equal(labelLook(loc), 'text'); assert.equal(labelLook(glob), 'flag');
  assert.ok(!('shape' in loc) && !('shape' in glob) && !('size' in loc), 'old projects load as they were');
  // a global label written as text, a local one as a flag
  const gt = addLabel(p, s1, { at: [0, G * 8], net: 'SDA', scope: 'global', shape: 'text' });
  const lf = addLabel(p, s1, { at: [0, G * 12], net: 'SCL', scope: 'local', shape: 'flag' });
  assert.equal(gt.shape, 'text'); assert.equal(lf.shape, 'flag');
  assert.equal(addLabel(p, s1, { at: [0, G * 16], net: 'X', scope: 'global', shape: 'flag' }).shape, undefined, 'the scope\'s own look is not stored');
  assert.equal(labelShape(gt).polys.length, 0, 'text: no box');
  assert.equal(labelShape(lf).polys.length, 1, 'flag: the pointed box');
  // bounds and hit testing follow the shape: the flag is centred on the wire, text sits above it
  const bt = labelBounds({ ...gt, at: [0, 0] }), bf = labelBounds({ ...gt, shape: 'flag', at: [0, 0] });
  assert.ok(bt.y1 < bf.y1 && bt.y0 < 0, `text above the wire: ${JSON.stringify(bt)} vs ${JSON.stringify(bf)}`);
  assert.equal(hitLabel({ labels: [{ ...gt, at: [0, 0] }] }, [G, Math.round(bf.y1 - 50_000)]), null, 'below a text label is empty');
  assert.ok(hitLabel({ labels: [{ ...gt, shape: 'flag', at: [0, 0] }] }, [G, Math.round(bf.y1 - 50_000)]), 'the same point is inside a flag');
  // text size scales the shape
  const big = addLabel(p, s1, { at: [0, G * 20], net: 'BIG', size: 1_778_000 });
  assert.equal(labelSize(big), 1_778_000); assert.equal(labelSize(loc), LABEL_TEXT);
  assert.ok(labelBounds({ ...big, at: [0, 0] }).y0 < labelBounds({ ...loc, net: 'BIG', at: [0, 0] }).y0);
  // turned and mirrored like the others: all four rotations give a box round the point
  for (const rot of [0, 90, 180, 270]) for (const l of [gt, lf]) {
    const b = labelBounds({ ...l, rot, at: [0, 0] });
    assert.ok(b.x0 <= 0 && b.x1 >= 0 && b.y0 <= 0 && b.y1 >= 0, `${l.shape} at ${rot}°`);
  }
  // scope still decides what joins: a global text label joins across sheets
  const a = placeSymbol(p, s1, RESISTOR, [G * 40, G * 10]).sym, b = placeSymbol(p, s2, RESISTOR, [G * 40, G * 10]).sym;
  addLabel(p, s1, { at: pinAt(p, a, '1'), net: 'BUS', scope: 'global', shape: 'text' });
  addLabel(p, s2, { at: pinAt(p, b, '1'), net: 'BUS', scope: 'global', shape: 'text' });
  const n = buildNetlist(p).nets.find((x) => x.name === 'BUS');
  assert.equal(n.pins.length, 2);
});

test('sheet references (#76): the other sheets a Global label\'s net is on, following the Netlist', async () => {
  const { sheetRefs } = await import('../src/renderer/core/sheetRefs.js');
  const { labelText, labelRefBoxes, showsRefs } = await import('../src/renderer/core/labels.js');
  const p = newProject();
  assert.equal(p.schematic.showSheetRefs, true, 'on for new projects');
  p.schematic.sheets.push(newSheet('Two'), newSheet('Three'));
  const [s1, s2, s3] = p.schematic.sheets;
  const a = placeSymbol(p, s1, RESISTOR, [G * 10, G * 10]).sym;
  const b = placeSymbol(p, s2, RESISTOR, [G * 10, G * 10]).sym;
  const l1 = addLabel(p, s1, { at: pinAt(p, a, '1'), net: 'D_A8', scope: 'global' });
  const l2 = addLabel(p, s2, { at: pinAt(p, b, '1'), net: 'd_a8', scope: 'global' });
  let r = sheetRefs(p);
  assert.deepEqual(r.get(l1.id), [2]); assert.deepEqual(r.get(l2.id), [1]);
  assert.equal(labelText(l1, r.get(l1.id)), 'D_A8 [2]');
  // a third sheet joins in
  const c = placeSymbol(p, s3, RESISTOR, [G * 10, G * 10]).sym;
  const l3 = addLabel(p, s3, { at: pinAt(p, c, '2'), net: 'D_A8', scope: 'global' });
  r = sheetRefs(p);
  assert.deepEqual(r.get(l1.id), [2, 3]); assert.deepEqual(r.get(l3.id), [1, 2]);
  // and leaves again
  deleteItems(p, [l3.id]);
  assert.deepEqual(sheetRefs(p).get(l1.id), [2]);
  // local labels and power symbols never show them; a label can turn them off, or on with the default off
  const loc = addLabel(p, s1, { at: [G * 40, G * 40], net: 'L' });
  assert.ok(!showsRefs(p, loc) && !sheetRefs(p).has(loc.id));
  l1.showRefs = false; assert.ok(!sheetRefs(p).has(l1.id));
  p.schematic.showSheetRefs = false; l1.showRefs = true;
  assert.deepEqual([...sheetRefs(p).keys()], [l1.id]);
  // each number has a box on the label, after the name, for clicking; a mirrored label too
  for (const rot of [0, 90, 180, 270]) {
    const L = { ...l1, at: [0, 0], rot };
    const boxes = labelRefBoxes(L, [2, 5]);
    assert.deepEqual(boxes.map((x) => x.sheet), [2, 5]);
    const lb = labelBounds(L, undefined, [2, 5]);
    for (const { box } of boxes) assert.ok(box.x0 >= lb.x0 - 1 && box.x1 <= lb.x1 + 1 && box.y0 >= lb.y0 - 1 && box.y1 <= lb.y1 + 1, `rot ${rot}: inside the label`);
    const horiz = rot === 0 || rot === 180;
    const [p2, p5] = boxes.map((x) => (horiz ? x.box.x0 : x.box.y0));
    assert.ok(rot === 90 || rot === 270 ? p2 > p5 : p2 < p5, `rot ${rot}: 2 reads before 5`);
  }
});
