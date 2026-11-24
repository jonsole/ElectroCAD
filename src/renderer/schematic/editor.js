// Schematic editor: the Part picker (modelled on DabbleCAD's 3D Design shape panel), placing
// Parts (#4), drawing Wires and the live Netlist panel (#5), selecting, rotating, mirroring
// and deleting. Every change is one History transaction (one undo step).
import { h, icon, button, popupMenu } from '../ui/dom.js';
import { allFieldStyles, fieldStyleById } from '../ui/fieldStyles.js';
import { later } from '../workspaces/workspace.js';
import { MINI_LIBRARY, searchParts } from '../library/mini.js';
import { placeSymbol, rotateSymbols, mirrorSymbols, deleteItems, symbolBounds, hitSymbol, addWire, hitWire, preferredAxis, routeWire, moveSelection, copySelection, pasteClip, itemsInRect, itemsBounds } from '../core/schematic.js';
import { buildNetlist } from '../core/netlist.js';
import { pinPositions } from '../core/project.js';
import { onSegment, eq } from '../core/geom.js';
import { snapPt, SCH_GRID } from '../core/units.js';
import { drawSheet, symbolThumbnail, measureText } from './render.js';
import { placeFields, fieldWarnings, setDefaultFieldStyle, setComponentFieldStyle } from '../core/fields.js';

const DRAG_START_PX = 4;
const IDLE_HINT = 'Nothing selected. Drag Parts from the picker on the right, or click one and then click the sheet. Middle- or right-drag to pan, scroll to zoom, Home to fit.';

export class SchematicEditor {
  constructor(app) {
    this.app = app;
    this.selection = new Set();
    this.placing = null; // { part, rot, mirror, drag, at }
    this.tool = 'select'; // 'select' | 'wire'
    this.wiring = null;   // { points: [committed…], cursor, posture: 'h' | 'v' }
    this.netlistOpen = false;
    this.drag = null;    // moving the selection: { start, ids, snapshot, delta, moved }
    this.marquee = null; // box select: { a, b } in world
    this.preview = null; // a copy of the Project showing a move in progress
    this.clipboard = null;
    this.query = '';
    this.parts = MINI_LIBRARY;
  }

  get project() { return this.app.project; }
  get sheet() { return this.project.schematic.sheets[0]; } // one Sheet until #7

  // ---------------------------------------------------------------- panel and toolbar

  buildPicker() {
    this.grid = h('div', { class: 'shape-grid', role: 'list', 'aria-label': 'Parts' });
    const search = h('input', { class: 'input', type: 'search', placeholder: 'Search parts', 'aria-label': 'Search parts' });
    search.addEventListener('input', () => { this.query = search.value; this.renderTiles(); });
    search.addEventListener('keydown', (e) => e.stopPropagation());
    this.panel = h('div', { class: 'side-panel picker', 'aria-label': 'Part picker' },
      h('div', { class: 'side-tools', style: { gridTemplateColumns: 'repeat(3, 1fr)' } },
        this.netlistBtn = h('button', { class: 'side-tool', type: 'button', title: 'Show the Netlist', onClick: () => this.toggleNetlist() }, icon('netlist', 20), h('span', {}, 'Netlist')),
        ...[['erc', 'ERC', 11], ['sheets', 'Sheets', 7]].map(([ic, label, t]) =>
          h('button', { class: 'side-tool', type: 'button', title: `${label} (coming in #${t})`, disabled: true }, icon(ic, 20), h('span', {}, label)))),
      h('div', { class: 'side-filter' }, h('select', { class: 'select', disabled: true, title: 'Part categories (coming in #12)' }, h('option', {}, 'All parts'))),
      h('div', { class: 'side-search' }, icon('search', 16), search),
      this.grid,
      this.styleFoot = h('div', { class: 'side-foot field-style-foot' }),
      h('div', { class: 'side-foot' }, later({ label: 'Import', icon: 'import', title: 'Import KiCad or Eagle libraries' }, 32), later({ label: 'New part', icon: 'plus', title: 'Create a Part in the Library tab' }, 13)));
    return this.panel;
  }

  /** The picker footer's Field style select: the Project default (ADR-0012). */
  renderStyleFoot() {
    if (!this.styleFoot) return;
    const sel = h('select', { class: 'select', 'aria-label': 'Field style for this project', title: 'Field style: how Reference designators and Values are drawn and placed', dataset: { role: 'field-style-default' } },
      ...allFieldStyles(this.app).map((s) => h('option', { value: s.id }, s.name)));
    sel.value = this.project.fieldStyles?.default || 'classic';
    sel.addEventListener('change', () => {
      const style = fieldStyleById(this.app, sel.value);
      if (style) this.app.edit(`Field style: ${style.name}`, (p) => setDefaultFieldStyle(p, style));
    });
    this.styleFoot.replaceChildren(h('span', { class: 'foot-label' }, 'Fields'), sel);
  }

  /** The toolbar's Fields menu: a Field style for the selected parts only. */
  fieldsMenu(anchor) {
    const comps = [...new Set(this.sheet.symbols.filter((y) => this.selection.has(y.id)).map((y) => y.componentId))];
    if (!comps.length) return;
    const current = new Set(comps.map((id) => this.project.components[id]?.fieldStyle || null));
    const one = current.size === 1 ? [...current][0] : undefined;
    popupMenu([
      { label: 'Project default', checked: one === null, onClick: () => this.app.edit('Field style: project default', (p) => setComponentFieldStyle(p, comps, null)) },
      'sep',
      ...allFieldStyles(this.app).map((s) => ({ label: s.name, checked: one === s.id, onClick: () => this.app.edit(`Field style: ${s.name}`, (p) => setComponentFieldStyle(p, comps, s)) })),
    ], anchor);
  }

  renderTiles() {
    if (!this.grid) return;
    const C = this.app.canvasColors('schematic');
    const list = searchParts(this.parts, this.query);
    this.grid.replaceChildren(...list.map((part) => this._tile(part, C)));
    if (!list.length) this.grid.append(h('div', { class: 'side-empty' }, 'No parts match.'));
  }

  _tile(part, C) {
    const img = h('img', { alt: '', draggable: false, src: symbolThumbnail(part, C) });
    const tile = h('div', { class: 'shape-tile part-tile', role: 'listitem', tabindex: '0', dataset: { part: part.id }, 'aria-label': part.name,
      title: `${part.name}: drag onto the sheet, or click then click to place (R rotates, X mirrors, Esc stops)` }, img, h('span', {}, part.name));
    tile.addEventListener('pointerdown', (e) => this._tilePointerDown(e, part));
    tile.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.placeAtViewCenter(part); }
    });
    return tile;
  }

  toolbar() {
    this.btn = {
      undo: button({ icon: 'undo', title: 'Undo (Ctrl+Z)', onClick: () => this.app.undo() }),
      redo: button({ icon: 'redo', title: 'Redo (Ctrl+Shift+Z)', onClick: () => this.app.redo() }),
      del: button({ icon: 'trash', title: 'Delete (Del)', onClick: () => this.deleteSelection() }),
      copy: button({ icon: 'copy', title: 'Copy (Ctrl+C)', onClick: () => this.copy() }),
      paste: button({ icon: 'paste', title: 'Paste (Ctrl+V)', onClick: () => this.paste() }),
      dup: button({ icon: 'duplicate', title: 'Duplicate (Ctrl+D)', onClick: () => this.duplicate() }),
      rotate: button({ icon: 'rotate', title: 'Rotate (R)', onClick: () => this.rotate() }),
      mirror: button({ icon: 'mirror', title: 'Mirror (X)', onClick: () => this.mirror() }),
      fields: button({ label: 'Fields', icon: 'ltext', title: 'Field style for the selected parts', onClick: (e) => this.fieldsMenu(e.currentTarget) }),
    };
    return [this.btn.undo, this.btn.redo, h('span', { class: 'sep' }),
      this.btn.copy, this.btn.paste, this.btn.dup, this.btn.del, h('span', { class: 'sep' }),
      this.btn.rotate, this.btn.mirror, h('span', { class: 'sep' }), this.btn.fields];
  }

  /** The left tool palette: Select and Wire are live; the rest name their tickets. */
  tools(toolButton) {
    this.toolBtn = {
      select: button({ icon: 'select', title: 'Select (V)', onClick: () => this.setTool('select') }),
      wire: button({ icon: 'wire', title: 'Wire (W)', onClick: () => this.setTool('wire') }),
    };
    return [this.toolBtn.select, this.toolBtn.wire,
      toolButton('netLabel', 'Net label (L)', { ticket: 7 }), toolButton('globalLabel', 'Global label (Ctrl+L)', { ticket: 7 }),
      toolButton('power', 'Power symbol (P)', { ticket: 7 }), toolButton('ground', 'Ground (G)', { ticket: 7 }),
      toolButton('noConnect', 'No-connect (Q)', { ticket: 11 }), null,
      toolButton('ltext', 'Text', { ticket: 8 }), toolButton('ruler', 'Measure', { ticket: 8 })];
  }

  setTool(tool) {
    if (this.placing) this.endPlace();
    this.wiring = null;
    this.tool = tool;
    if (tool === 'wire') this.selection.clear();
    if (this.ws) this.ws.view.canvas.style.cursor = tool === 'wire' ? 'crosshair' : '';
    this.refresh();
  }

  /** Enable/disable buttons and refresh the hint after any change. */
  refresh() {
    // drop selected ids that no longer exist (after undo, delete, project switch)
    const ids = new Set([...this.sheet.symbols.map((y) => y.id), ...this.sheet.wires.map((w) => w.id)]);
    for (const id of [...this.selection]) if (!ids.has(id)) this.selection.delete(id);
    if (this.btn) {
      this.btn.undo.disabled = !this.app.history.canUndo;
      this.btn.redo.disabled = !this.app.history.canRedo;
      for (const k of ['del', 'rotate', 'mirror']) this.btn[k].disabled = this.selection.size === 0 && !this.placing;
      this.btn.del.disabled = this.selection.size === 0;
      const anySym = this.sheet.symbols.some((y) => this.selection.has(y.id));
      if (!this.placing) { this.btn.rotate.disabled = !anySym; this.btn.mirror.disabled = !anySym; }
      this.btn.fields.disabled = !anySym;
      this.btn.copy.disabled = this.selection.size === 0;
      this.btn.dup.disabled = this.selection.size === 0;
      this.btn.paste.disabled = !this.clipboard;
    }
    if (this.toolBtn) for (const [t, b] of Object.entries(this.toolBtn)) b.classList.toggle('active', this.tool === t && !this.placing);
    this.renderNetlist();
    this.renderStyleFoot();
    this._hint();
    this.ws?.view.invalidate();
  }

  _hint() {
    if (!this.ws) return;
    let text = IDLE_HINT;
    if (this.fieldWarnings && this.fieldWarnings.length) text = `⚠ ${this.fieldWarnings.length === 1 ? this.fieldWarnings[0] : `${this.fieldWarnings.length} parts' fields overlap (${this.fieldWarnings.slice(0, 3).join('; ')}${this.fieldWarnings.length > 3 ? '…' : ''})`} — move parts apart or pick another Field style. ` + IDLE_HINT.replace('Nothing selected. ', '');
    if (this.tool === 'wire') text = this.wiring
      ? 'Drawing a wire: click to add a corner · click a Pin or Wire (or double-click) to finish · / switch corner direction · Backspace undo corner · Esc finish'
      : 'Wire: click a Pin or a point on the grid to start · Esc back to Select';
    else if (this.placing) text = `Placing ${this.placing.part.name}: ${this.placing.drag ? 'release on the sheet to place' : 'click to place, keep clicking for more'} · R rotate · X mirror · Esc ${this.placing.drag ? 'cancel' : 'stop'}`;
    else if (this.selection.size) {
      const refs = this.sheet.symbols.filter((y) => this.selection.has(y.id)).map((y) => this.project.components[y.componentId]?.ref);
      const nw = this.sheet.wires.filter((w) => this.selection.has(w.id)).length;
      const what = [...refs, ...(nw ? [`${nw} wire${nw === 1 ? '' : 's'}`] : [])].join(', ');
      text = `Selected ${what} · drag or arrow keys to move${refs.length ? ' · R rotate · X mirror' : ''} · Ctrl+C/V/D · Del delete · Esc deselect`;
    }
    this.ws.hint.textContent = text;
  }

  // ---------------------------------------------------------------- canvas

  attach(ws) {
    this.ws = ws;
    const c = ws.view.canvas;
    c.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const world = ws.view.view.toWorld(ws.view.local(e));
      if (this.placing && !this.placing.drag) { this._update(world); this.commitPlace(); return; }
      if (this.tool === 'wire') { this._wireClick(world, e.detail >= 2); return; }
      const tol = 4 / ws.view.view.scale;
      const hit = hitSymbol(this.project, this.sheet, world, 3 / ws.view.view.scale) || hitWire(this.sheet, world, tol);
      if (e.shiftKey && hit) { if (this.selection.has(hit.id)) this.selection.delete(hit.id); else this.selection.add(hit.id); this.refresh(); return; }
      if (hit) {
        if (!this.selection.has(hit.id)) this.selection = new Set([hit.id]);
        // press on a selected item: dragging moves the selection, wires following
        this.drag = { start: snapPt(world, SCH_GRID), startPx: [e.clientX, e.clientY], ids: [...this.selection], snapshot: structuredClone(this.project), delta: [0, 0], moved: false };
      } else {
        if (!e.shiftKey) this.selection = new Set();
        this.marquee = { a: world, b: world, startPx: [e.clientX, e.clientY], add: e.shiftKey, base: new Set(this.selection) };
      }
      c.setPointerCapture(e.pointerId);
      this.refresh();
    });
    c.addEventListener('pointerup', (e) => {
      if (e.button !== 0) return;
      if (this.drag) {
        const d = this.drag;
        this.drag = null; this.preview = null;
        if (d.moved && (d.delta[0] || d.delta[1])) {
          const ids = d.ids, delta = d.delta;
          this.app.edit('Move', (p) => moveSelection(p, p.schematic.sheets[0], ids, delta));
        }
        this.refresh();
      } else if (this.marquee) {
        this.marquee = null;
        this.refresh();
      }
    });
    c.addEventListener('pointermove', (e) => {
      if (this.placing && !this.placing.drag) this._update(ws.view.view.toWorld(ws.view.local(e)));
      const world = ws.view.view.toWorld(ws.view.local(e));
      this.cursor = snapPt(world, SCH_GRID);
      if (this.tool === 'wire') ws.view.invalidate();
      if (this.drag && (e.buttons & 1)) {
        const d = this.drag;
        if (!d.moved && Math.hypot(e.clientX - d.startPx[0], e.clientY - d.startPx[1]) < 4) return;
        d.moved = true;
        const delta = [this.cursor[0] - d.start[0], this.cursor[1] - d.start[1]];
        if (delta[0] !== d.delta[0] || delta[1] !== d.delta[1]) {
          d.delta = delta;
          const pv = structuredClone(d.snapshot);
          moveSelection(pv, pv.schematic.sheets[0], d.ids, delta);
          this.preview = pv;
          ws.view.canvas.style.cursor = 'move';
          ws.view.invalidate();
        }
      } else if (this.marquee && (e.buttons & 1)) {
        const m = this.marquee;
        if (Math.hypot(e.clientX - m.startPx[0], e.clientY - m.startPx[1]) < 4) return;
        m.b = world;
        const r = { x0: Math.min(m.a[0], m.b[0]), y0: Math.min(m.a[1], m.b[1]), x1: Math.max(m.a[0], m.b[0]), y1: Math.max(m.a[1], m.b[1]) };
        const mode = m.b[0] >= m.a[0] ? 'window' : 'crossing';
        this.selection = new Set([...(m.add ? m.base : []), ...itemsInRect(this.project, this.sheet, r, mode)]);
        this.refresh();
      }
      if (!this.drag && ws.view.canvas.style.cursor === 'move') ws.view.canvas.style.cursor = '';
    });
    // the floating Netlist panel lives over the canvas, like DabbleCAD's inspector card
    this.netlistEl = h('div', { class: 'float-panel netlist-panel', role: 'region', 'aria-label': 'Netlist' });
    ws.view.el.append(this.netlistEl);
    this.renderNetlist();
    c.addEventListener('pointerleave', () => { if (this.placing && !this.placing.drag) { this.placing.at = null; ws.view.invalidate(); } });
  }

  draw(ctx, view, C) {
    const ghost = this.placing && this.placing.at ? { part: this.placing.part, at: this.placing.at, rot: this.placing.rot, mirror: this.placing.mirror } : null;
    let wiring = null, target = null;
    if (this.tool === 'wire' && this.cursor) {
      target = this._endTarget(this.cursor) ? this.cursor : null;
      if (this.wiring) wiring = [...this.wiring.points, ...this._route(this.wiring.points[this.wiring.points.length - 1], this.cursor)];
    }
    const proj = this.preview || this.project;
    const sheet = proj.schematic.sheets[0];
    this.placement = placeFields(proj, sheet, { measure: measureText });
    drawSheet(ctx, view, C, proj, sheet, { selection: this.selection, ghost, bounds: (s) => symbolBounds(proj, s), wiring, target, placement: this.placement });
    if (this.marquee && (this.marquee.a[0] !== this.marquee.b[0] || this.marquee.a[1] !== this.marquee.b[1])) {
      const m = this.marquee;
      const [x0, y0] = view.toScreen(m.a), [x1, y1] = view.toScreen(m.b);
      const crossing = m.b[0] < m.a[0];
      ctx.save();
      ctx.fillStyle = C.selection; ctx.globalAlpha = 0.1; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      ctx.globalAlpha = 1; ctx.strokeStyle = C.selection; ctx.lineWidth = 1;
      if (crossing) ctx.setLineDash([5, 4]);
      ctx.strokeRect(Math.round(x0) + 0.5, Math.round(y0) + 0.5, x1 - x0, y1 - y0);
      ctx.restore();
    }
    const warn = fieldWarnings(this.project, this.sheet, this.placement);
    if (warn.join() !== (this.fieldWarnings || []).join()) { this.fieldWarnings = warn; this._hint(); }
  }

  // ---------------------------------------------------------------- placing

  beginPlace(part, { drag = false } = {}) {
    this.tool = 'select'; this.wiring = null;
    this.placing = { part, rot: 0, mirror: false, drag, at: null };
    this.selection.clear();
    this.ws.view.canvas.style.cursor = 'crosshair';
    this.refresh();
  }

  endPlace() {
    if (!this.placing) return;
    this.placing = null;
    this.ws.view.canvas.style.cursor = '';
    this.refresh();
  }

  _update(world) {
    if (!this.placing) return;
    this.placing.at = snapPt(world, SCH_GRID);
    this.ws.view.invalidate();
  }

  /** Place the ghost where it is. Click mode keeps placing; drag mode ends. */
  commitPlace() {
    const pl = this.placing;
    if (!pl || !pl.at) return null;
    const res = this.app.edit(`Place ${pl.part.name}`, (p) => placeSymbol(p, p.schematic.sheets[0], pl.part, pl.at, { rot: pl.rot, mirror: pl.mirror }));
    if (pl.drag) { this.placing = null; this.ws.view.canvas.style.cursor = ''; }
    this.selection = new Set([res.sym.id]);
    this.refresh();
    return res;
  }

  /** Enter or Space on a tile: drop the Part in the middle of the view. */
  placeAtViewCenter(part) {
    const v = this.ws.view;
    const at = snapPt(v.view.toWorld([v.w / 2, v.h / 2]), SCH_GRID);
    const res = this.app.edit(`Place ${part.name}`, (p) => placeSymbol(p, p.schematic.sheets[0], part, at));
    this.selection = new Set([res.sym.id]);
    this.refresh();
    return res;
  }

  _tilePointerDown(e, part) {
    if (e.button !== 0) return;
    e.preventDefault();
    const start = [e.clientX, e.clientY];
    let dragging = false;
    const canvas = this.ws.view.canvas;
    const overCanvas = (ev) => {
      const r = canvas.getBoundingClientRect();
      return ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
    };
    const move = (ev) => {
      if (!dragging && Math.hypot(ev.clientX - start[0], ev.clientY - start[1]) >= DRAG_START_PX) { dragging = true; this.beginPlace(part, { drag: true }); }
      if (!dragging || !this.placing) return;
      if (overCanvas(ev)) { const loc = this.ws.view.local(ev); this.ws.view.setCursor(loc); this._update(this.ws.view.view.toWorld(loc)); }
      else { this.placing.at = null; this.ws.view.invalidate(); }
    };
    const up = (ev) => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      if (!dragging) { this.beginPlace(part, { drag: false }); return; } // a click: click-then-click mode
      if (this.placing && this.placing.drag) {
        if (overCanvas(ev) && this.placing.at) this.commitPlace(); else this.endPlace(); // dropped outside: cancel
      }
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  }

  // ---------------------------------------------------------------- wires (#5)

  /**
   * Route from a to b with one corner. By default the corner follows the direction the wire is
   * already going (or the Wire/Pin it starts from) and avoids running through other Pins;
   * '/' forces the other way for this wire.
   */
  _route(a, b) {
    const drawn = this.wiring ? this.wiring.points : [a];
    const forced = this.wiring && this.wiring.posture !== 'auto' ? this.wiring.posture : null;
    const axis = forced || preferredAxis(this.project, this.sheet, a, drawn);
    return routeWire(this.project, this.sheet, a, b, { axis, auto: !forced });
  }

  /** Is `p` somewhere a Wire should end: a Pin tip or a point on an existing Wire? */
  _endTarget(p) {
    for (const sym of this.sheet.symbols) for (const { at } of pinPositions(this.project, sym)) if (eq(at, p)) return 'pin';
    for (const w of this.sheet.wires) if (onSegment(p, w.a, w.b)) return 'wire';
    return null;
  }

  _wireClick(world, dbl) {
    const p = snapPt(world, SCH_GRID);
    if (!this.wiring) {
      this.wiring = { points: [p], posture: 'auto' };
      this.refresh();
      return;
    }
    const pts = this.wiring.points;
    const last = pts[pts.length - 1];
    if (!eq(p, last)) pts.push(...this._route(last, p));
    // finish on a Pin or Wire (not where we started), on a double-click, or clicking the same point twice
    const ends = this._endTarget(p) && !(pts.length && eq(p, pts[0]) && pts.length === 1);
    if (dbl || eq(p, last) || (ends && pts.length > 1)) this.finishWire();
    else this.refresh();
  }

  finishWire() {
    const w = this.wiring;
    this.wiring = null;
    if (!w || w.points.length < 2) { this.refresh(); return; }
    const pts = w.points;
    this.app.edit('Draw wire', (p) => addWire(p, p.schematic.sheets[0], pts));
    this.refresh();
  }

  // ---------------------------------------------------------------- Netlist panel (#5)

  toggleNetlist(open = !this.netlistOpen) {
    this.netlistOpen = open;
    this.netlistBtn?.classList.toggle('active', open);
    this.renderNetlist();
  }

  renderNetlist() {
    const el = this.netlistEl;
    if (!el) return;
    el.style.display = this.netlistOpen ? '' : 'none';
    if (!this.netlistOpen) return;
    const nl = buildNetlist(this.project);
    const pin = (x) => h('span', { class: 'nl-pin', title: `${x.ref} pin ${x.pin} → pad ${x.pad}` }, `${x.ref}.${x.pin}`);
    el.replaceChildren(
      h('div', { class: 'fp-head' }, h('b', {}, 'Netlist'), h('span', { class: 'fp-count' }, `${nl.nets.length} net${nl.nets.length === 1 ? '' : 's'}`),
        button({ icon: 'close', title: 'Close', cls: 'btn-ghost', onClick: () => this.toggleNetlist(false) })),
      h('div', { class: 'fp-body' },
        nl.nets.length ? null : h('p', { class: 'side-note' }, 'No nets yet. Use the Wire tool (W) to connect Pins.'),
        ...nl.nets.map((n) => h('div', { class: 'nl-net', dataset: { net: n.name } }, h('div', { class: 'nl-name' }, n.name), h('div', { class: 'nl-pins' }, ...n.pins.map(pin)))),
        nl.unconnected.length ? h('div', { class: 'nl-net nl-unconnected' }, h('div', { class: 'nl-name' }, `Unconnected pins (${nl.unconnected.length})`), h('div', { class: 'nl-pins' }, ...nl.unconnected.map(pin))) : null));
  }

  // ---------------------------------------------------------------- commands

  _selectedSymbolIds() { return this.sheet.symbols.filter((y) => this.selection.has(y.id)).map((y) => y.id); }

  rotate() {
    if (this.placing) { this.placing.rot = (this.placing.rot + 90) % 360; this.ws.view.invalidate(); return; }
    const ids = this._selectedSymbolIds();
    if (!ids.length) return;
    this.app.edit('Rotate', (p) => rotateSymbols(p, ids));
  }

  mirror() {
    if (this.placing) { this.placing.mirror = !this.placing.mirror; this.ws.view.invalidate(); return; }
    const ids = this._selectedSymbolIds();
    if (!ids.length) return;
    this.app.edit('Mirror', (p) => mirrorSymbols(p, ids));
  }

  deleteSelection() {
    if (!this.selection.size) return;
    const ids = [...this.selection];
    this.app.edit('Delete', (p) => deleteItems(p, ids));
    this.selection.clear();
    this.refresh();
  }

  copy() {
    if (!this.selection.size) return;
    this.clipboard = copySelection(this.project, this.sheet, [...this.selection]);
    this.refresh();
  }

  /** Paste so the copied group sits under the cursor (or beside the original when the cursor is off the sheet). */
  paste(offset = null) {
    const clip = this.clipboard;
    if (!clip) return;
    const ids0 = [...clip.symbols.map((y) => y.id), ...clip.wires.map((w) => w.id)];
    const tmp = { components: clip.components, parts: clip.parts, schematic: { sheets: [{ symbols: clip.symbols, wires: clip.wires }] } };
    const b = itemsBounds(tmp, tmp.schematic.sheets[0], ids0);
    let delta = offset;
    if (!delta) {
      const anchor = snapPt([(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2], SCH_GRID);
      delta = this.cursor ? [this.cursor[0] - anchor[0], this.cursor[1] - anchor[1]] : [SCH_GRID * 4, SCH_GRID * 4];
      if (!delta[0] && !delta[1]) delta = [SCH_GRID * 4, SCH_GRID * 4];
    }
    const ids = this.app.edit('Paste', (p) => pasteClip(p, p.schematic.sheets[0], clip, delta));
    this.selection = new Set(ids);
    this.refresh();
  }

  duplicate() {
    if (!this.selection.size) return;
    const saved = this.clipboard;
    this.clipboard = copySelection(this.project, this.sheet, [...this.selection]);
    this.paste([SCH_GRID * 4, SCH_GRID * 4]);
    this.clipboard = saved || this.clipboard;
  }

  nudge(dx, dy) {
    if (!this.selection.size) return;
    const ids = [...this.selection];
    this.app.edit('Move', (p) => moveSelection(p, p.schematic.sheets[0], ids, [dx * SCH_GRID, dy * SCH_GRID]));
    this.refresh();
  }

  selectAll() {
    this.selection = new Set([...this.sheet.symbols.map((y) => y.id), ...this.sheet.wires.map((w) => w.id)]);
    this.refresh();
  }

  /** Ctrl/Cmd shortcuts the app routes here (copy, paste, duplicate, select all). */
  onModKey(e) {
    const k = e.key.toLowerCase();
    if (k === 'c') { this.copy(); return true; }
    if (k === 'v') { this.paste(); return true; }
    if (k === 'd') { this.duplicate(); return true; }
    if (k === 'a') { this.selectAll(); return true; }
    return false;
  }

  /** Workspace keys (the app routes plain keys here when this workspace is active). */
  onKey(e) {
    const k = e.key.toLowerCase();
    if (this.tool === 'wire') {
      if (e.key === 'Escape') { if (this.wiring) this.finishWire(); else this.setTool('select'); return true; }
      if (e.key === '/' && this.wiring) {
        // flip the corner that's showing now, for the rest of this wire
        const pts = this.wiring.points, last = pts[pts.length - 1];
        const shown = this.cursor ? this._route(last, this.cursor) : null;
        const shownAxis = shown && shown.length === 2 ? (shown[0][1] === last[1] ? 'h' : 'v') : preferredAxis(this.project, this.sheet, last, pts);
        this.wiring.posture = shownAxis === 'h' ? 'v' : 'h';
        this.ws.view.invalidate(); return true;
      }
      if (e.key === 'Backspace' && this.wiring) { if (this.wiring.points.length > 1) this.wiring.points.pop(); else this.wiring = null; this.refresh(); return true; }
      if (e.key === 'Enter' && this.wiring) { this.finishWire(); return true; }
    }
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (arrows[e.key] && this.selection.size && this.tool === 'select') { const [dx, dy] = arrows[e.key]; const n = e.shiftKey ? 10 : 1; this.nudge(dx * n, dy * n); return true; }
    if (k === 'w') { this.setTool('wire'); return true; }
    if (k === 'v') { this.setTool('select'); return true; }
    if (k === 'r') { this.rotate(); return true; }
    if (k === 'x') { this.mirror(); return true; }
    if (e.key === 'Delete' || e.key === 'Backspace') { this.deleteSelection(); return true; }
    if (e.key === 'Escape') {
      if (this.placing) this.endPlace();
      else if (this.selection.size) { this.selection.clear(); this.refresh(); }
      return true;
    }
    return false;
  }
}

