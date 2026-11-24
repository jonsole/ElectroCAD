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
import { hitPad, footprintOutline, placedPads, padNets, hitFootprint, moveFootprints, rotateFootprints, flipFootprints, setLocked, setFootprintRotation } from '../core/footprint.js';
import { ratsnest } from '../core/ratsnest.js';
import { validateRef, updateComponent, footprintChoices, footprintKey } from '../core/components.js';
import { allFootprints } from '../library/footprints.js';
import { STARTER_LIBRARY } from '../library/starter.js';
import { shapeHandles, hitHandle, dragOutlineHandle, snapPoint, handlePoints } from '../core/handles.js';
import { drawHandles, drawSnapMark } from '../view/handles.js';
import { watchAlt } from '../ui/grid.js';
import { GridCard } from '../ui/gridCard.js';
import { highlight, screenBox, revealBox } from '../view/highlight.js';
import { probeFromBoard, boardTargets } from '../core/probe.js';

const same = (a, b) => a && b && a[0] === b[0] && a[1] === b[1];

/** The palette tools that work now: key, icon, title. */
export const BOARD_TOOLS = {
  select: { icon: 'select', title: 'Select (V)', key: 'v' },
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
      rotate: button({ icon: 'rotate', title: 'Rotate the selected Footprints 90° (R; Shift+R the other way)', onClick: () => this.rotateSel(90) }),
      flip: button({ icon: 'flip', title: 'Flip the selected Footprints to the other side (F)', onClick: () => this.flipSel() }),
      lock: button({ icon: 'lock', title: 'Lock or unlock the selected Footprints (L)', onClick: () => this.lockSel() }),
    };
    this.gridCard = new GridCard({
      key: 'board-grid', choices: GRID_CHOICES,
      state: () => ({ grid: this.board.grid, origin: this.board.origin, scope: 'Board', originNote: 'The origin is measured from the page origin.' }),
      onGrid: (which, nm) => this.app.edit(`${which === 'alt' ? 'Alt grid' : 'Grid'}: ${gridLabel(nm)}`, (p) => setGrid(p, which, nm)),
      onOrigin: (at) => this.app.edit('Grid origin', (p) => { p.board.origin = at; }),
      onPick: () => this.setTool('origin'),
    });
    return [this.btn.undo, this.btn.redo, h('span', { class: 'sep' }), this.btn.del, this.btn.rotate, this.btn.flip, this.btn.lock, h('span', { class: 'sep' }), this.gridCard.button];
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
    const fps = this.board.footprints.filter((f) => this.fpSel.has(f.id));
    if (fps.length === 1 && !sel.length) parts.push(...this.footprintProps(fps[0]));
    else if (fps.length > 1) parts.push(h('div', { class: 'prop-title' }, `${fps.length} footprints${sel.length ? ` and ${sel.length} outline shape${sel.length === 1 ? '' : 's'}` : ''}`),
      h('p', { class: 'side-note' }, 'R rotates them 90° about their middle, F flips them to the other side, L locks them. Drag to move.'));
    if (['outline', 'polygon', 'circle'].includes(this.tool) || (!sel.length && this.tool === 'select')) {
      if (this.tool === 'outline') parts.push(field('Corner radius', fmt(this.radius), (v) => { this.radius = mm(Math.max(0, v)); pref.set('boardCornerRadius', toMm(this.radius)); this.ws?.view.invalidate(); }));
    }
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
    const size = b ? `${fmt(b.x1 - b.x0)} × ${fmt(b.y1 - b.y0)} mm` : 'no outline';
    const un = Object.values(this._rats?.unrouted || {}).reduce((a, b) => a + b, 0);
    return `${this.board.stack.copper}-layer · ${fmt(this.board.stack.thickness)} mm · ${size} · ${this.board.footprints.length} footprints${this.board.footprints.length ? ` · ${un} unrouted` : ''} · active ${this.activeLayer} · grid ${gridLabel(this.gridStep)}${this.alt ? ' (Alt)' : ''}`;
  }

  // ---------------------------------------------------------------- state

  refresh() {
    const n = this.board.outline.length;
    for (const i of [...this.selection]) if (i >= n) this.selection.delete(i);
    const ids = new Set(this.board.footprints.map((f) => f.id));
    for (const id of [...this.fpSel]) if (!ids.has(id)) this.fpSel.delete(id);
    this._rats = ratsnest(this.project);
    if (!copperLayerNames(this.board.stack.copper).includes(this.activeLayer) && /^In\d/.test(this.activeLayer)) this.activeLayer = 'F.Cu';
    if (this.btn) {
      this.btn.undo.disabled = !this.app.history.canUndo;
      this.btn.redo.disabled = !this.app.history.canRedo;
      this.btn.del.disabled = !this.selection.size;
      const anyFp = this.fpSel.size > 0;
      for (const k of ['rotate', 'flip', 'lock']) this.btn[k].disabled = !anyFp;
      const fs = this.board.footprints.filter((f) => this.fpSel.has(f.id));
      this.btn.lock.replaceChildren(icon(fs.length && fs.every((f) => f.locked) ? 'unlock' : 'lock', 20));
    }
    if (this.toolBtn) for (const [id, b] of Object.entries(this.toolBtn)) b.classList.toggle('active', this.tool === id);
    if (this.stackEl) { this.renderStack(); this.renderLayers(); this.renderProps(); }
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
      case 'origin': t = 'Grid origin: click where the grid, rulers and coordinates should measure from (outline corners attract it) · Esc back to Select'; break;
      case 'measure': t = this.measure && !this.measure.done ? 'Measure: click the second point' : 'Measure: click two points · Esc to stop'; break;
      default: t = this.fpSel.size
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
    this.tool = t; this.pts = null; this.arcNext = false; this.measure = null;
    if (t !== 'select') { this.selection.clear(); this.fpSel.clear(); this.netSel.clear(); }
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
    if (this.fpSel.size && !this.selection.size) { toast('Footprints come from the Schematic: delete the part there, then Update from Schematic (F8).', 'info', 3500); return; }
    if (!this.selection.size) return;
    const del = new Set(this.selection);
    this.selection.clear();
    this.edit(del.size === 1 ? 'Delete outline shape' : 'Delete outline shapes', (o, p) => { p.board.outline = o.filter((_, i) => !del.has(i)); });
  }

  nudge(dx, dy) {
    const sel = [...this.selection], fps = [...this.fpSel];
    this.app.edit(fps.length ? 'Move' : 'Move outline', (p) => { moveOutline(sel.map((i) => p.board.outline[i]), [dx, dy]); moveFootprints(p, fps, [dx, dy]); });
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
      if (this.tool === 'select') {
        const tol = 5 / ws.view.view.scale;
        const handle = this._handleAt(w, tol);
        if (handle && !e.shiftKey) {
          this.handleDrag = { ...handle, startPx: [e.clientX, e.clientY], snapshot: structuredClone(this.board.outline), moved: false };
          try { c.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
          return;
        }
        const fp = hitFootprint(this.project, w, { preferBack: this.activeLayer.startsWith('B.'), hidden: this.hidden });
        const hit = fp || this.hidden.has('Edge.Cuts') ? null : hitOutline(this.board.outline, w, tol);
        if (fp) {
          if (e.shiftKey) { if (this.fpSel.has(fp.id)) this.fpSel.delete(fp.id); else this.fpSel.add(fp.id); this.refresh(); return; }
          if (!this.fpSel.has(fp.id)) { this.fpSel = new Set([fp.id]); this.selection.clear(); }
          this.netSel.clear();
          // Footprints move by their origin, which lands on the grid
          this.drag = { start: w, anchor: fp.at, fpAnchor: true, startPx: [e.clientX, e.clientY], snapshot: structuredClone(this.board.outline), fpSnapshot: structuredClone(this.board.footprints), moved: false, delta: [0, 0], onlyFp: fp.id };
          try { c.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
          this.refresh();
          return;
        }
        const i = hit ? this.board.outline.indexOf(hit) : -1;
        if (e.shiftKey && hit) { if (this.selection.has(i)) this.selection.delete(i); else this.selection.add(i); this.refresh(); return; }
        if (hit) {
          if (!this.selection.has(i)) { this.selection = new Set([i]); this.fpSel.clear(); }
          // the selection moves by its handle nearest the pointer, so that handle lands on the grid or another object
          const anchors = handlePoints(this.board.outline.filter((_, k) => this.selection.has(k)));
          const anchor = anchors.reduce((b, p) => (Math.hypot(p[0] - w[0], p[1] - w[1]) < Math.hypot(b[0] - w[0], b[1] - w[1]) ? p : b), anchors[0] || w);
          this.drag = { start: w, anchor, startPx: [e.clientX, e.clientY], snapshot: structuredClone(this.board.outline), fpSnapshot: structuredClone(this.board.footprints), moved: false, delta: [0, 0], only: i };
          try { c.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
        } else { this.selection.clear(); this.fpSel.clear(); this.netSel.clear(); }
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
        const raw = [d.anchor[0] + w[0] - d.start[0], d.anchor[1] + w[1] - d.start[1]];
        const to = d.fpAnchor ? this.snapPt(raw) : this.snapAt(raw, this.selection);
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
      const d = this.drag; this.drag = null; this.preview = null; this.previewFps = null;
      if (d.moved && (d.delta[0] || d.delta[1])) { this.nudge(...d.delta); this._lockedNote([...this.fpSel]); }
      else {
        // a click picks one item out of a group
        if (!d.moved && d.onlyFp) { this.fpSel = new Set([d.onlyFp]); this.selection.clear(); }
        else if (!d.moved && d.only !== undefined) { this.selection = new Set([d.only]); this.fpSel.clear(); }
        this.refresh();
      }
    };
    c.addEventListener('pointerup', up);
    // double-clicking a pad selects its Net (its pads light up, here and on the Schematic)
    c.addEventListener('dblclick', (e) => {
      if (this.tool !== 'select') return;
      const hit = hitPad(this.project, world(e), { preferBack: this.activeLayer.startsWith('B.') });
      if (!hit?.pad.net) return;
      e.preventDefault();
      this.netSel = new Set([hit.pad.net]); this.fpSel.clear(); this.selection.clear();
      const n = [...padNets(this.board).values()].filter((x) => x.toLowerCase() === hit.pad.net.toLowerCase()).length;
      toast(`Net ${hit.pad.net}: ${n} pad${n === 1 ? '' : 's'}`, 'info', 1800);
      this.refresh();
    });
    watchAlt(ws, (on) => this.setAlt(on));
    this.gridCard.mount(ws);
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

  /**
   * Highlight outline shapes `outlineSel`, whole Footprints `fpIds` and single pads `padKeys`
   * ("componentId:pad") in the style from Settings, in colour C2.selection.
   */
  _highlightBoard(ctx, view, C, board, outlineSel, fpIds, padKeys, C2, noFade = false) {
    padKeys ||= new Set();
    const comps = new Set([...padKeys].map((k) => k.slice(0, k.lastIndexOf(':'))));
    const partial = new Set(board.footprints.filter((f) => !fpIds.has(f.id) && comps.has(f.componentId)).map((f) => f.id));
    const sub = { ...board, outline: board.outline.filter((_, k) => outlineSel.has(k)), footprints: board.footprints.filter((f) => fpIds.has(f.id) || partial.has(f.id)) };
    const nets = padNets(board), proj = { ...this.project, board };
    const boxes = [
      ...sub.outline.map((sh) => outlineBounds([sh])),
      ...sub.footprints.filter((f) => !partial.has(f.id)).map((f) => { const q = footprintOutline(proj, f); const xs = q.map((p) => p[0]), ys = q.map((p) => p[1]); return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }; }),
      ...sub.footprints.filter((f) => partial.has(f.id)).flatMap((f) => placedPads(proj, f, nets).filter((p) => padKeys.has(`${f.componentId}:${p.number}`)).map((p) => { const r = Math.max(...p.size) / 2; return { x0: p.at[0] - r, y0: p.at[1] - r, x1: p.at[0] + r, y1: p.at[1] + r }; })),
    ].filter(Boolean).map((b) => screenBox(view, b));
    const style = this.app.highlightStyle() === 'fade' && noFade ? 'glow' : this.app.highlightStyle();
    highlight(ctx, C2, style, (c, Cx) => drawBoard(c, view, Cx, sub, { project: this.project, hidden: this.hidden, only: true, padsOnly: partial, padKeys }), boxes);
  }

  /** Tell the Schematic what is selected here (when this is the workspace being used). */
  _publishProbe() {
    if (this.app.active !== this.ws) return;
    const sig = `${[...this.fpSel].sort().join()}|${[...this.netSel].join()}`;
    if (sig === this._probeSig) return;
    this._probeSig = sig;
    this.app.setProbe('board', probeFromBoard(this.project, [...this.fpSel], [...this.netSel]));
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
    const board = { ...this.board, outline: this.preview || this.board.outline, footprints: this.previewFps || this.board.footprints };
    drawBoard(ctx, view, C, board, { project: this.project, fpSel: this.fpSel, rats: this._rats?.wires, hidden: this.hidden, selection: this.selection, ...this._ghost(), measure: this.measure });
    // the selection, highlighted in the style chosen in Settings (the same in every editor)
    if (this.selection.size || this.fpSel.size || this.netSel.size) {
      const t = this.netSel.size ? boardTargets({ ...this.project, board }, probeFromBoard(this.project, [], [...this.netSel])) : null;
      this._highlightBoard(ctx, view, C, board, this.selection, this.fpSel, t?.pads, C);
    }
    // the Schematic's selection (cross-probing), in the theme's Highlight colour
    const probe = this.app.probeFor('board');
    if (probe) {
      const t = boardTargets({ ...this.project, board }, probe);
      const fps = new Set([...t.footprints].filter((id) => !this.fpSel.has(id)));
      if (fps.size || t.pads.size) this._highlightBoard(ctx, view, C, board, new Set(), fps, t.pads, { ...C, selection: C.highlight || C.selection }, this.selection.size || this.fpSel.size);
    }
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
      else if (this.selection.size || this.fpSel.size || this.netSel.size) { this.selection.clear(); this.fpSel.clear(); this.netSel.clear(); this.refresh(); }
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
    if (arrows[e.key] && (this.selection.size || this.fpSel.size)) { const [dx, dy] = arrows[e.key]; this.nudge(dx * this.board.grid.main, dy * this.board.grid.main); return true; }
    if (this.fpSel.size && this.tool === 'select') {
      if (k === 'r') { this.rotateSel(e.shiftKey ? -90 : 90); return true; }
      if (k === 'f') { this.flipSel(); return true; }
      if (k === 'l') { this.lockSel(); return true; }
    }
    for (const [id, t] of Object.entries(BOARD_TOOLS)) if (k === t.key) { this.setTool(id); return true; }
    return false;
  }
}
