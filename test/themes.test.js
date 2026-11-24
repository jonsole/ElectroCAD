import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TOKENS, listThemes, resolveTheme, getTheme, duplicateTheme, importTheme, exportTheme, ThemeError,
  workspaceThemeKind, MATCH_APP,
} from '../src/renderer/core/themes.js';

test('every built-in theme defines every token of its kind', () => {
  for (const kind of ['schematic', 'board']) {
    for (const t of listThemes(kind, [])) {
      for (const ui of ['dark', 'light']) {
        const c = resolveTheme(kind, t.id, ui, []);
        for (const tok of TOKENS[kind]) assert.ok(c[tok.id] !== undefined, `${kind}/${t.id}/${ui} lacks ${tok.id}`);
      }
    }
  }
});

test('built-ins: Match app for both kinds, Classic paper for the schematic only', () => {
  assert.deepEqual(listThemes('schematic', []).map((t) => t.id), [MATCH_APP, 'classic-paper']);
  assert.deepEqual(listThemes('board', []).map((t) => t.id), [MATCH_APP]);
});

test('Match app follows the UI theme; Classic paper stays light', () => {
  const darkBg = resolveTheme('schematic', MATCH_APP, 'dark', []).background;
  const lightBg = resolveTheme('schematic', MATCH_APP, 'light', []).background;
  assert.notEqual(darkBg, lightBg);
  assert.equal(resolveTheme('schematic', 'classic-paper', 'dark', []).paper, '#ffffff');
  assert.equal(resolveTheme('schematic', 'classic-paper', 'dark', []).paper, resolveTheme('schematic', 'classic-paper', 'light', []).paper);
});

test('an unknown theme id falls back to Match app', () => {
  assert.deepEqual(resolveTheme('board', 'gone', 'dark', []), resolveTheme('board', MATCH_APP, 'dark', []));
});

test('duplicating makes an editable custom theme with all colours and a copy name', () => {
  const copy = duplicateTheme('schematic', 'classic-paper', 'dark', []);
  assert.equal(copy.kind, 'schematic');
  assert.equal(copy.builtin, undefined);
  assert.equal(copy.base, 'classic-paper');
  assert.equal(copy.name, 'Classic paper (copy)');
  assert.equal(copy.colors.paper, '#ffffff');
  const again = duplicateTheme('schematic', 'classic-paper', 'dark', [copy]);
  assert.equal(again.name, 'Classic paper (copy 2)');
  assert.notEqual(again.id, copy.id);
  const customs = [copy];
  copy.colors.wire = '#123456';
  assert.equal(resolveTheme('schematic', copy.id, 'light', customs).wire, '#123456');
  assert.equal(getTheme('schematic', copy.id, customs).name, 'Classic paper (copy)');
});

test('export then import round-trips a custom theme as a new theme', () => {
  const t = duplicateTheme('board', MATCH_APP, 'dark', []);
  t.colors['F.Cu'] = '#ff0000';
  t.colors.zoneOpacity = 0.6;
  const json = exportTheme(t);
  const back = importTheme(json, [t]);
  assert.notEqual(back.id, t.id);
  assert.equal(back.kind, 'board');
  assert.equal(back.colors['F.Cu'], '#ff0000');
  assert.equal(back.colors.zoneOpacity, 0.6);
});

test('import fills missing colours, ignores unknown tokens and rejects bad files', () => {
  const t = importTheme(JSON.stringify({ format: 'electrocad-theme', version: 1, kind: 'schematic', name: 'Mine', colors: { wire: '#00ff00', sparkle: '#fff' } }), []);
  assert.equal(t.colors.wire, '#00ff00');
  assert.equal(t.colors.sparkle, undefined);
  for (const tok of TOKENS.schematic) assert.ok(t.colors[tok.id] !== undefined, tok.id);
  assert.throws(() => importTheme('nope', []), ThemeError);
  assert.throws(() => importTheme(JSON.stringify({ format: 'electrocad-theme', version: 1, kind: 'gerber', colors: {} }), []), /kind/i);
  assert.throws(() => importTheme(JSON.stringify({ format: 'electrocad-theme', version: 1, kind: 'board', colors: { 'F.Cu': 'reddish' } }), []), /F\.Cu/);
  assert.throws(() => importTheme(JSON.stringify({ format: 'electrocad-theme', version: 1, kind: 'board', colors: { zoneOpacity: 3 } }), []), /zoneOpacity/);
  assert.throws(() => importTheme(JSON.stringify({ format: 'something-else' }), []), /not an ElectroCAD colour theme/i);
});

test('Library and Gerber workspaces use the right theme kind', () => {
  assert.equal(workspaceThemeKind('schematic'), 'schematic');
  assert.equal(workspaceThemeKind('library'), 'schematic');
  assert.equal(workspaceThemeKind('board'), 'board');
  assert.equal(workspaceThemeKind('gerber'), 'board');
});
