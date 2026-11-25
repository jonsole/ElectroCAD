// Overbar markup (#63): ~{…} runs, the plain text, and Eagle's `!` as markup.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { overbarRuns, plainText, hasOverbar, eagleOverbar } from '../src/renderer/core/overbar.js';

test('~{…} marks the overbarred runs', () => {
  assert.deepEqual(overbarRuns('~{RESET}'), [{ text: 'RESET', over: true }]);
  assert.deepEqual(overbarRuns('IS/~{RD}'), [{ text: 'IS/', over: false }, { text: 'RD', over: true }]);
  assert.deepEqual(overbarRuns('~{A}/B'), [{ text: 'A', over: true }, { text: '/B', over: false }]);
  assert.deepEqual(overbarRuns('~{OPEN'), [{ text: 'OPEN', over: true }], 'unclosed: to the end');
  assert.deepEqual(overbarRuns('A~B'), [{ text: 'A~B', over: false }], 'a lone ~ is itself');
  assert.deepEqual(overbarRuns('~'), [{ text: '~', over: false }]);
  assert.equal(plainText('IS/~{RD}'), 'IS/RD');
  assert.equal(plainText('plain'), 'plain');
  assert.ok(hasOverbar('~{X}') && !hasOverbar('~X'));
});

test('Eagle\'s ! becomes ~{…}: toggled by !, ended by a comma', () => {
  assert.equal(eagleOverbar('!RESET'), '~{RESET}');
  assert.equal(eagleOverbar('IS/!RD'), 'IS/~{RD}');
  assert.equal(eagleOverbar('I/!E'), 'I/~{E}');
  assert.equal(eagleOverbar('!A!/B'), '~{A}/B');
  assert.equal(eagleOverbar('!X,!Y,Z'), '~{X},~{Y},Z');
  assert.equal(eagleOverbar('GO!'), 'GO', 'a ! with nothing after it');
  assert.equal(eagleOverbar('VCC'), 'VCC');
  assert.equal(plainText(eagleOverbar('!D_IRL,!D_IRP')), 'D_IRL,D_IRP');
});
