// Drawing the Board (#15): the Outline on Edge.Cuts, a faint board fill inside closed loops, the
// open ends of an unclosed Outline, and the shape being drawn. Footprints, Tracks and Zones join
// with their tickets. Screen space is the world scaled (+Y down on both), so angles match.
import { vectorLayout } from '../core/strokefont.js';
import { drawingGeometry } from '../core/boardDrawings.js';
import { placedFieldTexts, fieldOfText, footprintTextPlacement } from '../core/fpTexts.js';
import { arcCircle } from '../core/geom.js';
import { outlineLoops, checkOutline } from '../core/board.js';
import { mm } from '../core/units.js';
import { placedPads, padNets, fpTransform, flipLayer } from '../core/footprint.js';
import { footprintOf } from '../core/project.js';
import { drawOriginMark } from '../view/handles.js';

const TAU = Math.PI * 2;
const norm = (a) => ((a % TAU) + TAU) % TAU;

/** Add an arc through start, mid and end to the path, from `start` (or from `end` when reversed). */
function arcTo(ctx, view, s, reversed) {
  const c = arcCircle(s.start, s.mid, s.end);
  const [a, b] = reversed ? [s.end, s.start] : [s.start, s.end];
  if (!c) { ctx.lineTo(...view.toScreen(b)); return; }
  const ang = (p) => Math.atan2(p[1] - c.c[1], p[0] - c.c[0]);
  const a0 = ang(a), a1 = ang(b);
  const cw = norm(ang(s.mid) - a0) <= norm(a1 - a0); // increasing angle passes through mid
  const [cx, cy] = view.toScreen(c.c);
  ctx.arc(cx, cy, c.r * view.scale, a0, a1, !cw);
}

/** Add one shape to the current path (moving to its start when `move`). */
function shapePath(ctx, view, s, reversed = false, move = true) {
  const S = (p) => view.toScreen(p);
  if (s.type === 'rect') {
    const [x0, y0] = S(s.a), [x1, y1] = S(s.b);
    ctx.rect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
  } else if (s.type === 'circle') {
    const [cx, cy] = S(s.c);
    ctx.moveTo(cx + s.r * view.scale, cy);
    ctx.arc(cx, cy, s.r * view.scale, 0, TAU);
  } else if (s.type === 'arc') {
    if (move) ctx.moveTo(...S(reversed ? s.end : s.start));
    arcTo(ctx, view, s, reversed);
  } else if (s.pts) {
    const pts = reversed ? [...s.pts].reverse() : s.pts;
    pts.forEach((p, i) => (i === 0 && move ? ctx.moveTo(...S(p)) : ctx.lineTo(...S(p))));
  }
}

/**
 * Draw the Board. opts: { hidden: Set of layer names, selection: Set of outline indices,
 * ghost: outline shapes being drawn, ghostPts: polygon points so far, measure: { a, b } }.
 */
export function drawBoard(ctx, view, C, board, opts = {}) {
  const hidden = opts.hidden || new Set();
  const edge = C['Edge.Cuts'] || '#d0d000';
  const outline = board.outline || [];
  const lw = Math.max(1.5, mm(0.1) * view.scale);
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  // the board itself: a faint fill inside the closed loops (cut-outs stay empty: even-odd)
  const loops = opts.only ? [] : outlineLoops(outline);
  if (loops.length) {
    ctx.beginPath();
    for (const loop of loops) {
      loop.forEach(({ shape, reversed }, i) => shapePath(ctx, view, shape, reversed, i === 0));
      ctx.closePath();
    }
    ctx.fillStyle = edge; ctx.globalAlpha = 0.07; ctx.fill('evenodd'); ctx.globalAlpha = 1;
  }
  if (!hidden.has('Edge.Cuts')) {
    outline.forEach((s, i) => {
      ctx.beginPath(); shapePath(ctx, view, s);
      ctx.strokeStyle = edge; ctx.lineWidth = lw; ctx.stroke();
    });
    // where the Outline is open: a ring at each loose end
    const { openEnds } = checkOutline(outline);
    if (!opts.only && outline.length && openEnds.length) {
      ctx.strokeStyle = C.ercError || '#e5484d'; ctx.lineWidth = 2;
      for (const p of openEnds) { const [x, y] = view.toScreen(p); ctx.beginPath(); ctx.arc(x, y, 6, 0, TAU); ctx.stroke(); }
    }
  }
  if (opts.project) {
    const view2 = { ...opts.project, board };
    // the Footprints' text (Reference, Value, pad numbers and Nets) goes on top of the copper: drawn
    // after the Tracks and Vias here, or left in opts.labels for the caller to draw last
    const labels = opts.labels || [];
    drawZones(ctx, view, C, board, hidden, opts.zones);
    drawFootprints(ctx, view, C, view2, board, hidden, opts.padsOnly, opts.padKeys, labels);
    if (!opts.only || opts.trackIds) {
      drawTracks(ctx, view, C, board, hidden, opts.only ? opts.trackIds : null);
      drawVias(ctx, view, C, board, hidden, opts.only ? opts.trackIds : null);
    }
    // the Board's own drawings (#66): copper ones with the copper, the rest over it with the text
    if (!opts.only || opts.drawingIds) {
      const ids = opts.only ? opts.drawingIds : null;
      drawBoardDrawings(ctx, view, C, board, hidden, { ids, copper: true });
      labels.push(() => drawBoardDrawings(ctx, view, C, board, hidden, { ids, copper: false }));
    }
    if (!opts.labels) drawLabels(labels);
    // the Ratsnest: a thin line for each unrouted connection
    if (opts.rats?.length) {
      ctx.save(); ctx.strokeStyle = C.ratsnest || '#98a2b3'; ctx.lineWidth = 1;
      ctx.beginPath();
      for (const r of opts.rats) { const [x0, y0] = view.toScreen(r.a), [x1, y1] = view.toScreen(r.b); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); }
      ctx.stroke(); ctx.restore();
    }
  }
  // the shape being drawn
  if (opts.ghost?.length || opts.ghostPts?.length) {
    ctx.strokeStyle = C.selection; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
    for (const s of opts.ghost || []) { ctx.beginPath(); shapePath(ctx, view, s); ctx.stroke(); }
    ctx.setLineDash([]);
    ctx.fillStyle = C.selection;
    for (const p of opts.ghostPts || []) { const [x, y] = view.toScreen(p); ctx.fillRect(x - 3, y - 3, 6, 6); }
    if (opts.closeAt) { const [x, y] = view.toScreen(opts.closeAt); ctx.strokeStyle = C.selection; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 8, 0, TAU); ctx.stroke(); }
  }
  // the Measure tool
  if (opts.measure) {
    const { a, b } = opts.measure;
    const [x0, y0] = view.toScreen(a), [x1, y1] = view.toScreen(b);
    ctx.strokeStyle = C.selection; ctx.fillStyle = C.selection; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    for (const [x, y] of [[x0, y0], [x1, y1]]) { ctx.beginPath(); ctx.arc(x, y, 3, 0, TAU); ctx.fill(); }
    const dx = (b[0] - a[0]) / 1e6, dy = (b[1] - a[1]) / 1e6;
    const text = `${Math.hypot(dx, dy).toFixed(2)} mm  ·  dx ${dx.toFixed(2)}  dy ${dy.toFixed(2)}`;
    ctx.font = '12px system-ui, sans-serif';
    const w = ctx.measureText(text).width + 12;
    const tx = (x0 + x1) / 2 - w / 2, ty = (y0 + y1) / 2 - 28;
    ctx.globalAlpha = 0.9; ctx.fillStyle = C.background || '#000'; ctx.fillRect(tx, ty, w, 20); ctx.globalAlpha = 1;
    ctx.strokeStyle = C.selection; ctx.lineWidth = 1; ctx.strokeRect(tx + 0.5, ty + 0.5, w, 20);
    ctx.fillStyle = C.selection; ctx.textBaseline = 'middle'; ctx.fillText(text, tx + 6, ty + 10);
  }
  ctx.restore();
}

/**
 * Footprints: back-side items first, then front. Pads in their copper colour (through-hole pads
 * in the through-hole colour, with the drill), courtyards dashed, the Reference on silk above and
 * the Value on fab below; when zoomed in far enough, each pad shows its number and Net.
 */
/**
 * Zones (#23) under the pads and Tracks, back layers first, lower priority under higher: the fill
 * in the layer's colour at the theme's Zone opacity, and the outline dashed. `z.fills` (id -> fill)
 * and `z.outlineOnly` (ids drawn as outlines: being refilled, or touched by a drag or route).
 */
const LAYER_ORDER = { 'B.Cu': 0, 'In2.Cu': 1, 'In1.Cu': 2, 'F.Cu': 3 };
export function drawZones(ctx, view, C, board, hidden, z = {}) {
  const zones = (board.zones || []).filter((zn) => !hidden.has(zn.layer)).sort((a, b) => (LAYER_ORDER[a.layer] ?? 0) - (LAYER_ORDER[b.layer] ?? 0) || a.priority - b.priority);
  if (!zones.length) return;
  ctx.save();
  for (const zn of zones) {
    const col = C[zn.layer] || '#c33';
    const fill = !z.outlineOnly?.has(zn.id) && z.fills?.get(zn.id);
    if (fill) {
      ctx.globalAlpha = typeof C.zoneOpacity === 'number' ? C.zoneOpacity : 0.4;
      ctx.fillStyle = col;
      ctx.beginPath();
      for (const poly of fill.polys) for (const ring of poly) ring.forEach((q, i) => { const [x, y] = view.toScreen(q); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.fill('evenodd');
    }
    ctx.globalAlpha = fill ? 0.7 : 0.95;
    ctx.strokeStyle = col; ctx.lineWidth = fill ? 1 : 1.5; ctx.setLineDash([6, 4]);
    ctx.beginPath();
    zn.outline.forEach((q, i) => { const [x, y] = view.toScreen(q); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);
  }
  ctx.restore();
}

/**
 * The Board's drawings (#66) in their layers' colours, from the same geometry as the Gerbers (text
 * in the board's font, mirrored on the back). `copper`: true for those on copper layers, false for
 * the rest; `ids`: only these (highlighting); `color`: one colour for all (the selection).
 */
export function drawBoardDrawings(ctx, view, C, board, hidden, { ids = null, copper = null, color = null, list = null } = {}) {
  const font = board.textFont || 'stroke';
  const back = (l) => (/^B\./.test(l) ? 0 : /^In/.test(l) ? 1 : 2);
  const ds = (list || board.drawings || []).filter((d) => !hidden.has(d.layer) && (!ids || ids.has(d.id)) && (copper === null || /\.Cu$/.test(d.layer) === copper))
    .sort((a, b) => back(a.layer) - back(b.layer));
  if (!ds.length) return;
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.setLineDash([]);
  for (const d of ds) {
    const col = color || C[d.layer] || '#ccc';
    const g = drawingGeometry(d, font);
    ctx.fillStyle = col; ctx.strokeStyle = col;
    if (g.fills.length) {
      ctx.beginPath();
      for (const ring of g.fills) { ring.forEach((q, i) => { const [x, y] = view.toScreen(q); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.closePath(); }
      ctx.fill('evenodd');
    }
    for (const st of g.strokes) {
      ctx.lineWidth = Math.max(1, st.width * view.scale);
      ctx.beginPath();
      st.pts.forEach((q, i) => { const [x, y] = view.toScreen(q); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      if (st.pts.length === 1) { const [x, y] = view.toScreen(st.pts[0]); ctx.lineTo(x + 0.01, y); }
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** Draw text deferred by drawBoard (opts.labels): over the copper. */
export function drawLabels(labels) { for (const f of labels || []) f(); }

/**
 * `padsOnly`: Footprint ids drawn as just the pads in `padKeys` ("componentId:pad"), for highlighting a Net.
 * Text is pushed onto `labels` (functions) to be drawn after the copper.
 */
function drawFootprints(ctx, view, C, project, board, hidden, padsOnly = null, padKeys = null, labels = []) {
  const nets = padNets(board);
  const ann = board.annotation?.components || {};
  const fps = [...board.footprints].sort((a, b) => (a.side === b.side ? 0 : a.side === 'B' ? -1 : 1));
  const visible = (layer) => !hidden.has(layer);
  for (const bf of fps) {
    const comp = project.components[bf.componentId];
    const fp = footprintOf(project, comp);
    if (!fp) continue;
    const T = fpTransform(bf);
    const S = (p) => view.toScreen(T(p));
    const partial = padsOnly?.has(bf.id);
    const ref = ann[bf.componentId]?.ref ?? comp?.ref ?? '';
    const value = ann[bf.componentId]?.value ?? comp?.value ?? '';
    // silk, courtyard and fab graphics (and its own ${REF} / ${VALUE} text)
    // Reference / Value moved, resized or hidden on this placement (#65): drawn from the override
    const moved = new Set(Object.keys(bf.texts || {}));
    const own = partial ? { ref: true, value: true } : drawFootprintGraphics(ctx, view, C, fp, T, { side: bf.side, visible, ref, value, labels, font: board.textFont, skip: moved, fpRot: bf.rot || 0 });
    if (!partial && moved.size) {
      const list = placedFieldTexts(project, bf, { ref, value }).filter((d) => !d.hidden && d.text);
      if (list.length) labels.push(() => drawBoardDrawings(ctx, view, C, board, hidden, { list }));
    }
    // pads
    for (const pad of placedPads(project, bf, nets)) {
      if (partial && !padKeys?.has(`${bf.componentId}:${pad.number}`)) continue;
      const tht = pad.layers.includes('*.Cu');
      const cu = tht ? (visible('F.Cu') || visible('B.Cu') ? (bf.side === 'B' && !visible('F.Cu') ? 'B.Cu' : 'F.Cu') : null)
        : pad.layers.find((l) => /\.Cu$/.test(l) && visible(l));
      if (!cu) continue;
      const [cx, cy] = view.toScreen(pad.at);
      const w = pad.size[0] * view.scale, hgt = pad.size[1] * view.scale;
      ctx.save();
      ctx.translate(cx, cy); ctx.rotate((-pad.rot * Math.PI) / 180);
      ctx.fillStyle = tht ? (C.padThroughHole || C[cu]) : C[cu] || '#c33';
      ctx.beginPath();
      if (pad.shape === 'circle' || pad.shape === 'oval') ctx.ellipse(0, 0, w / 2, hgt / 2, 0, 0, TAU);
      else if (pad.shape === 'roundrect' && ctx.roundRect) ctx.roundRect(-w / 2, -hgt / 2, w, hgt, Math.min(w, hgt) * 0.25);
      else ctx.rect(-w / 2, -hgt / 2, w, hgt);
      ctx.fill();
      if (pad.drill) { ctx.fillStyle = C.drill || '#000'; ctx.beginPath(); ctx.arc(0, 0, (pad.drill * view.scale) / 2, 0, TAU); ctx.fill(); }
      ctx.restore();
      // number and Net, when the pad is big enough to read (over the copper)
      const small = Math.min(w, hgt);
      if (small >= 14) labels.push(() => {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.shadowColor = 'rgba(0,0,0,.8)'; ctx.shadowBlur = 2;
        const fs = Math.min(13, small * 0.38);
        if (pad.net && small >= 22) {
          ctx.font = `600 ${fs}px system-ui, sans-serif`; ctx.fillText(pad.number, 0, -fs * 0.55);
          ctx.font = `${fs * 0.85}px system-ui, sans-serif`;
          const label = shortNet(pad.net, ctx, Math.max(w, hgt) * 0.95);
          ctx.fillText(label, 0, fs * 0.55);
        } else { ctx.font = `600 ${fs}px system-ui, sans-serif`; ctx.fillText(pad.number, 0, 0); }
        ctx.restore();
      });
    }
    if (partial) continue;
    // the footprint's origin: + (unlocked) or × (locked), on top of the copper
    {
      const [ox, oy] = view.toScreen(bf.at), col = C[flipLayer('F.SilkS', bf.side)] || '#ccc';
      if (visible(flipLayer('F.SilkS', bf.side)) || visible(flipLayer('F.Fab', bf.side))) labels.push(() => drawOriginMark(ctx, ox, oy, !!bf.locked, col));
    }
    // Reference on silk above the courtyard, Value on fab below it
    // a Footprint without its own Reference / Value text gets them above and below its courtyard
    const crt = (fp.graphics || []).find((g) => /CrtYd$/.test(g.layer || '') && g.type === 'rect');
    const top = crt ? Math.min(crt.a[1], crt.b[1]) : -mm(1);
    const text = (layer, str, local, size) => {
      if (!str || !visible(layer)) return;
      const px = size * view.scale;
      if (px < 4) return;
      const [x, y] = S(local);
      labels.push(() => {
        silkText(ctx, str, x, y, px, bf.side === 'B', C[layer] || '#ddd', board.textFont);
      });
    };
    if (!own.ref && !moved.has('ref')) text(flipLayer('F.SilkS', bf.side), ref, [0, top - mm(0.8)], mm(1));
    const bottom = crt ? Math.max(crt.a[1], crt.b[1]) : mm(1);
    if (!own.value && !moved.has('value')) text(flipLayer('F.Fab', bf.side), value, [0, bottom + mm(0.6)], mm(0.7));
  }
}

/**
 * Footprint text on screen in the board's stroke font (#79): the same glyphs, size and pen as the
 * Gerber silk (core/fab.js strokeText) in the board's `font` metrics, centred on (x, y) px, mirrored for the back.
 */
function silkText(ctx, str, x, y, px, mirror, color, font = 'stroke') {
  const { lines, pen } = vectorLayout(str, { x: 0, y: 0, px, align: 'center', baseline: 'middle', font: font || 'stroke' });
  ctx.save();
  ctx.translate(x, y); if (mirror) ctx.scale(-1, 1);
  ctx.strokeStyle = color; ctx.lineWidth = pen; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.setLineDash([]);
  ctx.beginPath();
  for (const pl of lines) { pl.forEach(([a, b], i) => (i ? ctx.lineTo(a, b) : ctx.moveTo(a, b))); if (pl.length === 1) ctx.lineTo(pl[0][0] + 0.01, pl[0][1]); }
  ctx.stroke();
  ctx.restore();
}

/** A Net name that fits `maxPx`: unnamed nets show as their Pad (Net-(R1-Pad2) -> R1-2). */
function shortNet(net, ctx, maxPx) {
  let s = /^Net-\((.+)-Pad(.+)\)$/.test(net) ? net.replace(/^Net-\((.+)-Pad(.+)\)$/, '$1-$2') : net;
  while (s.length > 3 && ctx.measureText(s).width > maxPx) s = s.slice(0, -2) + '…';
  return s;
}

/**
 * A Footprint's graphics (lines, rectangles, polygons, circles, arcs and text) through local ->
 * board transform T, each in its layer's colour (flipped for the back side). `${REF}` and
 * `${VALUE}` in text are filled in with `ref` / `value`. Returns { ref, value }: whether it drew
 * its own Reference / Value text. Shared by the Board and the Footprint editor.
 */
export function drawFootprintGraphics(ctx, view, C, fp, T, { side = 'F', visible = () => true, ref = 'REF**', value = 'VALUE', only = null, labels = null, font = 'stroke', skip = null, fpRot = 0 } = {}) {
  const S = (p) => view.toScreen(T(p));
  const own = { ref: false, value: false };
  const lw = (layer) => Math.max(1, mm(/SilkS/.test(layer) ? 0.12 : 0.1) * view.scale);
  (fp.graphics || []).forEach((g, i) => {
    if (only && !only.has(i)) return;
    const layer = flipLayer(g.layer || 'F.SilkS', side);
    if (g.type === 'text') { if (g.text.includes('${REF}')) own.ref = true; if (g.text.includes('${VALUE}')) own.value = true; }
    if (skip?.size && skip.has(fieldOfText(g))) return; // drawn from the placement's own override (#65)
    if (!visible(layer)) return;
    const col = C[layer] || '#888';
    ctx.save(); ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = lw(layer); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (/CrtYd/.test(layer)) { ctx.setLineDash([4, 3]); ctx.lineWidth = 1; }
    ctx.beginPath();
    // filled shapes (fill: 'outline', as Eagle's rectangles and polygons are) fill and keep their edge
    if (g.type === 'rect') { [g.a, [g.b[0], g.a[1]], g.b, [g.a[0], g.b[1]]].map(S).forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); if (g.fill === 'outline') ctx.fill(); ctx.stroke(); }
    else if (g.type === 'line' || g.type === 'poly') { g.pts.map(S).forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); if (g.type === 'poly') { ctx.closePath(); if (g.fill === 'outline') ctx.fill(); } ctx.stroke(); }
    else if (g.type === 'circle') {
      const [cx, cy] = S(g.c); ctx.arc(cx, cy, g.r * view.scale, 0, TAU);
      if (g.fill === 'outline') ctx.fill(); else ctx.stroke();
    } else if (g.type === 'arc') {
      const pts = [g.start, g.mid, g.end].map(T);
      shapePath(ctx, view, { type: 'arc', start: pts[0], mid: pts[1], end: pts[2] }); ctx.stroke();
    } else if (g.type === 'text') {
      const px = g.size * view.scale;
      if (px >= 4) {
        const str = String(g.text).replace(/\$\{REF\}/g, ref).replace(/\$\{VALUE\}/g, value);
        const [x, y] = S(g.at);
        // turned or anchored text (#84) goes through the same placement as the Gerber
        const turned = g.rot != null || g.align;
        const draw = () => {
          if (!turned) { silkText(ctx, str, x, y, px, side === 'B', col, font); return; }
          const w = footprintTextPlacement(g, str, T, { fpRot, side, font: font || 'stroke' });
          drawBoardDrawings(ctx, view, C, { textFont: font }, new Set(), { list: [{ id: 'fpt', type: 'text', text: str, at: w.at, size: w.size, rot: w.rot, layer }], color: col });
        };
        if (labels) labels.push(draw); else draw(); // with `labels`, over the copper later
      }
    }
    ctx.restore();
  });
  return own;
}

/** One pad, at its board position (shape, colour by layer, drill hole). */
export function drawPad(ctx, view, C, pad, cu) {
  const tht = pad.layers.includes('*.Cu');
  const [cx, cy] = view.toScreen(pad.at);
  const w = pad.size[0] * view.scale, hgt = pad.size[1] * view.scale;
  ctx.save();
  ctx.translate(cx, cy); ctx.rotate((-(pad.rot || 0) * Math.PI) / 180);
  ctx.fillStyle = tht ? (C.padThroughHole || C[cu]) : C[cu] || '#c33';
  ctx.beginPath();
  if (pad.shape === 'circle' || pad.shape === 'oval') ctx.ellipse(0, 0, w / 2, hgt / 2, 0, 0, TAU);
  else if (pad.shape === 'roundrect' && ctx.roundRect) ctx.roundRect(-w / 2, -hgt / 2, w, hgt, Math.min(w, hgt) * 0.25);
  else ctx.rect(-w / 2, -hgt / 2, w, hgt);
  ctx.fill();
  if (pad.drill) { ctx.fillStyle = C.drill || '#000'; ctx.beginPath(); ctx.arc(0, 0, (pad.drill * view.scale) / 2, 0, TAU); ctx.fill(); }
  const small = Math.min(w, hgt);
  if (small >= 12) {
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,.8)'; ctx.shadowBlur = 2;
    ctx.font = `600 ${Math.min(13, small * 0.4)}px system-ui, sans-serif`; ctx.fillText(pad.number, 0, 0);
  }
  ctx.restore();
}

/** Tracks, bottom layers first, in their layer's colour with round ends. `ids`: only these (highlighting). */
export function drawTracks(ctx, view, C, board, hidden = new Set(), ids = null) {
  const order = ['B.Cu', 'In2.Cu', 'In1.Cu', 'F.Cu'];
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const layer of order) {
    if (hidden.has(layer)) continue;
    ctx.strokeStyle = C[layer] || '#c33';
    for (const t of board.tracks || []) {
      if (t.layer !== layer || (ids && !ids.has(t.id))) continue;
      const [x0, y0] = view.toScreen(t.a), [x1, y1] = view.toScreen(t.b);
      ctx.lineWidth = Math.max(1, t.width * view.scale);
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    }
  }
  ctx.restore();
}

/** Through Vias: a ring in the Via colour with its drill hole. `ids`: only these (highlighting). */
export function drawVias(ctx, view, C, board, hidden = new Set(), ids = null) {
  if (hidden.has('F.Cu') && hidden.has('B.Cu')) return;
  ctx.save();
  for (const v of board.vias || []) {
    if (ids && !ids.has(v.id)) continue;
    const [x, y] = view.toScreen(v.at);
    ctx.fillStyle = C.via || '#c8c8c8';
    ctx.beginPath(); ctx.arc(x, y, Math.max(2, (v.diameter / 2) * view.scale), 0, TAU); ctx.fill();
    ctx.fillStyle = C.drill || '#000';
    ctx.beginPath(); ctx.arc(x, y, Math.max(1, (v.drill / 2) * view.scale), 0, TAU); ctx.fill();
  }
  ctx.restore();
}
