// Card thumbnails for Your projects: the Board once it has an Outline or Footprints,
// otherwise the first Sheet (ADR-0011), drawn offscreen in the current canvas colours.
import { ViewTransform, gridSpacing } from './transform.js';
import { canvasColors } from './canvas2d.js';
import { hasBoardContent } from '../core/store.js';
import { SCH_GRID, mm } from '../core/units.js';

const W = 320, H = 240;
const SHEET = { x0: 0, y0: 0, x1: mm(297), y1: mm(210) };

export function renderThumbnail(project) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const C = canvasColors();
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  const v = new ViewTransform();
  if (hasBoardContent(project)) {
    // Board drawing arrives with the Board tickets (#15 onwards); until then show its area.
    v.fit({ x0: -10e6, y0: -10e6, x1: 110e6, y1: 90e6 }, W, H, 14);
    grid(ctx, v, mm(5), { x0: -10e6, y0: -10e6, x1: 110e6, y1: 90e6 }, C);
  } else {
    v.fit(SHEET, W, H, 14);
    const [x0, y0] = v.toScreen([SHEET.x0, SHEET.y0]), [x1, y1] = v.toScreen([SHEET.x1, SHEET.y1]);
    ctx.fillStyle = C.paper; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    grid(ctx, v, SCH_GRID, SHEET, C);
    ctx.strokeStyle = C.edge; ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(x0) + 0.5, Math.round(y0) + 0.5, x1 - x0, y1 - y0);
  }
  return c.toDataURL('image/png');
}

function grid(ctx, v, base, r, C) {
  const { major } = gridSpacing(base, v.scale, 10);
  ctx.strokeStyle = C.minor; ctx.lineWidth = 1;
  ctx.beginPath();
  const [sx0, sy0] = v.toScreen([r.x0, r.y0]), [sx1, sy1] = v.toScreen([r.x1, r.y1]);
  for (let x = Math.ceil(r.x0 / major) * major; x <= r.x1; x += major) { const sx = Math.round(v.toScreen([x, 0])[0]) + 0.5; ctx.moveTo(sx, sy0); ctx.lineTo(sx, sy1); }
  for (let y = Math.ceil(r.y0 / major) * major; y <= r.y1; y += major) { const sy = Math.round(v.toScreen([0, y])[1]) + 0.5; ctx.moveTo(sx0, sy); ctx.lineTo(sx1, sy); }
  ctx.stroke();
}
