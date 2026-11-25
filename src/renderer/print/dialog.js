// The Print dialog (#14): which Sheets, which colours, a preview, then Export PDF or SVG. PDF is
// every chosen Sheet in one file (a page each at its paper size); SVG is one Sheet per file.
import { h, button, modal, toast } from '../ui/dom.js';
import { platform } from '../platform.js';
import { sheetToSvg, sheetsToPdf, printFileName, PRINT_COLOURS } from './schematic.js';
import { paperRect } from '../core/drawings.js';
import { measureText, textStyle } from '../schematic/render.js';

const PREF = 'electrocad.printColours', TEXT_PREF = 'electrocad.printText';
const readPref = () => { try { return localStorage.getItem(PREF) || 'light'; } catch { return 'light'; } };
const readText = () => { try { return localStorage.getItem(TEXT_PREF) || textStyle(); } catch { return textStyle(); } };

export function openPrintDialog(app) {
  const project = app.project;
  const sheets = project.schematic.sheets;
  const current = app.workspace('schematic')?.editor?.sheet || sheets[0];
  const m = modal({ title: 'Print / export schematic', width: 640, cls: 'print-modal' });
  const which = h('select', { class: 'select', 'aria-label': 'Sheets' },
    h('option', { value: 'all' }, `All sheets (${sheets.length})`), ...sheets.map((s, i) => h('option', { value: s.id }, `${i + 1}. ${s.name}`)));
  which.value = sheets.length > 1 ? 'all' : current.id;
  const colours = h('select', { class: 'select', 'aria-label': 'Colours' }, ...Object.entries(PRINT_COLOURS).map(([k, v]) => h('option', { value: k }, v)));
  colours.value = readPref();
  // the vector font (as on screen), or real text a PDF reader can search and copy (#79)
  const textSel = h('select', { class: 'select', 'aria-label': 'Text' }, h('option', { value: 'vector' }, 'Vector font (as on screen)'), h('option', { value: 'sans' }, 'Searchable text (Helvetica)'));
  textSel.value = readText();
  const img = h('img', { class: 'print-preview', alt: 'Preview of the first page' });
  const info = h('div', { class: 'print-info' });
  const chosen = () => (which.value === 'all' ? sheets : sheets.filter((s) => s.id === which.value));
  const preview = () => {
    const s = chosen()[0];
    const svg = sheetToSvg(project, s, { colours: colours.value, measure: measureText, textStyle: textSel.value });
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    const r = paperRect(s);
    info.textContent = `${chosen().length === 1 ? s.name : `${chosen().length} sheets, first: ${s.name}`} · ${s.paper?.size || 'A4'} ${s.paper?.orientation || 'landscape'} (${Math.round(r.x1 / 1e6)} × ${Math.round(r.y1 / 1e6)} mm)`;
    svgBtn.disabled = chosen().length !== 1;
    svgBtn.title = chosen().length === 1 ? 'One SVG file for this sheet' : 'SVG is one sheet per file: pick a sheet above';
  };
  const save = async (kind) => {
    try { localStorage.setItem(PREF, colours.value); localStorage.setItem(TEXT_PREF, textSel.value); } catch { /* private window */ }
    const list = chosen();
    const text = kind === 'pdf'
      ? sheetsToPdf(project, list, { colours: colours.value, measure: measureText, textStyle: textSel.value })
      : sheetToSvg(project, list[0], { colours: colours.value, measure: measureText, textStyle: textSel.value });
    const name = printFileName(project, kind === 'pdf' && list.length > 1 ? null : list[0], kind);
    const r = await platform.exportFile(name, text, kind);
    if (r) { toast(`Saved ${r.name}`, 'info', 2500); m.close(); }
  };
  const svgBtn = button({ label: 'Export SVG', icon: 'export', cls: 'btn-outline', onClick: () => save('svg') });
  which.addEventListener('change', preview);
  colours.addEventListener('change', preview);
  textSel.addEventListener('change', preview);
  m.body.append(
    h('div', { class: 'print-grid' },
      h('div', { class: 'print-side' },
        h('label', { class: 'field' }, h('span', {}, 'Sheets'), which),
        h('label', { class: 'field' }, h('span', {}, 'Colours'), colours),
        h('label', { class: 'field' }, h('span', {}, 'Text'), textSel),
        h('p', { class: 'side-note' }, 'Each sheet prints on its own paper size (Sheet setup), with the title block. PDF opens in any viewer for printing.')),
      h('div', { class: 'print-view' }, img, info)),
    h('div', { class: 'modal-actions' }, button({ label: 'Cancel', cls: 'btn-outline', onClick: () => m.close() }), svgBtn,
      button({ label: 'Export PDF', icon: 'print', cls: 'btn-primary', onClick: () => save('pdf') })));
  preview();
  return m;
}
