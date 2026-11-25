// Fab output (#26): Gerber RS-274X with X2 attributes for every layer of the stack, and Excellon
// drill files for plated and non-plated holes. Pure functions of the Project and its Zone fills,
// so they can be checked against golden files. DOM-free.
//
// Coordinates: the Project's integer nanometres (+Y down, ADR-0003) become Gerber's millimetres
// with Y up at this boundary: format 4.6 in mm means one unit = 1 nm, so X = x and Y = -y.
//
//   fabFiles(project, { fills, date, version }) -> [{ name, kind: 'gerber' | 'drill', layer, text }]
import ClipperLib from 'clipper-lib';
import { copperLayerNames } from './board.js';
import { placedPads, padNets, fpTransform, flipLayer } from './footprint.js';
import { footprintOf } from './project.js';
import { padShape } from './collision.js';
import { arcCircle } from './geom.js';
import { fabSettings } from './presets.js';
import { drawingGeometry } from './boardDrawings.js';
import { strokeText, strokePen } from './strokefont.js';

const CL = ClipperLib;
export const MASK_MARGIN = 50_000; // nm: solder mask opening grows this much round each pad
const SILK_WIDTH = 120_000;        // nm: silkscreen line width
const EDGE_WIDTH = 100_000;        // nm: the board profile's line width

const mm6 = (nm) => (nm / 1e6).toFixed(6);
const X = (p) => `X${Math.round(p[0])}Y${Math.round(-p[1])}`; // 4.6 mm = nm; Y up

// ---------------------------------------------------------------- a Gerber file being written

class GerberFile {
  constructor(attrs) {
    this.attrs = attrs;   // [[name, value], …] file attributes
    this.aps = new Map(); // key -> { code, def, fn }
    this.body = [];
    this.cur = null;
  }

  _ap(def, fn = null) {
    const k = `${def}|${fn || ''}`;
    if (!this.aps.has(k)) this.aps.set(k, { code: 10 + this.aps.size, def, fn });
    return this.aps.get(k).code;
  }

  _use(code) { if (this.cur !== code) { this.body.push(`D${code}*`); this.cur = code; } }

  /** Flash an aperture (`C,0.5` / `R,1X2` / `O,1X2`) at p. */
  flash(def, p, fn) { this._use(this._ap(def, fn)); this.body.push(`${X(p)}D03*`); }

  /** Draw a polyline with a round pen `width` nm wide. */
  stroke(width, pts, fn) {
    if (pts.length < 2) { if (pts.length === 1) this.flash(`C,${mm6(width)}`, pts[0], fn); return; }
    this._use(this._ap(`C,${mm6(width)}`, fn));
    this.body.push(`${X(pts[0])}D02*`);
    for (const p of pts.slice(1)) this.body.push(`${X(p)}D01*`);
  }

  /** A filled polygon (a simple contour, no holes). */
  region(pts, fn) {
    if (pts.length < 3) return;
    if (fn) this.body.push(`%TA.AperFunction,${fn}*%`);
    this.body.push('G36*', `${X(pts[0])}D02*`, ...pts.slice(1).map((p) => `${X(p)}D01*`), `${X(pts[0])}D01*`, 'G37*');
    if (fn) this.body.push('%TD*%');
  }

  text() {
    const head = ['G04 ElectroCAD*', ...this.attrs.map(([k, v]) => `%TF.${k},${v}*%`), '%FSLAX46Y46*%', '%MOMM*%', '%LPD*%', 'G01*'];
    const defs = [];
    for (const { code, def, fn } of this.aps.values()) {
      if (fn) defs.push(`%TA.AperFunction,${fn}*%`);
      defs.push(`%ADD${code}${def}*%`);
      if (fn) defs.push('%TD*%');
    }
    return [...head, ...defs, ...this.body, 'M02*'].join('\n') + '\n';
  }
}

// ---------------------------------------------------------------- shapes

const circlePts = (c, r, n = 48) => Array.from({ length: n }, (_, i) => [Math.round(c[0] + r * Math.cos((i / n) * 2 * Math.PI)), Math.round(c[1] + r * Math.sin((i / n) * 2 * Math.PI))]);

function arcPts(start, mid, end, step = Math.PI / 32) {
  const c = arcCircle(start, mid, end);
  if (!c) return [start, end];
  const ang = (p) => Math.atan2(p[1] - c.c[1], p[0] - c.c[0]);
  const norm = (x) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const a0 = ang(start);
  let sweep = norm(ang(end) - a0);
  if (norm(ang(mid) - a0) > sweep) sweep -= 2 * Math.PI;
  const n = Math.max(2, Math.ceil(Math.abs(sweep) / step));
  return Array.from({ length: n + 1 }, (_, i) => (i === 0 ? start : i === n ? end : [Math.round(c.c[0] + c.r * Math.cos(a0 + (sweep * i) / n)), Math.round(c.c[1] + c.r * Math.sin(a0 + (sweep * i) / n))]));
}

/** A rounded rectangle's outline, w × h with corner radius r, rotated by rot° about c (+Y down, anticlockwise on screen). */
function roundRectPts(c, w, h, r, rot) {
  const t = (rot * Math.PI) / 180, cs = Math.cos(t), sn = Math.sin(t);
  const R = ([x, y]) => [Math.round(c[0] + x * cs + y * sn), Math.round(c[1] - x * sn + y * cs)];
  const out = [];
  const hw = w / 2 - r, hh = h / 2 - r;
  for (const [cx, cy, a0] of [[hw, -hh, -Math.PI / 2], [hw, hh, 0], [-hw, hh, Math.PI / 2], [-hw, -hh, Math.PI]]) {
    for (let i = 0; i <= 6; i++) { const a = a0 + (i / 6) * (Math.PI / 2); out.push(R([cx + r * Math.cos(a), cy + r * Math.sin(a)])); }
  }
  return out;
}

/** Plot a placed pad on file `g`, grown by `grow` (mask opening), with aperture function `fn`. */
function plotPad(g, pad, grow, fn) {
  const w = pad.size[0] + 2 * grow, h = pad.size[1] + 2 * grow;
  const rot = (((pad.rot || 0) % 360) + 360) % 360;
  const square = Math.abs(rot - Math.round(rot / 90) * 90) < 0.01;
  const swap = square && Math.round(rot / 90) % 2 === 1;
  const [aw, ah] = swap ? [h, w] : [w, h];
  if (pad.shape === 'circle') { g.flash(`C,${mm6(w)}`, pad.at, fn); return; }
  if (pad.shape === 'rect' && square) { g.flash(`R,${mm6(aw)}X${mm6(ah)}`, pad.at, fn); return; }
  if (pad.shape === 'oval' && square) { g.flash(`O,${mm6(aw)}X${mm6(ah)}`, pad.at, fn); return; }
  if (pad.shape === 'oval') { const s = padShape({ ...pad, size: [w, h] }); g.stroke(s.r * 2, [s.a, s.b], fn); return; }
  const r = pad.shape === 'roundrect' ? Math.min(w, h) * 0.25 : 0;
  g.region(r ? roundRectPts(pad.at, w, h, r, rot) : padShape({ ...pad, size: [w, h] }).pts, fn);
}

/**
 * A Zone fill (polygons with holes) as hole-free regions, so nothing needs clear polarity (which
 * would also clear other copper): cut into horizontal bands at the top and bottom of every hole,
 * where each hole then splits its band.
 */
export function fillRegions(polys) {
  const out = [];
  for (const poly of polys) {
    const [outer, ...holes] = poly;
    if (!holes.length) { out.push(outer); continue; }
    const ys = [...new Set([Math.min(...outer.map((q) => q[1])), Math.max(...outer.map((q) => q[1])), ...holes.flatMap((hl) => [Math.min(...hl.map((q) => q[1])), Math.max(...hl.map((q) => q[1]))])])].sort((a, b) => a - b);
    const xs = outer.map((q) => q[0]), x0 = Math.min(...xs) - 1, x1 = Math.max(...xs) + 1;
    // a band needs only the outline and the holes that cross it (the rest can't change it): on a
    // plane with hundreds of holes this is what keeps Generate quick
    const P = (ring) => ring.map(([x, y]) => ({ X: x, Y: y }));
    const subjOuter = P(outer);
    const hs = holes.map((hl) => { let lo = Infinity, hi = -Infinity; for (const q of hl) { if (q[1] < lo) lo = q[1]; if (q[1] > hi) hi = q[1]; } return { lo, hi, path: P(hl) }; }).sort((a, b) => a.lo - b.lo);
    for (let i = 1; i < ys.length; i++) {
      const band = [[{ X: x0, Y: ys[i - 1] }, { X: x1, Y: ys[i - 1] }, { X: x1, Y: ys[i] }, { X: x0, Y: ys[i] }]];
      const subj = [subjOuter];
      for (const hl of hs) { if (hl.lo >= ys[i]) break; if (hl.hi > ys[i - 1]) subj.push(hl.path); }
      const c = new CL.Clipper();
      c.AddPaths(subj, CL.PolyType.ptSubject, true);
      c.AddPaths(band, CL.PolyType.ptClip, true);
      const tree = new CL.PolyTree();
      c.Execute(CL.ClipType.ctIntersection, tree, CL.PolyFillType.pftEvenOdd, CL.PolyFillType.pftNonZero);
      for (const node of tree.Childs()) out.push(node.Contour().map((q) => [q.X, q.Y]));
    }
  }
  return out;
}

// ---------------------------------------------------------------- the layers

const SIDE = { F: 'Top', B: 'Bot' };

/** The Gerber layers of a stack, with their X2 file function and polarity. */
export function gerberLayers(copper) {
  const cu = copperLayerNames(copper);
  return [
    ...cu.map((l, i) => ({ layer: l, fn: `Copper,L${i + 1},${i === 0 ? 'Top' : i === cu.length - 1 ? 'Bot' : 'Inr'}`, polarity: 'Positive' })),
    { layer: 'F.Mask', fn: 'Soldermask,Top', polarity: 'Negative' }, { layer: 'B.Mask', fn: 'Soldermask,Bot', polarity: 'Negative' },
    { layer: 'F.Paste', fn: 'Paste,Top', polarity: 'Positive' }, { layer: 'B.Paste', fn: 'Paste,Bot', polarity: 'Positive' },
    { layer: 'F.SilkS', fn: 'Legend,Top', polarity: 'Positive' }, { layer: 'B.SilkS', fn: 'Legend,Bot', polarity: 'Positive' },
    { layer: 'Edge.Cuts', fn: 'Profile,NP', polarity: 'Positive' },
  ];
}

const PROTEL = { 'F.Cu': 'GTL', 'B.Cu': 'GBL', 'In1.Cu': 'G1', 'In2.Cu': 'G2', 'F.Mask': 'GTS', 'B.Mask': 'GBS', 'F.Paste': 'GTP', 'B.Paste': 'GBP', 'F.SilkS': 'GTO', 'B.SilkS': 'GBO', 'Edge.Cuts': 'GKO' };

/** The file name for a layer (or 'PTH' / 'NPTH'), following the Fab output naming. */
export function fabFileName(base, layer, naming = 'protel') {
  if (layer === 'PTH' || layer === 'NPTH') return `${base}-${layer}.drl`;
  return naming === 'protel' ? `${base}.${PROTEL[layer]}` : `${base}-${layer.replace('.', '_')}.gbr`;
}

/** A safe base name for the files from the project name. */
export const fabBaseName = (project) => (String(project.name || 'board').trim().replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'board');

function gerberLayer(project, { layer, fn, polarity }, { fills, date, version }) {
  const board = project.board;
  const g = new GerberFile([['GenerationSoftware', `ElectroCAD,ElectroCAD,${version}`], ['CreationDate', date], ['SameCoordinates', 'Original'], ['FileFunction', fn], ['FilePolarity', polarity]]);
  const nets = padNets(board), view = { ...project, board };
  const pads = board.footprints.flatMap((bf) => placedPads(view, bf, nets).map((p) => ({ ...p, bf })));
  if (/\.Cu$/.test(layer)) {
    // zones first (under the copper drawn on them), lowest priority first
    for (const z of [...(board.zones || [])].filter((zn) => zn.layer === layer).sort((a, b) => a.priority - b.priority)) {
      const f = fills.get(z.id);
      if (f) for (const ring of fillRegions(f.polys)) g.region(ring, 'Conductor');
    }
    for (const t of board.tracks || []) if (t.layer === layer) g.stroke(t.width, [t.a, t.b], 'Conductor');
    for (const v of board.vias || []) g.flash(`C,${mm6(v.diameter)}`, v.at, 'ViaPad');
    for (const p of pads) {
      const tht = p.layers.includes('*.Cu');
      if (tht || p.layers.includes(layer)) plotPad(g, p, 0, tht ? 'ComponentPad' : 'SMDPad,CuDef');
    }
  } else if (/Mask$/.test(layer)) {
    for (const p of pads) if (p.layers.includes(layer) || p.layers.includes('*.Mask')) plotPad(g, p, MASK_MARGIN, null);
    // vias are tented unless one says not
    for (const v of board.vias || []) if (v.tented === false) g.flash(`C,${mm6(v.diameter + 2 * MASK_MARGIN)}`, v.at, null);
  } else if (/Paste$/.test(layer)) {
    for (const p of pads) if (p.layers.includes(layer) && !p.drill) plotPad(g, p, 0, null);
  } else if (/SilkS$/.test(layer)) {
    const mirror = layer.startsWith('B.'), font = board.textFont || 'stroke';
    for (const bf of board.footprints) {
      const fp = footprintOf(project, project.components[bf.componentId]);
      if (!fp) continue;
      const T = fpTransform(bf);
      const ref = board.annotation?.components?.[bf.componentId]?.ref ?? project.components[bf.componentId]?.ref ?? '';
      const value = board.annotation?.components?.[bf.componentId]?.value ?? project.components[bf.componentId]?.value ?? '';
      let ownRef = false;
      for (const gr of fp.graphics || []) {
        if (gr.type === 'text' && gr.text.includes('${REF}')) ownRef = true;
        if (flipLayer(gr.layer || 'F.SilkS', bf.side) !== layer) continue;
        const w = gr.width ? gr.width * SILK_WIDTH : SILK_WIDTH;
        if (gr.type === 'rect') { const q = [gr.a, [gr.b[0], gr.a[1]], gr.b, [gr.a[0], gr.b[1]]].map(T); if (gr.fill === 'outline') g.region(q, null); else g.stroke(w, [...q, q[0]], null); }
        else if (gr.type === 'line') g.stroke(w, gr.pts.map(T), null);
        else if (gr.type === 'poly') { const q = gr.pts.map(T); if (gr.fill === 'outline') g.region(q, null); else g.stroke(w, [...q, q[0]], null); }
        else if (gr.type === 'circle') { const q = circlePts(T(gr.c), gr.r); if (gr.fill === 'outline') g.region(q, null); else g.stroke(w, [...q, q[0]], null); }
        else if (gr.type === 'arc') g.stroke(w, arcPts(T(gr.start), T(gr.mid), T(gr.end)), null);
        else if (gr.type === 'text') {
          const str = String(gr.text).replace(/\$\{REF\}/g, ref).replace(/\$\{VALUE\}/g, value);
          for (const pl of strokeText(str, { at: T(gr.at), size: gr.size, mirror, font })) g.stroke(strokePen(gr.size, font), pl, null);
        }
      }
      // a Footprint without its own Reference text gets it above its courtyard, as on screen
      if (!ownRef && ref && flipLayer('F.SilkS', bf.side) === layer) {
        const crt = (fp.graphics || []).find((x) => /CrtYd$/.test(x.layer || '') && x.type === 'rect');
        const top = crt ? Math.min(crt.a[1], crt.b[1]) : -1_000_000;
        for (const pl of strokeText(ref, { at: T([0, top - 800_000]), size: 1_000_000, mirror, font })) g.stroke(strokePen(1_000_000, font), pl, null);
      }
    }
  } else if (layer === 'Edge.Cuts') {
    for (const s of board.outline || []) {
      let pts;
      if (s.type === 'rect') pts = [s.a, [s.b[0], s.a[1]], s.b, [s.a[0], s.b[1]], s.a];
      else if (s.type === 'circle') { pts = circlePts(s.c, s.r, 96); pts.push(pts[0]); }
      else if (s.type === 'arc') pts = arcPts(s.start, s.mid, s.end);
      else pts = s.pts || [];
      g.stroke(EDGE_WIDTH, pts, 'Profile');
    }
  }
  // the Board's own text and graphics on this layer (#66): copper ones are NonConductor (no net)
  const font = board.textFont || 'stroke', func = /\.Cu$/.test(layer) ? 'NonConductor' : null;
  for (const d of board.drawings || []) {
    if (d.layer !== layer) continue;
    const geo = drawingGeometry(d, font);
    for (const ring of geo.fills) g.region(ring, func);
    for (const st of geo.strokes) g.stroke(st.width, st.pts, func);
  }
  return g.text();
}

// ---------------------------------------------------------------- drills

/** Excellon: plated holes (vias and plated pads) or non-plated ones (pads with no copper). */
function drillFile(project, plated, { date, version, units }) {
  const board = project.board;
  const nets = padNets(board), view = { ...project, board };
  const holes = [];
  if (plated) for (const v of board.vias || []) holes.push({ d: v.drill, at: v.at });
  for (const bf of board.footprints) for (const p of placedPads(view, bf, nets)) {
    if (!(p.drill > 0)) continue;
    const pth = p.layers.some((l) => /Cu$/.test(l));
    if (pth === plated) holes.push({ d: p.drill, at: p.at });
  }
  const inch = units === 'inch';
  const len = (nm) => (inch ? (nm / 25.4e6).toFixed(5) : (nm / 1e6).toFixed(3));
  const tools = [...new Set(holes.map((x) => x.d))].sort((a, b) => a - b);
  const n = copperLayerNames(board.stack.copper).length;
  const out = ['M48', `; DRILL file {ElectroCAD ${version}} date ${date}`, `; FORMAT={-:-/ absolute / ${inch ? 'inch' : 'metric'} / decimal}`,
    `; #@! TF.CreationDate,${date}`, `; #@! TF.GenerationSoftware,ElectroCAD,ElectroCAD,${version}`, `; #@! TF.FileFunction,${plated ? 'Plated' : 'NonPlated'},1,${n},${plated ? 'PTH' : 'NPTH'}`,
    'FMAT,2', inch ? 'INCH' : 'METRIC'];
  tools.forEach((d, i) => out.push(`T${i + 1}C${len(d)}`));
  out.push('%', 'G90', 'G05');
  tools.forEach((d, i) => {
    out.push(`T${i + 1}`);
    for (const hl of holes.filter((x) => x.d === d).sort((a, b) => a.at[0] - b.at[0] || a.at[1] - b.at[1])) out.push(`X${len(hl.at[0])}Y${len(-hl.at[1])}`);
  });
  out.push('M30');
  return out.join('\n') + '\n';
}

// ---------------------------------------------------------------- everything

/**
 * Every fab file for the Board: one Gerber per layer of its stack, and the PTH and NPTH drill
 * files, named by the Fab output settings. `fills`: Zone fills (id -> fill). `date`: ISO time.
 */
export function fabFiles(project, { fills = new Map(), date = new Date().toISOString(), version = '0' } = {}) {
  const board = project.board;
  const f = fabSettings(board), base = fabBaseName(project);
  const out = [];
  for (const L of gerberLayers(board.stack.copper)) out.push({ name: fabFileName(base, L.layer, f.naming), kind: 'gerber', layer: L.layer, text: gerberLayer(project, L, { fills, date, version }) });
  for (const plated of [true, false]) out.push({ name: fabFileName(base, plated ? 'PTH' : 'NPTH', f.naming), kind: 'drill', layer: plated ? 'PTH' : 'NPTH', text: drillFile(project, plated, { date, version, units: f.drillUnits }) });
  return out;
}

