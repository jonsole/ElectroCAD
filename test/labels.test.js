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
  assert.throws(() => deserialize(serialize(p)), /unknown kind/);
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
