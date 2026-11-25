// Drawing resize handles (core/handles.js) on a canvas: small squares, hollow for side handles.
export function drawHandles(ctx, view, C, handles, active = null) {
  if (!handles?.length) return;
  ctx.save();
  ctx.lineWidth = 1.5;
  for (const h of handles) {
    const [x, y] = view.toScreen(h.at);
    const s = h.key === active ? 5 : 4;
    ctx.beginPath();
    if (h.side || h.key === 'mid') ctx.arc(x, y, s, 0, Math.PI * 2); else ctx.rect(x - s, y - s, s * 2, s * 2);
    ctx.fillStyle = h.key === active ? C.selection : C.background || '#fff';
    ctx.fill();
    ctx.strokeStyle = C.selection;
    ctx.stroke();
  }
  ctx.restore();
}

/** A diamond on the point a snap went to (another object's handle or pad). */
export function drawSnapMark(ctx, view, C, at) {
  if (!at) return;
  const [x, y] = view.toScreen(at);
  ctx.save();
  ctx.strokeStyle = C.selection; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x, y - 7); ctx.lineTo(x + 7, y); ctx.lineTo(x, y + 7); ctx.lineTo(x - 7, y); ctx.closePath(); ctx.stroke();
  ctx.restore();
}

/**
 * A component's origin: a small + when it can move, a small × when it is locked. Screen size, so
 * it reads the same at any zoom.
 */
export function drawOriginMark(ctx, x, y, locked, color, r = 3.5) {
  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = 1.3; ctx.globalAlpha = 0.85; ctx.lineCap = 'round';
  ctx.beginPath();
  if (locked) { ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r); ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r); }
  else { ctx.moveTo(x - r, y); ctx.lineTo(x + r, y); ctx.moveTo(x, y - r); ctx.lineTo(x, y + r); }
  ctx.stroke();
  ctx.restore();
}
