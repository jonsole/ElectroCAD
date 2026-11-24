import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseValue, formatValue, valueKey } from '../src/renderer/core/values.js';

const near = (a, b) => Math.abs(a - b) <= Math.abs(b) * 1e-9;

test('parses RKM, SI-suffix and plain engineering values', () => {
  for (const [s, n] of [['4k7', 4700], ['4.7k', 4700], ['4700', 4700], ['2R2', 2.2], ['0R1', 0.1], ['100n', 100e-9], ['0.1u', 100e-9],
    ['1n5', 1.5e-9], ['4M7', 4.7e6], ['10K', 1e4], ['100nF', 100e-9], ['4.7kΩ', 4700], ['47µ', 47e-6], ['1.5 M', 1.5e6], ['220p', 220e-12]]) {
    const v = parseValue(s);
    assert.ok(v && near(v.num, n), `${s} -> ${v && v.num}`);
  }
  assert.equal(parseValue('100nF').unit, 'F');
  assert.equal(parseValue('4.7kΩ').unit, 'Ω');
  for (const s of ['LED', 'LM358', '', 'k', '1k2k', 'DNP']) assert.equal(parseValue(s), null, s);
});

test('RKM formatting', () => {
  for (const [s, out] of [['4.7k', '4k7'], ['4700', '4k7'], ['2.2', '2R2'], ['100n', '100n'], ['0.1u', '100n'], ['1.5n', '1n5'],
    ['10k', '10k'], ['4.7M', '4M7'], ['47', '47R'], ['1u', '1u'], ['100nF', '100n'], ['0.47', 'R47']]) {
    assert.equal(formatValue(s, 'rkm'), out, s);
  }
});

test('SI formatting keeps a unit that was typed', () => {
  for (const [s, out] of [['4k7', '4.7k'], ['100nF', '100nF'], ['2R2', '2.2'], ['0.1u', '100n'], ['1500', '1.5k']]) assert.equal(formatValue(s, 'si'), out, s);
});

test('as typed, and values that are not numbers, pass through unchanged', () => {
  assert.equal(formatValue('4.7k', 'as-typed'), '4.7k');
  assert.equal(formatValue('LED', 'rkm'), 'LED');
  assert.equal(formatValue('BC547', 'si'), 'BC547');
});

test('BOM keys treat equal values as the same whatever the notation', () => {
  assert.equal(valueKey('4k7'), valueKey('4.7k'));
  assert.equal(valueKey('4700'), valueKey('4K7'));
  assert.equal(valueKey('100n'), valueKey('0.1u'));
  assert.notEqual(valueKey('100nF'), valueKey('100nH'));
  assert.equal(valueKey(' LED '), valueKey('led'));
});

test('RKM uses R as the decimal point only for resistances', () => {
  // a capacitor (or anything not a resistor) never gets the R
  for (const [s, out] of [['52', '52'], ['100n', '100n'], ['4.7u', '4u7'], ['1', '1'], ['2.2', '2.2'], ['10p', '10p'], ['0.1uF', '100n']]) {
    assert.equal(formatValue(s, 'rkm', { resistance: false }), out, s);
  }
  // resistors, and values typed with Ω, keep it
  assert.equal(formatValue('52', 'rkm', { resistance: true }), '52R');
  assert.equal(formatValue('2.2', 'rkm', { resistance: true }), '2R2');
  assert.equal(formatValue('0.47Ω', 'rkm', { resistance: false }), 'R47');
  // a typed unit decides when the part doesn't say: F means not a resistance
  assert.equal(formatValue('52F', 'rkm'), '52');
});
