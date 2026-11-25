// The Board tab's editor (#15): the Layer stack, the layer panel (visibility and the active
// layer), the Outline tools and Measure. Footprints, Tracks, Vias and Zones arrive with their
// tickets. Edits go through app.edit, so they share the Project's undo history.
//
// Layer visibility and the corner radius for new rectangles are per-browser preferences, like the
// picker's view; the stack and the Outline are saved in the Project.
import { h, button, icon, toast, popupMenu } from '../ui/dom.js';
import { section } from '../workspaces/workspace.js';
import { mm, toMm } from '../core/units.js';
import {
  boardLayers, setCopperLayers, setThickness, BOARD_THICKNESSES, LAYER_HELP, copperLayerNames,
  GRID_CHOICES, gridLabel, setGrid, snapToGrid,
  rectOutline, circleOutline, polygonOutline, checkOutline, outlineBounds, hitOutline, moveOutline,
} from '../core/board.js';
import { drawBoard, drawLabels } from './render.js';
import { openAnnotateDialog } from './annotate-dialog.js';
import { openBoardSetup } from './setup-dialog.js';
import { netClassOf } from '../core/netclasses.js';
import { runDrc, drcCounts, DRC_RULES } from '../core/drc.js';
import { hitPad, footprintOutline, placedPads, padNets, hitFootprint, moveFootprints, rotateFootprints, flipFootprints, setLocked, setFootprintRotation } from '../core/footprint.js';
import { ratsnest } from '../core/ratsnest.js';
import { copperIndex, pointSeg2 } from '../core/collision.js';
import { CORNERS, ROUTE_MODES, startRoute, step as routeStep, click as routeClickAt, back as routeBack, flipPosture, commit as routeCommit, switchLayer, layerPairs } from '../core/router.js';
import { connection, setTrackWidth, setTrackLayer, setViaSize, placeVia } from '../core/copper.js';
import { validateRef, updateComponent, footprintChoices, footprintKey } from '../core/components.js';
import { allFootprints } from '../library/footprints.js';
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

const same = (a, b) => a && b && a[0] === b[0] && a[1] === b[1];

/** The palette tools that work now: key, icon, title. */
export const BOARD_TOOLS = {
  select: { icon: 'select', title: 'Select (V)', key: 'v' },
  route: { icon: 'route', title: 'Route (X): click a pad to start a track on the active copper layer, click to place corners, click a pad of the same net to finish · V drops a via and changes layer · / flips the bend · Backspace undoes a corner · Esc cancels', key: 'x' },
  via: { icon: 'via', title: 'Via: click to place a through via; it takes the net of the track or pad it lands on' },
  zone: { icon: 'zone', title: 'Zone (Z): click the corners of a copper pour on the active copper layer; click the first corner, double-click or Enter to close. Net, priority, clearance and thermal reliefs in Properties', key: 'z' },
  outline: { icon: 'outline', title: 'Outline rectangle (B): click two corners. Round the corners with Corner radius in Properties', key: 'b' },
  polygon: { icon: 'lpolygon', title: 'Outline polygon (P): click corners; A makes the next side an arc; click the first point to close', key: 'p' },
  circle: { icon: 'lellipse', title: 'Round outline or hole (C): click the centre, then the edge', key: 'c' },
  measure: { icon: 'ruler', title: 'Measure (M): click two points', key: 'm' },
  origin: { icon: 'target', title: 'Grid origin (O): click to move the origin there; it snaps onto handles. Reset it in the Grid card (toolbar)', key: 'o' },
};

const pref = {
  get(k, d) { try { const v = localStorage.getItem(`electrocad.${k}`); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(`electrocad.${k}`, JSON.stringify(v)); } catch { /* private mode */ } },
};

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
    // Zone fills, refilled in a Web Worker after each edit (only the Zones it touched)
    this.zoneFiller = new ZoneFiller(() => { this.renderProps(); this.ws?.renderBar(); this.ws?.view.invalidate(); });
    this.pair = pref.get('boardLayerPair', null); // the layers V switches between while routing (4-layer boards)
    this.routeMode = pref.get('boardRouteMode', 'walkaround'); // 'walkaround' | 'free' (Shove: #29)
    this.corner = pref.get('boardCorner', '45');            // track bends: '90' | '45' | 'any'
    this.chamfer = mm(pref.get('boardChamfer', 0));         // Eagle-style auto chamfer of 90° bends
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
  }

  get project() { return this.app.project; }
  get board() { return this.project.board; }
  /** The grid in use: the Alt grid while Alt is held. */
  get gridStep() { return this.alt ? this.board.grid.alt : this.board.grid.main; }
  snapPt(w) { return snapToGrid(w, this.gridStep, this.board.origin); }
  /**
   * Snap `w` onto another object's handle (pads come with #17) within the snap distance from
   * Settings, else to the grid. `skip`: outline indices not to snap to; `not`: a point to ignore
   * (where a dragged handle started). Remembers where it snapped, for the mark.
   */
  snapAt(w, skip = new Set(), not = null) {
    const tol = this.app.snapDistance() / (this.ws?.view.view.scale || 1);
    const targets = [...handlePoints(this.board.outline, skip), this.board.origin, ...this._padPoints()].filter((t) => !not || t[0] !== not[0] || t[1] !== not[1]);
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
      onOrigin: (at) => this.app.edit('Grid origin', (p) => { p.board.origin = at; }),
      onPick: () => this.setTool('origin'),
    });
    this.buildCards();
    // how tracks bend (90°, 45°, any angle) and the auto chamfer, as Eagle's bend styles and mitre
    this.cornerSeg = h('div', { class: 'segmented corner-seg', role: 'radiogroup', 'aria-label': 'Track corners' },
      ...CORNERS.map(([id, label]) => h('button', { class: 'btn' + (id === this.corner ? ' active' : ''), type: 'button', role: 'radio', 'aria-checked': String(id === this.corner), dataset: { corner: id },
        title: { 90: 'Tracks bend at 90°', 45: 'Tracks bend at 45°', any: 'Tracks go straight to the pointer, at any angle' }[id] + ' (/ flips which way the bend goes)', onClick: () => this.setCorner(id) }, label)));
    this.chamferIn = h('input', { class: 'input', type: 'number', min: '0', max: '10', step: '0.05', value: fmt(this.chamfer), 'aria-label': 'Chamfer (mm)' });
    this.chamferIn.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') this.chamferIn.blur(); });
    this.chamferIn.addEventListener('change', () => { const v = parseFloat(this.chamferIn.value); if (Number.isFinite(v) && v >= 0) this.setChamfer(mm(v)); });
    const chamfer = h('label', { class: 'chamfer-box', title: 'Auto chamfer (as Eagle\'s mitre): bends of 90° or sharper are cut back by this length and joined at 45°. 0 for none' }, h('span', {}, 'Chamfer'), this.chamferIn, h('em', {}, 'mm'));
    // the Route tool's options pop up over the canvas while it is the tool (see attach)
    this.pairSel = h('select', { class: 'select', 'aria-label': 'Via layer pair', title: 'The two copper layers V switches between while routing (through vias join every layer)' });
    this.pairSel.addEventListener('change', () => { this.pair = this.pairSel.value.split('|'); pref.set('boardLayerPair', this.pair); if (this.route) this.route = { ...this.route, pair: this.pair }; });
    this.pairSel.addEventListener('keydown', (e) => e.stopPropagation());
    this.pairBox = h('label', { class: 'chamfer-box pair-box' }, h('span', {}, 'V switches'), this.pairSel);
    this.routeStrip = h('div', { class: 'tool-strip route-strip', role: 'toolbar', 'aria-label': 'Routing options', hidden: true },
      stripLabel('Route', 'route'), stripSep(), h('span', { class: 'tool-strip-label strip-sub' }, 'Corners'), this.cornerSeg, h('span', { class: 'sep' }), chamfer, h('span', { class: 'sep pair-sep' }), this.pairBox);
    // delete, rotate, flip and lock live on the context strip over the canvas, with what they act on
    return [this.btn.undo, this.btn.redo, h('span', { class: 'sep' }), ...this.cards.buttons(), this.gridCard.button];
  }

  /** The routing mode switcher for the toolbar: Shove (#29, later), Walkaround, Free. */
  modeGroup(later) {
    const tips = {
      walkaround: 'Walkaround routing mode: the track goes round other nets\' copper at their clearance, the shorter way, and stops at an obstacle with no way round. Nothing existing moves',
      free: 'Free routing mode: tracks go where you draw them; collisions with other nets show in red',
    };
    this.modeBtn = {};
    for (const [id, label] of ROUTE_MODES) {
      this.modeBtn[id] = button({ label, title: tips[id], onClick: () => this.setRouteMode(id) });
      this.modeBtn[id].dataset.mode = id;
      this.modeBtn[id].setAttribute('role', 'radio');
    }
    const g = h('div', { class: 'mode-group', role: 'radiogroup', 'aria-label': 'Routing mode', title: 'Routing mode' }, later({ label: 'Shove', title: 'Shove routing mode' }, 29), ...ROUTE_MODES.map(([id]) => this.modeBtn[id]));
    this.setRouteMode(this.routeMode, false);
    return g;
  }

  setRouteMode(id, save = true) {
    if (!ROUTE_MODES.some(([m]) => m === id)) id = 'walkaround';
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
    return [T.select, T.route, later({ icon: 'dragTrack', title: 'Drag track (D)' }, 31),
      T.via, T.zone, null,
      T.outline, T.polygon, T.circle, null, later({ icon: 'ltext', title: 'Text' }, 19), T.measure, T.origin];
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
    const len = tracks.reduce((a, t) => a + Math.hypot(t.b[0] - t.a[0], t.b[1] - t.a[1]), 0);
    const out = [h('div', { class: 'prop-title' }, [tracks.length ? `${tracks.length} track${tracks.length === 1 ? '' : 's'}` : '', vias.length ? `${vias.length} via${vias.length === 1 ? '' : 's'}` : ''].filter(Boolean).join(', ')),
      h('p', { class: 'side-note' }, `Net ${nets.map((n) => (n === '(no net)' ? n : `${n} (${netClassOf(this.board, n)} class)`)).join(', ')}${tracks.length ? ` · ${fmt(Math.round(len))} mm long` : ''}`)];
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
    ].filter(Boolean);
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
    // the Properties card belongs to the selection it was opened for
    const pc = this.cards?.card('props');
    if (pc?.isOpen && (!this._propsFor || this._selSig() !== this._propsFor)) { pc.toggle(false); this._propsFor = null; }
    this.zoneFiller.update(this.project);
    this._rats = ratsnest(this.project);
    if (!copperLayerNames(this.board.stack.copper).includes(this.activeLayer) && /^In\d/.test(this.activeLayer)) this.activeLayer = 'F.Cu';
    if (this.btn) {
      this.btn.undo.disabled = !this.app.history.canUndo;
      this.btn.redo.disabled = !this.app.history.canRedo;

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
        ? `Routing ${this.route.net} on ${this.route.layer} (${fmt(this.route.width)} mm, ${netClassOf(this.board, this.route.net)} class): click to place a corner · click a ${this.route.net} pad to finish · V drops a via and goes to ${this.route.layer === this.route.pair[0] ? this.route.pair[1] : this.route.pair[0]} · double-click or Enter ends here · / flips the bend · Backspace undoes a corner · Esc cancels${this.routeView?.collisions.length ? ' · red: too close to another net' : ''}${this.routeView?.blocked ? ' · no clear way to the pointer: the track stops at the obstacle' : ''}`
        : `Route (${this.routeMode === 'walkaround' ? 'Walkaround: tracks go round other nets' : 'Free: tracks go where you draw'}): click a pad on ${this.activeLayer} to start a track (corners: ${this.corner === 'any' ? 'any angle' : this.corner + '°'}${this.chamfer ? `, chamfer ${fmt(this.chamfer)} mm` : ''})`; break;
      case 'zone': t = !p ? `Zone on ${this.activeLayer}: click its first corner (the net comes from the pad or track there, else GND; change it in Properties)`
        : `Zone on ${this.activeLayer}: click the next corner · click the first corner, double-click or Enter to close · Backspace undo corner · Esc cancel`; break;
      case 'via': t = 'Via: click to place a through via (F.Cu to B.Cu); it takes the net of the track or pad it lands on · Esc back to Select'; break;
      case 'origin': t = 'Grid origin: click where the grid, rulers and coordinates should measure from (outline corners attract it) · Esc back to Select'; break;
      case 'measure': t = this.measure && !this.measure.done ? 'Measure: click the second point' : 'Measure: click two points · Esc to stop'; break;
      default: t = this.zoneSel.size
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
    this.tool = t; this.pts = null; this.arcNext = false; this.measure = null;
    if (t !== 'select') { this.selection.clear(); this.fpSel.clear(); this.netSel.clear(); this.trackSel.clear(); this.zoneSel.clear(); }
    if (t === 'zone' && !copperLayerNames(this.board.stack.copper).includes(this.activeLayer)) this.activeLayer = 'F.Cu'; // zones are copper
    if (['outline', 'polygon', 'circle'].includes(t)) this.activeLayer = 'Edge.Cuts'; // the Outline lives on Edge.Cuts
    if (this.ws) this.ws.view.canvas.style.cursor = t === 'select' ? '' : 'crosshair';
    this.refresh();
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
    if (this.zoneSel.size) {
      const del = new Set(this.zoneSel); this.zoneSel.clear();
      this.app.edit(del.size === 1 ? 'Delete zone' : `Delete ${del.size} zones`, (p) => { p.board.zones = p.board.zones.filter((z) => !del.has(z.id)); });
      return;
    }
    if (this.trackSel.size) {
      const del = new Set(this.trackSel); this.trackSel.clear();
      this.app.edit(del.size === 1 ? 'Delete track' : `Delete ${del.size} tracks and vias`, (p) => { p.board.tracks = p.board.tracks.filter((t) => !del.has(t.id)); p.board.vias = p.board.vias.filter((v) => !del.has(v.id)); });
      return;
    }
    if (this.fpSel.size && !this.selection.size) { toast('Footprints come from the Schematic: delete the part there, then Update from Schematic (F8).', 'info', 3500); return; }
    if (!this.selection.size) return;
    const del = new Set(this.selection);
    this.selection.clear();
    this.edit(del.size === 1 ? 'Delete outline shape' : 'Delete outline shapes', (o, p) => { p.board.outline = o.filter((_, i) => !del.has(i)); });
  }

  nudge(dx, dy) {
    const sel = [...this.selection], fps = [...this.fpSel], zs = new Set(this.zoneSel);
    this.app.edit(fps.length ? 'Move' : zs.size && !sel.length ? 'Move zone' : 'Move outline', (p) => { moveOutline(sel.map((i) => p.board.outline[i]), [dx, dy]); moveFootprints(p, fps, [dx, dy]); moveZones(p.board.zones, zs, [dx, dy]); });
  }

  _lockedNote(ids) {
    const locked = this.board.footprints.filter((f) => ids.includes(f.id) && f.locked);
    if (locked.length) toast(`${locked.map((f) => this.project.components[f.componentId]?.ref || '?').join(', ')} ${locked.length === 1 ? 'is' : 'are'} locked and stayed put.`, 'info', 2500);
  }

  rotateSel(deg) {
    const ids = [...this.fpSel];
    if (!ids.length) return;
    this.app.edit(`Rotate ${deg}°`, (p) => rotateFootprints(p, ids, deg));
    this._lockedNote(ids);
  }

  flipSel() {
    const ids = [...this.fpSel];
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
      if (this.tool === 'via') {
        const at = this.snapAt(w);
        let v = null;
        this.app.edit('Place via', (p) => { v = placeVia(p, at, 2 / ws.view.view.scale); });
        toast(v.net ? `Via on ${v.net}.` : 'Via with no net (it isn\'t on a track or pad).', 'info', 1600);
        return;
      }
      if (this.tool === 'zone' && e.detail >= 2 && this.pts?.zone?.length >= 3) { this.closeZone(); return; }
      if (this.tool === 'select') {
        const tol = 5 / ws.view.view.scale;
        const handle = this._handleAt(w, tol);
        if (handle && !e.shiftKey) {
          this.handleDrag = { ...handle, startPx: [e.clientX, e.clientY], snapshot: structuredClone(this.board.outline), zoneSnapshot: handle.zone ? structuredClone(this.board.zones.find((z) => z.id === handle.zone).outline) : null, moved: false };
          try { c.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
          return;
        }
        const tr = this._hitTrack(w, tol);
        if (tr) {
          if (e.shiftKey) { if (this.trackSel.has(tr.id)) this.trackSel.delete(tr.id); else this.trackSel.add(tr.id); }
          else { this.trackSel = new Set([tr.id]); this.fpSel.clear(); this.selection.clear(); this.netSel.clear(); this.zoneSel.clear(); }
          this.refresh();
          return;
        }
        if (!e.shiftKey) this.trackSel.clear();
        const fp = hitFootprint(this.project, w, { preferBack: this.activeLayer.startsWith('B.'), hidden: this.hidden });
        const hit = fp || this.hidden.has('Edge.Cuts') ? null : hitOutline(this.board.outline, w, tol);
        if (fp) {
          if (e.shiftKey) { if (this.fpSel.has(fp.id)) this.fpSel.delete(fp.id); else this.fpSel.add(fp.id); this.refresh(); return; }
          if (!this.fpSel.has(fp.id)) { this.fpSel = new Set([fp.id]); this.selection.clear(); this.zoneSel.clear(); }
          this.netSel.clear();
          // Footprints move by their origin, which lands on the grid
          this.drag = { start: w, anchor: fp.at, fpAnchor: true, startPx: [e.clientX, e.clientY], snapshot: structuredClone(this.board.outline), fpSnapshot: structuredClone(this.board.footprints), zoneSnapshot: structuredClone(this.board.zones), moved: false, delta: [0, 0], onlyFp: fp.id };
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
          this.drag = { start: w, anchor, startPx: [e.clientX, e.clientY], snapshot: structuredClone(this.board.outline), fpSnapshot: structuredClone(this.board.footprints), zoneSnapshot: structuredClone(this.board.zones), moved: false, delta: [0, 0], only: i };
          try { c.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
        } else if (!hit && (zn = this._hitZone(w, tol))) {
          // a Zone: by its edge, or inside it where nothing else is
          if (e.shiftKey) { if (this.zoneSel.has(zn.id)) this.zoneSel.delete(zn.id); else this.zoneSel.add(zn.id); this.refresh(); return; }
          if (!this.zoneSel.has(zn.id)) { this.zoneSel = new Set([zn.id]); this.selection.clear(); this.fpSel.clear(); this.netSel.clear(); }
          const anchor = zn.outline.reduce((b, p) => (Math.hypot(p[0] - w[0], p[1] - w[1]) < Math.hypot(b[0] - w[0], b[1] - w[1]) ? p : b), zn.outline[0]);
          this.drag = { start: w, anchor, startPx: [e.clientX, e.clientY], snapshot: structuredClone(this.board.outline), fpSnapshot: structuredClone(this.board.footprints), zoneSnapshot: structuredClone(this.board.zones), moved: false, delta: [0, 0], onlyZone: zn.id };
          try { c.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
        } else { this.selection.clear(); this.fpSel.clear(); this.netSel.clear(); this.zoneSel.clear(); }
        this.refresh();
        return;
      }
      this.click(this.snapAt(w));
    });
    c.addEventListener('pointermove', (e) => {
      const w = world(e);
      this.setAlt(e.altKey);
      this.snapMark = null;
      if (this.handleDrag?.zone) { const d = this.handleDrag; this.cursor = this.snapAt(w, new Set(), shapeHandles({ type: 'poly', pts: d.zoneSnapshot }).find((x) => x.key === d.key)?.at); }
      else if (this.handleDrag) { const d = this.handleDrag; this.cursor = this.snapAt(w, new Set([d.index]), shapeHandles(d.snapshot[d.index]).find((x) => x.key === d.key)?.at); }
      else if (this.tool !== 'select') this.cursor = this.snapAt(w);
      else this.cursor = this.snapPt(w);
      if (this.handleDrag && (e.buttons & 1)) {
        const d = this.handleDrag;
        if (!d.moved && Math.hypot(e.clientX - d.startPx[0], e.clientY - d.startPx[1]) < 3) return;
        d.moved = true;
        if (d.zone) {
          const pts = dragHandle({ type: 'poly', pts: d.zoneSnapshot }, d.key, this.cursor).pts;
          this.previewZones = this.board.zones.map((z) => (z.id === d.zone ? { ...z, outline: pts } : z));
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
        const to = d.fpAnchor ? this.snapPt(raw) : this.snapAt(raw, this.selection, d.onlyZone ? d.anchor : null);
        d.delta = [to[0] - d.anchor[0], to[1] - d.anchor[1]];
        const moved = structuredClone(d.snapshot);
        moveOutline([...this.selection].map((i) => moved[i]), d.delta);
        this.preview = moved;
        if (this.fpSel.size) {
          const fps = structuredClone(d.fpSnapshot);
          moveFootprints({ board: { footprints: fps } }, [...this.fpSel], d.delta);
          this.previewFps = fps;
          // the Ratsnest follows the drag
          this._rats = ratsnest(this.project, { ...this.board, footprints: fps });
        }
        if (this.zoneSel.size) {
          const zs = structuredClone(d.zoneSnapshot);
          moveZones(zs, this.zoneSel, d.delta);
          this.previewZones = zs;
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
      if (this.handleDrag?.zone) {
        const d = this.handleDrag; this.handleDrag = null;
        const z = this.previewZones?.find((q) => q.id === d.zone); this.previewZones = null;
        if (d.moved && z && JSON.stringify(z.outline) !== JSON.stringify(d.zoneSnapshot)) this.app.edit('Reshape zone', (p) => { p.board.zones.find((q) => q.id === d.zone).outline = z.outline; });
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
      const d = this.drag; this.drag = null; this.preview = null; this.previewFps = null; this.previewZones = null;
      if (d.moved && (d.delta[0] || d.delta[1])) { this.nudge(...d.delta); this._lockedNote([...this.fpSel]); }
      else {
        // a click picks one item out of a group
        if (!d.moved && d.onlyFp) { this.fpSel = new Set([d.onlyFp]); this.selection.clear(); this.zoneSel.clear(); }
        else if (!d.moved && d.onlyZone) { this.zoneSel = new Set([d.onlyZone]); this.selection.clear(); this.fpSel.clear(); }
        else if (!d.moved && d.only !== undefined) { this.selection = new Set([d.only]); this.fpSel.clear(); }
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
    const z = this._selZone();
    if (z && this.tool === 'select' && !this.drag?.moved) return shapeHandles({ type: 'poly', pts: (this.previewZones?.find((q) => q.id === z.id) || z).outline });
    if (this.tool !== 'select' || this.selection.size !== 1 || this.hidden.has('Edge.Cuts') || this.drag?.moved) return [];
    const i = [...this.selection][0];
    const s = (this.preview || this.board.outline)[i];
    return s ? shapeHandles(s) : [];
  }

  /** The handle under `w`, as { index, key, cursor }, or null. */
  _handleAt(w, tol) {
    const z = this._selZone();
    if (z && this.tool === 'select') { const hz = hitHandle({ type: 'poly', pts: z.outline }, w, tol); if (hz) return { zone: z.id, key: hz.key, cursor: hz.cursor }; }
    if (this.tool !== 'select' || this.selection.size !== 1 || this.hidden.has('Edge.Cuts')) return null;
    const index = [...this.selection][0];
    const s = this.board.outline[index];
    const h = s && hitHandle(s, w, tol);
    return h ? { index, key: h.key, cursor: h.cursor } : null;
  }

  /** What is at `w`, in the order a click picks it: { kind: 'track' | 'footprint' | 'outline' | 'zone', item, index? }. */
  _hitAny(w) {
    const tol = 5 / (this.ws?.view.view.scale || 1);
    const tr = this._hitTrack(w, tol);
    if (tr) return { kind: 'track', item: tr };
    const fp = hitFootprint(this.project, w, { preferBack: this.activeLayer.startsWith('B.'), hidden: this.hidden });
    if (fp) return { kind: 'footprint', item: fp };
    const o = this.hidden.has('Edge.Cuts') ? null : hitOutline(this.board.outline, w, tol);
    if (o) return { kind: 'outline', item: o, index: this.board.outline.indexOf(o) };
    const z = this._hitZone(w, tol);
    if (z) return { kind: 'zone', item: z };
    return null;
  }

  /** Select just that hit. */
  _selectOnly(hit) {
    this.selection.clear(); this.fpSel.clear(); this.trackSel.clear(); this.zoneSel.clear(); this.netSel.clear();
    if (hit.kind === 'track') this.trackSel.add(hit.item.id);
    else if (hit.kind === 'footprint') this.fpSel.add(hit.item.id);
    else if (hit.kind === 'outline') this.selection.add(hit.index);
    else if (hit.kind === 'zone') this.zoneSel.add(hit.item.id);
  }

  _selSig() { return `${[...this.fpSel].sort()}|${[...this.trackSel].sort()}|${[...this.zoneSel].sort()}|${[...this.selection].sort()}`; }
  _anySelected() { return !!(this.fpSel.size || this.trackSel.size || this.zoneSel.size || this.selection.size); }

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
    if (this.route) { this.finishRoute(); return; }
    if (this.tool !== 'select') { this.setTool('select'); return; }
    const v = this.ws.view, w = v.view.toWorld(v.local(e));
    const hit = this._hitAny(w);
    const sameSel = hit && ((hit.kind === 'track' && this.trackSel.has(hit.item.id)) || (hit.kind === 'footprint' && this.fpSel.has(hit.item.id)) || (hit.kind === 'zone' && this.zoneSel.has(hit.item.id)) || (hit.kind === 'outline' && this.selection.has(hit.index)));
    if (hit && !sameSel) this._selectOnly(hit);
    if (!hit) { this.selection.clear(); this.fpSel.clear(); this.trackSel.clear(); this.zoneSel.clear(); this.netSel.clear(); }
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
        { label: `Rotate ${this.rotStep}° anticlockwise`, icon: 'rotateLeft', shortcut: 'R', onClick: () => this.rotateSel(this.rotStep) },
        { label: `Rotate ${this.rotStep}° clockwise`, icon: 'rotateRight', shortcut: 'Shift+R', onClick: () => this.rotateSel(-this.rotStep) },
        { label: 'Flip to the other side', icon: 'flip', shortcut: 'F', onClick: () => this.flipSel() },
        { label: locked ? 'Unlock' : 'Lock', icon: locked ? 'unlock' : 'lock', shortcut: 'L', onClick: () => this.lockSel() },
        selectNet ? 'sep' : null, selectNet], at);
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
    const comps = net ? [] : [...new Set(this.board.footprints.filter((f) => this.fpSel.has(f.id)).map((f) => f.componentId))];
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
    const pts = [...fps.flatMap((f) => footprintOutline(this.project, f)), ...copper.flatMap((t) => (t.at ? [t.at] : [t.a, t.b])), ...padPts];
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
    const tr = (this.board.tracks || []).find((t) => t.layer === layer && t.net && pointSeg2(p, t.a, t.b) <= (t.width / 2) ** 2);
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
      ...(board.tracks || []).filter((t) => trackIds.has(t.id)).map((t) => ({ x0: Math.min(t.a[0], t.b[0]) - t.width / 2, y0: Math.min(t.a[1], t.b[1]) - t.width / 2, x1: Math.max(t.a[0], t.b[0]) + t.width / 2, y1: Math.max(t.a[1], t.b[1]) + t.width / 2 })),
      ...sub.zones.map((z) => { const xs = z.outline.map((q) => q[0]), ys = z.outline.map((q) => q[1]); return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }; }),
      ...(board.vias || []).filter((v) => trackIds.has(v.id)).map((v) => ({ x0: v.at[0] - v.diameter / 2, y0: v.at[1] - v.diameter / 2, x1: v.at[0] + v.diameter / 2, y1: v.at[1] + v.diameter / 2 })),
      ...sub.footprints.filter((f) => !partial.has(f.id)).map((f) => { const q = footprintOutline(proj, f); const xs = q.map((p) => p[0]), ys = q.map((p) => p[1]); return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }; }),
      ...sub.footprints.filter((f) => partial.has(f.id)).flatMap((f) => placedPads(proj, f, nets).filter((p) => padKeys.has(`${f.componentId}:${p.number}`)).map((p) => { const r = Math.max(...p.size) / 2; return { x0: p.at[0] - r, y0: p.at[1] - r, x1: p.at[0] + r, y1: p.at[1] + r }; })),
    ].filter(Boolean).map((b) => screenBox(view, b));
    const style = this.app.highlightStyle() === 'fade' && noFade ? 'glow' : this.app.highlightStyle();
    highlight(ctx, C2, style, (c, Cx) => drawBoard(c, view, Cx, sub, { project: this.project, hidden: this.hidden, only: true, padsOnly: partial, padKeys, trackIds }), boxes);
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
      else for (const p of placedPads(this.project, f, nets)) if (t.pads.has(`${f.componentId}:${p.number}`)) pts.push(p.at);
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

  setCorner(id) {
    this.corner = id; pref.set('boardCorner', id);
    for (const b of this.cornerSeg.querySelectorAll('button')) { const on = b.dataset.corner === id; b.classList.toggle('active', on); b.setAttribute('aria-checked', String(on)); }
    if (this.route) { this.route = { ...this.route, corner: id }; this._routeMove(); }
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
    const p = this.snapAt(w);
    if (!this.route) {
      const hit = this._padOnLayer(w);
      if (!hit) { toast(hitPad(this.project, w) ? `That pad isn't on ${this.activeLayer}: make its layer active (Layers, or the chips at the bottom).` : 'Start a track on a pad.', 'info', 2600); return; }
      if (!hit.pad.net) { toast('That pad has no net yet: Update from Schematic (F8) first.', 'info', 2600); return; }
      const pairs = layerPairs(this.board.stack.copper);
      const pair = this.pair && pairs.some((q) => q.join('|') === this.pair.join('|')) ? this.pair : null;
      this.route = startRoute(this.project, hit.pad.at, this.activeLayer, hit.pad.net, { corner: this.corner, chamfer: this.chamfer, pair, pad: hit.pad });
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
    if (dbl) { this.finishRoute(); return; }
    this.route = routeClickAt(this.project, this.route, p, this._proposal(p).tail);
    this._routeMove();
    this.refresh();
  }

  /** What the router proposes from the last fixed corner to `p` in the current mode. */
  _proposal(p) {
    return routeStep(this.project, this.route, p, this.routeMode, this.routeIndex, this._targetPad(p));
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
    if (this.ws && had !== `${!!this.routeView.collisions.length}${!!this.routeView.blocked}`) this._hint();
    this.ws?.view.invalidate();
  }

  finishRoute() {
    const st = this.route;
    this.route = null; this.routeView = null; this.routeIndex = null;
    if (st && st.points.length > 1) {
      let n = 0;
      this.app.edit(`Route ${st.net}`, (p) => { n = routeCommit(p, st).length; });
      const v = st.vias?.length || 0;
      toast(`${n} track${n === 1 ? '' : 's'}${v ? ` and ${v} via${v === 1 ? '' : 's'}` : ` on ${st.layer}`} (${st.net}).`, 'info', 1600);
    } else this.refresh();
  }

  cancelRoute() { this.route = null; this.routeView = null; this.routeIndex = null; this.refresh(); }

  /** The Track under `w` on a shown layer, front layers first. */
  _hitTrack(w, tol) {
    const order = ['F.Cu', 'In1.Cu', 'In2.Cu', 'B.Cu'];
    const ts = (this.board.tracks || []).filter((t) => !this.hidden.has(t.layer)).sort((a, b) => order.indexOf(a.layer) - order.indexOf(b.layer));
    const via = (this.hidden.has('F.Cu') && this.hidden.has('B.Cu')) ? null : (this.board.vias || []).find((v) => Math.hypot(w[0] - v.at[0], w[1] - v.at[1]) <= v.diameter / 2 + tol);
    return via || ts.find((t) => pointSeg2(w, t.a, t.b) <= (t.width / 2 + tol) ** 2) || null;
  }

  /** U: select the whole connection the selected copper belongs to. */
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
    if (fps.length) {
      const one = fps.length === 1 ? fps[0] : null;
      const ref = (f) => this.board.annotation?.components?.[f.componentId]?.ref || this.project.components[f.componentId]?.ref || '?';
      const locked = fps.every((f) => f.locked);
      const props = this.cards?.card('props');
      s.show(`fp|${fps.map((f) => `${f.id}:${f.rot}:${f.side}:${!!f.locked}`).join(';')}|${this.rotStep}|${shapes.length}|${!!props?.isOpen}`, () => [
        stripLabel(one ? `${ref(one)}${one.side === 'B' ? ' (back)' : ''}` : `${fps.length} footprints`, 'pad'), stripSep(),
        stripButton({ icon: 'rotateLeft', title: `Rotate ${this.rotStep}° anticlockwise (R)`, onClick: () => this.rotateSel(this.rotStep) }),
        stripButton({ icon: 'rotateRight', title: `Rotate ${this.rotStep}° clockwise (Shift+R)`, onClick: () => this.rotateSel(-this.rotStep) }),
        stripSelect({ label: 'Rotation step', showLabel: false, value: this.rotStep, options: [90, 45, 30, 15, 10, 5, 1].map((d) => [d, `${d}°`]), title: 'How far R and the rotate buttons turn', onSet: (v) => { this.rotStep = +v; pref.set('boardRotStep', this.rotStep); this.refresh(); } }),
        one ? stripNumber({ label: 'Angle', value: +one.rot.toFixed(2), unit: '°', step: '1', min: '-360', max: '360', width: 62, title: 'The exact rotation (anticlockwise)', onSet: (v) => this.app.edit(`Rotate ${ref(one)} to ${v}°`, (p) => setFootprintRotation(p, one.id, v)) }) : null,
        stripSep(),
        stripButton({ icon: 'flip', label: 'Flip', title: `Flip to the ${one?.side === 'B' ? 'front' : 'other side'} (F)`, onClick: () => this.flipSel() }),
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
    this.drcRunning = false;
    this.drcFocus = null;
    this.renderDrc();
    this.ws?.view.invalidate();
    const c = drcCounts(this.drc.list);
    toast(c.error || c.warning ? `DRC: ${[c.error ? `${c.error} error${c.error === 1 ? '' : 's'}` : '', c.warning ? `${c.warning} warning${c.warning === 1 ? '' : 's'}` : ''].filter(Boolean).join(', ')}.` : 'DRC: no problems.', c.error ? 'error' : 'info', 2200);
    return this.drc.list;
  }

  /** A number that changes with every edit (to tell when the DRC results are out of date). */
  _rev() { const hs = this.app.history; return [hs.undoStack[hs.undoStack.length - 1] || null, hs.redoStack?.[hs.redoStack.length - 1] || null, this.project.id]; }
  _drcStale() { const r = this._rev(); return !!this.drc && this.drc.rev.some((x, i) => x !== r[i]); }

  _drcShown() { return (this.drc?.list || []).filter((v) => this.drcFilter[v.severity]); }

  renderDrc() {
    const el = this.drcEl;
    if (!el || !this.drcCard?.isOpen) return;
    const list = this.drc?.list || [];
    const c = drcCounts(list);
    const chip = (sev, label) => h('button', { class: `erc-chip erc-chip-${sev}` + (this.drcFilter[sev] ? ' on' : ''), type: 'button', 'aria-pressed': String(this.drcFilter[sev]), title: `Show ${label.toLowerCase()}`, dataset: { severity: sev },
      onClick: () => { this.drcFilter[sev] = !this.drcFilter[sev]; this.renderDrc(); this.ws?.view.invalidate(); } }, h('span', { class: 'erc-dot' }), label, h('span', { class: 'erc-n' }, String(c[sev])));
    const stale = this._drcStale();
    const head = h('div', { class: 'erc-filter' },
      h('div', { class: 'drc-run' },
        h('span', { class: 'drc-sum' }, this.drcRunning ? 'Running… (waiting for zone fills)' : !this.drc ? 'Not run yet' : c.error || c.warning ? `${c.error} error${c.error === 1 ? '' : 's'} · ${c.warning} warning${c.warning === 1 ? '' : 's'}` : 'No problems'),
        button({ label: this.drc ? 'Run again' : 'Run', icon: 'play', cls: 'btn-outline btn-xs', title: 'Run DRC again (clears the old markers)', onClick: () => this.runDrc() })),
      stale ? h('div', { class: 'drc-stale' }, icon('info', 14), h('span', {}, 'The board has changed since this run.')) : null,
      h('div', { class: 'erc-chips', role: 'group', 'aria-label': 'Show' }, chip('error', 'Errors'), chip('warning', 'Warnings')));
    const shown = this._drcShown();
    const label = Object.fromEntries(DRC_RULES);
    const row = (v) => h('div', { class: `erc-row erc-${v.severity}` + (v.id === this.drcFocus ? ' on' : ''), role: 'button', tabindex: '0', dataset: { rule: v.rule }, title: v.at ? 'Show it on the board' : v.rule === 'annotation' ? 'Update from Schematic' : '',
      onClick: () => this.gotoViolation(v), onKeydown: (e) => { if (e.key === 'Enter') this.gotoViolation(v); } },
      h('span', { class: 'erc-dot', 'aria-label': v.severity }),
      h('span', { class: 'erc-msg' }, h('b', { class: 'drc-rule' }, `${label[v.rule]}${v.layer ? ` · ${v.layer}` : ''}`), ' ', v.message));
    const empty = this.drcRunning || !this.drc ? null : !list.length ? 'Every rule is met, everything is routed and the Board matches the Schematic.' : !shown.length ? 'Everything is filtered out.' : null;
    el.replaceChildren(head, h('div', { class: 'fp-body drc-list' }, empty ? h('p', { class: 'side-note erc-clean' }, empty) : '', ...shown.map(row)));
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

  /** The shapes the drawing tools show at the cursor. */
  _ghost() {
    const cur = this.cursor;
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
    const board = { ...this.board, outline: this.preview || this.board.outline, footprints: this.previewFps || this.board.footprints, zones: this.previewZones || this.board.zones };
    const labels = [];
    drawBoard(ctx, view, C, board, { project: this.project, fpSel: this.fpSel, rats: this._rats?.wires, hidden: this.hidden, selection: this.selection, ...this._ghost(), measure: this.measure, labels, zones: { fills: this.zoneFiller.fills, outlineOnly: this._zonesAsOutlines(board) } });
    if (this.routeView) this._drawRoute(ctx, view, C);
    drawLabels(labels); // names, values and pad numbers over all the copper, the track being routed too
    // the selection, highlighted in the style chosen in Settings (the same in every editor)
    if (this.selection.size || this.fpSel.size || this.netSel.size || this.trackSel.size || this.zoneSel.size) {
      const t = this.netSel.size ? boardTargets({ ...this.project, board }, probeFromBoard(this.project, [], [...this.netSel])) : null;
      this._highlightBoard(ctx, view, C, board, this.selection, this.fpSel, t?.pads, C, false, new Set([...this.trackSel, ...this.zoneSel, ...(t?.copper || [])]));
    }
    // the Schematic's selection (cross-probing), in the theme's Highlight colour
    const probe = this.app.probeFor('board');
    if (probe) {
      const t = boardTargets({ ...this.project, board }, probe);
      const fps = new Set([...t.footprints].filter((id) => !this.fpSel.has(id)));
      const copper = new Set([...t.copper].filter((id) => !this.trackSel.has(id)));
      if (fps.size || t.pads.size || copper.size) this._highlightBoard(ctx, view, C, board, new Set(), fps, t.pads, { ...C, selection: C.highlight || C.selection }, this.selection.size || this.fpSel.size, copper);
    }
    this._drawDrc(ctx, view, C); // over the highlights, so the focused problem shows
    drawHandles(ctx, view, C, this._handles(), this.handleDrag?.key);
    drawSnapMark(ctx, view, C, this.snapMark);
  }

  /** DRC markers while the DRC card is open: a badge at each shown violation, the focused one ringed. */
  _drawDrc(ctx, view, C) {
    if (!this.drc || !this.drcCard?.isOpen) return;
    const shown = this._drcShown();
    ctx.save();
    for (const v of shown) {
      if (!v.at) continue;
      const [x, y] = view.toScreen(v.at);
      const col = v.severity === 'error' ? (C.drcError || '#ff3b6b') : (C.ercWarning || '#ffb74d');
      ctx.fillStyle = col; ctx.strokeStyle = C.background || '#000'; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.95;
      const r = 6;
      ctx.beginPath(); ctx.moveTo(x, y - r * 1.7); ctx.lineTo(x + r, y); ctx.lineTo(x - r, y); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = '700 9px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('!', x, y - r * 0.55);
      if (v.id === this.drcFocus) {
        ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.setLineDash([5, 3]);
        if (v.box) { const [x0, y0] = view.toScreen([v.box.x0, v.box.y0]), [x1, y1] = view.toScreen([v.box.x1, v.box.y1]); ctx.beginPath(); ctx.arc(x, y, Math.max(12, Math.min(40, Math.hypot(x1 - x0, y1 - y0) / 8)), 0, Math.PI * 2); ctx.stroke(); }
        ctx.setLineDash([]);
      }
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
        const [x0, y0] = view.toScreen(sg.a), [x1, y1] = view.toScreen(sg.b);
        if (pass === 'band') { ctx.globalAlpha = sg.collides ? 0.4 : 0.18; ctx.strokeStyle = sg.collides ? bad : C.selection; ctx.lineWidth = Math.max(2, (st.width + 2 * this.board.rules.clearance) * view.scale); }
        else { ctx.globalAlpha = sg.fixed ? 0.95 : 0.8; ctx.strokeStyle = sg.collides ? bad : C[sg.layer || st.layer] || '#c33'; ctx.lineWidth = Math.max(1, st.width * view.scale); }
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      }
    }
    // the vias dropped so far
    ctx.globalAlpha = 1;
    for (const v of st.vias || []) {
      const [x, y] = view.toScreen(v.at);
      ctx.fillStyle = C.via || '#c8c8c8'; ctx.beginPath(); ctx.arc(x, y, Math.max(2, (st.via.diameter / 2) * view.scale), 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = C.drill || '#000'; ctx.beginPath(); ctx.arc(x, y, Math.max(1, (st.via.drill / 2) * view.scale), 0, Math.PI * 2); ctx.fill();
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
      else if (this.selection.size || this.fpSel.size || this.netSel.size || this.trackSel.size || this.zoneSel.size) { this.selection.clear(); this.fpSel.clear(); this.netSel.clear(); this.trackSel.clear(); this.zoneSel.clear(); this.refresh(); }
      return true;
    }
    if (this.route) {
      if (e.key === 'Escape') { this.cancelRoute(); return true; }
      if (e.key === '/') { this.route = flipPosture(this.route); this._routeMove(); return true; }
      if (e.key.toLowerCase() === 'v') {
        const at = this.cursor || this.route.points[this.route.points.length - 1];
        const v = this._proposal(at);
        this.route = switchLayer(this.project, this.route, at, null, v.tail);
        this.activeLayer = this.route.layer;
        if (this.hidden.delete(this.activeLayer)) pref.set('boardHidden', [...this.hidden]);
        this._routeMove(); this.refresh();
        return true;
      }
      if (e.key === 'Backspace') { if (this.route.points.length > 1) { this.route = routeBack(this.route); this._routeMove(); } else this.cancelRoute(); return true; }
      if (e.key === 'Enter') { this.finishRoute(); return true; }
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
    if ((e.key === 'Delete' || e.key === 'Backspace') && (this.selection.size || this.trackSel.size || this.fpSel.size || this.zoneSel.size)) { this.deleteSelection(); return true; }
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (arrows[e.key] && (this.selection.size || this.fpSel.size || this.zoneSel.size)) { const [dx, dy] = arrows[e.key]; this.nudge(dx * this.board.grid.main, dy * this.board.grid.main); return true; }
    if (this.trackSel.size && this.tool === 'select' && e.key.toLowerCase() === 'u') { this.selectConnection(); return true; }
    if (this.fpSel.size && this.tool === 'select') {
      if (k === 'r') { this.rotateSel(e.shiftKey ? -this.rotStep : this.rotStep); return true; }
      if (k === 'f') { this.flipSel(); return true; }
      if (k === 'l') { this.lockSel(); return true; }
    }
    for (const [id, t] of Object.entries(BOARD_TOOLS)) if (k === t.key) { this.setTool(id); return true; }
    return false;
  }
}
