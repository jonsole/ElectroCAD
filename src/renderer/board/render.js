// Drawing the Board (#15): the Outline on Edge.Cuts, a faint board fill inside closed loops, the
// open ends of an unclosed Outline, and the shape being drawn. Footprints, Tracks and Zones join
// with their tickets. Screen space is the world scaled (+Y down on both), so angles match.
import { arcCircle } from '../core/geom.js';
import { outlineLoops, checkOutline } from '../core/board.js';
import { mm } from '../core/units.js';
import { placedPads, padNets, fpTransform, flipLayer } from '../core/footprint.js';
import { footprintOf } from '../core/project.js';

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
    drawFootprints(ctx, view, C, view2, board, hidden, opts.padsOnly, opts.padKeys);
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
/** `padsOnly`: Footprint ids drawn as just the pads in `padKeys` ("componentId:pad"), for highlighting a Net. */
function drawFootprints(ctx, view, C, project, board, hidden, padsOnly = null, padKeys = null) {
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
    const own = partial ? { ref: true, value: true } : drawFootprintGraphics(ctx, view, C, fp, T, { side: bf.side, visible, ref, value });
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
      // number and Net, when the pad is big enough to read
      const small = Math.min(w, hgt);
      if (small >= 14) {
        ctx.rotate((pad.rot * Math.PI) / 180); // text stays upright
        ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.shadowColor = 'rgba(0,0,0,.8)'; ctx.shadowBlur = 2;
        const fs = Math.min(13, small * 0.38);
        if (pad.net && small >= 22) {
          ctx.font = `600 ${fs}px system-ui, sans-serif`; ctx.fillText(pad.number, 0, -fs * 0.55);
          ctx.font = `${fs * 0.85}px system-ui, sans-serif`;
          const label = shortNet(pad.net, ctx, Math.max(w, hgt) * 0.95);
          ctx.fillText(label, 0, fs * 0.55);
        } else { ctx.font = `600 ${fs}px system-ui, sans-serif`; ctx.fillText(pad.number, 0, 0); }
      }
      ctx.restore();
    }
    if (partial) continue;
    // Reference on silk above the courtyard, Value on fab below it
    // a Footprint without its own Reference / Value text gets them above and below its courtyard
    const crt = (fp.graphics || []).find((g) => /CrtYd$/.test(g.layer || '') && g.type === 'rect');
    const top = crt ? Math.min(crt.a[1], crt.b[1]) : -mm(1);
    const text = (layer, str, local, size) => {
      if (!str || !visible(layer)) return;
      const px = size * view.scale;
      if (px < 4) return;
      const [x, y] = S(local);
      ctx.save(); ctx.fillStyle = C[layer] || '#ddd'; ctx.font = `600 ${px}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (bf.side === 'B') { ctx.translate(x, y); ctx.scale(-1, 1); ctx.fillText(str, 0, 0); } else ctx.fillText(str, x, y);
      ctx.restore();
    };
    if (!own.ref) text(flipLayer('F.SilkS', bf.side), ref, [0, top - mm(0.8)], mm(1));
    const bottom = crt ? Math.max(crt.a[1], crt.b[1]) : mm(1);
    if (!own.value) text(flipLayer('F.Fab', bf.side), value, [0, bottom + mm(0.6)], mm(0.7));
  }
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
export function drawFootprintGraphics(ctx, view, C, fp, T, { side = 'F', visible = () => true, ref = 'REF**', value = 'VALUE', only = null } = {}) {
  const S = (p) => view.toScreen(T(p));
  const own = { ref: false, value: false };
  const lw = (layer) => Math.max(1, mm(/SilkS/.test(layer) ? 0.12 : 0.1) * view.scale);
  (fp.graphics || []).forEach((g, i) => {
    if (only && !only.has(i)) return;
    const layer = flipLayer(g.layer || 'F.SilkS', side);
    if (g.type === 'text') { if (g.text.includes('${REF}')) own.ref = true; if (g.text.includes('${VALUE}')) own.value = true; }
    if (!visible(layer)) return;
    const col = C[layer] || '#888';
    ctx.save(); ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = lw(layer); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (/CrtYd/.test(layer)) { ctx.setLineDash([4, 3]); ctx.lineWidth = 1; }
    ctx.beginPath();
    if (g.type === 'rect') { [g.a, [g.b[0], g.a[1]], g.b, [g.a[0], g.b[1]]].map(S).forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.stroke(); }
    else if (g.type === 'line' || g.type === 'poly') { g.pts.map(S).forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); if (g.type === 'poly') ctx.closePath(); ctx.stroke(); }
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
        ctx.font = `600 ${px}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        if (side === 'B') { ctx.translate(x, y); ctx.scale(-1, 1); ctx.fillText(str, 0, 0); } else ctx.fillText(str, x, y);
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
