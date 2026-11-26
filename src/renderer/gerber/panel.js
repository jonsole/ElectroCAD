// The Gerber tab (#26, #28): the Fab preset, which outputs to make, Generate (after any Zone refill in
// progress) and Download zip; the canvas shows the files by parsing them back (generated ones, or a
// fab zip / loose Gerbers opened from disk), layer by layer, from the top or the bottom; Compare
// with… checks the generated files against a reference set (what a board house built before, say)
// layer by layer; and the checks worth knowing before ordering (DRC, an open Outline, missing layers).
import { h, button, icon, toast } from '../ui/dom.js';
import { section } from '../workspaces/workspace.js';
import { presetState, fabSettings } from '../core/presets.js';
import { fabFiles, fabBaseName } from '../core/fab.js';
import { makeZip, unzip } from '../core/zip.js';
import { runDrc, drcCounts } from '../core/drc.js';
import { markApproved, unapproved } from '../core/drcApprovals.js';
import { checkOutline } from '../core/board.js';
import { readFabFiles, FAB_LAYERS } from '../core/gerber/compare.js';
import { assemblyFiles } from '../core/assembly.js';
import { platform } from '../platform.js';
import { openBoardSetup } from '../board/setup-dialog.js';
import { GerberViewer, fabColor } from './viewer.js';

const VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';
const kb = (n) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} kB`);
const pct = (x) => `${(Math.floor(x * 10000) / 100).toFixed(2)}%`;

/** Fab files picked from disk ([{ name, bytes }]) as [{ name, text }]: zips are opened, folders flattened. */
export async function fabTexts(picked) {
  const out = [];
  const dec = new TextDecoder();
  for (const f of picked) {
    const zip = f.bytes[0] === 0x50 && f.bytes[1] === 0x4b && f.bytes[2] === 3 && f.bytes[3] === 4;
    if (zip || /\.zip$/i.test(f.name)) {
      for (const e of await unzip(f.bytes)) {
        if (!e.ok) throw new Error(`${e.name} in ${f.name} is damaged${e.error ? ` (${e.error})` : ''}.`);
        out.push({ name: e.name.split('/').pop(), text: dec.decode(e.bytes) });
      }
    } else out.push({ name: f.name, text: dec.decode(f.bytes) });
  }
  return out;
}

/** What a comparison's differences on a layer probably are, when they're expected. */
function expected(entry, project) {
  const l = entry.layer;
  if (/SilkS$/.test(l)) return 'Silk text is drawn in each tool\'s own font, and tools differ on References: silk always differs.';
  if (/Cu$/.test(l) && (project.board.zones || []).some((z) => z.layer === l)) return 'Zone fills follow each tool\'s own rules: thermal spokes and clearances round pads differ a little.';
  if (l === 'Edge.Cuts') return 'Some tools also draw holes or milling on the outline layer.';
  return null;
}

export class GerberPanel {
  constructor(app) {
    this.app = app;
    this.files = null;   // the last generated files
    this.zip = null;     // and their zip (Uint8Array)
    this.made = null;    // { rev, date } they were made for
    this.out = { gerber: true, drill: true, bom: false, pnp: false }; // BOM and pick-and-place: for assembly (#27)
    this.viewer = new GerberViewer();
    this.source = 'generated'; // what the canvas shows: 'generated' | 'opened'
    this.opened = null;  // { name, layers, skipped, texts }
    this.compare = null; // { name, result, skipped, warnings, selected } | { running }
    this.generated = null; // readFabFiles of this.files
  }

  get project() { return this.app.project; }

  toolbar() {
    this.genBtn = button({ label: 'Generate', icon: 'play', cls: 'btn-primary', title: 'Make the fab files: Gerber X2 for each layer, Excellon drill files, and the BOM and pick-and-place when chosen (waits for zone fills)', onClick: () => this.generate() });
    this.zipBtn = button({ label: 'Download zip', icon: 'zip', title: 'Save the fab zip to send to the board house', onClick: () => this.download() });
    this.zipBtn.disabled = true;
    this.openBtn = button({ label: 'Open fab files…', icon: 'folder', title: 'View a fab zip, or loose Gerber and drill files, from any tool', onClick: () => this.openFiles() });
    this.cmpBtn = button({ label: 'Compare with…', icon: 'layers', title: 'Compare the generated files with a reference set (a zip or loose files), layer by layer', onClick: () => this.compareWith() });
    return [this.genBtn, this.zipBtn, this.openBtn, this.cmpBtn];
  }

  side() {
    this.presetEl = h('div', { class: 'outline-state ok' });
    this.filesEl = h('div', { class: 'fab-files' });
    this.checksEl = h('div', { class: 'fab-checks' });
    this.layersEl = h('div', { class: 'fab-layers' });
    this.showEl = h('div', { class: 'fab-show' });
    this.cmpEl = h('div', { class: 'fab-compare' });
    const out = (key, label, tip) => {
      const c = h('input', { type: 'checkbox', checked: this.out[key], 'aria-label': label });
      c.addEventListener('change', () => { this.out[key] = c.checked; this.genBtn.disabled = !Object.values(this.out).some(Boolean); });
      return h('label', { class: 'check-row', title: tip }, c, label);
    };
    const later = (label, ticket) => h('label', { class: 'check-row', title: `Coming in #${ticket}` }, h('input', { type: 'checkbox', disabled: true }), label);
    this.namingEl = h('p', { class: 'side-note' });
    return h('div', { class: 'side-panel gerber-side' },
      section('Fab preset', h('div', { class: 'gerber-preset' }, this.presetEl,
        button({ label: 'Board setup…', icon: 'settings', cls: 'btn-outline', title: 'Choose a Fab preset and edit the Design rules and Fab output settings', onClick: () => openBoardSetup(this.app) }))),
      section('Output', out('gerber', 'Gerber X2 (copper, mask, paste, silk, Edge.Cuts)', 'One RS-274X file with X2 attributes per layer of the stack'),
        out('drill', 'Excellon drill (PTH / NPTH)', 'Plated holes (vias, plated pads) and non-plated holes, in separate files'),
        out('bom', 'BOM (CSV)', 'One row per group of identical parts: quantity, References, Value, Footprint, MPN, manufacturer, Part and custom fields'),
        out('pnp', 'Pick-and-place (CSV)', 'Each footprint\'s Reference, Value, Footprint, X and Y in mm in the Gerbers\' coordinates (Y up), rotation and side'),
        this.namingEl),
      section('Showing', this.showEl),
      section('Layers', this.layersEl),
      section('Files', this.filesEl),
      section('Compare', this.cmpEl),
      section('Checks', this.checksEl));
  }

  /** Hook the canvas: Measure, and the Top / Bottom switch. */
  attach(ws) {
    this.ws = ws;
    const c = ws.view.canvas;
    c.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || this.viewer.tool !== 'measure') return;
      const p = this.viewer.toBoard(ws.view.view, ws.view.local(e));
      const m = this.viewer.measure;
      if (!m || m.done) this.viewer.measure = { a: p, b: p, done: false };
      else { m.b = p; m.done = true; }
      ws.view.invalidate();
    });
    c.addEventListener('pointermove', (e) => {
      const m = this.viewer.measure;
      if (m && !m.done) { m.b = this.viewer.toBoard(ws.view.view, ws.view.local(e)); ws.view.invalidate(); }
    });
    c.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.viewer.measure) { this.viewer.measure = null; ws.view.invalidate(); }
      if ((e.key === 'm' || e.key === 'M') && !e.ctrlKey && !e.metaKey) this.setTool(this.viewer.tool === 'measure' ? 'select' : 'measure');
      if ((e.key === 'b' || e.key === 'B') && !e.ctrlKey && !e.metaKey) this.setSide(this.viewer.side === 'top' ? 'bottom' : 'top');
    });
  }

  setTool(t) {
    this.viewer.tool = t;
    if (t !== 'measure') this.viewer.measure = null;
    for (const b of this.toolBtns || []) b.classList.toggle('active', b.dataset.tool === t);
    if (this.ws) { this.ws.view.canvas.style.cursor = t === 'measure' ? 'crosshair' : ''; this.ws.view.invalidate(); }
  }

  setSide(side) {
    this.viewer.side = side;
    for (const b of this.sideSeg?.querySelectorAll('button') || []) b.classList.toggle('active', b.dataset.id === side);
    this.ws?.view.invalidate();
  }

  /** Is what was made still the Board as it is? */
  get stale() { return !!this.made && this.made.rev !== this._rev(); }
  _rev() { const hs = this.app.history; return `${hs.undoStack.length}:${hs.undoStack[hs.undoStack.length - 1]?.label || ''}:${this.project.id}`; }

  refresh() {
    if (!this.presetEl) return;
    if (this._project !== this.project.id) { // another Project: what was made or compared was for the last one
      this._project = this.project.id;
      this.files = null; this.zip = null; this.made = null; this.generated = null; this.compare = null; this.drc = null;
      if (this.zipBtn) this.zipBtn.disabled = true;
      if (this.source === 'generated') this._show();
    }
    const b = this.project.board, st = presetState(b), f = fabSettings(b);
    this.presetEl.replaceChildren(icon(st.mismatch ? 'info' : 'check', 16), h('span', {}, `${st.name}${st.edited.length ? ' (edited)' : ''}${st.mismatch ? ` · for ${st.preset.copper}-layer boards` : ''}`));
    this.presetEl.className = `outline-state ${st.mismatch ? 'bad' : 'ok'}`;
    this.namingEl.textContent = `${f.naming === 'protel' ? 'Protel file names (.GTL, .GBL…)' : 'Descriptive file names (-F_Cu.gbr…)'}, drills in ${f.drillUnits === 'inch' ? 'inches' : 'mm'}: set in Board setup.`;
    this.renderShow();
    this.renderLayers();
    this.renderFiles();
    this.renderCompare();
    this.renderChecks();
  }

  /** The layers the canvas shows now. */
  get shown() { return this.source === 'opened' && this.opened ? this.opened.layers : this.generated?.layers || []; }

  _show(fit = false) {
    this.viewer.setLayers(this.shown);
    if (this.viewer.diff && !this.compare?.selected) this.viewer.diff = null;
    if (fit && this.viewer.box && this.ws) {
      const b = this.viewer.box, m = Math.max(b.x1 - b.x0, b.y1 - b.y0) * 0.06;
      this.ws.view.home = { x0: b.x0 - m, y0: b.y0 - m, x1: b.x1 + m, y1: b.y1 + m };
      this.ws.view.fitHome();
    }
    this.ws?.view.invalidate();
  }

  renderShow() {
    const opt = (id, label, enabled) => {
      const b = button({ label, cls: `btn-xs ${this.source === id ? 'btn-primary' : 'btn-outline'}`, onClick: () => { this.source = id; this.compare && (this.compare.selected = null); this.viewer.diff = null; this._show(true); this.refresh(); } });
      b.disabled = !enabled;
      return b;
    };
    this.showEl.replaceChildren(h('div', { class: 'fab-show-row' },
      opt('generated', 'Generated', !!this.generated), opt('opened', this.opened ? this.opened.name : 'Opened', !!this.opened)),
    h('p', { class: 'side-note' }, this.source === 'opened' && this.opened ? `${this.opened.layers.length} files read from ${this.opened.name}${this.opened.skipped.length ? `; not fab files: ${this.opened.skipped.join(', ')}` : ''}.` : this.generated ? 'The generated files, read back as the board house will.' : 'Generate, or open fab files, to see them here.'));
  }

  renderLayers() {
    const ls = this.shown;
    if (!ls.length) { this.layersEl.replaceChildren(h('p', { class: 'side-note' }, 'No layers yet.')); return; }
    const C = this.app.canvasColors('board');
    const rows = ls.map((l) => {
      const on = !this.viewer.hidden.has(l.name);
      const c = h('input', { type: 'checkbox', checked: on, 'aria-label': `Show ${l.label}` });
      c.addEventListener('change', () => { if (c.checked) this.viewer.hidden.delete(l.name); else this.viewer.hidden.add(l.name); this.ws?.view.invalidate(); this.ws?.renderBar(); });
      return h('label', { class: 'fab-layer-row', title: `${l.name}${l.warnings?.length ? `\n${l.warnings.join('\n')}` : ''}` }, c,
        h('span', { class: 'fab-swatch', style: `background:${fabColor(C, l.layer)}` }), h('span', { class: 'fab-layer-label' }, l.label), h('span', { class: 'fab-layer-file' }, l.name),
        l.warnings?.length ? icon('info', 14) : null);
    });
    const all = (on) => { for (const l of ls) { if (on) this.viewer.hidden.delete(l.name); else this.viewer.hidden.add(l.name); } this.renderLayers(); this.ws?.view.invalidate(); };
    this.layersEl.replaceChildren(...rows, h('div', { class: 'layer-actions' },
      button({ label: 'Show all', cls: 'btn-ghost btn-xs', onClick: () => all(true) }), button({ label: 'Hide all', cls: 'btn-ghost btn-xs', onClick: () => all(false) })));
  }

  renderFiles() {
    if (!this.files) { this.filesEl.replaceChildren(h('p', { class: 'side-note' }, 'Nothing generated yet. Press Generate.')); return; }
    const total = this.zip?.length || 0;
    this.filesEl.replaceChildren(...[
      this.stale ? h('div', { class: 'outline-state bad' }, icon('info', 16), h('span', {}, 'The board has changed since: Generate again.')) : null,
      h('div', { class: 'fab-list', role: 'list' }, ...this.files.map((x) => h('div', { class: 'fab-file', role: 'listitem', title: x.layer },
        icon(x.kind === 'drill' ? 'via' : x.kind === 'gerber' ? 'gerber' : 'stats', 14), h('span', { class: 'fab-name' }, x.name), h('span', { class: 'fab-layer' }, x.layer), h('span', { class: 'fab-size' }, kb(x.text.length)),
        // the BOM and pick-and-place can be saved on their own too (#27)
        x.kind === 'bom' || x.kind === 'pnp' ? button({ icon: 'import', cls: 'btn-ghost btn-xs', title: `Save ${x.name} on its own`, onClick: () => this.saveFile(x) }) : null))),
      h('p', { class: 'side-note' }, `${this.files.length} files · zip ${kb(total)} · made ${new Date(this.made.date).toLocaleTimeString()}`)].filter(Boolean));
  }

  renderCompare() {
    const c = this.compare;
    if (!c) { this.cmpEl.replaceChildren(h('p', { class: 'side-note' }, 'Compare with… checks the generated files against a reference set (what a board house built before, or another tool\'s output), layer by layer.')); return; }
    if (c.running) { this.cmpEl.replaceChildren(h('div', { class: 'outline-state wait' }, icon('info', 16), h('span', {}, `Comparing with ${c.name}…`))); return; }
    if (c.error) { this.cmpEl.replaceChildren(h('div', { class: 'outline-state bad' }, icon('info', 16), h('span', {}, c.error))); return; }
    const r = c.result;
    const rows = r.layers.map((e) => {
      const k = e.missing ? 'miss' : e.stats.match >= 0.999 ? 'ok' : e.stats.match >= 0.98 ? 'close' : 'bad';
      const txt = e.missing ? (e.missing === 'theirs' ? 'not in theirs' : 'not in ours') : pct(e.stats.match);
      const row = h('button', { class: `fab-cmp-row ${k}${c.selected === e.layer ? ' active' : ''}`, type: 'button', title: e.missing ? `${e.label}: only one set has it` : `${e.label}\nours ${e.stats.ours} mm² · theirs ${e.stats.theirs} mm²\nonly ours ${e.stats.onlyOurs} mm² · only theirs ${e.stats.onlyTheirs} mm² (beyond 0.05 mm)${expected(e, this.project) ? `\n${expected(e, this.project)}` : ''}\nClick to see the differences.` },
        h('span', { class: 'fab-cmp-label' }, e.label), h('span', { class: 'fab-cmp-bar' }, h('span', { style: `width:${e.missing ? 0 : Math.max(2, e.stats.match * 100)}%` })), h('span', { class: 'fab-cmp-pct' }, txt));
      row.disabled = !!e.missing;
      row.addEventListener('click', () => this.showDiff(c.selected === e.layer ? null : e.layer));
      return row;
    });
    const sel = r.layers.find((e) => e.layer === c.selected);
    const why = sel && expected(sel, this.project);
    this.cmpEl.replaceChildren(...[
      h('p', { class: 'side-note' }, `Against ${c.name}: ${r.align.by === 'drills' ? `lined up by ${r.align.matched} of ${r.align.of} drill holes` : r.align.by === 'outline' ? 'lined up by the outline' : 'not moved'}${r.align.offset[0] || r.align.offset[1] ? ` (theirs moved ${(r.align.offset[0] / 1e6).toFixed(3)}, ${(-r.align.offset[1] / 1e6).toFixed(3)} mm)` : ''}.`),
      h('div', { class: 'fab-cmp' }, ...rows),
      sel ? h('div', { class: 'fab-cmp-legend' }, h('span', { class: 'only-ours' }, 'only ours'), h('span', { class: 'only-theirs' }, 'only theirs'), h('span', { class: 'shared' }, 'both')) : h('p', { class: 'side-note' }, 'Click a layer to see where they differ (differences closer than 0.05 mm aren\'t counted).'),
      why ? h('p', { class: 'side-note' }, why) : null,
      h('div', { class: 'layer-actions' },
        button({ label: 'Copy report', icon: 'copy', cls: 'btn-ghost btn-xs', title: 'Copy the comparison as text', onClick: () => this.copyCompare() }),
        button({ label: 'Clear', cls: 'btn-ghost btn-xs', onClick: () => { this.compare = null; this.viewer.diff = null; this.viewer.hidden.clear(); this.refresh(); this.ws?.view.invalidate(); } }))].filter(Boolean));
  }

  /** Show one compared layer's differences (or none). */
  showDiff(layer) {
    const c = this.compare;
    if (!c?.result) return;
    c.selected = layer;
    const e = c.result.layers.find((x) => x.layer === layer);
    if (this.source !== 'generated') { this.source = 'generated'; this._show(); }
    this.viewer.setDiff(e, c.result.frame);
    // only the compared layer's own files show under the overlay
    if (layer) for (const l of this.viewer.layers) { if (layer === 'drills' ? l.kind === 'drill' : l.layer === layer) this.viewer.hidden.delete(l.name); else this.viewer.hidden.add(l.name); }
    else this.viewer.hidden.clear();
    this.refresh();
    this.ws?.view.invalidate();
  }

  /** The comparison as text, for a report. */
  compareText() {
    const c = this.compare;
    if (!c?.result) return '';
    const r = c.result, L = [];
    L.push(`ElectroCAD fab comparison · ${this.project.name} against ${c.name}`, `ElectroCAD ${VERSION} · ${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC`);
    L.push(`Alignment: ${r.align.by}${r.align.matched ? ` (${r.align.matched} of ${r.align.of} holes)` : ''}, theirs moved ${(r.align.offset[0] / 1e6).toFixed(3)}, ${(-r.align.offset[1] / 1e6).toFixed(3)} mm; grid ${(r.frame.res / 1000).toFixed(0)} µm, tolerance 0.05 mm`, '');
    for (const e of r.layers) {
      if (e.missing) { L.push(`${e.label.padEnd(18)} only in ${e.missing === 'theirs' ? 'ours' : 'theirs'} (${[...e.ours, ...e.theirs].join(', ')})`); continue; }
      L.push(`${e.label.padEnd(18)} ${pct(e.stats.match).padStart(8)}  ours ${e.stats.ours} mm², theirs ${e.stats.theirs} mm², only ours ${e.stats.onlyOurs} mm², only theirs ${e.stats.onlyTheirs} mm²${expected(e, this.project) ? `  (${expected(e, this.project)})` : ''}`);
    }
    if (c.skipped?.length) L.push('', `Not fab files: ${c.skipped.join(', ')}`);
    if (c.warnings?.length) L.push('', 'Reading theirs:', ...c.warnings.map((w) => `- ${w}`));
    return L.join('\n') + '\n';
  }

  async copyCompare() {
    try { await navigator.clipboard.writeText(this.compareText()); toast('Comparison copied', 'info', 2000); } catch { toast('Couldn\'t reach the clipboard.', 'error', 4000); }
  }

  renderChecks() {
    const b = this.project.board, rows = [];
    if (this.source === 'opened' && this.opened) {
      // an opened set: what a board house needs that isn't there
      const have = new Set(this.opened.layers.map((l) => l.layer));
      const need = [['F.Cu', 'top copper'], ['B.Cu', 'bottom copper'], ['F.Mask', 'top mask'], ['B.Mask', 'bottom mask'], ['Edge.Cuts', 'outline']];
      const missing = need.filter(([k]) => !have.has(k)).map(([, t]) => t);
      if (!['PTH', 'NPTH', 'Drill'].some((k) => have.has(k))) missing.push('drill file');
      rows.push([missing.length ? 'bad' : 'ok', missing.length ? `Missing: ${missing.join(', ')}.` : 'Every layer a board house needs is here.']);
      if (!have.has('F.SilkS') && !have.has('B.SilkS')) rows.push(['bad', 'No silk layer (fine if there is meant to be none).']);
      if (have.has('Unknown')) rows.push(['bad', `Files whose layer isn't known: ${this.opened.layers.filter((l) => l.layer === 'Unknown').map((l) => l.name).join(', ')}.`]);
      const w = this.opened.layers.flatMap((l) => (l.warnings || []).map((x) => `${l.name}: ${x}`));
      if (w.length) rows.push(['bad', `Read with notes: ${w.slice(0, 4).join('; ')}${w.length > 4 ? '…' : ''}`]);
    } else {
      const oc = checkOutline(b.outline || []);
      if (!oc.closed) rows.push(['bad', oc.problems.join(' ') || 'The Outline isn\'t closed.']);
      if (!b.footprints.length) rows.push(['bad', 'No footprints on the Board yet: Update from Schematic (F8) on the Board tab.']);
      if (this.generated) {
        const have = new Set(this.generated.layers.map((l) => l.layer));
        const missing = FAB_LAYERS.filter(([k]) => /^(F|B)\.(Cu|Mask|SilkS)$|^Edge\.Cuts$/.test(k) || (b.stack.copper === 4 && /^In[12]\.Cu$/.test(k))).filter(([k]) => !have.has(k)).map(([, t]) => t);
        if (missing.length) rows.push(['bad', `Not generated: ${missing.join(', ')} (see Output).`]);
      }
      if (this.drc) {
        const c = drcCounts(this.drc);
        rows.push([c.error ? 'bad' : 'ok', c.error || c.warning ? `DRC at generation: ${c.error} error${c.error === 1 ? '' : 's'}, ${c.warning} warning${c.warning === 1 ? '' : 's'}` : 'DRC at generation: no problems']);
      }
    }
    this.checksEl.replaceChildren(...[...(rows.length ? rows.map(([k, t]) => h('div', { class: `outline-state ${k}` }, icon(k === 'ok' ? 'check' : 'info', 16), h('span', {}, t))) : [h('p', { class: 'side-note' }, 'Generate to run DRC on the Board as it goes out.')]),
      this.source !== 'opened' && this.drc && drcCounts(this.drc).error ? button({ label: 'Show DRC on the Board', icon: 'erc', cls: 'btn-outline btn-xs', onClick: () => { this.app.setWorkspace('board'); this.app.workspace('board').editor.runDrc(); } }) : null].filter(Boolean));
  }

  /** Make the fab files (after any Zone refill in progress), and their zip. Returns the files. */
  async generate() {
    if (!Object.values(this.out).some(Boolean)) return null;
    this.genBtn.disabled = true;
    try {
      const be = this.app.workspace('board')?.editor;
      be?.zoneFiller.update(this.project);
      await be?.whenZonesFilled();
      const fills = be?.zoneFiller.fills || new Map();
      const date = new Date();
      let files = fabFiles(this.project, { fills, date: date.toISOString(), version: VERSION });
      files = files.filter((x) => (x.kind === 'gerber' ? this.out.gerber : this.out.drill));
      files = [...files, ...assemblyFiles(this.project, { bom: this.out.bom, pnp: this.out.pnp })];
      this.files = files;
      this.zip = makeZip(files, date);
      this.made = { rev: this._rev(), date: date.getTime() };
      // approved problems (#69) don't count
      this.drc = unapproved(markApproved(this.project, runDrc(this.project, fills)));
      this.generated = readFabFiles(files.filter((f) => f.kind === 'gerber' || f.kind === 'drill').map((f) => ({ name: f.name, text: f.text })));
      this.zipBtn.disabled = false;
      const first = !this.viewer.layers.length;
      if (this.source === 'generated' || !this.opened) { this.source = 'generated'; this._show(first); }
      this.refresh();
      this.app.workspace('gerber')?.renderBar();
      const c = drcCounts(this.drc);
      toast(`${files.length} fab files made${c.error ? ` · DRC: ${c.error} error${c.error === 1 ? '' : 's'}` : ''}.`, c.error ? 'error' : 'info', 2600);
      return files;
    } finally { this.genBtn.disabled = false; }
  }

  /** Save one generated file on its own (the BOM or pick-and-place CSV). */
  async saveFile(f) {
    const r = await platform.exportFile(f.name, f.text, 'csv');
    if (r) toast(`Saved ${r.name}`, 'info', 2500);
    return r;
  }

  async download() {
    if (!this.zip) return null;
    const name = `${fabBaseName(this.project)}-fab.zip`;
    const r = await platform.exportFile(name, this.zip, 'zip');
    if (r) toast(`Saved ${r.name}`, 'info', 2500);
    return r;
  }

  /** Pick fab files (a zip, or loose files) and read them: { name, texts } or null. */
  async _pick() {
    let picked;
    try { picked = await platform.importFabFiles(); } catch (err) { toast(`Couldn't read those files: ${err.message || err}`, 'error', 6000); return null; }
    if (!picked?.length) return null;
    try {
      const texts = await fabTexts(picked);
      return { name: picked.length === 1 ? picked[0].name : `${picked.length} files`, texts };
    } catch (err) { toast(String(err.message || err), 'error', 7000); return null; }
  }

  /** View fab files from disk (`files`: [{ name, bytes }] to skip the dialog, for tests). */
  async openFiles(files = null) {
    const got = files ? { name: files.length === 1 ? files[0].name : `${files.length} files`, texts: await fabTexts(files) } : await this._pick();
    if (!got) return null;
    const r = readFabFiles(got.texts);
    if (!r.layers.length) { toast(`No Gerber or drill files in ${got.name}.`, 'error', 6000); return null; }
    this.opened = { name: got.name, layers: r.layers, skipped: r.skipped, texts: got.texts };
    this.source = 'opened';
    if (this.compare) this.compare.selected = null;
    this.viewer.diff = null;
    this._show(true);
    this.refresh();
    this.ws?.renderBar();
    return this.opened;
  }

  /** Compare the generated files (made now if needed) with a reference set picked from disk. */
  async compareWith(files = null) {
    const got = files ? { name: files.length === 1 ? files[0].name : `${files.length} files`, texts: await fabTexts(files) } : await this._pick();
    if (!got) return null;
    if (!this.files || this.stale) await this.generate();
    if (!this.files) return null;
    this.compare = { name: got.name, running: true };
    this.cmpBtn.disabled = true;
    this.renderCompare();
    const seq = (this._seq = (this._seq || 0) + 1);
    const worker = (this._worker ||= new Worker(new URL('./compareWorker.js', import.meta.url), { type: 'module' }));
    const msg = await new Promise((resolve) => {
      worker.onmessage = (e) => { if (e.data.seq === seq) resolve(e.data); };
      worker.onerror = (e) => resolve({ seq, error: e.message || 'The comparison stopped.' });
      worker.postMessage({ seq, ours: this.files.map((f) => ({ name: f.name, text: f.text })), theirs: got.texts, res: 25_000, tol: 50_000 });
    });
    this.cmpBtn.disabled = false;
    if (seq !== this._seq) return null;
    this.compare = msg.error ? { name: got.name, error: `Couldn't compare: ${msg.error}` } : { name: got.name, result: msg.result, skipped: msg.skipped, warnings: msg.theirWarnings, selected: null };
    if (this.source !== 'generated') { this.source = 'generated'; this._show(true); }
    this.refresh();
    return this.compare;
  }

  status() {
    const parts = [];
    if (this.files) parts.push(`${this.files.length} files · ${kb(this.zip.length)}${this.stale ? ' · out of date' : ''}`);
    else parts.push('No files');
    if (this.source === 'opened' && this.opened) parts.push(`showing ${this.opened.name}`);
    if (this.viewer.side === 'bottom') parts.push('bottom view');
    if (this.compare?.result) {
      const ok = this.compare.result.layers.filter((e) => !e.missing && e.stats.match >= 0.999).length;
      parts.push(`compared: ${ok} of ${this.compare.result.layers.filter((e) => !e.missing).length} layers match`);
    }
    return parts.join(' · ');
  }
}
