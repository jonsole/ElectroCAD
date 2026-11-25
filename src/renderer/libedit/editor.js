// The Library tab (#13): the user's own Libraries and the Symbol editor. Layout per docs/UI.md:
// LIBRARIES (Libraries and Parts, with search), PART (name, prefix, Value, category, Units,
// Preferred footprints), PROPERTIES (the selected Pin or graphic); the canvas edits one Unit
// at a time (a bottom chip per Unit). It has its own undo history, separate from the Project's.
//
// The editor lives on the app and survives Project switches (the workspaces are rebuilt around
// each Project); attach() hooks it to the new canvas.
import { h, icon, button, popupMenu, toast, confirmDialog, promptDialog, modal } from '../ui/dom.js';
import { section } from '../workspaces/workspace.js';
import { History } from '../core/history.js';
import { SCH_GRID as G, mm } from '../core/units.js';
import { shapePoints, distToSegment2 } from '../core/geom.js';
import { newLibrary, newPart, addUnit, removeUnit, addPin, partProblems, savePart, renameLibrary, unitName, PIN_TYPES, PART_CATEGORIES, LibraryError } from '../core/library.js';
import { STARTER_LIBRARY } from '../library/starter.js';
import { drawUnit } from '../schematic/render.js';
import { shapeHandles, hitHandle, dragHandle, snapPoint } from '../core/handles.js';
import { drawHandles, drawSnapMark } from '../view/handles.js';
import { SCHEMATIC_GRIDS, DEFAULT_SCHEMATIC_GRID, gridLabel, setGridStep, snapToGrid } from '../core/grid.js';
import { watchAlt } from '../ui/grid.js';
import { GridCard } from '../ui/gridCard.js';
import { ContextStrip, stripLabel, stripSep, stripButton, stripProps } from '../ui/contextStrip.js';
import { CardSet } from '../ui/cards.js';
import { highlight, screenBox } from '../view/highlight.js';

const HALF = G / 2;
const snap = (v, step) => Math.round(v / step) * step;
const snapPt = ([x, y], step) => [snap(x, step), snap(y, step)];
const DIRS = { L: [-1, 0], R: [1, 0], U: [0, -1], D: [0, 1] };
const DIR_NAMES = { R: 'Right (pin on the left)', L: 'Left (pin on the right)', D: 'Down (pin on top)', U: 'Up (pin at the bottom)' };
const ROTATE_DIR = { R: 'U', U: 'L', L: 'D', D: 'R' };

/** The drawing tools: key, icon, title, how many clicks. */
export const LIB_TOOLS = {
  select: { icon: 'select', title: 'Select (V)', key: 'v' },
  pin: { icon: 'pin', title: 'Pin (P): click to add; it points into the body', key: 'p' },
  line: { icon: 'lline', title: 'Line (L): click points, double-click or Enter to finish', key: 'l' },
  rect: { icon: 'lrect', title: 'Rectangle (B): click two corners', key: 'b' },
  circle: { icon: 'lellipse', title: 'Circle (C): click the centre, then a point on the edge', key: 'c' },
  arc: { icon: 'arc', title: 'Arc (A): click the start, a point on the arc, then the end', key: 'a' },
  text: { icon: 'ltext', title: 'Text (T): click, then type', key: 't' },
  origin: { icon: 'target', title: 'Origin (O): click to make that point the Symbol\'s anchor (where it is placed from); the drawing moves, not the point', key: 'o' },
};

const LIB_GRID_KEY = 'electrocad.libGrid';
function loadLibGrid() {
  try { const g = JSON.parse(localStorage.getItem(LIB_GRID_KEY)); if (g && g.main > 0 && g.alt > 0) return g; } catch { /* none yet */ }
  return { ...DEFAULT_SCHEMATIC_GRID };
}

export class LibraryEditor {
  constructor(app) {
    this.app = app;
    this.ownHistory = true; // Ctrl+Z here undoes Part edits, not the Project
    this.draft = null;      // the Part being edited (a copy; saved explicitly)
    this.libId = null;      // the Library it is saved to
    this.saved = null;      // JSON of the last saved/opened draft, for the unsaved marker
    this.unit = 0;
    this.selection = new Set(); // 'pin:<i>' / 'g:<i>' in the current Unit
    this.tool = 'select';
    this.drawing = null;    // points clicked so far for line/rect/circle/arc
    this.query = '';
    this.grid = loadLibGrid(); // the Symbol editor's grids are a per-browser preference
    this.history = new History(() => this.draft, (d) => { this.draft = d; }, () => this.refresh());
  }

  get libraries() { return this.app.libraries; }
  get library() { return this.libraries.find((l) => l.id === this.libId) || null; }
  get unitObj() { return this.draft?.units[this.unit] || null; }
  /** The grid in use: the Alt grid while Alt is held. Pins snap to it, graphics to half of it. */
  get gridStep() { return this.alt ? this.grid.alt : this.grid.main; }

  /** The Library tab shows the Symbol editor (not the Footprint editor, #19). */
  get active() { return this.app.libMode !== 'footprint'; }

  setAlt(on) {
    if (!this.active || !!on === !!this.alt) return;
    this.alt = !!on;
    if (this.ws) { this.ws.view.grid = this.gridStep; this.ws.renderBar(); this.ws.view.invalidate(); }
  }

  setGrid(which, nm) {
    setGridStep(this.grid, which, nm);
    try { localStorage.setItem(LIB_GRID_KEY, JSON.stringify(this.grid)); } catch { /* private mode */ }
    this.refresh();
  }

  /** Snap onto a Pin tip, a graphic's handle or the origin within the Settings distance, else the grid. */
  snapAt(w, { step = this.gridStep, skip = null, not = null } = {}) {
    const u = this.unitObj, targets = [[0, 0]];
    if (u) {
      for (const p of u.pins) targets.push(p.at);
      u.graphics.forEach((g, i) => { if (i !== skip) for (const hd of shapeHandles(g)) targets.push(hd.at); });
    }
    const tol = this.app.snapDistance() / (this.ws?.view.view.scale || 1);
    const r = snapPoint(w, targets.filter((t) => !not || t[0] !== not[0] || t[1] !== not[1]), tol, (p) => snapToGrid(p, step));
    this.snapMark = r.target;
    return r.at;
  }

  /** Origin tool: shift the whole Part (every Unit) so the clicked point becomes its anchor. */
  placeOrigin(w) {
    const at = this.snapAt(w, { not: [0, 0] });
    this.snapMark = null;
    if (at[0] || at[1]) {
      this.edit('Move origin', (p) => { for (let i = 0; i < p.units.length; i++) moveItems(p.units[i], new Set([...p.units[i].pins.map((_, k) => `pin:${k}`), ...p.units[i].graphics.map((_, k) => `g:${k}`)]), [-at[0], -at[1]]); });
      // keep the drawing where it was on screen: the origin mark moves instead
      const v = this.ws.view.view;
      v.pan(-at[0] * v.scale, -at[1] * v.scale);
    }
    this.setTool('select');
  }

  get dirty() { return !!this.draft && JSON.stringify(this.draft) !== this.saved; }

  // ---------------------------------------------------------------- panels

  buildSide() {
    this.libSearch = h('input', { class: 'input', type: 'search', placeholder: 'Search libraries', 'aria-label': 'Search libraries' });
    this.libSearch.addEventListener('input', () => { this.query = this.libSearch.value; this.renderLibraries(); });
    this.libSearch.addEventListener('keydown', (e) => e.stopPropagation());
    this.libList = h('div', { class: 'lib-list', role: 'tree', 'aria-label': 'Libraries' });
    this.partEl = h('div', { class: 'lib-part' });
    this.propsEl = h('div', { class: 'lib-props' });
    // floating, dockable cards (toolbar buttons open them), like the Board's
    this.cards = new CardSet('library-symbol');
    this.cards.add({ id: 'libs', title: 'Libraries', icon: 'library', cls: 'lib-side', tip: 'Libraries: your Libraries and the built-in Parts', body: [
      h('div', { class: 'side-search lib-search' }, icon('search', 16), this.libSearch),
      this.libList,
      h('div', { class: 'lib-actions' }, button({ icon: 'plus', label: 'New library', cls: 'btn-outline', onClick: () => this.createLibrary() }))] });
    this.cards.add({ id: 'part', title: 'Part', icon: 'parts', cls: 'lib-side', tip: 'Part: name, prefix, Value, Units and Preferred footprints', body: [this.partEl] });
    this.cards.add({ id: 'props', title: 'Properties', icon: 'sliders', cls: 'lib-side', tip: 'Properties: the selected Pin or graphic', body: [this.propsEl], open: false, toolbar: false, onClose: () => { this._propsFor = null; } }).toggle(false); // opened by double-click or right-click → Properties…
    return this.cards;
  }

  toolbar() {
    this.btn = {
      undo: button({ icon: 'undo', title: 'Undo (Ctrl+Z)', onClick: () => this.undo() }),
      redo: button({ icon: 'redo', title: 'Redo (Ctrl+Shift+Z)', onClick: () => this.redo() }),
      newPart: button({ label: 'New part', icon: 'plus', title: 'A new Part in this Library', onClick: () => this.createPart() }),
      save: button({ label: 'Save', icon: 'check', cls: 'btn-primary', title: 'Save the Part to its Library (Ctrl+S)', onClick: () => this.save() }),
    };
    // delete and turn live on the context strip over the canvas
    this.strip = new ContextStrip('Selection actions', 'library');
    this.gridCard = new GridCard({
      key: 'library-grid', choices: SCHEMATIC_GRIDS,
      state: () => ({ grid: this.grid, origin: [0, 0], scope: 'Symbol editor', originEditable: false, originNote: 'The Symbol\'s anchor: pick a point and the Part moves so that point is the anchor.' }),
      onGrid: (which, nm) => this.setGrid(which, nm),
      onPick: () => { if (this.draft) this.setTool('origin'); },
    });
    return [this.btn.undo, this.btn.redo, h('span', { class: 'sep' }), this.gridCard.button, h('span', { class: 'sep' }), this.btn.newPart, this.btn.save];
  }

  tools() {
    this.toolBtn = {};
    for (const [id, t] of Object.entries(LIB_TOOLS)) this.toolBtn[id] = button({ icon: t.icon, title: t.title, onClick: () => this.setTool(id) });
    return [this.toolBtn.select, this.toolBtn.pin, null, this.toolBtn.line, this.toolBtn.rect, this.toolBtn.circle, this.toolBtn.arc, this.toolBtn.text, null, this.toolBtn.origin];
  }

  /** Bottom chips: one per Unit, and + to add one. */
  chips() {
    if (!this.draft) return [];
    return [...this.draft.units.map((u, i) => {
      const c = h('button', { class: 'chip text-chip' + (i === this.unit ? ' on' : ''), type: 'button', title: `Unit ${u.name} (${u.pins.length} pin${u.pins.length === 1 ? '' : 's'})`, dataset: { unit: String(i) }, onClick: () => this.setUnit(i) }, u.name);
      return c;
    }), h('button', { class: 'chip text-chip chip-add', type: 'button', title: 'Add a Unit (a copy of this one\'s body)', 'aria-label': 'Add unit', onClick: () => this.addUnit() }, '+')];
  }

  status() {
    if (!this.draft) return 'No Part open';
    const pins = this.draft.units.reduce((n, u) => n + u.pins.length, 0);
    return `${this.draft.name}${this.dirty ? ' (unsaved)' : ''} · ${this.library?.name || 'no library'} · ${pins} pin${pins === 1 ? '' : 's'} · ${this.draft.units.length > 1 ? `unit ${unitName(this.unit)} of ${this.draft.units.length} · ` : ''}grid ${gridLabel(this.gridStep)}${this.alt ? ' (Alt)' : ''}`;
  }

  renderLibraries() {
    const el = this.libList;
    if (!el) return;
    const q = this.query.trim().toLowerCase();
    const match = (p) => !q || `${p.name} ${p.keywords || ''} ${p.defaultValue || ''}`.toLowerCase().includes(q);
    const partRow = (lib, p, builtin) => h('button', {
      class: 'lib-row lib-part-row' + (!builtin && this.libId === lib.id && this.draft?.id === p.id ? ' on' : ''), type: 'button', role: 'treeitem', dataset: { part: p.id },
      title: builtin ? `${p.name}: open a copy to edit and save in your Library` : `Edit ${p.name} (v${p.origin?.version || 1})`,
      onClick: () => this.openPart(lib, p, builtin),
    }, h('span', { class: 'lib-part-name' }, p.name), p.units.length > 1 ? h('span', { class: 'lib-badge' }, `×${p.units.length}`) : null, builtin ? null : h('span', { class: 'lib-ver' }, `v${p.origin?.version || 1}`));
    const group = (lib, parts, builtin) => {
      const shown = parts.filter(match);
      if (q && !shown.length) return null;
      const head = h('div', { class: 'lib-row lib-head', role: 'treeitem' },
        icon(builtin ? 'library' : 'folder', 15), h('span', { class: 'lib-name' }, builtin ? 'Built-in (read-only)' : lib.name), h('span', { class: 'lib-count' }, String(parts.length)),
        builtin ? null : button({ icon: 'settings', title: `${lib.name}: rename, delete, new part`, cls: 'btn-ghost btn-xs', onClick: (e) => this.libraryMenu(lib, e.currentTarget) }));
      return h('div', { class: 'lib-group', dataset: { library: builtin ? 'builtin' : lib.id } }, head,
        ...shown.map((p) => partRow(lib, p, builtin)),
        !builtin && !parts.length ? h('div', { class: 'side-note lib-empty' }, 'No parts yet. Use New part above the canvas.') : '');
    };
    el.replaceChildren(
      ...this.libraries.map((l) => group(l, Object.values(l.parts).sort((a, b) => a.name.localeCompare(b.name)), false)).filter(Boolean),
      !this.libraries.length ? h('p', { class: 'side-note' }, 'No Libraries of your own yet. New library makes one; New part makes "My parts" for you.') : '',
      group({ id: 'builtin' }, STARTER_LIBRARY, true));
  }

  libraryMenu(lib, anchor) {
    popupMenu([
      { label: 'New part here', icon: 'plus', onClick: () => { this.libId = lib.id; this.createPart(); } },
      { label: 'Rename…', icon: 'pencil', onClick: () => this.renameLib(lib) },
      'sep',
      { label: 'Delete library…', icon: 'trash', onClick: () => this.deleteLib(lib) },
    ], anchor);
  }

  renderPart() {
    const el = this.partEl;
    if (!el) return;
    const d = this.draft;
    if (!d) { el.replaceChildren(h('p', { class: 'side-note' }, 'Select a Part in a Library, or New part, to edit its prefix, default Value, Units and Preferred footprints.')); return; }
    const text = (label, key, opts = {}) => {
      const input = h('input', { class: 'input', type: 'text', value: d[key] ?? '', 'aria-label': label, spellcheck: false, placeholder: opts.placeholder || '' });
      input.addEventListener('change', () => this.edit(`${label}`, (p) => { p[key] = input.value.trim(); }));
      input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') input.blur(); });
      return h('div', { class: opts.half ? 'param' : 'param param-wide' }, h('label', {}, label), input);
    };
    const cat = h('select', { class: 'select', 'aria-label': 'Category' }, ...PART_CATEGORIES.map((c) => h('option', { value: c }, c)));
    cat.value = d.category || 'Other';
    cat.addEventListener('change', () => this.edit('Category', (p) => { p.category = cat.value; }));
    const fps = Object.entries(d.footprints || {});
    const problems = partProblems(d);
    el.replaceChildren(
      text('Name', 'name'),
      h('div', { class: 'param-pair' }, text('Prefix', 'prefix', { half: true, placeholder: 'U' }), text('Value', 'defaultValue', { half: true })),
      h('div', { class: 'param param-wide' }, h('label', {}, 'Category'), cat),
      text('Manufacturer', 'manufacturer', { placeholder: 'Generic' }),
      text('Keywords', 'keywords', { placeholder: 'for the picker search' }),
      h('div', { class: 'param param-wide' }, h('label', {}, 'Units'),
        h('div', { class: 'lib-units' }, ...d.units.map((u, i) => h('button', { class: 'fp-chip' + (i === this.unit ? ' on' : ''), type: 'button', onClick: () => this.setUnit(i), title: `${u.pins.length} pins` }, u.name)),
          button({ icon: 'plus', title: 'Add a Unit', cls: 'btn-ghost btn-xs', onClick: () => this.addUnit() }),
          d.units.length > 1 ? button({ icon: 'trash', title: `Delete Unit ${unitName(this.unit)}`, cls: 'btn-ghost btn-xs', onClick: () => this.removeUnit() }) : null)),
      // pin text for this Unit (#79): sizes and the gap before a name, in mm; empty is the default
      (() => {
        const u = d.units[this.unit] || {};
        const mmIn = (key, label, placeholder, title) => {
          const inp = h('input', { class: 'input', type: 'number', step: '0.05', min: '0.2', value: u[key] ? String(+(u[key] / 1e6).toFixed(3)) : '', placeholder, 'aria-label': label, title });
          inp.addEventListener('keydown', (e) => e.stopPropagation());
          inp.addEventListener('change', () => this.edit(`Pin ${label.toLowerCase()}`, (p) => { const x = p.units[this.unit]; const v = Number(inp.value); if (inp.value === '' || !(v > 0)) delete x[key]; else x[key] = Math.round(v * 1e6); }));
          return h('label', { class: 'param' }, h('label', {}, label), inp);
        };
        return h('div', { class: 'param param-wide' }, h('label', {}, `Pin text (Unit ${unitName(this.unit)}, mm)`),
          h('div', { class: 'param-pair pin-text' },
            mmIn('pinNameSize', 'Name size', '1.0', 'Pin name height; empty for the default'),
            mmIn('pinNumberSize', 'Number size', '1.0', 'Pin number height; empty for the default'),
            mmIn('pinNameOffset', 'Name gap', '0.6', 'Gap between the inner end of a pin and its name')));
      })(),
      h('div', { class: 'param param-wide' }, h('label', {}, 'Preferred footprints'),
        h('div', { class: 'lib-fps' }, ...fps.map(([fpId, fp]) => h('span', { class: 'fp-chip lib-fp', title: fp.name }, fp.name.split('_')[0] === fp.name ? fp.name : fp.name.replace(/_\d+(\.\d+)?x.*$/, ''),
          h('button', { class: 'lib-fp-x', type: 'button', title: `Pin map: which pad each Pin goes to on ${fp.name}`, 'aria-label': `Pin map for ${fp.name}`, onClick: () => this.pinMapDialog(fpId) }, '⇄'),
          h('button', { class: 'lib-fp-x', type: 'button', title: `Remove ${fp.name}`, onClick: () => this.edit('Remove footprint', (p) => { delete p.footprints[fpId]; delete p.pinMap?.[fpId]; }) }, '×'))),
        button({ icon: 'plus', label: 'Add', cls: 'btn-outline btn-xs', title: 'Add a Preferred footprint (Pin n goes to Pad n)', onClick: (e) => this.addFootprintMenu(e.currentTarget) }))),
      problems.length
        ? h('div', { class: 'lib-problems', role: 'status' }, h('b', {}, 'Before it can be saved:'), h('ul', {}, ...problems.map((x) => h('li', {}, x))))
        : h('div', { class: 'lib-ok' }, this.dirty ? 'Ready to save.' : `Saved${this.draft.origin?.version ? ` (v${this.draft.origin.version})` : ''}.`));
  }

  /** Search every generated Footprint and add one as Preferred. */
  addFootprintMenu(anchor) {
    document.querySelectorAll('.fp-search-pop').forEach((x) => x.remove());
    // the user's own Library footprints first (tagged with their Library), then every built-in one
    const mine = this.libraries.flatMap((l) => Object.values(l.footprints || {}).map((f) => ({ ...f, _lib: l.name })));
    const all = [...mine, ...(this.app.workspace('schematic')?.editor?.allFootprints?.() || [])];
    const input = h('input', { class: 'input', type: 'search', placeholder: 'Search footprints, e.g. SOIC-8', 'aria-label': 'Search footprints', spellcheck: false });
    const list = h('div', { class: 'fp-search-list' });
    const pop = h('div', { class: 'fp-search-pop menu' }, input, list);
    const close = () => { pop.remove(); document.removeEventListener('pointerdown', outside, true); };
    const outside = (e) => { if (!pop.contains(e.target)) close(); };
    const render = () => {
      const words = input.value.toLowerCase().split(/\s+/).filter(Boolean);
      list.replaceChildren(...all.filter((f) => words.every((w) => f.name.toLowerCase().includes(w))).slice(0, 80).map((f) => {
        const b = h('button', { class: 'menu-item', type: 'button' }, h('span', { class: 'menu-label' }, f.name), f._lib ? h('span', { class: 'menu-hint' }, f._lib) : null);
        b.addEventListener('click', () => {
          const fpId = f.name.replace(/[^A-Za-z0-9]+/g, '_').slice(0, 40);
          const { _lib, ...fp } = f; void _lib;
          this.edit(`Add ${f.name}`, (p) => { p.footprints ||= {}; p.footprints[fpId] = structuredClone(fp); });
          close();
        });
        return b;
      }));
    };
    input.addEventListener('input', render);
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') close(); if (e.key === 'Enter') list.querySelector('.menu-item')?.click(); });
    document.body.append(pop);
    const r = anchor.getBoundingClientRect();
    Object.assign(pop.style, { left: `${Math.max(8, Math.min(r.left - 200, window.innerWidth - 340))}px`, top: `${Math.max(8, r.top - 330)}px` });
    render(); input.focus();
    setTimeout(() => document.addEventListener('pointerdown', outside, true));
  }

  /**
   * The Pin map of a Preferred footprint: for each Pin, the pad it goes to (default: the pad with
   * its number). Pads no Pin uses are listed, so a missing one shows.
   */
  pinMapDialog(fpId) {
    const d = this.draft, fp = d?.footprints?.[fpId];
    if (!fp) return;
    const m = modal({ title: `Pin map: ${fp.name}`, width: 460 });
    const pins = d.units.flatMap((u, ui) => u.pins.map((p) => ({ ...p, unit: ui })));
    const pads = [...new Set(fp.pads.map((p) => p.number))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const map = { ...(d.pinMap?.[fpId] || {}) };
    const rows = pins.map((p) => {
      const sel = h('select', { class: 'select', 'aria-label': `Pad for pin ${p.number}` }, h('option', { value: '' }, '(none)'), ...pads.map((n) => h('option', { value: n }, `Pad ${n}`)));
      sel.value = map[p.number] ?? (pads.includes(p.number) ? p.number : '');
      sel.addEventListener('change', () => { if (sel.value === p.number) delete map[p.number]; else map[p.number] = sel.value; note(); });
      return h('label', { class: 'le-row' }, h('span', {}, `Pin ${p.number}${p.name && p.name !== '~' ? ` (${p.name})` : ''}${d.units.length > 1 ? ` · ${unitName(p.unit)}` : ''}`), sel, h('em', {}, ''));
    });
    const unusedEl = h('p', { class: 'side-note' });
    const note = () => {
      const used = new Set(pins.map((p) => map[p.number] ?? p.number));
      const unused = pads.filter((n) => !used.has(n));
      unusedEl.textContent = unused.length ? `Pads no pin goes to: ${unused.join(', ')} (they get no net).` : 'Every pad has a pin.';
    };
    note();
    m.body.append(h('div', { class: 'pinmap-rows' }, ...rows), unusedEl,
      h('div', { class: 'modal-actions' }, button({ label: 'Cancel', cls: 'btn-outline', onClick: () => m.close() }),
        button({ label: 'Apply', cls: 'btn-primary', onClick: () => { this.edit(`Pin map ${fp.name}`, (p) => { p.pinMap ||= {}; const clean = Object.fromEntries(Object.entries(map).filter(([k, v]) => v && v !== k)); if (Object.keys(clean).length) p.pinMap[fpId] = clean; else delete p.pinMap[fpId]; }); m.close(); } })));
  }

  /** PROPERTIES: the selected Pin(s) or graphic. */
  renderProps() {
    const el = this.propsEl;
    if (!el) return;
    const u = this.unitObj;
    const sel = [...this.selection];
    if (!u || !sel.length) {
      el.replaceChildren(h('p', { class: 'side-note' }, this.draft ? 'Select a Pin or a graphic on the canvas. Pins snap to the grid, graphics to half of it (the Grid button on the toolbar sets both); hold Alt for the Alt grid. Keep Pins on 50 mil so they meet wires on the Schematic.' : 'Nothing selected.'));
      return;
    }
    const pins = sel.filter((s) => s.startsWith('pin:')).map((s) => +s.slice(4));
    const gs = sel.filter((s) => s.startsWith('g:')).map((s) => +s.slice(2));
    const rows = [];
    const field = (label, value, onCommit, attrs = {}) => {
      const input = h('input', { class: 'input', type: 'text', value: String(value ?? ''), 'aria-label': label, spellcheck: false, ...attrs });
      input.addEventListener('change', () => onCommit(input.value));
      input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') input.blur(); });
      return h('div', { class: 'param' }, h('label', {}, label), input);
    };
    const select = (label, value, options, onChange) => {
      const s = h('select', { class: 'select', 'aria-label': label }, ...options.map(([v, t]) => h('option', { value: v }, t)));
      s.value = value;
      s.addEventListener('change', () => onChange(s.value));
      return h('div', { class: 'param' }, h('label', {}, label), s);
    };
    if (pins.length === 1 && !gs.length) {
      const i = pins[0], p = u.pins[i];
      rows.push(h('div', { class: 'insp-note' }, `Pin ${p.number} of unit ${u.name}`),
        field('Number', p.number, (v) => this.edit('Pin number', (d) => { d.units[this.unit].pins[i].number = v.trim(); })),
        field('Name', p.name === '~' ? '' : p.name, (v) => this.edit('Pin name', (d) => { d.units[this.unit].pins[i].name = v.trim() || '~'; }), { placeholder: 'none' }),
        select('Points', p.dir, Object.entries(DIR_NAMES), (v) => this.edit('Pin direction', (d) => { d.units[this.unit].pins[i].dir = v; })),
        field('Length', +(p.length / G).toFixed(2), (v) => { const n = Number(v); if (n > 0) this.edit('Pin length', (d) => { d.units[this.unit].pins[i].length = Math.round(n * G); }); }, { 'aria-label': 'Length (grid steps)', title: 'In grid steps (50 mil)' }),
        select('Type', p.type, PIN_TYPES.map((t) => [t, t.replace('_', ' ')]), (v) => this.edit('Pin type', (d) => { d.units[this.unit].pins[i].type = v; })));
    } else if (pins.length > 1 && !gs.length) {
      rows.push(h('div', { class: 'insp-note' }, `${pins.length} pins`),
        select('Type', '', [['', 'Set type…'], ...PIN_TYPES.map((t) => [t, t.replace('_', ' ')])], (v) => v && this.edit('Pin type', (d) => { for (const i of pins) d.units[this.unit].pins[i].type = v; })));
    } else if (gs.length === 1 && !pins.length) {
      const i = gs[0], g = u.graphics[i];
      rows.push(h('div', { class: 'insp-note' }, { rect: 'Rectangle', line: 'Line', poly: 'Polygon', circle: 'Circle', arc: 'Arc', text: 'Text' }[g.type] || g.type));
      if (g.type === 'text') {
        rows.push(field('Text', g.text, (v) => v.trim() && this.edit('Text', (d) => { d.units[this.unit].graphics[i].text = v; })),
          field('Size', +(g.size / mm(1)).toFixed(2), (v) => { const n = Number(v); if (n > 0) this.edit('Text size', (d) => { d.units[this.unit].graphics[i].size = mm(n); }); }, { 'aria-label': 'Size (mm)' }));
      } else {
        if (g.type !== 'line' && g.type !== 'arc') rows.push(select('Fill', g.fill || 'none', [['none', 'None'], ['background', 'Body colour'], ['outline', 'Line colour']], (v) => this.edit('Fill', (d) => { d.units[this.unit].graphics[i].fill = v; })));
        rows.push(field('Width', g.width || 1, (v) => { const n = Number(v); if (n > 0) this.edit('Line width', (d) => { d.units[this.unit].graphics[i].width = n; }); }, { 'aria-label': 'Line width (× standard)' }));
      }
    } else rows.push(h('div', { class: 'insp-note' }, `${sel.length} items`));
    rows.push(h('div', { class: 'insp-btns' }, button({ icon: 'trash', label: 'Delete', cls: 'btn-outline', onClick: () => this.deleteSelection() })));
    el.replaceChildren(...rows);
  }

  // ---------------------------------------------------------------- refresh

  refresh() {
    if (this.draft && this.unit >= this.draft.units.length) this.unit = this.draft.units.length - 1;
    const u = this.unitObj;
    for (const s of [...this.selection]) {
      const [k, i] = s.split(':');
      if (!u || (k === 'pin' ? !u.pins[+i] : !u.graphics[+i])) this.selection.delete(s);
    }
    // the Properties card belongs to the selection it was opened for
    const pc = this.cards?.card('props');
    if (pc?.isOpen && (!this._propsFor || this._selSig() !== this._propsFor)) { pc.toggle(false); this._propsFor = null; }
    if (this.btn) {
      this.btn.undo.disabled = !this.history.canUndo;
      this.btn.redo.disabled = !this.history.canRedo;
      this.btn.save.disabled = !this.draft;
    }
    if (this.toolBtn) for (const [id, b] of Object.entries(this.toolBtn)) { b.classList.toggle('active', this.tool === id); b.disabled = !this.draft && id !== 'select'; }
    this.renderLibraries();
    this.renderPart();
    this.renderProps();
    this.gridCard?.render();
    this._updateStrip();
    if (!this.active) return;
    if (this.ws) { this.ws.view.grid = this.gridStep; this.ws.view.origin = [0, 0]; }
    this.ws?.renderBar();
    this._hint();
    this.ws?.view.invalidate();
  }

  _hint() {
    if (!this.ws) return;
    let t = 'Pick a Part in a Library on the right, or New part. Built-in parts open as a copy you can save in your own Library.';
    if (this.draft) {
      if (this.tool === 'pin') t = 'Pin: click a grid point to add a Pin (it points into the body; next free number). R turns the selected Pin. Esc back to Select.';
      else if (this.tool === 'line') t = this.drawing ? 'Line: click to add a point · double-click or Enter to finish · Esc cancel' : 'Line: click the first point';
      else if (this.tool === 'rect') t = this.drawing ? 'Rectangle: click the opposite corner' : 'Rectangle: click a corner';
      else if (this.tool === 'circle') t = this.drawing ? 'Circle: click a point on the edge' : 'Circle: click the centre';
      else if (this.tool === 'arc') t = !this.drawing ? 'Arc: click the start' : this.drawing.length === 1 ? 'Arc: click a point the arc passes through' : 'Arc: click the end';
      else if (this.tool === 'text') t = 'Text: click where the text goes, then type and press Enter';
      else if (this.tool === 'origin') t = 'Origin: click the point the Symbol should be placed from; the whole Part moves so that point is its anchor (it snaps onto Pin tips and handles) · Esc back to Select';
      else t = `Editing ${this.draft.name}${this.draft.units.length > 1 ? `, unit ${unitName(this.unit)}` : ''}: click to select, drag to move (Pins snap to 50 mil, graphics to 25 mil) · Del delete · R turn Pins · Ctrl+S save`;
    }
    this.ws.hint.textContent = t;
  }

  // ---------------------------------------------------------------- canvas

  attach(ws) {
    this.ws = ws;
    this.strip.mount(ws.view.el);
    const c = ws.view.canvas;
    const world = (e) => ws.view.view.toWorld(ws.view.local(e));
    // double-clicking a pin, pad or graphic opens its Properties
    c.addEventListener('dblclick', (e) => {
      if (!this.active || this.tool !== 'select' || !this.draft) return;
      const hit = this.hitTest(world(e), 5 / ws.view.view.scale);
      if (!hit) return;
      e.preventDefault();
      this.selection = new Set([hit]);
      this.openProperties();
    });
    watchAlt(ws, (on) => this.setAlt(on));
    this.gridCard.mount(ws);
    c.addEventListener('pointerdown', (e) => {
      if (!this.active || e.button !== 0 || !this.draft) return;
      const w = world(e);
      this.setAlt(e.altKey);
      if (this.tool === 'origin') { this.placeOrigin(w); return; }
      if (this.tool === 'select') {
        const handle = !e.shiftKey && this._handleAt(w, 5 / ws.view.view.scale);
        if (handle) {
          this.handleDrag = { ...handle, startPx: [e.clientX, e.clientY], snapshot: structuredClone(this.draft), moved: false };
          try { c.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
          return;
        }
        const hit = this.hitTest(w, 5 / ws.view.view.scale);
        if (e.shiftKey && hit) { if (this.selection.has(hit)) this.selection.delete(hit); else this.selection.add(hit); this.refresh(); return; }
        if (hit) {
          if (!this.selection.has(hit)) this.selection = new Set([hit]);
          this.drag = { start: w, startPx: [e.clientX, e.clientY], snapshot: structuredClone(this.draft), moved: false };
          c.setPointerCapture(e.pointerId);
        } else this.selection.clear();
        this.refresh();
        return;
      }
      if (this.tool === 'text') e.preventDefault(); // keep focus in the text box that opens
      this.toolClick(w, e.detail >= 2);
    });
    c.addEventListener('pointermove', (e) => {
      if (!this.active) return;
      const w = world(e);
      this.setAlt(e.altKey);
      this.cursor = w;
      this.snapMark = null;
      if (this.tool !== 'select' && this.draft) this.snapped = this.snapAt(w, { step: this.tool === 'pin' || this.tool === 'origin' ? this.gridStep : this.gridStep / 2 });
      if (this.handleDrag && (e.buttons & 1)) {
        const d = this.handleDrag;
        if (!d.moved && Math.hypot(e.clientX - d.startPx[0], e.clientY - d.startPx[1]) < 3) return;
        d.moved = true;
        this.draft = structuredClone(d.snapshot);
        const gs = this.draft.units[this.unit].graphics;
        const from = shapeHandles(d.snapshot.units[this.unit].graphics[d.index]).find((x) => x.key === d.key)?.at;
        gs[d.index] = dragHandle(gs[d.index], d.key, this.snapAt(w, { step: this.gridStep / 2, skip: d.index, not: from }));
        ws.view.invalidate();
        return;
      }
      if (this.tool === 'select' && !e.buttons) {
        const h = this._handleAt(w, 5 / ws.view.view.scale);
        if (h) { c.style.cursor = h.cursor; this._onHandle = true; } else if (this._onHandle) { c.style.cursor = ''; this._onHandle = false; }
      }
      if (this.drag && (e.buttons & 1)) {
        const d = this.drag;
        if (!d.moved && Math.hypot(e.clientX - d.startPx[0], e.clientY - d.startPx[1]) < 4) return;
        d.moved = true;
        const onlyGraphics = ![...this.selection].some((s) => s.startsWith('pin:'));
        const step = onlyGraphics ? this.gridStep / 2 : this.gridStep;
        const delta = [snap(w[0] - d.start[0], step), snap(w[1] - d.start[1], step)];
        this.draft = structuredClone(d.snapshot);
        moveItems(this.draft.units[this.unit], this.selection, delta);
        d.delta = delta;
        ws.view.invalidate();
      } else if (this.tool !== 'select') ws.view.invalidate();
    });
    c.addEventListener('pointerup', () => {
      if (!this.active) return;
      if (this.handleDrag) {
        const d = this.handleDrag; this.handleDrag = null;
        const g = this.draft.units[this.unit].graphics[d.index];
        this.draft = d.snapshot;
        if (d.moved && JSON.stringify(g) !== JSON.stringify(d.snapshot.units[this.unit].graphics[d.index])) this.edit('Resize', (p) => { p.units[this.unit].graphics[d.index] = g; });
        else this.refresh();
        return;
      }
      if (!this.drag) return;
      const d = this.drag; this.drag = null;
      const delta = d.delta;
      this.draft = d.snapshot;
      if (d.moved && delta && (delta[0] || delta[1])) this.edit('Move', (p) => moveItems(p.units[this.unit], this.selection, delta));
      else this.refresh();
    });
    this.refresh();
  }

  /** The one selected graphic (not text) shows resize handles. */
  _handleGraphic() {
    if (this.tool !== 'select' || this.selection.size !== 1 || this.drag?.moved) return null;
    const [k, i] = [...this.selection][0].split(':');
    const g = k === 'g' && this.unitObj?.graphics[+i];
    return g && g.type !== 'text' ? { g, index: +i } : null;
  }

  _handleAt(w, tol) {
    const sel = this._handleGraphic();
    const h = sel && hitHandle(sel.g, w, tol);
    return h ? { index: sel.index, key: h.key, cursor: h.cursor } : null;
  }

  /** What's under a point: a Pin (its tip or line) or a graphic; returns a selection key or null. */
  hitTest(w, tol) {
    const u = this.unitObj;
    if (!u) return null;
    for (let i = u.pins.length - 1; i >= 0; i--) {
      const p = u.pins[i], d = DIRS[p.dir] || [0, 0];
      const end = [p.at[0] + d[0] * p.length, p.at[1] + d[1] * p.length];
      if (distToSegment2(w, p.at, end) <= (tol + mm(0.3)) ** 2) return `pin:${i}`;
    }
    for (let i = u.graphics.length - 1; i >= 0; i--) {
      const g = u.graphics[i];
      const pts = shapePoints(g);
      if (g.type === 'line' || g.type === 'poly') {
        for (let k = 1; k < g.pts.length; k++) if (distToSegment2(w, g.pts[k - 1], g.pts[k]) <= tol * tol) return `g:${i}`;
        continue;
      }
      if (g.type === 'circle') { const r = Math.hypot(w[0] - g.c[0], w[1] - g.c[1]); if (Math.abs(r - g.r) <= tol || (g.fill && g.fill !== 'none' && r < g.r)) return `g:${i}`; continue; }
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      const box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      const inside = w[0] >= box[0] - tol && w[0] <= box[2] + tol && w[1] >= box[1] - tol && w[1] <= box[3] + tol;
      if (!inside) continue;
      if (g.type === 'rect' && (!g.fill || g.fill === 'none')) {
        const nearEdge = [box[0], box[2]].some((x) => Math.abs(w[0] - x) <= tol) || [box[1], box[3]].some((y) => Math.abs(w[1] - y) <= tol);
        if (!nearEdge) continue;
      }
      return `g:${i}`;
    }
    return null;
  }

  toolClick(w, dbl) {
    const t = this.tool;
    if (t === 'pin') {
      const at = this.snapAt(w);
      const idx = this.unitObj.pins.length;
      this.edit('Add pin', (p) => addPin(p, this.unit, at));
      this.selection = new Set([`pin:${idx}`]);
      this.refresh();
      return;
    }
    const p = this.snapAt(w, { step: this.gridStep / 2 });
    this.snapMark = null;
    if (t === 'text') { this.textAt(p); return; }
    const pts = this.drawing || [];
    if (t === 'line') {
      if (dbl || (pts.length && pts[pts.length - 1][0] === p[0] && pts[pts.length - 1][1] === p[1])) { this.finishLine(); return; }
      this.drawing = [...pts, p];
    } else if (t === 'rect' && pts.length === 1) { if (p[0] !== pts[0][0] && p[1] !== pts[0][1]) this.addGraphic('Rectangle', { type: 'rect', a: pts[0], b: p, fill: 'background' }); this.drawing = null; }
    else if (t === 'circle' && pts.length === 1) { const r = Math.round(Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1])); if (r) this.addGraphic('Circle', { type: 'circle', c: pts[0], r, fill: 'none' }); this.drawing = null; }
    else if (t === 'arc' && pts.length === 2) { this.addGraphic('Arc', { type: 'arc', start: pts[0], mid: pts[1], end: p }); this.drawing = null; }
    else this.drawing = [...pts, p];
    this.refresh();
  }

  finishLine() {
    const pts = this.drawing || [];
    this.drawing = null;
    if (pts.length >= 2) this.addGraphic('Line', { type: 'line', pts });
    else this.refresh();
  }

  addGraphic(label, g) {
    const idx = this.unitObj.graphics.length;
    this.edit(label, (p) => { p.units[this.unit].graphics.push(g); });
    this.selection = new Set([`g:${idx}`]);
    this.refresh();
  }

  /** Text tool: a box over the canvas; Enter adds the text. */
  textAt(at) {
    const v = this.ws.view.view;
    const [x, y] = v.toScreen(at);
    const input = h('input', { class: 'field-edit', type: 'text', placeholder: 'Text', 'aria-label': 'Text', spellcheck: false });
    Object.assign(input.style, { left: `${x - 70}px`, top: `${y - 14}px`, width: '140px', height: '28px', fontSize: '13px' });
    let done = false;
    const close = () => { done = true; input.remove(); this.ws.view.canvas.focus({ preventScroll: true }); };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { const t = input.value.trim(); close(); if (t) this.addGraphic('Text', { type: 'text', at, text: t, size: mm(1.27) }); }
      else if (e.key === 'Escape') close();
    });
    input.addEventListener('blur', () => { if (!done) { const t = input.value.trim(); close(); if (t) this.addGraphic('Text', { type: 'text', at, text: t, size: mm(1.27) }); } });
    this.ws.view.el.append(input);
    input.focus();
  }

  draw(ctx, view, C) {
    const toScreen = (p) => view.toScreen(p);
    // the origin (where the Symbol is placed from) is drawn by the canvas, as in every workspace
    if (!this.draft) return;
    const part = this.draft, u = this.unitObj;
    drawUnit(ctx, toScreen, view.scale, part, this.unit, { at: [0, 0], rot: 0, mirror: false }, null, C, {});
    // the selection, highlighted in the style chosen in Settings (the same in every editor)
    if (this.selection.size) {
      const boxes = [];
      const only = { pins: [], graphics: [] };
      for (const sel of this.selection) {
        const [k, i] = sel.split(':');
        let pts;
        if (k === 'pin') { const p = u.pins[+i]; if (!p) continue; only.pins.push(p); const d = DIRS[p.dir] || [0, 0]; pts = [p.at, [p.at[0] + d[0] * p.length, p.at[1] + d[1] * p.length]]; }
        else { const g = u.graphics[+i]; if (!g) continue; only.graphics.push(g); pts = shapePoints(g); }
        if (!pts.length) continue;
        const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
        boxes.push(screenBox(view, { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }));
      }
      const sub = { ...part, units: part.units.map((x, i) => (i === this.unit ? { ...x, pins: only.pins, graphics: only.graphics } : x)) };
      highlight(ctx, C, this.app.highlightStyle(), (c, Cx) => drawUnit(c, toScreen, view.scale, sub, this.unit, { at: [0, 0], rot: 0, mirror: false }, null, Cx, {}), boxes);
    }
    const hg = this._handleGraphic();
    if (hg) drawHandles(ctx, view, C, shapeHandles(hg.g), this.handleDrag?.key);
    drawSnapMark(ctx, view, C, this.snapMark);
    // a shape being drawn, to the cursor
    if (this.drawing && this.cursor) {
      const cur = this.snapped || this.cursor;
      const pts = [...this.drawing, cur].map(toScreen);
      ctx.save(); ctx.strokeStyle = C.selection; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.8; ctx.beginPath();
      if (this.tool === 'rect') { const [a, b] = pts; ctx.rect(a[0], a[1], b[0] - a[0], b[1] - a[1]); }
      else if (this.tool === 'circle') { const [a, b] = pts; ctx.arc(a[0], a[1], Math.hypot(b[0] - a[0], b[1] - a[1]), 0, Math.PI * 2); }
      else pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke(); ctx.restore();
    }
    // the Pin tool's ghost
    if (this.tool === 'pin' && this.cursor) {
      const at = this.snapped || snapPt(this.cursor, G);
      const ghost = { ...part, units: part.units.map((x, i) => (i === this.unit ? { ...x, graphics: [], pins: [{ number: '?', name: '~', at, dir: pinDirLocal(at), length: 2 * G, type: 'passive' }] } : x)) };
      drawUnit(ctx, toScreen, view.scale, ghost, this.unit, { at: [0, 0], rot: 0, mirror: false }, null, C, { alpha: 0.5 });
    }
  }

  // ---------------------------------------------------------------- commands

  edit(label, fn) {
    if (!this.draft) return null;
    return this.history.transact(label, fn);
  }
  undo() { this.history.undo(); }
  redo() { this.history.redo(); }

  setTool(t) {
    if (!LIB_TOOLS[t]) return;
    if (this.tool === 'line' && this.drawing) this.finishLine();
    this.tool = t; this.drawing = null;
    if (t !== 'select') this.selection.clear();
    if (this.ws) this.ws.view.canvas.style.cursor = t === 'select' ? '' : 'crosshair';
    this.refresh();
  }

  setUnit(i) {
    if (!this.draft || !this.draft.units[i]) return;
    this.unit = i; this.selection.clear(); this.drawing = null;
    this.refresh();
  }

  addUnit() {
    if (!this.draft) return;
    const from = this.unit;
    const i = this.edit('Add unit', (p) => addUnit(p, from));
    this.setUnit(i);
  }

  removeUnit() {
    if (!this.draft || this.draft.units.length < 2) return;
    const i = this.unit;
    this.edit(`Delete unit ${unitName(i)}`, (p) => removeUnit(p, i));
    this.setUnit(Math.max(0, i - 1));
  }

  _selSig() { return [...this.selection].sort().join(); }

  /** Show the selection's Properties card, until the selection changes or it's closed. */
  openProperties() {
    if (!this.selection.size) return;
    this._propsFor = this._selSig();
    this.cards.card('props').toggle(true);
    this.refresh();
  }

  closeProperties() { this._propsFor = null; this.cards.card('props').toggle(false); this.refresh(); }

  /** Right-click: select what's under the pointer and offer what applies to it. */
  contextMenu(e) {
    if (!this.active || !this.draft) return;
    if (this.tool !== 'select') { this.setTool('select'); return; }
    const v = this.ws.view, w = v.view.toWorld(v.local(e));
    const hit = this.hitTest(w, 5 / v.view.scale);
    if (hit && !this.selection.has(hit)) this.selection = new Set([hit]);
    if (!hit) this.selection.clear();
    this.refresh();
    const at = { x: e.clientX, y: e.clientY };
    if (!hit) { popupMenu([{ label: 'Fit in view', icon: 'fit', shortcut: 'Home', onClick: () => v.fitHome() }], at); return; }
    const turn = [...this.selection].some((x) => x.startsWith('pin:'));
    popupMenu([{ label: 'Properties…', icon: 'sliders', shortcut: 'Double-click', onClick: () => this.openProperties() }, 'sep',
      turn ? { label: 'Turn', icon: 'rotate', shortcut: 'R', onClick: () => this.rotatePins() } : null,
      { label: 'Delete', icon: 'trash', shortcut: 'Del', onClick: () => this.deleteSelection() }], at);
  }

  /** The context strip: actions for the selection (only while this editor is the one shown). */
  _updateStrip() {
    const s = this.strip;
    if (!s || !this.ws) return;
    if (!this.active || this.tool !== 'select' || !this.selection.size) { s.hide(); return; }
    const sel = [...this.selection];
    const nK = sel.filter((x) => x.startsWith('pin:')).length, nG = sel.length - nK;
    const what = [[nK, 'pin'], [nG, 'shape']].filter(([k]) => k).map(([k, w]) => `${k} ${w}${k === 1 ? '' : 's'}`).join(', ');
    s.show(`sel|${sel.sort().join()}|${!!this.cards?.card('props')?.isOpen}`, () => [stripLabel(what, nK ? 'pin' : 'select'), stripSep(),
      nK ? stripButton({ icon: 'rotate', title: 'Turn the selected pins (R)', onClick: () => this.rotatePins() }) : null,
      stripButton({ icon: 'trash', title: 'Delete (Del)', danger: true, onClick: () => this.deleteSelection() }),
      stripSep(), stripProps({ open: !!this.cards?.card('props')?.isOpen, onToggle: () => (this.cards.card('props').isOpen ? this.closeProperties() : this.openProperties()) })]);
  }

  deleteSelection() {
    if (!this.selection.size) return;
    const sel = [...this.selection];
    this.edit('Delete', (p) => {
      const u = p.units[this.unit];
      const pins = new Set(sel.filter((s) => s.startsWith('pin:')).map((s) => +s.slice(4)));
      const gs = new Set(sel.filter((s) => s.startsWith('g:')).map((s) => +s.slice(2)));
      u.pins = u.pins.filter((_, i) => !pins.has(i));
      u.graphics = u.graphics.filter((_, i) => !gs.has(i));
    });
    this.selection.clear();
    this.refresh();
  }

  rotatePins() {
    const pins = [...this.selection].filter((s) => s.startsWith('pin:')).map((s) => +s.slice(4));
    if (!pins.length) return;
    this.edit('Turn pins', (p) => { for (const i of pins) { const pin = p.units[this.unit].pins[i]; pin.dir = ROTATE_DIR[pin.dir] || 'R'; } });
  }

  /** Open a Part: a user Library's Part to edit, or a built-in one as a copy to save in a Library. */
  async openPart(lib, part, builtin = false) {
    if (!(await this._confirmDiscard())) return;
    let draft = structuredClone(part);
    if (builtin) {
      const target = this.libraries[0] || await this._ensureLibrary();
      if (!target) return;
      draft = { ...draft, id: newPart(target, part.name).id, origin: { library: target.id, partId: '', version: 0 } };
      draft.origin.partId = draft.id;
      this.libId = target.id;
      this.saved = null;
      toast(`Opened a copy of ${part.name}; Save puts it in ${target.name}.`, 'info', 3500);
    } else { this.libId = lib.id; this.saved = JSON.stringify(draft); }
    this.draft = draft;
    this.unit = 0; this.selection.clear(); this.drawing = null; this.history.clear();
    if (builtin) this.saved = null;
    this.refresh();
    this.ws?.view.fitHome?.();
  }

  async createPart() {
    if (!(await this._confirmDiscard())) return;
    const lib = this.library || this.libraries[0] || await this._ensureLibrary();
    if (!lib) return;
    this.libId = lib.id;
    this.draft = newPart(lib, 'New part');
    this.saved = null;
    this.unit = 0; this.selection.clear(); this.history.clear();
    this.setTool('pin');
  }

  async _ensureLibrary() {
    const lib = newLibrary('My parts', this.libraries.map((l) => l.id));
    await this.app.saveLibrary(lib);
    this.libId = lib.id;
    return lib;
  }

  async createLibrary() {
    const name = await promptDialog('New library', 'Name', 'My parts');
    if (!name || !name.trim()) return;
    const lib = newLibrary(name, this.libraries.map((l) => l.id));
    await this.app.saveLibrary(lib);
    this.libId = lib.id;
    this.refresh();
  }

  async renameLib(lib) {
    const name = await promptDialog('Rename library', 'Name', lib.name);
    if (!name) return;
    try { renameLibrary(lib, name); } catch (e) { toast(e.message, 'warn'); return; }
    await this.app.saveLibrary(lib);
    this.refresh();
  }

  async deleteLib(lib) {
    const n = Object.keys(lib.parts).length;
    const ok = await confirmDialog(`Delete ${lib.name}?`, `${n ? `Its ${n} part${n === 1 ? '' : 's'} will be gone from the picker. ` : ''}Projects that already use them keep their own copies.`, 'Delete', true);
    if (!ok) return;
    await this.app.deleteLibrary(lib.id);
    if (this.libId === lib.id) { this.draft = null; this.libId = null; this.history.clear(); }
    this.refresh();
  }

  /** Save the draft to its Library (refused, with the reasons, while it has problems). */
  async save() {
    if (!this.draft) return false;
    const lib = this.library || await this._ensureLibrary();
    let stored;
    try { stored = savePart(lib, this.draft); } catch (e) {
      if (e instanceof LibraryError) { toast(e.message.split('\n')[0] + ' See the Part section.', 'warn', 4000); this.renderPart(); return false; }
      throw e;
    }
    await this.app.saveLibrary(lib);
    this.draft = structuredClone(stored);
    this.saved = JSON.stringify(this.draft);
    toast(`Saved ${stored.name} (v${stored.origin.version}) to ${lib.name}. It's in the Schematic's part picker.`, 'info', 3500);
    this.refresh();
    return true;
  }

  async _confirmDiscard() {
    if (!this.dirty) return true;
    return confirmDialog(`Discard changes to ${this.draft.name}?`, 'The Part has changes that are not saved to its Library.', 'Discard', true);
  }

  onModKey(e) {
    if (e.key.toLowerCase() === 's') { this.save(); return true; }
    return false;
  }

  onKey(e) {
    const k = e.key.toLowerCase();
    if (e.key === 'Escape') {
      if (this.drawing) { if (this.tool === 'line' && this.drawing.length > 1) this.finishLine(); else { this.drawing = null; this.refresh(); } }
      else if (this.tool !== 'select') this.setTool('select');
      else if (this.selection.size) { this.selection.clear(); this.refresh(); }
      return true;
    }
    if (e.key === 'Enter' && this.tool === 'line' && this.drawing) { this.finishLine(); return true; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.selection.size) { this.deleteSelection(); return true; }
    if (k === 'r') { this.rotatePins(); return true; }
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (arrows[e.key] && this.selection.size) {
      const step = [...this.selection].some((s) => s.startsWith('pin:')) ? this.grid.main : this.grid.main / 2;
      const [dx, dy] = arrows[e.key];
      this.edit('Move', (p) => moveItems(p.units[this.unit], this.selection, [dx * step, dy * step]));
      return true;
    }
    for (const [id, t] of Object.entries(LIB_TOOLS)) if (k === t.key && this.draft) { this.setTool(id); return true; }
    return false;
  }
}

/** Which way a Pin at `at` points into the body (as core/library pinDirToward). */
function pinDirLocal([x, y]) {
  if (Math.abs(x) >= Math.abs(y)) return x <= 0 ? 'R' : 'L';
  return y <= 0 ? 'D' : 'U';
}

/** Move the selected Pins and graphics of a Unit by `delta`. */
export function moveItems(unit, selection, [dx, dy]) {
  const mv = ([x, y]) => [x + dx, y + dy];
  for (const s of selection) {
    const [k, i] = s.split(':');
    if (k === 'pin') { const p = unit.pins[+i]; if (p) p.at = mv(p.at); continue; }
    const g = unit.graphics[+i];
    if (!g) continue;
    for (const key of ['a', 'b', 'c', 'at', 'start', 'mid', 'end']) if (g[key]) g[key] = mv(g[key]);
    if (g.pts) g.pts = g.pts.map(mv);
  }
}
