#!/usr/bin/env node
// Shove gallery (#108): sets up each agreed shove case (S1-S9) on a small test board, runs it
// through the real router and drag code in Shove mode, and draws the board before and after as
// SVG, with a DRC clearance check of the result. Writes one HTML page (and, with --png, a PNG per
// case via Playwright) so the cases can be looked at and signed off.
//
//   node tools/shove-gallery.mjs out-dir [--png]
import fs from 'node:fs';
import path from 'node:path';
import { newProject } from '../src/renderer/core/project.js';
import { copperIndex, shapeDistance, padShape } from '../src/renderer/core/collision.js';
import { startRoute, step } from '../src/renderer/core/router.js';
import { dragSegment, dragCorner, dragResult } from '../src/renderer/core/drag.js';
import { rectOutline } from '../src/renderer/core/board.js';
import { mm } from '../src/renderer/core/units.js';

const W = mm(0.25), C = mm(0.2);
const STYLE = { corner: '45', posture: 'a' };
const tr = (id, a, b, net, extra = {}) => ({ id, a: a.map(mm), b: b.map(mm), width: W, layer: 'F.Cu', net, ...extra });
/** a polyline of one net as Tracks */
const line = (id, net, pts, extra = {}) => pts.slice(1).map((q, i) => tr(`${id}_${i}`, pts[i], q, net, extra));
const bundle = (n, y0, pitch, x0 = 2, x1 = 38) => Array.from({ length: n }, (_, i) => tr('n' + i, [x0, y0 + i * pitch], [x1, y0 + i * pitch], 'N' + i));

function project(tracks, extra = {}) {
  const p = newProject('G');
  p.board.outline = rectOutline([0, 0], [mm(40), mm(30)]);
  p.board.rules = { ...p.board.rules, clearance: C, trackWidth: W, edgeClearance: 0 };
  p.board.tracks = tracks;
  Object.assign(p.board, extra);
  return p;
}
const pad = (id, net, at, size) => ({ id, net, at: at.map(mm), size: size.map(mm) });
function indexWith(p, pads = []) {
  const index = copperIndex(p);
  for (const q of pads) index.add({ kind: 'pad', id: q.id, net: q.net, layers: new Set(['F.Cu']), shape: padShape({ at: q.at, size: q.size, shape: 'rect', rot: 0 }), item: {} });
  return index;
}

/** A route in Shove mode from `from` to the cursor `to`. */
function route(p, pads, from, to, net = 'NEW', posture = 'a') {
  const index = indexWith(p, pads);
  const st = startRoute(p, from.map(mm), 'F.Cu', net, { ...STYLE, posture });
  const v = step(p, st, to.map(mm), 'shove', index);
  return {
    ok: !!v.shoved || !v.shoveFailed, reason: v.shoveFailed,
    tracks: v.shoved || p.board.tracks, vias: v.shovedVias || p.board.vias,
    active: v.segments.map((s) => ({ a: s.a, b: s.b, width: s.width || W, net })),
  };
}
/** A drag (`r` from dragSegment / dragCorner) in Shove mode. */
function drag(p, pads, r, dir, partial = null, dist = 0) {
  const index = indexWith(p, pads);
  const res = dragResult(p, r, { mode: 'shove', index, dir, partial, dist });
  return { ok: res.ok, reason: res.reason, tracks: res.ok ? res.tracks : p.board.tracks, vias: res.ok ? res.vias : p.board.vias, active: res.ok ? r.changed.filter((s) => s.a) : [] };
}

const CASES = [
  {
    id: 'S1', title: 'Route alongside a bundle', expect: 'Every track of the bundle is pushed aside, each round the one inside it, in 45° steps; their ends stay put.',
    view: [4, 6, 36, 16],
    run() { const p = project(bundle(4, 10, 0.5)); return { p, ...route(p, [], [6, 9.75], [30, 9.75]) }; },
  },
  {
    id: 'S2', title: 'Route head driven into a bundle', expect: 'The bundle is pushed ahead of the tip, every track bowing round the one inside it.',
    view: [10, 4, 30, 15],
    run() { const p = project(bundle(4, 10, 0.5)); return { p, ...route(p, [], [20, 5], [20, 10.8]) }; },
  },
  {
    id: 'S3', title: 'Segment dragged into a bundle', expect: 'The dragged run pushes the whole bundle down; the bundle bows round it.',
    view: [4, 0, 36, 15],
    run() {
      const p = project([...line('u', 'U', [[10, 2], [10, 8], [30, 8], [30, 2]]), ...bundle(4, 10, 0.5)]);
      const d = (f) => dragSegment(p, p.board, 'u_1', [0, Math.round(mm(2.4) * f)], STYLE);
      return { p, ...drag(p, [], d(1), [0, 1], d, mm(2.4)) };
    },
  },
  {
    id: 'S4', title: 'Z bundle: bottom diagonal dragged left', expect: 'Every diagonal moves left, the runs following, the bundle staying parallel.',
    view: [10, 10, 34, 25],
    run() {
      const z = (k) => { const y = 20 + k * 0.6, x = 20 + k * 0.6 * Math.tan(Math.PI / 8); return line('z' + k, 'N' + k, [[2, y], [x, y], [x + 6, y - 6], [38, y - 6]]); };
      const p = project([0, 1, 2, 3].flatMap(z));
      const d = (f) => dragSegment(p, p.board, 'z3_1', [-Math.round(mm(2.5) * f), 0], STYLE);
      return { p, ...drag(p, [], d(1), [-1, 0], d, mm(2.5)) };
    },
  },
  {
    id: 'S5', title: 'Corner dragged into a bundle', expect: 'The corner pushes the bundle ahead of it.',
    view: [4, 0, 36, 16],
    run() {
      const p = project([...line('u', 'U', [[8, 2], [20, 7], [32, 2]].map(([x, y]) => [x, y])), ...bundle(4, 10, 0.5)]);
      p.board.tracks = [...line('u', 'U', [[8, 3], [14, 3], [20, 9], [32, 9]]), ...bundle(4, 11, 0.5)];
      const d = (f) => dragCorner(p, p.board, [mm(20), mm(9)], [mm(20 + 1 * f), Math.round(mm(9 + 2.6 * f))], 'F.Cu', STYLE);
      return { p, ...drag(p, [], d(1), [0, 1], d, mm(2.8)) };
    },
  },
  {
    id: 'S6a', title: 'Bundle pushed against a pad', expect: 'No room between the bundle and the pad: nothing is pushed, and the route walks round instead.',
    view: [4, 6, 36, 16],
    pads: [pad('P1', 'X', [20, 11.8], [8, 0.8])],
    run() { const p = project(bundle(3, 10, 0.5)); return { p, ...route(p, this.pads, [6, 9], [30, 9.75], 'NEW', 'b') }; },
  },
  {
    id: 'S6b', title: 'Pushed track would clip a pad', expect: 'A pad never moves and a pushed track never goes round it the far side (as in KiCad): nothing is pushed, and the route walks round.',
    view: [4, 6, 36, 16],
    pads: [pad('P1', 'X', [20, 10.9], [1, 1])],
    run() { const p = project(bundle(1, 10, 0.5)); return { p, ...route(p, this.pads, [6, 9], [30, 9.75], 'NEW', 'b') }; },
  },
  {
    id: 'S6c', title: 'Bundle pushed against a locked track', expect: 'The locked track never moves: nothing is pushed, and the route walks round.',
    view: [4, 6, 36, 16],
    run() { const p = project([...bundle(2, 10, 0.5), tr('lk', [2, 11], [38, 11], 'L', { locked: true })]); return { p, ...route(p, [], [6, 9], [30, 9.75], 'NEW', 'b') }; },
  },
  {
    id: 'S7', title: 'Push near a track end at a pad', expect: 'The track keeps its end on the pad; only the rest moves.',
    view: [2, 6, 30, 16],
    pads: [pad('P2', 'A', [6, 10], [1.2, 1.2])],
    run() { const p = project([tr('a', [6, 10], [36, 10], 'A')]); return { p, ...route(p, this.pads, [8, 9.75], [26, 9.75]) }; },
  },
  {
    id: 'S8', title: 'Bundle with a via among it', expect: 'The pushed track pushes the via clear (its tracks on both layers going with it), and the via pushes the next track on.',
    view: [4, 6, 36, 18],
    run() {
      const v = { id: 'v1', at: [mm(20), mm(10.75)], drill: mm(0.3), diameter: mm(0.6), from: 'F.Cu', to: 'B.Cu', net: 'V' };
      const p = project([...bundle(1, 10, 0.5), tr('vt', [20, 10.75], [20, 16], 'V'), tr('vb', [20, 10.75], [36, 10.75], 'V', { layer: 'B.Cu' }), tr('w', [21.5, 11], [21.5, 16], 'N2')], { vias: [v] });
      return { p, ...route(p, [], [6, 9.75], [30, 9.75]) };
    },
  },
  {
    id: 'S9', title: 'Springback', expect: 'With the route pulled back from the bundle, the bundle is as it was.',
    view: [4, 6, 36, 16],
    run() { const p = project(bundle(4, 10, 0.5)); return { p, ...route(p, [], [6, 9.4], [30, 9.4]) }; },
  },
];

// ---- DRC check ------------------------------------------------------------------------------

function clashes(p, tracks, vias, active, pads) {
  const items = [
    ...tracks.map((t) => ({ net: t.net, layer: t.layer, s: { type: 'capsule', a: t.a, b: t.b, r: t.width / 2 } })),
    ...active.map((t) => ({ net: t.net, layer: 'F.Cu', s: { type: 'capsule', a: t.a, b: t.b, r: t.width / 2 } })),
    ...(vias || []).flatMap((v) => ['F.Cu', 'B.Cu'].map((layer) => ({ net: v.net, layer, s: { type: 'capsule', a: v.at, b: v.at, r: v.diameter / 2 } }))),
    ...pads.map((q) => ({ net: q.net, layer: 'F.Cu', s: padShape({ at: q.at, size: q.size, shape: 'rect', rot: 0 }) })),
  ];
  let n = 0;
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const x = items[i], y = items[j];
    if (x.net === y.net || x.layer !== y.layer) continue;
    if (shapeDistance(x.s, y.s) < C - 2) n++;
  }
  return n;
}

// ---- drawing --------------------------------------------------------------------------------

const PALETTE = ['#4f9cf5', '#f5a524', '#c084fc', '#f472b6', '#22d3ee', '#a3e635'];
const colour = (net) => { const nets = ['N0', 'N1', 'N2', 'N3', 'A', 'U']; const i = nets.indexOf(net); return i >= 0 ? PALETTE[i % PALETTE.length] : net === 'L' ? '#9ca3af' : net === 'V' ? '#2bd46a' : '#e5e7eb'; };

function svg(c, tracks, vias, active, pads, ghost = null) {
  const [x0, y0, x1, y1] = c.view.map(mm);
  const k = 900 / (x1 - x0), H = Math.round((y1 - y0) * k);
  const X = (q) => ((q[0] - x0) * k).toFixed(1), Y = (q) => ((q[1] - y0) * k).toFixed(1);
  const seg = (t, col, op = 1, dash = '') => `<line x1="${X(t.a)}" y1="${Y(t.a)}" x2="${X(t.b)}" y2="${Y(t.b)}" stroke="${col}" stroke-width="${(t.width * k).toFixed(1)}" stroke-linecap="round" opacity="${op}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="${H}" viewBox="0 0 900 ${H}"><rect width="900" height="${H}" fill="#0f1115"/>`];
  // a 1 mm grid
  for (let x = Math.ceil(c.view[0]); x <= c.view[2]; x++) out.push(`<line x1="${X([mm(x), 0])}" y1="0" x2="${X([mm(x), 0])}" y2="${H}" stroke="#1d212a" stroke-width="1"/>`);
  for (let y = Math.ceil(c.view[1]); y <= c.view[3]; y++) out.push(`<line x1="0" y1="${Y([0, mm(y)])}" x2="900" y2="${Y([0, mm(y)])}" stroke="#1d212a" stroke-width="1"/>`);
  for (const q of pads) out.push(`<rect x="${X([q.at[0] - q.size[0] / 2, 0])}" y="${Y([0, q.at[1] - q.size[1] / 2])}" width="${(q.size[0] * k).toFixed(1)}" height="${(q.size[1] * k).toFixed(1)}" fill="#c2410c"/>`);
  if (ghost) for (const t of ghost.filter((t) => t.layer === 'F.Cu')) out.push(seg(t, '#ffffff', 0.12));
  for (const t of tracks.filter((t) => t.layer === 'B.Cu')) out.push(seg(t, colour(t.net), 0.35, '6 4'));
  for (const t of tracks.filter((t) => t.layer === 'F.Cu')) out.push(seg(t, t.locked ? '#9ca3af' : colour(t.net), 0.9));
  for (const t of active) out.push(seg(t, '#ef4444', 0.95));
  for (const v of vias || []) out.push(`<circle cx="${X(v.at)}" cy="${Y(v.at)}" r="${((v.diameter / 2) * k).toFixed(1)}" fill="#2bd46a"/><circle cx="${X(v.at)}" cy="${Y(v.at)}" r="${((v.drill / 2) * k).toFixed(1)}" fill="#0f1115"/>`);
  out.push('</svg>');
  return out.join('');
}

// ---- main -----------------------------------------------------------------------------------

const outDir = process.argv[2] || 'shove-gallery';
const png = process.argv.includes('--png');
fs.mkdirSync(outDir, { recursive: true });
const rows = [];
const results = [];
for (const c of CASES) {
  const pads = c.pads || [];
  const r = c.run();
  const before = structuredClone(r.p.board.tracks), beforeVias = structuredClone(r.p.board.vias || []);
  const n = clashes(r.p, r.tracks, r.vias, r.active, pads);
  const status = `${r.ok ? (r.reason ? `walked round (${r.reason})` : 'shoved') : `refused (${r.reason})`} · ${n ? `${n} clearance error${n === 1 ? '' : 's'}` : 'DRC clean'}`;
  results.push({ id: c.id, ok: r.ok, reason: r.reason || null, clashes: n });
  const b = svg(c, before, beforeVias, [], pads), a = svg(c, r.tracks, r.vias, r.active, pads, before);
  rows.push(`<section id="${c.id}"><h2>${c.id} · ${c.title}</h2><p class="exp"><b>Expected:</b> ${c.expect}</p><p class="st ${n ? 'bad' : ''}">${status}</p><div class="pair"><figure><figcaption>Before</figcaption>${b}</figure><figure><figcaption>After (red: the route or dragged copper; faint: where tracks were)</figcaption>${a}</figure></div></section>`);
}
const html = `<!doctype html><meta charset="utf-8"><title>Shove gallery</title><style>body{background:#0b0d11;color:#e5e7eb;font:14px system-ui;margin:16px}section{margin:0 0 28px}h2{font-size:16px;margin:0 0 4px}.exp{margin:2px 0;color:#cbd5e1}.st{margin:2px 0 8px;color:#86efac}.st.bad{color:#fca5a5}.pair{display:flex;gap:12px;flex-wrap:wrap}figure{margin:0}figcaption{color:#94a3b8;font-size:12px;margin-bottom:4px}svg{max-width:100%;height:auto;display:block}</style><h1>Shove cases (#108)</h1>${rows.join('')}`;
fs.writeFileSync(path.join(outDir, 'index.html'), html);
fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(results, null, 2));
console.log(results.map((r) => `${r.id}: ${r.ok ? 'ok' : 'refused'}${r.reason ? ` (${r.reason})` : ''}, ${r.clashes} clashes`).join('\n'));

if (png) {
  const { createRequire } = await import('node:module');
  const { chromium } = createRequire(import.meta.url)('playwright');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1860, height: 800 }, deviceScaleFactor: 1 });
  await page.goto('file://' + path.resolve(outDir, 'index.html'));
  for (const c of CASES) await (await page.$(`#${c.id}`)).screenshot({ path: path.join(outDir, `${c.id}.png`) });
  await browser.close();
}
