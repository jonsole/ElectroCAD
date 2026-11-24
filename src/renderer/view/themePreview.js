// Live preview for the colour theme editor: a small sample schematic or board drawn from
// primitives with the theme being edited, so every token is visible somewhere.
export function drawThemePreview(canvas, kind, C) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = C.background; ctx.fillRect(0, 0, W, H);
  ctx.font = '11px "Segoe UI", system-ui, sans-serif';
  if (kind === 'schematic') schematic(ctx, W, H, C); else board(ctx, W, H, C);
}

function grid(ctx, x0, y0, x1, y1, step, C) {
  ctx.lineWidth = 1;
  for (let pass = 0; pass < 2; pass++) {
    ctx.strokeStyle = pass ? C.gridMajor : C.gridMinor;
    ctx.beginPath();
    for (let x = x0, i = 0; x <= x1; x += step, i++) if ((i % 5 === 0) === !!pass) { ctx.moveTo(Math.round(x) + 0.5, y0); ctx.lineTo(Math.round(x) + 0.5, y1); }
    for (let y = y0, i = 0; y <= y1; y += step, i++) if ((i % 5 === 0) === !!pass) { ctx.moveTo(x0, Math.round(y) + 0.5); ctx.lineTo(x1, Math.round(y) + 0.5); }
    ctx.stroke();
  }
}

function schematic(ctx, W, H, C) {
  const px = 14, py = 14, pw = W - 28, ph = H - 28;
  ctx.fillStyle = C.paper; ctx.fillRect(px, py, pw, ph);
  grid(ctx, px, py, px + pw, py + ph, 10, C);
  ctx.strokeStyle = C.sheetEdge; ctx.lineWidth = 1.2; ctx.strokeRect(px + 0.5, py + 0.5, pw, ph);
  ctx.strokeRect(px + pw - 120.5, py + ph - 30.5, 120, 30);
  ctx.fillStyle = C.sheetEdge; ctx.fillText('Sheet 1 · Rev A', px + pw - 112, py + ph - 11);
  // origin
  ctx.strokeStyle = C.origin; ctx.beginPath(); ctx.moveTo(px + 4, py + 10); ctx.lineTo(px + 16, py + 10); ctx.moveTo(px + 10, py + 4); ctx.lineTo(px + 10, py + 16); ctx.stroke();
  // resistor R1 (body + pins) and an IC body
  const r = { x: 90, y: 70 };
  ctx.fillStyle = C.symbolFill; ctx.fillRect(r.x, r.y - 8, 40, 16);
  ctx.strokeStyle = C.symbolBody; ctx.lineWidth = 1.6; ctx.strokeRect(r.x, r.y - 8, 40, 16);
  ctx.strokeStyle = C.pin; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(r.x - 20, r.y); ctx.lineTo(r.x, r.y); ctx.moveTo(r.x + 40, r.y); ctx.lineTo(r.x + 60, r.y); ctx.stroke();
  ctx.fillStyle = C.reference; ctx.fillText('R1', r.x + 12, r.y - 13);
  ctx.fillStyle = C.value; ctx.fillText('10k', r.x + 11, r.y + 22);
  ctx.fillStyle = C.pinNumber; ctx.fillText('1', r.x - 12, r.y - 3); ctx.fillText('2', r.x + 46, r.y - 3);
  const u = { x: 230, y: 50 };
  ctx.fillStyle = C.symbolFill; ctx.fillRect(u.x, u.y, 70, 60);
  ctx.strokeStyle = C.symbolBody; ctx.lineWidth = 1.6; ctx.strokeRect(u.x, u.y, 70, 60);
  ctx.strokeStyle = C.pin; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(u.x - 20, u.y + 20); ctx.lineTo(u.x, u.y + 20); ctx.moveTo(u.x - 20, u.y + 40); ctx.lineTo(u.x, u.y + 40); ctx.stroke();
  ctx.fillStyle = C.pinName; ctx.fillText('IN', u.x + 5, u.y + 24); ctx.fillText('EN', u.x + 5, u.y + 44);
  ctx.fillStyle = C.reference; ctx.fillText('U1', u.x + 50, u.y - 5);
  // wires, junction, labels, power, no-connect
  ctx.strokeStyle = C.wire; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(r.x + 60, r.y); ctx.lineTo(u.x - 20, r.y); ctx.moveTo(170, r.y); ctx.lineTo(170, 130); ctx.moveTo(r.x - 20, r.y); ctx.lineTo(50, r.y); ctx.lineTo(50, 120); ctx.stroke();
  ctx.fillStyle = C.junction; ctx.beginPath(); ctx.arc(170, r.y, 3.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = C.netLabel; ctx.fillText('VIN', 174, 128);
  ctx.strokeStyle = C.globalLabel; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(u.x - 20, u.y + 40); ctx.lineTo(u.x - 26, u.y + 34); ctx.lineTo(u.x - 62, u.y + 34); ctx.lineTo(u.x - 62, u.y + 46); ctx.lineTo(u.x - 26, u.y + 46); ctx.closePath(); ctx.stroke();
  ctx.fillStyle = C.globalLabel; ctx.fillText('EN', u.x - 54, u.y + 44);
  ctx.strokeStyle = C.power; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(42, 120); ctx.lineTo(58, 120); ctx.moveTo(45, 124); ctx.lineTo(55, 124); ctx.moveTo(48, 128); ctx.lineTo(52, 128); ctx.stroke();
  ctx.strokeStyle = C.noConnect; ctx.beginPath(); ctx.moveTo(u.x + 86, u.y + 16); ctx.lineTo(u.x + 94, u.y + 24); ctx.moveTo(u.x + 94, u.y + 16); ctx.lineTo(u.x + 86, u.y + 24); ctx.stroke();
  ctx.strokeStyle = C.pin; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(u.x + 70, u.y + 20); ctx.lineTo(u.x + 90, u.y + 20); ctx.stroke();
  // selection, highlight, ERC markers
  ctx.setLineDash([4, 3]); ctx.strokeStyle = C.selection; ctx.lineWidth = 1; ctx.strokeRect(r.x - 24.5, r.y - 26.5, 90, 54); ctx.setLineDash([]);
  ctx.strokeStyle = C.highlight; ctx.lineWidth = 3; ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.moveTo(170, r.y); ctx.lineTo(170, 130); ctx.stroke(); ctx.globalAlpha = 1;
  marker(ctx, 300, 140, C.ercError); marker(ctx, 330, 140, C.ercWarning);
}

function marker(ctx, x, y, color) {
  ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(x, y - 7); ctx.lineTo(x + 7, y + 6); ctx.lineTo(x - 7, y + 6); ctx.closePath(); ctx.fill();
}

function board(ctx, W, H, C) {
  grid(ctx, 0, 0, W, H, 10, C);
  ctx.strokeStyle = C.origin; ctx.beginPath(); ctx.moveTo(24, 30); ctx.lineTo(36, 30); ctx.moveTo(30, 24); ctx.lineTo(30, 36); ctx.stroke();
  const bx = 40, by = 30, bw = W - 80, bh = H - 60;
  // zone (B.Cu fill) with opacity
  ctx.globalAlpha = C.zoneOpacity; ctx.fillStyle = C['B.Cu']; ctx.fillRect(bx + 10, by + 70, bw - 20, bh - 80); ctx.globalAlpha = 1;
  // inactive layer tracks (dimmed) and active F.Cu tracks
  const track = (layer, pts, w, dim) => {
    ctx.globalAlpha = dim ? 1 - C.inactiveDim : 1; ctx.strokeStyle = C[layer]; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); ctx.globalAlpha = 1;
  };
  track('In1.Cu', [[bx + 20, by + 30], [bx + 120, by + 30]], 3, true);
  track('In2.Cu', [[bx + 20, by + 44], [bx + 120, by + 44]], 3, true);
  track('B.Cu', [[bx + 150, by + 60], [bx + 220, by + 60], [bx + 250, by + 30]], 4, true);
  track('F.Cu', [[bx + 60, by + 100], [bx + 150, by + 100], [bx + 150, by + 60]], 4, false);
  // pads: SMD (F.Cu) and through-hole with drill; F.Paste/F.Mask hints
  ctx.fillStyle = C['F.Cu']; ctx.fillRect(bx + 46, by + 92, 14, 16); ctx.fillRect(bx + 76, by + 120, 14, 16);
  ctx.strokeStyle = C['F.Paste']; ctx.lineWidth = 1; ctx.strokeRect(bx + 48.5, by + 94.5, 9, 11);
  ctx.strokeStyle = C['F.Mask']; ctx.strokeRect(bx + 43.5, by + 89.5, 19, 21);
  ctx.strokeStyle = C['B.Mask']; ctx.strokeRect(bx + 73.5, by + 117.5, 19, 21);
  ctx.strokeStyle = C['B.Paste']; ctx.strokeRect(bx + 78.5, by + 122.5, 9, 11);
  for (const [x, y] of [[bx + 220, by + 100], [bx + 245, by + 100]]) {
    ctx.fillStyle = C.padThroughHole; ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = C.drill; ctx.beginPath(); ctx.arc(x, y, 3.2, 0, Math.PI * 2); ctx.fill();
  }
  // via joining F.Cu and B.Cu
  ctx.fillStyle = C.via; ctx.beginPath(); ctx.arc(bx + 150, by + 60, 5.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = C.drill; ctx.beginPath(); ctx.arc(bx + 150, by + 60, 2.2, 0, Math.PI * 2); ctx.fill();
  // silk, courtyard, fab
  ctx.strokeStyle = C['F.SilkS']; ctx.lineWidth = 1.2; ctx.strokeRect(bx + 38.5, by + 84.5, 58, 58);
  ctx.fillStyle = C['F.SilkS']; ctx.fillText('R1', bx + 40, by + 80);
  ctx.fillStyle = C['B.SilkS']; ctx.fillText('B silk', bx + 180, by + 132);
  ctx.setLineDash([2, 2]); ctx.strokeStyle = C['F.CrtYd']; ctx.strokeRect(bx + 34.5, by + 80.5 + 0, 66, 66); ctx.strokeStyle = C['B.CrtYd']; ctx.strokeRect(bx + 206.5, by + 86.5, 54, 28); ctx.setLineDash([]);
  ctx.strokeStyle = C['F.Fab']; ctx.strokeRect(bx + 42.5, by + 88.5, 50, 50); ctx.strokeStyle = C['B.Fab']; ctx.strokeRect(bx + 210.5, by + 90.5, 46, 20);
  // board outline
  ctx.strokeStyle = C['Edge.Cuts']; ctx.lineWidth = 1.6; ctx.strokeRect(bx + 0.5, by + 0.5, bw, bh);
  // ratsnest, selection, highlight, DRC
  ctx.setLineDash([3, 3]); ctx.strokeStyle = C.ratsnest; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(bx + 83, by + 128); ctx.lineTo(bx + 220, by + 100); ctx.stroke();
  ctx.strokeStyle = C.selection; ctx.strokeRect(bx + 210.5, by + 88.5, 50, 24); ctx.setLineDash([]);
  ctx.strokeStyle = C.highlight; ctx.globalAlpha = 0.5; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(bx + 60, by + 100); ctx.lineTo(bx + 150, by + 100); ctx.stroke(); ctx.globalAlpha = 1;
  ctx.fillStyle = C.drcError; ctx.beginPath(); ctx.arc(bx + 250, by + 40, 5, 0, Math.PI * 2); ctx.fill();
}
