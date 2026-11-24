// The four workspaces (Schematic · Board · Gerber · Library), laid out per docs/UI.md.
// Ticket #2 builds the shell: the canvases pan and zoom, everything else is shown in
// place but disabled, with a tooltip naming the ticket that brings it.
import { h, button, icon } from '../ui/dom.js';
import { Workspace, later, sep, spacer, section, segmented, toolButton } from './workspace.js';
import { SCH_GRID, mm } from '../core/units.js';
import { copperLayers } from '../core/project.js';
import { SchematicEditor } from '../schematic/editor.js';


const editTools = () => [ // Board, Gerber and Library editing arrives with their tickets
  later({ icon: 'undo', title: 'Undo (Ctrl+Z)' }, 4), later({ icon: 'redo', title: 'Redo (Ctrl+Shift+Z)' }, 4), sep(),
  later({ icon: 'copy', title: 'Copy (Ctrl+C)' }, 8), later({ icon: 'paste', title: 'Paste (Ctrl+V)' }, 8),
  later({ icon: 'duplicate', title: 'Duplicate (Ctrl+D)' }, 8), later({ icon: 'trash', title: 'Delete (Del)' }, 8),
];

function schematic(app) {
  const editor = new SchematicEditor(app);
  const ws = new Workspace({
    colors: () => app.canvasColors('schematic'),
    draw: (ctx, view, C) => editor.draw(ctx, view, C),
    onRefresh: () => { editor.renderTiles(); editor.refresh(); },
    id: 'schematic', label: 'Schematic', icon: 'schematic', title: 'Schematic: place Parts, wire them and check the Netlist',
    grid: SCH_GRID,
    frame: { x0: 0, y0: 0, x1: mm(297), y1: mm(210) }, // A4 landscape sheet
    toolbar: [...editor.toolbar(), spacer(),
      later({ label: 'ERC', icon: 'erc', title: 'Electrical rule check' }, 11),
      later({ label: 'Print', icon: 'print', title: 'Print or export to PDF/SVG' }, 14)],
    hint: '',
    tools: editor.tools(toolButton),
    side: editor.buildPicker(),
    chips: () => editor.sheetChips(),
    status: () => { const n = Object.keys(app.project.components).length, ns = app.project.schematic.sheets.length; return `${editor.sheet.name} · ${n} component${n === 1 ? '' : 's'} · ${ns} sheet${ns === 1 ? '' : 's'} · grid 50 mil`; },
  });
  ws.editor = editor;
  editor.attach(ws);
  editor.refresh();
  return ws;
}

function board(app) {
  const layers = () => [...copperLayers(app.project.board.stack.copper), 'F.SilkS', 'B.SilkS', 'Edge.Cuts'];
  const layerColor = (name) => app.canvasColors('board')[name] || '#888';
  const layerRow = (name, i) => h('div', { class: 'll-row' + (i === 0 ? ' on' : ''), title: name },
    h('span', { class: 'll-chip', style: { background: layerColor(name) } }, name === 'Edge.Cuts' ? 'Edge' : name.replace('.Cu', '').replace('.SilkS', ' silk')),
    h('span', { class: 'll-name' }, name),
    h('input', { type: 'checkbox', checked: true, title: 'Visible', 'aria-label': `${name} visible` }));
  const layerList = h('div', { class: 'layer-list' });
  const side = h('div', { class: 'side-panel' },
    section('Layers', layerList),
    section('Properties', h('p', { class: 'side-note' }, 'Nothing selected.')),
    section('Net classes', h('p', { class: 'side-note' }, 'Default · track 0.25 mm · clearance 0.2 mm')),
    section('DRC', h('p', { class: 'side-note' }, 'Not run yet.')));
  return new Workspace({
    colors: () => app.canvasColors('board'),
    onRefresh: () => layerList.replaceChildren(...layers().map(layerRow)),
    id: 'board', label: 'Board', icon: 'board', title: 'Board: place Footprints, route Tracks and pour Zones',
    grid: mm(0.5), home: { x0: -10e6, y0: -10e6, x1: 110e6, y1: 90e6 },
    toolbar: [...editTools(), sep(),
      later({ label: 'Annotate', icon: 'annotate', title: 'Forward annotation: bring Schematic changes onto the Board' }, 16),
      later({ label: 'DRC', icon: 'erc', title: 'Design rule check' }, 25), spacer(),
      h('div', { class: 'mode-group', title: 'Routing mode' },
        later({ label: 'Shove', title: 'Shove routing mode' }, 29), later({ label: 'Walkaround', title: 'Walkaround routing mode' }, 22), later({ label: 'Free', title: 'Free routing mode' }, 20)),
      sep(), segmented([['2d', '2D', 'twoD', '2D board view'], ['3d', '3D', 'cube', '3D board preview', 40]], '2d')],
    hint: 'No board yet. Draw an Outline, then use Annotate to bring Components over from the Schematic.',
    tools: [toolButton('select', 'Select (V)', { active: true }), toolButton('route', 'Route (X)', { ticket: 20 }),
      toolButton('dragTrack', 'Drag track (D)', { ticket: 31 }), toolButton('via', 'Via', { ticket: 21 }),
      toolButton('zone', 'Zone', { ticket: 23 }), toolButton('outline', 'Outline', { ticket: 15 }), null,
      toolButton('ltext', 'Text', { ticket: 15 }), toolButton('ruler', 'Measure', { ticket: 15 })],
    side,
    chips: () => copperLayers(app.project.board.stack.copper).map((name, i) => h('button', { class: 'chip' + (i === 0 ? ' on' : ''), type: 'button', title: `${name} (active layer)`, style: { background: layerColor(name) } }, name.replace('.Cu', ''))),
    status: () => `${app.project.board.stack.copper}-layer · ${app.project.board.footprints.length} footprints · grid 0.5 mm`,
  });
}

function gerber(app) {
  const outputs = [['Gerber X2 (copper, mask, paste, silk, Edge.Cuts)', true], ['Excellon drill (PTH / NPTH)', true], ['BOM (CSV)', false], ['Pick-and-place (CSV)', false]];
  const side = h('div', { class: 'side-panel' },
    section('Fab preset', h('select', { class: 'select', disabled: true, style: { width: '100%' }, title: 'Fab presets (coming in #24)' }, h('option', {}, 'Generic'))),
    section('Layers', h('p', { class: 'side-note' }, 'Generate to see each Gerber and drill file here.')),
    section('Output', ...outputs.map(([label, on]) => h('label', { class: 'check-row' }, h('input', { type: 'checkbox', checked: on, disabled: true }), label))),
    section('Checks', h('p', { class: 'side-note' }, 'DRC summary and missing-layer warnings appear here.')));
  return new Workspace({
    colors: () => app.canvasColors('board'),
    id: 'gerber', label: 'Gerber', icon: 'gerber', title: 'Gerber: generate Fab output, check it and download the zip',
    grid: mm(0.5), home: { x0: -10e6, y0: -10e6, x1: 110e6, y1: 90e6 },
    toolbar: [later({ label: 'Generate', icon: 'play', title: 'Generate Fab output', cls: 'btn-primary' }, 26),
      later({ label: 'Download zip', icon: 'zip', title: 'Download the fab zip' }, 26),
      later({ label: 'Open Gerber files…', icon: 'folder', title: 'Open a fab zip or Gerber/Excellon files' }, 28), spacer(),
      segmented([['top', 'Top', null, 'View from the top', 28], ['bottom', 'Bottom', null, 'View from the bottom', 28]], 'top')],
    hint: 'Nothing generated yet. Choose a Fab preset and outputs on the right, then Generate.',
    tools: [toolButton('select', 'Pan and inspect', { active: true }), toolButton('ruler', 'Measure', { ticket: 28 })],
    side,
    status: () => 'No files',
  });
}

function library(app) {
  const side = h('div', { class: 'side-panel' },
    section('Libraries',
      h('div', { class: 'side-search', style: { padding: '0 0 8px' } }, icon('search', 16), h('input', { class: 'input', type: 'search', placeholder: 'Search libraries', disabled: true })),
      h('p', { class: 'side-note' }, 'No user Libraries yet. The built-in starter Library arrives with #12.')),
    section('Part', h('p', { class: 'side-note' }, 'Select or create a Part to edit its prefix, default Value, Units and Preferred footprints.')),
    section('Properties', h('p', { class: 'side-note' }, 'Nothing selected.')));
  return new Workspace({
    colors: () => app.canvasColors('schematic'), // the Symbol editor; the Footprint editor (#19) switches to the Board theme
    id: 'library', label: 'Library', icon: 'library', title: 'Library: your Libraries, and the Symbol and Footprint editors',
    grid: SCH_GRID, home: { x0: -20e6, y0: -15e6, x1: 20e6, y1: 15e6 },
    toolbar: [segmented([['symbol', 'Symbol', 'schematic', 'Edit the Symbol', 13], ['footprint', 'Footprint', 'pad', 'Edit the Footprint', 19]], 'symbol'), sep(),
      later({ label: 'New part', icon: 'plus', title: 'New Part' }, 13), later({ label: 'Save', icon: 'check', title: 'Save to Library' }, 13)],
    hint: 'Pick a Library and Part on the right, or create a new Part.',
    tools: [toolButton('select', 'Select (V)', { active: true }), toolButton('pin', 'Pin', { ticket: 13 }), toolButton('pad', 'Pad', { ticket: 19 }), null,
      toolButton('lline', 'Line', { ticket: 13 }), toolButton('lrect', 'Rectangle', { ticket: 13 }), toolButton('lellipse', 'Circle', { ticket: 13 }),
      toolButton('arc', 'Arc', { ticket: 13 }), toolButton('ltext', 'Text', { ticket: 13 }), toolButton('wand', 'Footprint generator', { ticket: 19 })],
    side,
    status: () => 'No Part open',
  });
}

export function buildWorkspaces(app) {
  return [schematic(app), board(app), gerber(app), library(app)];
}
