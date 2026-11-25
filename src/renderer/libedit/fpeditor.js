// The Footprint editor (#19): the Library tab with the toolbar's Symbol | Footprint switch on
// Footprint. Pads (rect, roundrect, circle, oval; SMD or through-hole with a drill), and
// silkscreen, courtyard and fab graphics (lines, rectangles, circles, arcs, text with ${REF} and
// ${VALUE}); one bottom chip per layer (the active layer for new graphics). A Generator… makes
// standard packages from parameters with a live preview. Footprints save into the user's
// Libraries; the Symbol editor's PART section attaches them to Parts as Preferred footprints.
// It has its own undo history, like the Symbol editor, and draws in the Board's colours.
import { h, icon, button, popupMenu, toast, confirmDialog, promptDialog, modal } from '../ui/dom.js';
import { section } from '../workspaces/workspace.js';
import { History } from '../core/history.js';
import { mm } from '../core/units.js';
import { newLibrary, newFootprint, footprintProblems, saveFootprint, renameLibrary, SMD_LAYERS, THT_LAYERS, FOOTPRINT_LAYERS, PAD_SHAPES, LibraryError } from '../core/library.js';
import { BOARD_GRIDS, gridLabel, setGridStep, snapToGrid } from '../core/grid.js';
import { shapeHandles, hitHandle, dragHandle, snapPoint } from '../core/handles.js';
import { arcCircle, distToSegment2 } from '../core/geom.js';
import { allFootprints } from '../library/footprints.js';
import { GENERATORS, generatorDefaults, generatorById } from '../library/generators.js';
import { drawFootprintGraphics, drawPad } from '../board/render.js';
import { drawFootprintPreview } from '../schematic/render.js';
import { drawHandles, drawSnapMark } from '../view/handles.js';
import { highlight, screenBox } from '../view/highlight.js';
import { watchAlt } from '../ui/grid.js';
import { GridCard } from '../ui/gridCard.js';
import { ContextStrip, stripLabel, stripSep, stripButton, stripProps, stripNumber, stripSelect } from '../ui/contextStrip.js';
import { CardSet } from '../ui/cards.js';

export const FP_TOOLS = {
  select: { icon: 'select', title: 'Select (V)', key: 'v' },
  pad: { icon: 'pad', title: 'Pad (P): click to add; the next number. Shape, size and SMD / through-hole in Properties', key: 'p' },
  line: { icon: 'lline', title: 'Line (L) on the active layer: click points, double-click or Enter to finish', key: 'l' },
  rect: { icon: 'lrect', title: 'Rectangle (B) on the active layer: click two corners', key: 'b' },
  circle: { icon: 'lellipse', title: 'Circle (C) on the active layer: the centre, then the edge', key: 'c' },
  arc: { icon: 'arc', title: 'Arc (A) on the active layer: the start, a point on it, the end', key: 'a' },
  text: { icon: 'ltext', title: 'Text (T) on the active layer: ${REF} and ${VALUE} show the part\'s Reference and Value', key: 't' },
};

const LAYERS = ['F.Cu', ...FOOTPRINT_LAYERS]; // F.Cu: pads
const LAYER_NAMES = { 'F.Cu': 'Pads', 'F.SilkS': 'Silk', 'F.CrtYd': 'Courtyard', 'F.Fab': 'Fab' };
const GRID_KEY = 'electrocad.fpGrid';
const fmt = (nm) => String(+(nm / 1e6).toFixed(4));
const loadGrid = () => { try { const g = JSON.parse(localStorage.getItem(GRID_KEY)); if (g?.main > 0 && g?.alt > 0) return g; } catch { /* none */ } return { main: mm(0.05), alt: mm(0.01) }; };

export class FootprintEditor {
  constructor(app) {
    this.app = app;
    this.ownHistory = true;
    this.draft = null;     // the Footprint being edited (a copy; saved explicitly)
    this.libId = null;     // the Library it is saved to, and its id there (null: not saved yet)
    this.fpId = null;
    this.saved = null;
    this.tool = 'select';
    this.selection = new Set(); // 'pad:<i>' / 'g:<i>'
    this.activeLayer = 'F.SilkS';
    this.drawing = null;
    this.query = '';
    this.grid = loadGrid();
    this.padTpl = { shape: 'roundrect', w: mm(1.5), h: mm(0.6), tht: false, drill: mm(0.8) }; // the next pad
    this.history = new History(() => this.draft, (d) => { this.draft = d; }, () => this.refresh());
  }

  get libraries() { return this.app.libraries; }
  get library() { return this.libraries.find((l) => l.id === this.libId) || null; }
  get dirty() { return !!this.draft && JSON.stringify(this.draft) !== this.saved; }
  get gridStep() { return this.alt ? this.grid.alt : this.grid.main; }
  get active() { return this.app.libMode === 'footprint'; }

  // ---------------------------------------------------------------- panels

  toolbar() {
    this.btn = {
      undo: button({ icon: 'undo', title: 'Undo (Ctrl+Z)', onClick: () => this.undo() }),
      redo: button({ icon: 'redo', title: 'Redo (Ctrl+Shift+Z)', onClick: () => this.redo() }),
      gen: button({ label: 'Generator…', icon: 'wand', title: 'Make a standard package from parameters (chip, SOIC, pin header, DIP)', onClick: () => this.generator() }),
      newFp: button({ label: 'New footprint', icon: 'plus', title: 'An empty footprint', onClick: () => this.createFootprint() }),
      save: button({ label: 'Save', icon: 'check', cls: 'btn-primary', title: 'Save the footprint to its Library (Ctrl+S)', onClick: () => this.save() }),
    };
    // delete and turn live on the context strip over the canvas
    this.strip = new ContextStrip('Selection actions', 'library');
    this.gridCard = new GridCard({
      key: 'footprint-grid', choices: BOARD_GRIDS,
      state: () => ({ grid: this.grid, origin: [0, 0], scope: 'Footprint editor', originEditable: false, originNote: 'The footprint\'s origin is where the board places it from.' }),
      onGrid: (which, nm) => { setGridStep(this.grid, which, nm); try { localStorage.setItem(GRID_KEY, JSON.stringify(this.grid)); } catch { /* private */ } this.refresh(); },
    });
    return [this.btn.undo, this.btn.redo, h('span', { class: 'sep' }), this.gridCard.button, h('span', { class: 'sep' }), this.btn.gen, this.btn.newFp, this.btn.save];
  }

  tools() {
    this.toolBtn = {};
    for (const [id, t] of Object.entries(FP_TOOLS)) this.toolBtn[id] = button({ icon: t.icon, title: t.title, onClick: () => this.setTool(id) });
    const T = this.toolBtn;
    return [T.select, T.pad, null, T.line, T.rect, T.circle, T.arc, T.text];
  }

  buildSide() {
    this.search = h('input', { class: 'input', type: 'search', placeholder: 'Search footprints', 'aria-label': 'Search footprints' });
    this.search.addEventListener('input', () => { this.query = this.search.value; this.renderList(); });
    this.search.addEventListener('keydown', (e) => e.stopPropagation());
    this.listEl = h('div', { class: 'lib-list', role: 'tree', 'aria-label': 'Footprints' });
    this.fpEl = h('div', { class: 'lib-part' });
    this.propsEl = h('div', { class: 'lib-props' });
    this.cards = new CardSet('library-footprint');
    this.cards.add({ id: 'list', title: 'Footprints', icon: 'library', cls: 'lib-side', tip: 'Footprints: your Libraries\' and the built-in ones', body: [h('div', { class: 'side-search lib-search' }, icon('search', 16), this.search), this.listEl] });
    this.cards.add({ id: 'fp', title: 'Footprint', icon: 'pad', cls: 'lib-side', tip: 'Footprint: name, Library and problems', body: [this.fpEl] });
    this.cards.add({ id: 'props', title: 'Properties', icon: 'sliders', cls: 'lib-side', tip: 'Properties: the selected pad or graphic, or the next pad', body: [this.propsEl], open: false, toolbar: false, onClose: () => { this._propsFor = null; } }).toggle(false); // opened by double-click or right-click → Properties…
    return this.cards;
  }

  chips() {
    const C = this.app.canvasColors('board');
    return LAYERS.map((l) => h('button', {
      class: 'chip' + (l === this.activeLayer ? ' on' : ''), type: 'button', style: { background: C[l] || '#888' }, dataset: { layer: l },
      title: l === 'F.Cu' ? 'Pads (F.Cu; through-hole pads are on every copper layer)' : `${l}: new graphics go here (click to make it the active layer)`,
      onClick: () => { if (l !== 'F.Cu') { this.activeLayer = l; this.refresh(); } else this.setTool('pad'); },
    }, LAYER_NAMES[l]));
  }

  status() {
    if (!this.draft) return 'No footprint open';
    return `${this.draft.name}${this.dirty ? ' (unsaved)' : ''} · ${this.library?.name || 'not saved'} · ${this.draft.pads.length} pad${this.draft.pads.length === 1 ? '' : 's'} · layer ${this.activeLayer} · grid ${gridLabel(this.gridStep)}${this.alt ? ' (Alt)' : ''}`;
  }

  renderList() {
    const el = this.listEl;
    if (!el) return;
    const q = this.query.trim().toLowerCase();
    const row = (lib, id, fp, builtin) => h('button', {
      class: 'lib-row lib-part-row' + (!builtin && this.libId === lib.id && this.fpId === id ? ' on' : ''), type: 'button', role: 'treeitem', dataset: { footprint: id },
      title: builtin ? `${fp.name}: open a copy to edit and save in your Library` : `Edit ${fp.name}`,
      onClick: () => this.openFootprint(builtin ? null : lib, builtin ? null : id, fp),
    }, h('span', { class: 'lib-part-name' }, fp.name), h('span', { class: 'lib-ver' }, `${fp.pads.length}`));
    const group = (lib, entries, builtin) => {
      const shown = entries.filter(([, fp]) => !q || fp.name.toLowerCase().includes(q));
      if (q && !shown.length) return null;
      return h('div', { class: 'lib-group', dataset: { library: builtin ? 'builtin' : lib.id } },
        h('div', { class: 'lib-row lib-head', role: 'treeitem' }, icon(builtin ? 'library' : 'folder', 15), h('span', { class: 'lib-name' }, builtin ? 'Built-in (read-only)' : lib.name), h('span', { class: 'lib-count' }, String(entries.length)),
          builtin ? null : button({ icon: 'settings', title: `${lib.name}: rename`, cls: 'btn-ghost btn-xs', onClick: (e) => popupMenu([{ label: 'New footprint here', icon: 'plus', onClick: () => { this.libId = lib.id; this.createFootprint(); } }, { label: 'Rename…', icon: 'pencil', onClick: () => this.renameLib(lib) }], e.currentTarget) })),
        ...(builtin && !q ? shown.slice(0, 40) : shown).map(([id, fp]) => row(lib, id, fp, builtin)),
        builtin && !q && shown.length > 40 ? h('div', { class: 'side-note lib-empty' }, `${shown.length - 40} more: search to find them.`) : '',
        !builtin && !entries.length ? h('div', { class: 'side-note lib-empty' }, 'No footprints yet: New footprint or Generator… above the canvas.') : '');
    };
    el.replaceChildren(
      ...this.libraries.map((l) => group(l, Object.entries(l.footprints || {}).sort((a, b) => a[1].name.localeCompare(b[1].name)), false)).filter(Boolean),
      group({ id: 'builtin' }, (this._builtin ||= allFootprints()).map((fp) => [fp.name, fp]), true));
  }

  renderFootprint() {
    const el = this.fpEl;
    if (!el) return;
    const d = this.draft;
    if (!d) { el.replaceChildren(h('p', { class: 'side-note' }, 'Pick a footprint on the left, New footprint, or Generator… to make a standard package.')); return; }
    const name = h('input', { class: 'input', type: 'text', value: d.name, 'aria-label': 'Footprint name', spellcheck: false });
    name.addEventListener('change', () => this.edit('Rename footprint', (p) => { p.name = name.value.trim(); }));
    name.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') name.blur(); });
    const lib = h('select', { class: 'select', 'aria-label': 'Library', title: 'The Library it saves to' },
      ...this.libraries.map((l) => h('option', { value: l.id, selected: l.id === this.libId }, l.name)),
      h('option', { value: '', selected: !this.libId }, this.libraries.length ? '(choose on Save)' : 'My parts (made on Save)'));
    lib.addEventListener('change', () => { if (lib.value !== this.libId) { this.libId = lib.value || null; this.fpId = null; this.refresh(); } });
    const { errors, warnings } = footprintProblems(d);
    el.replaceChildren(...[
      h('div', { class: 'param param-wide' }, h('label', {}, 'Name'), name),
      h('div', { class: 'param param-wide' }, h('label', {}, 'Library'), lib),
      errors.length ? h('div', { class: 'lib-problems', role: 'alert' }, ...errors.map((m) => h('div', {}, m))) : null,
      warnings.length ? h('div', { class: 'lib-warnings' }, ...warnings.map((m) => h('div', {}, m))) : null,
      h('p', { class: 'side-note' }, 'Saved footprints can be added to a Part as Preferred footprints in the Symbol editor (PART → Preferred footprints → Add), with a Pin map.')].filter(Boolean));
  }

  renderProps() {
    const el = this.propsEl;
    if (!el) return;
    const d = this.draft;
    const sel = [...this.selection];
    const num = (label, value, onSet, unit = 'mm', step = '0.01') => {
      const i = h('input', { class: 'input', type: 'number', step, value: String(value), 'aria-label': label });
      i.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') i.blur(); });
      i.addEventListener('change', () => { const v = parseFloat(i.value); if (Number.isFinite(v)) onSet(v); });
      return h('label', { class: 'le-row' }, h('span', {}, label), i, h('em', {}, unit));
    };
    const select = (label, value, options, onSet) => {
      const s = h('select', { class: 'select', 'aria-label': label }, ...options.map(([v, t]) => h('option', { value: v, selected: v === value }, t)));
      s.addEventListener('change', () => onSet(s.value));
      return h('label', { class: 'le-row' }, h('span', {}, label), s, h('em', {}, ''));
    };
    const shapes = PAD_SHAPES.map((x) => [x, { rect: 'Rectangle', roundrect: 'Rounded rectangle', circle: 'Circle', oval: 'Oval' }[x]]);
    const pads = sel.filter((x) => x.startsWith('pad:')).map((x) => +x.slice(4));
    const gs = sel.filter((x) => x.startsWith('g:')).map((x) => +x.slice(2));
    if (!d) { el.replaceChildren(h('p', { class: 'side-note' }, 'Nothing open.')); return; }
    if (pads.length === 1 && !gs.length) {
      const i = pads[0], p = d.pads[i], tht = p.layers.includes('*.Cu');
      const set = (label, fn) => this.edit(label, (x) => fn(x.pads[i]));
      const number = h('input', { class: 'input', type: 'text', value: p.number, 'aria-label': 'Pad number' });
      number.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') number.blur(); });
      number.addEventListener('change', () => set('Pad number', (x) => { x.number = number.value.trim(); }));
      el.replaceChildren(...[
        h('div', { class: 'prop-title' }, `Pad ${p.number}`),
        h('label', { class: 'le-row' }, h('span', {}, 'Number'), number, h('em', {}, '')),
        select('Shape', p.shape, shapes, (v) => set('Pad shape', (x) => { x.shape = v; if (v === 'circle') x.size = [x.size[0], x.size[0]]; })),
        num('Width', fmt(p.size[0]), (v) => set('Pad size', (x) => { x.size = [mm(v), x.shape === 'circle' ? mm(v) : x.size[1]]; })),
        p.shape === 'circle' ? null : num('Height', fmt(p.size[1]), (v) => set('Pad size', (x) => { x.size = [x.size[0], mm(v)]; })),
        select('Type', tht ? 'tht' : 'smd', [['smd', 'SMD (top: copper, paste, mask)'], ['tht', 'Through-hole (all copper, mask)']], (v) => set('Pad type', (x) => { x.layers = v === 'tht' ? [...THT_LAYERS] : [...SMD_LAYERS]; if (v === 'tht') x.drill ||= Math.round(Math.min(x.size[0], x.size[1]) * 0.55); else delete x.drill; })),
        tht ? num('Drill', fmt(p.drill || 0), (v) => set('Pad drill', (x) => { x.drill = mm(v); })) : null,
        num('X', fmt(p.at[0]), (v) => set('Move pad', (x) => { x.at = [mm(v), x.at[1]]; })),
        num('Y', fmt(p.at[1]), (v) => set('Move pad', (x) => { x.at = [x.at[0], mm(v)]; }))].filter(Boolean));
      return;
    }
    if (gs.length === 1 && !pads.length) {
      const i = gs[0], g = d.graphics[i];
      const set = (label, fn) => this.edit(label, (x) => fn(x.graphics[i]));
      const rows = [h('div', { class: 'prop-title' }, { rect: 'Rectangle', line: 'Line', poly: 'Polygon', circle: 'Circle', arc: 'Arc', text: 'Text' }[g.type] || g.type),
        select('Layer', g.layer || 'F.SilkS', FOOTPRINT_LAYERS.map((l) => [l, `${l} (${LAYER_NAMES[l]})`]), (v) => set('Graphic layer', (x) => { x.layer = v; }))];
      if (g.type === 'text') {
        const t = h('input', { class: 'input', type: 'text', value: g.text, 'aria-label': 'Text' });
        t.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') t.blur(); });
        t.addEventListener('change', () => { if (t.value.trim()) set('Edit text', (x) => { x.text = t.value; }); });
        rows.push(h('label', { class: 'le-row' }, h('span', {}, 'Text'), t, h('em', {}, '')), num('Size', fmt(g.size), (v) => set('Text size', (x) => { x.size = mm(Math.max(0.2, v)); })),
          h('p', { class: 'side-note' }, '${REF} and ${VALUE} show the part\'s Reference and Value on the board.'));
      }
      el.replaceChildren(...rows);
      return;
    }
    // several items, or nothing (what the Pad tool makes next is on its context strip)
    el.replaceChildren(h('p', { class: 'side-note' }, sel.length ? `${sel.length} items selected. Drag to move, R turns pads, Del deletes.` : 'Nothing selected.'));
  }

  // ---------------------------------------------------------------- state

  refresh() {
    const d = this.draft;
    for (const s of [...this.selection]) { const [k, i] = s.split(':'); if (!d || (k === 'pad' ? !d.pads[+i] : !d.graphics[+i])) this.selection.delete(s); }
    // the Properties card belongs to the selection it was opened for
    const pc = this.cards?.card('props');
    if (pc?.isOpen && (!this._propsFor || this._selSig() !== this._propsFor)) { pc.toggle(false); this._propsFor = null; }
    if (this.btn) {
      this.btn.undo.disabled = !this.history.canUndo;
      this.btn.redo.disabled = !this.history.canRedo;
      this.btn.save.disabled = !d;
    }
    if (this.toolBtn) for (const [id, b] of Object.entries(this.toolBtn)) { b.classList.toggle('active', this.tool === id); b.disabled = !d && id !== 'select'; }
    this.renderList(); this.renderFootprint(); this.renderProps();
    this._updateStrip();
    if (this.ws && this.active) { this.ws.view.grid = this.gridStep; this.ws.view.origin = [0, 0]; this.ws.renderBar(); this._hint(); this.ws.view.invalidate(); }
    this.gridCard?.render();
  }

  _hint() {
    const d = this.draft;
    const t = !d ? 'Pick a footprint on the left, New footprint, or Generator… for a standard package (chip, SOIC, pin header, DIP).'
      : { pad: 'Pad: click to add a pad with the next number (shape, size and type under New pads in Properties) · Esc back to Select',
        line: this.drawing ? 'Line: click to add a point · double-click or Enter to finish · Esc cancel' : `Line on ${this.activeLayer}: click the first point`,
        rect: this.drawing ? 'Rectangle: click the opposite corner' : `Rectangle on ${this.activeLayer}: click a corner`,
        circle: this.drawing ? 'Circle: click a point on the edge' : `Circle on ${this.activeLayer}: click the centre`,
        arc: !this.drawing ? `Arc on ${this.activeLayer}: click the start` : this.drawing.length === 1 ? 'Arc: click a point it passes through' : 'Arc: click the end',
        text: `Text on ${this.activeLayer}: click, then type (\${REF} and \${VALUE} are filled in on the board)`,
      }[this.tool] || `Editing ${d.name}: click to select, drag to move, drag a handle to resize · R turns pads · Del delete · Ctrl+S save`;
    this.ws.hint.textContent = t;
  }

  setTool(t) {
    if (!FP_TOOLS[t] || (!this.draft && t !== 'select')) return;
    if (this.tool === 'line' && this.drawing?.length > 1) this.finishLine();
    this.tool = t; this.drawing = null;
    if (t !== 'select') this.selection.clear();
    if (['line', 'rect', 'circle', 'arc', 'text'].includes(t) && this.activeLayer === 'F.Cu') this.activeLayer = 'F.SilkS';
    if (this.ws) this.ws.view.canvas.style.cursor = t === 'select' ? '' : 'crosshair';
    this.refresh();
  }

  edit(label, fn) { if (!this.draft) return null; return this.history.transact(label, fn); }
  undo() { this.history.undo(); }
  redo() { this.history.redo(); }

  async _confirmDiscard() {
    if (!this.dirty) return true;
    return confirmDialog(`Discard changes to ${this.draft.name}?`, 'The footprint has changes that are not saved to its Library.', 'Discard', true);
  }

  /** Open a Footprint: one of a Library's (lib, id), or a copy of any other (lib null). */
  async openFootprint(lib, id, fp) {
    if (lib && lib.id === this.libId && id === this.fpId && this.draft) return;
    if (!(await this._confirmDiscard())) return;
    this.load(structuredClone(fp), lib?.id || this.libId || this.libraries[0]?.id || null, lib ? id : null, !lib);
  }

  load(fp, libId, fpId, isCopy = false) {
    this.draft = { name: fp.name, pads: fp.pads, graphics: fp.graphics || [] };
    this.libId = libId; this.fpId = fpId;
    this.saved = isCopy ? null : JSON.stringify(this.draft);
    this.history.clear();
    this.selection.clear(); this.tool = 'select';
    this.refresh();
    if (this.ws) { const b = this._bounds(); const pad = Math.max(b.x1 - b.x0, b.y1 - b.y0) * 0.3 + mm(1); this.ws.view.home = { x0: b.x0 - pad, y0: b.y0 - pad, x1: b.x1 + pad, y1: b.y1 + pad }; this.ws.view.fitHome(); }
  }

  async createFootprint() {
    if (!(await this._confirmDiscard())) return;
    this.load(newFootprint(), this.libId || this.libraries[0]?.id || null, null, true);
    this.setTool('pad');
  }

  async save() {
    if (!this.draft) return false;
    let lib = this.library;
    if (!lib) {
      lib = this.libraries[0] || newLibrary('My parts', this.libraries.map((l) => l.id));
      this.libId = lib.id;
    }
    try {
      const id = saveFootprint(lib, this.draft, this.fpId);
      this.fpId = id;
      await this.app.saveLibrary(lib);
      this.saved = JSON.stringify(this.draft);
      toast(`Saved ${this.draft.name} to ${lib.name}. Add it to a Part in the Symbol editor (Preferred footprints).`, 'info', 3500);
      this.refresh();
      return true;
    } catch (e) {
      toast(e instanceof LibraryError ? e.message : String(e), 'error', 5000);
      return false;
    }
  }

  async renameLib(lib) {
    const n = await promptDialog('Rename library', 'Name', lib.name);
    if (n == null) return;
    try { renameLibrary(lib, n); await this.app.saveLibrary(lib); this.refresh(); } catch (e) { toast(e.message, 'error'); }
  }

  /** The Generator… dialog: a package type, its parameters, and a live preview; Create opens it. */
  generator() {
    const m = modal({ title: 'Footprint generator', width: 640, cls: 'gen-modal' });
    let gen = GENERATORS[0], params = generatorDefaults(gen);
    const typeSel = h('select', { class: 'select', 'aria-label': 'Package' }, ...GENERATORS.map((g) => h('option', { value: g.id }, g.label)));
    const form = h('div', { class: 'gen-form' });
    let preview = h('canvas', { width: 280, height: 220, class: 'gen-preview', 'aria-label': 'Preview' });
    const nameEl = h('div', { class: 'gen-name' });
    const problems = h('div', { class: 'gen-problems' });
    const show = () => {
      let fp;
      try { fp = gen.make(params); } catch (e) { problems.textContent = String(e.message || e); return null; }
      nameEl.textContent = fp.name;
      const c = h('canvas', { width: 280, height: 220, class: 'gen-preview', 'aria-label': 'Preview' });
      preview.replaceWith(c); preview = c;
      drawFootprintPreview(c, fp, this.app.canvasColors('board'));
      const { errors } = footprintProblems(fp);
      problems.textContent = errors.join(' ');
      createBtn.disabled = !!errors.length;
      return fp;
    };
    const renderForm = () => {
      form.replaceChildren(...gen.params.map((p) => {
        let input;
        if (p.kind === 'select') {
          input = h('select', { class: 'select', 'aria-label': p.label }, ...p.options.map(([v, t]) => h('option', { value: v, selected: String(params[p.key]) === v }, t)));
          input.addEventListener('change', () => { params[p.key] = input.value; if (gen.presets) Object.assign(params, gen.presets(params)); renderForm(); show(); });
        } else {
          input = h('input', { class: 'input', type: 'number', min: p.min, max: p.max, step: p.step, value: String(params[p.key]), 'aria-label': p.label });
          input.addEventListener('input', () => { const v = parseFloat(input.value); if (Number.isFinite(v) && v >= p.min && v <= p.max) { params[p.key] = p.kind === 'int' ? Math.round(v) : v; show(); } });
        }
        input.addEventListener('keydown', (e) => e.stopPropagation());
        return h('label', { class: 'le-row' }, h('span', {}, p.label), input, h('em', {}, p.unit || ''));
      }));
    };
    typeSel.addEventListener('change', () => { gen = generatorById(typeSel.value); params = generatorDefaults(gen); renderForm(); show(); });
    const createBtn = button({ label: 'Create', cls: 'btn-primary', title: 'Open it in the editor (then Save it to a Library)', onClick: async () => {
      const fp = show();
      if (!fp) return;
      if (!(await this._confirmDiscard())) return;
      m.close();
      this.load(fp, this.libId || this.libraries[0]?.id || null, null, true);
    } });
    m.body.append(
      h('div', { class: 'gen-grid' },
        h('div', {}, h('label', { class: 'le-row' }, h('span', {}, 'Package'), typeSel, h('em', {}, '')), form),
        h('div', { class: 'gen-side' }, preview, nameEl, problems)),
      h('div', { class: 'modal-actions' }, button({ label: 'Cancel', cls: 'btn-outline', onClick: () => m.close() }), createBtn));
    renderForm(); show();
    return m;
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
    const turn = [...this.selection].some((x) => x.startsWith('pad:'));
    popupMenu([{ label: 'Properties…', icon: 'sliders', shortcut: 'Double-click', onClick: () => this.openProperties() }, 'sep',
      turn ? { label: 'Turn', icon: 'rotate', shortcut: 'R', onClick: () => this.rotatePads() } : null,
      { label: 'Delete', icon: 'trash', shortcut: 'Del', onClick: () => this.deleteSelection() }], at);
  }

  /** The context strip: actions for the selection (only while this editor is the one shown). */
  _updateStrip() {
    const s = this.strip;
    if (!s || !this.ws) return;
    if (this.active && this.draft && this.tool === 'pad') {
      // what the Pad tool makes next
      const t = this.padTpl;
      const shapes = PAD_SHAPES.map((x) => [x, { rect: 'Rectangle', roundrect: 'Rounded rect', circle: 'Circle', oval: 'Oval' }[x]]);
      s.show(`pad|${t.shape}|${t.w}|${t.h}|${t.tht}|${t.drill}`, () => [stripLabel('New pads', 'pad'), stripSep(),
        stripSelect({ label: 'Shape', value: t.shape, options: shapes, onSet: (v) => { t.shape = v; this.refresh(); } }),
        stripNumber({ label: 'W', value: fmt(t.w), unit: t.shape === 'circle' ? 'mm' : '', step: '0.01', min: '0.01', width: 58, title: 'Width (mm)', onSet: (v) => { t.w = mm(v); this.refresh(); } }),
        t.shape === 'circle' ? null : stripNumber({ label: 'H', value: fmt(t.h), unit: 'mm', step: '0.01', min: '0.01', width: 58, title: 'Height (mm)', onSet: (v) => { t.h = mm(v); this.refresh(); } }),
        stripSelect({ label: 'Type', value: t.tht ? 'tht' : 'smd', options: [['smd', 'SMD'], ['tht', 'Through-hole']], onSet: (v) => { t.tht = v === 'tht'; this.refresh(); } }),
        t.tht ? stripNumber({ label: 'Drill', value: fmt(t.drill), unit: 'mm', step: '0.05', min: '0.05', width: 58, onSet: (v) => { t.drill = mm(v); this.refresh(); } }) : null]);
      return;
    }
    if (!this.active || this.tool !== 'select' || !this.selection.size) { s.hide(); return; }
    const sel = [...this.selection];
    const nK = sel.filter((x) => x.startsWith('pad:')).length, nG = sel.length - nK;
    const what = [[nK, 'pad'], [nG, 'shape']].filter(([k]) => k).map(([k, w]) => `${k} ${w}${k === 1 ? '' : 's'}`).join(', ');
    s.show(`sel|${sel.sort().join()}|${!!this.cards?.card('props')?.isOpen}`, () => [stripLabel(what, nK ? 'pad' : 'select'), stripSep(),
      nK ? stripButton({ icon: 'rotate', title: 'Turn the selected pads 90° (R)', onClick: () => this.rotatePads() }) : null,
      stripButton({ icon: 'trash', title: 'Delete (Del)', danger: true, onClick: () => this.deleteSelection() }),
      stripSep(), stripProps({ open: !!this.cards?.card('props')?.isOpen, onToggle: () => (this.cards.card('props').isOpen ? this.closeProperties() : this.openProperties()) })]);
  }

  deleteSelection() {
    if (!this.selection.size) return;
    const pads = new Set([...this.selection].filter((s) => s.startsWith('pad:')).map((s) => +s.slice(4)));
    const gs = new Set([...this.selection].filter((s) => s.startsWith('g:')).map((s) => +s.slice(2)));
    this.selection.clear();
    this.edit('Delete', (d) => { d.pads = d.pads.filter((_, i) => !pads.has(i)); d.graphics = d.graphics.filter((_, i) => !gs.has(i)); });
  }

  /** Turn the selected pads 90° about the middle of them: positions turn, width and height swap. */
  rotatePads() {
    const ids = [...this.selection].filter((s) => s.startsWith('pad:')).map((s) => +s.slice(4));
    if (!ids.length) return;
    this.edit('Turn pads', (d) => {
      const ps = ids.map((i) => d.pads[i]);
      const cx = Math.round(ps.reduce((a, p) => a + p.at[0], 0) / ps.length / this.grid.main) * this.grid.main;
      const cy = Math.round(ps.reduce((a, p) => a + p.at[1], 0) / ps.length / this.grid.main) * this.grid.main;
      for (const p of ps) { const x = p.at[0] - cx, y = p.at[1] - cy; p.at = [cx + y, cy - x]; p.size = [p.size[1], p.size[0]]; }
    });
  }

  nextNumber() {
    const nums = this.draft.pads.map((p) => parseInt(p.number, 10)).filter(Number.isFinite);
    return String(nums.length ? Math.max(...nums) + 1 : 1);
  }

  // ---------------------------------------------------------------- canvas

  _bounds() {
    const d = this.draft, pts = [[-mm(1), -mm(1)], [mm(1), mm(1)]];
    for (const p of d?.pads || []) pts.push([p.at[0] - p.size[0] / 2, p.at[1] - p.size[1] / 2], [p.at[0] + p.size[0] / 2, p.at[1] + p.size[1] / 2]);
    for (const g of d?.graphics || []) for (const hd of shapeHandles(g)) pts.push(hd.at);
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  }

  /** Snap onto a pad centre, a graphic's handle or the origin within the Settings distance, else the grid. */
  snapAt(w, { skip = null, not = null } = {}) {
    const d = this.draft, targets = [[0, 0]];
    if (d) { d.pads.forEach((p, i) => { if (skip !== `pad:${i}`) targets.push(p.at); }); d.graphics.forEach((g, i) => { if (skip !== `g:${i}`) for (const hd of shapeHandles(g)) targets.push(hd.at); }); }
    const tol = this.app.snapDistance() / (this.ws?.view.view.scale || 1);
    const r = snapPoint(w, targets.filter((t) => !not || t[0] !== not[0] || t[1] !== not[1]), tol, (p) => snapToGrid(p, this.gridStep));
    this.snapMark = r.target;
    return r.at;
  }

  hitTest(w, tol) {
    const d = this.draft;
    if (!d) return null;
    for (let i = d.pads.length - 1; i >= 0; i--) {
      const p = d.pads[i];
      if (Math.abs(w[0] - p.at[0]) <= p.size[0] / 2 + tol && Math.abs(w[1] - p.at[1]) <= p.size[1] / 2 + tol) return `pad:${i}`;
    }
    for (let i = d.graphics.length - 1; i >= 0; i--) {
      const g = d.graphics[i];
      if (g.type === 'line' || g.type === 'poly') { for (let k = 1; k < g.pts.length; k++) if (distToSegment2(w, g.pts[k - 1], g.pts[k]) <= tol * tol) return `g:${i}`; continue; }
      if (g.type === 'rect') { const c = [g.a, [g.b[0], g.a[1]], g.b, [g.a[0], g.b[1]]]; if (c.some((p, k) => distToSegment2(w, p, c[(k + 1) % 4]) <= tol * tol)) return `g:${i}`; continue; }
      if (g.type === 'circle') { const r = Math.hypot(w[0] - g.c[0], w[1] - g.c[1]); if (Math.abs(r - g.r) <= tol || (g.fill === 'outline' && r < g.r)) return `g:${i}`; continue; }
      if (g.type === 'arc') { const c = arcCircle(g.start, g.mid, g.end); if (c && Math.abs(Math.hypot(w[0] - c.c[0], w[1] - c.c[1]) - c.r) <= tol) return `g:${i}`; continue; }
      if (g.type === 'text') { const half = (String(g.text).length * g.size * 0.6) / 2; if (Math.abs(w[0] - g.at[0]) <= half + tol && Math.abs(w[1] - g.at[1]) <= g.size / 2 + tol) return `g:${i}`; }
    }
    return null;
  }

  _handleGraphic() {
    if (this.tool !== 'select' || this.selection.size !== 1 || this.drag?.moved) return null;
    const [k, i] = [...this.selection][0].split(':');
    const g = k === 'g' && this.draft?.graphics[+i];
    return g && g.type !== 'text' ? { g, index: +i } : null;
  }

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
    watchAlt(ws, (on) => { if (!this.active || !!on === !!this.alt) return; this.alt = !!on; this.refresh(); });
    this.gridCard.mount(ws);
    c.addEventListener('pointerdown', (e) => {
      if (!this.active || e.button !== 0 || !this.draft) return;
      this.alt = e.altKey;
      const w = world(e), tol = 5 / ws.view.view.scale;
      if (this.tool === 'select') {
        const hg = this._handleGraphic();
        const hh = hg && hitHandle(hg.g, w, tol);
        if (hh && !e.shiftKey) { this.handleDrag = { index: hg.index, key: hh.key, snapshot: structuredClone(this.draft), startPx: [e.clientX, e.clientY], moved: false }; try { c.setPointerCapture(e.pointerId); } catch { /* synthetic */ } return; }
        const hit = this.hitTest(w, tol);
        if (e.shiftKey && hit) { if (this.selection.has(hit)) this.selection.delete(hit); else this.selection.add(hit); this.refresh(); return; }
        if (hit) {
          if (!this.selection.has(hit)) this.selection = new Set([hit]);
          const [k, i] = hit.split(':');
          const anchor = k === 'pad' ? this.draft.pads[+i].at : (shapeHandles(this.draft.graphics[+i])[0]?.at || w);
          this.drag = { start: w, anchor, startPx: [e.clientX, e.clientY], snapshot: structuredClone(this.draft), moved: false, delta: [0, 0], only: hit };
          try { c.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
        } else this.selection.clear();
        this.refresh();
        return;
      }
      if (this.tool === 'text') e.preventDefault();
      this.click(this.snapAt(w), e.detail >= 2);
    });
    c.addEventListener('pointermove', (e) => {
      if (!this.active || !this.draft) return;
      const w = world(e);
      this.cursor = w; this.snapMark = null;
      if (this.handleDrag && (e.buttons & 1)) {
        const d = this.handleDrag;
        if (!d.moved && Math.hypot(e.clientX - d.startPx[0], e.clientY - d.startPx[1]) < 3) return;
        d.moved = true;
        this.draft = structuredClone(d.snapshot);
        const from = shapeHandles(d.snapshot.graphics[d.index]).find((x) => x.key === d.key)?.at;
        this.draft.graphics[d.index] = dragHandle(this.draft.graphics[d.index], d.key, this.snapAt(w, { skip: `g:${d.index}`, not: from }));
        ws.view.invalidate();
        return;
      }
      if (this.drag && (e.buttons & 1)) {
        const d = this.drag;
        if (!d.moved && Math.hypot(e.clientX - d.startPx[0], e.clientY - d.startPx[1]) < 4) return;
        d.moved = true;
        const to = this.snapAt([d.anchor[0] + w[0] - d.start[0], d.anchor[1] + w[1] - d.start[1]], { skip: d.only });
        d.delta = [to[0] - d.anchor[0], to[1] - d.anchor[1]];
        this.draft = structuredClone(d.snapshot);
        moveFpItems(this.draft, this.selection, d.delta);
        ws.view.invalidate();
        return;
      }
      if (this.tool !== 'select') { this.snapped = this.snapAt(w); ws.view.invalidate(); }
      else if (!e.buttons) { const hg = this._handleGraphic(); const hh = hg && hitHandle(hg.g, w, 5 / ws.view.view.scale); c.style.cursor = hh ? hh.cursor : ''; }
    });
    c.addEventListener('pointerup', () => {
      if (!this.active) return;
      this.snapMark = null;
      if (this.handleDrag) {
        const d = this.handleDrag; this.handleDrag = null;
        const g = this.draft.graphics[d.index];
        this.draft = d.snapshot;
        if (d.moved) this.edit('Resize', (x) => { x.graphics[d.index] = g; }); else this.refresh();
        return;
      }
      if (!this.drag) return;
      const d = this.drag; this.drag = null;
      this.draft = d.snapshot;
      if (d.moved && (d.delta[0] || d.delta[1])) this.edit('Move', (x) => moveFpItems(x, this.selection, d.delta));
      else { if (!d.moved) this.selection = new Set([d.only]); this.refresh(); }
    });
  }

  click(p, dbl) {
    const t = this.tool, layer = this.activeLayer === 'F.Cu' ? 'F.SilkS' : this.activeLayer;
    if (t === 'pad') {
      const tp = this.padTpl, idx = this.draft.pads.length;
      const pad = { number: this.nextNumber(), at: p, shape: tp.shape, size: [tp.w, tp.shape === 'circle' ? tp.w : tp.h], layers: tp.tht ? [...THT_LAYERS] : [...SMD_LAYERS] };
      if (tp.tht) pad.drill = tp.drill;
      this.edit('Add pad', (d) => d.pads.push(pad));
      this.selection = new Set([`pad:${idx}`]);
      this.refresh();
      return;
    }
    if (t === 'text') { this.textAt(p, layer); return; }
    const pts = this.drawing || [];
    const add = (label, g) => { const idx = this.draft.graphics.length; this.drawing = null; this.edit(label, (d) => d.graphics.push({ ...g, layer })); this.selection = new Set([`g:${idx}`]); this.refresh(); };
    if (t === 'line') {
      const last = pts[pts.length - 1];
      if (dbl || (last && last[0] === p[0] && last[1] === p[1])) { this.finishLine(); return; }
      this.drawing = [...pts, p];
    } else if (t === 'rect' && pts.length === 1) { if (p[0] !== pts[0][0] && p[1] !== pts[0][1]) add('Rectangle', { type: 'rect', a: pts[0], b: p }); else this.drawing = null; }
    else if (t === 'circle' && pts.length === 1) { const r = Math.round(Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1])); if (r) add('Circle', { type: 'circle', c: pts[0], r }); else this.drawing = null; }
    else if (t === 'arc' && pts.length === 2) add('Arc', { type: 'arc', start: pts[0], mid: pts[1], end: p });
    else this.drawing = [...pts, p];
    this.refresh();
  }

  finishLine() {
    const pts = this.drawing || [];
    this.drawing = null;
    if (pts.length >= 2) { const idx = this.draft.graphics.length; const layer = this.activeLayer === 'F.Cu' ? 'F.SilkS' : this.activeLayer; this.edit('Line', (d) => d.graphics.push({ type: 'line', pts, layer })); this.selection = new Set([`g:${idx}`]); }
    this.refresh();
  }

  textAt(at, layer) {
    const [x, y] = this.ws.view.view.toScreen(at);
    const input = h('input', { class: 'field-edit', type: 'text', value: layer === 'F.SilkS' ? '${REF}' : layer === 'F.Fab' ? '${VALUE}' : '', 'aria-label': 'Text', spellcheck: false });
    Object.assign(input.style, { left: `${x - 70}px`, top: `${y - 14}px`, width: '140px', height: '28px', fontSize: '13px' });
    let done = false;
    const finish = (ok) => {
      if (done) return; done = true;
      const t = input.value.trim(); input.remove();
      if (ok && t) { const idx = this.draft.graphics.length; this.edit('Text', (d) => d.graphics.push({ type: 'text', at, text: t, size: mm(1), layer })); this.selection = new Set([`g:${idx}`]); this.refresh(); }
    };
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') finish(true); else if (e.key === 'Escape') finish(false); });
    input.addEventListener('blur', () => finish(true));
    this.ws.view.el.append(input);
    input.focus(); input.select();
  }

  draw(ctx, view, C) {
    const d = this.draft;
    if (!d) return;
    const T = (p) => p;
    const drawAll = (c, Cx, only = null) => {
      const gOnly = only ? new Set([...only].filter((s) => s.startsWith('g:')).map((s) => +s.slice(2))) : null;
      drawFootprintGraphics(c, view, Cx, d, T, { only: gOnly });
      d.pads.forEach((p, i) => { if (!only || only.has(`pad:${i}`)) drawPad(c, view, Cx, { ...p, rot: 0 }, 'F.Cu'); });
    };
    drawAll(ctx, C);
    // the selection, in the highlight style from Settings
    if (this.selection.size) {
      const boxes = [...this.selection].map((s) => {
        const [k, i] = s.split(':');
        if (k === 'pad') { const p = d.pads[+i]; return p && { x0: p.at[0] - p.size[0] / 2, y0: p.at[1] - p.size[1] / 2, x1: p.at[0] + p.size[0] / 2, y1: p.at[1] + p.size[1] / 2 }; }
        const g = d.graphics[+i]; if (!g) return null;
        const pts = g.type === 'text' ? [g.at] : shapeHandles(g).map((x) => x.at);
        const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
        return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
      }).filter(Boolean).map((b) => screenBox(view, b));
      highlight(ctx, C, this.app.highlightStyle(), (c, Cx) => drawAll(c, Cx, this.selection), boxes);
    }
    const hg = this._handleGraphic();
    if (hg) drawHandles(ctx, view, C, shapeHandles(hg.g), this.handleDrag?.key);
    // what the tool would add
    const cur = this.snapped;
    if (cur && this.tool === 'pad') { const tp = this.padTpl; ctx.save(); ctx.globalAlpha = 0.5; drawPad(ctx, view, C, { number: this.nextNumber(), at: cur, shape: tp.shape, size: [tp.w, tp.shape === 'circle' ? tp.w : tp.h], drill: tp.tht ? tp.drill : 0, layers: tp.tht ? THT_LAYERS : SMD_LAYERS }, 'F.Cu'); ctx.restore(); }
    if (cur && this.drawing) {
      const layer = this.activeLayer === 'F.Cu' ? 'F.SilkS' : this.activeLayer;
      const pts = [...this.drawing, cur].map((p) => view.toScreen(p));
      ctx.save(); ctx.strokeStyle = C[layer] || C.selection; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]); ctx.beginPath();
      if (this.tool === 'rect') { const [a, b] = pts; ctx.rect(a[0], a[1], b[0] - a[0], b[1] - a[1]); }
      else if (this.tool === 'circle') { const [a, b] = pts; ctx.arc(a[0], a[1], Math.hypot(b[0] - a[0], b[1] - a[1]), 0, Math.PI * 2); }
      else pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke(); ctx.restore();
    }
    drawSnapMark(ctx, view, C, this.snapMark);
  }

  // ---------------------------------------------------------------- keys

  onModKey(e) { if (e.key.toLowerCase() === 's') { this.save(); return true; } return false; }

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
    if (k === 'r') { this.rotatePads(); return true; }
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (arrows[e.key] && this.selection.size) { const [dx, dy] = arrows[e.key]; this.edit('Move', (x) => moveFpItems(x, this.selection, [dx * this.grid.main, dy * this.grid.main])); return true; }
    for (const [id, t] of Object.entries(FP_TOOLS)) if (k === t.key && this.draft) { this.setTool(id); return true; }
    return false;
  }
}

/** Move the selected pads and graphics of a Footprint by `delta`. */
export function moveFpItems(fp, selection, [dx, dy]) {
  const mv = ([x, y]) => [x + dx, y + dy];
  for (const s of selection) {
    const [k, i] = s.split(':');
    if (k === 'pad') { const p = fp.pads[+i]; if (p) p.at = mv(p.at); continue; }
    const g = fp.graphics[+i];
    if (!g) continue;
    for (const key of ['a', 'b', 'c', 'at', 'start', 'mid', 'end']) if (g[key]) g[key] = mv(g[key]);
    if (g.pts) g.pts = g.pts.map(mv);
  }
}
