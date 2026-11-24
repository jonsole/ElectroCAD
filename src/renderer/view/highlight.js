// How selected (highlighted) things look, the same in every editor: Schematic parts, wires,
// labels and markup; Board footprints and outline; Symbol editor pins and graphics. The style is
// a Setting (Settings → Highlight); the colour is the Colour theme's Selection colour.
//
// Each editor draws its scene as usual, then calls highlight() with a function that draws just
// the selected items (in the colours it is given) and their boxes on screen.

export const HIGHLIGHT_STYLES = [
  ['glow', 'Glow', 'A soft halo in the selection colour around the selected things\' own lines'],
  ['colour', 'Colour', 'The selected things are drawn in the selection colour'],
  ['box', 'Box', 'A dashed box around each selected thing'],
  ['fade', 'Fade the rest', 'Everything else fades back, so the selection stands out'],
];
export const DEFAULT_HIGHLIGHT = 'glow';

const KEEP = new Set(['background', 'paper', 'symbolFill', 'zoneOpacity', 'inactiveDim']); // fills keep their colour

/** The theme with every colour turned into the selection colour (backgrounds kept). */
export function selectionColours(C) {
  const out = {};
  for (const [k, v] of Object.entries(C)) out[k] = KEEP.has(k) || typeof v !== 'string' ? v : C.selection;
  return out;
}

let scratch = null;
function layer(ctx) {
  const c = ctx.canvas;
  if (!scratch) scratch = document.createElement('canvas');
  if (scratch.width !== c.width || scratch.height !== c.height) { scratch.width = c.width; scratch.height = c.height; }
  const x = scratch.getContext('2d');
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.clearRect(0, 0, scratch.width, scratch.height);
  x.setTransform(ctx.getTransform());
  return [scratch, x];
}

/**
 * Highlight the selection.
 * @param {string} style       'glow' | 'colour' | 'box' | 'fade'
 * @param {(ctx, C) => void} drawOnly   draws just the selected things, in the colours given
 * @param {{x0,y0,x1,y1}[]} boxes        the selected things' screen boxes (for 'box')
 */
export function highlight(ctx, C, style, drawOnly, boxes = []) {
  if (!boxes.length) return;
  if (style === 'box') {
    ctx.save(); ctx.setLineDash([5, 4]); ctx.strokeStyle = C.selection; ctx.lineWidth = 1;
    for (const b of boxes) ctx.strokeRect(Math.round(b.x0) - 3.5, Math.round(b.y0) - 3.5, b.x1 - b.x0 + 7, b.y1 - b.y0 + 7);
    ctx.restore();
    return;
  }
  if (style === 'fade') {
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 0.62; ctx.fillStyle = C.background || '#000';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();
    drawOnly(ctx, C);
    return;
  }
  const S = selectionColours(C);
  if (style === 'colour') { drawOnly(ctx, S); return; }
  // glow: the selection's shapes, blurred into a halo, under a crisp redraw in their own colours
  const [img, x] = layer(ctx);
  drawOnly(x, S);
  const dpr = ctx.getTransform().a || 1;
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.shadowColor = C.selection; ctx.shadowBlur = 8 * dpr; ctx.globalAlpha = 0.9;
  // thin lines (wires, outlines) are drawn a few px apart first, so their halo is as strong as a body's
  const d = 1.5 * dpr;
  for (const [ox, oy] of [[0, 0], [d, 0], [-d, 0], [0, d], [0, -d]]) ctx.drawImage(img, ox, oy);
  ctx.restore();
  drawOnly(ctx, C);
}

/** Screen box of world box b. */
export const screenBox = (view, b) => {
  const [x0, y0] = view.toScreen([b.x0, b.y0]), [x1, y1] = view.toScreen([b.x1, b.y1]);
  return { x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1) };
};

/**
 * Bring world box `b` into view on a Canvas2D: pan so it is centred when any of it is off
 * screen, zooming out only if it doesn't fit (cross-probing).
 */
export function revealBox(cv, b, margin = 40) {
  if (!cv.w) return;
  const v = cv.view, R = 22; // the rulers
  const [x0, y0] = v.toScreen([b.x0, b.y0]), [x1, y1] = v.toScreen([b.x1, b.y1]);
  const inside = x0 >= R + margin && y0 >= R + margin && x1 <= cv.w - margin && y1 <= cv.h - margin;
  if (inside) return;
  if (x1 - x0 > cv.w - R - 2 * margin || y1 - y0 > cv.h - R - 2 * margin) {
    const pad = Math.max(b.x1 - b.x0, b.y1 - b.y0) * 0.15 + 1e6;
    v.fit({ x0: b.x0 - pad, y0: b.y0 - pad, x1: b.x1 + pad, y1: b.y1 + pad }, cv.w - R, cv.h - R, 30);
    v.pan(R, R);
  } else {
    v.pan((R + cv.w) / 2 - (x0 + x1) / 2, (R + cv.h) / 2 - (y0 + y1) / 2);
  }
  cv.invalidate();
}
