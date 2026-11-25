// The Gerber tab's side panel and commands (#26): the Fab preset, which outputs to make, Generate
// (after any Zone refill in progress) and Download zip, the files made, and the checks worth
// knowing before ordering (DRC, an open Outline). Rendering the files back is #28.
import { h, button, icon, toast } from '../ui/dom.js';
import { section } from '../workspaces/workspace.js';
import { presetState, fabSettings } from '../core/presets.js';
import { fabFiles, fabBaseName } from '../core/fab.js';
import { makeZip } from '../core/zip.js';
import { runDrc, drcCounts } from '../core/drc.js';
import { checkOutline } from '../core/board.js';
import { platform } from '../platform.js';
import { openBoardSetup } from '../board/setup-dialog.js';

const VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';
const kb = (n) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} kB`);

export class GerberPanel {
  constructor(app) {
    this.app = app;
    this.files = null;   // the last generated files
    this.zip = null;     // and their zip (Uint8Array)
    this.made = null;    // { rev, date } they were made for
    this.out = { gerber: true, drill: true };
  }

  get project() { return this.app.project; }

  toolbar() {
    this.genBtn = button({ label: 'Generate', icon: 'play', cls: 'btn-primary', title: 'Make the fab files: Gerber X2 for each layer and Excellon drill files (waits for zone fills)', onClick: () => this.generate() });
    this.zipBtn = button({ label: 'Download zip', icon: 'zip', title: 'Save the fab zip to send to the board house', onClick: () => this.download() });
    this.zipBtn.disabled = true;
    return [this.genBtn, this.zipBtn];
  }

  side() {
    this.presetEl = h('div', { class: 'outline-state ok' });
    this.filesEl = h('div', { class: 'fab-files' });
    this.checksEl = h('div', { class: 'fab-checks' });
    const out = (key, label, tip) => {
      const c = h('input', { type: 'checkbox', checked: this.out[key], 'aria-label': label });
      c.addEventListener('change', () => { this.out[key] = c.checked; this.genBtn.disabled = !this.out.gerber && !this.out.drill; });
      return h('label', { class: 'check-row', title: tip }, c, label);
    };
    const later = (label, ticket) => h('label', { class: 'check-row', title: `Coming in #${ticket}` }, h('input', { type: 'checkbox', disabled: true }), label);
    this.namingEl = h('p', { class: 'side-note' });
    return h('div', { class: 'side-panel gerber-side' },
      section('Fab preset', h('div', { class: 'gerber-preset' }, this.presetEl,
        button({ label: 'Board setup…', icon: 'settings', cls: 'btn-outline', title: 'Choose a Fab preset and edit the Design rules and Fab output settings', onClick: () => openBoardSetup(this.app) }))),
      section('Output', out('gerber', 'Gerber X2 (copper, mask, paste, silk, Edge.Cuts)', 'One RS-274X file with X2 attributes per layer of the stack'),
        out('drill', 'Excellon drill (PTH / NPTH)', 'Plated holes (vias, plated pads) and non-plated holes, in separate files'),
        later('BOM (CSV)', 27), later('Pick-and-place (CSV)', 27), this.namingEl),
      section('Files', this.filesEl),
      section('Checks', this.checksEl));
  }

  /** Is what was made still the Board as it is? */
  get stale() { return !!this.made && this.made.rev !== this._rev(); }
  _rev() { const hs = this.app.history; return `${hs.undoStack.length}:${hs.undoStack[hs.undoStack.length - 1]?.label || ''}:${this.project.id}`; }

  refresh() {
    if (!this.presetEl) return;
    const b = this.project.board, st = presetState(b), f = fabSettings(b);
    this.presetEl.replaceChildren(icon(st.mismatch ? 'info' : 'check', 16), h('span', {}, `${st.name}${st.edited.length ? ' (edited)' : ''}${st.mismatch ? ` · for ${st.preset.copper}-layer boards` : ''}`));
    this.presetEl.className = `outline-state ${st.mismatch ? 'bad' : 'ok'}`;
    this.namingEl.textContent = `${f.naming === 'protel' ? 'Protel file names (.GTL, .GBL…)' : 'Descriptive file names (-F_Cu.gbr…)'}, drills in ${f.drillUnits === 'inch' ? 'inches' : 'mm'}: set in Board setup.`;
    this.renderFiles();
    this.renderChecks();
  }

  renderFiles() {
    if (!this.files) { this.filesEl.replaceChildren(h('p', { class: 'side-note' }, 'Nothing generated yet. Press Generate.')); return; }
    const total = this.zip?.length || 0;
    this.filesEl.replaceChildren(...[
      this.stale ? h('div', { class: 'outline-state bad' }, icon('info', 16), h('span', {}, 'The board has changed since: Generate again.')) : null,
      h('div', { class: 'fab-list', role: 'list' }, ...this.files.map((x) => h('div', { class: 'fab-file', role: 'listitem', title: x.layer },
        icon(x.kind === 'drill' ? 'via' : 'gerber', 14), h('span', { class: 'fab-name' }, x.name), h('span', { class: 'fab-layer' }, x.layer), h('span', { class: 'fab-size' }, kb(x.text.length))))),
      h('p', { class: 'side-note' }, `${this.files.length} files · zip ${kb(total)} · made ${new Date(this.made.date).toLocaleTimeString()}`)].filter(Boolean));
  }

  renderChecks() {
    const b = this.project.board, rows = [];
    const oc = checkOutline(b.outline || []);
    if (!oc.closed) rows.push(['bad', oc.problems.join(' ') || 'The Outline isn\'t closed.']);
    if (!b.footprints.length) rows.push(['bad', 'No footprints on the Board yet: Update from Schematic (F8) on the Board tab.']);
    if (this.drc) {
      const c = drcCounts(this.drc);
      rows.push([c.error ? 'bad' : 'ok', c.error || c.warning ? `DRC at generation: ${c.error} error${c.error === 1 ? '' : 's'}, ${c.warning} warning${c.warning === 1 ? '' : 's'}` : 'DRC at generation: no problems']);
    }
    this.checksEl.replaceChildren(...[...(rows.length ? rows.map(([k, t]) => h('div', { class: `outline-state ${k}` }, icon(k === 'ok' ? 'check' : 'info', 16), h('span', {}, t))) : [h('p', { class: 'side-note' }, 'Generate to run DRC on the Board as it goes out.')]),
      this.drc && drcCounts(this.drc).error ? button({ label: 'Show DRC on the Board', icon: 'erc', cls: 'btn-outline btn-xs', onClick: () => { this.app.setWorkspace('board'); this.app.workspace('board').editor.runDrc(); } }) : null].filter(Boolean));
  }

  /** Make the fab files (after any Zone refill in progress), and their zip. Returns the files. */
  async generate() {
    if (!this.out.gerber && !this.out.drill) return null;
    this.genBtn.disabled = true;
    try {
      const be = this.app.workspace('board')?.editor;
      be?.zoneFiller.update(this.project);
      await be?.whenZonesFilled();
      const fills = be?.zoneFiller.fills || new Map();
      const date = new Date();
      let files = fabFiles(this.project, { fills, date: date.toISOString(), version: VERSION });
      files = files.filter((x) => (x.kind === 'gerber' ? this.out.gerber : this.out.drill));
      this.files = files;
      this.zip = makeZip(files, date);
      this.made = { rev: this._rev(), date: date.getTime() };
      this.drc = runDrc(this.project, fills);
      this.zipBtn.disabled = false;
      this.refresh();
      this.app.workspace('gerber')?.renderBar();
      const c = drcCounts(this.drc);
      toast(`${files.length} fab files made${c.error ? ` · DRC: ${c.error} error${c.error === 1 ? '' : 's'}` : ''}.`, c.error ? 'error' : 'info', 2600);
      return files;
    } finally { this.genBtn.disabled = false; }
  }

  async download() {
    if (!this.zip) return null;
    const name = `${fabBaseName(this.project)}-fab.zip`;
    const r = await platform.exportFile(name, this.zip, 'zip');
    if (r) toast(`Saved ${r.name}`, 'info', 2500);
    return r;
  }

  status() {
    if (!this.files) return 'No files';
    return `${this.files.length} files · ${kb(this.zip.length)}${this.stale ? ' · out of date' : ''}`;
  }
}
