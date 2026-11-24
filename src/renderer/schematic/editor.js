// Schematic editor (ticket #4): the Part picker (modelled on DabbleCAD's 3D Design shape
// panel), placing Parts by drag-and-drop, click-then-click or Enter, selecting, rotating,
// mirroring and deleting Symbols. Every change is one History transaction (one undo step).
import { h, icon, button } from '../ui/dom.js';
import { later } from '../workspaces/workspace.js';
import { MINI_LIBRARY, searchParts } from '../library/mini.js';
import { placeSymbol, rotateSymbols, mirrorSymbols, deleteSymbols, symbolBounds, hitSymbol } from '../core/schematic.js';
import { snapPt, SCH_GRID } from '../core/units.js';
import { drawSheet, symbolThumbnail } from './render.js';

const DRAG_START_PX = 4;
const IDLE_HINT = 'Nothing selected. Drag Parts from the picker on the right, or click one and then click the sheet. Middle- or right-drag to pan, scroll to zoom, Home to fit.';

export class SchematicEditor {
  constructor(app) {
    this.app = app;
    this.selection = new Set();
    this.placing = null; // { part, rot, mirror, drag, at }
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
        ...[['netlist', 'Netlist', 5], ['erc', 'ERC', 11], ['sheets', 'Sheets', 7]].map(([ic, label, t]) =>
          h('button', { class: 'side-tool', type: 'button', title: `${label} (coming in #${t})`, disabled: true }, icon(ic, 20), h('span', {}, label)))),
      h('div', { class: 'side-filter' }, h('select', { class: 'select', disabled: true, title: 'Part categories (coming in #12)' }, h('option', {}, 'All parts'))),
      h('div', { class: 'side-search' }, icon('search', 16), search),
      this.grid,
      h('div', { class: 'side-foot' }, later({ label: 'Import', icon: 'import', title: 'Import KiCad or Eagle libraries' }, 32), later({ label: 'New part', icon: 'plus', title: 'Create a Part in the Library tab' }, 13)));
    return this.panel;
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
    };
    return [this.btn.undo, this.btn.redo, h('span', { class: 'sep' }),
      later({ icon: 'copy', title: 'Copy (Ctrl+C)' }, 8), later({ icon: 'paste', title: 'Paste (Ctrl+V)' }, 8),
      later({ icon: 'duplicate', title: 'Duplicate (Ctrl+D)' }, 8), this.btn.del, h('span', { class: 'sep' }),
      this.btn.rotate, this.btn.mirror];
  }

  /** Enable/disable buttons and refresh the hint after any change. */
  refresh() {
    // drop selected ids that no longer exist (after undo, delete, project switch)
    const ids = new Set(this.sheet.symbols.map((y) => y.id));
    for (const id of [...this.selection]) if (!ids.has(id)) this.selection.delete(id);
    if (this.btn) {
      this.btn.undo.disabled = !this.app.history.canUndo;
      this.btn.redo.disabled = !this.app.history.canRedo;
      for (const k of ['del', 'rotate', 'mirror']) this.btn[k].disabled = this.selection.size === 0 && !this.placing;
      this.btn.del.disabled = this.selection.size === 0;
    }
    this._hint();
    this.ws?.view.invalidate();
  }

  _hint() {
    if (!this.ws) return;
    let text = IDLE_HINT;
    if (this.placing) text = `Placing ${this.placing.part.name}: ${this.placing.drag ? 'release on the sheet to place' : 'click to place, keep clicking for more'} · R rotate · X mirror · Esc ${this.placing.drag ? 'cancel' : 'stop'}`;
    else if (this.selection.size) {
      const refs = this.sheet.symbols.filter((y) => this.selection.has(y.id)).map((y) => this.project.components[y.componentId]?.ref);
      text = `Selected ${refs.join(', ')} · R rotate · X mirror · Del delete · Esc deselect`;
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
      const hit = hitSymbol(this.project, this.sheet, world, 3 / ws.view.view.scale);
      if (e.shiftKey && hit) { if (this.selection.has(hit.id)) this.selection.delete(hit.id); else this.selection.add(hit.id); }
      else this.selection = new Set(hit ? [hit.id] : []);
      this.refresh();
    });
    c.addEventListener('pointermove', (e) => {
      if (this.placing && !this.placing.drag) this._update(ws.view.view.toWorld(ws.view.local(e)));
    });
    c.addEventListener('pointerleave', () => { if (this.placing && !this.placing.drag) { this.placing.at = null; ws.view.invalidate(); } });
  }

  draw(ctx, view, C) {
    const ghost = this.placing && this.placing.at ? { part: this.placing.part, at: this.placing.at, rot: this.placing.rot, mirror: this.placing.mirror } : null;
    drawSheet(ctx, view, C, this.project, this.sheet, { selection: this.selection, ghost, bounds: (s) => symbolBounds(this.project, s) });
  }

  // ---------------------------------------------------------------- placing

  beginPlace(part, { drag = false } = {}) {
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

  // ---------------------------------------------------------------- commands

  rotate() {
    if (this.placing) { this.placing.rot = (this.placing.rot + 90) % 360; this.ws.view.invalidate(); return; }
    if (!this.selection.size) return;
    const ids = [...this.selection];
    this.app.edit('Rotate', (p) => rotateSymbols(p, ids));
  }

  mirror() {
    if (this.placing) { this.placing.mirror = !this.placing.mirror; this.ws.view.invalidate(); return; }
    if (!this.selection.size) return;
    const ids = [...this.selection];
    this.app.edit('Mirror', (p) => mirrorSymbols(p, ids));
  }

  deleteSelection() {
    if (!this.selection.size) return;
    const ids = [...this.selection];
    this.app.edit('Delete', (p) => deleteSymbols(p, ids));
    this.selection.clear();
    this.refresh();
  }

  /** Workspace keys (the app routes plain keys here when this workspace is active). */
  onKey(e) {
    const k = e.key.toLowerCase();
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

