// Fab files: which layer each file is, drawing them to a bitmap, and comparing two sets (#28).
// DOM-free, so it runs in the tests, in a worker and on the page alike.
//
//   identifyFile(name, text)          -> { layer, kind: 'gerber' | 'drill', label } | null
//   readFabFiles([{ name, text }])    -> [{ name, layer, kind, label, data, shapes, box }]
//   rasterize(shapes, frame)          -> Uint8Array (1 = copper / ink), frame { x0, y0, w, h, res }
//   alignOffset(ours, theirs)         -> [dx, dy] nm that moves `theirs` onto `ours` (by drill holes, else outline)
//   compareLayers(ours, theirs, opts) -> [{ layer, label, ours, theirs, stats, diff? }]
import { readGerber, gerberShapes } from './read.js';
import { readExcellon, drillShapes } from './excellon.js';

/** The layers in stack order (top first), with their names on screen. */
export const FAB_LAYERS = [
  ['F.SilkS', 'Top silk'], ['F.Paste', 'Top paste'], ['F.Mask', 'Top mask'], ['F.Cu', 'Top copper'],
  ['In1.Cu', 'Inner 1'], ['In2.Cu', 'Inner 2'], ['In3.Cu', 'Inner 3'], ['In4.Cu', 'Inner 4'],
  ['B.Cu', 'Bottom copper'], ['B.Mask', 'Bottom mask'], ['B.Paste', 'Bottom paste'], ['B.SilkS', 'Bottom silk'],
  ['Edge.Cuts', 'Outline'], ['PTH', 'Plated drills'], ['NPTH', 'Non-plated drills'], ['Drill', 'Drills'],
];
const LABEL = Object.fromEntries(FAB_LAYERS);
export const layerOrder = (layer) => { const i = FAB_LAYERS.findIndex(([l]) => l === layer); return i < 0 ? 99 : i; };

// Protel / Eagle / Altium extensions, and the descriptive names KiCad (and ElectroCAD) use
const EXT = {
  gtl: 'F.Cu', gbl: 'B.Cu', gts: 'F.Mask', gbs: 'B.Mask', gtp: 'F.Paste', gbp: 'B.Paste', gto: 'F.SilkS', gbo: 'B.SilkS',
  gko: 'Edge.Cuts', gml: 'Edge.Cuts', gm1: 'Edge.Cuts', gbr_outline: 'Edge.Cuts', oln: 'Edge.Cuts', out: 'Edge.Cuts',
  g1: 'In1.Cu', g2: 'In2.Cu', g3: 'In3.Cu', g4: 'In4.Cu', g2l: 'In1.Cu', g3l: 'In2.Cu', g4l: 'In3.Cu', g5l: 'In4.Cu',
  cmp: 'F.Cu', sol: 'B.Cu', stc: 'F.Mask', sts: 'B.Mask', plc: 'F.SilkS', pls: 'B.SilkS', crc: 'F.Paste', crs: 'B.Paste',
};
const DESCRIPTIVE = [
  [/F[._]Cu|top[._ ]?copper|copper[._ ]?top/i, 'F.Cu'], [/B[._]Cu|bot(tom)?[._ ]?copper|copper[._ ]?bot/i, 'B.Cu'],
  [/In1[._]Cu|inner[._ ]?1/i, 'In1.Cu'], [/In2[._]Cu|inner[._ ]?2/i, 'In2.Cu'], [/In3[._]Cu/i, 'In3.Cu'], [/In4[._]Cu/i, 'In4.Cu'],
  [/F[._]Mask|top[._ ]?(solder)?mask|mask[._ ]?top/i, 'F.Mask'], [/B[._]Mask|bot(tom)?[._ ]?(solder)?mask|mask[._ ]?bot/i, 'B.Mask'],
  [/F[._]Paste|top[._ ]?paste/i, 'F.Paste'], [/B[._]Paste|bot(tom)?[._ ]?paste/i, 'B.Paste'],
  [/F[._]Silk|top[._ ]?(silk|legend|overlay)/i, 'F.SilkS'], [/B[._]Silk|bot(tom)?[._ ]?(silk|legend|overlay)/i, 'B.SilkS'],
  [/Edge[._]Cuts|outline|profile|board[._ ]?edge/i, 'Edge.Cuts'],
];

/** Is this text a drill file (Excellon)? */
const isExcellon = (text) => /^\s*(M48|;.*\n\s*M48)/.test(text) || (/^\s*%?\s*\n?T\d+/m.test(text.slice(0, 400)) && !/%FS|%MO|%AD/.test(text.slice(0, 4000)));

/** Which layer a fab file is, from its X2 attributes first, then its name. Null if it isn't one. */
export function identifyFile(name, text) {
  const lower = name.toLowerCase(), ext = lower.split('.').pop();
  const head = text.slice(0, 6000);
  if (isExcellon(head) || /\.(drl|xln|exc|txt|drd|tap)$/.test(lower) && /M48|T\d+C/.test(head)) {
    const npth = /NonPlated|NPTH|-NP\b|_NP\b/i.test(head) || /npth|non[-_ ]?plated/i.test(name);
    const pth = !npth && (/TF\.FileFunction,Plated/i.test(head) || /[-_]pth\b/i.test(name));
    const layer = npth ? 'NPTH' : pth ? 'PTH' : 'Drill';
    return { layer, kind: 'drill', label: LABEL[layer] };
  }
  if (!/%FS|%MO|%AD|G04|D0[123]\*/.test(head)) return null;
  // X2: %TF.FileFunction,Copper,L2,Bot*%
  const ff = /%TF\.FileFunction,([^*]+)\*%/.exec(head);
  let layer = null;
  if (ff) {
    const [fn, a, b] = ff[1].split(',');
    const side = /Bot/i.test(a + b) ? 'B' : /Top/i.test(a + b) ? 'F' : null;
    if (fn === 'Copper') { const n = Number(String(a).replace(/\D/g, '')); layer = side === 'F' ? 'F.Cu' : side === 'B' ? 'B.Cu' : `In${Math.max(1, n - 1)}.Cu`; }
    else if (fn === 'Soldermask' && side) layer = `${side}.Mask`;
    else if (fn === 'Paste' && side) layer = `${side}.Paste`;
    else if (fn === 'Legend' && side) layer = `${side}.SilkS`;
    else if (fn === 'Profile') layer = 'Edge.Cuts';
  }
  if (!layer) layer = EXT[ext] || null;
  if (!layer) for (const [re, l] of DESCRIPTIVE) if (re.test(name)) { layer = l; break; }
  if (!layer) return { layer: 'Unknown', kind: 'gerber', label: name };
  return { layer, kind: 'gerber', label: LABEL[layer] || layer };
}

/**
 * Read a set of fab files: each identified, parsed and turned into shapes. Files that are neither
 * Gerber nor Excellon (a README, a job file) are skipped and listed in `skipped`.
 */
export function readFabFiles(files) {
  const out = [], skipped = [];
  for (const f of files) {
    const id = identifyFile(f.name, f.text);
    if (!id) { skipped.push(f.name); continue; }
    const data = id.kind === 'drill' ? readExcellon(f.text) : readGerber(f.text);
    if (id.kind === 'drill' && id.layer === 'Drill' && data.plated != null) { id.layer = data.plated ? 'PTH' : 'NPTH'; id.label = LABEL[id.layer]; }
    const shapes = id.kind === 'drill' ? drillShapes(data) : gerberShapes(data);
    out.push({ name: f.name, ...id, data, shapes, box: data.box, warnings: data.warnings });
  }
  out.sort((a, b) => layerOrder(a.layer) - layerOrder(b.layer));
  return { layers: out, skipped };
}

/** The box round several layers. */
export function unionBox(layers) {
  let b = null;
  for (const l of layers) if (l.box) b = b ? { x0: Math.min(b.x0, l.box.x0), y0: Math.min(b.y0, l.box.y0), x1: Math.max(b.x1, l.box.x1), y1: Math.max(b.y1, l.box.y1) } : { ...l.box };
  return b;
}

/** Move shapes by [dx, dy]. */
export const moveShapes = (shapes, [dx, dy]) => (dx || dy ? shapes.map((s) => ({ dark: s.dark, rings: s.rings.map((r) => r.map(([x, y]) => [x + dx, y + dy])) })) : shapes);

/**
 * Fill shapes into a bitmap: one byte per pixel, sampled at pixel centres. Each shape's rings fill
 * even-odd; a clear shape (dark false) erases. frame: { x0, y0, w, h, res } (nm, pixels, nm/px).
 */
export function rasterize(shapes, frame) {
  const { x0, y0, w, h, res } = frame;
  const bm = new Uint8Array(w * h);
  const xs = [];
  for (const s of shapes) {
    // the edges, in pixel space
    const edges = [];
    let ey0 = Infinity, ey1 = -Infinity;
    for (const r of s.rings) {
      for (let i = 0, n = r.length; i < n; i++) {
        const a = r[i], b = r[(i + 1) % n];
        const ay = (a[1] - y0) / res - 0.5, by = (b[1] - y0) / res - 0.5;
        if (ay === by) continue;
        const ax = (a[0] - x0) / res - 0.5, bx = (b[0] - x0) / res - 0.5;
        const lo = Math.min(ay, by), hi = Math.max(ay, by);
        edges.push(ay < by ? [ay, by, ax, (bx - ax) / (by - ay)] : [by, ay, bx, (ax - bx) / (ay - by)]);
        if (lo < ey0) ey0 = lo; if (hi > ey1) ey1 = hi;
      }
    }
    if (!edges.length) continue;
    const r0 = Math.max(0, Math.ceil(ey0)), r1 = Math.min(h - 1, Math.floor(ey1));
    if (r0 > r1) continue;
    edges.sort((p, q) => p[0] - q[0]);
    const v = s.dark ? 1 : 0;
    let next = 0;
    const active = [];
    for (let row = r0; row <= r1; row++) {
      while (next < edges.length && edges[next][0] <= row) active.push(edges[next++]);
      xs.length = 0;
      for (let k = active.length - 1; k >= 0; k--) {
        const e = active[k];
        if (e[1] <= row) { active[k] = active[active.length - 1]; active.pop(); continue; }
        if (e[0] <= row) xs.push(e[2] + (row - e[0]) * e[3]);
      }
      if (xs.length < 2) continue;
      xs.sort((p, q) => p - q);
      const base = row * w;
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const c0 = Math.max(0, Math.ceil(xs[k])), c1 = Math.min(w - 1, Math.floor(xs[k + 1]));
        if (c0 <= c1) bm.fill(v, base + c0, base + c1 + 1);
      }
    }
  }
  return bm;
}

/** Grow a bitmap by r pixels (a square neighbourhood), for comparing with a tolerance. */
export function dilate(bm, w, h, r) {
  if (r <= 0) return bm;
  const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const b = y * w;
    let run = -1; // the last set pixel seen
    for (let x = 0; x < w + r; x++) {
      if (x < w && bm[b + x]) run = x;
      const at = x - r;
      if (at >= 0 && at < w && run >= 0 && run >= at - r) tmp[b + at] = 1;
    }
  }
  for (let x = 0; x < w; x++) {
    let run = -1;
    for (let y = 0; y < h + r; y++) {
      if (y < h && tmp[y * w + x]) run = y;
      const at = y - r;
      if (at >= 0 && at < h && run >= 0 && run >= at - r) out[at * w + x] = 1;
    }
  }
  return out;
}

/** Drill holes as points with diameters, for alignment. */
const holesOf = (layers) => layers.filter((l) => l.kind === 'drill').flatMap((l) => [...l.data.holes, ...l.data.slots.map((s) => ({ at: s.a, d: s.d }))]);

/**
 * The shift [dx, dy] (nm) that best puts `theirs` onto `ours`: the commonest offset between drill
 * holes of the same size (so a few moved holes don't matter), checked to land most holes; else the
 * outlines' (or everything's) box centres; else none.
 */
export function alignOffset(ours, theirs) {
  const a = holesOf(ours), b = holesOf(theirs);
  if (a.length && b.length) {
    const BIN = 20_000, votes = new Map();
    const bySize = new Map();
    for (const h of a) { const k = Math.round(h.d / 25_000); if (!bySize.has(k)) bySize.set(k, []); bySize.get(k).push(h); }
    const sample = b.length > 400 ? b.filter((_, i) => i % Math.ceil(b.length / 400) === 0) : b;
    for (const hb of sample) {
      const k = Math.round(hb.d / 25_000);
      for (const kk of [k - 1, k, k + 1]) for (const ha of bySize.get(kk) || []) {
        const key = `${Math.round((ha.at[0] - hb.at[0]) / BIN)},${Math.round((ha.at[1] - hb.at[1]) / BIN)}`;
        votes.set(key, (votes.get(key) || 0) + 1);
      }
    }
    let best = null;
    for (const [k, n] of votes) if (!best || n > best.n) best = { k, n };
    if (best && best.n >= Math.min(3, sample.length)) {
      const [bx, by] = best.k.split(',').map(Number);
      // refine: the mean offset of the pairs in that bin
      let sx = 0, sy = 0, c = 0;
      for (const hb of sample) for (const ha of a) {
        const dx = ha.at[0] - hb.at[0], dy = ha.at[1] - hb.at[1];
        if (Math.abs(dx - bx * BIN) <= BIN && Math.abs(dy - by * BIN) <= BIN) { sx += dx; sy += dy; c++; }
      }
      return { offset: [Math.round(sx / c), Math.round(sy / c)], by: 'drills', matched: best.n, of: sample.length };
    }
  }
  const edge = (ls) => ls.find((l) => l.layer === 'Edge.Cuts')?.box || unionBox(ls);
  const ea = edge(ours), eb = edge(theirs);
  if (ea && eb) return { offset: [Math.round((ea.x0 + ea.x1) / 2 - (eb.x0 + eb.x1) / 2), Math.round((ea.y0 + ea.y1) / 2 - (eb.y0 + eb.y1) / 2)], by: 'outline' };
  return { offset: [0, 0], by: 'none' };
}

/**
 * Compare two sets of fab layers, layer by layer. Each pair is drawn at `res` nm per pixel over the
 * board; differences closer than `tol` nm to the other set's ink don't count (arcs drawn as chords,
 * octagons for circles…). stats: areas in mm², match = shared / either (0..1), and the areas only
 * one set has (beyond the tolerance). With `keepDiff`, `diff` holds a byte per pixel: 1 both,
 * 2 only ours, 3 only theirs (beyond the tolerance), for an overlay.
 */
export function compareLayers(ours, theirs, { res = 25_000, tol = 50_000, offset = null, keepDiff = false, maxPixels = 40e6 } = {}) {
  const al = offset ? { offset, by: 'given' } : alignOffset(ours, theirs);
  const moved = theirs.map((l) => ({ ...l, shapes: moveShapes(l.shapes, al.offset), box: l.box && { x0: l.box.x0 + al.offset[0], y0: l.box.y0 + al.offset[1], x1: l.box.x1 + al.offset[0], y1: l.box.y1 + al.offset[1] } }));
  const box = unionBox([...ours, ...moved]);
  if (!box) return { align: al, layers: [] };
  const pad = 4 * res;
  let r = res;
  while (((box.x1 - box.x0 + 2 * pad) / r) * ((box.y1 - box.y0 + 2 * pad) / r) > maxPixels) r *= 1.5;
  const frame = { x0: box.x0 - pad, y0: box.y0 - pad, w: Math.ceil((box.x1 - box.x0 + 2 * pad) / r), h: Math.ceil((box.y1 - box.y0 + 2 * pad) / r), res: r };
  const t = Math.max(0, Math.round(tol / r));
  const px2 = (r / 1e6) ** 2;
  const keys = [...new Set([...ours.map((l) => l.layer), ...moved.map((l) => l.layer)])].sort((a, b) => layerOrder(a) - layerOrder(b));
  const drillKey = (l) => (l === 'PTH' || l === 'NPTH' || l === 'Drill' ? 'drills' : l);
  const out = [];
  const pick = (set, key) => (key === 'drills' ? set.filter((l) => l.kind === 'drill') : set.filter((l) => l.layer === key));
  const done = new Set();
  for (const k of keys) {
    const key = drillKey(k);
    if (done.has(key)) continue;
    done.add(key);
    const A = pick(ours, key), B = pick(moved, key);
    const entry = { layer: key, label: key === 'drills' ? 'Drills' : LABEL[key] || key, ours: A.map((l) => l.name), theirs: B.map((l) => l.name) };
    if (!A.length || !B.length) { entry.missing = !A.length ? 'ours' : 'theirs'; out.push(entry); continue; }
    // outlines are compared as lines of one width, whatever width each file drew them
    const shapesOf = (L, off) => (key === 'Edge.Cuts' ? L.flatMap((l) => moveShapes(gerberShapes(l.data, { minStroke: 150_000 }), off)) : L.flatMap((l) => l.shapes));
    const a = rasterize(shapesOf(A, [0, 0]), frame), b = rasterize(shapesOf(B, al.offset), frame);
    const da = dilate(a, frame.w, frame.h, t), db = dilate(b, frame.w, frame.h, t);
    let both = 0, onlyA = 0, onlyB = 0, realA = 0, realB = 0;
    const diff = keepDiff ? new Uint8Array(a.length) : null;
    for (let i = 0; i < a.length; i++) {
      const x = a[i], y = b[i];
      if (x && y) { both++; if (diff) diff[i] = 1; } else if (x) { onlyA++; if (!db[i]) { realA++; if (diff) diff[i] = 2; } else if (diff) diff[i] = 1; } else if (y) { onlyB++; if (!da[i]) { realB++; if (diff) diff[i] = 3; } else if (diff) diff[i] = 1; }
    }
    const union = both + onlyA + onlyB;
    entry.stats = {
      ours: +((both + onlyA) * px2).toFixed(2), theirs: +((both + onlyB) * px2).toFixed(2),
      match: union ? (union - realA - realB) / union : 1,
      onlyOurs: +(realA * px2).toFixed(3), onlyTheirs: +(realB * px2).toFixed(3),
    };
    if (diff) entry.diff = diff;
    out.push(entry);
  }
  return { align: al, frame, layers: out };
}
