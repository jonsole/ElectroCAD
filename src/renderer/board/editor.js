// The Board tab's editor (#15): the Layer stack, the layer panel (visibility and the active
// layer), the Outline tools and Measure. Footprints, Tracks, Vias and Zones arrive with their
// tickets. Edits go through app.edit, so they share the Project's undo history.
//
// Layer visibility and the corner radius for new rectangles are per-browser preferences, like the
// picker's view; the stack and the Outline are saved in the Project.
import { h, button, icon, toast, popupMenu, modal } from '../ui/dom.js';
import { section } from '../workspaces/workspace.js';
import { mm, toMm } from '../core/units.js';
import {
  boardLayers, setCopperLayers, setThickness, BOARD_THICKNESSES, LAYER_HELP, copperLayerNames,
  GRID_CHOICES, gridLabel, setGrid, snapToGrid,
  rectOutline, circleOutline, polygonOutline, checkOutline, outlineBounds, hitOutline, moveOutline,
} from '../core/board.js';
import { drawBoard, drawLabels, drawBoardDrawings } from './render.js';
import { openAnnotateDialog } from './annotate-dialog.js';
import { openBoardSetup } from './setup-dialog.js';
import { netClassOf } from '../core/netclasses.js';
import { runDrc, drcCounts, DRC_RULES, mergeDrc } from '../core/drc.js';
import { markApproved, unapproved, approve, unapprove, pruneApprovals } from '../core/drcApprovals.js';
import { boardItems, changedAreas } from '../core/drcLive.js';
import { hitPad, footprintOutline, insidePolygon, placedPads, padNets, hitFootprint, moveFootprints, rotateFootprints, flipFootprints, setLocked, setFootprintRotation, bfFootprint, bfKey, bfRef } from '../core/footprint.js';
import { ratsnest } from '../core/ratsnest.js';
import { copperIndex, pointSeg2 } from '../core/collision.js';
import { trackArc, trackBox, trackLength, trackPoints, nearestOnTrack } from '../core/trackGeom.js';
import { boardItemsInBox, moveCopper } from '../core/boardSelect.js';
import { BENDS, bendOf, bendFromPref, cycleBend, withBend, strokeTo, ROUTE_MODES, startRoute, step as routeStep, click as routeClickAt, back as routeBack, commit as routeCommit, switchLayer, layerPairs } from '../core/router.js';
import { connection, ripupRun, ripUp, setTrackWidth, setTrackLayer, setViaSize, placeVia, placeViaPushing } from '../core/copper.js';
import { validateRef, updateComponent, footprintChoices, footprintKey } from '../core/components.js';
import { allFootprints } from '../library/footprints.js';
import { addBoardOnly, setBoardOnly, deleteBoardOnly } from '../core/boardOnly.js';
import { dragSegment, dragCorner, dragEnd, cornerAt, dragResult, freeEndAt } from '../core/drag.js';
import { copperTarget, trackOnOtherLayer } from '../core/routeEnds.js';
import { STARTER_LIBRARY } from '../library/starter.js';
import { shapeHandles, hitHandle, dragHandle, dragOutlineHandle, snapPoint, handlePoints } from '../core/handles.js';
import { newZone, zoneInput, inPolygon, moveZones } from '../core/zones.js';
import { ZoneFiller } from './zoneFiller.js';
import { drawHandles, drawSnapMark } from '../view/handles.js';
import { watchAlt } from '../ui/grid.js';
import { GridCard } from '../ui/gridCard.js';
import { ContextStrip, stripLabel, stripSep, stripButton, stripNumber, stripSelect, stripSegmented, stripProps, stripGrip, placeStrip } from '../ui/contextStrip.js';
import { CardSet } from '../ui/cards.js';
import { highlight, screenBox, revealBox } from '../view/highlight.js';
import { probeFromBoard, boardTargets } from '../core/probe.js';
import { FIELD_KEYS, FIELD_NAME, fieldPlacement, setFieldOverride, placedFieldTexts, fieldStrings, fpInverse, worldRot, localRot } from '../core/fpTexts.js';
import { footprintOf, uid } from '../core/project.js';
import { drawingLayers, defaultWidth, DEFAULT_TEXT_SIZE, hitDrawing, moveDrawings, rotateDrawings, drawingsCentre, drawingBox } from '../core/boardDrawings.js';

const same = (a, b) => a && b && a[0] === b[0] && a[1] === b[1];

/** The palette tools that work now: key, icon, title. */
export const BOARD_TOOLS = {
  select: { icon: 'select', title: 'Select (V): click to select, or drag a box on empty space (left to right: what is wholly inside; right to left: what it touches; Shift adds); drag a track segment sideways (its neighbours follow), a track corner to reshape it, or a free track end to move it, pushing other nets\' copper in Shove mode', key: 'v' },
  route: { icon: 'route', title: 'Route (X): click a pad to start a track on the active copper layer, click to place corners, click a pad of the same net to finish · V drops a via and changes layer · right-click cycles Eagle\'s bend styles (Shift+right-click goes back), / swaps to the mirrored one · Backspace or Ctrl+Z undoes a segment · Esc cancels', key: 'x' },
  via: { icon: 'via', title: 'Via: click to place a through via; it takes the net of the track or pad it lands on' },
  ripup: { icon: 'ripup', title: 'Rip up: click a track or via to take its run (pad to pad) back to an airwire; Shift+click takes just that segment; drag a box to rip up every track and via in it' },
  footprint: { icon: 'pad', title: 'Place footprint: a footprint with no part on the Schematic, such as a mounting hole, fiducial or logo. Pick it, then click where it goes; Reference, pad nets and In BOM in Properties' },
  zone: { icon: 'zone', title: 'Zone (Z): click the corners of a copper pour on the active copper layer; click the first corner, double-click or Enter to close. Net, priority, clearance and thermal reliefs in Properties', key: 'z' },
  outline: { icon: 'outline', title: 'Outline rectangle (B): click two corners. Round the corners with Corner radius in Properties', key: 'b' },
  polygon: { icon: 'lpolygon', title: 'Outline polygon (P): click corners; A makes the next side an arc; click the first point to close', key: 'p' },
  circle: { icon: 'lellipse', title: 'Round outline or hole (C): click the centre, then the edge', key: 'c' },
  text: { icon: 'ltext', title: 'Text (T): click to place text on the drawing layer (top silk to start); set the text, size and layer in the strip first, or change them after in Properties', key: 't' },
  gline: { icon: 'lline', title: 'Line (I) on the drawing layer: click points; double-click or Enter to finish', key: 'i' },
  grect: { icon: 'lrect', title: 'Rectangle on the drawing layer: click two corners (Fill in the strip fills it)' },
  gcircle: { icon: 'lellipse', title: 'Circle on the drawing layer: click the centre, then the edge (Fill in the strip fills it)' },
  measure: { icon: 'ruler', title: 'Measure (M): click two points', key: 'm' },
  origin: { icon: 'target', title: 'Grid origin (O): click to move the origin there; it snaps onto handles. Reset it in the Grid card (toolbar)', key: 'o' },
};

const pref = {
  get(k, d) { try { const v = localStorage.getItem(`electrocad.${k}`); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(`electrocad.${k}`, JSON.stringify(v)); } catch { /* private mode */ } },
};

/** A text field for the context strip; onSet(text) on change. */
function stripText({ label, value, onSet, width = 120, title = '' }) {
  const i = h('input', { class: 'input', type: 'text', value: value ?? '', 'aria-label': label, style: { width: width + 'px' } });
  i.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') i.blur(); });
  i.addEventListener('change', () => onSet(i.value));
  return h('label', { class: 'strip-field', title: title || label }, h('span', {}, label), i);
}

const DRAW_KIND = { text: 'Text', line: 'Line', arc: 'Arc', rect: 'Rectangle', circle: 'Circle', poly: 'Polygon' };

const fmt = (nm) => toMm(nm).toFixed(2).replace(/\.?0+$/, '') || '0';

export class BoardEditor {
  constructor(app) {
    this.app = app;
    this.tool = 'select';
    this.activeLayer = 'F.Cu';
    this.hidden = new Set(pref.get('boardHidden', []));
    this.radius = mm(pref.get('boardCornerRadius', 0));
    this.selection = new Set(); // indices into board.outline
    this.fpSel = new Set();     // ids of selected board Footprints
    this.netSel = new Set();    // Net names (as on the Board) selected by double-clicking a pad
    this.trackSel = new Set();  // ids of selected Tracks and Vias
    this.zoneSel = new Set();   // ids of selected Zones
    this.drawSel = new Set();   // ids of selected Board drawings (#66)
    this.drawLayer = pref.get('boardDrawLayer', 'F.SilkS'); // the layer the drawing tools draw on
    this.drawText = 'TEXT';      // what the Text tool places
    this.drawSize = DEFAULT_TEXT_SIZE;
    this.drawWidth = null;      // pen width for new shapes (null: the layer's default)
    this.drawFill = false;      // new rectangles and circles filled
    // Zone fills, refilled in a Web Worker after each edit (only the Zones it touched)
    this.zoneFiller = new ZoneFiller(() => { this._rats = ratsnest(this.project, this.board, this.zoneFiller.fills); this._liveDrcFills(); this.renderProps(); this.ws?.renderBar(); this.ws?.view.invalidate(); });
    this.pair = pref.get('boardLayerPair', null); // the layers V switches between while routing (4-layer boards)
    this.routeMode = pref.get('boardRouteMode', 'shove'); // 'shove' (#29, the default) | 'walkaround' | 'free'
    this.bend = bendFromPref(pref.get('boardBend', pref.get('boardCorner', 1))); // Eagle's bend style (#91, BENDS)
    this.chamfer = mm(pref.get('boardChamfer', 0));         // Eagle-style auto mitre length (0: none)
    this.mitre = pref.get('boardMitre', 'straight');        // 'straight' (chamfer) | 'round' (#95)
    this.rotStep = pref.get('boardRotStep', 90);           // degrees R and the strip's rotate buttons turn by
    this.zoneNet = 'auto';                                 // the Zone tool's net: 'auto' (from the first corner), '' or a name
    this.strip = new ContextStrip('Tool options and selection actions', 'board');
    this.route = null;          // the track being routed (router state), its copper index and proposal
    this.pts = null;            // points clicked so far by the drawing tools
    this.arcNext = false;       // polygon: the next side is an arc (a mid point, then the end)
    this.measure = null;        // { a, b, done }
    this.drc = null;            // the last DRC run: { list, rev } (#25)
    this.drcFocus = null;       // the violation last jumped to
    this.drcFilter = { error: true, warning: true };
    this.drcShowApproved = false; // approved problems (#69) are hidden behind a toggle
  }

  get project() { return this.app.project; }
  get board() { return this.project.board; }
  /** The grid in use: the Alt grid while Alt is held. */
  get gridStep() { return this.alt ? this.board.grid.alt : this.board.grid.main; }
  snapPt(w) { return snapToGrid(w, this.gridStep, this.board.origin); }
  /**
   * Snap `w` onto another object's handle (pads come with #17) within the snap distance from
   * Settings, else to the grid. `skip`: outline indices not to snap to; `not`: a point to ignore
   * (where a dragged handle started); `extra`: more points to snap to (a dragged shape's own
   * corners, so one can be dropped on another to merge them). Remembers where it snapped, for the mark.
   */
  snapAt(w, skip = new Set(), not = null, extra = []) {
    const tol = this.app.snapDistance() / (this.ws?.view.view.scale || 1);
    const targets = [...handlePoints(this.board.outline, skip), this.board.origin, ...this._padPoints(), ...extra].filter((t) => !not || t[0] !== not[0] || t[1] !== not[1]);
    const r = snapPoint(w, targets, tol, (p) => this.snapPt(p));
    this.snapMark = r.target;
    return r.at;
  }
  /** A point as the user sees it: measured from the origin, in mm. */
  rel(p) { return `${fmt(p[0] - this.board.origin[0])}, ${fmt(p[1] - this.board.origin[1])}`; }

  /** Holding Alt switches to the Alt grid (and shows it) while drawing, moving or resizing. */
  setAlt(on) {
    if (!!on === !!this.alt) return;
    this.alt = !!on;
    if (this.ws) { this.ws.view.grid = this.gridStep; this.ws.renderBar(); this.ws.view.invalidate(); }
  }

  // ---------------------------------------------------------------- panels

  toolbar() {
    this.btn = {
      undo: button({ icon: 'undo', title: 'Undo (Ctrl+Z)', onClick: () => this.app.undo() }),
      redo: button({ icon: 'redo', title: 'Redo (Ctrl+Shift+Z)', onClick: () => this.app.redo() }),
    };
    this.gridCard = new GridCard({
      key: 'board-grid', choices: GRID_CHOICES,
      state: () => ({ grid: this.board.grid, origin: this.board.origin, scope: 'Board', originNote: 'The origin is measured from the page origin.' }),
      onGrid: (which, nm) => this.app.edit(`${which === 'alt' ? 'Alt grid' : 'Grid'}: ${gridLabel(nm)}`, (p) => setGrid(p, which, nm)),
      onSwap: () => this.app.edit('Swap grids', (p) => { const { main, alt } = p.board.grid; setGrid(p, 'main', alt); setGrid(p, 'alt', main); }),
      onOrigin: (at) => this.app.edit('Grid origin', (p) => { p.board.origin = at; }),
      onPick: () => this.setTool('origin'),
    });
    this.buildCards();
    // how tracks bend (Eagle's bend styles, #91) and the auto chamfer (Eagle's mitre)
    this.cornerSeg = h('div', { class: 'segmented corner-seg', role: 'radiogroup', 'aria-label': 'Bend style' },
      ...BENDS.map((b) => h('button', { class: 'btn' + (b.id === this.bend ? ' active' : ''), type: 'button', role: 'radio', 'aria-checked': String(b.id === this.bend), 'aria-label': `Bend ${b.id}: ${b.name}`, dataset: { bend: String(b.id) },
        title: `Bend ${b.id}: ${b.name} (right-click while routing cycles the styles, Shift+right-click goes back; / swaps to the mirrored one)`, onClick: () => this.setBend(b.id) }, icon(`bend${b.id}`, 18))));
    this.chamferIn = h('input', { class: 'input', type: 'number', min: '0', max: '10', step: '0.05', value: fmt(this.chamfer), 'aria-label': 'Mitre (mm)' });
    this.chamferIn.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') this.chamferIn.blur(); });
    this.chamferIn.addEventListener('change', () => { const v = parseFloat(this.chamferIn.value); if (Number.isFinite(v) && v >= 0) this.setChamfer(mm(v)); });
    const chamfer = h('label', { class: 'chamfer-box', title: 'Auto mitre (as Eagle\'s): Straight cuts bends of 90° or sharper back by this length and joins them at 45°; Round makes every bend an arc of this radius (#95). 0 for none' }, h('span', {}, 'Mitre'), this.chamferIn, h('em', {}, 'mm'));
    this.mitreSeg = h('div', { class: 'segmented corner-seg mitre-seg', role: 'radiogroup', 'aria-label': 'Mitre style' },
      ...[['straight', 'Straight', 'Bends are cut straight (a chamfer)'], ['round', 'Round', 'Bends are rounded: an arc of the mitre length\'s radius (#95)']].map(([id, label, tip]) => h('button', { class: 'btn' + (id === this.mitre ? ' active' : ''), type: 'button', role: 'radio', 'aria-checked': String(id === this.mitre), title: tip, dataset: { mitre: id }, onClick: () => this.setMitre(id) }, label)));
    // the Route tool's options pop up over the canvas while it is the tool (see attach)
    this.pairSel = h('select', { class: 'select', 'aria-label': 'Via layer pair', title: 'The two copper layers V switches between while routing (through vias join every layer)' });
    this.pairSel.addEventListener('change', () => { this.pair = this.pairSel.value.split('|'); pref.set('boardLayerPair', this.pair); if (this.route) this.route = { ...this.route, pair: this.pair }; });
    this.pairSel.addEventListener('keydown', (e) => e.stopPropagation());
    this.pairBox = h('label', { class: 'chamfer-box pair-box' }, h('span', {}, 'V switches'), this.pairSel);
    this.routeStrip = h('div', { class: 'tool-strip route-strip', role: 'toolbar', 'aria-label': 'Routing options', hidden: true },
      stripLabel('Route', 'route'), stripSep(), h('span', { class: 'tool-strip-label strip-sub' }, 'Bend'), this.cornerSeg, h('span', { class: 'sep' }), chamfer, this.mitreSeg, h('span', { class: 'sep pair-sep' }), this.pairBox);
    // delete, rotate, flip and lock live on the context strip over the canvas, with what they act on
    return [this.btn.undo, this.btn.redo, h('span', { class: 'sep' }), ...this.cards.buttons(), this.gridCard.button];
  }

  /** The routing mode switcher for the toolbar: Shove (#29, later), Walkaround, Free. */
  modeGroup(later) {
    const tips = {
      shove: 'Shove routing mode (the default): the track goes where you draw it and pushes other nets\' tracks aside, keeping their clearance; they spring back as you pull away. Pads, vias and locked tracks never move: where they\'d have to, the track walks round instead',
      walkaround: 'Walkaround routing mode: the track goes round other nets\' copper at their clearance, the shorter way, and stops at an obstacle with no way round. Nothing existing moves',
      free: 'Free routing mode: tracks go where you draw them; collisions with other nets show in red',
    };
    this.modeBtn = {};
    for (const [id, label] of ROUTE_MODES) {
      this.modeBtn[id] = button({ label, title: tips[id], onClick: () => this.setRouteMode(id) });
      this.modeBtn[id].dataset.mode = id;
      this.modeBtn[id].setAttribute('role', 'radio');
    }
    const g = h('div', { class: 'mode-group', role: 'radiogroup', 'aria-label': 'Routing mode', title: 'Routing mode' }, ...ROUTE_MODES.map(([id]) => this.modeBtn[id]));
    this.setRouteMode(this.routeMode, false);
    return g;
  }

  setRouteMode(id, save = true) {
    if (!ROUTE_MODES.some(([m]) => m === id)) id = 'shove';
    this.routeMode = id;
    if (save) pref.set('boardRouteMode', id);
    for (const [m, b] of Object.entries(this.modeBtn || {})) { b.classList.toggle('active', m === id); b.setAttribute('aria-checked', String(m === id)); }
    if (this.route) { this._routeKey = null; this._routeMove(); }
    if (this.ws) this._hint();
  }

  tools(later) {
    this.toolBtn = {};
    for (const [id, t] of Object.entries(BOARD_TOOLS)) this.toolBtn[id] = button({ icon: t.icon, title: t.title, onClick: () => this.setTool(id) });
    const T = this.toolBtn;
    return [T.select, T.route,
      T.ripup, T.via, T.zone, T.footprint, null,
      T.outline, T.polygon, T.circle, null, T.text, T.gline, T.grect, T.gcircle, null, T.measure, T.origin];
  }

  /** The Layers and Properties cards (floating, dockable; toolbar buttons open them). */
  buildCards() {
    this.stackEl = h('div', { class: 'stack-row' });
    this.layerList = h('div', { class: 'layer-list', role: 'listbox', 'aria-label': 'Layers' });
    this.propsEl = h('div', { class: 'board-props' });
    this.cards = new CardSet('board');
    this.outlineEl = h('div', { class: 'outline-state-row' }); // the Outline's state: board information, always shown
    this.cards.add({ id: 'layers', title: 'Layers', icon: 'layers', body: [this.stackEl, this.layerList, this.outlineEl], tip: 'Layers: the copper stack, which layers show, the active layer, and whether the Outline is closed' });
    // Properties: opened by double-clicking something or right-click → Properties…, for that selection
    this.cards.add({ id: 'props', title: 'Properties', icon: 'sliders', body: [this.propsEl], open: false, toolbar: false, onClose: () => { this._propsFor = null; } }).toggle(false);
    // DRC results: opened by the DRC button, which also runs it (so no card button of its own)
    this.drcEl = h('div', { class: 'drc-body' });
    this.drcCard = this.cards.add({ id: 'drc', title: 'DRC', icon: 'erc', body: [this.drcEl], open: false, toolbar: false, onClose: () => { this.drcFocus = null; this.ws?.view.invalidate(); } });
  }

  layerColor(name) { return this.app.canvasColors('board')[name] || '#888'; }

  renderStack() {
    const n = this.board.stack.copper;
    const seg = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Copper layers' },
      ...[2, 4].map((k) => h('button', { class: 'btn' + (k === n ? ' active' : ''), type: 'button', role: 'radio', 'aria-checked': String(k === n), title: `${k} copper layers`, onClick: () => this.setCopper(k) }, `${k} layers`)));
    const thick = h('select', { class: 'select', title: 'Board thickness', 'aria-label': 'Board thickness' },
      ...BOARD_THICKNESSES.map((t) => h('option', { value: String(t), selected: mm(t) === this.board.stack.thickness }, `${t} mm`)));
    if (!BOARD_THICKNESSES.some((t) => mm(t) === this.board.stack.thickness)) thick.prepend(h('option', { selected: true }, `${fmt(this.board.stack.thickness)} mm`));
    thick.addEventListener('change', () => this.app.edit('Board thickness', (p) => setThickness(p, +thick.value)));
    this.stackEl.replaceChildren(seg, thick);
  }

  renderLayers() {
    const rows = boardLayers(this.board.stack.copper).map(({ name }) => {
      const vis = !this.hidden.has(name);
      const short = name === 'Edge.Cuts' ? 'Edge' : name.replace('.Cu', '').replace('.SilkS', ' silk').replace('.Mask', ' mask').replace('.Paste', ' paste').replace('.CrtYd', ' crt').replace('.Fab', ' fab');
      const eye = h('button', { class: 'mini', type: 'button', title: vis ? `Hide ${name}` : `Show ${name}`, 'aria-label': `${name} visible`, 'aria-pressed': String(vis) }, icon(vis ? 'eye' : 'eyeOff', 16));
      eye.addEventListener('click', (e) => { e.stopPropagation(); this.toggleLayer(name); });
      const row = h('div', { class: 'll-row' + (name === this.activeLayer ? ' on' : '') + (vis ? '' : ' off'), role: 'option', 'aria-selected': String(name === this.activeLayer), title: `${LAYER_HELP[name]}. Click to make it the active layer; colours are in Settings → Colours`, dataset: { layer: name } },
        h('span', { class: 'll-chip', style: { background: this.layerColor(name) } }, short),
        h('span', { class: 'll-name' }, name), eye);
      row.addEventListener('click', () => this.setActiveLayer(name));
      return row;
    });
    const all = h('div', { class: 'layer-actions' },
      button({ label: 'Show all', cls: 'btn-ghost', title: 'Show every layer', onClick: () => this.showLayers('all') }),
      button({ label: 'Only active', cls: 'btn-ghost', title: 'Hide every layer but the active one and Edge.Cuts', onClick: () => this.showLayers('active') }));
    this.layerList.replaceChildren(...rows, all);
  }

  /** Whether the Outline is closed, its size, pieces and cut-outs, or what's wrong with it. */
  renderOutlineState() {
    if (!this.outlineEl) return;
    const outline = this.board.outline;
    const c = checkOutline(outline), b = outlineBounds(outline), ok = c.closed;
    this.outlineEl.replaceChildren(h('div', { class: 'outline-state ' + (ok ? 'ok' : 'bad'), role: 'status' },
      icon(ok ? 'check' : 'info', 16),
      h('span', {}, ok ? `Outline closed · ${fmt(b.x1 - b.x0)} × ${fmt(b.y1 - b.y0)} mm${c.pieces > 1 ? ` · ${c.pieces} separate pieces` : ''}${c.cutouts ? ` · ${c.cutouts} cut-out${c.cutouts > 1 ? 's' : ''}` : ''}` : c.problems.join(' '))));
  }

  renderProps() {
    const el = this.propsEl;
    if (!el) return;
    const outline = this.board.outline;
    const sel = [...this.selection].map((i) => outline[i]).filter(Boolean);
    const field = (label, value, onSet, extra = {}) => {
      const input = h('input', { class: 'input', type: 'number', step: '0.1', min: extra.min ?? '0', value: String(value), 'aria-label': label });
      input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') input.blur(); });
      input.addEventListener('change', () => { const v = parseFloat(input.value); if (Number.isFinite(v)) onSet(v); });
      return h('label', { class: 'le-row' }, h('span', {}, label), input, h('em', {}, 'mm'));
    };
    const parts = [];
    const fps = this.board.footprints.filter((f) => this.fpSel.has(f.id));
    const zs = (this.board.zones || []).filter((z) => this.zoneSel.has(z.id));
    if (zs.length === 1) parts.push(...this.zoneProps(zs[0]));
    else if (zs.length > 1) parts.push(h('div', { class: 'prop-title' }, `${zs.length} zones`), h('p', { class: 'side-note' }, 'Drag to move them; Del deletes.'));
    if (this.trackSel.size) parts.push(...this.copperProps());
    if (this.drawSel.size) parts.push(...this.drawingProps());
    if (fps.length === 1 && !sel.length) parts.push(...this.footprintProps(fps[0]));
    else if (fps.length > 1) parts.push(h('div', { class: 'prop-title' }, `${fps.length} footprints${sel.length ? ` and ${sel.length} outline shape${sel.length === 1 ? '' : 's'}` : ''}`),
      h('p', { class: 'side-note' }, 'R rotates them 90° about their middle, F flips them to the other side, L locks them. Drag to move.'));
    if (sel.length === 1) {
      const s = sel[0], i = [...this.selection][0];
      const label = { rect: 'Rectangle', circle: 'Circle', line: 'Line', arc: 'Arc' }[s.type] || s.type;
      parts.push(h('div', { class: 'prop-title' }, `${label} on Edge.Cuts`));
      if (s.type === 'rect') {
        const w = Math.abs(s.b[0] - s.a[0]), ht = Math.abs(s.b[1] - s.a[1]);
        parts.push(field('Width', fmt(w), (v) => this.edit('Resize outline', (o) => { const r = o[i]; r.b = [Math.min(r.a[0], r.b[0]) + mm(v), r.b[1]]; r.a = [Math.min(r.a[0], r.b[0]), r.a[1]]; })),
          field('Height', fmt(ht), (v) => this.edit('Resize outline', (o) => { const r = o[i]; r.b = [r.b[0], Math.min(r.a[1], r.b[1]) + mm(v)]; r.a = [r.a[0], Math.min(r.a[1], r.b[1])]; })));
      } else if (s.type === 'circle') {
        parts.push(field('Diameter', fmt(s.r * 2), (v) => this.edit('Resize outline', (o) => { o[i].r = Math.round(mm(v) / 2); })));
      } else {
        const e = s.type === 'arc' ? [s.start, s.end] : [s.pts[0], s.pts[s.pts.length - 1]];
        parts.push(h('p', { class: 'side-note' }, `From ${this.rel(e[0])} to ${this.rel(e[1])} mm`));
      }
    } else if (sel.length > 1) parts.push(h('div', { class: 'prop-title' }, `${sel.length} outline shapes`));
    el.replaceChildren(...parts);
  }

  /** PROPERTIES for the selected Board drawings (#66): layer, text, size, angle, pen width and fill. */
  drawingProps() {
    const ds = (this.board.drawings || []).filter((d) => this.drawSel.has(d.id));
    if (ds.length !== 1) return [h('div', { class: 'prop-title' }, `${ds.length} drawings`), h('p', { class: 'side-note' }, 'Drag to move; R rotates them about their middle, F flips them to the other side; Del deletes.')];
    const d = ds[0];
    const stopKeys = (el) => { el.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' && el.tagName === 'INPUT') el.blur(); }); return el; };
    const num = (label, value, unit, onSet, step = '0.05', min = '0') => {
      const i = stopKeys(h('input', { class: 'input', type: 'number', step, min, value: String(value), 'aria-label': label }));
      i.addEventListener('change', () => { const v = parseFloat(i.value); if (Number.isFinite(v)) onSet(v); });
      return h('label', { class: 'le-row' }, h('span', {}, label), i, h('em', {}, unit));
    };
    const layer = stopKeys(h('select', { class: 'select', 'aria-label': 'Layer' }, ...drawingLayers(this.board.stack.copper).map((l) => h('option', { value: l }, l))));
    layer.value = d.layer;
    layer.addEventListener('change', () => this.editDrawing(d.id, `Drawing to ${layer.value}`, (q) => { q.layer = layer.value; }));
    const out = [h('div', { class: 'prop-title' }, `${DRAW_KIND[d.type] || 'Drawing'} on ${d.layer}`), h('label', { class: 'le-row' }, h('span', {}, 'Layer'), layer)];
    if (d.type === 'text') {
      const t = stopKeys(h('input', { class: 'input', type: 'text', value: d.text, 'aria-label': 'Text' }));
      t.addEventListener('change', () => { if (t.value.trim()) this.editDrawing(d.id, 'Edit text', (q) => { q.text = t.value.trim(); }); });
      out.push(h('label', { class: 'le-row' }, h('span', {}, 'Text'), t),
        num('Size', fmt(d.size), 'mm', (v) => this.editDrawing(d.id, 'Text size', (q) => { q.size = mm(Math.max(0.1, v)); }), '0.1', '0.1'),
        num('Angle', +(d.rot || 0).toFixed(2), '°', (v) => this.editDrawing(d.id, 'Text angle', (q) => { q.rot = ((v % 360) + 360) % 360; }), '1', '-360'),
        h('p', { class: 'side-note' }, `In the board's ${this.board.textFont === 'vector' ? 'Eagle vector' : 'stroke'} font (Board setup → Text)${/^B\./.test(d.layer) ? '; mirrored, as it reads from the back' : ''}.`));
    } else {
      out.push(num('Width', fmt(d.width ?? defaultWidth(d.layer)), 'mm', (v) => this.editDrawing(d.id, 'Pen width', (q) => { q.width = mm(Math.max(0, v)); })));
      if (d.type === 'rect' || d.type === 'circle' || d.type === 'poly') {
        const f = h('input', { type: 'checkbox', checked: d.fill === 'outline', 'aria-label': 'Filled' });
        f.addEventListener('change', () => this.editDrawing(d.id, f.checked ? 'Fill' : 'Unfill', (q) => { if (f.checked) q.fill = 'outline'; else delete q.fill; }));
        out.push(h('label', { class: 'check-row' }, f, 'Filled'));
      }
      if (d.type === 'rect') out.push(h('p', { class: 'side-note' }, `${fmt(Math.abs(d.b[0] - d.a[0]))} × ${fmt(Math.abs(d.b[1] - d.a[1]))} mm`));
      if (d.type === 'circle') out.push(num('Diameter', fmt(d.r * 2), 'mm', (v) => this.editDrawing(d.id, 'Circle size', (q) => { q.r = Math.round(mm(Math.max(0.01, v)) / 2); })));
    }
    if (/\.Cu$/.test(d.layer)) out.push(h('p', { class: 'side-note' }, 'On copper: no net. Zones pour round it and DRC keeps other copper clear of it.'));
    return out;
  }

  /** PROPERTIES for selected Tracks and Vias: width and layer, drill and diameter; the whole connection (U). */
  copperProps() {
    const tracks = this.board.tracks.filter((t) => this.trackSel.has(t.id)), vias = this.board.vias.filter((v) => this.trackSel.has(v.id));
    const stop = (el) => { el.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' && el.tagName === 'INPUT') el.blur(); }); return el; };
    const row = (label, el, unit = '') => h('label', { class: 'le-row' }, h('span', {}, label), el, h('em', {}, unit));
    const one = (xs, k) => (xs.length && xs.every((x) => x[k] === xs[0][k]) ? xs[0][k] : null);
    const num = (label, value, onSet) => {
      const i = stop(h('input', { class: 'input', type: 'number', step: '0.01', min: '0.01', value: value == null ? '' : fmt(value), placeholder: value == null ? 'mixed' : '', 'aria-label': label }));
      i.addEventListener('change', () => { const v = parseFloat(i.value); if (Number.isFinite(v) && v > 0) { try { onSet(mm(v)); } catch (e) { toast(e.message, 'error', 3000); } } });
      return row(label, i, 'mm');
    };
    const nets = [...new Set([...tracks, ...vias].map((x) => x.net || '(no net)'))];
    const len = tracks.reduce((a, t) => a + trackLength(t), 0);
    const arcs = tracks.filter((t) => t.mid).map(trackArc).filter(Boolean);
    const out = [h('div', { class: 'prop-title' }, [tracks.length ? `${tracks.length} track${tracks.length === 1 ? '' : 's'}` : '', vias.length ? `${vias.length} via${vias.length === 1 ? '' : 's'}` : ''].filter(Boolean).join(', ')),
      h('p', { class: 'side-note' }, `Net ${nets.map((n) => (n === '(no net)' ? n : `${n} (${netClassOf(this.board, n)} class)`)).join(', ')}${tracks.length ? ` · ${fmt(Math.round(len))} mm long` : ''}${arcs.length ? ` · ${arcs.length === tracks.length && arcs.length === 1 ? 'an arc' : `${arcs.length} arc${arcs.length === 1 ? '' : 's'}`}${arcs.length === 1 ? `, radius ${fmt(Math.round(arcs[0].r))} mm` : ''}` : ''}`)];
    if (tracks.length) {
      const ids = tracks.map((t) => t.id);
      out.push(num('Width', one(tracks, 'width'), (w) => this.app.edit('Track width', (p) => setTrackWidth(p, ids, w))));
      const layer = stop(h('select', { class: 'select', 'aria-label': 'Track layer' }, ...copperLayerNames(this.board.stack.copper).map((l) => h('option', { value: l }, l))));
      if (!one(tracks, 'layer')) layer.prepend(h('option', { value: '', disabled: true }, 'Mixed'));
      layer.value = one(tracks, 'layer') || '';
      layer.addEventListener('change', () => this.app.edit(`Tracks to ${layer.value}`, (p) => setTrackLayer(p, ids, layer.value)));
      out.push(row('Layer', layer));
    }
    if (vias.length) {
      const ids = vias.map((v) => v.id);
      out.push(num('Via drill', one(vias, 'drill'), (d) => this.app.edit('Via drill', (p) => setViaSize(p, ids, { drill: d }))),
        num('Via diameter', one(vias, 'diameter'), (d) => this.app.edit('Via diameter', (p) => setViaSize(p, ids, { diameter: d }))));
      const open = vias.filter((v) => v.tented === false).length;
      const tent = stop(h('input', { type: 'checkbox', 'aria-label': 'Tented', title: 'Covered by solder mask. Untick to open the mask round the via (a test point)' }));
      tent.checked = !open; tent.indeterminate = open > 0 && open < vias.length;
      tent.addEventListener('change', () => this.app.edit(tent.checked ? 'Tent vias' : 'Open vias in the mask', (p) => { for (const v of p.board.vias) if (ids.includes(v.id)) { if (tent.checked) delete v.tented; else v.tented = false; } }));
      out.push(row('Tented', tent));
    }
    // locked copper (#29): routing and dragging never shove it
    {
      const all = [...tracks, ...vias], ids = new Set(all.map((x) => x.id)), n = all.filter((x) => x.locked).length;
      const lock = stop(h('input', { type: 'checkbox', 'aria-label': 'Locked', title: 'Locked copper is never pushed aside by shove routing or dragging' }));
      lock.checked = n === all.length; lock.indeterminate = n > 0 && n < all.length;
      lock.addEventListener('change', () => this.app.edit(lock.checked ? 'Lock copper' : 'Unlock copper', (p) => { for (const x of [...p.board.tracks, ...p.board.vias]) if (ids.has(x.id)) { if (lock.checked) x.locked = true; else delete x.locked; } }));
      out.push(row('Locked', lock));
    }
    out.push(h('div', { class: 'layer-actions' },
      button({ label: 'Whole connection (U)', cls: 'btn-ghost', title: 'Select every track and via joined to these', onClick: () => this.selectConnection() }),
      button({ label: 'Delete', icon: 'trash', cls: 'btn-ghost', title: 'Delete (Del)', onClick: () => this.deleteSelection() })));
    return out;
  }

  /** PROPERTIES for one Zone: Net, layer, priority, clearance, how pads connect, and how its fill went. */
  zoneProps(z) {
    const stop = (el) => { el.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' && el.tagName === 'INPUT') el.blur(); }); return el; };
    const row = (label, el, unit = '') => h('label', { class: 'le-row' }, h('span', {}, label), el, h('em', {}, unit));
    const set = (label, fn) => this.app.edit(label, (p) => fn(p.board.zones.find((q) => q.id === z.id)));
    const num = (label, value, onSet, { step = '0.05', min = '0', unit = 'mm', int = false } = {}) => {
      const i = stop(h('input', { class: 'input', type: 'number', step: int ? '1' : step, min, value: int ? String(value) : fmt(value), 'aria-label': label }));
      i.addEventListener('change', () => { const v = parseFloat(i.value); if (Number.isFinite(v) && v >= +min) onSet(int ? Math.round(v) : mm(v)); });
      return row(label, i, int ? '' : unit);
    };
    const nets = [...new Set([...padNets(this.board).values()].filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (z.net && !nets.some((n) => n.toLowerCase() === z.net.toLowerCase())) nets.unshift(z.net);
    const net = stop(h('select', { class: 'select', 'aria-label': 'Zone net' }, h('option', { value: '' }, '(no net)'), ...nets.map((n) => h('option', { value: n }, n))));
    net.value = nets.find((n) => n.toLowerCase() === (z.net || '').toLowerCase()) || '';
    net.addEventListener('change', () => set(`Zone net ${net.value || '(none)'}`, (q) => { q.net = net.value; }));
    const layer = stop(h('select', { class: 'select', 'aria-label': 'Zone layer' }, ...copperLayerNames(this.board.stack.copper).map((l) => h('option', { value: l }, l))));
    layer.value = z.layer;
    layer.addEventListener('change', () => set(`Zone to ${layer.value}`, (q) => { q.layer = layer.value; }));
    const solid = z.connect === 'solid';
    const conn = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Pad connection' },
      ...[['thermal', 'Thermal', 'Same-net pads join through thermal reliefs: a gap crossed by spokes (easier to solder)'], ['solid', 'Solid', 'Same-net pads are joined solid']].map(([id, label, tip]) => h('button', { class: 'btn' + ((solid ? 'solid' : 'thermal') === id ? ' active' : ''), type: 'button', role: 'radio', 'aria-checked': String((solid ? 'solid' : 'thermal') === id), title: tip, dataset: { connect: id }, onClick: () => set(`Pads ${label.toLowerCase()}`, (q) => { q.connect = id; }) }, label)));
    const f = this.zoneFiller.fills.get(z.id), pending = this.zoneFiller.pending.has(z.id);
    const th = f?.thermals || [];
    const state = pending || !f ? 'Filling…'
      : !f.polys.length ? (z.net ? `Empty: nothing of ${z.net} in it to connect to${f.islands ? ` (${f.islands} island${f.islands === 1 ? '' : 's'} removed)` : ''}.` : 'Empty.')
        : `${f.polys.length} piece${f.polys.length === 1 ? '' : 's'}${f.islands ? ` · ${f.islands} island${f.islands === 1 ? '' : 's'} removed` : ''}${th.length ? ` · ${th.length} thermal relief${th.length === 1 ? '' : 's'}${th.some((t) => t.spokes < 2) ? ` (${th.filter((t) => t.spokes < 2).length} with fewer than 2 spokes)` : ''}` : ''}`;
    return [
      h('div', { class: 'prop-title' }, `Zone on ${z.layer}`),
      row('Net', net), row('Layer', layer),
      num('Priority', z.priority, (v) => set('Zone priority', (q) => { q.priority = v; }), { int: true }),
      num('Clearance', z.clearance, (v) => set('Zone clearance', (q) => { q.clearance = v; })),
      num('Min width', z.minWidth || 0, (v) => set('Zone minimum width', (q) => { if (v > 0) q.minWidth = v; else delete q.minWidth; })),
      h('p', { class: 'side-note' }, `The larger of this and the net classes' clearance (${fmt(this.board.rules.clearance)} mm by default) is kept from other nets. Higher priority fills first and wins overlaps.`),
      row('Pads', conn),
      ...(solid ? [] : [
        num('Thermal gap', z.thermal.gap, (v) => set('Thermal gap', (q) => { q.thermal = { ...q.thermal, gap: v }; }), { min: '0.01' }),
        num('Spoke width', z.thermal.spoke, (v) => set('Spoke width', (q) => { q.thermal = { ...q.thermal, spoke: v }; }), { min: '0.01' })]),
      h('div', { class: 'outline-state ' + (pending || !f ? '' : f.polys.length ? 'ok' : 'bad'), role: 'status' }, icon(pending || !f ? 'info' : f.polys.length ? 'check' : 'info', 16), h('span', {}, state)),
      h('div', { class: 'layer-actions' }, button({ label: 'Delete', icon: 'trash', cls: 'btn-ghost', title: 'Delete the zone (Del)', onClick: () => this.deleteSelection() })),
    ];
  }

  /**
   * PROPERTIES for one Footprint: its Component's Reference, Value, MPN and Footprint (a swap is
   * live, ADR-0008), then position, rotation, side and lock. Each change is one undo step.
   */
  footprintProps(bf) {
    if (!bf.componentId) return this.boardOnlyProps(bf);
    const comp = this.project.components[bf.componentId];
    if (!comp) return [h('p', { class: 'side-note' }, 'This Footprint\'s part is no longer on the Schematic: Update from Schematic (F8) removes it.')];
    const stop = (el) => { el.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' && el.tagName === 'INPUT') el.blur(); }); return el; };
    const row = (label, el, unit = '') => h('label', { class: 'le-row' }, h('span', {}, label), el, h('em', {}, unit));
    const err = h('div', { class: 'insp-error' });
    const text = (label, value, onSet) => {
      const i = stop(h('input', { class: 'input', type: 'text', value: value ?? '', 'aria-label': label, spellcheck: false }));
      i.addEventListener('change', () => { const m = onSet(i.value); err.textContent = typeof m === 'string' ? m : ''; });
      return row(label, i);
    };
    const num = (label, value, onSet, unit = 'mm', step = '0.1') => {
      const i = stop(h('input', { class: 'input', type: 'number', step, value: String(value), 'aria-label': label, disabled: bf.locked }));
      i.addEventListener('change', () => { const v = parseFloat(i.value); if (Number.isFinite(v)) onSet(v); });
      return row(label, i, unit);
    };
    const ann = this.board.annotation?.components?.[comp.id];
    // Reference and Value edit the Component (so the Schematic too) and the Board's record together
    const setComp = (label, patch) => {
      try {
        this.app.edit(label, (p) => {
          updateComponent(p, comp.id, patch);
          const rec = p.board.annotation?.components?.[comp.id];
          if (rec) { if ('ref' in patch) rec.ref = p.components[comp.id].ref; if ('value' in patch) rec.value = p.components[comp.id].value; }
        });
        return null;
      } catch (e) { return e.message; }
    };
    const ch = footprintChoices(this.project, comp, [...STARTER_LIBRARY, ...this.app.userParts()], [...this.app.libraries.flatMap((l) => Object.values(l.footprints || {})), ...(this._allFp ||= allFootprints())]);
    const fpSel = stop(h('select', { class: 'select', 'aria-label': 'Footprint', title: 'Swapping keeps the position, rotation and side; the Schematic sees it at once' },
      ch.preferred.length ? h('optgroup', { label: 'Preferred' }, ...ch.preferred.map((c) => h('option', { value: c.key }, c.label))) : null,
      ch.other.length ? h('optgroup', { label: 'Other footprints (pins map by number)' }, ...ch.other.map((c) => h('option', { value: c.key }, c.label))) : null));
    fpSel.value = footprintKey(this.project, comp);
    fpSel.addEventListener('change', () => {
      const c = [...ch.preferred, ...ch.other].find((x) => x.key === fpSel.value);
      if (c) setComp(`${comp.ref} footprint`, { footprint: c.value });
    });
    const side = stop(h('select', { class: 'select', 'aria-label': 'Side', disabled: bf.locked }, h('option', { value: 'F' }, 'Front (top)'), h('option', { value: 'B' }, 'Back (bottom)')));
    side.value = bf.side;
    side.addEventListener('change', () => { if (side.value !== bf.side) this.app.edit(`Flip ${comp.ref}`, (p) => flipFootprints(p, [bf.id])); });
    const lock = h('input', { type: 'checkbox', checked: !!bf.locked, 'aria-label': 'Locked' });
    lock.addEventListener('change', () => this.app.edit(`${lock.checked ? 'Lock' : 'Unlock'} ${comp.ref}`, (p) => setLocked(p, [bf.id], lock.checked)));
    const o = this.board.origin;
    const mpn = comp.mpn || {};
    return [
      h('div', { class: 'prop-title' }, `${comp.ref} · ${this.project.parts[comp.partId]?.name || 'Footprint'}`),
      text('Reference', comp.ref, (v) => { const m = validateRef(this.project, comp.id, v); return m || setComp(`Rename ${comp.ref}`, { ref: v }); }),
      text('Value', comp.value, (v) => setComp(`${comp.ref} value`, { value: v })),
      text('MPN', mpn.number || '', (v) => setComp(`${comp.ref} MPN`, { mpn: { manufacturer: mpn.manufacturer || '', number: v } })),
      row('Footprint', fpSel),
      err,
      num('X', +((bf.at[0] - o[0]) / 1e6).toFixed(4), (v) => this.app.edit(`Move ${comp.ref}`, (p) => { const f = p.board.footprints.find((x) => x.id === bf.id); if (!f.locked) f.at = [Math.round(v * 1e6) + o[0], f.at[1]]; })),
      num('Y', +((bf.at[1] - o[1]) / 1e6).toFixed(4), (v) => this.app.edit(`Move ${comp.ref}`, (p) => { const f = p.board.footprints.find((x) => x.id === bf.id); if (!f.locked) f.at = [f.at[0], Math.round(v * 1e6) + o[1]]; })),
      num('Rotation', bf.rot, (v) => this.app.edit(`Rotate ${comp.ref}`, (p) => setFootprintRotation(p, bf.id, v)), '°', '0.01'),
      row('Side', side),
      h('label', { class: 'check-row' }, lock, 'Locked (can\'t be moved, turned or flipped)'),
      ann && (ann.ref !== comp.ref || ann.value !== comp.value) ? h('p', { class: 'side-note' }, 'The Schematic has changes for this part: Update from Schematic (F8).') : null,
      ...this.fieldTextProps(bf),
    ].filter(Boolean);
  }

  /**
   * PROPERTIES for a board-only Footprint (#74): its Reference and Value, footprint, each pad's net,
   * In BOM, then position, rotation, side and lock, and its text.
   */
  boardOnlyProps(bf) {
    const stop = (el) => { el.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' && el.tagName === 'INPUT') el.blur(); }); return el; };
    const row = (label, el, unit = '') => h('label', { class: 'le-row' }, h('span', {}, label), el, h('em', {}, unit));
    const err = h('div', { class: 'insp-error' });
    const set = (label, patch) => { try { this.app.edit(label, (p) => setBoardOnly(p, bf.id, patch)); err.textContent = ''; } catch (e) { err.textContent = e.message; } };
    const text = (label, value, onSet) => {
      const i = stop(h('input', { class: 'input', type: 'text', value: value ?? '', 'aria-label': label, spellcheck: false }));
      i.addEventListener('change', () => onSet(i.value));
      return row(label, i);
    };
    const num = (label, value, onSet, unit = 'mm', step = '0.1') => {
      const i = stop(h('input', { class: 'input', type: 'number', step, value: String(value), 'aria-label': label, disabled: bf.locked }));
      i.addEventListener('change', () => { const v = parseFloat(i.value); if (Number.isFinite(v)) onSet(v); });
      return row(label, i, unit);
    };
    const fp = bfFootprint(this.project, bf);
    const nets = [...new Set([...Object.keys(this.board.annotation?.nets || {}), ...this.board.footprints.flatMap((f) => Object.values(f.padNets || {}))])].sort();
    const list = h('datalist', { id: `nets-${bf.id}` }, ...nets.map((n) => h('option', { value: n })));
    const pads = [...new Set((fp?.pads || []).filter((q) => q.layers.some((l) => /Cu$/.test(l))).map((q) => q.number))];
    const padRow = (num) => {
      const i = stop(h('input', { class: 'input', type: 'text', value: bf.padNets?.[num] || '', placeholder: 'no net', list: list.id, 'aria-label': `Pad ${num || '(unnamed)'} net`, spellcheck: false }));
      i.addEventListener('change', () => set(`${bf.ref} pad ${num} net`, { padNet: [num, i.value] }));
      return row(`Pad ${num || '–'}`, i);
    };
    const side = stop(h('select', { class: 'select', 'aria-label': 'Side', disabled: bf.locked }, h('option', { value: 'F' }, 'Front (top)'), h('option', { value: 'B' }, 'Back (bottom)')));
    side.value = bf.side;
    side.addEventListener('change', () => { if (side.value !== bf.side) this.app.edit(`Flip ${bf.ref}`, (p) => flipFootprints(p, [bf.id])); });
    const lock = h('input', { type: 'checkbox', checked: !!bf.locked, 'aria-label': 'Locked' });
    lock.addEventListener('change', () => this.app.edit(`${lock.checked ? 'Lock' : 'Unlock'} ${bf.ref}`, (p) => setLocked(p, [bf.id], lock.checked)));
    const bom = h('input', { type: 'checkbox', checked: !!bf.bom, 'aria-label': 'In BOM' });
    bom.addEventListener('change', () => set(`${bf.ref} ${bom.checked ? 'in' : 'out of'} the BOM`, { bom: bom.checked }));
    const o = this.board.origin;
    return [
      h('div', { class: 'prop-title' }, `${bf.ref} · ${fp?.name || 'Footprint'}`),
      h('p', { class: 'side-note' }, 'On the Board only: no part on the Schematic. Update from Schematic leaves it alone.'),
      text('Reference', bf.ref, (v) => set(`Rename ${bf.ref}`, { ref: v })),
      text('Value', bf.value || '', (v) => set(`${bf.ref} value`, { value: v })),
      err,
      ...(pads.length ? [h('div', { class: 'prop-title' }, 'Pad nets'), list, ...pads.map(padRow)] : []),
      h('label', { class: 'check-row' }, bom, 'In BOM (off for mounting holes, fiducials and logos)'),
      num('X', +((bf.at[0] - o[0]) / 1e6).toFixed(4), (v) => this.app.edit(`Move ${bf.ref}`, (p) => { const f = p.board.footprints.find((x) => x.id === bf.id); if (!f.locked) f.at = [Math.round(v * 1e6) + o[0], f.at[1]]; })),
      num('Y', +((bf.at[1] - o[1]) / 1e6).toFixed(4), (v) => this.app.edit(`Move ${bf.ref}`, (p) => { const f = p.board.footprints.find((x) => x.id === bf.id); if (!f.locked) f.at = [f.at[0], Math.round(v * 1e6) + o[1]]; })),
      num('Rotation', bf.rot, (v) => this.app.edit(`Rotate ${bf.ref}`, (p) => setFootprintRotation(p, bf.id, v)), '°', '0.01'),
      row('Side', side),
      h('label', { class: 'check-row' }, lock, 'Locked (can\'t be moved, turned or flipped)'),
      h('div', { class: 'layer-actions' }, button({ label: 'Delete', icon: 'trash', cls: 'btn-ghost', title: 'Delete it (Del)', onClick: () => this.deleteSelection() })),
      ...this.fieldTextProps(bf),
    ].filter(Boolean);
  }

  /** PROPERTIES rows for a Footprint's Reference and Value text on the board (#65): show, size, layer, angle, reset. */
  fieldTextProps(bf) {
    const fp = bfFootprint(this.project, bf);
    const ref = bfRef(this.project, bf);
    const out = [h('div', { class: 'prop-title' }, 'Reference and Value text')];
    for (const key of FIELD_KEYS) {
      const p = fieldPlacement(fp, bf, key, fieldStrings(this.project, bf)[key], this.board.textFont || 'stroke');
      const set = (label, patch) => this.app.edit(`${ref} ${FIELD_NAME[key].toLowerCase()} ${label}`, (pr) => setFieldOverride(pr, bf.id, key, patch));
      const show = h('input', { type: 'checkbox', checked: !p.hidden, 'aria-label': `Show ${FIELD_NAME[key]}` });
      show.addEventListener('change', () => set(show.checked ? 'shown' : 'hidden', { hidden: !show.checked }));
      const size = h('input', { class: 'input', type: 'number', step: '0.1', min: '0.2', value: String(+(p.size / 1e6).toFixed(3)), 'aria-label': `${FIELD_NAME[key]} size`, style: { width: '64px' } });
      const layer = h('select', { class: 'select', 'aria-label': `${FIELD_NAME[key]} layer` }, ...['F.SilkS', 'F.Fab'].map((l) => h('option', { value: l }, l.replace('F.', bf.side === 'B' ? 'B.' : 'F.'))));
      layer.value = /Fab$/.test(p.layer) ? 'F.Fab' : 'F.SilkS';
      const angle = h('input', { class: 'input', type: 'number', step: '90', value: String(worldRot(bf, p.rot)), 'aria-label': `${FIELD_NAME[key]} angle`, style: { width: '64px' } });
      for (const el of [size, angle]) el.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') el.blur(); });
      size.addEventListener('change', () => { const v = parseFloat(size.value); if (v > 0) set('size', { size: Math.round(v * 1e6) }); });
      layer.addEventListener('change', () => set('layer', { layer: layer.value }));
      angle.addEventListener('change', () => { const v = parseFloat(angle.value); if (Number.isFinite(v)) set('angle', { rot: localRot(bf, v) }); });
      const reset = button({ label: 'Reset', cls: 'btn-ghost btn-xs', title: 'Reset to Footprint: put it back where the Footprint draws it', onClick: () => set('reset', null) });
      reset.disabled = !p.overridden;
      out.push(h('div', { class: 'le-row field-text-row', dataset: { field: key } },
        h('label', { class: 'check-row' }, show, FIELD_NAME[key]), size, h('em', {}, 'mm'), layer, angle, h('em', {}, '°'), reset));
    }
    out.push(h('p', { class: 'side-note' }, 'Drag the text on the board to move it; it moves, turns and flips with the footprint.'));
    return out;
  }

  chips() {
    return [...copperLayerNames(this.board.stack.copper), 'Edge.Cuts'].map((name) => h('button', {
      class: 'chip' + (name === this.activeLayer ? ' on' : ''), type: 'button', title: `${name}: ${LAYER_HELP[name]} (click to make it the active layer)`,
      style: { background: this.layerColor(name) }, dataset: { layer: name }, onClick: () => this.setActiveLayer(name),
    }, name === 'Edge.Cuts' ? 'Edge' : name.replace('.Cu', '')));
  }

  status() {
    const b = outlineBounds(this.board.outline);
    const size = !b ? 'no outline' : checkOutline(this.board.outline).closed ? `${fmt(b.x1 - b.x0)} × ${fmt(b.y1 - b.y0)} mm` : 'outline not closed';
    const un = Object.values(this._rats?.unrouted || {}).reduce((a, b) => a + b, 0);
    return `${this.board.stack.copper}-layer · ${fmt(this.board.stack.thickness)} mm · ${size} · ${this.board.footprints.length} footprints${this.board.footprints.length ? ` · ${un} unrouted` : ''} ${this.board.zones?.length ? ` · ${this.board.zones.length} zone${this.board.zones.length === 1 ? '' : 's'}${this.zoneFiller.busy ? ' (filling…)' : ''}` : ''} · active ${this.activeLayer} · grid ${gridLabel(this.gridStep)}${this.alt ? ' (Alt)' : ''}`;
  }

  // ---------------------------------------------------------------- state

  refresh() {
    const n = this.board.outline.length;
    for (const i of [...this.selection]) if (i >= n) this.selection.delete(i);
    const ids = new Set(this.board.footprints.map((f) => f.id));
    for (const id of [...this.fpSel]) if (!ids.has(id)) this.fpSel.delete(id);
    const tids = new Set([...(this.board.tracks || []), ...(this.board.vias || [])].map((t) => t.id));
    for (const id of [...this.trackSel]) if (!tids.has(id)) this.trackSel.delete(id);
    const zids = new Set((this.board.zones || []).map((z) => z.id));
    for (const id of [...this.zoneSel]) if (!zids.has(id)) this.zoneSel.delete(id);
    const dids = new Set((this.board.drawings || []).map((d) => d.id));
    for (const id of [...this.drawSel]) if (!dids.has(id)) this.drawSel.delete(id);
    // the Properties card belongs to the selection it was opened for
    const pc = this.cards?.card('props');
    if (pc?.isOpen && (!this._propsFor || this._selSig() !== this._propsFor)) { pc.toggle(false); this._propsFor = null; }
    this.zoneFiller.update(this.project);
    this._rats = ratsnest(this.project, this.board, this.zoneFiller.fills);
    this._liveDrc(); // re-check what the edit changed (#85)
    if (!copperLayerNames(this.board.stack.copper).includes(this.activeLayer) && /^In\d/.test(this.activeLayer)) this.activeLayer = 'F.Cu';
    if (this.btn) {
      // while routing, undo takes back the route's last segment (undoStep) and redo waits
      this.btn.undo.disabled = !this.app.history.canUndo && !this.route;
      this.btn.redo.disabled = !this.app.history.canRedo || !!this.route;

    }
    if (this.toolBtn) for (const [id, b] of Object.entries(this.toolBtn)) b.classList.toggle('active', this.tool === id);
    if (this.routeStrip) {
      const wasHidden = this.routeStrip.hidden;
      this.routeStrip.hidden = this.tool !== 'route';
      if (wasHidden && !this.routeStrip.hidden) placeStrip(this.routeStrip, 'board');
      // layer pairs: only a 4-layer board has a choice
      const pairs = layerPairs(this.board.stack.copper), four = this.board.stack.copper === 4;
      this.pairBox.hidden = !four; this.routeStrip.querySelector('.pair-sep').hidden = !four;
      const cur = (this.pair && pairs.some((q) => q.join('|') === this.pair.join('|')) ? this.pair : pairs[0]).join('|');
      if (this.pairSel.options.length !== pairs.length) this.pairSel.replaceChildren(...pairs.map((q) => h('option', { value: q.join('|') }, q.join(' ↔ '))));
      this.pairSel.value = cur;
    }
    if (this.stackEl) { this.renderStack(); this.renderLayers(); this.renderOutlineState(); this.renderProps(); this.renderDrc(); }
    this._updateStrip();
    this._home();
    if (this.ws) { this.ws.view.grid = this.gridStep; this.ws.view.origin = this.board.origin; }
    this.gridCard?.render();
    this.ws?.renderBar();
    this._hint();
    this._publishProbe();
    this.ws?.view.invalidate();
  }

  /** Home fits the board when there is one. */
  _home() {
    if (!this.ws) return;
    const b = outlineBounds(this.board.outline);
    const pad = b ? Math.max(mm(3), (b.x1 - b.x0) * 0.08) : 0;
    this.ws.view.home = b ? { x0: b.x0 - pad, y0: b.y0 - pad, x1: b.x1 + pad, y1: b.y1 + pad } : { x0: -10e6, y0: -10e6, x1: 110e6, y1: 90e6 };
  }

  _hint() {
    if (!this.ws) return;
    const p = this.pts;
    let t;
    switch (this.tool) {
      case 'outline': t = p ? 'Outline rectangle: click the opposite corner · Esc cancel' : `Outline rectangle: click a corner${this.radius ? ` (corners rounded ${fmt(this.radius)} mm)` : ''} · set Corner radius in Properties`; break;
      case 'polygon': t = !p ? 'Outline polygon: click the first corner'
        : this.arcNext ? (p.mid ? 'Arc: click where it ends' : 'Arc: click a point the side passes through · A for a straight side')
          : 'Outline polygon: click the next corner · A arc side · Backspace undo corner · click the first corner to close · Esc cancel'; break;
      case 'circle': t = p ? 'Circle: click a point on the edge' : 'Circle: click the centre (a round board, or a hole inside the board)'; break;
      case 'route': t = this.route
        ? `Routing ${this.route.net} on ${this.route.layer} (${fmt(this.route.width)} mm, ${netClassOf(this.board, this.route.net)} class): click to place a corner · click a ${this.route.net} pad to finish · V drops a via and goes to ${this.route.layer === this.route.pair[0] ? this.route.pair[1] : this.route.pair[0]} · double-click or Enter ends here · right-click or / changes the bend (${this.bend}: ${bendOf(this.bend).name}) · Backspace or Ctrl+Z undoes a segment · Esc cancels${this.routeView?.collisions.length ? ' · red: too close to another net' : ''}${this.routeView?.blocked ? ' · no clear way to the pointer: the track stops at the obstacle' : ''}`
        : `Route (${this.routeMode === 'shove' ? 'Shove: tracks push other nets\' tracks aside' : this.routeMode === 'walkaround' ? 'Walkaround: tracks go round other nets' : 'Free: tracks go where you draw'}): click a pad on ${this.activeLayer} to start a track (bend ${this.bend}: ${bendOf(this.bend).name}${this.chamfer ? `, ${this.mitre === 'round' ? 'rounded' : 'chamfered'} ${fmt(this.chamfer)} mm` : ''})`; break;
      case 'ripup': t = 'Rip up: click a track or via to take its run (pad to pad) back to an airwire · Shift+click: just that segment · drag a box: every track and via in it (left to right: wholly inside; right to left: touching)'; break;
      case 'zone': t = !p ? `Zone on ${this.activeLayer}: click its first corner (the net comes from the pad or track there, else GND; change it in Properties)`
        : `Zone on ${this.activeLayer}: click the next corner · click the first corner, double-click or Enter to close · Backspace undo corner · Esc cancel`; break;
      case 'via': t = 'Via: click to place a through via (F.Cu to B.Cu); it takes the net of the track or pad it lands on · Esc back to Select'; break;
      case 'origin': t = 'Grid origin: click where the grid, rulers and coordinates should measure from (outline corners attract it) · Esc back to Select'; break;
      case 'text': t = `Text on ${this.drawLayer}: click to place "${String(this.drawText || '').trim() || 'TEXT'}" (set the text, size and layer in the strip) · Esc back to Select`; break;
      case 'gline': t = this.pts?.line ? `Line on ${this.drawLayer}: click the next point · double-click or Enter to finish · Backspace undo point · Esc cancel` : `Line on ${this.drawLayer}: click the first point`; break;
      case 'grect': t = this.pts ? 'Rectangle: click the opposite corner · Esc cancel' : `Rectangle on ${this.drawLayer}: click a corner`; break;
      case 'gcircle': t = this.pts ? 'Circle: click a point on the edge · Esc cancel' : `Circle on ${this.drawLayer}: click the centre`; break;
      case 'measure': t = this.measure && !this.measure.done ? 'Measure: click the second point' : 'Measure: click two points · Esc to stop'; break;
      default: t = this.drawSel.size
        ? `${this.drawSel.size === 1 ? 'Drawing' : `${this.drawSel.size} drawings`} selected · drag to move${this._selDrawing() ? ', a handle to reshape' : ''} · R rotate (Shift+R back) · F flip to the other side · Del delete · arrows nudge · text, size, layer and width in Properties`
        : this.zoneSel.size
        ? `${this.zoneSel.size === 1 ? 'Zone' : `${this.zoneSel.size} zones`} selected · drag a corner to reshape, the zone to move · Del deletes · arrows nudge · net, priority, clearance and thermal reliefs in Properties · it refills by itself after each change`
        : this.trackSel.size
        ? `${this.trackSel.size} track${this.trackSel.size === 1 ? '' : 's'} or via${this.trackSel.size === 1 ? '' : 's'} selected · U selects the whole connection · Del deletes · width, layer and via size in Properties`
        : this.fpSel.size
        ? `${this.fpSel.size === 1 ? 'Footprint' : `${this.fpSel.size} footprints`} selected · drag to move (the origin snaps to the grid) · R rotate 90° (Shift+R back) · F flip to the other side · L lock · arrows nudge · exact angle and Footprint in Properties`
        : this.board.outline.length
        ? (this.selection.size === 1 ? 'Drag a handle to resize (a side handle moves that side; corners stay round) · drag the shape to move · Del delete · arrows nudge one grid step · hold Alt for the Alt grid'
          : 'Click an outline shape to select it, drag to move · Del delete · arrows nudge one grid step · B, P, C draw more outline · hold Alt for the Alt grid')
        : 'No board yet: draw the Outline with B (rectangle), P (polygon) or C (round), then Update from Schematic (F8) to bring the Components over.';
    }
    this.ws.hint.textContent = t;
  }

  setTool(t) {
    if (!BOARD_TOOLS[t]) return;
    if (this.route && t !== 'route') this.finishRoute();
    if (t === 'route' && !copperLayerNames(this.board.stack.copper).includes(this.activeLayer)) this.activeLayer = 'F.Cu';
    this.tool = t; this.pts = null; this.arcNext = false; this.measure = null; this.ripHover = null; this.marquee = null;
    if (t !== 'select') { this.selection.clear(); this.fpSel.clear(); this.netSel.clear(); this.trackSel.clear(); this.zoneSel.clear(); this.drawSel.clear(); }
    if (t === 'zone' && !copperLayerNames(this.board.stack.copper).includes(this.activeLayer)) this.activeLayer = 'F.Cu'; // zones are copper
    if (['outline', 'polygon', 'circle'].includes(t)) this.activeLayer = 'Edge.Cuts'; // the Outline lives on Edge.Cuts
    if (['text', 'gline', 'grect', 'gcircle'].includes(t) && this.hidden.delete(this.drawLayer)) pref.set('boardHidden', [...this.hidden]); // see what you draw
    if (this.ws) this.ws.view.canvas.style.cursor = t === 'select' ? '' : 'crosshair';
    if (t !== 'footprint') this.placingFp = null;
    else if (!this.placingFp) setTimeout(() => this.chooseBoardFootprint(), 0);
    this.refresh();
  }

  /** The Place footprint tool's picker (#74): search the footprint libraries; the choice is placed on the next click. */
  chooseBoardFootprint() {
    document.querySelectorAll('.fp-search-pop').forEach((x) => x.remove());
    const input = h('input', { class: 'input', type: 'search', placeholder: 'Search footprints, e.g. MountingHole or Fiducial', 'aria-label': 'Search footprints', spellcheck: false });
    const list = h('div', { class: 'fp-search-list', role: 'listbox' });
    const pop = h('div', { class: 'fp-search-pop menu board-fp-pick' }, input, list);
    const close = () => { pop.remove(); document.removeEventListener('pointerdown', outside, true); if (!this.placingFp && this.tool === 'footprint') this.setTool('select'); };
    const outside = (e) => { if (!pop.contains(e.target)) close(); };
    const lib = [...this.app.libraries.flatMap((l) => Object.values(l.footprints || {}).map((f) => ({ f, library: l.name }))), ...(this._allFp ||= allFootprints()).map((f) => ({ f, library: 'builtin' }))];
    const render = () => {
      const words = input.value.toLowerCase().split(/\s+/).filter(Boolean);
      const found = lib.filter(({ f }) => words.every((w) => f.name.toLowerCase().includes(w))).slice(0, 80);
      list.replaceChildren(...found.map(({ f, library }) => {
        const b = h('button', { class: 'menu-item', type: 'button', role: 'option' }, h('span', { class: 'menu-label' }, f.name), library !== 'builtin' ? h('span', { class: 'menu-key' }, library) : '');
        b.addEventListener('click', () => { this.placingFp = { library, footprint: f }; close(); this.refresh(); });
        return b;
      }), found.length ? '' : h('div', { class: 'side-empty' }, 'No footprints match.'));
    };
    input.addEventListener('input', render);
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') close(); if (e.key === 'Enter') list.querySelector('.menu-item')?.click(); });
    document.body.append(pop);
    const r = (this.toolBtn?.footprint || document.body).getBoundingClientRect();
    Object.assign(pop.style, { left: `${Math.max(8, r.right + 8)}px`, top: `${Math.max(8, Math.min(r.top, window.innerHeight - 360))}px` });
    render();
    input.focus();
    setTimeout(() => document.addEventListener('pointerdown', outside, true));
  }

  setActiveLayer(name) {
    this.activeLayer = name;
    if (this.hidden.delete(name)) pref.set('boardHidden', [...this.hidden]); // the active layer is always shown
    this.refresh();
  }

  toggleLayer(name) {
    if (this.hidden.has(name)) this.hidden.delete(name); else this.hidden.add(name);
    pref.set('boardHidden', [...this.hidden]);
    this.refresh();
  }

  showLayers(which) {
    this.hidden = which === 'all' ? new Set() : new Set(boardLayers(4).map((l) => l.name).filter((n) => n !== this.activeLayer && n !== 'Edge.Cuts'));
    pref.set('boardHidden', [...this.hidden]);
    this.refresh();
  }

  setCopper(n) {
    if (n === this.board.stack.copper) return;
    try { this.app.edit(`${n}-layer board`, (p) => setCopperLayers(p, n)); } catch (e) { toast(e.message, 'error', 4000); }
  }

  /** One undoable edit of the Outline. */
  edit(label, fn) { this.app.edit(label, (p) => fn(p.board.outline, p)); }

  addOutline(label, shapes) {
    const start = this.board.outline.length;
    this.edit(label, (o) => o.push(...shapes));
    this.selection = new Set(shapes.map((_, k) => start + k));
    this.refresh();
  }

  deleteSelection() {
    if (this.drawSel.size) {
      const del = new Set(this.drawSel); this.drawSel.clear();
      this.app.edit(del.size === 1 ? 'Delete drawing' : `Delete ${del.size} drawings`, (p) => { p.board.drawings = (p.board.drawings || []).filter((d) => !del.has(d.id)); pruneApprovals(p); });
      if (!this.selection.size && !this.zoneSel.size && !this.trackSel.size) return;
    }
    if (this.zoneSel.size) {
      const del = new Set(this.zoneSel); this.zoneSel.clear();
      this.app.edit(del.size === 1 ? 'Delete zone' : `Delete ${del.size} zones`, (p) => { p.board.zones = p.board.zones.filter((z) => !del.has(z.id)); pruneApprovals(p); });
      return;
    }
    if (this.trackSel.size) {
      const del = new Set(this.trackSel); this.trackSel.clear();
      this.app.edit(del.size === 1 ? 'Delete track' : `Delete ${del.size} tracks and vias`, (p) => { p.board.tracks = p.board.tracks.filter((t) => !del.has(t.id)); p.board.vias = p.board.vias.filter((v) => !del.has(v.id)); pruneApprovals(p); });
      return;
    }
    // board-only Footprints (#74) are deleted here; the Schematic's come and go with it
    const only = this.board.footprints.filter((f) => this.fpSel.has(f.id) && !f.componentId).map((f) => f.id);
    if (only.length) {
      this.app.edit(only.length === 1 ? `Delete ${bfRef(this.project, this.board.footprints.find((f) => f.id === only[0]))}` : `Delete ${only.length} footprints`, (p) => { deleteBoardOnly(p, only); pruneApprovals(p); });
      for (const id of only) this.fpSel.delete(id);
      if (!this.fpSel.size) { this.refresh(); return; }
    }
    if (this.fpSel.size && !this.selection.size) { toast('Footprints of Schematic parts come from the Schematic: delete the part there, then Update from Schematic (F8).', 'info', 3500); return; }
    if (!this.selection.size) return;
    const del = new Set(this.selection);
    this.selection.clear();
    this.edit(del.size === 1 ? 'Delete outline shape' : 'Delete outline shapes', (o, p) => { p.board.outline = o.filter((_, i) => !del.has(i)); });
  }

  nudge(dx, dy) {
    const sel = [...this.selection], fps = [...this.fpSel], zs = new Set(this.zoneSel), ds = new Set(this.drawSel), cu = new Set(this.trackSel);
    const kinds = [sel.length, fps.length, zs.size, ds.size, cu.size].filter(Boolean).length;
    const label = kinds > 1 || fps.length ? 'Move' : zs.size ? 'Move zone' : ds.size ? (ds.size === 1 ? 'Move drawing' : 'Move drawings') : cu.size ? 'Move tracks' : 'Move outline';
    this.app.edit(label, (p) => { moveOutline(sel.map((i) => p.board.outline[i]), [dx, dy]); moveFootprints(p, fps, [dx, dy]); moveZones(p.board.zones, zs, [dx, dy]); moveDrawings((p.board.drawings || []).filter((d) => ds.has(d.id)), [dx, dy]); moveCopper(p.board, cu, [dx, dy]); });
  }

  _lockedNote(ids) {
    const locked = this.board.footprints.filter((f) => ids.includes(f.id) && f.locked);
    if (locked.length) toast(`${locked.map((f) => bfRef(this.project, f) || '?').join(', ')} ${locked.length === 1 ? 'is' : 'are'} locked and stayed put.`, 'info', 2500);
  }

  rotateSel(deg) {
    const ids = [...this.fpSel];
    if (!ids.length && this.drawSel.size) {
      const ds = new Set(this.drawSel), font = this.board.textFont || 'stroke';
      const about = this.snapPt(drawingsCentre(this.board.drawings.filter((d) => ds.has(d.id)), font));
      this.app.edit(`Rotate ${deg}°`, (p) => rotateDrawings(p.board.drawings.filter((d) => ds.has(d.id)), deg, about));
      return;
    }
    if (!ids.length) return;
    this.app.edit(`Rotate ${deg}°`, (p) => rotateFootprints(p, ids, deg));
    this._lockedNote(ids);
  }

  flipSel() {
    const ids = [...this.fpSel];
    if (!ids.length && this.drawSel.size) {
      // drawings go to the other side's layer, mirrored about their middle (copper: top <-> bottom)
      const ds = new Set(this.drawSel), font = this.board.textFont || 'stroke';
      const cx = drawingsCentre(this.board.drawings.filter((d) => ds.has(d.id)), font)[0];
      const other = (l) => (l.startsWith('F.') ? 'B.' + l.slice(2) : l.startsWith('B.') ? 'F.' + l.slice(2) : l);
      this.app.edit('Flip to the other side', (p) => {
        for (const d of p.board.drawings.filter((q) => ds.has(q.id))) {
          d.layer = other(d.layer);
          const mx = ([x, y]) => [2 * cx - x, y];
          for (const k of ['a', 'b', 'c', 'at', 'start', 'mid', 'end']) if (d[k]) d[k] = mx(d[k]);
          if (d.pts) d.pts = d.pts.map(mx);
          if (d.type === 'rect') { const a = d.a, b = d.b; d.a = [Math.min(a[0], b[0]), Math.min(a[1], b[1])]; d.b = [Math.max(a[0], b[0]), Math.max(a[1], b[1])]; }
          if (d.type === 'text' && d.rot) d.rot = (360 - d.rot) % 360;
        }
      });
      return;
    }
    if (!ids.length) return;
    this.app.edit('Flip to the other side', (p) => flipFootprints(p, ids));
    this._lockedNote(ids);
  }

  lockSel() {
    const ids = [...this.fpSel];
    if (!ids.length) return;
    const lock = !this.board.footprints.filter((f) => ids.includes(f.id)).every((f) => f.locked);
    this.app.edit(lock ? 'Lock' : 'Unlock', (p) => setLocked(p, ids, lock));
  }

  // ---------------------------------------------------------------- canvas

  attach(ws) {
    this.ws = ws;
    const c = ws.view.canvas;
    const world = (e) => ws.view.view.toWorld(ws.view.local(e));
    c.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const w = world(e);
      this.setAlt(e.altKey);
      if (this.tool === 'origin') { this.placeOrigin(w); return; }
      if (this.tool === 'route') { this.routeClick(w, e.detail >= 2); return; }
      if (this.tool === 'ripup') {
        // a click rips up the run under the pointer; a drag on the board boxes what to rip up
        this.marquee = { a: w, b: w, startPx: [e.clientX, e.clientY], rip: true, shift: e.shiftKey };
        try { c.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
        return;
      }
      if (this.tool === 'footprint') {
        if (!this.placingFp) { this.chooseBoardFootprint(); return; }
        const at = this.snapAt(w), { library, footprint } = this.placingFp;
        let bf = null;
        this.app.edit(`Place ${footprint.name}`, (p) => { bf = addBoardOnly(p, library, footprint, at); });
        this.placingFp = null;
        this.setTool('select');
        this.fpSel = new Set([bf.id]);
        this.openProperties?.();
        this.refresh();
        return;
      }
      if (this.tool === 'via') {
        const at = this.snapAt(w);
        let v = null;
        let n = 0;
        this.app.edit('Place via', (p) => { ({ via: v, pushed: n } = placeViaPushing(p, at, 2 / ws.view.view.scale, { shove: this.routeMode === 'shove' })); });
        const pushed = n > 0 ? ` Pushed ${n} aside.` : n < 0 ? ' Too crowded to push what it\'s near: check DRC.' : '';
        toast(`${v.net ? `Via on ${v.net}.` : 'Via with no net (it isn\'t on a track or pad).'}${pushed}`, n < 0 ? 'error' : 'info', 2000);
        return;
      }
      if (this.tool === 'zone' && e.detail >= 2 && this.pts?.zone?.length >= 3) { this.closeZone(); return; }
      if (this.tool === 'gline' && e.detail >= 2 && this.pts?.line) { this.finishLine(); return; }
      if (this.tool === 'select') {
        const tol = 5 / ws.view.view.scale;
        const handle = this._handleAt(w, tol);
        if (handle && !e.shiftKey) {
          this.handleDrag = { ...handle, startPx: [e.clientX, e.clientY], snapshot: structuredClone(this.board.outline), zoneSnapshot: handle.zone ? structuredClone(this.board.zones.find((z) => z.id === handle.zone).outline) : null, drawShape: handle.drawing ? structuredClone(this.board.drawings.find((d) => d.id === handle.drawing)) : null, moved: false };
          try { c.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
          return;
        }
        // a Track: a click selects it; dragging it slides the segment (its neighbours follow) or,
        // pressed at a corner, moves the corner (#31)
        // a free Track end: a click selects the Track, dragging moves that end (to carry the
        // Track on, start the Route tool on its end)
        // a press on selected copper when more than that is selected (a box selection): drag the
        // whole group, its tracks and vias with it
        const grouped = !e.shiftKey && this._hitTrack(w, tol);
        if (grouped && this.trackSel.has(grouped.id) && (this.fpSel.size || this.zoneSel.size || this.drawSel.size || this.selection.size || this.trackSel.size > 1)) {
          this.drag = { start: w, anchor: this.snapPt(w), fpAnchor: true, startPx: [e.clientX, e.clientY], snapshot: structuredClone(this.board.outline), fpSnapshot: structuredClone(this.board.footprints), zoneSnapshot: structuredClone(this.board.zones), drawSnapshot: structuredClone(this.board.drawings || []), moved: false, delta: [0, 0], onlyCopper: grouped.id };
          try { c.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
          return;
        }
        const free = !e.shiftKey && freeEndAt(this.project, this.board, w, 6 / ws.view.view.scale, this.hidden);
        if (free) {
          this.trackSel = new Set([free.track.id]); this.fpSel.clear(); this.selection.clear(); this.netSel.clear(); this.zoneSel.clear(); this.drawSel.clear();
          this.trackDrag = { kind: 'end', id: free.track.id, at: free.at, start: free.at, result: null, pending: true, startPx: [e.clientX, e.clientY], locked: !!free.track.locked };
          try { c.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
          this.refresh();
          return;
        }
        const corner = !e.shiftKey && cornerAt(this.project, this.board, w, 6 / ws.view.view.scale, this.hidden);
        const tr = this._hitTrack(w, tol) || (corner && this.board.tracks.find((t) => t.layer === corner.layer && ((t.a[0] === corner.at[0] && t.a[1] === corner.at[1]) || (t.b[0] === corner.at[0] && t.b[1] === corner.at[1]))));
        if (tr) {
          if (e.shiftKey) { if (this.trackSel.has(tr.id)) this.trackSel.delete(tr.id); else this.trackSel.add(tr.id); }
          else {
            this.trackSel = new Set([tr.id]); this.fpSel.clear(); this.selection.clear(); this.netSel.clear(); this.zoneSel.clear(); this.drawSel.clear();
            if (tr.a) {
              const start = this.snapAt(w);
              this.trackDrag = corner ? { kind: 'corner', at: corner.at, layer: corner.layer, start, result: null } : { kind: 'segment', id: tr.id, start, result: null };
              Object.assign(this.trackDrag, { pending: true, startPx: [e.clientX, e.clientY], locked: !!tr.locked });
              try { c.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
            }
          }
          this.refresh();
          return;
        }
        // a press on something already selected keeps the rest of the selection (to move the group)
        const onSel = this._onSelected(w);
        if (!e.shiftKey && !onSel) this.trackSel.clear();
        // the Board's own drawings (#66): over the footprints they're drawn on
        const dr = this._hitDrawing(w, tol);
        if (dr) {
          if (e.shiftKey) { if (this.drawSel.has(dr.id)) this.drawSel.delete(dr.id); else this.drawSel.add(dr.id); this.refresh(); return; }
          if (!this.drawSel.has(dr.id)) { this.drawSel = new Set([dr.id]); this.selection.clear(); this.fpSel.clear(); this.zoneSel.clear(); this.netSel.clear(); }
          const anchor = dr.type === 'text' ? dr.at : this._nearestHandle(dr, w);
          this.drag = { start: w, anchor, startPx: [e.clientX, e.clientY], snapshot: structuredClone(this.board.outline), fpSnapshot: structuredClone(this.board.footprints), zoneSnapshot: structuredClone(this.board.zones), drawSnapshot: structuredClone(this.board.drawings || []), moved: false, delta: [0, 0], onlyDrawing: dr.id };
          try { c.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
          this.refresh();
          return;
        }
        if (!e.shiftKey && !onSel) this.drawSel.clear();
        // a Footprint's Reference or Value text: drag it to move it (#65)
        const ft = !e.shiftKey && this._hitFieldText(w, tol);
        if (ft) {
          if (!this.fpSel.has(ft.bf.id)) { this.fpSel = new Set([ft.bf.id]); this.selection.clear(); this.zoneSel.clear(); this.netSel.clear(); }
          this.fieldDrag = { bfId: ft.bf.id, key: ft.key, start: w, from: ft.at, startPx: [e.clientX, e.clientY], moved: false, locked: !!ft.bf.locked };
          try { c.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
          this.refresh();
          return;
        }
        const fp = hitFootprint(this.project, w, { preferBack: this.activeLayer.startsWith('B.'), hidden: this.hidden });
        const hit = fp || this.hidden.has('Edge.Cuts') ? null : hitOutline(this.board.outline, w, tol);
        if (fp) {
          if (e.shiftKey) { if (this.fpSel.has(fp.id)) this.fpSel.delete(fp.id); else this.fpSel.add(fp.id); this.refresh(); return; }
          if (!this.fpSel.has(fp.id)) { this.fpSel = new Set([fp.id]); this.selection.clear(); this.zoneSel.clear(); }
          this.netSel.clear();
          // Footprints move by their origin, which lands on the grid
          this.drag = { start: w, anchor: fp.at, fpAnchor: true, startPx: [e.clientX, e.clientY], snapshot: structuredClone(this.board.outline), fpSnapshot: structuredClone(this.board.footprints), zoneSnapshot: structuredClone(this.board.zones), drawSnapshot: structuredClone(this.board.drawings || []), moved: false, delta: [0, 0], onlyFp: fp.id };
          try { c.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
          this.refresh();
          return;
        }
        const i = hit ? this.board.outline.indexOf(hit) : -1;
        let zn = null;
        if (e.shiftKey && hit) { if (this.selection.has(i)) this.selection.delete(i); else this.selection.add(i); this.refresh(); return; }
        if (hit) {
          if (!this.selection.has(i)) { this.selection = new Set([i]); this.fpSel.clear(); this.zoneSel.clear(); }
          // the selection moves by its handle nearest the pointer, so that handle lands on the grid or another object
          const anchors = handlePoints(this.board.outline.filter((_, k) => this.selection.has(k)));
          const anchor = anchors.reduce((b, p) => (Math.hypot(p[0] - w[0], p[1] - w[1]) < Math.hypot(b[0] - w[0], b[1] - w[1]) ? p : b), anchors[0] || w);
          this.drag = { start: w, anchor, startPx: [e.clientX, e.clientY], snapshot: structuredClone(this.board.outline), fpSnapshot: structuredClone(this.board.footprints), zoneSnapshot: structuredClone(this.board.zones), drawSnapshot: structuredClone(this.board.drawings || []), moved: false, delta: [0, 0], only: i };
          try { c.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
        } else if (!hit && (zn = this._hitZone(w, tol))) {
          // a Zone: by its edge, or inside it where nothing else is
          if (e.shiftKey) { if (this.zoneSel.has(zn.id)) this.zoneSel.delete(zn.id); else this.zoneSel.add(zn.id); this.refresh(); return; }
          if (!this.zoneSel.has(zn.id)) { this.zoneSel = new Set([zn.id]); this.selection.clear(); this.fpSel.clear(); this.netSel.clear(); }
          const anchor = zn.outline.reduce((b, p) => (Math.hypot(p[0] - w[0], p[1] - w[1]) < Math.hypot(b[0] - w[0], b[1] - w[1]) ? p : b), zn.outline[0]);
          this.drag = { start: w, anchor, startPx: [e.clientX, e.clientY], snapshot: structuredClone(this.board.outline), fpSnapshot: structuredClone(this.board.footprints), zoneSnapshot: structuredClone(this.board.zones), drawSnapshot: structuredClone(this.board.drawings || []), moved: false, delta: [0, 0], onlyZone: zn.id };
          try { c.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
        } else {
          // empty space: drag a box to select (left to right: what's wholly inside; right to left:
          // what it touches); Shift adds to the selection
          if (!e.shiftKey) { this.selection.clear(); this.fpSel.clear(); this.netSel.clear(); this.zoneSel.clear(); this.trackSel.clear(); this.drawSel.clear(); }
          this.marquee = { a: w, b: w, startPx: [e.clientX, e.clientY], base: { fps: new Set(this.fpSel), copper: new Set(this.trackSel), zones: new Set(this.zoneSel), drawings: new Set(this.drawSel), outline: new Set(this.selection) } };
          try { c.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
        }
        this.refresh();
        return;
      }
      this.click(this.snapAt(w));
    });
    c.addEventListener('pointermove', (e) => {
      const w = world(e);
      this.setAlt(e.altKey);
      this.snapMark = null;
      if (this.handleDrag?.zone) { const d = this.handleDrag, hs = shapeHandles({ type: 'poly', pts: d.zoneSnapshot }); this.cursor = this.snapAt(w, new Set(), hs.find((x) => x.key === d.key)?.at, hs.filter((x) => x.key !== d.key).map((x) => x.at)); }
      else if (this.handleDrag?.drawing) { const d = this.handleDrag, hs = shapeHandles(d.drawShape); this.cursor = this.snapAt(w, new Set(), hs.find((x) => x.key === d.key)?.at, hs.filter((x) => x.key !== d.key && !x.side).map((x) => x.at)); }
      else if (this.handleDrag) { const d = this.handleDrag; this.cursor = this.snapAt(w, new Set([d.index]), shapeHandles(d.snapshot[d.index]).find((x) => x.key === d.key)?.at); }
      else if (this.route && this.route.corner === 'free') {
        // freehand (#92): off the grid, and the stroke follows the pointer
        this.cursor = [Math.round(w[0]), Math.round(w[1])];
        this.route = strokeTo(this.route, this.cursor, 3 / ws.view.view.scale);
      } else if (this.tool !== 'select') this.cursor = this.snapAt(w);
      else this.cursor = this.snapPt(w);
      if (this.marquee && (e.buttons & 1)) {
        const m = this.marquee;
        if (!m.moved && Math.hypot(e.clientX - m.startPx[0], e.clientY - m.startPx[1]) < 4) return;
        m.moved = true; m.b = w;
        const got = boardItemsInBox(this.project, this.board, this._marqueeBox(m), m.b[0] >= m.a[0] ? 'window' : 'crossing', this.hidden);
        if (m.rip) this.ripHover = new Set(got.copper.filter((id) => !this._lockedCopper(id)));
        else {
          const u = (a, b) => new Set([...a, ...b]);
          this.fpSel = u(m.base.fps, got.fps); this.trackSel = u(m.base.copper, got.copper); this.zoneSel = u(m.base.zones, got.zones);
          this.drawSel = u(m.base.drawings, got.drawings); this.selection = u(m.base.outline, got.outline);
        }
        ws.view.invalidate();
        return;
      }
      // the Rip up tool: what a click would take, lit under the pointer
      if (this.tool === 'ripup' && !e.buttons) {
        const hit = this._hitTrack(w, 5 / ws.view.view.scale);
        const ids = hit ? (e.shiftKey ? new Set([hit.id]) : ripupRun(this.project, this.board, hit.id)) : null;
        if ((ids ? [...ids].sort().join() : '') !== (this.ripHover ? [...this.ripHover].sort().join() : '')) { this.ripHover = ids; ws.view.invalidate(); }
      }
      if (this.trackDrag && (e.buttons & 1)) {
        const d = this.trackDrag;
        // from the Select tool: only once the pointer has moved a few pixels (a click just selects)
        if (d.pending) {
          if (Math.hypot(e.clientX - d.startPx[0], e.clientY - d.startPx[1]) < 4) return;
          if (d.locked) { this.trackDrag = null; toast('That track is locked (its Properties).', 'info', 1800); return; }
          d.pending = false;
          this.trackDragIndex = copperIndex(this.project);
        }
        this.cursor = this.snapAt(w);
        const to = this.cursor;
        const r = d.kind === 'segment' ? dragSegment(this.project, this.board, d.id, [to[0] - d.start[0], to[1] - d.start[1]]) : d.kind === 'end' ? dragEnd(this.board, d.id, d.at, to) : dragCorner(this.project, this.board, d.at, to, d.layer);
        const res = dragResult(this.project, r, { shove: this.routeMode === 'shove', index: this.trackDragIndex });
        // a drag that can't be pushed clear stays where it last could be
        if (res.ok) d.result = res; else d.stuck = res.reason || true;
        if (res.ok) d.stuck = null;
        if (res.ok) this.liveRats = ratsnest(this.project, { ...this.board, tracks: res.tracks, vias: res.vias }, this.zoneFiller.fills); // the airwires follow the drag
        ws.view.invalidate();
        return;
      }
      if (this.fieldDrag && (e.buttons & 1)) {
        const d = this.fieldDrag;
        if (d.locked) return;
        if (!d.moved && Math.hypot(e.clientX - d.startPx[0], e.clientY - d.startPx[1]) < 4) return;
        d.moved = true;
        const to = this.snapPt([d.from[0] + w[0] - d.start[0], d.from[1] + w[1] - d.start[1]]);
        const bf = this.board.footprints.find((f) => f.id === d.bfId);
        d.at = fpInverse(bf)(to);
        const fp = bfFootprint(this.project, bf);
        const { overridden, own, ...cur } = fieldPlacement(fp, bf, d.key, fieldStrings(this.project, bf)[d.key], this.board.textFont || 'stroke');
        this.previewFps = this.board.footprints.map((f) => (f.id === d.bfId ? { ...f, texts: { ...(f.texts || {}), [d.key]: { ...cur, at: d.at } } } : f));
        ws.view.invalidate();
        return;
      }
      if (this.handleDrag && (e.buttons & 1)) {
        const d = this.handleDrag;
        if (!d.moved && Math.hypot(e.clientX - d.startPx[0], e.clientY - d.startPx[1]) < 3) return;
        d.moved = true;
        if (d.zone) {
          const pts = dragHandle({ type: 'poly', pts: d.zoneSnapshot }, d.key, this.cursor).pts;
          this.previewZones = this.board.zones.map((z) => (z.id === d.zone ? { ...z, outline: pts } : z));
        } else if (d.drawing) {
          const shape = { ...d.drawShape, ...dragHandle(d.drawShape, d.key, this.cursor) };
          this.previewDrawings = this.board.drawings.map((q) => (q.id === d.drawing ? shape : q));
        } else this.preview = dragOutlineHandle(d.snapshot, d.index, d.key, this.cursor);
        ws.view.invalidate();
        return;
      }
      if (this.tool === 'select' && !e.buttons) c.style.cursor = this._handleAt(w, 5 / ws.view.view.scale)?.cursor || '';
      if (this.drag && (e.buttons & 1)) {
        const d = this.drag;
        if (!d.moved && Math.hypot(e.clientX - d.startPx[0], e.clientY - d.startPx[1]) < 4) return;
        d.moved = true;
        const raw = [d.anchor[0] + w[0] - d.start[0], d.anchor[1] + w[1] - d.start[1]];
        const to = d.fpAnchor ? this.snapPt(raw) : this.snapAt(raw, this.selection, d.onlyZone || d.onlyDrawing ? d.anchor : null);
        d.delta = [to[0] - d.anchor[0], to[1] - d.anchor[1]];
        const moved = structuredClone(d.snapshot);
        moveOutline([...this.selection].map((i) => moved[i]), d.delta);
        this.preview = moved;
        if (this.fpSel.size) {
          const fps = structuredClone(d.fpSnapshot);
          moveFootprints({ board: { footprints: fps } }, [...this.fpSel], d.delta);
          this.previewFps = fps;
          // the Ratsnest follows the drag
          this._rats = ratsnest(this.project, { ...this.board, footprints: fps }, this.zoneFiller.fills);
        }
        if (this.zoneSel.size) {
          const zs = structuredClone(d.zoneSnapshot);
          moveZones(zs, this.zoneSel, d.delta);
          this.previewZones = zs;
        }
        if (this.drawSel.size) {
          const ds = structuredClone(d.drawSnapshot);
          moveDrawings(ds.filter((q) => this.drawSel.has(q.id)), d.delta);
          this.previewDrawings = ds;
        }
        // selected tracks and vias go with the group
        if (this.trackSel.size) {
          d.copperSnapshot ||= { tracks: structuredClone(this.board.tracks || []), vias: structuredClone(this.board.vias || []) };
          const cb = structuredClone(d.copperSnapshot);
          moveCopper(cb, this.trackSel, d.delta);
          this.previewTracks = cb.tracks; this.previewVias = cb.vias;
        }
        ws.view.invalidate();
      } else if (this.tool !== 'select') {
        if (this.measure && !this.measure.done) this.measure.b = this.cursor;
        if (this.route) this._routeMove();
        ws.view.invalidate();
      }
    });
    const up = () => {
      this.snapMark = null;
      if (this.marquee) {
        const m = this.marquee; this.marquee = null;
        if (m.rip) {
          // a box rips up every track and via in it; a click, the run under the pointer
          let ids = null;
          if (m.moved) ids = this.ripHover;
          else { const hit = this._hitTrack(m.a, 5 / ws.view.view.scale); if (hit) ids = m.shift ? new Set([hit.id]) : ripupRun(this.project, this.board, hit.id); }
          this.ripHover = null;
          this.ripUpCopper(ids);
          return;
        }
        this._updateStrip?.(); this.refresh();
        return;
      }
      if (this.trackDrag) {
        const d = this.trackDrag; this.trackDrag = null; this.trackDragIndex = null; this.liveRats = null;
        const res = d.result;
        if (res && JSON.stringify(res.tracks) !== JSON.stringify(this.board.tracks)) {
          this.app.edit(d.kind === 'corner' ? 'Drag corner' : d.kind === 'end' ? 'Drag track end' : 'Drag track', (p) => { p.board.tracks = res.tracks; p.board.vias = res.vias; });
          if (res.moved?.size) toast(`Pushed ${res.moved.size} track${res.moved.size === 1 ? '' : 's'} aside.`, 'info', 1400);
        } else this.refresh();
        return;
      }
      if (this.fieldDrag) {
        const d = this.fieldDrag; this.fieldDrag = null; this.previewFps = null;
        if (d.moved && d.at) {
          const fbf = this.board.footprints.find((f) => f.id === d.bfId), ref = fbf ? bfRef(this.project, fbf) : '';
          this.app.edit(`Move ${ref} ${FIELD_NAME[d.key].toLowerCase()}`, (p) => setFieldOverride(p, d.bfId, d.key, { at: d.at }));
        } else { if (d.locked && !d.moved) { /* a click: just the selection */ } this.refresh(); }
        if (d.locked) toast('Locked: unlock the footprint to move its text.', 'info', 2000);
        return;
      }
      if (this.handleDrag?.zone) {
        const d = this.handleDrag; this.handleDrag = null;
        const z = this.previewZones?.find((q) => q.id === d.zone); this.previewZones = null;
        if (d.moved && z && JSON.stringify(z.outline) !== JSON.stringify(d.zoneSnapshot)) this.app.edit('Reshape zone', (p) => { p.board.zones.find((q) => q.id === d.zone).outline = z.outline; });
        else this.refresh();
        return;
      }
      if (this.handleDrag?.drawing) {
        const d = this.handleDrag; this.handleDrag = null;
        const shape = this.previewDrawings?.find((q) => q.id === d.drawing); this.previewDrawings = null;
        if (d.moved && shape && JSON.stringify(shape) !== JSON.stringify(d.drawShape)) this.app.edit('Reshape drawing', (p) => { p.board.drawings = p.board.drawings.map((q) => (q.id === d.drawing ? structuredClone(shape) : q)); });
        else this.refresh();
        return;
      }
      if (this.handleDrag) {
        const d = this.handleDrag; this.handleDrag = null;
        const result = this.preview; this.preview = null;
        if (d.moved && result && JSON.stringify(result) !== JSON.stringify(d.snapshot)) this.edit('Resize outline', (o, p) => { p.board.outline = result; });
        else this.refresh();
        return;
      }
      if (!this.drag) return;
      const d = this.drag; this.drag = null; this.preview = null; this.previewFps = null; this.previewZones = null; this.previewDrawings = null; this.previewTracks = null; this.previewVias = null;
      if (d.moved && (d.delta[0] || d.delta[1])) { this.nudge(...d.delta); this._lockedNote([...this.fpSel]); }
      else {
        // a click picks one item out of a group
        const only = (sets) => { this.selection.clear(); this.fpSel.clear(); this.zoneSel.clear(); this.drawSel.clear(); this.trackSel.clear(); Object.assign(this, sets); };
        if (!d.moved && d.onlyFp) only({ fpSel: new Set([d.onlyFp]) });
        else if (!d.moved && d.onlyDrawing) only({ drawSel: new Set([d.onlyDrawing]) });
        else if (!d.moved && d.onlyZone) only({ zoneSel: new Set([d.onlyZone]) });
        else if (!d.moved && d.only !== undefined) only({ selection: new Set([d.only]) });
        else if (!d.moved && d.onlyCopper) only({ trackSel: new Set([d.onlyCopper]) });
        this.refresh();
      }
    };
    c.addEventListener('pointerup', up);
    // double-clicking a footprint, track, via, zone or outline shape opens its Properties
    c.addEventListener('dblclick', (e) => {
      if (this.tool !== 'select') return;
      const hit = this._hitAny(world(e));
      if (!hit) return;
      e.preventDefault();
      this._selectOnly(hit);
      this.openProperties();
    });
    ws.view.onContextMenu = (e) => this.contextMenu(e);
    watchAlt(ws, (on) => this.setAlt(on));
    this.gridCard.mount(ws);
    this.cards.mount(ws);
    ws.view.el.append(this.routeStrip);
    this.routeStrip.prepend(stripGrip(this.routeStrip, 'board')); // moves with the context strip: one place per editor
    this.strip.mount(ws.view.el);
    ws.view.el.addEventListener('strip-moved', () => { placeStrip(this.strip.el, 'board'); placeStrip(this.routeStrip, 'board'); });
    this.routeStrip.addEventListener('pointerdown', (e) => e.stopPropagation());
    c.addEventListener('pointercancel', up);
    c.addEventListener('pointerleave', () => { if (this.tool !== 'select') { this.cursor = null; ws.view.invalidate(); } });
    this.refresh();
  }

  /** The handles shown: those of the one selected outline shape (on the preview while dragging). */
  _handles() {
    const dsel = this._selDrawing();
    if (dsel && this.tool === 'select' && !this.drag?.moved) return shapeHandles(this.previewDrawings?.find((q) => q.id === dsel.id) || dsel);
    const z = this._selZone();
    if (z && this.tool === 'select' && !this.drag?.moved) return shapeHandles({ type: 'poly', pts: (this.previewZones?.find((q) => q.id === z.id) || z).outline });
    if (this.tool !== 'select' || this.selection.size !== 1 || this.hidden.has('Edge.Cuts') || this.drag?.moved) return [];
    const i = [...this.selection][0];
    const s = (this.preview || this.board.outline)[i];
    return s ? shapeHandles(s) : [];
  }

  /** The handle under `w`, as { index, key, cursor }, or null. */
  _handleAt(w, tol) {
    const dsel = this._selDrawing();
    if (dsel && this.tool === 'select') { const hd = hitHandle(dsel, w, tol); if (hd) return { drawing: dsel.id, key: hd.key, cursor: hd.cursor }; }
    const z = this._selZone();
    if (z && this.tool === 'select') { const hz = hitHandle({ type: 'poly', pts: z.outline }, w, tol); if (hz) return { zone: z.id, key: hz.key, cursor: hz.cursor }; }
    if (this.tool !== 'select' || this.selection.size !== 1 || this.hidden.has('Edge.Cuts')) return null;
    const index = [...this.selection][0];
    const s = this.board.outline[index];
    const h = s && hitHandle(s, w, tol);
    return h ? { index, key: h.key, cursor: h.cursor } : null;
  }

  /** A Footprint's Reference or Value text under `w` (#65): { bf, key, at } or null. Front side first unless the active layer is on the back. */
  _hitFieldText(w, tol) {
    tol = Math.min(tol, 500_000); // text is picked near its strokes, never from far away
    const back = this.activeLayer.startsWith('B.');
    const fps = [...this.board.footprints].sort((a, b) => ((a.side === 'B') === back ? -1 : 1) - ((b.side === 'B') === back ? -1 : 1));
    const font = this.board.textFont || 'stroke';
    for (const bf of fps) {
      // inside a footprint's outline a click moves the footprint (a fab-layer Reference often sits in the middle)
      if (insidePolygon(w, footprintOutline(this.project, bf))) continue;
      for (const d of placedFieldTexts(this.project, bf, { ...fieldStrings(this.project, bf), all: true })) {
        if (d.hidden || !d.text || this.hidden.has(d.layer)) continue;
        if (hitDrawing([d], w, tol, { font })) return { bf, key: d.key, at: d.at };
      }
    }
    return null;
  }

  /** The one selected drawing that has handles (not text), or null. */
  _selDrawing() {
    if (this.drawSel.size !== 1 || this.selection.size || this.fpSel.size || this.zoneSel.size || this.trackSel.size) return null;
    const d = (this.board.drawings || []).find((q) => this.drawSel.has(q.id));
    return d && d.type !== 'text' && !this.hidden.has(d.layer) ? d : null;
  }

  /** The Board drawing under `w` on a shown layer (#66), or null. */
  _hitDrawing(w, tol) {
    return hitDrawing(this.board.drawings, w, tol, { font: this.board.textFont || 'stroke', visible: (l) => !this.hidden.has(l) });
  }

  /** The handle of drawing `d` nearest `w` (what a move snaps by). */
  _nearestHandle(d, w) {
    const hs = shapeHandles(d).filter((x) => !x.side).map((x) => x.at);
    return hs.reduce((b, p) => (Math.hypot(p[0] - w[0], p[1] - w[1]) < Math.hypot(b[0] - w[0], b[1] - w[1]) ? p : b), hs[0] || w);
  }

  /** What is at `w`, in the order a click picks it: { kind: 'track' | 'drawing' | 'footprint' | 'outline' | 'zone', item, index? }. */
  _hitAny(w) {
    const tol = 5 / (this.ws?.view.view.scale || 1);
    const tr = this._hitTrack(w, tol);
    if (tr) return { kind: 'track', item: tr };
    const dr = this._hitDrawing(w, tol);
    if (dr) return { kind: 'drawing', item: dr };
    const fp = hitFootprint(this.project, w, { preferBack: this.activeLayer.startsWith('B.'), hidden: this.hidden });
    if (fp) return { kind: 'footprint', item: fp };
    const o = this.hidden.has('Edge.Cuts') ? null : hitOutline(this.board.outline, w, tol);
    if (o) return { kind: 'outline', item: o, index: this.board.outline.indexOf(o) };
    const z = this._hitZone(w, tol);
    if (z) return { kind: 'zone', item: z };
    return null;
  }

  /** Is the item under `w` part of the selection? */
  _onSelected(w) {
    const h = this._hitAny(w);
    if (!h) return false;
    return h.kind === 'footprint' ? this.fpSel.has(h.item.id) : h.kind === 'drawing' ? this.drawSel.has(h.item.id) : h.kind === 'zone' ? this.zoneSel.has(h.item.id) : h.kind === 'outline' ? this.selection.has(h.index) : this.trackSel.has(h.item.id);
  }

  /** Select just that hit. */
  _selectOnly(hit) {
    this.selection.clear(); this.fpSel.clear(); this.trackSel.clear(); this.zoneSel.clear(); this.netSel.clear(); this.drawSel.clear();
    if (hit.kind === 'track') this.trackSel.add(hit.item.id);
    else if (hit.kind === 'drawing') this.drawSel.add(hit.item.id);
    else if (hit.kind === 'footprint') this.fpSel.add(hit.item.id);
    else if (hit.kind === 'outline') this.selection.add(hit.index);
    else if (hit.kind === 'zone') this.zoneSel.add(hit.item.id);
  }

  _selSig() { return `${[...this.fpSel].sort()}|${[...this.trackSel].sort()}|${[...this.zoneSel].sort()}|${[...this.selection].sort()}|${[...this.drawSel].sort()}`; }
  _anySelected() { return !!(this.fpSel.size || this.trackSel.size || this.zoneSel.size || this.selection.size || this.drawSel.size); }

  /** Show the selection's Properties card, until the selection changes or it's closed. */
  openProperties() {
    if (!this._anySelected()) return;
    this._propsFor = this._selSig();
    this.cards.card('props').toggle(true);
    this.refresh();
  }

  closeProperties() { this._propsFor = null; this.cards.card('props').toggle(false); this.refresh(); }

  /** Right-click: select what's under the pointer and offer what applies to it. */
  contextMenu(e) {
    // with the Route tool, right-click cycles Eagle's bend styles (#91); Shift goes back
    if (this.tool === 'route') { this.setBend(cycleBend(this.bend, e.shiftKey ? -1 : 1)); return; }
    if (this.tool !== 'select') { this.setTool('select'); return; }
    const v = this.ws.view, w = v.view.toWorld(v.local(e));
    const hit = this._hitAny(w);
    const sameSel = hit && ((hit.kind === 'track' && this.trackSel.has(hit.item.id)) || (hit.kind === 'footprint' && this.fpSel.has(hit.item.id)) || (hit.kind === 'zone' && this.zoneSel.has(hit.item.id)) || (hit.kind === 'outline' && this.selection.has(hit.index)) || (hit.kind === 'drawing' && this.drawSel.has(hit.item.id)));
    if (hit && !sameSel) this._selectOnly(hit);
    if (!hit) { this.selection.clear(); this.fpSel.clear(); this.trackSel.clear(); this.zoneSel.clear(); this.netSel.clear(); this.drawSel.clear(); }
    this.refresh();
    const at = { x: e.clientX, y: e.clientY };
    const pad = hitPad(this.project, w, { preferBack: this.activeLayer.startsWith('B.') });
    const net = pad?.pad.net || (hit?.kind === 'track' ? hit.item.net : null) || (hit?.kind === 'zone' ? hit.item.net : null);
    const selectNet = net ? { label: `Select net ${net}`, icon: 'wire', onClick: () => this.selectNetOnBoard(net) } : null;
    if (!hit) {
      popupMenu([selectNet, selectNet ? 'sep' : null,
        { label: 'Fit the board in view', icon: 'fit', shortcut: 'Home', onClick: () => v.fitHome() },
        { label: 'Update from Schematic…', icon: 'annotate', shortcut: 'F8', onClick: () => this.annotate() },
        { label: 'Board setup…', icon: 'settings', onClick: () => this.setup() },
        { label: 'Run DRC', icon: 'erc', onClick: () => this.runDrc() }], at);
      return;
    }
    const props = { label: 'Properties…', icon: 'sliders', shortcut: 'Double-click', onClick: () => this.openProperties() };
    const del = { label: 'Delete', icon: 'trash', shortcut: 'Del', onClick: () => this.deleteSelection() };
    const toSch = this.fpSel.size || net ? { label: this.fpSel.size ? 'Show on Schematic' : 'Show the net on Schematic', icon: 'schematic', onClick: () => this.showOnSchematic(this.fpSel.size ? null : net) } : null;
    if (this.fpSel.size) {
      const locked = this.board.footprints.filter((f) => this.fpSel.has(f.id)).every((f) => f.locked);
      popupMenu([props, toSch, 'sep',
        { label: `Rotate ${this.rotStep}° anticlockwise`, icon: 'rotateLeft', shortcut: 'R', disabled: locked, onClick: () => this.rotateSel(this.rotStep) },
        { label: `Rotate ${this.rotStep}° clockwise`, icon: 'rotateRight', shortcut: 'Shift+R', disabled: locked, onClick: () => this.rotateSel(-this.rotStep) },
        { label: 'Flip to the other side', icon: 'flip', shortcut: 'F', disabled: locked, onClick: () => this.flipSel() },
        { label: locked ? 'Unlock' : 'Lock', icon: locked ? 'unlock' : 'lock', shortcut: 'L', onClick: () => this.lockSel() },
        selectNet ? 'sep' : null, selectNet], at);
      return;
    }
    if (this.drawSel.size) {
      popupMenu([props, 'sep',
        { label: `Rotate ${this.rotStep}° anticlockwise`, icon: 'rotateLeft', shortcut: 'R', onClick: () => this.rotateSel(this.rotStep) },
        { label: `Rotate ${this.rotStep}° clockwise`, icon: 'rotateRight', shortcut: 'Shift+R', onClick: () => this.rotateSel(-this.rotStep) },
        { label: 'Flip to the other side', icon: 'flip', shortcut: 'F', onClick: () => this.flipSel() }, 'sep', del], at);
      return;
    }
    if (this.trackSel.size) {
      popupMenu([props, toSch, 'sep', { label: 'Select the whole connection', icon: 'route', shortcut: 'U', onClick: () => this.selectConnection() }, selectNet, 'sep', del], at);
      return;
    }
    popupMenu([props, toSch, 'sep', selectNet, selectNet ? 'sep' : null, del], at);
  }

  /**
   * Show the selected footprints' parts on the Schematic (or `net`'s wires), selected there and
   * zoomed to.
   */
  showOnSchematic(net = null) {
    const comps = net ? [] : [...new Set(this.board.footprints.filter((f) => this.fpSel.has(f.id) && f.componentId).map((f) => f.componentId))];
    const sed = this.app.workspace('schematic')?.editor;
    if (!sed) return;
    const what = { components: comps, nets: net ? [net] : [] };
    if (!sed.hasItems(what)) { toast(net ? `${net} has no wires on the Schematic.` : 'Not on the Schematic.', 'info', 2600); return; }
    this.app.setWorkspace('schematic');
    requestAnimationFrame(() => requestAnimationFrame(() => sed.showItems(what))); // once its canvas has its size
  }

  /** Are any of these parts' footprints, or these nets' pads or copper, on the Board? */
  hasItems({ components = [], nets = [] }) {
    const comps = new Set(components), low = new Set(nets.map((n) => n.toLowerCase()));
    if (this.board.footprints.some((f) => comps.has(f.componentId))) return true;
    if ([...(this.board.tracks || []), ...(this.board.vias || [])].some((t) => t.net && low.has(t.net.toLowerCase()))) return true;
    return [...padNets(this.board).values()].some((n) => n && low.has(n.toLowerCase()));
  }

  /** Select these parts' footprints (by Component) or these nets' pads and copper here, and zoom to them. */
  showItems({ components = [], nets = [] }) {
    const comps = new Set(components), low = new Set(nets.map((n) => n.toLowerCase()));
    const fps = this.board.footprints.filter((f) => comps.has(f.componentId));
    const copper = [...(this.board.tracks || []), ...(this.board.vias || [])].filter((t) => t.net && low.has(t.net.toLowerCase()));
    const padMap = padNets(this.board);
    const padPts = low.size ? this.board.footprints.flatMap((f) => placedPads(this.project, f, padMap).filter((p) => p.net && low.has(p.net.toLowerCase())).map((p) => p.at)) : [];
    if (!fps.length && !copper.length && !padPts.length) return false;
    this.selection.clear(); this.zoneSel.clear();
    this.fpSel = new Set(fps.map((f) => f.id));
    this.trackSel = new Set(copper.map((t) => t.id));
    this.netSel = new Set([...new Set(padMap.values())].filter((n) => n && low.has(n.toLowerCase())));
    const pts = [...fps.flatMap((f) => footprintOutline(this.project, f)), ...copper.flatMap((t) => (t.at ? [t.at] : trackPoints(t, 10_000))), ...padPts];
    if (pts.length && this.ws) {
      const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
      const m = mm(4), w = Math.max(Math.max(...xs) - Math.min(...xs), mm(12)), hh = Math.max(Math.max(...ys) - Math.min(...ys), mm(8));
      const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2;
      this.ws.view.view.fit({ x0: cx - w / 2 - m, y0: cy - hh / 2 - m, x1: cx + w / 2 + m, y1: cy + hh / 2 + m }, this.ws.view.w, this.ws.view.h, 20);
    }
    this.refresh();
    return true;
  }

  /** Select a Net: its pads light up, here and on the Schematic. */
  selectNetOnBoard(net) {
    this.netSel = new Set([net]); this.fpSel.clear(); this.selection.clear(); this.trackSel.clear(); this.zoneSel.clear();
    const n = [...padNets(this.board).values()].filter((x) => x.toLowerCase() === net.toLowerCase()).length;
    toast(`Net ${net}: ${n} pad${n === 1 ? '' : 's'}`, 'info', 1800);
    this.refresh();
  }

  /** The one selected Zone (when nothing else is), on a shown layer. */
  _selZone() {
    if (this.zoneSel.size !== 1 || this.selection.size || this.fpSel.size) return null;
    const z = this.board.zones.find((q) => this.zoneSel.has(q.id));
    return z && !this.hidden.has(z.layer) ? z : null;
  }

  /** The Zone at `w`: near its edge, or inside it; the active layer's first, then front to back. */
  _hitZone(w, tol) {
    const order = [this.activeLayer, 'F.Cu', 'In1.Cu', 'In2.Cu', 'B.Cu'];
    const zs = (this.board.zones || []).filter((z) => !this.hidden.has(z.layer)).sort((a, b) => order.indexOf(a.layer) - order.indexOf(b.layer) || b.priority - a.priority);
    const edge = (z) => z.outline.some((p, i) => pointSeg2(w, p, z.outline[(i + 1) % z.outline.length]) <= tol * tol);
    return zs.find(edge) || zs.find((z) => inPolygon(w, z.outline)) || null;
  }

  /** The Net a new Zone starting at `p` on `layer` takes: the pad's or track's there, else GND (if there is one). */
  _zoneNet(p, layer) {
    const hit = hitPad(this.project, p, { preferBack: layer.startsWith('B.') });
    if (hit?.pad.net && (hit.pad.layers.includes(layer) || hit.pad.layers.includes('*.Cu'))) return hit.pad.net;
    const tr = (this.board.tracks || []).find((t) => t.layer === layer && t.net && nearestOnTrack(t, p).d <= t.width / 2);
    if (tr) return tr.net;
    return [...new Set(padNets(this.board).values())].find((n) => /^gnd$/i.test(n)) || '';
  }

  /** Close the Zone being drawn and add it (one undo step), selected. */
  closeZone() {
    const pts = this.pts?.zone;
    this.pts = null;
    if (!pts || pts.length < 3) { this.refresh(); return; }
    const layer = copperLayerNames(this.board.stack.copper).includes(this.activeLayer) ? this.activeLayer : 'F.Cu';
    const z = newZone(layer, this.zoneNet === 'auto' || this.zoneNet == null ? this._zoneNet(pts[0], layer) : this.zoneNet, pts);
    this.app.edit('Add zone', (p) => { p.board.zones.push(z); });
    this.tool = 'select';
    if (this.ws) this.ws.view.canvas.style.cursor = '';
    this.zoneSel = new Set([z.id]);
    const pc = this.cards?.card('props'); if (pc && !pc.isOpen) pc.toggle(true);
    toast(`Zone on ${layer}${z.net ? ` for ${z.net}` : ' with no net (set one in Properties)'}.`, 'info', 2200);
    this.refresh();
  }

  /** Resolves once every Zone fill is up to date (for DRC and export). */
  whenZonesFilled() { return this.zoneFiller.whenFilled(); }

  /**
   * Highlight outline shapes `outlineSel`, whole Footprints `fpIds` and single pads `padKeys`
   * ("componentId:pad") in the style from Settings, in colour C2.selection.
   */
  _highlightBoard(ctx, view, C, board, outlineSel, fpIds, padKeys, C2, noFade = false, trackIds = new Set()) {
    padKeys ||= new Set();
    const comps = new Set([...padKeys].map((k) => k.slice(0, k.lastIndexOf(':'))));
    const partial = new Set(board.footprints.filter((f) => !fpIds.has(f.id) && comps.has(f.componentId)).map((f) => f.id));
    const sub = { ...board, outline: board.outline.filter((_, k) => outlineSel.has(k)), footprints: board.footprints.filter((f) => fpIds.has(f.id) || partial.has(f.id)), zones: (board.zones || []).filter((z) => trackIds.has(z.id)) };
    const nets = padNets(board), proj = { ...this.project, board };
    const boxes = [
      ...sub.outline.map((sh) => outlineBounds([sh])),
      ...(board.tracks || []).filter((t) => trackIds.has(t.id)).map(trackBox),
      ...sub.zones.map((z) => { const xs = z.outline.map((q) => q[0]), ys = z.outline.map((q) => q[1]); return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }; }),
      ...(board.drawings || []).filter((d) => trackIds.has(d.id)).map((d) => drawingBox(d, board.textFont || 'stroke')),
      ...(board.vias || []).filter((v) => trackIds.has(v.id)).map((v) => ({ x0: v.at[0] - v.diameter / 2, y0: v.at[1] - v.diameter / 2, x1: v.at[0] + v.diameter / 2, y1: v.at[1] + v.diameter / 2 })),
      ...sub.footprints.filter((f) => !partial.has(f.id)).map((f) => { const q = footprintOutline(proj, f); const xs = q.map((p) => p[0]), ys = q.map((p) => p[1]); return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }; }),
      ...sub.footprints.filter((f) => partial.has(f.id)).flatMap((f) => placedPads(proj, f, nets).filter((p) => padKeys.has(`${bfKey(f)}:${p.number}`)).map((p) => { const r = Math.max(...p.size) / 2; return { x0: p.at[0] - r, y0: p.at[1] - r, x1: p.at[0] + r, y1: p.at[1] + r }; })),
    ].filter(Boolean).map((b) => screenBox(view, b));
    const style = this.app.highlightStyle() === 'fade' && noFade ? 'glow' : this.app.highlightStyle();
    highlight(ctx, C2, style, (c, Cx) => drawBoard(c, view, Cx, sub, { project: this.project, hidden: this.hidden, only: true, padsOnly: partial, padKeys, trackIds, drawingIds: trackIds }), boxes);
  }

  /** Tell the Schematic what is selected here (when this is the workspace being used). */
  _publishProbe() {
    if (this.app.active !== this.ws) return;
    const trackNets = [...(this.board.tracks || []), ...(this.board.vias || [])].filter((t) => this.trackSel.has(t.id) && t.net).map((t) => t.net);
    const sig = `${[...this.fpSel].sort().join()}|${[...this.netSel].join()}|${trackNets.join()}`;
    if (sig === this._probeSig) return;
    this._probeSig = sig;
    this.app.setProbe('board', probeFromBoard(this.project, [...this.fpSel], [...this.netSel, ...trackNets]));
  }

  /** Bring the Schematic's probe into view on the Board. */
  revealProbe() {
    const probe = this.app.probeFor('board');
    if (!probe || !this.ws) return;
    if (this.app.probe.key === this._revealed) return;
    this._revealed = this.app.probe.key;
    const t = boardTargets(this.project, probe);
    const nets = padNets(this.board), pts = [];
    for (const f of this.board.footprints) {
      if (t.footprints.has(f.id)) pts.push(...footprintOutline(this.project, f));
      else for (const p of placedPads(this.project, f, nets)) if (t.pads.has(`${bfKey(f)}:${p.number}`)) pts.push(p.at);
    }
    if (!pts.length) return;
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    revealBox(this.ws.view, { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) });
  }

  /** Pad centres, as snap targets. */
  _padPoints() {
    const nets = padNets(this.board);
    return this.board.footprints.flatMap((bf) => placedPads(this.project, bf, nets).map((p) => p.at));
  }

  // ---------------------------------------------------------------- routing (#20)

  /** Pick Eagle's bend style `id` (#91): remembered, and applied to the route in progress. */
  setBend(id) {
    this.bend = bendOf(id).id; pref.set('boardBend', this.bend);
    for (const b of this.cornerSeg.querySelectorAll('button')) { const on = b.dataset.bend === String(this.bend); b.classList.toggle('active', on); b.setAttribute('aria-checked', String(on)); }
    if (this.route) { this.route = withBend(this.route, this.bend); this._routeMove(); }
    if (this.ws) this._hint();
  }

  /** Straight (chamfered) or round (#95) mitres: remembered, and applied to the route in progress. */
  setMitre(id) {
    this.mitre = id === 'round' ? 'round' : 'straight'; pref.set('boardMitre', this.mitre);
    for (const b of this.mitreSeg.querySelectorAll('button')) { const on = b.dataset.mitre === this.mitre; b.classList.toggle('active', on); b.setAttribute('aria-checked', String(on)); }
    if (this.route) { this.route = { ...this.route, mitre: this.mitre }; this._routeMove(); }
    if (this.ws) this._hint();
  }

  setChamfer(nm) {
    this.chamfer = nm; pref.set('boardChamfer', nm / 1e6);
    this.chamferIn.value = fmt(nm);
    if (this.route) { this.route = { ...this.route, chamfer: nm }; this._routeMove(); }
  }

  /** The pad under `w` on the active copper layer (a through-hole pad is on every layer). */
  _padOnLayer(w) {
    const hit = hitPad(this.project, w, { preferBack: this.activeLayer.startsWith('B.') });
    return hit && (hit.pad.layers.includes(this.activeLayer) || hit.pad.layers.includes('*.Cu')) ? hit : null;
  }

  /** Route tool click: start on a pad, place a corner, or finish on a pad of the same Net. */
  routeClick(w, dbl) {
    const p = this.route?.corner === 'free' ? [Math.round(w[0]), Math.round(w[1])] : this.snapAt(w);
    if (!this.route) {
      const hit = this._padOnLayer(w);
      // not on a pad: a Via, a Track end or a point along a Track of a net (#87, #89)
      const cu = !hit && this._copperTarget(w);
      // an airwire (#90): route it from its nearer end, on that end's layer
      if (!hit && !cu && !this._fromAirwire) {
        const aw = this._airwireAt(w);
        if (aw) { this._routeAirwire(aw, w); return; }
      }
      if (!hit && !cu) {
        const other = !hitPad(this.project, w) && trackOnOtherLayer(this.board, w, 3 / this.ws.view.view.scale, this.activeLayer, this.hidden);
        toast(hitPad(this.project, w) ? `That pad isn't on ${this.activeLayer}: make its layer active (Layers, or the chips at the bottom).` : other ? `That track is on ${other.layer}: make its layer active (Layers, or the chips at the bottom).` : 'Start a track on a pad, a track or a via.', 'info', 2600);
        return;
      }
      if (hit && !hit.pad.net) { toast('That pad has no net yet: Update from Schematic (F8) first.', 'info', 2600); return; }
      const pairs = layerPairs(this.board.stack.copper);
      const pair = this.pair && pairs.some((q) => q.join('|') === this.pair.join('|')) ? this.pair : null;
      const opts = { bend: this.bend, chamfer: this.chamfer, mitre: this.mitre, pair, pad: hit ? hit.pad : null };
      this.route = hit ? startRoute(this.project, hit.pad.at, this.activeLayer, hit.pad.net, opts) : startRoute(this.project, cu.at, this.activeLayer, cu.net, opts);
      if (cu && cu.kind === 'along') this.route.joins = [{ id: cu.id, at: cu.at }];
      // from a Track's end: carry on the way it was going
      if (cu && cu.kind === 'end') { const t = this.board.tracks.find((x) => x.id === cu.id); if (t) this.route.lead = this._leadAt(t, cu.at); }
      this.routeIndex = copperIndex(this.project);
      this._routeMove();
      this.refresh();
      return;
    }
    const end = this._padOnLayer(w);
    if (end && end.pad.net.toLowerCase() === this.route.net.toLowerCase() && (end.pad.at[0] !== this.route.points[0][0] || end.pad.at[1] !== this.route.points[0][1] || this.route.points.length > 1)) {
      const v = this._proposal(end.pad.at);
      if (v.blocked) { toast(`No clear way to that pad from here: place a corner nearer, or switch to Free mode.`, 'info', 2600); return; }
      this.route = routeClickAt(this.project, this.route, end.pad.at, v.tail);
      this.finishRoute();
      return;
    }
    // a Via, a Track end or a point along a Track of the route's net: finish there (#88, #89)
    const cu = !end && this._copperTarget(w);
    if (cu && cu.net.toLowerCase() === this.route.net.toLowerCase() && !this._atStart(cu.at)) {
      const v = this._proposal(cu.at);
      if (v.blocked) { toast(`No clear way to that ${cu.kind === 'via' ? 'via' : 'track'} from here: place a corner nearer, or switch to Free mode.`, 'info', 2600); return; }
      this.route = routeClickAt(this.project, this.route, cu.at, v.tail);
      if (cu.kind === 'along') this.route = { ...this.route, joins: [...(this.route.joins || []), { id: cu.id, at: cu.at }] };
      this.finishRoute();
      return;
    }
    if (dbl) { this.finishRoute(); return; }
    this.route = routeClickAt(this.project, this.route, p, this._proposal(p).tail);
    this._routeMove();
    this.refresh();
  }

  /** What the router proposes from the last fixed corner to `p` in the current mode. */
  _proposal(p) {
    return routeStep(this.project, this.route, p, this.routeMode, this.routeIndex, this._targetPad(p));
  }


  /**
   * Take back the route's last segment (or the last via, back to the layer before). Backspace and
   * undo. At its start there is nothing left to take back: routing carries on from there (Esc
   * stops it).
   */
  _routeStepBack() {
    if (this.route.points.length > 1 || this.route.runs?.length) {
      this.route = routeBack(this.route);
      if (this.activeLayer !== this.route.layer) this.setActiveLayer(this.route.layer);
      this._routeKey = null; this._routeMove(); this._hint();
    } else toast('Back at the start of the route: Esc stops routing.', 'info', 1600);
  }

  /** Undo while routing (Ctrl+Z, the toolbar): the last segment, not the Board's last edit. */
  undoStep() {
    if (!this.route) return false;
    this._routeStepBack();
    return true;
  }

  /** Redo while routing does nothing (the Board's history waits until the route is done). */
  redoStep() { return !!this.route; }

  /** The way Track `t` is heading at its end `at` (a unit vector), for a route carrying it on. */
  _leadAt(t, at) {
    const pts = trackPoints(t, 2_000), atB = t.b[0] === at[0] && t.b[1] === at[1];
    const q = atB ? pts[pts.length - 2] : pts[1];
    const v = [at[0] - q[0], at[1] - q[1]], L = Math.hypot(...v);
    return L ? [v[0] / L, v[1] / L] : null;
  }

  /** The airwire under `w` (within a few pixels), or null. */
  _airwireAt(w) {
    const tol = 4 / (this.ws?.view.view.scale || 1);
    let best = null;
    for (const a of this._rats?.wires || []) {
      const d = Math.sqrt(pointSeg2(w, a.a, a.b));
      if (d <= tol && (!best || d < best.d)) best = { d, wire: a };
    }
    return best?.wire || null;
  }

  /**
   * Start routing airwire `aw` (#90) from its end nearer `w`: on the active layer when that end is
   * there (a through-hole pad or a Via is on every layer), else on the end's own layer (said in a
   * toast). Its other end is marked as the target.
   */
  _routeAirwire(aw, w) {
    const [near, far] = Math.hypot(w[0] - aw.a[0], w[1] - aw.a[1]) <= Math.hypot(w[0] - aw.b[0], w[1] - aw.b[1]) ? [aw.a, aw.b] : [aw.b, aw.a];
    const low = aw.net.toLowerCase();
    const pad = hitPad(this.project, near, { preferBack: this.activeLayer.startsWith('B.') });
    const copper = copperLayerNames(this.board.stack.copper);
    let layer = this.activeLayer;
    if (pad && pad.pad.net?.toLowerCase() === low && pad.pad.at[0] === near[0] && pad.pad.at[1] === near[1]) {
      const ls = pad.pad.layers;
      if (!ls.includes('*.Cu') && !ls.includes(layer)) layer = ls.find((l) => copper.includes(l)) || layer;
    } else if (!(this.board.vias || []).some((v) => v.at[0] === near[0] && v.at[1] === near[1])) {
      const t = (this.board.tracks || []).find((x) => x.net?.toLowerCase() === low && ((x.a[0] === near[0] && x.a[1] === near[1]) || (x.b[0] === near[0] && x.b[1] === near[1])));
      if (t && t.layer !== layer) layer = t.layer;
    }
    if (layer !== this.activeLayer) { this.setActiveLayer(layer); toast(`Routing on ${layer}, where that end is.`, 'info', 1800); }
    this._fromAirwire = true;
    try { this.routeClick(near, false); } finally { this._fromAirwire = false; }
    if (this.route) { this.route.target = far; this.refresh(); }
  }

  /** The copper under `w` (not a pad) a route on the active layer can start or finish on: a Via, a Track end or a point along a Track. */
  _copperTarget(w) {
    return copperTarget(this.board, w, 3 / (this.ws?.view.view.scale || 1), this.activeLayer, { along: true, hidden: this.hidden });
  }

  /** Is `p` where the route started, with nothing routed yet (so a click there doesn't finish it)? */
  _atStart(p) {
    const st = this.route, s = st.points[0];
    return st.points.length === 1 && !st.runs?.length && s[0] === p[0] && s[1] === p[1];
  }

  /** A pad of the routed Net centred on `p` on the routing layer: the track goes into it square. */
  _targetPad(p) {
    const hit = this._padOnLayer(p);
    if (!hit || hit.pad.net.toLowerCase() !== this.route.net.toLowerCase()) return null;
    return hit.pad.at[0] === p[0] && hit.pad.at[1] === p[1] ? hit.pad : null;
  }

  /** Recompute the proposal for the pointer (live collisions with other Nets). */
  _routeMove() {
    if (!this.route) return;
    const at = this.cursor || this.route.points[this.route.points.length - 1];
    const key = `${at.join(',')}|${this.routeMode}`;
    if (this._routeKey === key && this._routeFor === this.route) return; // the pointer moved within a grid step
    this._routeKey = key; this._routeFor = this.route;
    const had = `${!!this.routeView?.collisions.length}${!!this.routeView?.blocked}`;
    this.routeView = this._proposal(at);
    // copper of the route's net under the pointer that a click would finish on (#88): ringed
    const cu = !this._targetPad(at) && this._copperTarget(at);
    this.routeView.target = cu && cu.net.toLowerCase() === this.route.net.toLowerCase() && !this._atStart(cu.at) ? cu : null;
    // the airwires as they'd be with this route (and what it pushes) on the Board, live
    const st = this.route, rv = this.routeView;
    const added = rv.segments.map((sg, i) => ({ id: `route-${i}`, a: sg.a, b: sg.b, ...(sg.mid ? { mid: sg.mid } : {}), width: st.width, layer: sg.layer || st.layer, net: st.net }));
    const vias = (st.vias || []).map((v, i) => ({ id: `route-v${i}`, at: v.at, diameter: st.via.diameter, drill: st.via.drill, net: st.net }));
    this.liveRats = ratsnest(this.project, { ...this.board, tracks: [...(rv.shoved || this.board.tracks), ...added], vias: [...(rv.shovedVias || this.board.vias), ...vias] }, this.zoneFiller.fills);
    if (this.ws && had !== `${!!this.routeView.collisions.length}${!!this.routeView.blocked}`) this._hint();
    this.ws?.view.invalidate();
  }

  finishRoute() {
    const st = this.route;
    this.routeIndexAtEnd = this.routeIndex;
    this.route = null; this.routeView = null; this.routeIndex = null; this.liveRats = null;
    if (st && st.points.length > 1) {
      let n = 0;
      const shoving = this.routeMode === 'shove', index = this.routeIndexAtEnd;
      this.app.edit(`Route ${st.net}`, (p) => { n = routeCommit(p, st, { shove: shoving, index }).length; });
      const v = st.vias?.length || 0;
      toast(`${n} track${n === 1 ? '' : 's'}${v ? ` and ${v} via${v === 1 ? '' : 's'}` : ` on ${st.layer}`} (${st.net}).`, 'info', 1600);
    } else this.refresh();
  }

  cancelRoute() { this.route = null; this.routeView = null; this.routeIndex = null; this.liveRats = null; this.refresh(); }


  /** The Track under `w` on a shown layer, front layers first. */
  _hitTrack(w, tol) {
    const order = ['F.Cu', 'In1.Cu', 'In2.Cu', 'B.Cu'];
    const ts = (this.board.tracks || []).filter((t) => !this.hidden.has(t.layer)).sort((a, b) => order.indexOf(a.layer) - order.indexOf(b.layer));
    const via = (this.hidden.has('F.Cu') && this.hidden.has('B.Cu')) ? null : (this.board.vias || []).find((v) => Math.hypot(w[0] - v.at[0], w[1] - v.at[1]) <= v.diameter / 2 + tol);
    return via || ts.find((t) => nearestOnTrack(t, w).d <= t.width / 2 + tol) || null;
  }

  /** U: select the whole connection the selected copper belongs to. */
  /** The box a marquee spans. */
  _marqueeBox(m) { return { x0: Math.min(m.a[0], m.b[0]), y0: Math.min(m.a[1], m.b[1]), x1: Math.max(m.a[0], m.b[0]), y1: Math.max(m.a[1], m.b[1]) }; }

  _lockedCopper(id) { return !!((this.board.tracks || []).find((t) => t.id === id) || (this.board.vias || []).find((v) => v.id === id))?.locked; }

  /** Rip up Tracks and Vias (ids): they go back to airwires, in one undo step; locked ones stay. */
  ripUpCopper(ids) {
    if (!ids?.size) { this.refresh(); return; }
    const take = new Set([...ids].filter((id) => !this._lockedCopper(id)));
    const kept = ids.size - take.size;
    if (!take.size) { toast('Locked: unlock it in its Properties to rip it up.', 'info', 2000); this.refresh(); return; }
    let n = { tracks: 0, vias: 0 };
    this.app.edit('Rip up', (p) => { n = ripUp(p.board, take); });
    for (const id of take) this.trackSel.delete(id);
    toast(`Ripped up ${n.tracks} track${n.tracks === 1 ? '' : 's'}${n.vias ? ` and ${n.vias} via${n.vias === 1 ? '' : 's'}` : ''}${kept ? ` (${kept} locked, kept)` : ''}.`, 'info', 1800);
    this.refresh();
  }

  selectConnection() {
    if (!this.trackSel.size) return;
    this.trackSel = connection(this.board, [...this.trackSel]);
    this.refresh();
  }

  // ---------------------------------------------------------------- the context strip

  /** Show the context strip for the tool in use or what is selected (the routing strip has its own). */
  _updateStrip() {
    const s = this.strip, t = this.tool;
    if (!this.ws || t === 'route') { s.hide(); return; }
    const copper = copperLayerNames(this.board.stack.copper);
    if (t === 'outline') {
      s.show(`outline|${this.radius}`, () => [stripLabel('Rectangle', 'outline'), stripSep(),
        stripNumber({ label: 'Corner radius', value: fmt(this.radius), unit: 'mm', onSet: (v) => { this.radius = mm(Math.max(0, v)); pref.set('boardCornerRadius', toMm(this.radius)); this.refresh(); }, title: 'Round the corners of new rectangles (0 for square)' })]);
      return;
    }
    if (t === 'polygon') {
      s.show(`polygon|${this.arcNext}|${this.pts ? this.pts.steps.length : -1}`, () => [stripLabel('Polygon', 'lpolygon'), stripSep(),
        stripSegmented({ label: 'Next side', value: this.arcNext ? 'arc' : 'line', items: [['line', 'Straight', 'The next side is straight'], ['arc', 'Arc', 'The next side is an arc through a point you click (A)']], onPick: (id) => { if (!this.pts?.mid) this.arcNext = id === 'arc'; this.refresh(); } }),
        this.pts ? stripButton({ icon: 'undo', label: 'Undo corner', title: 'Take back the last corner (Backspace)', onClick: () => this.onKey({ key: 'Backspace' }) }) : null]);
      return;
    }
    if (['text', 'gline', 'grect', 'gcircle'].includes(t)) {
      const layers = drawingLayers(this.board.stack.copper);
      const setLayer = (v) => { this.drawLayer = v; pref.set('boardDrawLayer', v); if (this.hidden.delete(v)) pref.set('boardHidden', [...this.hidden]); this.refresh(); };
      const w = this.drawWidth ?? defaultWidth(this.drawLayer);
      s.show(`draw|${t}|${this.drawLayer}|${this.drawText}|${this.drawSize}|${w}|${this.drawFill}`, () => [
        stripLabel(BOARD_TOOLS[t].title.split(/[ :(]/)[0], BOARD_TOOLS[t].icon), stripSep(),
        stripSelect({ label: 'Layer', value: layers.includes(this.drawLayer) ? this.drawLayer : 'F.SilkS', options: layers.map((l) => [l, l]), onSet: setLayer, title: 'The layer new text and shapes go on (bottom layers are mirrored)' }),
        t === 'text' ? stripText({ label: 'Text', value: this.drawText, onSet: (v) => { this.drawText = v; this.refresh(); } }) : null,
        t === 'text' ? stripNumber({ label: 'Size', value: fmt(this.drawSize), unit: 'mm', step: '0.1', min: '0.1', width: 56, title: 'Text height', onSet: (v) => { this.drawSize = mm(Math.max(0.1, v)); this.refresh(); } }) : null,
        t !== 'text' ? stripNumber({ label: 'Width', value: fmt(w), unit: 'mm', step: '0.05', min: '0', width: 56, title: 'Pen width', onSet: (v) => { this.drawWidth = mm(Math.max(0, v)); this.refresh(); } }) : null,
        t === 'grect' || t === 'gcircle' ? stripSegmented({ label: 'Fill', value: this.drawFill ? 'fill' : 'outline', items: [['outline', 'Outline'], ['fill', 'Filled']], onPick: (id) => { this.drawFill = id === 'fill'; this.refresh(); } }) : null,
        t === 'gline' && this.pts?.line?.length >= 2 ? stripButton({ icon: 'check', label: 'Finish', title: 'Finish the line (Enter)', onClick: () => this.finishLine() }) : null]);
      return;
    }
    if (t === 'zone') {
      const nets = [...new Set([...padNets(this.board).values()].filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      const n = this.pts?.zone?.length || 0;
      s.show(`zone|${this.activeLayer}|${this.zoneNet}|${n}|${nets.join()}`, () => [stripLabel('Zone', 'zone'), stripSep(),
        stripSelect({ label: 'Layer', value: copper.includes(this.activeLayer) ? this.activeLayer : 'F.Cu', options: copper.map((l) => [l, l]), onSet: (v) => this.setActiveLayer(v) }),
        stripSelect({ label: 'Net', value: this.zoneNet ?? 'auto', options: [['auto', 'From the first corner'], ['', '(no net)'], ...nets.map((x) => [x, x])], onSet: (v) => { this.zoneNet = v; this.refresh(); }, title: 'The new zone\'s net: from the pad or track under its first corner (else GND), or pick one' }),
        n >= 3 ? stripButton({ icon: 'check', label: 'Close', title: 'Close the zone (Enter)', onClick: () => this.closeZone() }) : null]);
      return;
    }
    if (t !== 'select') { s.hide(); return; }
    const fps = this.board.footprints.filter((f) => this.fpSel.has(f.id));
    const tracks = (this.board.tracks || []).filter((x) => this.trackSel.has(x.id)), vias = (this.board.vias || []).filter((x) => this.trackSel.has(x.id));
    const zones = (this.board.zones || []).filter((z) => this.zoneSel.has(z.id));
    const shapes = [...this.selection].map((i) => this.board.outline[i]).filter(Boolean);
    const del = (title) => stripButton({ icon: 'trash', title: `${title} (Del)`, danger: true, onClick: () => this.deleteSelection() });
    const pOpen = !!this.cards?.card('props')?.isOpen;
    const propsBtn = () => stripProps({ open: pOpen, onToggle: () => (pOpen ? this.closeProperties() : this.openProperties()) });
    const drawings = (this.board.drawings || []).filter((d) => this.drawSel.has(d.id));
    if (drawings.length && !fps.length) {
      const one = drawings.length === 1 ? drawings[0] : null;
      const layers = drawingLayers(this.board.stack.copper);
      const ids = new Set(drawings.map((d) => d.id));
      const allLayer = drawings.every((d) => d.layer === drawings[0].layer) ? drawings[0].layer : '';
      s.show(`draw-sel|${pOpen}|${JSON.stringify(drawings)}|${this.rotStep}`, () => [
        stripLabel(one ? `${DRAW_KIND[one.type] || 'Drawing'} on ${one.layer}` : `${drawings.length} drawings`, one?.type === 'text' ? 'ltext' : 'lline'), stripSep(),
        stripSelect({ label: 'Layer', value: allLayer, options: [...(allLayer ? [] : [['', 'Mixed']]), ...layers.map((l) => [l, l])], onSet: (v) => { if (v) this.app.edit(`Drawings to ${v}`, (p) => { for (const d of p.board.drawings) if (ids.has(d.id)) d.layer = v; }); } }),
        one?.type === 'text' ? stripText({ label: 'Text', value: one.text, onSet: (v) => { if (v.trim()) this.editDrawing(one.id, 'Edit text', (d) => { d.text = v.trim(); }); } }) : null,
        one?.type === 'text' ? stripNumber({ label: 'Size', value: fmt(one.size), unit: 'mm', step: '0.1', min: '0.1', width: 56, onSet: (v) => this.editDrawing(one.id, 'Text size', (d) => { d.size = mm(Math.max(0.1, v)); }) }) : null,
        stripButton({ icon: 'rotateLeft', title: `Rotate ${this.rotStep}° anticlockwise (R)`, onClick: () => this.rotateSel(this.rotStep) }),
        stripButton({ icon: 'rotateRight', title: `Rotate ${this.rotStep}° clockwise (Shift+R)`, onClick: () => this.rotateSel(-this.rotStep) }),
        stripButton({ icon: 'flip', label: 'Flip', title: 'Flip to the other side (F)', onClick: () => this.flipSel() }),
        stripSep(), del(drawings.length === 1 ? 'Delete' : 'Delete them'), stripSep(), propsBtn()]);
      return;
    }
    if (fps.length) {
      const one = fps.length === 1 ? fps[0] : null;
      const ref = (f) => bfRef(this.project, f) || '?';
      const locked = fps.every((f) => f.locked);
      const props = this.cards?.card('props');
      s.show(`fp|${fps.map((f) => `${f.id}:${f.rot}:${f.side}:${!!f.locked}`).join(';')}|${this.rotStep}|${shapes.length}|${!!props?.isOpen}`, () => [
        stripLabel(one ? `${ref(one)}${one.side === 'B' ? ' (back)' : ''}` : `${fps.length} footprints`, 'pad'), stripSep(),
        stripButton({ icon: 'rotateLeft', title: locked ? 'Locked: unlock to rotate' : `Rotate ${this.rotStep}° anticlockwise (R)`, disabled: locked, onClick: () => this.rotateSel(this.rotStep) }),
        stripButton({ icon: 'rotateRight', title: locked ? 'Locked: unlock to rotate' : `Rotate ${this.rotStep}° clockwise (Shift+R)`, disabled: locked, onClick: () => this.rotateSel(-this.rotStep) }),
        stripSelect({ label: 'Rotation step', showLabel: false, value: this.rotStep, disabled: locked, options: [90, 45, 30, 15, 10, 5, 1].map((d) => [d, `${d}°`]), title: 'How far R and the rotate buttons turn', onSet: (v) => { this.rotStep = +v; pref.set('boardRotStep', this.rotStep); this.refresh(); } }),
        one ? stripNumber({ label: 'Angle', value: +one.rot.toFixed(2), unit: '°', step: '1', min: '-360', max: '360', width: 62, disabled: locked, title: locked ? 'Locked: unlock to change the angle' : 'The exact rotation (anticlockwise)', onSet: (v) => this.app.edit(`Rotate ${ref(one)} to ${v}°`, (p) => setFootprintRotation(p, one.id, v)) }) : null,
        stripSep(),
        stripButton({ icon: 'flip', label: 'Flip', title: locked ? 'Locked: unlock to flip' : `Flip to the ${one?.side === 'B' ? 'front' : 'other side'} (F)`, disabled: locked, onClick: () => this.flipSel() }),
        stripButton({ icon: locked ? 'unlock' : 'lock', label: locked ? 'Unlock' : 'Lock', active: locked, title: `${locked ? 'Unlock' : 'Lock'}: a locked footprint doesn't move (L)`, onClick: () => this.lockSel() }),
        stripSep(), propsBtn()]);
      return;
    }
    if (tracks.length || vias.length) {
      const one = (xs, k) => (xs.length && xs.every((x) => x[k] === xs[0][k]) ? xs[0][k] : null);
      const ids = tracks.map((x) => x.id), vids = vias.map((x) => x.id);
      const w = one(tracks, 'width'), lay = one(tracks, 'layer');
      s.show(`copper|${pOpen}|${[...this.trackSel].join()}|${w}|${lay}|${one(vias, 'drill')}|${one(vias, 'diameter')}`, () => [
        stripLabel([tracks.length ? `${tracks.length} track${tracks.length === 1 ? '' : 's'}` : '', vias.length ? `${vias.length} via${vias.length === 1 ? '' : 's'}` : ''].filter(Boolean).join(', '), tracks.length ? 'route' : 'via'), stripSep(),
        tracks.length ? stripNumber({ label: 'Width', value: w == null ? null : fmt(w), placeholder: 'mixed', unit: 'mm', step: '0.01', min: '0.01', onSet: (v) => { try { this.app.edit('Track width', (p) => setTrackWidth(p, ids, mm(v))); } catch (e) { toast(e.message, 'error', 3000); } } }) : null,
        tracks.length ? stripSelect({ label: 'Layer', value: lay || '', options: [...(lay ? [] : [['', 'Mixed']]), ...copper.map((l) => [l, l])], onSet: (v) => { if (v) this.app.edit(`Tracks to ${v}`, (p) => setTrackLayer(p, ids, v)); } }) : null,
        vias.length ? stripNumber({ label: 'Via', value: one(vias, 'drill') == null ? null : fmt(one(vias, 'drill')), placeholder: 'mixed', unit: '/', step: '0.05', min: '0.05', width: 56, title: 'Via drill (mm)', onSet: (v) => { try { this.app.edit('Via drill', (p) => setViaSize(p, vids, { drill: mm(v) })); } catch (e) { toast(e.message, 'error', 3000); } } }) : null,
        vias.length ? stripNumber({ label: '', value: one(vias, 'diameter') == null ? null : fmt(one(vias, 'diameter')), placeholder: 'mixed', unit: 'mm', step: '0.05', min: '0.1', width: 56, title: 'Via diameter (mm)', onSet: (v) => { try { this.app.edit('Via diameter', (p) => setViaSize(p, vids, { diameter: mm(v) })); } catch (e) { toast(e.message, 'error', 3000); } } }) : null,
        stripSep(),
        stripButton({ icon: 'wire', label: 'Connection', title: 'Select the whole connection: every track and via joined to these (U)', onClick: () => this.selectConnection() }),
        del('Delete'), stripSep(), propsBtn()]);
      return;
    }
    if (zones.length) {
      const z = zones.length === 1 ? zones[0] : null;
      const nets = [...new Set([...padNets(this.board).values()].filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      if (z?.net && !nets.some((n) => n.toLowerCase() === z.net.toLowerCase())) nets.unshift(z.net);
      const set = (label, fn) => this.app.edit(label, (p) => fn(p.board.zones.find((q) => q.id === z.id)));
      s.show(`zone-sel|${pOpen}|${zones.map((q) => `${q.id}:${q.net}:${q.layer}:${q.priority}:${q.connect}`).join(';')}`, () => [
        stripLabel(z ? `Zone on ${z.layer}` : `${zones.length} zones`, 'zone'), stripSep(),
        z ? stripSelect({ label: 'Net', value: nets.find((n) => n.toLowerCase() === (z.net || '').toLowerCase()) || '', options: [['', '(no net)'], ...nets.map((n) => [n, n])], onSet: (v) => set(`Zone net ${v || '(none)'}`, (q) => { q.net = v; }) }) : null,
        z ? stripSelect({ label: 'Layer', value: z.layer, options: copper.map((l) => [l, l]), onSet: (v) => set(`Zone to ${v}`, (q) => { q.layer = v; }) }) : null,
        z ? stripNumber({ label: 'Priority', value: z.priority, step: '1', min: '0', width: 48, onSet: (v) => set('Zone priority', (q) => { q.priority = Math.max(0, Math.round(v)); }) }) : null,
        z ? stripSegmented({ label: 'Pads', value: z.connect === 'solid' ? 'solid' : 'thermal', items: [['thermal', 'Thermal', 'Same-net pads join through thermal reliefs'], ['solid', 'Solid', 'Same-net pads are joined solid']], onPick: (id) => set(`Pads ${id}`, (q) => { q.connect = id; }) }) : null,
        stripSep(), del(zones.length === 1 ? 'Delete the zone' : 'Delete the zones'), stripSep(), propsBtn()]);
      return;
    }
    if (shapes.length) {
      const kind = { rect: 'Rectangle', circle: 'Circle', line: 'Line', arc: 'Arc' };
      s.show(`outline-sel|${pOpen}|${[...this.selection].join()}`, () => [stripLabel(shapes.length === 1 ? `${kind[shapes[0].type] || 'Shape'} on Edge.Cuts` : `${shapes.length} outline shapes`, 'outline'), stripSep(), del('Delete'), stripSep(), propsBtn()]);
      return;
    }
    s.hide();
  }

  // ---------------------------------------------------------------- DRC (#25)

  /** Run DRC (after any Zone refill in progress) and show the results in the DRC card. */
  async runDrc() {
    this.drcCard.toggle(true);
    this.drcRunning = true;
    this.renderDrc();
    await this.whenZonesFilled();
    this.drc = { list: runDrc(this.project, this.zoneFiller.fills), rev: this._rev() };
    this._drcBase();
    this.drcRunning = false;
    this.drcFocus = null;
    this.renderDrc();
    this.ws?.view.invalidate();
    const c = drcCounts(unapproved(this._drcList()));
    toast(c.error || c.warning ? `DRC: ${[c.error ? `${c.error} error${c.error === 1 ? '' : 's'}` : '', c.warning ? `${c.warning} warning${c.warning === 1 ? '' : 's'}` : ''].filter(Boolean).join(', ')}.` : 'DRC: no problems.', c.error ? 'error' : 'info', 2200);
    return this.drc.list;
  }

  // ---------------------------------------------------------------- live DRC (#85)

  /** What the DRC results were made from: the items' boxes and the Zone fills. */
  _drcBase() {
    this._drcItems = boardItems(this.project);
    this._drcFillsSeen = new Map(this.zoneFiller.fills);
    this._drcAreasWaiting = [];
  }

  /**
   * After an edit (refresh): re-check at once the areas it changed and merge the results; a change
   * that reaches the whole board waits for the background run. Either way a full run follows a
   * pause in editing.
   */
  _liveDrc() {
    if (!this.drc || this.drcRunning || !this._drcItems) return;
    const r = this._rev();
    if (!this.drc.rev.some((x, i) => x !== r[i])) return;
    const next = boardItems(this.project);
    const ch = changedAreas(this._drcItems, next);
    this._drcItems = next;
    if (!ch.full && ch.areas.length) {
      this.drc = { list: mergeDrc(this.drc.list, runDrc(this.project, this.zoneFiller.fills, { areas: ch.areas, rats: this._rats }), ch.areas), rev: r };
      if (this.zoneFiller.busy) this._drcAreasWaiting.push(...ch.areas); // looked at again once the zones have refilled
    } else if (ch.full) { this.drc.rev = r; this._drcNeedsFull = true; }
    else this.drc.rev = r;
    if (this.drcFocus && !this.drc.list.some((v) => v.id === this.drcFocus)) this.drcFocus = null; // fixed
    this._scheduleFullDrc(ch.full ? 0 : 1500);
  }

  /** New Zone fills: re-check where they changed, and the areas edited while they were refilling. */
  _liveDrcFills() {
    if (!this.drc || this.drcRunning || !this._drcFillsSeen) return;
    const areas = [...this._drcAreasWaiting];
    for (const z of this.board.zones || []) {
      if (this.zoneFiller.fills.get(z.id) === this._drcFillsSeen.get(z.id)) continue;
      const xs = z.outline.map((q) => q[0]), ys = z.outline.map((q) => q[1]);
      areas.push({ x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) });
    }
    this._drcFillsSeen = new Map(this.zoneFiller.fills);
    if (this.zoneFiller.busy) return;
    this._drcAreasWaiting = [];
    if (!areas.length) { this.renderDrc(); return; }
    this.drc = { list: mergeDrc(this.drc.list, runDrc(this.project, this.zoneFiller.fills, { areas, rats: this._rats }), areas), rev: this.drc.rev };
    if (this.drcFocus && !this.drc.list.some((v) => v.id === this.drcFocus)) this.drcFocus = null;
    this.renderDrc();
    this.ws?.view.invalidate();
  }

  /** A full DRC in the background after `ms` of no edits: the safety net, and for board-wide changes. */
  _scheduleFullDrc(ms) {
    clearTimeout(this._drcTimer);
    this._drcTimer = setTimeout(async () => {
      await this.whenZonesFilled();
      const rev = this._rev(), seq = (this._drcSeq = (this._drcSeq || 0) + 1);
      const project = this.project, fills = this.zoneFiller.fills;
      let list;
      try { list = await this._drcInWorker(seq, project, fills); } catch { list = runDrc(project, fills); }
      const now = this._rev();
      if (seq !== this._drcSeq || !this.drc || rev.some((x, i) => x !== now[i])) return; // an edit since: its own run follows
      this.drc = { list, rev };
      this._drcBase();
      this._drcNeedsFull = false;
      if (this.drcFocus && !list.some((v) => v.id === this.drcFocus)) this.drcFocus = null;
      this.renderDrc();
      this.ws?.view.invalidate();
    }, ms);
  }

  _drcInWorker(seq, project, fills) {
    if (this._drcWorker === null || typeof Worker === 'undefined') return Promise.resolve(runDrc(project, fills));
    try { this._drcWorker ||= new Worker(new URL('./drcWorker.js', import.meta.url), { type: 'module' }); } catch { this._drcWorker = null; return Promise.resolve(runDrc(project, fills)); }
    return new Promise((resolve, reject) => {
      this._drcWorker.onmessage = (e) => { if (e.data.seq === seq) (e.data.error ? reject(new Error(e.data.error)) : resolve(e.data.list)); };
      this._drcWorker.onerror = (e) => { this._drcWorker = null; reject(e); };
      this._drcWorker.postMessage({ seq, project, fills: [...fills] });
    });
  }

  /** Whether a re-check is still to come: zones refilling, or a board-wide change waiting for the full run. */
  _drcRechecking() { return !!this.drc && (this._drcNeedsFull || (this.zoneFiller.busy && this._drcAreasWaiting?.length > 0)); }

  /** A number that changes with every edit (to tell when the DRC results are out of date). */
  _rev() { const hs = this.app.history; return [hs.undoStack[hs.undoStack.length - 1] || null, hs.redoStack?.[hs.redoStack.length - 1] || null, this.project.id]; }
  _drcStale() { const r = this._rev(); return !!this.drc && this.drc.rev.some((x, i) => x !== r[i]); }

  /** The DRC results, each approved one marked (#69); worked out again when the list or the Board changes. */
  _drcList() {
    const list = this.drc?.list || [], rev = this._rev();
    if (this._drcMarked?.list !== list || this._drcMarked.rev !== rev) this._drcMarked = { list, rev, marked: markApproved(this.project, list) };
    return this._drcMarked.marked;
  }

  _drcShown() { return this._drcList().filter((v) => this.drcFilter[v.severity] && (!v.approval || this.drcShowApproved)); }

  /** Approve a DRC problem (#69), asking for an optional note. */
  approveViolation(v) {
    const m = modal({ title: 'Approve this problem', width: 440 });
    const note = h('textarea', { class: 'input', rows: 3, placeholder: 'Why it\'s fine (optional), e.g. "Built and tested; JLCPCB made it as drawn"', 'aria-label': 'Note' });
    note.addEventListener('keydown', (e) => e.stopPropagation());
    const ok = () => { m.close(); this.app.edit('Approve DRC problem', (p) => approve(p, v, note.value)); this.drcFocus = null; this.renderDrc(); this.ws?.view.invalidate(); };
    m.body.append(h('p', { class: 'side-note' }, v.message),
      h('label', { class: 'field' }, h('span', {}, 'Note'), note),
      h('p', { class: 'side-note' }, 'Approved problems are hidden and don\'t count. Moving, resizing or re-netting what it\'s about brings it back.'),
      h('div', { class: 'modal-actions' }, button({ label: 'Cancel', cls: 'btn-ghost', onClick: () => m.close() }), button({ label: 'Approve', icon: 'check', cls: 'btn-primary', onClick: ok })));
    note.focus();
  }

  unapproveViolation(v) {
    this.app.edit('Unapprove DRC problem', (p) => unapprove(p, v.approval.key));
    this.renderDrc(); this.ws?.view.invalidate();
  }

  renderDrc() {
    const el = this.drcEl;
    if (!el || !this.drcCard?.isOpen) return;
    const all = this._drcList(), list = unapproved(all);
    const nApproved = all.length - list.length;
    const c = drcCounts(list);
    const chip = (sev, label) => h('button', { class: `erc-chip erc-chip-${sev}` + (this.drcFilter[sev] ? ' on' : ''), type: 'button', 'aria-pressed': String(this.drcFilter[sev]), title: `Show ${label.toLowerCase()}`, dataset: { severity: sev },
      onClick: () => { this.drcFilter[sev] = !this.drcFilter[sev]; this.renderDrc(); this.ws?.view.invalidate(); } }, h('span', { class: 'erc-dot' }), label, h('span', { class: 'erc-n' }, String(c[sev])));
    const stale = this._drcRechecking();
    const head = h('div', { class: 'erc-filter' },
      h('div', { class: 'drc-run' },
        h('span', { class: 'drc-sum' }, this.drcRunning ? 'Running… (waiting for zone fills)' : !this.drc ? 'Not run yet' : c.error || c.warning ? `${c.error} error${c.error === 1 ? '' : 's'} · ${c.warning} warning${c.warning === 1 ? '' : 's'}` : 'No problems'),
        button({ label: this.drc ? 'Run again' : 'Run', icon: 'play', cls: 'btn-outline btn-xs', title: 'Run DRC again (clears the old markers)', onClick: () => this.runDrc() })),
      stale ? h('div', { class: 'drc-stale' }, icon('info', 14), h('span', {}, this._drcNeedsFull ? 'Re-checking the whole board…' : 'Re-checking near the zones as they refill…')) : null,
      h('div', { class: 'erc-chips', role: 'group', 'aria-label': 'Show' }, chip('error', 'Errors'), chip('warning', 'Warnings'),
        nApproved ? h('button', { class: 'erc-chip erc-chip-approved' + (this.drcShowApproved ? ' on' : ''), type: 'button', 'aria-pressed': String(this.drcShowApproved), title: 'Show the problems approved as fine (they don\'t count)', onClick: () => { this.drcShowApproved = !this.drcShowApproved; this.renderDrc(); this.ws?.view.invalidate(); } }, icon('check', 12), `${nApproved} approved`) : null));
    const shown = this._drcShown();
    const label = Object.fromEntries(DRC_RULES);
    const act = (v) => (v.rule === 'annotation' ? null : v.approval
      ? button({ label: 'Unapprove', cls: 'btn-ghost btn-xs drc-approve', title: 'Count this problem again', onClick: (e) => { e.stopPropagation(); this.unapproveViolation(v); } })
      : button({ icon: 'check', cls: 'btn-ghost btn-xs drc-approve', title: 'Approve: it\'s fine as it is (hidden, not counted)', 'aria-label': 'Approve', onClick: (e) => { e.stopPropagation(); this.approveViolation(v); } }));
    const row = (v) => h('div', { class: `erc-row erc-${v.severity}` + (v.id === this.drcFocus ? ' on' : '') + (v.approval ? ' approved' : ''), role: 'button', tabindex: '0', dataset: { rule: v.rule }, title: v.at ? 'Show it on the board' : v.rule === 'annotation' ? 'Update from Schematic' : '',
      onClick: () => this.gotoViolation(v), onKeydown: (e) => { if (e.key === 'Enter') this.gotoViolation(v); },
      onMouseenter: () => { this.drcHover = v.id; this.ws?.view.invalidate(); }, onMouseleave: () => { if (this.drcHover === v.id) { this.drcHover = null; this.ws?.view.invalidate(); } } },
      h('span', { class: 'erc-dot', 'aria-label': v.severity }),
      h('span', { class: 'erc-msg' }, h('b', { class: 'drc-rule' }, `${v.approval ? 'Approved · ' : ''}${label[v.rule]}${v.layer ? ` · ${v.layer}` : ''}`), ' ', v.message, v.approval?.note ? h('em', { class: 'drc-note' }, ` “${v.approval.note}”`) : ''),
      act(v));
    const empty = this.drcRunning || !this.drc ? null : !list.length && !nApproved ? 'Every rule is met, everything is routed and the Board matches the Schematic.' : !shown.length ? (nApproved && !list.length ? `No problems left: ${nApproved} approved.` : 'Everything is filtered out.') : null;
    // the list is rebuilt on every refresh: keep where it was scrolled to, and the focused row in view
    const old = el.querySelector('.drc-list'), top = old ? old.scrollTop : 0;
    const box = h('div', { class: 'fp-body drc-list' }, empty ? h('p', { class: 'side-note erc-clean' }, empty) : '', ...shown.map(row));
    el.replaceChildren(head, box);
    box.scrollTop = top;
    const on = box.querySelector('.erc-row.on');
    if (on) { const r = on.getBoundingClientRect(), b = box.getBoundingClientRect(); if (r.top < b.top || r.bottom > b.bottom) on.scrollIntoView({ block: 'nearest' }); }
  }

  /** Zoom to a violation and select what it's about. */
  gotoViolation(v) {
    this.drcFocus = v.id;
    if (v.rule === 'annotation') { this.annotate(); this.renderDrc(); return; }
    if (v.box && this.ws) {
      const b = v.box, w = Math.max(b.x1 - b.x0, 6e6), hh = Math.max(b.y1 - b.y0, 6e6), cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
      this.ws.view.view.fit({ x0: cx - w * 0.75, y0: cy - hh * 0.75, x1: cx + w * 0.75, y1: cy + hh * 0.75 }, this.ws.view.w, this.ws.view.h, 30);
    }
    const ids = new Set(v.items);
    this.trackSel = new Set([...(this.board.tracks || []), ...(this.board.vias || [])].filter((t) => ids.has(t.id)).map((t) => t.id));
    this.fpSel = new Set(this.board.footprints.filter((f) => ids.has(f.id)).map((f) => f.id));
    this.zoneSel = new Set((this.board.zones || []).filter((z) => ids.has(z.id)).map((z) => z.id));
    this.selection.clear(); this.netSel.clear();
    if (v.rule === 'unrouted' && v.items[0]) this.netSel = new Set([v.items[0]]);
    if (v.layer && /\.Cu$/.test(v.layer) && this.hidden.has(v.layer)) { this.hidden.delete(v.layer); pref.set('boardHidden', [...this.hidden]); }
    this.refresh();
  }

  /** Board setup: Fab preset, Design rules, Fab output and Net classes (#24). */
  setup(tab) { return openBoardSetup(this.app, { tab }); }

  /** Forward annotation: list what the Schematic changes on the Board, then apply it in one step. */
  annotate() { openAnnotateDialog(this.app); }

  /** Origin tool: move the grid origin to `w`, onto another object's handle when close, else the grid. */
  placeOrigin(w) {
    const at = this.snapAt(w, new Set(), this.board.origin);
    this.snapMark = null;
    this.app.edit('Move grid origin', (p) => { p.board.origin = [...at]; });
    this.setTool('select');
  }

  /** A click of a drawing tool at grid point `p`. */
  click(p) {
    const t = this.tool;
    if (t === 'text') {
      const text = String(this.drawText || '').trim() || 'TEXT';
      this.addDrawing('Add text', { type: 'text', text, at: p, size: this.drawSize, rot: 0 });
      return;
    }
    if (t === 'gline') {
      if (!this.pts?.line) { this.pts = { line: [p] }; this.refresh(); return; }
      const L = this.pts.line;
      if (!same(p, L[L.length - 1])) L.push(p);
      this.refresh();
      return;
    }
    if (t === 'grect' || t === 'gcircle') {
      if (!this.pts) { this.pts = [p]; this.refresh(); return; }
      const a = this.pts[0];
      this.pts = null;
      const fill = this.drawFill ? { fill: 'outline' } : {};
      if (t === 'grect' && a[0] !== p[0] && a[1] !== p[1]) this.addDrawing('Add rectangle', { type: 'rect', a: [Math.min(a[0], p[0]), Math.min(a[1], p[1])], b: [Math.max(a[0], p[0]), Math.max(a[1], p[1])], ...this._penWidth(), ...fill });
      else if (t === 'gcircle' && !same(a, p)) this.addDrawing('Add circle', { type: 'circle', c: a, r: Math.round(Math.hypot(p[0] - a[0], p[1] - a[1])), ...this._penWidth(), ...fill });
      else this.refresh();
      return;
    }
    if (t === 'measure') {
      if (!this.measure || this.measure.done) this.measure = { a: p, b: p, done: false };
      else { this.measure.b = p; this.measure.done = true; }
      this.refresh();
      return;
    }
    if (t === 'outline') {
      if (!this.pts) { this.pts = [p]; this.refresh(); return; }
      const a = this.pts[0];
      this.pts = null;
      if (a[0] !== p[0] && a[1] !== p[1]) this.addOutline('Outline rectangle', rectOutline(a, p, this.radius));
      else this.refresh();
      return;
    }
    if (t === 'circle') {
      if (!this.pts) { this.pts = [p]; this.refresh(); return; }
      const cpt = this.pts[0];
      this.pts = null;
      const r = Math.hypot(p[0] - cpt[0], p[1] - cpt[1]);
      if (r) this.addOutline('Outline circle', circleOutline(cpt, r)); else this.refresh();
      return;
    }
    if (t === 'zone') {
      // this.pts: { zone: [corner points] }
      if (!this.pts) { this.pts = { zone: [p] }; this.refresh(); return; }
      const Z = this.pts.zone;
      if (Z.length >= 3 && same(p, Z[0])) { this.closeZone(); return; }
      if (!same(p, Z[Z.length - 1])) Z.push(p);
      this.refresh();
      return;
    }
    if (t === 'polygon') {
      // this.pts: { start, steps: [{ to } | { mid, to }], mid? (an arc side waiting for its end) }
      if (!this.pts) { this.pts = { start: p, steps: [] }; this.refresh(); return; }
      const P = this.pts;
      const last = P.steps.length ? P.steps[P.steps.length - 1].to : P.start;
      if (this.arcNext && !P.mid) { if (!same(p, last)) P.mid = p; this.refresh(); return; }
      if (same(p, last)) { this.refresh(); return; }
      P.steps.push(P.mid ? { mid: P.mid, to: p } : { to: p });
      P.mid = null; this.arcNext = false;
      if (same(p, P.start) && P.steps.length >= 2) { this.pts = null; this.addOutline('Outline polygon', polygonOutline(P.start, P.steps)); return; }
      this.refresh();
    }
  }

  /** The pen width for new shapes: the strip's, else the layer's default. */
  _penWidth() { return { width: this.drawWidth ?? defaultWidth(this.drawLayer) }; }

  /** Add one Board drawing on the drawing layer (one undo step) and select it. */
  addDrawing(label, d) {
    const id = uid('d');
    this.app.edit(label, (p) => { p.board.drawings = [...(p.board.drawings || []), { id, layer: this.drawLayer, ...d }]; });
    if (this.tool === 'text') { this.refresh(); return; } // keep placing; each one is selectable after
    this.refresh();
  }

  /** Finish the line being drawn (Enter or double-click). */
  finishLine() {
    const L = this.pts?.line || [];
    this.pts = null;
    if (L.length >= 2) this.addDrawing('Add line', { type: 'line', pts: L, ...this._penWidth() });
    else this.refresh();
  }

  /** Change one Board drawing (one undo step). */
  editDrawing(id, label, fn) {
    this.app.edit(label, (p) => { const d = (p.board.drawings || []).find((q) => q.id === id); if (d) fn(d, p); });
  }

  /** The shapes the drawing tools show at the cursor. */
  _ghost() {
    const cur = this.cursor;
    if (this.tool === 'gline' && this.pts?.line) {
      const L = this.pts.line, pts = cur && !same(cur, L[L.length - 1]) ? [...L, cur] : L;
      return { ghost: pts.length > 1 ? [{ type: 'line', pts }] : [], ghostPts: L };
    }
    if ((this.tool === 'grect' || this.tool === 'gcircle') && this.pts && cur) {
      const a = this.pts[0];
      return { ghost: this.tool === 'grect' ? [{ type: 'rect', a, b: cur }] : [{ type: 'circle', c: a, r: Math.hypot(cur[0] - a[0], cur[1] - a[1]) }], ghostPts: [a] };
    }
    if (!this.pts) return {};
    if (this.tool === 'outline' && cur) return { ghost: rectOutline(this.pts[0], cur, this.radius), ghostPts: [this.pts[0]] };
    if (this.tool === 'circle' && cur) { const r = Math.hypot(cur[0] - this.pts[0][0], cur[1] - this.pts[0][1]); return { ghost: r ? circleOutline(this.pts[0], r) : [], ghostPts: [this.pts[0]] }; }
    if (this.tool === 'zone' && this.pts.zone) {
      const Z = this.pts.zone;
      const pts = cur && !same(cur, Z[Z.length - 1]) ? [...Z, cur] : Z;
      return { ghost: pts.length > 1 ? [{ type: 'line', pts: [...pts, ...(pts.length > 2 ? [Z[0]] : [])] }] : [], ghostPts: Z, closeAt: Z.length >= 3 && same(cur, Z[0]) ? Z[0] : null };
    }
    if (this.tool === 'polygon') {
      const P = this.pts;
      const steps = [...P.steps];
      if (cur) {
        if (P.mid) steps.push(same(cur, P.mid) ? { to: cur } : { mid: P.mid, to: cur });
        else if (!this.arcNext) steps.push({ to: cur });
      }
      const ghostPts = [P.start, ...P.steps.map((s) => s.to), ...(P.mid ? [P.mid] : [])];
      return { ghost: polygonOutline(P.start, steps.filter((s, i) => !same(s.to, i ? steps[i - 1].to : P.start))), ghostPts, closeAt: P.steps.length >= 2 && same(cur, P.start) ? P.start : null };
    }
    return {};
  }

  draw(ctx, view, C) {
    const board = { ...this.board, tracks: this.routeView?.shoved || this.trackDrag?.result?.tracks || this.previewTracks || this.board.tracks, vias: this.routeView?.shovedVias || this.trackDrag?.result?.vias || this.previewVias || this.board.vias, outline: this.preview || this.board.outline, footprints: this.previewFps || this.board.footprints, zones: this.previewZones || this.board.zones, drawings: this.previewDrawings || this.board.drawings || [] };
    const labels = [];
    drawBoard(ctx, view, C, board, { project: this.project, fpSel: this.fpSel, rats: ((this.route || this.trackDrag) && this.liveRats || this._rats)?.wires, hidden: this.hidden, selection: this.selection, ...this._ghost(), measure: this.measure, labels, zones: { fills: this.zoneFiller.fills, outlineOnly: this._zonesAsOutlines(board) } });
    if (this.routeView) this._drawRoute(ctx, view, C);
    drawLabels(labels);
    // the Text tool: the text it would place, at the cursor
    if (this.tool === 'text' && this.cursor) drawBoardDrawings(ctx, view, C, board, new Set(), { list: [{ id: 'ghost', type: 'text', layer: this.drawLayer, text: String(this.drawText || '').trim() || 'TEXT', at: this.cursor, size: this.drawSize, rot: 0 }], color: C.selection }); // names, values and pad numbers over all the copper, the track being routed too
    // the selection, highlighted in the style chosen in Settings (the same in every editor)
    if (this.selection.size || this.fpSel.size || this.netSel.size || this.trackSel.size || this.zoneSel.size || this.drawSel.size) {
      const t = this.netSel.size ? boardTargets({ ...this.project, board }, probeFromBoard(this.project, [], [...this.netSel])) : null;
      this._highlightBoard(ctx, view, C, board, this.selection, this.fpSel, t?.pads, C, false, new Set([...this.trackSel, ...this.zoneSel, ...this.drawSel, ...(t?.copper || [])]));
    }
    // the Schematic's selection (cross-probing), in the theme's Highlight colour
    const probe = this.app.probeFor('board');
    if (probe) {
      const t = boardTargets({ ...this.project, board }, probe);
      const fps = new Set([...t.footprints].filter((id) => !this.fpSel.has(id)));
      const copper = new Set([...t.copper].filter((id) => !this.trackSel.has(id)));
      if (fps.size || t.pads.size || copper.size) this._highlightBoard(ctx, view, C, board, new Set(), fps, t.pads, { ...C, selection: C.highlight || C.selection }, this.selection.size || this.fpSel.size, copper);
    }
    // the Rip up tool: what a click or the box would take, in the error colour
    if (this.tool === 'ripup' && this.ripHover?.size) this._highlightBoard(ctx, view, C, board, new Set(), new Set(), null, { ...C, selection: C.drcError || '#ff3b6b' }, false, this.ripHover);
    this._drawDrc(ctx, view, C); // over the highlights, so the focused problem shows
    drawHandles(ctx, view, C, this._handles(), this.handleDrag?.key);
    drawSnapMark(ctx, view, C, this.snapMark);
    // a box being dragged: solid for a window (wholly inside), dashed for a crossing box (touching)
    const m = this.marquee;
    if (m?.moved) {
      const [x0, y0] = view.toScreen(m.a), [x1, y1] = view.toScreen(m.b);
      const col = m.rip ? (C.drcError || '#ff3b6b') : C.selection;
      ctx.save();
      ctx.fillStyle = col; ctx.globalAlpha = 0.1; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      ctx.globalAlpha = 1; ctx.strokeStyle = col; ctx.lineWidth = 1;
      if (m.b[0] < m.a[0]) ctx.setLineDash([5, 4]);
      ctx.strokeRect(Math.round(x0) + 0.5, Math.round(y0) + 0.5, x1 - x0, y1 - y0);
      ctx.restore();
    }
  }

  /** DRC markers while the DRC card is open: a badge at each shown violation, the focused one ringed. */
  _drawDrc(ctx, view, C) {
    if (!this.drc || !this.drcCard?.isOpen) return;
    const shown = this._drcShown();
    const lit = shown.find((v) => v.id === this.drcHover) || shown.find((v) => v.id === this.drcFocus);
    ctx.save();
    // every shown problem: its items lightly outlined, and a badge
    for (const v of shown) {
      const col = v.severity === 'error' ? (C.drcError || '#ff3b6b') : (C.ercWarning || '#ffb74d');
      if (v.show && v !== lit) drawDrcShow(ctx, view, C, v, col, false);
      if (!v.at) continue;
      const [x, y] = view.toScreen(v.at);
      ctx.fillStyle = col; ctx.strokeStyle = C.background || '#000'; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.95;
      const r = 6;
      ctx.beginPath(); ctx.moveTo(x, y - r * 1.7); ctx.lineTo(x + r, y); ctx.lineTo(x - r, y); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = '700 9px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('!', x, y - r * 0.55);
    }
    // the focused (or hovered) one (#80): its items, the gap and the clearance needed, over the
    // board as it is (not dimmed)
    if (lit?.show) {
      ctx.globalAlpha = 1;
      drawDrcShow(ctx, view, C, lit, lit.severity === 'error' ? (C.drcError || '#ff3b6b') : (C.ercWarning || '#ffb74d'), true);
    }
    ctx.restore();
  }

  /**
   * Zones drawn as outlines: while a drag or route is in progress, those it touches (their fill
   * would change); otherwise those waiting for a refill. Their fill comes back when it's ready.
   */
  _zonesAsOutlines(board) {
    if (!board.zones?.length) return new Set();
    if (this.drag?.moved || this.handleDrag?.moved || this.routeView) {
      const extra = (this.routeView?.segments || []).map((sg, i) => ({ id: `route${i}`, a: sg.a, b: sg.b, width: this.route.width, layer: sg.layer || this.route.layer, net: this.route.net }));
      return this.zoneFiller.staleIds(zoneInput(this.project, board, extra));
    }
    return new Set(this.zoneFiller.pending.keys());
  }

  /** The track being routed: its segments in the layer's colour, those too close to other Nets in the DRC colour, and what they hit outlined. */
  _drawRoute(ctx, view, C) {
    const { segments, collisions } = this.routeView, st = this.route;
    const bad = C.drcError || '#ff3b6b';
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // the clearance it must keep, as a faint band, then the copper
    for (const pass of ['band', 'copper']) {
      for (const sg of segments) {
        const [x0, y0] = view.toScreen(sg.a);
        if (pass === 'band') { ctx.globalAlpha = sg.collides ? 0.4 : 0.18; ctx.strokeStyle = sg.collides ? bad : C.selection; ctx.lineWidth = Math.max(2, (st.width + 2 * this.board.rules.clearance) * view.scale); }
        else { ctx.globalAlpha = sg.fixed ? 0.95 : 0.8; ctx.strokeStyle = sg.collides ? bad : C[sg.layer || st.layer] || '#c33'; ctx.lineWidth = Math.max(1, st.width * view.scale); }
        ctx.beginPath(); ctx.moveTo(x0, y0);
        if (sg.mid) trackPoints(sg, 0.2 / view.scale).slice(1).forEach((q) => ctx.lineTo(...view.toScreen(q))); // an arc (#94)
        else ctx.lineTo(...view.toScreen(sg.b));
        ctx.stroke();
      }
    }
    // the vias dropped so far
    ctx.globalAlpha = 1;
    for (const v of st.vias || []) {
      const [x, y] = view.toScreen(v.at);
      ctx.fillStyle = C.via || '#c8c8c8'; ctx.beginPath(); ctx.arc(x, y, Math.max(2, (st.via.diameter / 2) * view.scale), 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = C.drill || '#000'; ctx.beginPath(); ctx.arc(x, y, Math.max(1, (st.via.drill / 2) * view.scale), 0, Math.PI * 2); ctx.fill();
    }
    // the airwire's other end, when routing one (#90): where to finish
    if (st.target) {
      const [x, y] = view.toScreen(st.target), k = 7;
      ctx.globalAlpha = 0.9; ctx.strokeStyle = C.selection; ctx.lineWidth = 2; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.arc(x, y, k + 3, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(x - k, y); ctx.lineTo(x + k, y); ctx.moveTo(x, y - k); ctx.lineTo(x, y + k); ctx.stroke();
    }
    // the copper a click would finish on
    if (this.routeView.target) {
      const [x, y] = view.toScreen(this.routeView.target.at);
      ctx.globalAlpha = 0.9; ctx.strokeStyle = C.selection; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, Math.max(6, st.width * view.scale), 0, Math.PI * 2); ctx.stroke();
    }
    // Walkaround with no way round: where it stopped, and a dashed line on to the pointer
    if (this.routeView.blocked && this.cursor) {
      const [ex, ey] = view.toScreen(this.routeView.end), [cx, cy] = view.toScreen(this.cursor);
      ctx.globalAlpha = 0.9; ctx.strokeStyle = bad; ctx.lineWidth = 1.5; ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(cx, cy); ctx.stroke(); ctx.setLineDash([]);
      const k = 5; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(ex - k, ey - k); ctx.lineTo(ex + k, ey + k); ctx.moveTo(ex + k, ey - k); ctx.lineTo(ex - k, ey + k); ctx.stroke();
    }
    ctx.globalAlpha = 1; ctx.strokeStyle = bad; ctx.lineWidth = 2; ctx.setLineDash([4, 3]);
    for (const it of collisions) {
      ctx.beginPath();
      if (it.shape.type === 'poly') it.shape.pts.map((q) => view.toScreen(q)).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      else if (it.shape.type === 'chain') { ctx.lineWidth = (it.shape.r * view.scale + 2) * 2; ctx.globalAlpha = 0.35; it.shape.pts.map((q) => view.toScreen(q)).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); ctx.lineWidth = 2; ctx.globalAlpha = 1; continue; }
      else { const [x0, y0] = view.toScreen(it.shape.a), [x1, y1] = view.toScreen(it.shape.b); const r = it.shape.r * view.scale + 2; if (x0 === x1 && y0 === y1) ctx.arc(x0, y0, r, 0, Math.PI * 2); else { ctx.lineWidth = r * 2; ctx.globalAlpha = 0.35; ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); } }
      ctx.closePath(); ctx.stroke(); ctx.lineWidth = 2; ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- keys

  onModKey() { return false; }

  onKey(e) {
    const k = e.key.toLowerCase();
    if (e.key === 'Escape') {
      if (this.pts || (this.measure && !this.measure.done)) { this.pts = null; this.arcNext = false; this.measure = null; this.refresh(); }
      else if (this.tool !== 'select') this.setTool('select');
      else if (this.selection.size || this.fpSel.size || this.netSel.size || this.trackSel.size || this.zoneSel.size || this.drawSel.size) { this.selection.clear(); this.fpSel.clear(); this.netSel.clear(); this.trackSel.clear(); this.zoneSel.clear(); this.drawSel.clear(); this.refresh(); }
      return true;
    }
    if (this.route) {
      if (e.key === 'Escape') { this.cancelRoute(); return true; }
      // / swaps to the mirrored style and keeps it for this leg, over carrying on straight
      if (e.key === '/') { this.setBend(bendOf(this.bend).mirror); this.route = { ...this.route, forced: true }; this._routeMove(); return true; }
      if (e.key.toLowerCase() === 'v') {
        const at = this.cursor || this.route.points[this.route.points.length - 1];
        const v = this._proposal(at);
        this.route = switchLayer(this.project, this.route, at, null, v.tail);
        this.activeLayer = this.route.layer;
        if (this.hidden.delete(this.activeLayer)) pref.set('boardHidden', [...this.hidden]);
        this._routeMove(); this.refresh();
        return true;
      }
      if (e.key === 'Backspace') { this._routeStepBack(); return true; }
      if (e.key === 'Enter') { this.finishRoute(); return true; }
    }
    if (this.tool === 'gline' && this.pts?.line) {
      if (e.key === 'Enter') { this.finishLine(); return true; }
      if (e.key === 'Backspace') { this.pts.line.pop(); if (!this.pts.line.length) this.pts = null; this.refresh(); return true; }
    }
    if (this.tool === 'zone' && this.pts?.zone) {
      if (e.key === 'Enter') { this.closeZone(); return true; }
      if (e.key === 'Backspace') { this.pts.zone.pop(); if (!this.pts.zone.length) this.pts = null; this.refresh(); return true; }
    }
    if (this.tool === 'polygon' && this.pts) {
      if (k === 'a') { if (!this.pts.mid) this.arcNext = !this.arcNext; this.refresh(); return true; }
      if (e.key === 'Backspace') {
        if (this.pts.mid) this.pts.mid = null;
        else if (this.pts.steps.length) this.pts.steps.pop();
        else this.pts = null;
        this.refresh();
        return true;
      }
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && (this.selection.size || this.trackSel.size || this.fpSel.size || this.zoneSel.size || this.drawSel.size)) { this.deleteSelection(); return true; }
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (arrows[e.key] && (this.selection.size || this.fpSel.size || this.zoneSel.size || this.drawSel.size || this.trackSel.size)) { const [dx, dy] = arrows[e.key]; this.nudge(dx * this.board.grid.main, dy * this.board.grid.main); return true; }
    if (this.trackSel.size && this.tool === 'select' && e.key.toLowerCase() === 'u') { this.selectConnection(); return true; }
    if (this.drawSel.size && !this.fpSel.size && this.tool === 'select') {
      if (k === 'r') { this.rotateSel(e.shiftKey ? -this.rotStep : this.rotStep); return true; }
      if (k === 'f') { this.flipSel(); return true; }
    }
    if (this.fpSel.size && this.tool === 'select') {
      if (k === 'r') { this.rotateSel(e.shiftKey ? -this.rotStep : this.rotStep); return true; }
      if (k === 'f') { this.flipSel(); return true; }
      if (k === 'l') { this.lockSel(); return true; }
    }
    for (const [id, t] of Object.entries(BOARD_TOOLS)) if (k === t.key) { this.setTool(id); return true; }
    return false;
  }
}

// ---------------------------------------------------------------- DRC highlight (#80)

/** A collision shape's outline on screen: a capsule (round-ended segment, or circle) or a polygon. */
function shapePathDrc(ctx, view, sh, grow = 0) {
  ctx.beginPath();
  if (sh.type === 'chain') { // an arc Track (#93): its capsules, one sub-path each
    for (let i = 1; i < sh.pts.length; i++) {
      const [ax, ay] = view.toScreen(sh.pts[i - 1]), [bx, by] = view.toScreen(sh.pts[i]), r = Math.max(0.5, (sh.r + grow) * view.scale);
      const ang = Math.atan2(by - ay, bx - ax);
      ctx.moveTo(ax + r * Math.cos(ang + Math.PI / 2), ay + r * Math.sin(ang + Math.PI / 2));
      ctx.arc(ax, ay, r, ang + Math.PI / 2, ang + (3 * Math.PI) / 2);
      ctx.arc(bx, by, r, ang - Math.PI / 2, ang + Math.PI / 2);
      ctx.closePath();
    }
  } else if (sh.type === 'capsule') {
    const [ax, ay] = view.toScreen(sh.a), [bx, by] = view.toScreen(sh.b), r = Math.max(0.5, (sh.r + grow) * view.scale);
    const ang = Math.atan2(by - ay, bx - ax);
    ctx.arc(ax, ay, r, ang + Math.PI / 2, ang + (3 * Math.PI) / 2);
    ctx.arc(bx, by, r, ang - Math.PI / 2, ang + Math.PI / 2);
    ctx.closePath();
  } else {
    sh.pts.forEach((q, i) => { const [x, y] = view.toScreen(q); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    ctx.closePath();
  }
}

/** Draw what a DRC result shows: its items (filled when `strong`), the needed clearance, the gap and any note. */
function drawDrcShow(ctx, view, C, v, col, strong) {
  const s = v.show;
  ctx.save();
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  // the needed clearance: a translucent halo round the first item
  if (strong && s.need && s.shapes?.[0]) {
    const sh = s.shapes[0];
    ctx.fillStyle = col; ctx.globalAlpha = 0.18;
    if (sh.type === 'capsule' || sh.type === 'chain') { shapePathDrc(ctx, view, sh, s.need); ctx.fill(); }
    else { shapePathDrc(ctx, view, sh); ctx.lineWidth = 2 * s.need * view.scale; ctx.strokeStyle = col; ctx.stroke(); ctx.fill(); }
  }
  for (const sh of s.shapes || []) {
    shapePathDrc(ctx, view, sh);
    if (strong) { ctx.globalAlpha = 0.45; ctx.fillStyle = col; ctx.fill(); }
    ctx.globalAlpha = strong ? 1 : 0.5; ctx.strokeStyle = col; ctx.lineWidth = strong ? 2 : 1.2; ctx.stroke();
  }
  // courtyards: both outlines, the overlap filled
  if (s.outlines) {
    ctx.globalAlpha = strong ? 1 : 0.5; ctx.strokeStyle = col; ctx.lineWidth = strong ? 2 : 1.2; ctx.setLineDash([5, 3]);
    for (const ring of s.outlines) { shapePathDrc(ctx, view, { type: 'poly', pts: ring }); ctx.stroke(); }
    ctx.setLineDash([]);
    ctx.globalAlpha = strong ? 0.5 : 0.25; ctx.fillStyle = col;
    for (const ring of s.overlap || []) { shapePathDrc(ctx, view, { type: 'poly', pts: ring }); ctx.fill(); }
  }
  // an unrouted connection: its airwire, thicker
  if (s.wire) {
    const [a, b] = s.wire.map((q) => view.toScreen(q));
    ctx.globalAlpha = strong ? 1 : 0.6; ctx.strokeStyle = col; ctx.lineWidth = strong ? 3 : 2;
    ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke();
  }
  // the gap: the closest points joined, with the distance
  const note = (at, text) => {
    const [x, y] = view.toScreen(at);
    ctx.globalAlpha = 1; ctx.font = '600 12px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    const w = ctx.measureText(text).width + 10;
    ctx.fillStyle = C.background || '#000'; ctx.globalAlpha = 0.9; ctx.fillRect(x + 10, y - 20, w, 18);
    ctx.globalAlpha = 1; ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.strokeRect(x + 10.5, y - 19.5, w, 18);
    ctx.fillStyle = col; ctx.fillText(text, x + 15, y - 11);
  };
  if (strong && s.gap) {
    const [ax, ay] = view.toScreen(s.gap.a), [bx, by] = view.toScreen(s.gap.b);
    ctx.globalAlpha = 1; ctx.strokeStyle = C.text || '#fff'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    ctx.fillStyle = C.text || '#fff';
    for (const [x, y] of [[ax, ay], [bx, by]]) { ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill(); }
    const mm3 = (n) => `${+(Math.max(0, n) / 1e6).toFixed(3)} mm`;
    note([(s.gap.a[0] + s.gap.b[0]) / 2, (s.gap.a[1] + s.gap.b[1]) / 2], `${s.gap.d <= 0 ? 'touching' : mm3(s.gap.d)}${s.need ? ` · ${mm3(s.need)} needed` : ''}`);
  }
  if (strong && s.label && s.labelAt) note(s.labelAt, s.label);
  ctx.restore();
}
