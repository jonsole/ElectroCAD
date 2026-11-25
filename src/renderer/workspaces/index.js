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
import { GerberPanel } from '../gerber/panel.js';


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
    side: (editor.buildPicker(), ''), // the part picker is the Parts card over the canvas
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
      button({ label: 'Board setup', icon: 'settings', title: 'Board setup: Fab preset, Design rules, Fab output settings and Net classes', onClick: () => editor.setup() }),
      button({ label: 'DRC', icon: 'erc', title: 'Design rule check: clearance, track width, annular ring, holes, edge clearance, courtyards, unrouted nets and Schematic changes (waits for zone fills); click a result to go there', onClick: () => editor.runDrc() }), spacer(),
      editor.modeGroup(later),
      sep(), segmented([['2d', '2D', 'twoD', '2D board view'], ['3d', '3D', 'cube', '3D board preview', 40]], '2d')],
    hint: '',
    tools: editor.tools(later),
    side: '', // Layers and Properties are cards over the canvas
    chips: () => editor.chips(),
    status: () => editor.status(),
  });
  ws.editor = editor;
  editor.attach(ws);
  return ws;
}

function gerber(app) {
  const panel = (app.gerberPanel ||= new GerberPanel(app));
  const side = panel.side();
  const sel = toolButton('select', 'Pan and inspect', { active: true }), meas = toolButton('ruler', 'Measure (M): click two points');
  sel.dataset.tool = 'select'; meas.dataset.tool = 'measure';
  sel.addEventListener('click', () => panel.setTool('select'));
  meas.addEventListener('click', () => panel.setTool('measure'));
  panel.toolBtns = [sel, meas];
  panel.sideSeg = segmented([['top', 'Top', 'arrowUp', 'View from the top'], ['bottom', 'Bottom', 'flip', 'View from the bottom, mirrored (B)']], 'top', (id) => { panel.setSide(id); ws.renderBar(); });
  const ws = new Workspace({
    colors: () => app.canvasColors('board'),
    id: 'gerber', label: 'Gerber', icon: 'gerber', title: 'Gerber: generate the fab files, view them as the board house will, compare them and download the zip',
    grid: mm(0.5), home: { x0: -10e6, y0: -10e6, x1: 110e6, y1: 90e6 },
    toolbar: [...panel.toolbar(), spacer(), panel.sideSeg],
    hint: 'Generate makes the fab files and shows them read back; Open fab files… views any zip or Gerbers; Compare with… checks them against a reference set, layer by layer.',
    tools: [sel, meas],
    side,
    draw: (ctx, v, C) => panel.viewer.draw(ctx, v, C),
    onRefresh: () => panel.refresh(),
    status: () => panel.status(),
  });
  ws.panel = panel;
  panel.attach(ws);
  panel.refresh();
  return ws;
}

function library(app) {
  // the editors live on the app, so an unsaved Part or Footprint survives switching Projects
  const sym = (app.libEditor ||= new LibraryEditor(app));
  const fpe = (app.fpEditor ||= new FootprintEditor(app));
  app.libMode ||= 'symbol';
  const cur = () => (app.libMode === 'footprint' ? fpe : sym);
  // both editors' toolbars, palettes and side panels are built; the Symbol | Footprint switch shows one
  const part = (cls, kids) => h('div', { class: `lib-mode ${cls}` }, ...kids.map((k) => k || h('span', { class: 'sep-h' })));
  const symCards = sym.buildSide(), fpCards = fpe.buildSide(); // each editor's cards over the canvas
  const symBar = h('div', { class: 'lib-mode-bar' }, ...sym.toolbar(), sep(), ...symCards.buttons()), fpBar = h('div', { class: 'lib-mode-bar' }, ...fpe.toolbar(), sep(), ...fpCards.buttons());
  const symTools = part('tool-set', sym.tools()), fpTools = part('tool-set', fpe.tools());
  let ws;
  const seg = segmented([['symbol', 'Symbol', 'schematic', 'Edit Symbols (Parts)'], ['footprint', 'Footprint', 'pad', 'Edit Footprints: pads, silk, courtyard, fab; Generator…']], app.libMode, (id) => setMode(id));
  function setMode(id) {
    app.libMode = id;
    for (const b of seg.querySelectorAll('button')) b.classList.toggle('active', b.dataset.id === id);
    const f = id === 'footprint';
    symBar.hidden = f; symTools.hidden = f; symCards.setVisible(!f);
    fpBar.hidden = !f; fpTools.hidden = !f; fpCards.setVisible(f);
    if (ws) {
      ws.editor = cur();
      ws.view.canvas.style.cursor = '';
      ws.refresh(); ws.recolor();
      sym._updateStrip?.(); fpe._updateStrip?.(); // only the shown editor's context strip shows
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
    side: '', // Libraries, Part and Properties are cards over the canvas
    chips: () => cur().chips(),
    status: () => cur().status(),
  });
  sym.attach(ws);
  fpe.attach(ws);
  ws.view.onContextMenu = (e) => cur().contextMenu?.(e); // right-click: the shown editor's menu
  symCards.mount(ws);
  fpCards.mount(ws);
  setMode(app.libMode);
  return ws;
}

export function buildWorkspaces(app) {
  return [schematic(app), board(app), gerber(app), library(app)];
}
