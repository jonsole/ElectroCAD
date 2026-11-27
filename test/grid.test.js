// Grid steps typed into the Grid card: a number with a unit, or a bare number in the editor's unit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGridStep, gridLabel } from '../src/renderer/core/grid.js';

test('a grid step typed in: mm, mil, inches and microns, with or without a space', () => {
  assert.equal(parseGridStep('0.1mm'), 100_000);
  assert.equal(parseGridStep(' 0.1 mm '), 100_000);
  assert.equal(parseGridStep('7mil'), 177_800);
  assert.equal(parseGridStep('7 MILS'), 177_800);
  assert.equal(parseGridStep('5 thou'), 127_000);
  assert.equal(parseGridStep('0.05in'), 1_270_000);
  assert.equal(parseGridStep('0.05"'), 1_270_000);
  assert.equal(parseGridStep('25um'), 25_000);
  assert.equal(parseGridStep('.5'), 500_000);                 // bare: mm by default
  assert.equal(parseGridStep('2', 'mil'), 50_800);            // or the editor's unit
  assert.equal(parseGridStep('0,25 mm'), 250_000);            // a decimal comma
  for (const bad of ['', 'big', '-1mm', '1 ft', '0.0001mm', '200mm', '1e3mm']) assert.equal(parseGridStep(bad), null, bad);
});

test('a grid step shown back: the listed label, else mil for whole hundredths of a mil, else mm', () => {
  assert.equal(gridLabel(100_000), '0.1 mm');
  assert.equal(gridLabel(177_800), '7 mil');
  assert.equal(gridLabel(50_800), '2 mil');
  assert.equal(gridLabel(123_000), '0.123 mm');
  for (const s of ['0.1mm', '7mil', '0.123 mm', '2.5 mil']) assert.equal(parseGridStep(gridLabel(parseGridStep(s))), parseGridStep(s), s);
});
