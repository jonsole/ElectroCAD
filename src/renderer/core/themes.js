// Colour themes for the Schematic and Board canvases (#51, docs/UI.md "Canvas colours and
// colour themes"). DOM-free. Renderers never hard-code canvas colours: they resolve the active
// theme for their kind and read named tokens from it. Custom themes live in the app settings.

export const MATCH_APP = 'match-app';
export const THEME_FORMAT = 'electrocad-theme';

/** Thrown for theme files that can't be imported; the message is shown to the user. */
export class ThemeError extends Error {
  constructor(message) { super(message); this.name = 'ThemeError'; }
}

// Token lists, grouped for the editor. `number` tokens are 0..1 values, the rest are colours.
const T = (id, label, group, type = 'color') => ({ id, label, group, type });
export const TOKENS = {
  schematic: [
    T('background', 'Background', 'Canvas'), T('paper', 'Paper (sheet)', 'Canvas'),
    T('gridMinor', 'Grid', 'Canvas'), T('gridMajor', 'Grid (major)', 'Canvas'),
    T('sheetEdge', 'Sheet edge and title block', 'Canvas'), T('origin', 'Origin mark', 'Canvas'),
    T('wire', 'Wire', 'Connections'), T('junction', 'Junction', 'Connections'),
    T('netLabel', 'Net label', 'Connections'), T('globalLabel', 'Global label', 'Connections'),
    T('power', 'Power symbol', 'Connections'), T('noConnect', 'No-connect', 'Connections'),
    T('symbolBody', 'Symbol body', 'Symbols'), T('symbolFill', 'Symbol fill', 'Symbols'),
    T('pin', 'Pin', 'Symbols'), T('pinNumber', 'Pin number', 'Symbols'), T('pinName', 'Pin name', 'Symbols'),
    T('reference', 'Reference designator', 'Symbols'), T('value', 'Value', 'Symbols'),
    T('selection', 'Selection', 'Feedback'), T('highlight', 'Highlight (cross-probing)', 'Feedback'),
    T('ercError', 'ERC error', 'Feedback'), T('ercWarning', 'ERC warning', 'Feedback'),
  ],
  board: [
    T('background', 'Background', 'Canvas'), T('gridMinor', 'Grid', 'Canvas'), T('gridMajor', 'Grid (major)', 'Canvas'),
    T('origin', 'Origin mark', 'Canvas'),
    T('F.Cu', 'F.Cu (top copper)', 'Copper'), T('In1.Cu', 'In1.Cu', 'Copper'), T('In2.Cu', 'In2.Cu', 'Copper'), T('B.Cu', 'B.Cu (bottom copper)', 'Copper'),
    T('via', 'Via', 'Copper'), T('padThroughHole', 'Through-hole pad', 'Copper'), T('drill', 'Drill hole', 'Copper'),
    T('zoneOpacity', 'Zone fill opacity', 'Copper', 'number'),
    T('F.SilkS', 'F.SilkS', 'Other layers'), T('B.SilkS', 'B.SilkS', 'Other layers'),
    T('F.Mask', 'F.Mask', 'Other layers'), T('B.Mask', 'B.Mask', 'Other layers'),
    T('F.Paste', 'F.Paste', 'Other layers'), T('B.Paste', 'B.Paste', 'Other layers'),
    T('F.CrtYd', 'F.CrtYd', 'Other layers'), T('B.CrtYd', 'B.CrtYd', 'Other layers'),
    T('F.Fab', 'F.Fab', 'Other layers'), T('B.Fab', 'B.Fab', 'Other layers'),
    T('Edge.Cuts', 'Edge.Cuts (outline)', 'Other layers'),
    T('ratsnest', 'Ratsnest', 'Feedback'), T('selection', 'Selection', 'Feedback'), T('highlight', 'Highlight (cross-probing)', 'Feedback'),
    T('drcError', 'DRC error', 'Feedback'), T('inactiveDim', 'Dim inactive layers', 'Feedback', 'number'),
  ],
};

// ElectroCAD Dark / Light: the canvas colours of docs/UI.md, used by "Match app".
const SCH_DARK = {
  background: '#14161b', paper: '#1b1e25', gridMinor: '#232831', gridMajor: '#2f3542', sheetEdge: '#6b7890', origin: '#e5484d',
  wire: '#46a758', junction: '#46a758', netLabel: '#4f8cff', globalLabel: '#4f8cff', power: '#e5484d', noConnect: '#e5484d',
  symbolBody: '#e7eaf0', symbolFill: '#262a33', pin: '#98a2b3', pinNumber: '#98a2b3', pinName: '#c9d1dc', reference: '#e7eaf0', value: '#98a2b3',
  selection: '#29c5ff', highlight: '#ffb74d', ercError: '#ef5350', ercWarning: '#ffb74d',
};
const SCH_LIGHT = {
  background: '#e4e9f0', paper: '#ffffff', gridMinor: '#eef2f6', gridMajor: '#d3dbe6', sheetEdge: '#8b98aa', origin: '#e5484d',
  wire: '#1f7a35', junction: '#1f7a35', netLabel: '#2463eb', globalLabel: '#2463eb', power: '#c62828', noConnect: '#c62828',
  symbolBody: '#1c2430', symbolFill: '#f3f6fa', pin: '#5f6b7c', pinNumber: '#5f6b7c', pinName: '#2b3442', reference: '#1c2430', value: '#5f6b7c',
  selection: '#0a84ff', highlight: '#e08a00', ercError: '#d32f2f', ercWarning: '#e08a00',
};
// Classic paper: the traditional printed-schematic look; light in any UI theme.
const SCH_CLASSIC = {
  background: '#c9ccd1', paper: '#ffffff', gridMinor: '#eeeeee', gridMajor: '#d6d6d6', sheetEdge: '#840000', origin: '#840000',
  wire: '#008400', junction: '#008400', netLabel: '#0000c2', globalLabel: '#0000c2', power: '#840000', noConnect: '#0000c2',
  symbolBody: '#840000', symbolFill: '#ffffc2', pin: '#840000', pinNumber: '#840000', pinName: '#000000', reference: '#000000', value: '#000000',
  selection: '#0a84ff', highlight: '#ff9f00', ercError: '#ff0000', ercWarning: '#ff9f00',
};
const BOARD_DARK = {
  background: '#14161b', gridMinor: '#232831', gridMajor: '#2f3542', origin: '#e5484d',
  'F.Cu': '#e5484d', 'In1.Cu': '#e5b84d', 'In2.Cu': '#46a758', 'B.Cu': '#4f8cff', via: '#c9d1dc', padThroughHole: '#d4a017', drill: '#0b0c0f', zoneOpacity: 0.45,
  'F.SilkS': '#e7eaf0', 'B.SilkS': '#b6bfcc', 'F.Mask': '#7a2e8c', 'B.Mask': '#2e6f8c', 'F.Paste': '#9aa0a6', 'B.Paste': '#6e7a86',
  'F.CrtYd': '#d0d0d0', 'B.CrtYd': '#8a8a8a', 'F.Fab': '#a3a86b', 'B.Fab': '#5a6fb0', 'Edge.Cuts': '#f2c94c',
  ratsnest: '#98a2b3', selection: '#29c5ff', highlight: '#ffffff', drcError: '#ff3b6b', inactiveDim: 0.35,
};
const BOARD_LIGHT = {
  background: '#e4e9f0', gridMinor: '#d8dfe8', gridMajor: '#c3ccd8', origin: '#e5484d',
  'F.Cu': '#c62828', 'In1.Cu': '#b7791f', 'In2.Cu': '#2f855a', 'B.Cu': '#2463eb', via: '#6e7a86', padThroughHole: '#b8860b', drill: '#ffffff', zoneOpacity: 0.35,
  'F.SilkS': '#1c2430', 'B.SilkS': '#5f6b7c', 'F.Mask': '#8e44ad', 'B.Mask': '#1f7a8c', 'F.Paste': '#7a7f86', 'B.Paste': '#9aa3ad',
  'F.CrtYd': '#4a4a4a', 'B.CrtYd': '#8a8a8a', 'F.Fab': '#7a7f3a', 'B.Fab': '#3a4f9a', 'Edge.Cuts': '#b8860b',
  ratsnest: '#5f6b7c', selection: '#0a84ff', highlight: '#1c2430', drcError: '#d6004c', inactiveDim: 0.3,
};

// Built-ins: either fixed colours, or per-UI-theme colours (Match app).
const BUILTINS = {
  schematic: [
    { id: MATCH_APP, name: 'Match app', builtin: true, byUi: { dark: SCH_DARK, light: SCH_LIGHT } },
    { id: 'classic-paper', name: 'Classic paper', builtin: true, colors: SCH_CLASSIC },
  ],
  board: [
    { id: MATCH_APP, name: 'Match app', builtin: true, byUi: { dark: BOARD_DARK, light: BOARD_LIGHT } },
  ],
};

const KINDS = ['schematic', 'board'];
const customsOf = (kind, customs) => (customs || []).filter((t) => t && t.kind === kind);

/** Themes to offer for a kind: built-ins first, then the user's own. */
export function listThemes(kind, customs) {
  return [...BUILTINS[kind], ...customsOf(kind, customs)].map((t) => ({ id: t.id, name: t.name, builtin: !!t.builtin }));
}

/** The theme object (built-in or custom) for an id, or Match app when it doesn't exist. */
export function getTheme(kind, id, customs) {
  return BUILTINS[kind].find((t) => t.id === id) || customsOf(kind, customs).find((t) => t.id === id) || BUILTINS[kind][0];
}

/** Full colour set for a kind and theme id in the given UI theme ('dark' | 'light'). */
export function resolveTheme(kind, id, ui, customs) {
  const t = getTheme(kind, id, customs);
  const base = BUILTINS[kind][0].byUi[ui === 'light' ? 'light' : 'dark'];
  const own = t.byUi ? t.byUi[ui === 'light' ? 'light' : 'dark'] : t.colors;
  return { ...base, ...own };
}

/** Which theme kind a Workspace's canvas uses (Library's Symbol editor: schematic; Gerber: board). */
export const workspaceThemeKind = (workspaceId) => (workspaceId === 'board' || workspaceId === 'gerber' ? 'board' : 'schematic');

let counter = 1;
const newId = () => 't' + Date.now().toString(36) + (counter++).toString(36) + Math.random().toString(36).slice(2, 5);

function copyName(name, customs) {
  const taken = new Set((customs || []).map((t) => t.name));
  let n = `${name} (copy)`;
  for (let i = 2; taken.has(n); i++) n = `${name} (copy ${i})`;
  return n;
}

/** A new custom theme copied from any theme, with every colour filled in for the current UI theme. */
export function duplicateTheme(kind, sourceId, ui, customs) {
  const src = getTheme(kind, sourceId, customs);
  return { id: newId(), kind, name: copyName(src.name, customs), base: src.id, colors: resolveTheme(kind, src.id, ui, customs) };
}

/** The value a token returns to when Reset: the same token in the theme it was duplicated from. */
export function sourceValue(theme, tokenId, ui, customs) {
  return resolveTheme(theme.kind, theme.base || MATCH_APP, ui, customs)[tokenId];
}

const COLOR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
export const isColor = (v) => typeof v === 'string' && COLOR_RE.test(v);

export function exportTheme(theme) {
  return JSON.stringify({ format: THEME_FORMAT, version: 1, kind: theme.kind, name: theme.name, colors: theme.colors }, null, 2) + '\n';
}

/**
 * Read a theme file. Unknown tokens are ignored, missing ones are filled from Match app (dark),
 * bad values are refused. The result is a new custom theme (never replaces an existing one).
 */
export function importTheme(text, customs) {
  let j;
  try { j = JSON.parse(text); } catch { throw new ThemeError('This file is not an ElectroCAD colour theme (it is not valid JSON).'); }
  if (!j || j.format !== THEME_FORMAT) throw new ThemeError('This file is not an ElectroCAD colour theme.');
  if (!KINDS.includes(j.kind)) throw new ThemeError(`The theme's kind must be "schematic" or "board", not "${j.kind}".`);
  const colors = { ...resolveTheme(j.kind, MATCH_APP, 'dark', []) };
  const given = j.colors && typeof j.colors === 'object' ? j.colors : {};
  for (const tok of TOKENS[j.kind]) {
    if (!(tok.id in given)) continue;
    const v = given[tok.id];
    if (tok.type === 'number') {
      if (typeof v !== 'number' || !(v >= 0 && v <= 1)) throw new ThemeError(`${tok.id} must be a number from 0 to 1.`);
    } else if (!isColor(v)) throw new ThemeError(`${tok.id} must be a colour like #e5484d, not "${v}".`);
    colors[tok.id] = v;
  }
  const name = typeof j.name === 'string' && j.name.trim() ? j.name.trim().slice(0, 60) : 'Imported theme';
  const taken = new Set((customs || []).map((t) => t.name));
  let finalName = name;
  for (let i = 2; taken.has(finalName); i++) finalName = `${name} (${i})`;
  return { id: newId(), kind: j.kind, name: finalName, base: MATCH_APP, colors };
}
