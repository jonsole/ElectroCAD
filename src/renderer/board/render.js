// Drawing the Board (#15): the Outline on Edge.Cuts, a faint board fill inside closed loops, the
// open ends of an unclosed Outline, and the shape being drawn. Footprints, Tracks and Zones join
// with their tickets. Screen space is the world scaled (+Y down on both), so angles match.
import { arcCircle } from '../core/geom.js';
import { outlineLoops, checkOutline } from '../core/board.js';
import { mm } from '../core/units.js';

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
  const loops = outlineLoops(outline);
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
      const sel = opts.selection?.has(i);
      if (sel) { ctx.strokeStyle = C.selection; ctx.lineWidth = lw + 4; ctx.globalAlpha = 0.35; ctx.stroke(); ctx.globalAlpha = 1; }
      ctx.strokeStyle = edge; ctx.lineWidth = lw; ctx.stroke();
    });
    // where the Outline is open: a ring at each loose end
    const { openEnds } = checkOutline(outline);
    if (outline.length && openEnds.length) {
      ctx.strokeStyle = C.ercError || '#e5484d'; ctx.lineWidth = 2;
      for (const p of openEnds) { const [x, y] = view.toScreen(p); ctx.beginPath(); ctx.arc(x, y, 6, 0, TAU); ctx.stroke(); }
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
