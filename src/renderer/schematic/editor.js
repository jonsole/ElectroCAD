// Schematic editor: the Part picker (modelled on DabbleCAD's 3D Design shape panel), placing
// Parts (#4), drawing Wires and the live Netlist panel (#5), selecting, rotating, mirroring
// and deleting. Every change is one History transaction (one undo step).
import { h, icon, button, popupMenu, toast } from '../ui/dom.js';
import { allFieldStyles, fieldStyleById } from '../ui/fieldStyles.js';
import { later } from '../workspaces/workspace.js';
import { STARTER_LIBRARY, CATEGORIES, searchParts, groupParts } from '../library/starter.js';
import { allFootprints } from '../library/footprints.js';
import { toggleNoConnect, hitNoConnect, placedUnits, unitSuggestion, nextUnplacedUnit, unitLetter, placeSymbol, rotateSymbols, mirrorSymbols, deleteItems, symbolBounds, hitSymbol, addWire, addLabel, addSheet, renameSheet, moveSheet, deleteSheet, validateSheetName, hitWire, preferredAxis, routeWire, moveSelection, copySelection, pasteClip, itemsInRect, itemsBounds, cleanupWires } from '../core/schematic.js';
import { buildNetlist } from '../core/netlist.js';
import { runErc, filterViolations } from '../core/erc.js';
import { pinPositions, nextRef, partOf } from '../core/project.js';
import { onSegment, eq } from '../core/geom.js';
import { snapPt, SCH_GRID, mm } from '../core/units.js';

const mm127 = mm(1.27);
import { drawSheet, symbolThumbnail, measureText, drawFootprintPreview } from './render.js';
import { SchematicInspector } from './inspector.js';
import { makeDraggable } from '../ui/draggable.js';
import { placeFields, fieldWarnings, setDefaultFieldStyle, setComponentFieldStyle, hitField, styleFor, pinField, unpinFields, hasPinnedFields } from '../core/fields.js';
import { validateRef, updateComponent } from '../core/components.js';
import { hitLabel, labelBounds, labelShape, labelFrame, validateLabelName, isPower, netNameChoices, filterNetNames, canonicalNetName } from '../core/labels.js';

/** The label tools: what each one places. */
const LABEL_TOOLS = {
  netLabel: { style: 'label', scope: 'local', what: 'Net label' },
  globalLabel: { style: 'label', scope: 'global', what: 'Global label' },
  power: { style: 'power', scope: 'global', what: 'Power symbol' },
  ground: { style: 'gnd', scope: 'global', what: 'Ground' },
};

/** EN1 → EN2, D7 → D8; names without a trailing number stay as they are. */
/** The picker's layouts (Explorer's View menu). */
const VIEWS = {
  icons: { label: 'Icons', icon: 'viewIcons' },
  small: { label: 'Small icons', icon: 'viewSmall' },
  list: { label: 'List', icon: 'viewList' },
  details: { label: 'Details', icon: 'viewDetails' },
};
/** The picker tree's groupings (View menu). */
const GROUPS = { none: 'No groups', category: 'Group by category', manufacturer: 'Group by manufacturer' };
/** Details view columns (the first is the name next to the thumbnail). */
const DETAIL_COLS = [
  { key: 'name', label: 'Name', get: (p) => p.name },
  { key: 'category', label: 'Category', get: (p) => p.category || '' },
  { key: 'value', label: 'Value', get: (p) => p.defaultValue || '' },
  { key: 'units', label: 'Units', short: 'Units', get: (p) => p.units.length },
  { key: 'footprints', label: 'Footprints', short: 'Fp', get: (p) => Object.keys(p.footprints || {}).length },
];
const readPref = (k, d) => { try { return localStorage.getItem(k) || d; } catch { return d; } };
const writePref = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private window */ } };

/** Chips in the footprint row go smallest first: 0402, 0603, 0805, 1206, then through-hole, then packages. */
const FP_ORDER = ['0402', '0603', '0805', '1206', 'THT'];
const fpOrder = (fpId) => { const i = FP_ORDER.findIndex((s) => fpId.endsWith(s)); return i < 0 ? FP_ORDER.length : i; };
/** A short chip label: the size code, THT, or the package name (SOIC-14, DIP-8, SOT-223…). */
function shortFpLabel(fpId, fp) {
  const size = FP_ORDER.find((s) => fpId.endsWith(s));
  if (size) return size;
  const m = /^(PinHeader)_(\d)x(\d+)/.exec(fp.name);
  if (m) return `${m[2]}×${+m[3]} header`;
  return fp.name.split('_')[0];
}

const bumpName = (n) => n.replace(/(\d+)$/, (d) => String(Number(d) + 1).padStart(d.length, '0'));

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
    this.ercOpen = false;
    this.ercFocus = null; // the violation last jumped to (ringed on the canvas)
    this.ercFilter = { error: true, warning: true, info: true, query: '' }; // the ERC card's filter
    this.drag = null;    // moving the selection: { start, ids, snapshot, delta, moved }
    this.marquee = null; // box select: { a, b } in world
    this.preview = null; // a copy of the Project showing a move in progress
    this.clipboard = null;
    this.query = '';
    this.parts = STARTER_LIBRARY;
    this.category = 'All';
    // the picker's layout, like Explorer's View menu; a per-browser preference
    this.pickerView = readPref('electrocad.pickerView', 'icons');
    this.pickerSort = { key: 'name', dir: 1 }; // Details view
    // the tree: group by category or manufacturer, with folded groups remembered
    this.pickerGroup = readPref('electrocad.pickerGroup', 'category');
    try { this.pickerFolded = new Set(JSON.parse(readPref('electrocad.pickerFolded', '[]'))); } catch { this.pickerFolded = new Set(); }
    this.fpChoice = new Map(); // Part id -> the Footprint chosen in the picker's footprint row (ADR-0008)
    this.fpPart = null;        // the Part the footprint row is for (last clicked or dragged tile)
    this.fpHover = null;       // a tile under the pointer (previews its row)
    this.sheetId = null;  // the Sheet being edited
    this.labelRot = 0;    // rotation of the label tool's ghost
    this.nextName = { label: 'NET1', power: null }; // what the label tools offer next
    this.sheetsOpen = false;
  }

  get project() { return this.app.project; }
  /** The Sheet being edited (the first one if it went away, e.g. after undo or opening a project). */
  get sheet() {
    const sheets = this.project.schematic.sheets;
    return sheets.find((s) => s.id === this.sheetId) || sheets[0];
  }

  /** The current Sheet inside another copy of the Project (an edit's draft, a move preview). */
  _S(p) { const id = this.sheet.id; return p.schematic.sheets.find((s) => s.id === id) || p.schematic.sheets[0]; }

  /** Switch to another Sheet: the selection and any tool in progress are dropped. */
  switchSheet(id) {
    if (id === this.sheet.id) return;
    this.closeFieldEdit();
    if (this.placing) this.endPlace();
    this.wiring = null;
    this.selection.clear();
    this.sheetId = id;
    this.refresh();
  }

  // ---------------------------------------------------------------- panel and toolbar

  buildPicker() {
    this.grid = h('div', { class: 'shape-grid', role: 'list', 'aria-label': 'Parts' });
    const search = h('input', { class: 'input', type: 'search', placeholder: 'Search parts', 'aria-label': 'Search parts' });
    search.addEventListener('input', () => { this.query = search.value; this.renderTiles(); });
    search.addEventListener('keydown', (e) => e.stopPropagation());
    const catSel = h('select', { class: 'select', 'aria-label': 'Part category', title: 'Part category' },
      h('option', { value: 'All' }, 'All parts'), ...CATEGORIES.map((c) => h('option', { value: c }, c)));
    catSel.addEventListener('change', () => { this.category = catSel.value; this.renderTiles(); });
    this.grid.addEventListener('pointerleave', () => { if (this.fpHover) { this.fpHover = null; this.renderFootprintRow(); } });
    this.panel = h('div', { class: 'side-panel picker', 'aria-label': 'Part picker' },
      h('div', { class: 'side-filter picker-filter' }, catSel, this.viewBtn = button({ icon: VIEWS[this.pickerView].icon, title: `View: ${VIEWS[this.pickerView].label}`, cls: 'btn-ghost picker-view', onClick: (e) => this.viewMenu(e.currentTarget) })),
      h('div', { class: 'side-search' }, icon('search', 16), search),
      this.grid,
      this.fpRow = h('div', { class: 'fp-row', 'aria-label': 'Footprint for the next part' }),
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
      'sep',
      this._reapplyItem(),
    ], anchor);
  }

  /** Selected Symbols that have fields dragged by hand. */
  _pinnedSelection() { return this.sheet.symbols.filter((y) => this.selection.has(y.id) && hasPinnedFields(y)).map((y) => y.id); }

  _reapplyItem() {
    const ids = this._pinnedSelection();
    return { label: 'Re-apply style', icon: 'wand', disabled: !ids.length, onClick: () => this.reapplyStyle() };
  }

  /** Re-apply style: unpin the selected parts' fields so their Field style places them again (one undo step). */
  reapplyStyle() {
    const ids = this._pinnedSelection();
    if (!ids.length) return;
    this.app.edit('Re-apply field style', (p) => unpinFields(p, ids));
    this.refresh();
  }

  /** Right-click on the canvas (DabbleCAD's context menu): commands for what's under the cursor or selected. */
  contextMenu(e) {
    if (this.placing || this.tool !== 'select') { if (this.placing) this.endPlace(); else this.setTool('select'); return; }
    const v = this.ws.view;
    const world = v.view.toWorld(v.local(e));
    const tol = 4 / v.view.scale;
    const f = this.placement && hitField(this.project, this.placement, world, tol / 2, measureText);
    const hit = hitNoConnect(this.sheet, world, SCH_GRID / 2) || hitLabel(this.sheet, world, tol / 2, measureText) || hitSymbol(this.project, this.sheet, world, 3 / v.view.scale)
      || (f && this.sheet.symbols.find((y) => y.id === f.symbolId)) || hitWire(this.sheet, world, tol);
    if (hit && !this.selection.has(hit.id)) this.selection = new Set([hit.id]);
    else if (!hit) this.selection = new Set();
    this.refresh();
    const at = { x: e.clientX, y: e.clientY };
    if (!this.selection.size) {
      popupMenu([
        { label: 'Paste', icon: 'paste', shortcut: 'Ctrl+V', disabled: !this.clipboard, onClick: () => this.paste() },
        { label: 'Select all', icon: 'select', shortcut: 'Ctrl+A', onClick: () => this.selectAll() },
        'sep',
        { label: 'Fit the sheet in view', icon: 'fit', shortcut: 'Home', onClick: () => v.fitHome() },
      ], at);
      return;
    }
    const anySym = this.sheet.symbols.some((y) => this.selection.has(y.id));
    const anyLabel = (this.sheet.labels || []).some((l) => this.selection.has(l.id));
    popupMenu([
      { label: 'Copy', icon: 'copy', shortcut: 'Ctrl+C', onClick: () => this.copy() },
      { label: 'Paste', icon: 'paste', shortcut: 'Ctrl+V', disabled: !this.clipboard, onClick: () => this.paste() },
      { label: 'Duplicate', icon: 'duplicate', shortcut: 'Ctrl+D', onClick: () => this.duplicate() },
      { label: 'Delete', icon: 'trash', shortcut: 'Del', onClick: () => this.deleteSelection() },
      'sep',
      { label: 'Rotate', icon: 'rotate', shortcut: 'R', disabled: !anySym && !anyLabel, onClick: () => this.rotate() },
      { label: 'Mirror', icon: 'mirror', shortcut: 'X', disabled: !anySym, onClick: () => this.mirror() },
      anySym ? 'sep' : null,
      anySym ? this._reapplyItem() : null,
    ], at);
  }

  renderTiles() {
    if (!this.grid) return;
    const C = this.app.canvasColors('schematic');
    let list = searchParts(this.parts, this.query, this.category);
    this.grid.className = `shape-grid picker-grid view-${this.pickerView}`;
    const items = [];
    if (this.pickerView === 'details') {
      const { key, dir } = this.pickerSort;
      list = [...list].sort((a, b) => dir * String(DETAIL_COLS.find((c) => c.key === key).get(a)).localeCompare(String(DETAIL_COLS.find((c) => c.key === key).get(b)), undefined, { numeric: true }));
      items.push(h('div', { class: 'pd-head', role: 'row' }, h('span', {}), ...DETAIL_COLS.map((c) => {
        const b = h('button', { class: 'pd-col' + (key === c.key ? ' on' : ''), type: 'button', title: `${c.label}: click to sort` }, c.short || c.label, key === c.key ? (dir > 0 ? ' ▲' : ' ▼') : '');
        b.addEventListener('click', () => { this.pickerSort = { key: c.key, dir: key === c.key ? -dir : 1 }; this.renderTiles(); });
        return b;
      })));
    }
    if (GROUPS[this.pickerGroup] && this.pickerGroup !== 'none') {
      // an expandable tree, like Explorer's grouped views; searching opens every group
      for (const g of groupParts(list, this.pickerGroup)) {
        const id = `${this.pickerGroup}:${g.key}`;
        const open = !!this.query.trim() || !this.pickerFolded.has(id);
        const head = h('button', { class: 'pg-head' + (open ? ' open' : ''), type: 'button', 'aria-expanded': String(open), dataset: { group: g.key }, title: open ? 'Fold this group' : 'Unfold this group' },
          icon('chevronRight', 14), h('span', { class: 'pg-name' }, g.key), h('span', { class: 'pg-count' }, String(g.parts.length)));
        head.addEventListener('click', () => {
          if (this.pickerFolded.has(id)) this.pickerFolded.delete(id); else this.pickerFolded.add(id);
          writePref('electrocad.pickerFolded', JSON.stringify([...this.pickerFolded]));
          this.renderTiles();
        });
        items.push(head);
        if (open) items.push(...g.parts.map((part) => this._tile(part, C)));
      }
      this.grid.replaceChildren(...items);
    } else this.grid.replaceChildren(...items, ...list.map((part) => this._tile(part, C)));
    if (!list.length) this.grid.append(h('div', { class: 'side-empty' }, this.query ? 'No parts match.' : 'No parts in this category yet.'));
    this.renderFootprintRow();
  }

  /** Every generated Footprint (for "Other…" here and in the inspector), made once. */
  allFootprints() { return (this._allFp ||= allFootprints()); }

  _tile(part, C) {
    // drawn on the schematic's paper colour, so the tile looks like the part on the sheet
    const img = h('img', { alt: '', draggable: false, src: symbolThumbnail(part, C), style: { background: C.paper || C.background } });
    const tile = h('div', { class: 'shape-tile part-tile', role: 'listitem', tabindex: '0', dataset: { part: part.id }, 'aria-label': part.name,
      title: `${part.name}${part.units.length > 1 ? ` (${part.units.length} units)` : ''}: drag onto the sheet, or click then click to place (R rotates, X mirrors, Esc stops)` },
      img, h('span', { class: 'pt-name' }, part.name),
      part.units.length > 1 ? h('b', { class: 'unit-badge', title: `${part.units.length} units: ${part.units.map((u) => u.name).join(', ')}` }, `×${part.units.length}`) : null,
      ...(this.pickerView === 'details' ? DETAIL_COLS.slice(1).map((c) => h('span', { class: `pd-cell pd-${c.key}` }, String(c.get(part)))) : []));
    tile.classList.toggle('active', this.fpPart === part);
    tile.addEventListener('pointerdown', (e) => { this._setFpPart(part); this._tilePointerDown(e, part); });
    tile.addEventListener('pointerenter', () => { this.fpHover = part; this.renderFootprintRow(); });
    tile.addEventListener('focus', () => { this.fpHover = part; this.renderFootprintRow(); });
    tile.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.placeAtViewCenter(part); }
    });
    return tile;
  }

  /** The View menu: Icons, Small icons, List or Details, as in Explorer. */
  viewMenu(anchor) {
    popupMenu([
      ...Object.entries(VIEWS).map(([id, v]) => ({ label: v.label, icon: v.icon, checked: this.pickerView === id, onClick: () => this.setPickerView(id) })),
      'sep',
      ...Object.entries(GROUPS).map(([id, label]) => ({ label, checked: this.pickerGroup === id, onClick: () => this.setPickerGroup(id) })),
    ], anchor);
  }

  setPickerGroup(id) {
    if (!GROUPS[id]) return;
    this.pickerGroup = id;
    writePref('electrocad.pickerGroup', id);
    this.renderTiles();
  }

  setPickerView(id) {
    if (!VIEWS[id]) return;
    this.pickerView = id;
    writePref('electrocad.pickerView', id);
    if (this.viewBtn) { this.viewBtn.replaceChildren(icon(VIEWS[id].icon, 18)); this.viewBtn.title = `View: ${VIEWS[id].label}`; }
    this.renderTiles();
  }

  // ---------------------------------------------------------------- footprint row (#12, ADR-0008)

  _setFpPart(part) {
    this.fpPart = part;
    for (const t of this.grid?.querySelectorAll('.part-tile') || []) t.classList.toggle('active', t.dataset.part === part.id);
    this.renderFootprintRow();
  }

  /** The Footprint the next dropped Component of `part` gets: the one chosen in the row, else the Part's default. */
  footprintFor(part) { return this.fpChoice.get(part.id) || null; }

  /**
   * The footprint row under the tiles: for the hovered tile (or the last one clicked or dragged),
   * its Preferred footprints as chips, smallest first, with a pad preview on hover, then
   * "Other…" for any Footprint (identity Pin map). The chosen one goes on the next dropped
   * Component and is remembered per Part.
   */
  renderFootprintRow() {
    const row = this.fpRow;
    if (!row) return;
    this._fpPreview(null); // the chip it belonged to is about to be replaced
    const part = this.fpHover || this.fpPart;
    if (!part) { row.replaceChildren(h('div', { class: 'fp-row-note' }, 'Footprint: pick a part to choose its footprint.')); return; }
    const choice = this.fpChoice.get(part.id);
    const ids = Object.keys(part.footprints || {});
    const current = choice ? (choice.fpId || `other:${choice.footprint.name}`) : ids[0];
    const chips = ids.sort((a, b) => fpOrder(a) - fpOrder(b) || a.localeCompare(b)).map((fpId) => {
      const fp = part.footprints[fpId];
      const b = h('button', { class: 'fp-chip' + (current === fpId ? ' on' : ''), type: 'button', title: fp.name, dataset: { fp: fpId } }, shortFpLabel(fpId, fp));
      b.addEventListener('click', () => this._chooseFootprint(part, ids[0] === fpId && !choice ? null : { fpId }));
      b.addEventListener('pointerenter', () => this._fpPreview(b, fp));
      b.addEventListener('pointerleave', () => this._fpPreview(null));
      return b;
    });
    const other = choice && !choice.fpId ? choice.footprint : null;
    const otherBtn = h('button', { class: 'fp-chip fp-other' + (other ? ' on' : ''), type: 'button', title: other ? `${other.name} (any Footprint: Pin n to Pad n)` : 'Any other Footprint (Pin n goes to Pad n)' }, other ? shortFpLabel('', other) : 'Other…');
    otherBtn.addEventListener('click', () => this._otherFootprint(part, otherBtn));
    if (other) { otherBtn.addEventListener('pointerenter', () => this._fpPreview(otherBtn, other)); otherBtn.addEventListener('pointerleave', () => this._fpPreview(null)); }
    row.replaceChildren(
      h('div', { class: 'fp-row-head' }, h('span', {}, 'Footprint'), h('b', { title: part.name }, part.name)),
      h('div', { class: 'fp-chips' }, ...chips, otherBtn));
  }

  _chooseFootprint(part, choice) {
    if (choice) this.fpChoice.set(part.id, choice); else this.fpChoice.delete(part.id);
    this.fpPart = part;
    this.renderFootprintRow();
  }

  /** A small pad drawing next to a footprint chip. */
  _fpPreview(anchor, fp) {
    this.fpPop?.remove(); this.fpPop = null;
    if (!anchor) return;
    const C = this.app.canvasColors('board');
    const c = h('canvas', { width: 280, height: 180 });
    drawFootprintPreview(c, fp, C);
    const r = anchor.getBoundingClientRect();
    this.fpPop = h('div', { class: 'fp-preview' }, c, h('div', { class: 'fp-preview-name' }, fp.name), h('div', { class: 'fp-preview-meta' }, `${fp.pads.length} pad${fp.pads.length === 1 ? '' : 's'}${fp.pads.some((p) => p.drill) ? ' · through-hole' : ' · SMD'}`));
    document.body.append(this.fpPop);
    const w = this.fpPop.offsetWidth;
    Object.assign(this.fpPop.style, { left: `${Math.max(8, r.left - w - 10)}px`, top: `${Math.max(8, r.top - 60)}px` });
  }

  /** "Other…": search every generated Footprint; the choice uses Pin n -> Pad n. */
  _otherFootprint(part, anchor) {
    document.querySelectorAll('.fp-search-pop').forEach((x) => x.remove());
    const input = h('input', { class: 'input', type: 'search', placeholder: 'Search footprints, e.g. SOIC-8 or 2x05', 'aria-label': 'Search footprints', spellcheck: false });
    const list = h('div', { class: 'fp-search-list', role: 'listbox' });
    const pop = h('div', { class: 'fp-search-pop menu' }, input, list);
    const close = () => { pop.remove(); this._fpPreview(null); document.removeEventListener('pointerdown', outside, true); };
    const outside = (e) => { if (!pop.contains(e.target)) close(); };
    const render = () => {
      const words = input.value.toLowerCase().split(/\s+/).filter(Boolean);
      const found = this.allFootprints().filter((f) => words.every((w) => f.name.toLowerCase().includes(w))).slice(0, 80);
      list.replaceChildren(...found.map((f) => {
        const b = h('button', { class: 'menu-item', type: 'button', role: 'option' }, h('span', { class: 'menu-label' }, f.name));
        b.addEventListener('click', () => { this._chooseFootprint(part, { library: 'builtin', footprint: f }); close(); });
        b.addEventListener('pointerenter', () => this._fpPreview(pop, f));
        return b;
      }), found.length ? '' : h('div', { class: 'side-empty' }, 'No footprints match.'));
    };
    input.addEventListener('input', render);
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') close(); if (e.key === 'Enter') list.querySelector('.menu-item')?.click(); });
    document.body.append(pop);
    const r = anchor.getBoundingClientRect();
    Object.assign(pop.style, { left: `${Math.max(8, Math.min(r.left, window.innerWidth - 340))}px`, top: `${Math.max(8, r.top - 330)}px` });
    render();
    input.focus();
    setTimeout(() => document.addEventListener('pointerdown', outside, true));
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
    // the cards over the canvas: Sheets, Netlist and ERC; icons only, lit while open
    this.sheetsBtn = button({ icon: 'sheets', title: 'Sheets: add, rename, reorder and delete', onClick: () => this.toggleSheets() });
    this.netlistBtn = button({ icon: 'netlist', title: 'Netlist', onClick: () => this.toggleNetlist() });
    this.ercBtn = button({ icon: 'erc', title: 'Electrical rule check (ERC)', onClick: () => this.toggleErc() });
    const erc = this.ercBtn;
    return [this.btn.undo, this.btn.redo, h('span', { class: 'sep' }),
      this.btn.copy, this.btn.paste, this.btn.dup, this.btn.del, h('span', { class: 'sep' }),
      this.btn.rotate, this.btn.mirror, h('span', { class: 'sep' }), this.btn.fields, h('span', { class: 'sep' }),
      this.sheetsBtn, this.netlistBtn, erc];
  }

  /** The left tool palette: Select and Wire are live; the rest name their tickets. */
  tools(toolButton) {
    this.toolBtn = {
      select: button({ icon: 'select', title: 'Select (V)', onClick: () => this.setTool('select') }),
      wire: button({ icon: 'wire', title: 'Wire (W)', onClick: () => this.setTool('wire') }),
      netLabel: button({ icon: 'netLabel', title: 'Net label (L): joins Pins with the same name on this sheet', onClick: () => this.setTool('netLabel') }),
      globalLabel: button({ icon: 'globalLabel', title: 'Global label (Ctrl+L): joins Pins with the same name on every sheet', onClick: () => this.setTool('globalLabel') }),
      power: button({ icon: 'power', title: 'Power symbol (P): +5V, +3V3, VCC… joins on every sheet', onClick: () => this.setTool('power') }),
      ground: button({ icon: 'ground', title: 'Ground (G)', onClick: () => this.setTool('ground') }),
      noConnect: button({ icon: 'noConnect', title: 'No-connect (Q): mark a Pin that is left open on purpose; click again to remove', onClick: () => this.setTool('noConnect') }),
    };
    return [this.toolBtn.select, this.toolBtn.wire,
      this.toolBtn.netLabel, this.toolBtn.globalLabel, this.toolBtn.power, this.toolBtn.ground,
      this.toolBtn.noConnect, null,
      toolButton('ltext', 'Text', { ticket: 8 }), toolButton('ruler', 'Measure', { ticket: 8 })];
  }

  setTool(tool) {
    if (this.placing) this.endPlace();
    this.wiring = null;
    this.closeFieldEdit();
    this.tool = tool;
    this.labelRot = 0;
    if (tool !== 'select') this.selection.clear();
    if (this.ws) this.ws.view.canvas.style.cursor = tool === 'select' ? '' : 'crosshair';
    this.refresh();
  }

  /** Enable/disable buttons and refresh the hint after any change. */
  refresh() {
    // drop selected ids that no longer exist (after undo, delete, project switch)
    const ids = new Set(this._allIds());
    for (const id of [...this.selection]) if (!ids.has(id)) this.selection.delete(id);
    if (this.btn) {
      this.btn.undo.disabled = !this.app.history.canUndo;
      this.btn.redo.disabled = !this.app.history.canRedo;
      for (const k of ['del', 'rotate', 'mirror']) this.btn[k].disabled = this.selection.size === 0 && !this.placing;
      this.btn.del.disabled = this.selection.size === 0;
      const anySym = this.sheet.symbols.some((y) => this.selection.has(y.id));
      const anyLabel = (this.sheet.labels || []).some((l) => this.selection.has(l.id));
      if (!this.placing) { this.btn.rotate.disabled = !anySym && !anyLabel && !LABEL_TOOLS[this.tool]; this.btn.mirror.disabled = !anySym; }
      this.btn.fields.disabled = !anySym;
      this.btn.copy.disabled = this.selection.size === 0;
      this.btn.dup.disabled = this.selection.size === 0;
      this.btn.paste.disabled = !this.clipboard;
    }
    if (this.toolBtn) for (const [t, b] of Object.entries(this.toolBtn)) b.classList.toggle('active', this.tool === t && !this.placing);
    this.renderNetlist();
    this.renderSheets();
    this.renderErc();
    this.renderUnitStrip();
    this.renderStyleFoot();
    this.ws?.renderBar();
    this.inspector?.render();
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
    else if (this.tool === 'noConnect') text = 'No-connect: click a Pin tip to mark it as left open on purpose (ERC then ignores it) · click a marker to remove it · Esc back to Select';
    else if (LABEL_TOOLS[this.tool]) {
      const t = LABEL_TOOLS[this.tool];
      text = this.tool === 'ground'
        ? 'Ground: click a Pin or Wire to add GND · R rotate · Esc back to Select'
        : this.tool === 'power'
        ? `Power: click a Pin or Wire to add ${this._powerName()} · double-click a power symbol's name to pick another net · R rotate · Esc back to Select`
        : `${t.what}: click a Pin, a Wire or a grid point, then type the net name and press Enter · R rotate · Esc back to Select`;
    }
    else if (this.placing) text = `Placing ${this.placing.part.units.length > 1 ? `${this._placingName(this.placing)} (${this.placing.part.name})` : this.placing.part.name}: ${this.placing.drag ? 'release on the sheet to place' : 'click to place, keep clicking for more'} · R rotate · X mirror · Esc ${this.placing.drag ? 'cancel' : 'stop'}`;
    else if (this.selection.size) {
      const refs = this.sheet.symbols.filter((y) => this.selection.has(y.id)).map((y) => { const c = this.project.components[y.componentId]; return c ? c.ref + unitLetter(partOf(this.project, c), y.unit) : ''; });
      const nw = this.sheet.wires.filter((w) => this.selection.has(w.id)).length;
      const labels = (this.sheet.labels || []).filter((l) => this.selection.has(l.id)).map((l) => l.net);
      const nnc = (this.sheet.noConnects || []).filter((n) => this.selection.has(n.id)).length;
      if (nnc) labels.push(`${nnc} no-connect${nnc === 1 ? '' : 's'}`);
      const what = [...refs, ...labels, ...(nw ? [`${nw} wire${nw === 1 ? '' : 's'}`] : [])].join(', ');
      text = `Selected ${what} · drag or arrow keys to move${refs.length || labels.length ? ' · R rotate' : ''}${refs.length ? ' · X mirror' : ''}${labels.length === 1 && !refs.length ? ' · double-click to rename' : ''} · Ctrl+C/V/D · Del delete · Esc deselect`;
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
      if (LABEL_TOOLS[this.tool]) { e.preventDefault(); this._labelClick(snapPt(world, SCH_GRID)); return; } // keep focus in the name box
      if (this.tool === 'noConnect') {
        const at = snapPt(world, SCH_GRID);
        const there = (this.sheet.noConnects || []).some((n) => n.at[0] === at[0] && n.at[1] === at[1]);
        this.app.edit(there ? 'Remove no-connect' : 'Mark no-connect', (p) => toggleNoConnect(p, this._S(p), at));
        this.refresh();
        return;
      }
      const tol = 4 / ws.view.view.scale;
      const fieldHit = this.placement && hitField(this.project, this.placement, world, tol / 2, measureText);
      // pressing on a field and dragging moves that field by hand (it becomes pinned, #53)
      if (fieldHit && !e.shiftKey && !hitSymbol(this.project, this.sheet, world, 0)) {
        this.selection = new Set([fieldHit.symbolId]);
        const b = fieldHit.item.box;
        const centre = fieldHit.item.pinned ? [fieldHit.item.x, fieldHit.item.y] : [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
        this.fieldDrag = { symbolId: fieldHit.symbolId, key: fieldHit.key, grab: [centre[0] - world[0], centre[1] - world[1]], startPx: [e.clientX, e.clientY], snapshot: structuredClone(this.project), moved: false, at: null };
        c.setPointerCapture(e.pointerId);
        this.refresh();
        return;
      }
      const hit = hitNoConnect(this.sheet, world, SCH_GRID / 2) || hitLabel(this.sheet, world, tol / 2, measureText) || hitSymbol(this.project, this.sheet, world, 3 / ws.view.view.scale)
        || (fieldHit && this.sheet.symbols.find((y) => y.id === fieldHit.symbolId)) || hitWire(this.sheet, world, tol);
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
    // double-click a Reference designator or Value to edit it in place
    c.addEventListener('dblclick', (e) => {
      if (this.tool !== 'select' || this.placing) return;
      const world = ws.view.view.toWorld(ws.view.local(e));
      const f = this.placement && hitField(this.project, this.placement, world, 3 / ws.view.view.scale, measureText);
      const l = hitLabel(this.sheet, world, 3 / ws.view.view.scale, measureText);
      if (l && l.style !== 'gnd') { e.preventDefault(); this.editLabel({ label: l }); return; }
      if (f && (f.key === 'reference' || f.key === 'value')) { e.preventDefault(); this.editField(f.symbolId, f.key); }
    });
    c.addEventListener('pointerup', (e) => {
      if (e.button !== 0) return;
      if (this.fieldDrag) {
        const d = this.fieldDrag;
        this.fieldDrag = null; this.preview = null;
        if (d.moved && d.at) {
          const comp = this.project.components[this.sheet.symbols.find((y) => y.id === d.symbolId)?.componentId];
          const what = d.key === 'reference' ? 'reference' : d.key;
          this.app.edit(`Move ${comp?.ref || ''} ${what}`, (p) => pinField(p, d.symbolId, d.key, d.at));
        }
        ws.view.canvas.style.cursor = '';
        this.refresh();
        return;
      }
      if (this.drag) {
        const d = this.drag;
        this.drag = null; this.preview = null;
        if (d.moved && (d.delta[0] || d.delta[1])) {
          const ids = d.ids, delta = d.delta;
          // on release the wires are tidied too (joined runs, no hidden segments), in the same undo step
          this.app.edit('Move', (p) => { moveSelection(p, this._S(p), ids, delta); cleanupWires(p, this._S(p)); });
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
      if (this.tool !== 'select') ws.view.invalidate();
      if (this.fieldDrag && (e.buttons & 1)) {
        const d = this.fieldDrag;
        if (!d.moved && Math.hypot(e.clientX - d.startPx[0], e.clientY - d.startPx[1]) < DRAG_START_PX) return;
        d.moved = true;
        const pv = structuredClone(d.snapshot);
        d.at = pinField(pv, d.symbolId, d.key, [world[0] + d.grab[0], world[1] + d.grab[1]]);
        this.preview = pv;
        ws.view.canvas.style.cursor = 'move';
        ws.view.invalidate();
      } else if (this.drag && (e.buttons & 1)) {
        const d = this.drag;
        if (!d.moved && Math.hypot(e.clientX - d.startPx[0], e.clientY - d.startPx[1]) < 4) return;
        d.moved = true;
        const delta = [this.cursor[0] - d.start[0], this.cursor[1] - d.start[1]];
        if (delta[0] !== d.delta[0] || delta[1] !== d.delta[1]) {
          d.delta = delta;
          const pv = structuredClone(d.snapshot);
          moveSelection(pv, this._S(pv), d.ids, delta);
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
      if (!this.drag && !this.fieldDrag && ws.view.canvas.style.cursor === 'move') ws.view.canvas.style.cursor = '';
    });
    // the floating Netlist panel lives over the canvas, like DabbleCAD's inspector card
    // floating cards over the canvas, top right: the inspector, then the Netlist
    this.inspector = new SchematicInspector(this);
    this.netlistEl = h('div', { class: 'float-panel netlist-panel', role: 'region', 'aria-label': 'Netlist' });
    this.sheetsEl = h('div', { class: 'float-panel sheets-panel', role: 'region', 'aria-label': 'Sheets' });
    // Cards dock in a column at the top right; each one moves by its header and resizes from its
    // corner on its own (like DabbleCAD's inspector), and docks again on a header double-click.
    this.ercEl = h('div', { class: 'float-panel erc-panel', role: 'region', 'aria-label': 'Electrical rule check' });
    const order = [this.inspector.el, this.sheetsEl, this.ercEl, this.netlistEl];
    this.stack = h('div', { class: 'float-stack' });
    const layer = h('div', { class: 'card-layer' }, this.stack);
    ws.view.el.append(layer);
    this.unitStrip = h('div', { class: 'unit-strip', role: 'toolbar', 'aria-label': 'Unit to place', hidden: true });
    ws.view.el.append(this.unitStrip);
    const dock = { el: this.stack, put: (card) => this.stack.append(...order.filter((c) => c === card || c.parentElement === this.stack)) };
    for (const c of order) this.stack.append(c);
    this.cards = {};
    for (const [k, c] of [['inspector', this.inspector.el], ['sheets', this.sheetsEl], ['erc', this.ercEl], ['netlist', this.netlistEl]]) {
      this.cards[k] = makeDraggable(c, { key: `schematic-${k}`, layer, dock });
      c.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
    }
    this.renderNetlist();
    this.renderSheets();
    this.renderErc();
    ws.view.onContextMenu = (e) => this.contextMenu(e);
    c.addEventListener('pointerleave', () => { if (this.placing && !this.placing.drag) { this.placing.at = null; ws.view.invalidate(); } });
  }

  draw(ctx, view, C) {
    const ghost = this.placing && this.placing.at ? { part: this.placing.part, unit: this.placing.unit || 0, ref: this._placingName(this.placing), at: this.placing.at, rot: this.placing.rot, mirror: this.placing.mirror } : null;
    let wiring = null, target = null;
    if (this.tool === 'wire' && this.cursor) {
      target = this._endTarget(this.cursor) ? this.cursor : null;
      if (this.wiring) wiring = [...this.wiring.points, ...this._route(this.wiring.points[this.wiring.points.length - 1], this.cursor)];
    }
    const t = LABEL_TOOLS[this.tool];
    const ghostLabel = t && this.cursor && !this.labelEdit
      ? { id: 'ghost', at: this.cursor, rot: this.labelRot, style: t.style, scope: t.scope, net: this.tool === 'ground' ? 'GND' : this.tool === 'power' ? this._powerName() : this.nextName.label }
      : null;
    const proj = this.preview || this.project;
    const sheet = this._S(proj);
    this.placement = placeFields(proj, sheet, { measure: measureText });
    drawSheet(ctx, view, C, proj, sheet, { selection: this.selection, ghost, bounds: (s) => symbolBounds(proj, s), wiring, target, placement: this.placement, display: this.app.schematicDisplay(), ghostLabel,
      erc: this.ercOpen ? (this.ercShown || []).filter((x) => x.sheetId === sheet.id && x.severity !== 'info') : null, ercFocus: this.ercFocus });
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
    // which Unit goes down: the next unplaced Unit of a Component of this Part, else a new one (#10)
    this.placing = { part, rot: 0, mirror: false, drag, at: null, ...unitSuggestion(this.project, part) };
    this.selection.clear();
    this.ws.view.canvas.style.cursor = 'crosshair';
    this.refresh();
  }

  endPlace() {
    if (!this.placing) return;
    this.placing = null;
    this.renderUnitStrip();
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
    const res = this.app.edit(`Place ${this._placingName(pl)}`, (p) => placeSymbol(p, this._S(p), pl.part, pl.at,
      { rot: pl.rot, mirror: pl.mirror, unit: pl.unit, component: pl.componentId ? p.components[pl.componentId] : undefined, footprint: this.footprintFor(pl.part) || undefined }));
    if (pl.drag) { this.placing = null; this.ws.view.canvas.style.cursor = ''; }
    else if (pl.part.units.length > 1) {
      // keep going with the same Component's next Unit; once all are down, start a new Component
      const next = nextUnplacedUnit(this.project, res.comp.id, pl.unit);
      Object.assign(pl, next >= 0 ? { componentId: res.comp.id, unit: next } : { componentId: null, unit: 0 });
    }
    this.selection = new Set([res.sym.id]);
    this.refresh();
    return res;
  }

  /** Enter or Space on a tile: drop the Part in the middle of the view. */
  placeAtViewCenter(part) {
    const v = this.ws.view;
    const at = snapPt(v.view.toWorld([v.w / 2, v.h / 2]), SCH_GRID);
    const { componentId, unit } = unitSuggestion(this.project, part);
    const res = this.app.edit(`Place ${part.name}`, (p) => placeSymbol(p, this._S(p), part, at, { unit, component: componentId ? p.components[componentId] : undefined, footprint: this.footprintFor(part) || undefined }));
    this.selection = new Set([res.sym.id]);
    this.refresh();
    return res;
  }

  /** "U1B", or "U2A" for a new Component (the next free Reference designator): what the next click places. */
  _placingName(pl) {
    const comp = pl.componentId && this.project.components[pl.componentId];
    if (!comp && pl.part.units.length < 2) return pl.part.prefix + '?';
    return `${comp ? comp.ref : nextRef(this.project, pl.part.prefix)}${unitLetter(pl.part, pl.unit)}`;
  }

  /**
   * While placing a multi-Unit Part: a strip at the top of the canvas with the Component's Units
   * (placed ones greyed out, the next one lit) and a button for a new Component. Click to choose.
   */
  renderUnitStrip() {
    const el = this.unitStrip;
    if (!el) return;
    const pl = this.placing;
    if (!pl || pl.part.units.length < 2) { el.replaceChildren(); el.hidden = true; return; }
    el.hidden = false;
    const comp = pl.componentId && this.project.components[pl.componentId];
    const placed = comp ? placedUnits(this.project, comp.id) : new Set();
    const choose = (componentId, unit) => { Object.assign(pl, { componentId, unit }); this.refresh(); };
    const newRef = nextRef(this.project, pl.part.prefix);
    el.replaceChildren(
      h('span', { class: 'us-ref' }, comp ? comp.ref : newRef),
      ...pl.part.units.map((u, i) => h('button', {
        class: 'us-unit' + (i === pl.unit ? ' on' : ''), type: 'button', disabled: placed.has(i),
        title: placed.has(i) ? `${comp.ref}${unitLetter(pl.part, i)} is already placed` : `Place ${comp ? comp.ref : newRef}${unitLetter(pl.part, i)}${u.pins.some((x) => x.type === 'power_in') && u.pins.every((x) => x.type === 'power_in') ? ' (power)' : ''}`,
        onClick: () => choose(pl.componentId, i),
      }, unitLetter(pl.part, i))),
      h('span', { class: 'us-sep' }),
      h('button', { class: 'us-new' + (!comp ? ' on' : ''), type: 'button', title: `Start a new ${pl.part.name}`, onClick: () => choose(null, 0) }, `New ${newRef}`));
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
    this.app.edit('Draw wire', (p) => { addWire(p, this._S(p), pts); cleanupWires(p, this._S(p)); });
    this.refresh();
  }

  // ---------------------------------------------------------------- ERC panel (#11)

  toggleErc(open = !this.ercOpen) {
    this.ercOpen = open;
    this.ercFocus = null;
    this.ercBtn?.classList.toggle('active', open);
    this.renderErc();
    this.ws?.view.invalidate();
  }

  /**
   * The ERC card: live while open (rerun after every change), errors first, click to go there.
   * A filter bar shows or hides Errors, Warnings and Info (with counts) and searches the parts and
   * nets each problem involves. The header and filter bar are built once so typing in the search
   * box isn't interrupted by the live updates; only the counts and the list are redrawn.
   */
  renderErc() {
    const el = this.ercEl;
    if (!el) return;
    el.style.display = this.ercOpen ? '' : 'none';
    if (!this.ercOpen) { this.ercList = null; this.ercShown = null; return; }
    if (!this.ercUi) this._buildErcCard();
    const ui = this.ercUi, f = this.ercFilter;
    const list = runErc(this.project, { measure: measureText });
    this.ercList = list;
    const count = (sev) => list.filter((v) => v.severity === sev).length;
    const errors = count('error'), warnings = count('warning');
    ui.count.textContent = errors || warnings ? [errors ? `${errors} error${errors === 1 ? '' : 's'}` : null, warnings ? `${warnings} warning${warnings === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ') : 'No problems';
    for (const sev of ['error', 'warning', 'info']) {
      const b = ui.chips[sev];
      b.classList.toggle('on', f[sev]);
      b.setAttribute('aria-pressed', String(f[sev]));
      b.querySelector('.erc-n').textContent = String(count(sev));
    }
    const shown = filterViolations(list, { severities: ['error', 'warning', 'info'].filter((x) => f[x]), query: f.query });
    this.ercShown = shown;
    const sheetName = (id) => this.project.schematic.sheets.find((x) => x.id === id)?.name;
    const many = this.project.schematic.sheets.length > 1;
    const row = (v) => h('div', { class: `erc-row erc-${v.severity}` + (v.id === this.ercFocus ? ' on' : ''), role: 'button', tabindex: '0', dataset: { rule: v.rule }, title: 'Show it on the sheet',
      onClick: () => this.gotoViolation(v), onKeydown: (e) => { if (e.key === 'Enter') this.gotoViolation(v); } },
      h('span', { class: 'erc-dot', 'aria-label': v.severity }),
      h('span', { class: 'erc-msg' }, v.message, many ? h('span', { class: 'erc-sheet' }, ` · ${sheetName(v.sheetId)}`) : null),
      v.fix ? button({ label: v.fix.label, cls: 'btn-outline btn-xs erc-fix', onClick: (e) => { e.stopPropagation(); this.app.edit(v.fix.label, (p) => v.fix.apply(p)); this.refresh(); } }) : null);
    const empty = !list.length ? 'Every pin is connected or marked no-connect, and no rule is broken.'
      : !shown.length ? (f.query ? `Nothing for "${f.query}" with these filters.` : 'Everything is filtered out.') : null;
    ui.body.replaceChildren(empty ? h('p', { class: 'side-note erc-clean' }, empty) : '', ...shown.map(row));
  }

  _buildErcCard() {
    const f = this.ercFilter;
    const chip = (sev, label) => {
      const b = h('button', { class: `erc-chip erc-chip-${sev}`, type: 'button', title: `Show ${label.toLowerCase()}`, dataset: { severity: sev } },
        h('span', { class: 'erc-dot' }), label, h('span', { class: 'erc-n' }, '0'));
      b.addEventListener('click', () => { f[sev] = !f[sev]; this.renderErc(); this.ws?.view.invalidate(); });
      return b;
    };
    const chips = { error: chip('error', 'Errors'), warning: chip('warning', 'Warnings'), info: chip('info', 'Info') };
    const search = h('input', { class: 'input erc-search', type: 'search', placeholder: 'Part or net, e.g. U1 or VCC', 'aria-label': 'Filter by part or net', spellcheck: false });
    search.addEventListener('input', () => { f.query = search.value; this.renderErc(); this.ws?.view.invalidate(); });
    search.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') { search.value = ''; f.query = ''; this.renderErc(); this.ws?.view.invalidate(); } });
    const count = h('span', { class: 'fp-count' });
    const body = h('div', { class: 'fp-body' });
    this.ercEl.replaceChildren(
      h('div', { class: 'fp-head' }, h('b', {}, 'ERC'), count, button({ icon: 'close', title: 'Close', cls: 'btn-ghost', onClick: () => this.toggleErc(false) })),
      h('div', { class: 'erc-filter' }, h('div', { class: 'erc-chips', role: 'group', 'aria-label': 'Show' }, chips.error, chips.warning, chips.info),
        h('div', { class: 'side-search erc-search-row' }, icon('search', 15), search)),
      body);
    this.ercUi = { count, chips, search, body };
  }

  /** Switch to a violation's Sheet, zoom to it and ring it. */
  gotoViolation(v) {
    this.ercFocus = v.id;
    if (v.sheetId !== this.sheet.id) this.switchSheet(v.sheetId);
    const r = SCH_GRID * 18, view = this.ws.view;
    view.view.fit({ x0: v.at[0] - r, y0: v.at[1] - r * 0.7, x1: v.at[0] + r, y1: v.at[1] + r * 0.7 }, view.w, view.h, 20);
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

  /** Every selectable item on the current Sheet. */
  _allIds() { return [...this.sheet.symbols.map((y) => y.id), ...this.sheet.wires.map((w) => w.id), ...(this.sheet.labels || []).map((l) => l.id), ...(this.sheet.noConnects || []).map((n) => n.id)]; }

  rotate() {
    if (this.placing) { this.placing.rot = (this.placing.rot + 90) % 360; this.ws.view.invalidate(); return; }
    if (LABEL_TOOLS[this.tool]) { this.labelRot = (this.labelRot + 90) % 360; this.ws.view.invalidate(); return; }
    const ids = [...this._selectedSymbolIds(), ...(this.sheet.labels || []).filter((l) => this.selection.has(l.id)).map((l) => l.id)];
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

  /**
   * Edit a Reference designator or Value in a box over the canvas text. Enter or clicking away
   * saves (one undo step), Esc cancels; a Reference that is taken, empty or has spaces is refused
   * and editing continues. Values are edited as typed, whatever the Field style shows.
   */
  editField(symbolId, key) {
    this.closeFieldEdit();
    const sym = this.sheet.symbols.find((y) => y.id === symbolId);
    if (!sym) return;
    const comp = this.project.components[sym.componentId];
    const item = this.placement?.get(symbolId)?.items.find((i) => i.keys.includes(key));
    if (!item) return;
    this.selection = new Set([symbolId]);
    this.refresh();
    const v = this.ws.view.view;
    const [x0, y0] = v.toScreen([item.box.x0, item.box.y0]), [x1, y1] = v.toScreen([item.box.x1, item.box.y1]);
    const style = styleFor(this.project, comp);
    const px = Math.max(11, style.text.size * v.scale);
    const original = key === 'reference' ? comp.ref : comp.value;
    const input = h('input', { class: 'field-edit', type: 'text', value: original, spellcheck: false, 'aria-label': key === 'reference' ? 'Edit reference' : 'Edit value', dataset: { key } });
    const w = Math.max(70, x1 - x0 + 30);
    Object.assign(input.style, { left: `${(x0 + x1) / 2 - w / 2}px`, top: `${(y0 + y1) / 2 - px * 0.85}px`, width: `${w}px`, height: `${px * 1.7}px`, fontSize: `${px}px` });
    const tip = h('div', { class: 'field-edit-tip' });
    Object.assign(tip.style, { left: input.style.left, top: `${(y0 + y1) / 2 + px * 0.95}px` });
    let done = false;
    const close = () => { done = true; input.remove(); tip.remove(); this.fieldEdit = null; this.ws.view.canvas.focus({ preventScroll: true }); };
    const commit = () => {
      if (done) return true;
      const text = input.value;
      if (text === original) { close(); return true; }
      if (key === 'reference') {
        const bad = validateRef(this.project, comp.id, text);
        if (bad) { input.classList.add('bad'); tip.textContent = bad; input.focus(); return false; }
        this.app.edit(`Rename ${comp.ref} to ${text.trim()}`, (p) => updateComponent(p, comp.id, { ref: text }));
      } else {
        this.app.edit(`${comp.ref} value`, (p) => updateComponent(p, comp.id, { value: text }));
      }
      close();
      return true;
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
    input.addEventListener('input', () => { input.classList.remove('bad'); tip.textContent = ''; });
    // clicking away saves; a reference that can't be used is dropped with a short message
    input.addEventListener('blur', () => {
      if (done) return;
      if (!commit()) { const msg = tip.textContent; close(); toast(`${msg} ${comp.ref} kept its old name.`, 'warn', 4000); }
    });
    this.ws.view.el.append(input, tip);
    input.focus();
    input.select();
    this.fieldEdit = { input, commit, close };
  }

  closeFieldEdit() { if (this.fieldEdit) this.fieldEdit.close(); if (this.labelEdit) this.labelEdit.close(); }

  // ---------------------------------------------------------------- labels (#7)

  /** A click with a label tool: Ground goes down at once; the others ask for the net name there. */
  _labelClick(at) {
    if (this.labelEdit) { this.labelEdit.commit(); return; }
    const t = LABEL_TOOLS[this.tool];
    const spec = { at, rot: this.labelRot, style: t.style, scope: t.scope };
    // Ground and Power symbols go down at once: GND, or the last power net used (double-click to change it)
    if (this.tool === 'ground' || this.tool === 'power') {
      const net = this.tool === 'ground' ? 'GND' : this._powerName();
      const l = this.app.edit(`Place ${net}`, (p) => addLabel(p, this._S(p), { ...spec, net }));
      this.selection = new Set([l.id]);
      this.refresh();
      return;
    }
    this.editLabel({ spec: { ...spec, net: this.nextName.label } });
  }

  /** The power net the Power tool places: the last one used or chosen, else the Project's latest, else +5V. */
  _powerName() {
    if (this.nextName.power) return this.nextName.power;
    const all = this.project.schematic.sheets.flatMap((s) => (s.labels || []).filter((l) => l.style === 'power'));
    return all.length ? all[all.length - 1].net : '+5V';
  }

  /**
   * Type a label's name in a box over the canvas: for a new label (`spec`, placed on Enter) or to
   * rename one (`label`). Enter saves (one undo step), Esc cancels, a name that can't be used is
   * refused and editing continues. Offers the net names already in the Project.
   */
  editLabel({ label = null, spec = null }) {
    this.closeFieldEdit();
    const l = label || { id: 'new', ...spec };
    const original = l.net || '';
    const v = this.ws.view.view;
    const sh = labelShape(l, measureText);
    const f = labelFrame(l);
    const t = f.apply(sh.text.at);
    const [cx, cy] = v.toScreen([l.at[0] + t[0], l.at[1] + t[1]]);
    const px = Math.max(12, mm127 * v.scale);
    // our own drop-down, not a <datalist>: a datalist hides every choice that doesn't match the
    // text already in the box, so a power symbol showing +5V would offer only +5V
    const names = netNameChoices(this.project, l);
    const list = h('div', { class: 'net-pick', role: 'listbox', 'aria-label': 'Nets' });
    const input = h('input', { class: 'field-edit label-edit', type: 'text', value: original, spellcheck: false, autocomplete: 'off', role: 'combobox', 'aria-label': label ? 'Rename net' : 'Net name' });
    const w = Math.max(110, measureText(original || 'NET', mm127) * v.scale + 40);
    const leftAligned = !(f.flip && !isPower(l)) && sh.text.align === 'left';
    Object.assign(input.style, { left: `${leftAligned ? cx - 6 : cx - w / 2}px`, top: `${cy - px * 0.85}px`, width: `${w}px`, height: `${px * 1.7}px`, fontSize: `${px}px` });
    const tip = h('div', { class: 'field-edit-tip' });
    Object.assign(tip.style, { left: input.style.left, top: `${cy - px * 0.85 - 24}px` }); // above the box; the list goes below
    if (!label) { tip.textContent = 'Enter to place · Esc to cancel'; tip.classList.add('note'); }
    Object.assign(list.style, { left: input.style.left, top: `${cy + px * 0.95}px`, minWidth: `${w}px` });
    let shown = [], hi = -1;
    const pick = (name) => { input.value = name; commit(); };
    const renderList = () => {
      shown = filterNetNames(names, input.value, original);
      hi = Math.min(hi, shown.length - 1);
      list.replaceChildren(...shown.map((n, i) => {
        const opt = h('div', { class: 'net-opt' + (i === hi ? ' hi' : '') + (n === original ? ' current' : ''), role: 'option', 'aria-selected': String(i === hi), dataset: { net: n } }, n);
        opt.addEventListener('pointerdown', (e) => { e.preventDefault(); pick(n); }); // preventDefault keeps focus in the box
        return opt;
      }));
      list.style.display = shown.length ? '' : 'none';
      list.querySelector('.hi')?.scrollIntoView({ block: 'nearest' });
    };
    let done = false;
    const close = () => { if (done) return; done = true; input.remove(); tip.remove(); list.remove(); this.labelEdit = null; this.ws.view.canvas.focus({ preventScroll: true }); this.ws.view.invalidate(); };
    const commit = () => {
      if (done) return true;
      const typed = input.value.trim();
      if (label && typed === original) { close(); return true; }
      const bad = validateLabelName(typed);
      if (bad) { input.classList.add('bad'); tip.classList.remove('note'); tip.textContent = bad; input.focus(); return false; }
      // names match regardless of case: use the spelling the Net already has (ADR-0013)
      const name = canonicalNetName(this.project, typed, label?.id);
      if (name !== typed) toast(`${typed} is the same net as ${name}, so it uses that spelling.`, 'info', 3500);
      if (label && name === original) { close(); return true; }
      if (label) {
        this.app.edit(`Rename ${original} to ${name}`, (p) => { const x = (this._S(p).labels || []).find((y) => y.id === label.id); if (x) x.net = name; });
        if (label.style === 'power') this.nextName.power = name; // the next Power symbol uses it
      } else {
        const placed = this.app.edit(`Place ${name}`, (p) => addLabel(p, this._S(p), { ...spec, net: name }));
        this.selection = new Set([placed.id]);
        if (spec.style === 'power') this.nextName.power = name; else this.nextName.label = bumpName(name);
      }
      close();
      this.refresh();
      return true;
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (shown.length) { hi = (hi + (e.key === 'ArrowDown' ? 1 : -1) + shown.length + 1) % (shown.length + 1); if (hi === shown.length) hi = -1; renderList(); }
      } else if (e.key === 'Enter') { e.preventDefault(); if (hi >= 0 && shown[hi]) pick(shown[hi]); else commit(); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
    input.addEventListener('input', () => { input.classList.remove('bad'); tip.textContent = ''; hi = -1; renderList(); });
    input.addEventListener('blur', () => { if (!done && !commit()) close(); });
    this.ws.view.el.append(input, list, tip);
    renderList();
    input.focus();
    input.select();
    this.labelEdit = { input, commit, close };
    this.ws.view.invalidate();
  }

  // ---------------------------------------------------------------- Sheets (#7)

  /** Bottom-bar chips: one per Sheet (click to switch, double-click to rename) and a + to add one. */
  sheetChips() {
    const cur = this.sheet.id;
    return [...this.project.schematic.sheets.map((s, i) => {
      const chip = h('button', { class: 'chip text-chip' + (s.id === cur ? ' on' : ''), type: 'button', title: `${s.name} (double-click to rename)`, dataset: { sheet: s.id }, onClick: () => this.switchSheet(s.id) }, String(i + 1));
      chip.addEventListener('dblclick', () => { this.toggleSheets(true); this.renameSheetInline(s.id); });
      return chip;
    }), h('button', { class: 'chip text-chip chip-add', type: 'button', title: 'Add a sheet', 'aria-label': 'Add sheet', onClick: () => this.addSheet() }, '+')];
  }

  addSheet() {
    const s = this.app.edit('Add sheet', (p) => addSheet(p, this.sheet.id));
    this.switchSheet(s.id);
    return s;
  }

  deleteSheet(id) {
    const s = this.project.schematic.sheets.find((x) => x.id === id);
    if (!s || this.project.schematic.sheets.length < 2) return;
    const i = this.project.schematic.sheets.indexOf(s);
    const n = s.symbols.length;
    this.app.edit(`Delete ${s.name}`, (p) => deleteSheet(p, id));
    if (id === this.sheet.id || !this.project.schematic.sheets.some((x) => x.id === this.sheetId)) this.sheetId = this.project.schematic.sheets[Math.max(0, i - 1)].id;
    this.selection.clear();
    toast(`Deleted ${s.name}${n ? ` and its ${n} part${n === 1 ? '' : 's'}` : ''}. Ctrl+Z brings it back.`, 'info', 4000);
    this.refresh();
  }

  toggleSheets(open = !this.sheetsOpen) {
    this.sheetsOpen = open;
    this.sheetsBtn?.classList.toggle('active', open);
    this.renderSheets();
  }

  renderSheets() {
    const el = this.sheetsEl;
    if (!el) return;
    el.style.display = this.sheetsOpen ? '' : 'none';
    if (!this.sheetsOpen || el.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
    const sheets = this.project.schematic.sheets;
    const cur = this.sheet.id;
    const row = (s, i) => {
      const parts = s.symbols.length;
      return h('div', { class: 'sheet-row' + (s.id === cur ? ' on' : ''), dataset: { sheet: s.id }, onClick: () => this.switchSheet(s.id) },
        h('span', { class: 'sheet-num' }, String(i + 1)),
        h('span', { class: 'sheet-name', title: 'Double-click to rename', onDblclick: (e) => { e.stopPropagation(); this.renameSheetInline(s.id); } }, s.name),
        h('span', { class: 'sheet-count' }, `${parts} part${parts === 1 ? '' : 's'}`),
        h('span', { class: 'sheet-btns', onClick: (e) => e.stopPropagation() },
          button({ icon: 'ltext', title: 'Rename', cls: 'btn-ghost btn-xs', onClick: () => this.renameSheetInline(s.id) }),
          button({ icon: 'up', title: 'Move up', cls: 'btn-ghost btn-xs', disabled: i === 0, onClick: () => this.app.edit(`Move ${s.name} up`, (p) => moveSheet(p, s.id, -1)) }),
          button({ icon: 'down', title: 'Move down', cls: 'btn-ghost btn-xs', disabled: i === sheets.length - 1, onClick: () => this.app.edit(`Move ${s.name} down`, (p) => moveSheet(p, s.id, 1)) }),
          button({ icon: 'trash', title: sheets.length < 2 ? 'A project keeps at least one sheet' : 'Delete sheet', cls: 'btn-ghost btn-xs', disabled: sheets.length < 2, onClick: () => this.deleteSheet(s.id) })));
    };
    el.replaceChildren(
      h('div', { class: 'fp-head' }, h('b', {}, 'Sheets'), h('span', { class: 'fp-count' }, `${sheets.length}`),
        button({ icon: 'close', title: 'Close', cls: 'btn-ghost', onClick: () => this.toggleSheets(false) })),
      h('div', { class: 'fp-body' }, ...sheets.map(row),
        h('p', { class: 'side-note' }, 'Net labels join on their own sheet; Global labels and Power symbols join across sheets.')),
      h('div', { class: 'fp-foot' }, button({ icon: 'plus', label: 'Add sheet', cls: 'btn-outline', onClick: () => this.addSheet() })));
  }

  renameSheetInline(id) {
    const row = this.sheetsEl?.querySelector(`.sheet-row[data-sheet="${id}"] .sheet-name`);
    const s = this.project.schematic.sheets.find((x) => x.id === id);
    if (!row || !s) return;
    const input = h('input', { class: 'input sheet-name-edit', type: 'text', value: s.name, 'aria-label': 'Sheet name', spellcheck: false });
    let done = false;
    const finish = (save) => {
      if (done) return;
      const name = input.value.trim();
      if (save && name !== s.name) {
        const bad = validateSheetName(this.project, id, name);
        if (bad) { toast(bad, 'warn', 3000); input.classList.add('bad'); input.focus(); return; }
        done = true;
        this.app.edit(`Rename sheet to ${name}`, (p) => renameSheet(p, id, name));
      }
      done = true;
      input.blur();
      this.renderSheets();
      this.ws?.renderBar();
    };
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); });
    input.addEventListener('blur', () => { if (!done) { done = true; const name = input.value.trim(); if (name !== s.name && !validateSheetName(this.project, id, name)) this.app.edit(`Rename sheet to ${name}`, (p) => renameSheet(p, id, name)); this.renderSheets(); } });
    input.addEventListener('click', (e) => e.stopPropagation());
    row.replaceWith(input);
    input.focus(); input.select();
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
    const ids0 = [...clip.symbols.map((y) => y.id), ...clip.wires.map((w) => w.id), ...(clip.labels || []).map((l) => l.id)];
    const tmp = { components: clip.components, parts: clip.parts, schematic: { sheets: [{ symbols: clip.symbols, wires: clip.wires, labels: clip.labels || [] }] } };
    const b = itemsBounds(tmp, tmp.schematic.sheets[0], ids0);
    let delta = offset;
    if (!delta) {
      const anchor = snapPt([(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2], SCH_GRID);
      delta = this.cursor ? [this.cursor[0] - anchor[0], this.cursor[1] - anchor[1]] : [SCH_GRID * 4, SCH_GRID * 4];
      if (!delta[0] && !delta[1]) delta = [SCH_GRID * 4, SCH_GRID * 4];
    }
    const ids = this.app.edit('Paste', (p) => pasteClip(p, this._S(p), clip, delta));
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
    this.app.edit('Move', (p) => { moveSelection(p, this._S(p), ids, [dx * SCH_GRID, dy * SCH_GRID]); cleanupWires(p, this._S(p)); });
    this.refresh();
  }

  selectAll() {
    this.selection = new Set(this._allIds());
    this.refresh();
  }

  /** Ctrl/Cmd shortcuts the app routes here (copy, paste, duplicate, select all). */
  onModKey(e) {
    const k = e.key.toLowerCase();
    if (k === 'l') { this.setTool('globalLabel'); return true; }
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
    if (LABEL_TOOLS[this.tool] && e.key === 'Escape') { this.setTool('select'); return true; }
    if (k === 'w') { this.setTool('wire'); return true; }
    if (k === 'l') { this.setTool('netLabel'); return true; }
    if (k === 'p') { this.setTool('power'); return true; }
    if (k === 'g') { this.setTool('ground'); return true; }
    if (k === 'q') { this.setTool('noConnect'); return true; }
    if (this.tool === 'noConnect' && e.key === 'Escape') { this.setTool('select'); return true; }
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

