// Print / export the Schematic (#14): each Sheet on its own paper (A4…Tabloid, #59) with the
// title block and a border, drawn by the same code as the editor into SVG or a multi-page PDF.
// Print colours don't follow the editor's theme: ElectroCAD Light (default), Classic paper, or
// black and white.
import { drawSheet, DEFAULT_DISPLAY, textStyle, setTextStyle, measureText } from '../schematic/render.js';
import { paperRect } from '../core/drawings.js';
import { placeFields } from '../core/fields.js';
import { resolveTheme, MATCH_APP } from '../core/themes.js';
import { SvgContext, PdfContext, buildPdf } from './vector.js';
import { mm } from '../core/units.js';

/** Output units per nm: 8 units per mm, so the renderer's on-screen minimum sizes look right on paper. */
const UNITS_PER_MM = 8;
const K = UNITS_PER_MM / 1e6;
const PT_PER_UNIT = 72 / 25.4 / UNITS_PER_MM;

export const PRINT_COLOURS = {
  light: 'ElectroCAD Light',
  classic: 'Classic paper',
  mono: 'Black and white',
};

/** The colour set for printing. */
export function printColors(mode = 'light') {
  if (mode === 'classic') return resolveTheme('schematic', 'classic-paper', 'light');
  const light = resolveTheme('schematic', MATCH_APP, 'light');
  if (mode !== 'mono') return { ...light, paper: '#ffffff' };
  const black = Object.fromEntries(Object.keys(light).map((k) => [k, '#000000']));
  return { ...black, background: '#ffffff', paper: '#ffffff', symbolFill: '#ffffff', gridMinor: '#ffffff', gridMajor: '#ffffff' };
}

/** Print display: no editor-only marks (unconnected pin rings, ERC markers, selection). */
const PRINT_DISPLAY = { ...DEFAULT_DISPLAY, markUnconnectedPins: false, colorConnectedPins: false };

/** Draw one Sheet onto a vector context: white paper, a border, then the Schematic itself. */
function drawPage(ctx, project, sheet, C, measure) {
  const r = paperRect(sheet);
  const view = { scale: K, toScreen: ([x, y]) => [x * K, y * K], toWorld: ([x, y]) => [x / K, y / K] };
  ctx.fillStyle = C.paper; ctx.fillRect(0, 0, r.x1 * K, r.y1 * K);
  const m = mm(5) * K;
  ctx.strokeStyle = C.sheetEdge; ctx.lineWidth = Math.max(1, mm(0.25) * K);
  ctx.strokeRect(m, m, r.x1 * K - 2 * m, r.y1 * K - 2 * m);
  const placement = placeFields(project, sheet, { measure });
  drawSheet(ctx, view, C, project, sheet, { selection: new Set(), placement, display: PRINT_DISPLAY });
}

/**
 * Draw with a text style for the duration (#79): 'vector' (the vector font, as on screen) or 'sans'
 * (real, searchable text in Helvetica), then put the screen's style back.
 */
function withTextStyle(style, fn) {
  const was = textStyle();
  setTextStyle(style || was);
  try { return fn(); } finally { setTextStyle(was); }
}

/** One Sheet as an SVG document (its paper size in mm). */
export function sheetToSvg(project, sheet, { colours = 'light', measure, textStyle: style } = {}) {
  return withTextStyle(style, () => {
    const r = paperRect(sheet);
    const ctx = new SvgContext(r.x1 * K, r.y1 * K);
    drawPage(ctx, project, sheet, printColors(colours), measure || measureText);
    return ctx.toString(r.x1 / 1e6, r.y1 / 1e6, `${project.name}: ${sheet.name}`);
  });
}

/** Sheets as one PDF, a page each at the Sheet's paper size. Returns an ASCII string. */
export function sheetsToPdf(project, sheets, { colours = 'light', measure, textStyle: style } = {}) {
  return withTextStyle(style, () => {
    const pages = sheets.map((sheet) => {
      const r = paperRect(sheet);
      const heightPt = (r.y1 / 1e6) * (72 / 25.4), widthPt = (r.x1 / 1e6) * (72 / 25.4);
      const ctx = new PdfContext(PT_PER_UNIT, heightPt);
      drawPage(ctx, project, sheet, printColors(colours), measure || measureText);
      return { ctx, widthPt, heightPt };
    });
    return buildPdf(pages, { title: project.titleBlock?.title || project.name });
  });
}

/** A safe file name for an export: "Amp - Power.svg", "Amp.pdf". */
export function printFileName(project, sheet, ext) {
  const clean = (s) => String(s || '').replace(/[\\/:*?"<>|]+/g, '-').trim();
  return `${clean(project.name) || 'Untitled'}${sheet ? ` - ${clean(sheet.name)}` : ''}.${ext}`;
}
