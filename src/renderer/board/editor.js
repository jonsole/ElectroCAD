// The Board tab's editor (#15): the Layer stack, the layer panel (visibility and the active
// layer), the Outline tools and Measure. Footprints, Tracks, Vias and Zones arrive with their
// tickets. Edits go through app.edit, so they share the Project's undo history.
//
// Layer visibility and the corner radius for new rectangles are per-browser preferences, like the
// picker's view; the stack and the Outline are saved in the Project.
import { h, button, icon, toast } from '../ui/dom.js';
import { section } from '../workspaces/workspace.js';
import { mm, toMm } from '../core/units.js';
import {
  boardLayers, setCopperLayers, setThickness, BOARD_THICKNESSES, LAYER_HELP, copperLayerNames,
  GRID_CHOICES, gridLabel, setGrid, snapToGrid,
  rectOutline, circleOutline, polygonOutline, checkOutline, outlineBounds, hitOutline, moveOutline,
} from '../core/board.js';
import { drawBoard } from './render.js';
import { openAnnotateDialog } from './annotate-dialog.js';
import { placedPads, padNets } from '../core/footprint.js';
import { shapeHandles, hitHandle, dragOutlineHandle, snapPoint, handlePoints } from '../core/handles.js';
import { drawHandles, drawSnapMark } from '../view/handles.js';
import { gridPanel, watchAlt } from '../ui/grid.js';

const same = (a, b) => a && b && a[0] === b[0] && a[1] === b[1];

/** The palette tools that work now: key, icon, title. */
export const BOARD_TOOLS = {
  select: { icon: 'select', title: 'Select (V)', key: 'v' },
  outline: { icon: 'outline', title: 'Outline rectangle (B): click two corners. Round the corners with Corner radius in Properties', key: 'b' },
  polygon: { icon: 'lpolygon', title: 'Outline polygon (P): click corners; A makes the next side an arc; click the first point to close', key: 'p' },
  circle: { icon: 'lellipse', title: 'Round outline or hole (C): click the centre, then the edge', key: 'c' },
  measure: { icon: 'ruler', title: 'Measure (M): click two points', key: 'm' },
  origin: { icon: 'target', title: 'Grid origin (O): click to move the origin there; it snaps onto handles. Reset it in Properties', key: 'o' },
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
    this.pts = null;            // points clicked so far by the drawing tools
    this.arcNext = false;       // polygon: the next side is an arc (a mid point, then the end)
    this.measure = null;        // { a, b, done }
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
      del: button({ icon: 'trash', title: 'Delete (Del)', onClick: () => this.deleteSelection() }),
    };
    return [this.btn.undo, this.btn.redo, h('span', { class: 'sep' }), this.btn.del];
  }

  tools(later) {
    this.toolBtn = {};
    for (const [id, t] of Object.entries(BOARD_TOOLS)) this.toolBtn[id] = button({ icon: t.icon, title: t.title, onClick: () => this.setTool(id) });
    const T = this.toolBtn;
    return [T.select, later({ icon: 'route', title: 'Route (X)' }, 20), later({ icon: 'dragTrack', title: 'Drag track (D)' }, 31),
      later({ icon: 'via', title: 'Via' }, 21), later({ icon: 'zone', title: 'Zone' }, 23), null,
      T.outline, T.polygon, T.circle, null, later({ icon: 'ltext', title: 'Text' }, 19), T.measure, T.origin];
  }

  buildSide() {
    this.stackEl = h('div', { class: 'stack-row' });
    this.layerList = h('div', { class: 'layer-list', role: 'listbox', 'aria-label': 'Layers' });
    this.propsEl = h('div', { class: 'board-props' });
    return h('div', { class: 'side-panel' },
      section('Layers', this.stackEl, this.layerList),
      section('Properties', this.propsEl),
      section('Net classes', h('p', { class: 'side-note' }, 'Default · track 0.25 mm · clearance 0.2 mm')),
      section('DRC', h('p', { class: 'side-note' }, 'Not run yet.')));
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
    if (['outline', 'polygon', 'circle'].includes(this.tool) || (!sel.length && this.tool === 'select')) {
      if (this.tool === 'outline') parts.push(field('Corner radius', fmt(this.radius), (v) => { this.radius = mm(Math.max(0, v)); pref.set('boardCornerRadius', toMm(this.radius)); this.ws?.view.invalidate(); }));
    }
    if (!sel.length && (this.tool === 'select' || this.tool === 'origin')) parts.push(this.gridPanel());
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
    // the Outline's state, always
    const c = checkOutline(outline);
    const b = outlineBounds(outline);
    const ok = c.closed;
    parts.push(h('div', { class: 'outline-state ' + (ok ? 'ok' : 'bad'), role: 'status' },
      icon(ok ? 'check' : 'info', 16),
      h('span', {}, ok ? `Outline closed · ${fmt(b.x1 - b.x0)} × ${fmt(b.y1 - b.y0)} mm${c.pieces > 1 ? ` · ${c.pieces} separate pieces` : ''}${c.cutouts ? ` · ${c.cutouts} cut-out${c.cutouts > 1 ? 's' : ''}` : ''}` : c.problems.join(' '))));
    el.replaceChildren(...parts);
  }

  /** Grid and origin: the main and Alt grid steps, and where the origin is. */
  gridPanel() {
    const o = this.board.origin;
    return gridPanel({
      grid: this.board.grid, choices: GRID_CHOICES,
      onGrid: (which, nm) => this.app.edit(`${which === 'alt' ? 'Alt grid' : 'Grid'}: ${gridLabel(nm)}`, (p) => setGrid(p, which, nm)),
      originText: o[0] || o[1] ? `${fmt(o[0])}, ${fmt(o[1])} mm from the page origin` : 'at the page origin',
      onResetOrigin: o[0] || o[1] ? () => this.app.edit('Reset grid origin', (p) => { p.board.origin = [0, 0]; }) : null,
      resetTitle: 'Put the grid origin back at the page origin',
    });
  }

  chips() {
    return [...copperLayerNames(this.board.stack.copper), 'Edge.Cuts'].map((name) => h('button', {
      class: 'chip' + (name === this.activeLayer ? ' on' : ''), type: 'button', title: `${name}: ${LAYER_HELP[name]} (click to make it the active layer)`,
      style: { background: this.layerColor(name) }, dataset: { layer: name }, onClick: () => this.setActiveLayer(name),
    }, name === 'Edge.Cuts' ? 'Edge' : name.replace('.Cu', '')));
  }

  status() {
    const b = outlineBounds(this.board.outline);
    const size = b ? `${fmt(b.x1 - b.x0)} × ${fmt(b.y1 - b.y0)} mm` : 'no outline';
    return `${this.board.stack.copper}-layer · ${fmt(this.board.stack.thickness)} mm · ${size} · ${this.board.footprints.length} footprints · active ${this.activeLayer} · grid ${gridLabel(this.gridStep)}${this.alt ? ' (Alt)' : ''}`;
  }

  // ---------------------------------------------------------------- state

  refresh() {
    const n = this.board.outline.length;
    for (const i of [...this.selection]) if (i >= n) this.selection.delete(i);
    if (!copperLayerNames(this.board.stack.copper).includes(this.activeLayer) && /^In\d/.test(this.activeLayer)) this.activeLayer = 'F.Cu';
    if (this.btn) {
      this.btn.undo.disabled = !this.app.history.canUndo;
      this.btn.redo.disabled = !this.app.history.canRedo;
      this.btn.del.disabled = !this.selection.size;
    }
    if (this.toolBtn) for (const [id, b] of Object.entries(this.toolBtn)) b.classList.toggle('active', this.tool === id);
    if (this.stackEl) { this.renderStack(); this.renderLayers(); this.renderProps(); }
    this._home();
    if (this.ws) { this.ws.view.grid = this.gridStep; this.ws.view.origin = this.board.origin; }
    this.ws?.renderBar();
    this._hint();
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
      case 'origin': t = 'Grid origin: click where the grid, rulers and coordinates should measure from (outline corners attract it) · Esc back to Select'; break;
      case 'measure': t = this.measure && !this.measure.done ? 'Measure: click the second point' : 'Measure: click two points · Esc to stop'; break;
      default: t = this.board.outline.length
        ? (this.selection.size === 1 ? 'Drag a handle to resize (a side handle moves that side; corners stay round) · drag the shape to move · Del delete · arrows nudge one grid step · hold Alt for the Alt grid'
          : 'Click an outline shape to select it, drag to move · Del delete · arrows nudge one grid step · B, P, C draw more outline · hold Alt for the Alt grid')
        : 'No board yet: draw the Outline with B (rectangle), P (polygon) or C (round), then Update from Schematic (F8) to bring the Components over.';
    }
    this.ws.hint.textContent = t;
  }

  setTool(t) {
    if (!BOARD_TOOLS[t]) return;
    this.tool = t; this.pts = null; this.arcNext = false; this.measure = null;
    if (t !== 'select') this.selection.clear();
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
    if (!this.selection.size) return;
    const del = new Set(this.selection);
    this.selection.clear();
    this.edit(del.size === 1 ? 'Delete outline shape' : 'Delete outline shapes', (o, p) => { p.board.outline = o.filter((_, i) => !del.has(i)); });
  }

  nudge(dx, dy) {
    const sel = [...this.selection];
    this.edit('Move outline', (o) => moveOutline(sel.map((i) => o[i]), [dx, dy]));
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
      if (this.tool === 'select') {
        const tol = 5 / ws.view.view.scale;
        const handle = this._handleAt(w, tol);
        if (handle && !e.shiftKey) {
          this.handleDrag = { ...handle, startPx: [e.clientX, e.clientY], snapshot: structuredClone(this.board.outline), moved: false };
          try { c.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
          return;
        }
        const hit = this.hidden.has('Edge.Cuts') ? null : hitOutline(this.board.outline, w, tol);
        const i = hit ? this.board.outline.indexOf(hit) : -1;
        if (e.shiftKey && hit) { if (this.selection.has(i)) this.selection.delete(i); else this.selection.add(i); this.refresh(); return; }
        if (hit) {
          if (!this.selection.has(i)) this.selection = new Set([i]);
          // the selection moves by its handle nearest the pointer, so that handle lands on the grid or another object
          const anchors = handlePoints(this.board.outline.filter((_, k) => this.selection.has(k)));
          const anchor = anchors.reduce((b, p) => (Math.hypot(p[0] - w[0], p[1] - w[1]) < Math.hypot(b[0] - w[0], b[1] - w[1]) ? p : b), anchors[0] || w);
          this.drag = { start: w, anchor, startPx: [e.clientX, e.clientY], snapshot: structuredClone(this.board.outline), moved: false, delta: [0, 0], only: i };
          try { c.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
        } else this.selection.clear();
        this.refresh();
        return;
      }
      this.click(this.snapAt(w));
    });
    c.addEventListener('pointermove', (e) => {
      const w = world(e);
      this.setAlt(e.altKey);
      this.snapMark = null;
      if (this.handleDrag) { const d = this.handleDrag; this.cursor = this.snapAt(w, new Set([d.index]), shapeHandles(d.snapshot[d.index]).find((x) => x.key === d.key)?.at); }
      else if (this.tool !== 'select') this.cursor = this.snapAt(w);
      else this.cursor = this.snapPt(w);
      if (this.handleDrag && (e.buttons & 1)) {
        const d = this.handleDrag;
        if (!d.moved && Math.hypot(e.clientX - d.startPx[0], e.clientY - d.startPx[1]) < 3) return;
        d.moved = true;
        this.preview = dragOutlineHandle(d.snapshot, d.index, d.key, this.cursor);
        ws.view.invalidate();
        return;
      }
      if (this.tool === 'select' && !e.buttons) c.style.cursor = this._handleAt(w, 5 / ws.view.view.scale)?.cursor || '';
      if (this.drag && (e.buttons & 1)) {
        const d = this.drag;
        if (!d.moved && Math.hypot(e.clientX - d.startPx[0], e.clientY - d.startPx[1]) < 4) return;
        d.moved = true;
        const to = this.snapAt([d.anchor[0] + w[0] - d.start[0], d.anchor[1] + w[1] - d.start[1]], this.selection);
        d.delta = [to[0] - d.anchor[0], to[1] - d.anchor[1]];
        const moved = structuredClone(d.snapshot);
        moveOutline([...this.selection].map((i) => moved[i]), d.delta);
        this.preview = moved;
        ws.view.invalidate();
      } else if (this.tool !== 'select') {
        if (this.measure && !this.measure.done) this.measure.b = this.cursor;
        ws.view.invalidate();
      }
    });
    const up = () => {
      this.snapMark = null;
      if (this.handleDrag) {
        const d = this.handleDrag; this.handleDrag = null;
        const result = this.preview; this.preview = null;
        if (d.moved && result && JSON.stringify(result) !== JSON.stringify(d.snapshot)) this.edit('Resize outline', (o, p) => { p.board.outline = result; });
        else this.refresh();
        return;
      }
      if (!this.drag) return;
      const d = this.drag; this.drag = null; this.preview = null;
      if (d.moved && (d.delta[0] || d.delta[1])) this.nudge(...d.delta);
      else { if (!d.moved) this.selection = new Set([d.only]); this.refresh(); } // a click picks one shape out of a group
    };
    c.addEventListener('pointerup', up);
    watchAlt(ws, (on) => this.setAlt(on));
    c.addEventListener('pointercancel', up);
    c.addEventListener('pointerleave', () => { if (this.tool !== 'select') { this.cursor = null; ws.view.invalidate(); } });
    this.refresh();
  }

  /** The handles shown: those of the one selected outline shape (on the preview while dragging). */
  _handles() {
    if (this.tool !== 'select' || this.selection.size !== 1 || this.hidden.has('Edge.Cuts') || this.drag?.moved) return [];
    const i = [...this.selection][0];
    const s = (this.preview || this.board.outline)[i];
    return s ? shapeHandles(s) : [];
  }

  /** The handle under `w`, as { index, key, cursor }, or null. */
  _handleAt(w, tol) {
    if (this.tool !== 'select' || this.selection.size !== 1 || this.hidden.has('Edge.Cuts')) return null;
    const index = [...this.selection][0];
    const s = this.board.outline[index];
    const h = s && hitHandle(s, w, tol);
    return h ? { index, key: h.key, cursor: h.cursor } : null;
  }

  /** Pad centres, as snap targets. */
  _padPoints() {
    const nets = padNets(this.board);
    return this.board.footprints.flatMap((bf) => placedPads(this.project, bf, nets).map((p) => p.at));
  }

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
    const board = this.preview ? { ...this.board, outline: this.preview } : this.board;
    drawBoard(ctx, view, C, board, { project: this.project, hidden: this.hidden, selection: this.selection, ...this._ghost(), measure: this.measure });
    drawHandles(ctx, view, C, this._handles(), this.handleDrag?.key);
    drawSnapMark(ctx, view, C, this.snapMark);
  }

  // ---------------------------------------------------------------- keys

  onModKey() { return false; }

  onKey(e) {
    const k = e.key.toLowerCase();
    if (e.key === 'Escape') {
      if (this.pts || (this.measure && !this.measure.done)) { this.pts = null; this.arcNext = false; this.measure = null; this.refresh(); }
      else if (this.tool !== 'select') this.setTool('select');
      else if (this.selection.size) { this.selection.clear(); this.refresh(); }
      return true;
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
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.selection.size) { this.deleteSelection(); return true; }
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (arrows[e.key] && this.selection.size) { const [dx, dy] = arrows[e.key]; this.nudge(dx * this.board.grid.main, dy * this.board.grid.main); return true; }
    for (const [id, t] of Object.entries(BOARD_TOOLS)) if (k === t.key) { this.setTool(id); return true; }
    return false;
  }
}
