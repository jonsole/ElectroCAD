// Schematic editor: the Part picker (modelled on DabbleCAD's 3D Design shape panel), placing
// Parts (#4), drawing Wires and the live Netlist panel (#5), selecting, rotating, mirroring
// and deleting. Every change is one History transaction (one undo step).
import { h, icon, button, popupMenu } from '../ui/dom.js';
import { allFieldStyles, fieldStyleById } from '../ui/fieldStyles.js';
import { later } from '../workspaces/workspace.js';
import { MINI_LIBRARY, searchParts } from '../library/mini.js';
import { placeSymbol, rotateSymbols, mirrorSymbols, deleteItems, symbolBounds, hitSymbol, addWire, hitWire } from '../core/schematic.js';
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
      rotate: button({ icon: 'rotate', title: 'Rotate (R)', onClick: () => this.rotate() }),
      mirror: button({ icon: 'mirror', title: 'Mirror (X)', onClick: () => this.mirror() }),
      fields: button({ label: 'Fields', icon: 'ltext', title: 'Field style for the selected parts', onClick: (e) => this.fieldsMenu(e.currentTarget) }),
    };
    return [this.btn.undo, this.btn.redo, h('span', { class: 'sep' }),
      later({ icon: 'copy', title: 'Copy (Ctrl+C)' }, 8), later({ icon: 'paste', title: 'Paste (Ctrl+V)' }, 8),
      later({ icon: 'duplicate', title: 'Duplicate (Ctrl+D)' }, 8), this.btn.del, h('span', { class: 'sep' }),
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
      text = `Selected ${what}${refs.length ? ' · R rotate · X mirror' : ''} · Del delete · Esc deselect`;
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
      if (e.shiftKey && hit) { if (this.selection.has(hit.id)) this.selection.delete(hit.id); else this.selection.add(hit.id); }
      else this.selection = new Set(hit ? [hit.id] : []);
      this.refresh();
    });
    c.addEventListener('pointermove', (e) => {
      if (this.placing && !this.placing.drag) this._update(ws.view.view.toWorld(ws.view.local(e)));
      if (this.tool === 'wire') { this.cursor = snapPt(ws.view.view.toWorld(ws.view.local(e)), SCH_GRID); ws.view.invalidate(); }
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
    this.placement = placeFields(this.project, this.sheet, { measure: measureText });
    drawSheet(ctx, view, C, this.project, this.sheet, { selection: this.selection, ghost, bounds: (s) => symbolBounds(this.project, s), wiring, target, placement: this.placement });
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
   * Orthogonal route from a to b with one corner. By default ('auto') it tries horizontal-first,
   * then vertical-first, and takes the first that doesn't run through another Pin (which would
   * connect it by accident); '/' forces one or the other.
   */
  _route(a, b) {
    if (a[0] === b[0] || a[1] === b[1]) return [b];
    const h = [[b[0], a[1]], b], v = [[a[0], b[1]], b];
    const posture = this.wiring?.posture || 'auto';
    if (posture === 'h') return h;
    if (posture === 'v') return v;
    const pins = this.sheet.symbols.flatMap((y) => pinPositions(this.project, y).map((x) => x.at)).filter((q) => !eq(q, a) && !eq(q, b));
    const crosses = ([c]) => pins.some((q) => onSegment(q, a, c) || onSegment(q, c, b));
    return !crosses(h) ? h : !crosses(v) ? v : h;
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

  /** Workspace keys (the app routes plain keys here when this workspace is active). */
  onKey(e) {
    const k = e.key.toLowerCase();
    if (this.tool === 'wire') {
      if (e.key === 'Escape') { if (this.wiring) this.finishWire(); else this.setTool('select'); return true; }
      if (e.key === '/' && this.wiring) {
        // flip whatever corner is showing now
        const pts = this.wiring.points, last = pts[pts.length - 1];
        const shown = this.cursor ? this._route(last, this.cursor) : null;
        this.wiring.posture = shown && shown.length === 2 && shown[0][1] === last[1] ? 'v' : 'h';
        this.ws.view.invalidate(); return true;
      }
      if (e.key === 'Backspace' && this.wiring) { if (this.wiring.points.length > 1) this.wiring.points.pop(); else this.wiring = null; this.refresh(); return true; }
      if (e.key === 'Enter' && this.wiring) { this.finishWire(); return true; }
    }
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

