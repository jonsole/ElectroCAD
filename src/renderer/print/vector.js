// Vector output (#14): two stand-ins for CanvasRenderingContext2D that turn the Schematic's own
// drawing code (schematic/render.js) into SVG or PDF, so exports match the screen exactly.
// They support the subset of the canvas API the renderer uses: paths (moveTo, lineTo, arc,
// ellipse, rect, roundRect, closePath), fill/stroke, strokeRect/fillRect, fillText, clip,
// save/restore, translate/rotate/scale, line style, dashes, alpha and fonts.
//
// Coordinates come in "units" chosen by the caller (the print view uses 8 units per mm, so the
// renderer's screen-pixel minimums still look right). PDF text uses the standard Helvetica
// fonts (not embedded) with their published widths, so alignment is exact. DOM-free.

// ---------------------------------------------------------------- shared state and paths

const IDENTITY = [1, 0, 0, 1, 0, 0];
const mul = ([a, b, c, d, e, f], [A, B, C, D, E, F]) => [a * A + c * B, b * A + d * B, a * C + c * D, b * C + d * D, a * E + c * F + e, b * E + d * F + f];
const apply = ([a, b, c, d, e, f], [x, y]) => [a * x + c * y + e, b * x + d * y + f];
const KAPPA = 0.5522847498;

/** The parts of a CSS font string the renderer writes: '600 italic 12px "Segoe UI", …'. */
export function parseFont(font) {
  const m = /(\d+(?:\.\d+)?)px/.exec(font || '');
  return { size: m ? Number(m[1]) : 10, bold: /\b(bold|[6-9]00)\b/.test(font || ''), italic: /\bitalic\b/.test(font || '') };
}

/** '#rgb', '#rrggbb' or 'rgb(a)(…)' -> [r, g, b, a] in 0..1. */
export function parseColor(c) {
  if (typeof c !== 'string') return [0, 0, 0, 1];
  let m = /^#([0-9a-f]{3})$/i.exec(c);
  if (m) return [...m[1]].map((x) => parseInt(x + x, 16) / 255).concat(1);
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(c);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255).concat(m[2] ? parseInt(m[2], 16) / 255 : 1);
  m = /^rgba?\(([^)]+)\)$/i.exec(c);
  if (m) { const p = m[1].split(',').map((x) => parseFloat(x)); return [p[0] / 255, p[1] / 255, p[2] / 255, p[3] ?? 1]; }
  return [0, 0, 0, 1];
}

// Helvetica and Helvetica-Bold advance widths (per 1000 em) for ASCII 32–126 (Adobe AFM).
const HELV = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const HELV_BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];

/** Width of `text` in Helvetica at `size` (same units as size). */
export function helveticaWidth(text, size, bold = false) {
  const t = bold ? HELV_BOLD : HELV;
  let w = 0;
  for (const ch of String(text)) { const c = ch.charCodeAt(0); w += c >= 32 && c <= 126 ? t[c - 32] : 556; }
  return (w / 1000) * size;
}

class VectorContext {
  constructor() {
    this.s = { m: IDENTITY, strokeStyle: '#000', fillStyle: '#000', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter', font: '10px sans-serif', textAlign: 'start', textBaseline: 'alphabetic', globalAlpha: 1, dash: [] };
    this.stack = [];
    this.path = [];
    this.shadowColor = ''; this.shadowBlur = 0;
  }
  // state
  save() { this.stack.push({ ...this.s, dash: [...this.s.dash] }); this.onSave(); }
  restore() { const s = this.stack.pop(); if (s) { this.s = s; this.onRestore(); } }
  translate(x, y) { this.s.m = mul(this.s.m, [1, 0, 0, 1, x, y]); }
  scale(x, y) { this.s.m = mul(this.s.m, [x, 0, 0, y, 0, 0]); }
  rotate(a) { const c = Math.cos(a), s = Math.sin(a); this.s.m = mul(this.s.m, [c, s, -s, c, 0, 0]); }
  setLineDash(d) { this.s.dash = [...(d || [])]; }
  getLineDash() { return [...this.s.dash]; }
  onSave() {} onRestore() {}
  // style properties (the renderer assigns these)
  get strokeStyle() { return this.s.strokeStyle; } set strokeStyle(v) { this.s.strokeStyle = v; }
  get fillStyle() { return this.s.fillStyle; } set fillStyle(v) { this.s.fillStyle = v; }
  get lineWidth() { return this.s.lineWidth; } set lineWidth(v) { this.s.lineWidth = v; }
  get lineCap() { return this.s.lineCap; } set lineCap(v) { this.s.lineCap = v; }
  get lineJoin() { return this.s.lineJoin; } set lineJoin(v) { this.s.lineJoin = v; }
  get font() { return this.s.font; } set font(v) { this.s.font = v; }
  get textAlign() { return this.s.textAlign; } set textAlign(v) { this.s.textAlign = v; }
  get textBaseline() { return this.s.textBaseline; } set textBaseline(v) { this.s.textBaseline = v; }
  get globalAlpha() { return this.s.globalAlpha; } set globalAlpha(v) { this.s.globalAlpha = v; }
  // paths, kept in output coordinates (the transform is applied as points are added)
  beginPath() { this.path = []; }
  moveTo(x, y) { this.path.push(['M', apply(this.s.m, [x, y])]); }
  lineTo(x, y) { if (!this.path.length) return this.moveTo(x, y); this.path.push(['L', apply(this.s.m, [x, y])]); }
  closePath() { this.path.push(['Z']); }
  bezierCurveTo(x1, y1, x2, y2, x, y) { this.path.push(['C', apply(this.s.m, [x1, y1]), apply(this.s.m, [x2, y2]), apply(this.s.m, [x, y])]); }
  rect(x, y, w, h) { this.moveTo(x, y); this.lineTo(x + w, y); this.lineTo(x + w, y + h); this.lineTo(x, y + h); this.closePath(); }
  roundRect(x, y, w, h, r = 0) {
    r = Math.min(Math.abs(r), Math.abs(w) / 2, Math.abs(h) / 2);
    this.moveTo(x + r, y); this.lineTo(x + w - r, y); this.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
    this.lineTo(x + w, y + h - r); this.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
    this.lineTo(x + r, y + h); this.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
    this.lineTo(x, y + r); this.arc(x + r, y + r, r, Math.PI, Math.PI * 1.5); this.closePath();
  }
  arc(cx, cy, r, a0, a1, ccw = false) { this.ellipse(cx, cy, r, r, 0, a0, a1, ccw); }
  /** Arcs become cubic Béziers of at most 90° each (exact enough for print). */
  ellipse(cx, cy, rx, ry, rot, a0, a1, ccw = false) {
    let sweep = a1 - a0;
    if (!ccw && sweep < 0) sweep = (sweep % (2 * Math.PI)) + 2 * Math.PI;
    if (ccw && sweep > 0) sweep = (sweep % (2 * Math.PI)) - 2 * Math.PI;
    if (Math.abs(a1 - a0) >= 2 * Math.PI - 1e-9) sweep = ccw ? -2 * Math.PI : 2 * Math.PI;
    const n = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9));
    const step = sweep / n, k = (4 / 3) * Math.tan(step / 4);
    const cr = Math.cos(rot), sr = Math.sin(rot);
    const P = (a, dx = 0, dy = 0) => { const x = rx * Math.cos(a) + dx, y = ry * Math.sin(a) + dy; return [cx + x * cr - y * sr, cy + x * sr + y * cr]; };
    const start = P(a0);
    if (this.path.length && this.path[this.path.length - 1][0] !== 'Z') this.lineTo(...start); else this.moveTo(...start);
    for (let i = 0; i < n; i++) {
      const s = a0 + i * step, e = s + step;
      const c1 = P(s, -k * rx * Math.sin(s), k * ry * Math.cos(s));
      const c2 = P(e, k * rx * Math.sin(e), -k * ry * Math.cos(e));
      const end = P(e);
      // the control points are offsets along the tangent
      this.bezierCurveTo(c1[0], c1[1], c2[0], c2[1], end[0], end[1]);
    }
  }
  fill() { this.emitPath(this.path, 'fill'); }
  stroke() { this.emitPath(this.path, 'stroke'); }
  clip() { this.emitClip(this.path); }
  fillRect(x, y, w, h) { const p = this.path; this.beginPath(); this.rect(x, y, w, h); this.fill(); this.path = p; }
  strokeRect(x, y, w, h) { const p = this.path; this.beginPath(); this.rect(x, y, w, h); this.stroke(); this.path = p; }
  measureText(t) { const f = parseFont(this.s.font); return { width: helveticaWidth(t, f.size, f.bold) }; }
  /** The line width as it comes out (the renderer only translates and rotates). */
  get scaledLineWidth() { const [a, b] = this.s.m; return this.s.lineWidth * Math.hypot(a, b); }
  /** Text start point and direction, after alignment and baseline. */
  textPlacement(text, x, y) {
    const f = parseFont(this.s.font);
    const w = helveticaWidth(text, f.size, f.bold);
    const al = this.s.textAlign;
    const dx = al === 'center' ? -w / 2 : al === 'right' || al === 'end' ? -w : 0;
    // Helvetica: cap height 0.718 em, descender 0.207 em
    const bl = this.s.textBaseline;
    const dy = bl === 'middle' ? 0.718 * f.size / 2 : bl === 'top' || bl === 'hanging' ? 0.718 * f.size : bl === 'bottom' ? -0.207 * f.size : 0;
    const [ox, oy] = apply(this.s.m, [x + dx, y + dy]);
    const [a, b] = this.s.m;
    return { x: ox, y: oy, angle: Math.atan2(b, a), font: f, width: w };
  }
}

// ---------------------------------------------------------------- SVG

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (v) => String(Math.round(v * 100) / 100);
const svgColor = (c) => { const [r, g, b] = parseColor(c); const h = (x) => Math.round(x * 255).toString(16).padStart(2, '0'); return `#${h(r)}${h(g)}${h(b)}`; };

export class SvgContext extends VectorContext {
  constructor(width, height) {
    super();
    this.w = width; this.h = height;
    this.out = [];
    this.clips = 0; this.groups = [0];
  }
  onSave() { this.groups.push(0); }
  onRestore() { const g = this.groups.pop() || 0; for (let i = 0; i < g; i++) this.out.push('</g>'); }
  pathData(p) { return p.map(([op, ...pts]) => op + pts.map(([x, y]) => `${n(x)} ${n(y)}`).join(' ')).join(''); }
  emitPath(p, mode) {
    if (!p.length) return;
    const style = this.s[mode === 'fill' ? 'fillStyle' : 'strokeStyle'];
    const [, , , a] = parseColor(style);
    const alpha = this.s.globalAlpha * a;
    const attrs = mode === 'fill'
      ? `fill="${svgColor(style)}"`
      : `fill="none" stroke="${svgColor(style)}" stroke-width="${n(this.scaledLineWidth)}" stroke-linecap="${this.s.lineCap}" stroke-linejoin="${this.s.lineJoin}"${this.s.dash.length ? ` stroke-dasharray="${this.s.dash.map(n).join(' ')}"` : ''}`;
    this.out.push(`<path d="${this.pathData(p)}" ${attrs}${alpha < 1 ? ` opacity="${n(alpha)}"` : ''}/>`);
  }
  emitClip(p) {
    const id = `c${++this.clips}`;
    this.out.push(`<clipPath id="${id}"><path d="${this.pathData(p)}"/></clipPath><g clip-path="url(#${id})">`);
    this.groups[this.groups.length - 1]++;
  }
  fillText(text, x, y) {
    const t = this.textPlacement(text, x, y);
    const [, , , a] = parseColor(this.s.fillStyle);
    const alpha = this.s.globalAlpha * a;
    const rot = Math.abs(t.angle) > 1e-6 ? ` transform="rotate(${n((t.angle * 180) / Math.PI)} ${n(t.x)} ${n(t.y)})"` : '';
    // positioned like the PDF (Helvetica metrics, alphabetic baseline) so both match
    this.out.push(`<text x="${n(t.x)}" y="${n(t.y)}" font-family="Helvetica, Arial, sans-serif" font-size="${n(t.font.size)}"${t.font.bold ? ' font-weight="bold"' : ''}${t.font.italic ? ' font-style="italic"' : ''} textLength="${n(t.width)}" lengthAdjust="spacingAndGlyphs" fill="${svgColor(this.s.fillStyle)}"${alpha < 1 ? ` opacity="${n(alpha)}"` : ''}${rot}>${esc(text)}</text>`);
  }
  /** The document. `widthMm`/`heightMm` set its printed size. */
  toString(widthMm, heightMm, title = '') {
    while (this.stack.length) this.restore();
    for (let i = 0; i < (this.groups[0] || 0); i++) this.out.push('</g>');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${n(widthMm)}mm" height="${n(heightMm)}mm" viewBox="0 0 ${n(this.w)} ${n(this.h)}">\n${title ? `<title>${esc(title)}</title>\n` : ''}${this.out.join('\n')}\n</svg>\n`;
  }
}

// ---------------------------------------------------------------- PDF

/** Characters PDF's standard fonts can show (WinAnsi); others become '?'. Ω is written "Ohm". */
function winAnsi(text) {
  let out = '';
  for (const ch of String(text).replace(/Ω/g, 'Ohm')) {
    const c = ch.charCodeAt(0);
    const b = c >= 32 && c <= 126 ? c : c >= 160 && c <= 255 ? c : ch === '•' ? 149 : ch === '–' ? 150 : ch === '—' ? 151 : ch === '…' ? 133 : 63;
    out += b === 40 || b === 41 || b === 92 ? `\\${String.fromCharCode(b)}` : b < 128 ? String.fromCharCode(b) : `\\${b.toString(8).padStart(3, '0')}`;
  }
  return out;
}

export class PdfContext extends VectorContext {
  /** `k` converts units to points; `pageH` is the page height in points (PDF's y runs up). */
  constructor(k, pageH) {
    super();
    this.k = k; this.pageH = pageH;
    this.ops = [];
    this.alphas = new Map(); // alpha -> ExtGState name
    this.fonts = new Set();
  }
  P([x, y]) { return `${n(x * this.k)} ${n(this.pageH - y * this.k)}`; }
  onSave() { this.ops.push('q'); }
  onRestore() { this.ops.push('Q'); }
  pathOps(p) { return p.map(([op, ...pts]) => (op === 'Z' ? 'h' : `${pts.map((q) => this.P(q)).join(' ')} ${op === 'M' ? 'm' : op === 'L' ? 'l' : 'c'}`)).join('\n'); }
  gs(alpha) {
    if (alpha >= 0.999) return '';
    const key = Math.round(alpha * 100) / 100;
    if (!this.alphas.has(key)) this.alphas.set(key, `GS${this.alphas.size + 1}`);
    return `/${this.alphas.get(key)} gs\n`;
  }
  rgb(c) { return parseColor(c).slice(0, 3).map((x) => n(x)).join(' '); }
  emitPath(p, mode) {
    if (!p.length) return;
    const style = this.s[mode === 'fill' ? 'fillStyle' : 'strokeStyle'];
    const alpha = this.s.globalAlpha * parseColor(style)[3];
    let o = 'q\n' + this.gs(alpha);
    if (mode === 'fill') o += `${this.rgb(style)} rg\n${this.pathOps(p)}\nf\n`;
    else {
      const cap = { butt: 0, round: 1, square: 2 }[this.s.lineCap] ?? 0, join = { miter: 0, round: 1, bevel: 2 }[this.s.lineJoin] ?? 0;
      o += `${this.rgb(style)} RG\n${n(this.scaledLineWidth * this.k)} w ${cap} J ${join} j [${this.s.dash.map((d) => n(d * this.k)).join(' ')}] 0 d\n${this.pathOps(p)}\nS\n`;
    }
    this.ops.push(o + 'Q');
  }
  emitClip(p) { this.ops.push(`${this.pathOps(p)}\nW n`); }
  fillText(text, x, y) {
    const t = this.textPlacement(text, x, y);
    const name = t.font.bold ? (t.font.italic ? 'F4' : 'F2') : t.font.italic ? 'F3' : 'F1';
    this.fonts.add(name);
    const c = Math.cos(-t.angle), s = Math.sin(-t.angle);
    const alpha = this.s.globalAlpha * parseColor(this.s.fillStyle)[3];
    this.ops.push(`q\n${this.gs(alpha)}${this.rgb(this.s.fillStyle)} rg\nBT /${name} ${n(t.font.size * this.k)} Tf ${n(c)} ${n(s)} ${n(-s)} ${n(c)} ${this.P([t.x, t.y])} Tm (${winAnsi(text)}) Tj ET\nQ`);
  }
}

const FONT_NAMES = { F1: 'Helvetica', F2: 'Helvetica-Bold', F3: 'Helvetica-Oblique', F4: 'Helvetica-BoldOblique' };

/**
 * A PDF file from pages [{ ctx: PdfContext, widthPt, heightPt }], as a string of 7-bit ASCII
 * (non-ASCII text is octal-escaped), so it can be written like any text file.
 */
export function buildPdf(pages, { title = '', producer = 'ElectroCAD' } = {}) {
  const objs = [];
  const add = (body) => { objs.push(body); return objs.length; };
  const catalog = add(null), pagesObj = add(null);
  const fontObjs = {};
  for (const [k, base] of Object.entries(FONT_NAMES)) fontObjs[k] = add(`<< /Type /Font /Subtype /Type1 /BaseFont /${base} /Encoding /WinAnsiEncoding >>`);
  const fontRes = `<< ${Object.keys(FONT_NAMES).map((k) => `/${k} ${fontObjs[k]} 0 R`).join(' ')} >>`;
  const kids = [];
  for (const pg of pages) {
    const content = pg.ctx.ops.join('\n');
    const stream = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    const gs = [...pg.ctx.alphas].map(([a, name]) => `/${name} << /ca ${a} /CA ${a} >>`).join(' ');
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${n(pg.widthPt)} ${n(pg.heightPt)}] /Resources << /Font ${fontRes} /ExtGState << ${gs} >> >> /Contents ${stream} 0 R >>`));
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  const info = add(`<< /Title (${winAnsi(title)}) /Producer (${winAnsi(producer)}) >>`);
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((body, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return out;
}
