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
