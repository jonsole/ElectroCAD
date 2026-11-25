// Schematic editor: the Part picker (modelled on DabbleCAD's 3D Design shape panel), placing
// Parts (#4), drawing Wires and the live Netlist panel (#5), selecting, rotating, mirroring
// and deleting. Every change is one History transaction (one undo step).
import { h, icon, button, popupMenu, toast, modal } from '../ui/dom.js';
import { allFieldStyles, fieldStyleById } from '../ui/fieldStyles.js';
import { later } from '../workspaces/workspace.js';
import { STARTER_LIBRARY, CATEGORIES, searchParts, groupParts } from '../library/starter.js';
import { allFootprints } from '../library/footprints.js';
import { addDrawing, toggleNoConnect, hitNoConnect, placedUnits, unitSuggestion, nextUnplacedUnit, unitLetter, placeSymbol, rotateSymbols, mirrorSymbols, setSymbolsLocked, deleteItems, symbolBounds, hitSymbol, addWire, addLabel, addSheet, renameSheet, moveSheet, deleteSheet, validateSheetName, hitWire, preferredAxis, routeWire, moveSelection, copySelection, pasteClip, itemsInRect, itemsBounds, cleanupWires } from '../core/schematic.js';
import { buildNetlist } from '../core/netlist.js';
import { runErc, filterViolations } from '../core/erc.js';
import { shapeHandles, hitHandle, dragHandle, snapPoint } from '../core/handles.js';
import { drawHandles, drawSnapMark } from '../view/handles.js';
import { snapToGrid, gridLabel, SCHEMATIC_GRIDS, setGridStep } from '../core/grid.js';
import { watchAlt } from '../ui/grid.js';
import { RULER } from '../view/canvas2d.js';
import { GridCard } from '../ui/gridCard.js';
import { ContextStrip, stripLabel, stripSep, stripButton, stripProps } from '../ui/contextStrip.js';
import { cardHead } from '../ui/cards.js';
import { highlight, screenBox, revealBox } from '../view/highlight.js';
import { probeFromSchematic, schematicTargets, sheetForProbe } from '../core/probe.js';
import { hitDrawing, drawingDefaults, paperRect, titleBlockLayout, PAPER_SIZES, TITLE_FIELDS, LINE_STYLES } from '../core/drawings.js';
import { pinPositions, nextRef, partOf } from '../core/project.js';
import { onSegment, eq } from '../core/geom.js';
import { SCH_GRID, mm } from '../core/units.js';

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

/** Markup tools (#59): key, icon, title. Markup never connects like Wires. */
const DRAW_TOOLS = {
  text: { icon: 'ltext', key: 't', title: 'Text (T): click, type; Shift+Enter for a new line. ${TITLE}, ${SHEET_NAME}… are filled in' },
  gline: { icon: 'lline', key: 'i', title: 'Line (I): click points, double-click or Enter to finish; arrows in the inspector' },
  grect: { icon: 'lrect', key: 'b', title: 'Rectangle (B): click two corners, e.g. a dashed box round a section' },
  gcircle: { icon: 'lellipse', key: 'c', title: 'Circle (C): click the centre, then the edge' },
  garc: { icon: 'arc', key: 'a', title: 'Arc (A): click the start, a point on the arc, then the end' },
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
    this.propsOpen = false; // the Properties card (the inspector): opened by double-click or right-click → Properties…
    this._propsFor = null;  // the selection it was opened for; it closes when the selection changes
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

  /** The picker's Parts: the built-in starter Library, then the user's own Libraries (#13). */
  get parts() { return [...STARTER_LIBRARY, ...(this.app.userParts?.() || [])]; }

  /** A user Library was saved, renamed or deleted: refresh the categories and tiles. */
  librariesChanged() { this._fillCategories(); this.renderTiles(); }

  _fillCategories() {
    const sel = this.catSel;
    if (!sel) return;
    const libs = this.app.libraries || [];
    sel.replaceChildren(h('option', { value: 'All' }, 'All parts'), ...CATEGORIES.map((c) => h('option', { value: c }, c)),
      libs.length ? h('optgroup', { label: 'My libraries' }, ...libs.map((l) => h('option', { value: `lib:${l.id}` }, l.name))) : '');
    if (![...sel.options].some((o) => o.value === this.category)) this.category = 'All';
    sel.value = this.category;
  }
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
    const catSel = this.catSel = h('select', { class: 'select', 'aria-label': 'Part category', title: 'Part category, or one of your Libraries' });
    this._fillCategories();
    catSel.addEventListener('change', () => { this.category = catSel.value; this.renderTiles(); });
    this.grid.addEventListener('pointerleave', () => { if (this.fpHover) { this.fpHover = null; this.renderFootprintRow(); } });
    // the Parts card: floating over the canvas (toolbar Parts button), or docked by either edge
    this.panel = h('div', { class: 'float-panel parts-card picker', role: 'region', 'aria-label': 'Parts' },
      cardHead({ icon: 'parts', title: 'Parts', onClose: () => this.toggleParts(false), closeTitle: 'Close (the Parts button on the toolbar opens it again)' }),
      h('div', { class: 'parts-body' },
      h('div', { class: 'side-filter picker-filter' }, catSel, this.viewBtn = button({ icon: VIEWS[this.pickerView].icon, title: `View: ${VIEWS[this.pickerView].label}`, cls: 'btn-ghost picker-view', onClick: (e) => this.viewMenu(e.currentTarget) })),
      h('div', { class: 'side-search' }, icon('search', 16), search),
      this.grid,
      this.fpRow = h('div', { class: 'fp-row', 'aria-label': 'Footprint for the next part' }),
      this.styleFoot = h('div', { class: 'side-foot field-style-foot' }),
      h('div', { class: 'side-foot' }, later({ label: 'Import', icon: 'import', title: 'Import KiCad or Eagle libraries' }, 32), button({ label: 'New part', icon: 'plus', title: 'Draw a new Part in the Library tab', onClick: () => { this.app.setWorkspace('library'); this.app.libEditor?.createPart(); } }))));
    this.panel.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
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

  /**
   * Everything under a point, best first (#78): a no-connect, a label, then the thin things (a
   * drawing's stroke, a wire) before the body of a symbol they lie over, unless the point is at one
   * of that symbol's pins, where the symbol comes first as before. Clicking again on the same spot
   * steps through this list.
   */
  _hitsAt(world, scale) {
    const tol = 4 / scale;
    const f = this.placement && hitField(this.project, this.placement, world, tol / 2, measureText);
    const sym = hitSymbol(this.project, this.sheet, world, 3 / scale);
    const fsym = f && this.sheet.symbols.find((y) => y.id === f.symbolId);
    const thin = [hitDrawing(this.sheet, world, tol, measureText), hitWire(this.sheet, world, tol)].filter(Boolean);
    const atPin = sym && pinPositions(this.project, sym).some(({ at }) => Math.hypot(at[0] - world[0], at[1] - world[1]) <= tol * 1.5);
    const order = [hitNoConnect(this.sheet, world, SCH_GRID / 2), hitLabel(this.sheet, world, tol / 2, measureText),
      ...(sym && !atPin ? [...thin, sym, fsym] : [sym, fsym, ...thin])];
    const seen = new Set(), out = [];
    for (const x of order) if (x && !seen.has(x.id)) { seen.add(x.id); out.push(x); }
    return out;
  }

  /** Right-click on the canvas (DabbleCAD's context menu): commands for what's under the cursor or selected. */
  contextMenu(e) {
    if (this.placing || this.tool !== 'select') { if (this.placing) this.endPlace(); else this.setTool('select'); return; }
    const v = this.ws.view;
    const world = v.view.toWorld(v.local(e));
    const hits = this._hitsAt(world, v.view.scale);
    // a right-click on something already selected keeps the selection (and whichever item it is)
    const hit = hits.find((x) => this.selection.has(x.id)) || hits[0] || null;
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
        { label: 'Sheet setup…', icon: 'settings', onClick: () => this.sheetSetup() },
      ], at);
      return;
    }
    const anySym = this.sheet.symbols.some((y) => this.selection.has(y.id));
    const anyLabel = (this.sheet.labels || []).some((l) => this.selection.has(l.id)) || (this.sheet.drawings || []).some((d) => this.selection.has(d.id));
    const selSyms = this._selSyms(), allLocked = selSyms.length > 0 && selSyms.length === this.selection.size && selSyms.every((y) => y.locked);
    popupMenu([
      { label: 'Properties…', icon: 'sliders', shortcut: 'Double-click', onClick: () => this.openProperties() },
      anySym || this.sheet.wires.some((w) => this.selection.has(w.id)) ? { label: anySym ? 'Show on Board' : 'Show the net on Board', icon: 'board', onClick: () => this.showOnBoard() } : null,
      'sep',
      { label: 'Copy', icon: 'copy', shortcut: 'Ctrl+C', onClick: () => this.copy() },
      { label: 'Paste', icon: 'paste', shortcut: 'Ctrl+V', disabled: !this.clipboard, onClick: () => this.paste() },
      { label: 'Duplicate', icon: 'duplicate', shortcut: 'Ctrl+D', onClick: () => this.duplicate() },
      { label: 'Delete', icon: 'trash', shortcut: 'Del', onClick: () => this.deleteSelection() },
      'sep',
      { label: 'Rotate', icon: 'rotate', shortcut: 'R', disabled: (!anySym && !anyLabel) || allLocked, onClick: () => this.rotate() },
      { label: 'Mirror', icon: 'mirror', shortcut: 'X', disabled: !anySym || allLocked, onClick: () => this.mirror() },
      anySym ? { label: this._selSyms().every((y) => y.locked) ? 'Unlock' : 'Lock', icon: this._selSyms().every((y) => y.locked) ? 'unlock' : 'lock', onClick: () => this.lockSel() } : null,
      anySym ? 'sep' : null,
      anySym ? this._reapplyItem() : null,
    ], at);
  }

  renderTiles() {
    if (!this.grid) return;
    const C = this.app.canvasColors('schematic');
    // a user Library in the category select shows just its Parts
    const lib = this.category.startsWith('lib:') ? this.category.slice(4) : null;
    let list = lib ? searchParts(this.parts.filter((p) => p.origin?.library === lib), this.query, 'All') : searchParts(this.parts, this.query, this.category);
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
  /** Every Footprint to choose from: the user's Library footprints first, then the built-in ones. */
  allFootprints() { return [...this.app.libraries.flatMap((l) => Object.values(l.footprints || {})), ...(this._allFp ||= allFootprints())]; }

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
      paste: button({ icon: 'paste', title: 'Paste (Ctrl+V)', onClick: () => this.paste() }),
    };
    // the cards over the canvas: Sheets, Netlist and ERC; icons only, lit while open
    this.sheetsBtn = button({ icon: 'sheets', title: 'Sheets: add, rename, reorder and delete', onClick: () => this.toggleSheets() });
    this.netlistBtn = button({ icon: 'netlist', title: 'Netlist', onClick: () => this.toggleNetlist() });
    this.ercBtn = button({ icon: 'erc', title: 'Electrical rule check (ERC)', onClick: () => this.toggleErc() });
    const erc = this.ercBtn;
    this.partsBtn = button({ icon: 'parts', label: 'Parts', cls: 'keep-label', title: 'Parts: the part picker, as a floating card (drag it to an edge of the canvas to dock it)', onClick: () => this.toggleParts() });
    this.gridCard = new GridCard({
      key: 'schematic-grid', choices: SCHEMATIC_GRIDS,
      state: () => ({ grid: this.sheet.grid, origin: this.sheet.origin, scope: this.sheet.name, originNote: "The origin is measured from the paper's top-left corner." }),
      onGrid: (which, nm) => this.app.edit(`${this.sheet.name}: ${which === 'alt' ? 'Alt grid' : 'grid'} ${gridLabel(nm)}`, (p) => { const g = this._S(p).grid; setGridStep(g, which, nm); }),
      onOrigin: (at) => this.app.edit(`${this.sheet.name}: grid origin`, (p) => { this._S(p).origin = at; }),
      onPick: () => this.setTool('origin'),
    });
    // copy, duplicate, delete, rotate, mirror and Fields live on the context strip over the canvas
    this.strip = new ContextStrip('Selection actions and tool options', 'schematic');
    return [this.btn.undo, this.btn.redo, h('span', { class: 'sep' }), this.btn.paste, h('span', { class: 'sep' }),
      this.partsBtn, this.gridCard.button, this.sheetsBtn, this.netlistBtn, erc];
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
      ...Object.entries(DRAW_TOOLS).map(([id, t]) => (this.toolBtn[id] = button({ icon: t.icon, title: t.title, onClick: () => this.setTool(id) }))),
      toolButton('ruler', 'Measure', { ticket: 8 }),
      (this.toolBtn.origin = button({ icon: 'target', title: 'Grid origin (O): click to move the origin there; it snaps onto Pins, Wire ends and handles. Reset it in the Grid card (toolbar)', onClick: () => this.setTool('origin') }))];
  }

  setTool(tool) {
    if (this.tool === 'gline' && this.drawingPts?.length > 1 && tool !== 'gline') this._finishGline();
    this.drawingPts = null;
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
    if (this.propsOpen && this._selSig() !== this._propsFor) { this.propsOpen = false; this._propsFor = null; }
    if (this.btn) {
      this.btn.undo.disabled = !this.app.history.canUndo;
      this.btn.redo.disabled = !this.app.history.canRedo;
      this.btn.paste.disabled = !this.clipboard;
    }
    if (this.toolBtn) for (const [t, b] of Object.entries(this.toolBtn)) b.classList.toggle('active', this.tool === t && !this.placing);
    this._syncFrame();
    if (this.ws) { this.ws.view.grid = this.gridStep; this.ws.view.origin = this.sheet.origin; }
    this.renderNetlist();
    this.renderSheets();
    this.renderErc();
    this.gridCard?.render();
    this.renderUnitStrip();
    this.renderStyleFoot();
    this.ws?.renderBar();
    this.inspector?.render();
    this._updateStrip();
    this._avoidInspector();
    this._hint();
    this._publishProbe();
    this.ws?.view.invalidate();
  }

  _hint() {
    if (!this.ws) return;
    let text = IDLE_HINT;
    if (this.fieldWarnings && this.fieldWarnings.length) text = `⚠ ${this.fieldWarnings.length === 1 ? this.fieldWarnings[0] : `${this.fieldWarnings.length} parts' fields overlap (${this.fieldWarnings.slice(0, 3).join('; ')}${this.fieldWarnings.length > 3 ? '…' : ''})`} — move parts apart or pick another Field style. ` + IDLE_HINT.replace('Nothing selected. ', '');
    if (this.tool === 'wire') text = this.wiring
      ? 'Drawing a wire: click to add a corner · click a Pin or Wire (or double-click) to finish · / switch corner direction · Backspace undo corner · Esc finish'
      : 'Wire: click a Pin or a point on the grid to start · Esc back to Select';
    else if (this.tool === 'origin') text = 'Grid origin: click where the grid, rulers and coordinates should measure from (it snaps onto Pins, Wire ends and handles) · Esc back to Select';
    else if (DRAW_TOOLS[this.tool]) {
      const n = this.drawingPts?.length || 0;
      text = { text: 'Text: click where it goes, type, Enter to finish (Shift+Enter: new line). ${TITLE}, ${REV}, ${SHEET_NAME}, ${SHEET_NUMBER} of ${SHEET_COUNT}… are filled in',
        gline: n ? 'Line: click to add a point · double-click or Enter to finish · Esc cancel' : 'Line: click the first point (arrows and dashes in the inspector)',
        grect: n ? 'Rectangle: click the opposite corner' : 'Rectangle: click a corner',
        gcircle: n ? 'Circle: click a point on the edge' : 'Circle: click the centre',
        garc: !n ? 'Arc: click the start' : n === 1 ? 'Arc: click a point the arc passes through' : 'Arc: click the end' }[this.tool] + ' · Esc back to Select';
    }
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
      const nd = (this.sheet.drawings || []).filter((d) => this.selection.has(d.id)).length;
      if (nd) labels.push(`${nd} note${nd === 1 ? '' : 's'}/shape${nd === 1 ? '' : 's'}`);
      if (nnc) labels.push(`${nnc} no-connect${nnc === 1 ? '' : 's'}`);
      const what = [...refs, ...labels, ...(nw ? [`${nw} wire${nw === 1 ? '' : 's'}`] : [])].join(', ');
      text = `Selected ${what} · drag or arrow keys to move${refs.length || labels.length ? ' · R rotate' : ''}${refs.length ? ' · X mirror' : ''}${labels.length === 1 && !refs.length ? ' · double-click to rename' : ''} · Ctrl+C/V/D · Del delete · Esc deselect`;
    }
    this.ws.hint.textContent = text;
  }

  // ---------------------------------------------------------------- canvas

  attach(ws) {
    this.ws = ws;
    this.strip.mount(ws.view.el);
    const c = ws.view.canvas;
    c.addEventListener('pointerdown', (e) => {
      this.lastPointer = [e.clientX, e.clientY];
      if (e.button !== 0) return;
      const world = ws.view.view.toWorld(ws.view.local(e));
      this.setAlt(e.altKey);
      if (this.placing && !this.placing.drag) { this._update(world); this.commitPlace(); return; }
      if (this.tool === 'origin') { this.placeOrigin(world); return; }
      if (this.tool === 'wire') { this._wireClick(world, e.detail >= 2); return; }
      if (LABEL_TOOLS[this.tool]) { e.preventDefault(); this._labelClick(this.snapAt(world)); return; } // keep focus in the name box
      if (DRAW_TOOLS[this.tool]) { if (this.tool === 'text') e.preventDefault(); this._drawClick(world, e.detail >= 2); return; }
      if (this.tool === 'noConnect') {
        const at = this.snapAt(world);
        const there = (this.sheet.noConnects || []).some((n) => n.at[0] === at[0] && n.at[1] === at[1]);
        this.app.edit(there ? 'Remove no-connect' : 'Mark no-connect', (p) => toggleNoConnect(p, this._S(p), at));
        this.refresh();
        return;
      }
      const tol = 4 / ws.view.view.scale;
      // clicking again on the same spot (a separate click, not a double-click) steps to the next item
      // under it, on release, if the press didn't turn into a drag (#78)
      // (browsers report 0 clicks on pointer events, so a double-click's second press is told apart by time)
      const last = this._lastClick, now = e.timeStamp || performance.now();
      this._cycle = !e.shiftKey && e.detail <= 1 && !!last && now - last.t >= 350 && Math.hypot(e.clientX - last.x, e.clientY - last.y) <= 3 && this.selection.size === 1 ? { world } : null;
      this._lastClick = { x: e.clientX, y: e.clientY, t: now };
      const handle = !e.shiftKey && this._handleAt(world, 5 / ws.view.view.scale);
      if (handle) {
        this.handleDrag = { ...handle, startPx: [e.clientX, e.clientY], snapshot: structuredClone(this.project), moved: false };
        try { c.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
        return;
      }
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
      const hits = this._hitsAt(world, ws.view.view.scale);
      const hit = hits.find((x) => this._cycle && this.selection.has(x.id)) || hits[0] || null;
      if (e.shiftKey && hit) { if (this.selection.has(hit.id)) this.selection.delete(hit.id); else this.selection.add(hit.id); this.refresh(); return; }
      if (hit) {
        if (!this.selection.has(hit.id)) this.selection = new Set([hit.id]);
        // press on a selected item: dragging moves the selection, wires following
        this.drag = { start: this.snapG(world), startPx: [e.clientX, e.clientY], ids: [...this.selection], snapshot: structuredClone(this.project), delta: [0, 0], moved: false };
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
      // double-clicking a Wire (or a ground symbol) selects its whole Net on this Sheet
      const wire = !f && !l && hitWire(this.sheet, world, 4 / ws.view.view.scale);
      if (wire || (l && l.style === 'gnd')) { e.preventDefault(); this.selectNet((wire || l).id); return; }
      const d = hitDrawing(this.sheet, world, 3 / ws.view.view.scale, measureText);
      if (d && d.type === 'text') { e.preventDefault(); this.editText({ drawing: d }); return; }
      const tb = titleBlockLayout(this.sheet).box;
      if (!f && world[0] >= tb.x0 && world[0] <= tb.x1 && world[1] >= tb.y0 && world[1] <= tb.y1) { e.preventDefault(); this.sheetSetup(); return; }
      if (f && (f.key === 'reference' || f.key === 'value')) { e.preventDefault(); this.editField(f.symbolId, f.key); return; }
      // double-clicking a part (or a line, rectangle, circle or arc) opens its Properties
      const item = this._hitsAt(world, ws.view.view.scale).find((x) => this.sheet.symbols.includes(x) || (this.sheet.drawings || []).includes(x) && x.type !== 'text');
      if (item) { e.preventDefault(); this.selection = new Set([item.id]); this.openProperties(); }
    });
    c.addEventListener('pointerup', (e) => {
      if (e.button !== 0) return;
      const cyc = this._cycle;
      this._cycle = null;
      if (cyc && !this.handleDrag?.moved && !this.drag?.moved && !this.fieldDrag?.moved) {
        const hits = this._hitsAt(cyc.world, ws.view.view.scale);
        const i = hits.findIndex((x) => this.selection.has(x.id));
        if (hits.length > 1 && i >= 0) this.selection = new Set([hits[(i + 1) % hits.length].id]);
      }
      if (this.handleDrag) {
        const d = this.handleDrag;
        this.handleDrag = null;
        const pv = this.preview; this.preview = null;
        const nd = pv && this._S(pv).drawings.find((x) => x.id === d.id);
        if (d.moved && nd) this.app.edit(`Resize ${nd.type === 'line' ? 'line' : nd.type}`, (p) => { const ds = this._S(p).drawings; const i = ds.findIndex((x) => x.id === d.id); if (i >= 0) ds[i] = structuredClone(nd); });
        this.refresh();
        return;
      }
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
      this.lastPointer = [e.clientX, e.clientY];
      if (this.placing && !this.placing.drag) this._update(ws.view.view.toWorld(ws.view.local(e)));
      const world = ws.view.view.toWorld(ws.view.local(e));
      this.setAlt(e.altKey);
      this.snapMark = null;
      // wires, labels and no-connects snap onto Pins and Wire ends; everything else to the grid
      this.cursor = this.tool === 'wire' || LABEL_TOOLS[this.tool] || this.tool === 'noConnect' || this.tool === 'origin' ? this.snapAt(world) : this.snapG(world);
      this.cursorRaw = world; // markup snaps to half a grid
      if (this.tool !== 'select') ws.view.invalidate();
      if (this.handleDrag && (e.buttons & 1)) {
        const d = this.handleDrag;
        if (!d.moved && Math.hypot(e.clientX - d.startPx[0], e.clientY - d.startPx[1]) < 3) return;
        d.moved = true;
        const pv = structuredClone(d.snapshot);
        const ds = this._S(pv).drawings, i = ds.findIndex((x) => x.id === d.id);
        const from = shapeHandles(d.snapshot.schematic.sheets.find((x) => x.id === this.sheet.id).drawings[i]).find((x) => x.key === d.key)?.at;
        ds[i] = dragHandle(ds[i], d.key, this.snapAt(world, { step: this.gridStep / 2, skipId: d.id, not: from }));
        this.preview = pv;
        ws.view.invalidate();
        return;
      }
      if (this.tool === 'select' && !e.buttons && !this.placing) {
        const h = this._handleAt(world, 5 / ws.view.view.scale);
        if (h) { c.style.cursor = h.cursor; this._onHandle = true; } else if (this._onHandle) { c.style.cursor = ''; this._onHandle = false; }
      }
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
    const order = [this.inspector.el, this.gridCard.el, this.sheetsEl, this.ercEl, this.netlistEl];
    this.stack = h('div', { class: 'float-stack' });
    this.stackL = h('div', { class: 'float-stack float-stack-parts' }); // the Parts card's home, top right (the other cards move to its left)
    const layer = h('div', { class: 'card-layer' }, this.stackL, this.stack);
    const edges = { left: ws.dockL, right: ws.dockR };
    ws.view.el.append(layer);
    this.unitStrip = h('div', { class: 'unit-strip', role: 'toolbar', 'aria-label': 'Unit to place', hidden: true });
    ws.view.el.append(this.unitStrip);
    const dock = { el: this.stack, put: (card) => this.stack.append(...order.filter((c) => c === card || c.parentElement === this.stack)) };
    for (const c of order) this.stack.append(c);
    this.cards = {};
    for (const [k, c] of [['inspector', this.inspector.el], ['sheets', this.sheetsEl], ['erc', this.ercEl], ['netlist', this.netlistEl]]) {
      this.cards[k] = makeDraggable(c, { key: `schematic-${k}`, layer, dock, edges });
      c.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
    }
    this.gridCard.mount(ws, { layer, dock, edges });
    this.stackL.append(this.panel);
    this.cards.parts = makeDraggable(this.panel, { key: 'schematic-parts', layer, dock: { el: this.stackL, put: (c) => this.stackL.append(c) }, edges, resize: { minW: 250, maxW: 640, minH: 240 } });
    this.toggleParts(this.partsOpen);
    // picking the inspector up puts it back where it was before it stepped aside
    this.inspector.el.addEventListener('pointerdown', (e) => { if (e.target.closest('.insp-head')) { this.inspector.el.style.transform = ''; this._avoidSig = [...this.selection].sort().join(); } }, true);
    this.renderNetlist();
    this.renderSheets();
    this.renderErc();
    ws.view.onContextMenu = (e) => this.contextMenu(e);
    watchAlt(ws, (on) => this.setAlt(on));
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
      erc: this.ercOpen ? (this.ercShown || []).filter((x) => x.sheetId === sheet.id && x.severity !== 'info') : null, ercFocus: this.ercFocus,
      ghostDrawing: this._ghostDrawing() });
    // the selection, highlighted in the style chosen in Settings (the same in every editor)
    if (this.selection.size && !this.placing) {
      const only = this.selection, display = this.app.schematicDisplay(), placement = this.placement;
      const boxes = [...only].map((id) => itemsBounds(proj, sheet, [id])).filter(Boolean).map((b) => screenBox(view, b));
      highlight(ctx, C, this.app.highlightStyle(), (c, Cx) => drawSheet(c, view, Cx, proj, sheet, { only, placement, display }), boxes);
    }
    // the Board's selection (cross-probing), in the theme's Highlight colour
    const probed = this._probeTargets(proj);
    if (probed?.size) {
      const only = new Set([...probed].filter((id) => !this.selection.has(id)));
      const display = this.app.schematicDisplay(), placement = this.placement;
      const boxes = [...only].map((id) => itemsBounds(proj, sheet, [id])).filter(Boolean).map((b) => screenBox(view, b));
      highlight(ctx, { ...C, selection: C.highlight || C.selection }, this.app.highlightStyle() === 'fade' && this.selection.size ? 'glow' : this.app.highlightStyle(), (c, Cx) => drawSheet(c, view, Cx, proj, sheet, { only, placement, display }), boxes);
    }
    drawHandles(ctx, view, C, this._handles(), this.handleDrag?.key);
    drawSnapMark(ctx, view, C, this.snapMark);
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
    this.placing.at = this.snapG(world);
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
    this.keepClearOfCards([res.sym.id]);
    return res;
  }

  /**
   * After placing or pasting, the inspector (or another card over the canvas) must not hide what
   * was just added: pan the view the least distance that clears it, keeping it on screen.
   */
  keepClearOfCards(ids) {
    const ws = this.ws;
    if (!ws || !ids.length) return;
    const b = itemsBounds(this.project, this.sheet, ids);
    if (!b) return;
    const v = ws.view.view, pad = SCH_GRID * 2; // room for the Reference and Value around the body
    const [ax, ay] = v.toScreen([b.x0 - pad, b.y0 - pad]), [bx, by] = v.toScreen([b.x1 + pad, b.y1 + pad]);
    const cr = ws.view.canvas.getBoundingClientRect();
    const item = { x0: ax, y0: ay, x1: bx, y1: by };
    const cards = [this.inspector?.el, this.panel, this.gridCard?.el, this.sheetsEl, this.ercEl, this.netlistEl]
      .filter((el) => el && el.offsetParent && el.childElementCount && getComputedStyle(el).display !== 'none')
      .map((el) => { const r = el.getBoundingClientRect(); return { x0: r.left - cr.left, y0: r.top - cr.top, x1: r.right - cr.left, y1: r.bottom - cr.top }; });
    const hits = (a, c) => a.x0 < c.x1 && a.x1 > c.x0 && a.y0 < c.y1 && a.y1 > c.y0;
    const over = cards.filter((c) => hits(item, c));
    if (!over.length) return;
    const m = 12, view = { x0: RULER, y0: RULER, x1: ws.view.w, y1: ws.view.h };
    const moved = (dx, dy) => ({ x0: item.x0 + dx, y0: item.y0 + dy, x1: item.x1 + dx, y1: item.y1 + dy });
    const fits = (r) => r.x0 >= view.x0 && r.y0 >= view.y0 && r.x1 <= view.x1 && r.y1 <= view.y1 && !cards.some((c) => hits(r, c));
    const options = over.flatMap((c) => [[c.x0 - m - item.x1, 0], [c.x1 + m - item.x0, 0], [0, c.y0 - m - item.y1], [0, c.y1 + m - item.y0]])
      .sort((p, q) => Math.hypot(...p) - Math.hypot(...q));
    const best = options.find(([dx, dy]) => fits(moved(dx, dy))) || options[0];
    v.pan(best[0], best[1]);
    ws.view.invalidate();
  }

  /** Enter or Space on a tile: drop the Part in the middle of the view. */
  placeAtViewCenter(part) {
    const v = this.ws.view;
    const at = this.snapG(v.view.toWorld([v.w / 2, v.h / 2]));
    const { componentId, unit } = unitSuggestion(this.project, part);
    const res = this.app.edit(`Place ${part.name}`, (p) => placeSymbol(p, this._S(p), part, at, { unit, component: componentId ? p.components[componentId] : undefined, footprint: this.footprintFor(part) || undefined }));
    this.selection = new Set([res.sym.id]);
    this.refresh();
    this.keepClearOfCards([res.sym.id]);
    return res;
  }

  /**
   * After placing or pasting, the inspector (or another card over the canvas) must not hide what
   * was just added: pan the view the least distance that clears it, keeping it on screen.
   */
  keepClearOfCards(ids) {
    const ws = this.ws;
    if (!ws || !ids.length) return;
    const b = itemsBounds(this.project, this.sheet, ids);
    if (!b) return;
    const v = ws.view.view, pad = SCH_GRID * 2; // room for the Reference and Value around the body
    const [ax, ay] = v.toScreen([b.x0 - pad, b.y0 - pad]), [bx, by] = v.toScreen([b.x1 + pad, b.y1 + pad]);
    const cr = ws.view.canvas.getBoundingClientRect();
    const item = { x0: ax, y0: ay, x1: bx, y1: by };
    const cards = [this.inspector?.el, this.sheetsEl, this.ercEl, this.netlistEl]
      .filter((el) => el && el.offsetParent && el.childElementCount && getComputedStyle(el).display !== 'none')
      .map((el) => { const r = el.getBoundingClientRect(); return { x0: r.left - cr.left, y0: r.top - cr.top, x1: r.right - cr.left, y1: r.bottom - cr.top }; });
    const hits = (a, c) => a.x0 < c.x1 && a.x1 > c.x0 && a.y0 < c.y1 && a.y1 > c.y0;
    const over = cards.filter((c) => hits(item, c));
    if (!over.length) return;
    const m = 12, view = { x0: RULER, y0: RULER, x1: ws.view.w, y1: ws.view.h };
    const moved = (dx, dy) => ({ x0: item.x0 + dx, y0: item.y0 + dy, x1: item.x1 + dx, y1: item.y1 + dy });
    const fits = (r) => r.x0 >= view.x0 && r.y0 >= view.y0 && r.x1 <= view.x1 && r.y1 <= view.y1 && !cards.some((c) => hits(r, c));
    const options = over.flatMap((c) => [[c.x0 - m - item.x1, 0], [c.x1 + m - item.x0, 0], [0, c.y0 - m - item.y1], [0, c.y1 + m - item.y0]])
      .sort((p, q) => Math.hypot(...p) - Math.hypot(...q));
    const best = options.find(([dx, dy]) => fits(moved(dx, dy))) || options[0];
    v.pan(best[0], best[1]);
    ws.view.invalidate();
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
    const inside = (el, ev) => { const r = el.getBoundingClientRect(); return ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom; };
    // over the canvas, but not over the Parts card it came from (dropping back on the card cancels)
    const overCanvas = (ev) => inside(canvas, ev) && !(this.panel.style.display !== 'none' && inside(this.panel, ev));
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
    const p = this.snapAt(world);
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

  // ---------------------------------------------------------------- markup and sheet setup (#59)

  /** The canvas frame follows the Sheet's paper size; Home fits it. */
  _syncFrame() {
    const v = this.ws?.view;
    if (!v) return;
    const r = paperRect(this.sheet);
    if (!v.frame || v.frame.x1 !== r.x1 || v.frame.y1 !== r.y1) { v.frame = r; v.home = r; v.invalidate(); }
  }

  // ---------------------------------------------------------------- grid, origin and snapping

  /** The grid in use: the Alt grid while Alt is held. */
  get gridStep() { const g = this.sheet.grid; return this.alt ? g.alt : g.main; }
  /** Snap to the grid (or `step`), measured from the grid origin. */
  snapG(w, step = this.gridStep) { return snapToGrid(w, step, this.sheet.origin); }

  setAlt(on) {
    if (!!on === !!this.alt) return;
    this.alt = !!on;
    if (this.ws) { this.ws.view.grid = this.gridStep; this.ws.renderBar(); this.ws.view.invalidate(); }
  }

  /** Points other things snap onto: Pin ends, Wire ends, labels, no-connects and markup handles (not `skipId`'s). */
  _snapTargets(skipId = null) {
    const sh = this.sheet, out = [];
    for (const sym of sh.symbols) for (const { at } of pinPositions(this.project, sym)) out.push(at);
    for (const w of sh.wires) out.push(w.a, w.b);
    for (const l of sh.labels || []) out.push(l.at);
    for (const n of sh.noConnects || []) out.push(n.at);
    for (const d of sh.drawings || []) if (d.id !== skipId) for (const hd of shapeHandles(d)) out.push(hd.at);
    out.push(this.sheet.origin);
    return out;
  }

  /** Snap onto a nearby object's point within the Settings distance, else the grid (or `step`). */
  snapAt(world, { step = this.gridStep, skipId = null, not = null } = {}) {
    const tol = this.app.snapDistance() / (this.ws?.view.view.scale || 1);
    const targets = this._snapTargets(skipId).filter((t) => !not || t[0] !== not[0] || t[1] !== not[1]);
    const r = snapPoint(world, targets, tol, (p) => this.snapG(p, step));
    this.snapMark = r.target;
    return r.at;
  }

  /** Origin tool: move the grid origin (snapping onto objects), then back to Select. */
  placeOrigin(world) {
    const at = this.snapAt(world, { not: this.sheet.origin });
    this.snapMark = null;
    this.app.edit(`Move ${this.sheet.name} grid origin`, (p) => { this._S(p).origin = [...at]; });
    this.setTool('select');
  }

  // ---------------------------------------------------------------- cross-probing (#18)

  /** Select the whole Net of a Wire or label on this Sheet: its Wires and labels. */
  selectNet(id) {
    const net = buildNetlist(this.project).nets.find((n) => n.wires?.includes(id) || n.labels?.includes(id));
    if (!net) { this.selection = new Set([id]); this.refresh(); return; }
    const here = new Set([...this.sheet.wires.map((w) => w.id), ...(this.sheet.labels || []).map((l) => l.id)]);
    this.selection = new Set([...(net.wires || []), ...(net.labels || [])].filter((x) => here.has(x)));
    this.refresh();
    toast(`Net ${net.name}: ${net.pins.length} pin${net.pins.length === 1 ? '' : 's'}`, 'info', 1800);
  }

  /**
   * The inspector must not cover what was just selected, nor the mouse: when it would, it moves to
   * the first free corner of the canvas (top left, bottom right, bottom left) until the selection
   * changes. Picking the card up by its header puts it back where it was.
   */
  _avoidInspector() {
    const el = this.inspector?.el;
    if (!el || !this.ws) return;
    const sig = [...this.selection].sort().join();
    if (sig === this._avoidSig) return;
    this._avoidSig = sig;
    el.style.transform = '';
    if (!this.selection.size || !el.childElementCount || !el.offsetParent) return;
    const v = this.ws.view, cr = v.canvas.getBoundingClientRect();
    const b = itemsBounds(this.project, this.sheet, [...this.selection]);
    if (!b) return;
    const pad = SCH_GRID * 2; // room for the Reference and Value
    const [x0, y0] = v.view.toScreen([b.x0 - pad, b.y0 - pad]), [x1, y1] = v.view.toScreen([b.x1 + pad, b.y1 + pad]);
    const keep = [{ x0: cr.left + Math.min(x0, x1) - 8, y0: cr.top + Math.min(y0, y1) - 8, x1: cr.left + Math.max(x0, x1) + 8, y1: cr.top + Math.max(y0, y1) + 8 }];
    if (this.lastPointer) keep.push({ x0: this.lastPointer[0] - 24, y0: this.lastPointer[1] - 24, x1: this.lastPointer[0] + 24, y1: this.lastPointer[1] + 24 });
    const r = el.getBoundingClientRect();
    const hits = (dx, dy) => keep.some((k) => r.left + dx < k.x1 && r.right + dx > k.x0 && r.top + dy < k.y1 && r.bottom + dy > k.y0);
    if (!hits(0, 0)) return;
    // the context strip sits at the top left: corners up there start below it
    const st = this.strip?.el, stripBottom = st && !st.hidden ? st.getBoundingClientRect().bottom + 6 : 0;
    const m = 10, left = cr.left + RULER + m, top = Math.max(cr.top + RULER + m, stripBottom), right = cr.right - m, bottom = cr.bottom - m;
    const spots = [[left - r.left, Math.max(0, top - r.top)], [0, bottom - r.bottom], [left - r.left, bottom - r.bottom], [right - r.right, top - r.top]];
    const free = spots.find(([dx, dy]) => !hits(dx, dy));
    if (free) el.style.transform = `translate(${Math.round(free[0])}px, ${Math.round(free[1])}px)`;
  }

  /** Tell the Board what is selected here (when this is the workspace being used). */
  _publishProbe() {
    if (this.app.active !== this.ws) return;
    const sig = `${this.sheet.id}|${[...this.selection].sort().join()}`;
    if (sig === this._probeSig) return;
    this._probeSig = sig;
    this.app.setProbe('schematic', probeFromSchematic(this.project, this.sheet, [...this.selection]));
  }

  /** The items on this Sheet the Board's selection points at (cached per probe and Project). */
  _probeTargets(proj) {
    const probe = this.app.probeFor('schematic');
    if (!probe) return null;
    const c = this._probeCache;
    if (c && c.probe === probe && c.proj === proj && c.sheet === this.sheet.id) return c.ids;
    const ids = schematicTargets(proj, this._S(proj), probe);
    this._probeCache = { probe, proj, sheet: this.sheet.id, ids };
    return ids;
  }

  /** Bring the Board's probe into view: switch to the Sheet that shows it, and pan if it is off screen. */
  revealProbe() {
    const probe = this.app.probeFor('schematic');
    if (!probe || !this.ws) return;
    const key = this.app.probe.key;
    if (key === this._revealed) return;
    this._revealed = key;
    if (!schematicTargets(this.project, this.sheet, probe).size) {
      const s = sheetForProbe(this.project, probe);
      if (s && s.id !== this.sheet.id) this.switchSheet(s.id);
    }
    const ids = [...schematicTargets(this.project, this.sheet, probe)];
    const b = ids.length && itemsBounds(this.project, this.sheet, ids);
    if (b) revealBox(this.ws.view, b);
  }

  /** The one selected markup shape (not text), or null: it shows resize handles. */
  status() {
    const n = Object.keys(this.project.components).length, ns = this.project.schematic.sheets.length;
    return `${this.sheet.name} · ${n} component${n === 1 ? '' : 's'} · ${ns} sheet${ns === 1 ? '' : 's'} · grid ${gridLabel(this.gridStep)}${this.alt ? ' (Alt)' : ''}`;
  }

  _handleDrawing(proj = this.project) {
    if (this.tool !== 'select' || this.placing || this.selection.size !== 1 || this.drag?.moved) return null;
    const id = [...this.selection][0];
    const d = (this._S(proj).drawings || []).find((x) => x.id === id);
    return d && d.type !== 'text' ? d : null;
  }

  _handles() { const d = this._handleDrawing(this.preview || this.project); return d ? shapeHandles(d) : []; }

  /** The handle under `w`, as { id, key, cursor }, or null. */
  _handleAt(w, tol) {
    const d = this._handleDrawing();
    const h = d && hitHandle(d, w, tol);
    return h ? { id: d.id, key: h.key, cursor: h.cursor } : null;
  }

  _drawClick(world, dbl) {
    const p = this.snapAt(world, { step: this.gridStep / 2 });
    const t = this.tool;
    if (t === 'text') { this.editText({ at: p }); return; }
    const pts = this.drawingPts || [];
    const add = (d) => {
      const nd = this.app.edit(`Add ${d.type === 'line' ? 'line' : d.type}`, (pr) => addDrawing(pr, this._S(pr), { ...drawingDefaults(d.type), ...d }));
      this.drawingPts = null;
      this.selection = new Set([nd.id]);
    };
    if (t === 'gline') {
      const last = pts[pts.length - 1];
      if (dbl || (last && last[0] === p[0] && last[1] === p[1])) { this._finishGline(); return; }
      this.drawingPts = [...pts, p];
    } else if (t === 'grect' && pts.length === 1) { if (p[0] !== pts[0][0] && p[1] !== pts[0][1]) add({ type: 'rect', a: pts[0], b: p }); else this.drawingPts = null; }
    else if (t === 'gcircle' && pts.length === 1) { const r = Math.round(Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1])); if (r) add({ type: 'circle', c: pts[0], r }); else this.drawingPts = null; }
    else if (t === 'garc' && pts.length === 2) add({ type: 'arc', start: pts[0], mid: pts[1], end: p });
    else this.drawingPts = [...pts, p];
    this.refresh();
  }

  _finishGline() {
    const pts = this.drawingPts || [];
    this.drawingPts = null;
    if (pts.length >= 2) {
      const nd = this.app.edit('Add line', (pr) => addDrawing(pr, this._S(pr), { type: 'line', pts, ...drawingDefaults('line') }));
      this.selection = new Set([nd.id]);
    }
    this.refresh();
  }

  /** The shape being drawn, from the clicked points to the cursor. */
  _ghostDrawing() {
    const pts = this.drawingPts;
    if (!pts || !this.cursorRaw || !DRAW_TOOLS[this.tool]) return null;
    const cur = this.snapAt(this.cursorRaw, { step: this.gridStep / 2 });
    const base = { id: 'ghost', ...drawingDefaults({ gline: 'line', grect: 'rect', gcircle: 'circle', garc: 'arc' }[this.tool]) };
    if (this.tool === 'gline') return { ...base, type: 'line', pts: [...pts, cur] };
    if (this.tool === 'grect') return { ...base, type: 'rect', a: pts[0], b: cur };
    if (this.tool === 'gcircle') return { ...base, type: 'circle', c: pts[0], r: Math.round(Math.hypot(cur[0] - pts[0][0], cur[1] - pts[0][1])) || 1 };
    if (this.tool === 'garc') return pts.length === 1 ? { ...base, type: 'line', style: 'dotted', arrowStart: false, arrowEnd: false, pts: [pts[0], cur] } : { ...base, type: 'arc', start: pts[0], mid: pts[1], end: cur };
    return null;
  }

  /**
   * Type a text note in place: a new one at `at`, or edit `drawing` (its raw text, with any
   * ${VARIABLES}). Enter saves (one undo step), Shift+Enter adds a line, Esc cancels.
   */
  editText({ at = null, drawing = null }) {
    this.closeFieldEdit();
    const v = this.ws.view.view;
    const d = drawing || { ...drawingDefaults('text'), at };
    const [x, y] = v.toScreen(d.at);
    const px = Math.max(12, d.size * v.scale);
    const box = h('textarea', { class: 'field-edit text-edit', spellcheck: false, rows: Math.max(1, String(drawing?.text || '').split('\n').length), 'aria-label': drawing ? 'Edit text' : 'Text' }, drawing?.text || '');
    Object.assign(box.style, { left: `${x - 6}px`, top: `${y - px * 0.85}px`, minWidth: '160px', fontSize: `${px}px`, lineHeight: '1.3' });
    const tip = h('div', { class: 'field-edit-tip note' }, 'Enter to finish · Shift+Enter new line · ${TITLE}, ${SHEET_NAME}… work');
    Object.assign(tip.style, { left: box.style.left, top: `${y - px * 0.85 - 24}px` });
    let done = false;
    const close = () => { if (done) return; done = true; box.remove(); tip.remove(); this.labelEdit = null; this.ws.view.canvas.focus({ preventScroll: true }); this.refresh(); };
    const commit = () => {
      if (done) return;
      const text = box.value.replace(/\s+$/, '');
      if (drawing) {
        if (!text) this.app.edit('Delete text', (p) => { const s = this._S(p); s.drawings = s.drawings.filter((x) => x.id !== drawing.id); });
        else if (text !== drawing.text) this.app.edit('Edit text', (p) => { const t = this._S(p).drawings.find((x) => x.id === drawing.id); if (t) t.text = text; });
      } else if (text) {
        const nd = this.app.edit('Add text', (p) => addDrawing(p, this._S(p), { type: 'text', ...d, text }));
        this.selection = new Set([nd.id]);
      }
      close();
    };
    const fit = () => { box.rows = Math.max(1, box.value.split('\n').length); };
    box.addEventListener('input', fit);
    box.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
    box.addEventListener('blur', () => commit());
    this.ws.view.el.append(box, tip);
    box.focus();
    box.select();
    this.labelEdit = { input: box, commit, close };
  }

  /** A Sheet's setup: paper size, grid, Alt grid and origin (this Sheet), and the text font and title block (every Sheet). */
  sheetSetup(sheetId = this.sheet.id) {
    const sheet = this.project.schematic.sheets.find((x) => x.id === sheetId) || this.sheet;
    const m = modal({ title: `Sheet setup: ${sheet.name}`, width: 540 });
    const tb = this.project.titleBlock || {};
    const stop = (el) => { el.addEventListener('keydown', (e) => e.stopPropagation()); return el; };
    const size = h('select', { class: 'select', 'aria-label': 'Paper size' }, ...Object.keys(PAPER_SIZES).map((k) => h('option', { value: k }, `${k} (${PAPER_SIZES[k].join(' × ')} mm)`)));
    size.value = sheet.paper?.size || 'A4';
    const orient = h('select', { class: 'select', 'aria-label': 'Orientation' }, h('option', { value: 'landscape' }, 'Landscape'), h('option', { value: 'portrait' }, 'Portrait'));
    orient.value = sheet.paper?.orientation || 'landscape';
    const gridSel = (label, cur) => {
      const el = h('select', { class: 'select', 'aria-label': label }, ...SCHEMATIC_GRIDS.map(([v, l]) => h('option', { value: String(v) }, l)));
      if (!SCHEMATIC_GRIDS.some(([v]) => v === cur)) el.prepend(h('option', { value: String(cur) }, gridLabel(cur)));
      el.value = String(cur);
      return el;
    };
    const g = sheet.grid || { main: SCH_GRID, alt: SCH_GRID / 2 };
    const main = gridSel('Grid', g.main), alt = gridSel('Alt grid', g.alt);
    const fmt = (nm) => String(+(nm / 1e6).toFixed(3));
    const o = sheet.origin || [0, 0];
    const ox = stop(h('input', { class: 'input', type: 'number', step: '0.01', value: fmt(o[0]), 'aria-label': 'Origin X (mm)' }));
    const oy = stop(h('input', { class: 'input', type: 'number', step: '0.01', value: fmt(o[1]), 'aria-label': 'Origin Y (mm)' }));
    const reset = button({ label: 'Reset', cls: 'btn-ghost', title: "Put the origin back at the paper's top-left corner", onClick: () => { ox.value = '0'; oy.value = '0'; } });
    const font = h('select', { class: 'select', 'aria-label': 'Text font' }, h('option', { value: 'system' }, 'System font'), h('option', { value: 'vector' }, 'Vector font (as Eagle draws it)'));
    font.value = this.project.schematic.textFont === 'vector' ? 'vector' : 'system';
    const inputs = TITLE_FIELDS.map(([k, label]) => [k, stop(h('input', { class: 'input', type: 'text', value: tb[k] || '', 'aria-label': label, placeholder: k === 'title' ? this.project.name : '' })), label]);
    const apply = () => {
      const nx = Math.round((parseFloat(ox.value) || 0) * 1e6), ny = Math.round((parseFloat(oy.value) || 0) * 1e6);
      this.app.edit(`Sheet setup: ${sheet.name}`, (p) => {
        const s = p.schematic.sheets.find((x) => x.id === sheet.id);
        s.paper = { size: size.value, orientation: orient.value };
        s.grid = { ...s.grid };
        setGridStep(s.grid, 'main', +main.value);
        setGridStep(s.grid, 'alt', +alt.value);
        s.origin = [nx, ny];
        p.titleBlock = Object.fromEntries(inputs.map(([k, i]) => [k, i.value.trim()]));
        if (font.value === 'vector') p.schematic.textFont = 'vector'; else delete p.schematic.textFont;
      });
      m.close();
      this.refresh();
      if (sheet.id === this.sheet.id) this.ws?.view.fitHome?.();
    };
    m.body.append(
      h('div', { class: 'setup-group' }, h('div', { class: 'setup-head' }, 'Paper'),
        h('div', { class: 'param-pair' }, h('label', { class: 'field' }, h('span', {}, 'Size'), size), h('label', { class: 'field' }, h('span', {}, 'Orientation'), orient))),
      h('div', { class: 'setup-group' }, h('div', { class: 'setup-head' }, 'Grid'),
        h('div', { class: 'param-pair' }, h('label', { class: 'field' }, h('span', {}, 'Grid'), main), h('label', { class: 'field' }, h('span', {}, 'Alt grid (hold Alt)'), alt)),
        h('p', { class: 'side-note' }, 'Pins connect where they meet, so keep the parts on a sheet on one grid. Markup snaps to half the grid.')),
      h('div', { class: 'setup-group' }, h('div', { class: 'setup-head' }, 'Origin'),
        h('div', { class: 'param-pair origin-pair' }, h('label', { class: 'field' }, h('span', {}, 'X (mm)'), ox), h('label', { class: 'field' }, h('span', {}, 'Y (mm)'), oy), reset),
        h('p', { class: 'side-note' }, "From the paper's top-left corner. The grid, rulers and coordinates measure from it; the Origin tool (O) sets it by clicking.")),
      h('div', { class: 'setup-group' }, h('div', { class: 'setup-head' }, 'Text (every sheet)'),
        h('label', { class: 'field' }, h('span', {}, 'Font'), font),
        h('p', { class: 'side-note' }, 'Kept with the project. The vector font has the board\'s stroke glyphs, sized and spaced as Eagle\'s; Eagle imports use it. Field positions follow the font\'s widths.')),
      h('div', { class: 'setup-group' }, h('div', { class: 'setup-head' }, 'Title block (every sheet)'),
        h('div', { class: 'setup-grid' }, ...inputs.map(([, i, label]) => h('label', { class: 'field' }, h('span', {}, label), i))),
        h('p', { class: 'side-note' }, 'The sheet name and "Sheet n of N" are filled in for each sheet. Text notes can show these fields too: ${TITLE}, ${COMPANY}, ${AUTHOR}, ${REV}, ${DATE}, ${COMMENT}, ${SHEET_NAME}, ${SHEET_NUMBER}, ${SHEET_COUNT}, ${PROJECT}.')),
      h('div', { class: 'modal-actions' }, button({ label: 'Cancel', cls: 'btn-outline', onClick: () => m.close() }), button({ label: 'Apply', cls: 'btn-primary', onClick: apply })));
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
    const count = h('span', {});
    const body = h('div', { class: 'fp-body' });
    this.ercEl.replaceChildren(
      cardHead({ icon: 'erc', title: 'ERC', sub: h('span', { class: 'insp-sub' }, ' · ', count), onClose: () => this.toggleErc(false), closeTitle: 'Close (the ERC button on the toolbar opens it again)' }),
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
      cardHead({ icon: 'netlist', title: 'Netlist', sub: `${nl.nets.length} net${nl.nets.length === 1 ? '' : 's'}`, onClose: () => this.toggleNetlist(false), closeTitle: 'Close (the Netlist button on the toolbar opens it again)' }),
      h('div', { class: 'fp-body' },
        nl.nets.length ? null : h('p', { class: 'side-note' }, 'No nets yet. Use the Wire tool (W) to connect Pins.'),
        ...nl.nets.map((n) => h('div', { class: 'nl-net', dataset: { net: n.name } }, h('div', { class: 'nl-name' }, n.name), h('div', { class: 'nl-pins' }, ...n.pins.map(pin)))),
        nl.unconnected.length ? h('div', { class: 'nl-net nl-unconnected' }, h('div', { class: 'nl-name' }, `Unconnected pins (${nl.unconnected.length})`), h('div', { class: 'nl-pins' }, ...nl.unconnected.map(pin))) : null));
  }

  // ---------------------------------------------------------------- commands

  _selectedSymbolIds() { return this.sheet.symbols.filter((y) => this.selection.has(y.id)).map((y) => y.id); }

  /** Every selectable item on the current Sheet. */
  _allIds() { return [...this.sheet.symbols.map((y) => y.id), ...this.sheet.wires.map((w) => w.id), ...(this.sheet.labels || []).map((l) => l.id), ...(this.sheet.noConnects || []).map((n) => n.id), ...(this.sheet.drawings || []).map((d) => d.id)]; }

  _selSig() { return `${this.sheet.id}|${[...this.selection].sort().join()}`; }

  /** Show the selection's Properties (the inspector card), until the selection changes or it's closed. */
  openProperties() {
    if (!this.selection.size) return;
    this.propsOpen = true;
    this._propsFor = this._selSig();
    this._avoidSig = null; // let it step aside from the selection again
    this.refresh();
  }

  closeProperties() { this.propsOpen = false; this._propsFor = null; this.refresh(); }

  /** The context strip: what's being placed, the label tool's options, or actions for the selection. */
  _updateStrip() {
    const s = this.strip;
    if (!s || !this.ws) return;
    if (this.placing) {
      const pl = this.placing;
      s.show(`place|${pl.part.name}|${pl.rot}|${pl.mirror}|${pl.unit ?? ''}`, () => [stripLabel(`Placing ${pl.part.units?.length > 1 ? this._placingName(pl) : pl.part.name}`, 'parts'), stripSep(),
        stripButton({ icon: 'rotate', title: `Rotate 90° (R) · now ${pl.rot}°`, onClick: () => { this.rotate(); this.refresh(); } }),
        stripButton({ icon: 'mirror', title: 'Mirror (X)', active: !!pl.mirror, onClick: () => { this.mirror(); this.refresh(); } }),
        stripSep(), stripButton({ icon: 'close', label: pl.drag ? 'Cancel' : 'Stop', title: 'Stop placing (Esc)', onClick: () => { this.endPlace(); this.refresh(); } })]);
      return;
    }
    if (LABEL_TOOLS[this.tool]) {
      s.show(`label|${this.tool}|${this.labelRot}`, () => [stripLabel(LABEL_TOOLS[this.tool].what, this.tool), stripSep(),
        stripButton({ icon: 'rotate', title: `Rotate 90° (R) · now ${this.labelRot}°`, onClick: () => { this.rotate(); this.refresh(); } })]);
      return;
    }
    if (this.tool !== 'select' || !this.selection.size) { s.hide(); return; }
    const sh = this.sheet, sel = this.selection;
    const n = (xs) => xs.filter((x) => sel.has(x.id)).length;
    const syms = n(sh.symbols), wires = n(sh.wires), labels = n(sh.labels || []), drawings = n(sh.drawings || []), ncs = n(sh.noConnects || []);
    const parts = [[syms, 'part'], [wires, 'wire'], [labels, 'label'], [drawings, 'drawing'], [ncs, 'no-connect']].filter(([k]) => k).map(([k, w]) => `${k} ${w}${k === 1 ? '' : 's'}`);
    let title = parts.join(', ');
    if (syms === 1 && sel.size === 1) { const y = sh.symbols.find((q) => sel.has(q.id)); title = this.project.components[y.componentId]?.ref || title; }
    // everything selected is a locked part: what would move it is greyed out
    const allLocked = syms > 0 && syms === sel.size && this._selSyms().every((y) => y.locked);
    s.show(`sel|${[...sel].sort().join()}|${this.propsOpen}|${this._selSyms().map((y) => !!y.locked).join()}`, () => [stripLabel(title, syms ? 'parts' : wires ? 'wire' : labels ? 'netLabel' : 'select'), stripSep(),
      syms || labels || drawings ? stripButton({ icon: 'rotate', title: allLocked ? 'Locked: unlock to rotate' : 'Rotate 90° (R)', disabled: allLocked, onClick: () => this.rotate() }) : null,
      syms ? stripButton({ icon: 'mirror', title: allLocked ? 'Locked: unlock to mirror' : 'Mirror (X)', disabled: allLocked, onClick: () => this.mirror() }) : null,
      syms ? stripButton({ icon: 'ltext', label: 'Fields', title: 'Field style for the selected parts', onClick: (e) => this.fieldsMenu(e.currentTarget) }) : null,
      syms ? (() => { const locked = this._selSyms().every((y) => y.locked); return stripButton({ icon: locked ? 'unlock' : 'lock', label: locked ? 'Unlock' : 'Lock', active: locked, title: `${locked ? 'Unlock' : 'Lock'}: a locked part doesn't move, rotate or mirror; its origin shows × instead of +`, onClick: () => this.lockSel() }); })() : null,
      stripSep(),
      stripButton({ icon: 'duplicate', title: 'Duplicate (Ctrl+D)', onClick: () => this.duplicate() }),
      stripButton({ icon: 'copy', title: 'Copy (Ctrl+C)', onClick: () => { this.copy(); this.refresh(); } }),
      stripButton({ icon: 'trash', title: 'Delete (Del)', danger: true, onClick: () => this.deleteSelection() }),
      stripSep(), stripProps({ open: this.propsOpen, onToggle: () => (this.propsOpen ? this.closeProperties() : this.openProperties()) })]);
  }

  _selSyms() { return this.sheet.symbols.filter((y) => this.selection.has(y.id)); }

  /**
   * Show the selection on the Board: its parts' footprints (or, for wires, their net's pads and
   * copper), selected there and zoomed to.
   */
  showOnBoard() {
    const comps = [...new Set(this._selSyms().map((y) => y.componentId))];
    const wireIds = new Set(this.sheet.wires.filter((w) => this.selection.has(w.id)).map((w) => w.id));
    const nets = comps.length ? [] : [...new Set(buildNetlist(this.project).nets.filter((n) => n.wires?.some((id) => wireIds.has(id))).map((n) => n.name))];
    const bed = this.app.workspace('board')?.editor;
    if (!bed) return;
    if (!bed.hasItems({ components: comps, nets })) { toast(comps.length ? `${comps.map((id) => this.project.components[id]?.ref).join(', ')} ${comps.length === 1 ? "isn't" : "aren't"} on the Board yet: Update from Schematic (F8) on the Board.` : 'That net has nothing on the Board yet.', 'info', 3200); return; }
    this.app.setWorkspace('board');
    // zoom once the Board's canvas has its size
    requestAnimationFrame(() => requestAnimationFrame(() => bed.showItems({ components: comps, nets })));
  }

  /** Are any of these parts or nets on the Schematic? */
  hasItems({ components = [], nets = [] }) {
    const comps = new Set(components), low = new Set(nets.map((n) => n.toLowerCase()));
    const wires = new Set(low.size ? buildNetlist(this.project).nets.filter((n) => low.has(n.name.toLowerCase())).flatMap((n) => n.wires || []) : []);
    return this.project.schematic.sheets.some((sh) => sh.symbols.some((y) => comps.has(y.componentId)) || sh.wires.some((w) => wires.has(w.id)));
  }

  /** Zoom to what's drawn on the current Sheet (an imported design is small on a big sheet). */
  fitContent() {
    const sh = this.sheet, ids = [...sh.symbols, ...sh.wires, ...(sh.labels || [])].map((x) => x.id);
    const b = ids.length && itemsBounds(this.project, sh, ids);
    if (!b || !this.ws) return false;
    this.ws.view.resize(); // a first show fits home on its first size: have that happen now, not after
    if (!this.ws.view.w) return false;
    const m = SCH_GRID * 6, v = this.ws.view;
    // leave the docked cards on the right clear
    const cr = v.canvas.getBoundingClientRect();
    const lefts = [...this.ws.el.querySelectorAll('.card')].map((c) => c.getBoundingClientRect()).filter((r) => r.width && r.left > cr.left + v.w / 2).map((r) => r.left - cr.left);
    const w = lefts.length && Math.min(...lefts) > 400 ? Math.min(...lefts) - 12 : v.w;
    v.view.fit({ x0: b.x0 - m, y0: b.y0 - m, x1: b.x1 + m, y1: b.y1 + m }, w, v.h, 20);
    this.refresh();
    return true;
  }

  /** Select these parts (by Component) or nets here, on the first Sheet that has them, and zoom to them. */
  showItems({ components = [], nets = [] }) {
    const comps = new Set(components), low = new Set(nets.map((n) => n.toLowerCase()));
    const nl = low.size ? buildNetlist(this.project).nets.filter((n) => low.has(n.name.toLowerCase())) : [];
    const wireIds = new Set(nl.flatMap((n) => n.wires || [])), labelIds = new Set(nl.flatMap((n) => n.labels || []));
    const sheet = this.project.schematic.sheets.find((sh) => sh.symbols.some((y) => comps.has(y.componentId)) || sh.wires.some((w) => wireIds.has(w.id)));
    if (!sheet) return false;
    if (sheet.id !== this.sheet.id) this.switchSheet(sheet.id);
    const ids = [...sheet.symbols.filter((y) => comps.has(y.componentId)).map((y) => y.id), ...sheet.wires.filter((w) => wireIds.has(w.id)).map((w) => w.id), ...(sheet.labels || []).filter((l) => labelIds.has(l.id)).map((l) => l.id)];
    this.selection = new Set(ids);
    const b = itemsBounds(this.project, sheet, ids);
    if (b && this.ws) {
      const m = SCH_GRID * 8, w = Math.max(b.x1 - b.x0, SCH_GRID * 20), hh = Math.max(b.y1 - b.y0, SCH_GRID * 14), cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
      this.ws.view.view.fit({ x0: cx - w / 2 - m, y0: cy - hh / 2 - m, x1: cx + w / 2 + m, y1: cy + hh / 2 + m }, this.ws.view.w, this.ws.view.h, 20);
    }
    this.refresh();
    return true;
  }

  /** Lock the selected parts (or unlock them when they all are). */
  lockSel() {
    const ys = this._selSyms();
    if (!ys.length) return;
    const lock = !ys.every((y) => y.locked);
    this.app.edit(lock ? 'Lock' : 'Unlock', (p) => setSymbolsLocked(p, ys.map((y) => y.id), lock));
  }

  /** Say so when some of the selection is locked and stayed put. */
  _lockedNote() {
    const n = this._selSyms().filter((y) => y.locked).length;
    if (n) toast(`${n === 1 ? 'A locked part stays' : `${n} locked parts stay`} as ${n === 1 ? 'it is' : 'they are'} (Unlock on the strip or the right-click menu).`, 'info', 2200);
  }

  rotate() {
    if (this.placing) { this.placing.rot = (this.placing.rot + 90) % 360; this.ws.view.invalidate(); return; }
    if (LABEL_TOOLS[this.tool]) { this.labelRot = (this.labelRot + 90) % 360; this.ws.view.invalidate(); return; }
    const ids = [...this._selectedSymbolIds(), ...(this.sheet.labels || []).filter((l) => this.selection.has(l.id)).map((l) => l.id), ...(this.sheet.drawings || []).filter((d) => this.selection.has(d.id)).map((d) => d.id)];
    if (!ids.length) return;
    this.app.edit('Rotate', (p) => rotateSymbols(p, ids));
    this._lockedNote();
  }

  mirror() {
    if (this.placing) { this.placing.mirror = !this.placing.mirror; this.ws.view.invalidate(); return; }
    const ids = this._selectedSymbolIds();
    if (!ids.length) return;
    this.app.edit('Mirror', (p) => mirrorSymbols(p, ids));
    this._lockedNote();
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

  /** The Parts card (the part picker): open or closed, remembered in this browser. */
  get partsOpen() { try { return localStorage.getItem('electrocad.partsOpen') !== '0'; } catch { return true; } }
  toggleParts(open = !(this.panel?.style.display !== 'none')) {
    if (!this.panel) return;
    this.panel.style.display = open ? '' : 'none';
    this.partsBtn?.classList.toggle('active', open);
    try { localStorage.setItem('electrocad.partsOpen', open ? '1' : '0'); } catch { /* private mode */ }
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
          button({ icon: 'settings', title: 'Sheet setup: paper size, grid and origin', cls: 'btn-ghost btn-xs', onClick: () => this.sheetSetup(s.id) }),
          button({ icon: 'ltext', title: 'Rename', cls: 'btn-ghost btn-xs', onClick: () => this.renameSheetInline(s.id) }),
          button({ icon: 'up', title: 'Move up', cls: 'btn-ghost btn-xs', disabled: i === 0, onClick: () => this.app.edit(`Move ${s.name} up`, (p) => moveSheet(p, s.id, -1)) }),
          button({ icon: 'down', title: 'Move down', cls: 'btn-ghost btn-xs', disabled: i === sheets.length - 1, onClick: () => this.app.edit(`Move ${s.name} down`, (p) => moveSheet(p, s.id, 1)) }),
          button({ icon: 'trash', title: sheets.length < 2 ? 'A project keeps at least one sheet' : 'Delete sheet', cls: 'btn-ghost btn-xs', disabled: sheets.length < 2, onClick: () => this.deleteSheet(s.id) })));
    };
    el.replaceChildren(
      cardHead({ icon: 'sheets', title: 'Sheets', sub: String(sheets.length), onClose: () => this.toggleSheets(false), closeTitle: 'Close (the Sheets button on the toolbar opens it again)' }),
      h('div', { class: 'fp-body' }, ...sheets.map(row),
        h('div', { class: 'sheets-add' }, button({ icon: 'plus', label: 'Add sheet', cls: 'btn-outline', onClick: () => this.addSheet() })),
        h('p', { class: 'side-note' }, 'Net labels join on their own sheet; Global labels and Power symbols join across sheets. The gear sets a sheet\'s paper size, grid and origin.')));
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
      const anchor = this.snapG([(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2]);
      delta = this.cursor ? [this.cursor[0] - anchor[0], this.cursor[1] - anchor[1]] : [this.sheet.grid.main * 4, this.sheet.grid.main * 4];
      if (!delta[0] && !delta[1]) delta = [this.sheet.grid.main * 4, this.sheet.grid.main * 4];
    }
    const ids = this.app.edit('Paste', (p) => pasteClip(p, this._S(p), clip, delta));
    this.selection = new Set(ids);
    this.refresh();
    this.keepClearOfCards(ids);
  }

  duplicate() {
    if (!this.selection.size) return;
    const saved = this.clipboard;
    this.clipboard = copySelection(this.project, this.sheet, [...this.selection]);
    this.paste([this.sheet.grid.main * 4, this.sheet.grid.main * 4]);
    this.clipboard = saved || this.clipboard;
  }

  nudge(dx, dy) {
    if (!this.selection.size) return;
    const ids = [...this.selection];
    this.app.edit('Move', (p) => { moveSelection(p, this._S(p), ids, [dx * this.sheet.grid.main, dy * this.sheet.grid.main]); cleanupWires(p, this._S(p)); });
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
    if (k === 'o') { this.setTool('origin'); return true; }
    if (this.tool === 'origin' && e.key === 'Escape') { this.setTool('select'); return true; }
    if (DRAW_TOOLS[this.tool]) {
      if (e.key === 'Escape') { if (this.tool === 'gline' && this.drawingPts?.length > 1) this._finishGline(); else if (this.drawingPts) { this.drawingPts = null; this.refresh(); } else this.setTool('select'); return true; }
      if (e.key === 'Enter' && this.tool === 'gline') { this._finishGline(); return true; }
    }
    for (const [id, t] of Object.entries(DRAW_TOOLS)) if (k === t.key) { this.setTool(id); return true; }
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

