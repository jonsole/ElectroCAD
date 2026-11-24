// The four workspaces (Schematic · Board · Gerber · Library), laid out per docs/UI.md.
// Ticket #2 builds the shell: the canvases pan and zoom, everything else is shown in
// place but disabled, with a tooltip naming the ticket that brings it.
import { h, button, icon } from '../ui/dom.js';
import { Workspace, later, sep, spacer, section, segmented, toolButton } from './workspace.js';
import { SCH_GRID, mm } from '../core/units.js';
import { BoardEditor } from '../board/editor.js';
import { SchematicEditor } from '../schematic/editor.js';
import { LibraryEditor } from '../libedit/editor.js';
import { FootprintEditor } from '../libedit/fpeditor.js';
import { openPrintDialog } from '../print/dialog.js';


function schematic(app) {
  const editor = new SchematicEditor(app);
  const ws = new Workspace({
    colors: () => app.canvasColors('schematic'),
    draw: (ctx, view, C) => editor.draw(ctx, view, C),
    onRefresh: () => { editor.renderTiles(); editor.refresh(); },
    id: 'schematic', label: 'Schematic', icon: 'schematic', title: 'Schematic: place Parts, wire them and check the Netlist',
    grid: app.project.schematic.sheets[0].grid.main,
    frame: { x0: 0, y0: 0, x1: mm(297), y1: mm(210) }, // A4 landscape sheet
    toolbar: [...editor.toolbar(), spacer(),
      button({ label: 'Print', icon: 'print', title: 'Print or export the schematic to PDF or SVG (Ctrl+P)', onClick: () => openPrintDialog(app) })],
    hint: '',
    tools: editor.tools(toolButton),
    side: editor.buildPicker(),
    chips: () => editor.sheetChips(),
    status: () => editor.status(),
  });
  ws.editor = editor;
  editor.attach(ws);
  editor.refresh();
  return ws;
}

function board(app) {
  const editor = new BoardEditor(app);
  const ws = new Workspace({
    colors: () => app.canvasColors('board'),
    draw: (ctx, view, C) => editor.draw(ctx, view, C),
    onRefresh: () => editor.refresh(),
    id: 'board', label: 'Board', icon: 'board', title: 'Board: draw the Outline, place Footprints, route Tracks and pour Zones',
    grid: app.project.board.grid.main, home: { x0: -10e6, y0: -10e6, x1: 110e6, y1: 90e6 },
    toolbar: [...editor.toolbar(), sep(),
      button({ label: 'Update from Schematic', icon: 'annotate', title: 'Forward annotation: list what the Schematic changes on the Board (new parts, removed parts, values, nets), then apply it (F8)', onClick: () => editor.annotate() }),
      later({ label: 'DRC', icon: 'erc', title: 'Design rule check' }, 25), spacer(),
      h('div', { class: 'mode-group', title: 'Routing mode' },
        later({ label: 'Shove', title: 'Shove routing mode' }, 29), later({ label: 'Walkaround', title: 'Walkaround routing mode' }, 22), later({ label: 'Free', title: 'Free routing mode' }, 20)),
      sep(), segmented([['2d', '2D', 'twoD', '2D board view'], ['3d', '3D', 'cube', '3D board preview', 40]], '2d')],
    hint: '',
    tools: editor.tools(later),
    side: editor.buildSide(),
    chips: () => editor.chips(),
    status: () => editor.status(),
  });
  ws.editor = editor;
  editor.attach(ws);
  return ws;
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
  // the editors live on the app, so an unsaved Part or Footprint survives switching Projects
  const sym = (app.libEditor ||= new LibraryEditor(app));
  const fpe = (app.fpEditor ||= new FootprintEditor(app));
  app.libMode ||= 'symbol';
  const cur = () => (app.libMode === 'footprint' ? fpe : sym);
  // both editors' toolbars, palettes and side panels are built; the Symbol | Footprint switch shows one
  const part = (cls, kids) => h('div', { class: `lib-mode ${cls}` }, ...kids.map((k) => k || h('span', { class: 'sep-h' })));
  const symBar = h('div', { class: 'lib-mode-bar' }, ...sym.toolbar()), fpBar = h('div', { class: 'lib-mode-bar' }, ...fpe.toolbar());
  const symTools = part('tool-set', sym.tools()), fpTools = part('tool-set', fpe.tools());
  const symSide = sym.buildSide(), fpSide = fpe.buildSide();
  const side = h('div', { class: 'lib-sides' }, symSide, fpSide);
  let ws;
  const seg = segmented([['symbol', 'Symbol', 'schematic', 'Edit Symbols (Parts)'], ['footprint', 'Footprint', 'pad', 'Edit Footprints: pads, silk, courtyard, fab; Generator…']], app.libMode, (id) => setMode(id));
  function setMode(id) {
    app.libMode = id;
    for (const b of seg.querySelectorAll('button')) b.classList.toggle('active', b.dataset.id === id);
    const f = id === 'footprint';
    symBar.hidden = f; symTools.hidden = f; symSide.hidden = f;
    fpBar.hidden = !f; fpTools.hidden = !f; fpSide.hidden = !f;
    if (ws) {
      ws.editor = cur();
      ws.view.canvas.style.cursor = '';
      ws.refresh(); ws.recolor();
      if (f && !fpe.draft) ws.view.fitHome();
    }
  }
  ws = new Workspace({
    colors: () => app.canvasColors(app.libMode === 'footprint' ? 'board' : 'schematic'), // the Footprint editor uses the Board theme
    draw: (ctx, view, C) => cur().draw(ctx, view, C),
    onRefresh: () => cur().refresh(),
    id: 'library', label: 'Library', icon: 'library', title: 'Library: your Libraries, and the Symbol and Footprint editors',
    grid: SCH_GRID, home: { x0: -20e6, y0: -15e6, x1: 20e6, y1: 15e6 },
    toolbar: [seg, sep(), symBar, fpBar],
    hint: '',
    tools: [symTools, fpTools],
    side,
    chips: () => cur().chips(),
    status: () => cur().status(),
  });
  sym.attach(ws);
  fpe.attach(ws);
  setMode(app.libMode);
  return ws;
}

export function buildWorkspaces(app) {
  return [schematic(app), board(app), gerber(app), library(app)];
}
