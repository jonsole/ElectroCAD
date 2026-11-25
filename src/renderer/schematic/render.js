// Draws Symbols on the schematic canvas with the Schematic Colour theme (#51).
// Graphics are in the Symbol's local frame (nm); `place` applies the Symbol's rotation/mirror.
import { drawOriginMark } from '../view/handles.js';
import { place, arcCircle, shapePoints } from '../core/geom.js';
import { partOf } from '../core/project.js';
import { mm } from '../core/units.js';
import { junctions, connectedPins, wireCrossings } from '../core/netlist.js';
import { placeFields, styleFor } from '../core/fields.js';
import { labelShape, labelFrame, labelBounds, isPower, LABEL_TEXT } from '../core/labels.js';
import { textLayout, drawingBounds, expandVariables, titleBlockLayout } from '../core/drawings.js';

const LINE = mm(0.2);      // symbol body line width
const PIN_LINE = mm(0.15);
const TEXT = mm(1.27);     // field text height

const DIRS = { L: [-1, 0], R: [1, 0], U: [0, -1], D: [0, 1] };

/**
 * Draw one Unit of a Part.
 * @param ctx      canvas 2D context (screen space)
 * @param toScreen world [x,y] -> screen [x,y]
 * @param scale    px per nm
 * @param part, unitIndex, sym {at, rot, mirror}
 * @param fields   { reference, value } strings to show (null to hide)
 * @param C        resolved Schematic Colour theme
 * @param opts     { alpha }
 */
export function drawUnit(ctx, toScreen, scale, part, unitIndex, sym, fields, C, opts = {}) {
  const unit = part.units[unitIndex || 0];
  if (!unit) return;
  const P = (p) => toScreen(place(p, sym.at, sym.rot, sym.mirror));
  ctx.save();
  if (opts.alpha != null) ctx.globalAlpha = opts.alpha;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const bodyW = Math.max(1, LINE * scale);
  for (const g of unit.graphics) {
    if (g.type === 'text') {
      // text stays upright whatever the Symbol's rotation
      const [tx, ty] = P(g.at);
      const px = g.size * scale;
      if (px < 3 || opts.bare) continue;
      ctx.save(); ctx.fillStyle = C.symbolBody; ctx.font = `${px}px "Segoe UI", system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(g.text, tx, ty); ctx.restore();
      continue;
    }
    ctx.beginPath();
    if (g.type === 'arc') {
      const c = arcCircle(g.start, g.mid, g.end);
      const pts = [g.start, g.mid, g.end].map(P);
      if (!c) { pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); }
      else {
        const [cx, cy] = P(c.c);
        const ang = ([x, y]) => Math.atan2(y - cy, x - cx);
        const a0 = ang(pts[0]), a1 = ang(pts[1]), a2 = ang(pts[2]);
        // go the way that passes through the middle point
        const norm = (a) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        const ccw = norm(a1 - a0) > norm(a2 - a0);
        ctx.arc(cx, cy, Math.hypot(pts[0][0] - cx, pts[0][1] - cy), a0, a2, ccw);
      }
    } else if (g.type === 'rect') {
      const pts = [g.a, [g.b[0], g.a[1]], g.b, [g.a[0], g.b[1]]].map(P);
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
    } else if (g.type === 'circle') {
      const [cx, cy] = P(g.c);
      ctx.arc(cx, cy, g.r * scale, 0, Math.PI * 2);
    } else if (g.pts) {
      g.pts.map(P).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      if (g.type === 'poly' && g.fill && g.fill !== 'none') ctx.closePath();
    }
    if (g.fill === 'background') { ctx.fillStyle = C.symbolFill; ctx.fill(); }
    else if (g.fill === 'outline') { ctx.fillStyle = C.symbolBody; ctx.fill(); }
    ctx.strokeStyle = C.symbolBody;
    ctx.lineWidth = bodyW * (g.width || 1);
    ctx.stroke();
  }
  // Pins: a line from the tip into the body; numbers and names unless hidden.
  ctx.strokeStyle = C.pin;
  ctx.lineWidth = Math.max(1, PIN_LINE * scale);
  const fontPx = Math.max(7, TEXT * scale * 0.8);
  ctx.font = `${fontPx}px "Segoe UI", system-ui, sans-serif`;
  for (const pin of unit.pins) {
    const d = DIRS[pin.dir] || [0, 0];
    const end = [pin.at[0] + d[0] * pin.length, pin.at[1] + d[1] * pin.length];
    const [ax, ay] = P(pin.at), [bx, by] = P(end);
    // a connected Pin takes the Wire colour so it reads as part of the Wire; a bare one keeps the
    // Pin colour and gets a small open circle at its tip (only when connection info is given)
    const conn = opts.connected ? opts.connected.has(pin.number) : null;
    ctx.strokeStyle = conn && opts.colorConnected ? C.wire : C.pin;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    if (conn === false && opts.markUnconnected) {
      ctx.beginPath(); ctx.arc(ax, ay, Math.max(2, mm(0.3) * scale), 0, Math.PI * 2); ctx.stroke();
    }
    if (!unit.hidePinNumbers && !opts.bare && scale * TEXT > 5) {
      ctx.fillStyle = C.pinNumber; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText(pin.number, (ax + bx) / 2, (ay + by) / 2 - 2);
    }
    if (!unit.hidePinNames && !opts.bare && pin.name && pin.name !== '~' && scale * TEXT > 5) {
      ctx.fillStyle = C.pinName; ctx.textBaseline = 'middle';
      const inward = P([end[0] + d[0] * mm(0.6), end[1] + d[1] * mm(0.6)]);
      ctx.textAlign = inward[0] > bx + 0.5 ? 'left' : inward[0] < bx - 0.5 ? 'right' : 'center';
      ctx.fillText(pin.name, inward[0], inward[1]);
    }
  }
  // The placing ghost's fields ("R?", the default Value): above and below the body, upright.
  // Placed Symbols get their fields from the Field style placer instead (drawFields).
  if (fields && scale * TEXT > 4) {
    ctx.font = `${Math.max(8, TEXT * scale)}px "Segoe UI", system-ui, sans-serif`;
    ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    const h = bodyHalfHeight(unit) + TEXT;
    const vertical = (sym.rot || 0) % 180 !== 0;
    for (const [key, color, dir] of [['reference', C.reference, -1], ['value', C.value, 1]]) {
      if (!fields[key]) continue;
      const [x, y] = vertical ? toScreen([sym.at[0] + h + TEXT * 1.5, sym.at[1] + dir * TEXT * 0.7]) : toScreen([sym.at[0], sym.at[1] + dir * h]);
      if (vertical) ctx.textAlign = 'left';
      ctx.fillStyle = color;
      ctx.fillText(fields[key], x, y);
    }
  }
  ctx.restore();
}

/** Half the body's height in the Symbol's local frame (how far it reaches above/below its axis). */
function bodyHalfHeight(unit) {
  let m = 0;
  for (const g of unit.graphics) {
    const pts = shapePoints(g);
    for (const p of pts) m = Math.max(m, Math.abs(p[1]));
  }
  return m;
}

/** Schematic display options (Settings → Schematic display); app settings, not per Project. */
export const DEFAULT_DISPLAY = { colorConnectedPins: false, markUnconnectedPins: true, wireHops: true };

const WIRE = mm(0.15);
const HOP = mm(0.5); // radius of the bridge where Wires cross without connecting
const JUNCTION = mm(0.5);

function strokeWire(ctx, view, a, b) {
  const [ax, ay] = view.toScreen(a), [bx, by] = view.toScreen(b);
  ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
}

const FONT = '"Segoe UI", system-ui, sans-serif';
let measureCtx = null;
/** Text width in nm for a text size in nm, measured with the canvas font (used by the field placer). */
export function measureText(text, sizeNm) {
  if (typeof document === 'undefined') return Math.round(String(text).length * sizeNm * 0.6); // no DOM (tests, print in a worker)
  measureCtx ||= document.createElement('canvas').getContext('2d');
  measureCtx.font = `100px ${FONT}`;
  return Math.round((measureCtx.measureText(String(text)).width / 100) * sizeNm);
}

/** A small push-pin glyph whose point is at `at` (screen px). */
function drawPin(ctx, [x, y], color, size) {
  ctx.save();
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = Math.max(1, size / 7); ctx.lineCap = 'round';
  const r = size * 0.32;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + size * 0.45, y - size * 0.45); ctx.stroke();
  ctx.beginPath(); ctx.arc(x + size * 0.62, y - size * 0.62, r, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

/** Draw placed fields (from core/fields.js placeFields) upright, plus a marker on flagged ones. */
function drawFields(ctx, view, C, project, sheet, placement, selection = new Set()) {
  for (const sym of sheet.symbols) {
    const r = placement.get(sym.id);
    if (!r || !r.items.length) continue;
    const style = styleFor(project, project.components[sym.componentId]);
    const px = style.text.size * view.scale;
    if (px < 4) continue;
    ctx.font = `${style.text.italic ? 'italic ' : ''}${style.text.bold ? '600 ' : ''}${px}px ${FONT}`;
    ctx.textBaseline = 'middle';
    for (const it of r.items) {
      ctx.textAlign = it.align;
      ctx.fillStyle = it.keys.includes('reference') ? C.reference : C.value;
      const [x, y] = view.toScreen([it.x, it.y]);
      ctx.fillText(it.text, x, y);
      // a pinned field of a selected part shows a small pin at its top-right corner
      if (it.pinned && selection.has(sym.id)) {
        drawPin(ctx, view.toScreen([it.box.x1, it.box.y0]), C.selection, Math.max(7, px * 0.6));
        // a faint dashed tether to its part, so a field moved far away still shows whose it is
        const [sx, sy] = view.toScreen(sym.at);
        ctx.save(); ctx.strokeStyle = C.selection; ctx.globalAlpha = 0.45; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(x, y + (it.box.y1 - it.box.y0) * view.scale * (sy > y ? 0.5 : -0.5)); ctx.lineTo(sx, sy); ctx.stroke();
        ctx.restore();
      }
    }
    if (r.flagged) {
      const b = r.items[0].box;
      const [x, y] = view.toScreen([b.x0, b.y0]);
      const t = Math.max(5, px * 0.55);
      ctx.fillStyle = C.ercWarning;
      ctx.beginPath(); ctx.moveTo(x - t * 1.4, y - t * 0.2); ctx.lineTo(x - t * 0.4, y - t * 0.2); ctx.lineTo(x - t * 0.9, y - t * 1.1); ctx.closePath(); ctx.fill();
    }
  }
}

/** Draw Net labels, Global labels and Power symbols (text always upright). */
export function drawLabels(ctx, view, C, labels, { selection = new Set(), alpha = null } = {}) {
  ctx.save();
  if (alpha != null) ctx.globalAlpha = alpha;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const lw = Math.max(1.2, mm(0.15) * view.scale);
  for (const l of labels) {
    const shape = labelShape(l, measureText);
    const f = labelFrame(l);
    const W = (p) => view.toScreen([l.at[0] + f.apply(p)[0], l.at[1] + f.apply(p)[1]]);
    const color = isPower(l) ? C.power : l.scope === 'global' ? C.globalLabel : C.netLabel;
    ctx.strokeStyle = color; ctx.lineWidth = lw;
    ctx.beginPath();
    for (const pts of [...shape.lines, ...shape.polys]) pts.map(W).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
    const px = LABEL_TEXT * view.scale;
    if (px < 4) continue;
    ctx.fillStyle = color;
    ctx.font = `${isPower(l) || l.scope === 'global' ? '600 ' : ''}${px}px ${FONT}`;
    ctx.textBaseline = 'middle';
    const [tx, ty] = W(shape.text.at);
    ctx.save();
    ctx.translate(tx, ty);
    let align = shape.text.align;
    if (isPower(l)) {
      // centred over the bar when upright; beside it when the symbol is turned sideways
      const d = f.apply([0, -1]);
      if (Math.abs(d[0]) > Math.abs(d[1])) align = d[0] < 0 ? 'right' : 'left';
    } else {
      if (f.rot === 90) ctx.rotate(-Math.PI / 2);
      if (f.flip) align = align === 'left' ? 'right' : align === 'right' ? 'left' : align;
    }
    ctx.textAlign = align;
    ctx.fillText(l.net || '?', 0, 0);
    ctx.restore();
  }
  ctx.restore();
}

const DASH = { solid: [], dashed: [8, 5], dotted: [1.5, 4] };

/** Draw markup (text notes, lines with arrows, rectangles, circles, arcs). Text variables are shown filled in. */
export function drawDrawings(ctx, view, C, project, sheet, drawings, { selection = new Set(), alpha = null } = {}) {
  const lw = Math.max(1.2, mm(0.15) * view.scale);
  for (const d of drawings) {
    ctx.save();
    if (alpha != null) ctx.globalAlpha = alpha;
    ctx.strokeStyle = C.note; ctx.fillStyle = C.note; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.setLineDash((DASH[d.style] || []).map((x) => x * Math.max(1, lw / 1.5)));
    const S = (p) => view.toScreen(p);
    if (d.type === 'text') {
      const shown = { ...d, text: expandVariables(d.text, project, sheet) };
      const lay = textLayout(shown, measureText);
      const px = d.size * view.scale;
      if (px >= 3) {
        const [ax, ay] = S(d.at);
        ctx.translate(ax, ay);
        if (d.rot === 90) ctx.rotate(-Math.PI / 2);
        ctx.font = `${d.italic ? 'italic ' : ''}${d.bold ? '600 ' : ''}${px}px ${FONT}`;
        ctx.textAlign = d.align || 'left'; ctx.textBaseline = 'middle';
        lay.lines.forEach((line, i) => ctx.fillText(line, 0, i * lay.lh * view.scale));
      }
    } else {
      ctx.beginPath();
      if (d.type === 'line') d.pts.map(S).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      else if (d.type === 'rect') { const [x0, y0] = S(d.a), [x1, y1] = S(d.b); ctx.rect(x0, y0, x1 - x0, y1 - y0); }
      else if (d.type === 'circle') { const [cx, cy] = S(d.c); ctx.arc(cx, cy, d.r * view.scale, 0, Math.PI * 2); }
      else if (d.type === 'arc') {
        const c = arcCircle(d.start, d.mid, d.end);
        if (!c) { const [a, b] = [S(d.start), S(d.end)]; ctx.moveTo(...a); ctx.lineTo(...b); }
        else {
          const [cx, cy] = S(c.c), ang = (p) => { const [x, y] = S(p); return Math.atan2(y - cy, x - cx); };
          const norm = (a) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
          const a0 = ang(d.start), a1 = ang(d.mid), a2 = ang(d.end);
          ctx.arc(cx, cy, c.r * view.scale, a0, a2, norm(a1 - a0) > norm(a2 - a0));
        }
      }
      if ((d.type === 'rect' || d.type === 'circle') && d.fill === 'tint') { ctx.save(); ctx.globalAlpha *= 0.1; ctx.fill(); ctx.restore(); }
      ctx.stroke();
      // arrowheads on lines
      if (d.type === 'line') {
        ctx.setLineDash([]);
        const head = (tip, from) => {
          const [tx, ty] = S(tip), [fx, fy] = S(from);
          const a = Math.atan2(ty - fy, tx - fx), L = Math.max(7, mm(1.3) * view.scale), W = 0.45;
          ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx - L * Math.cos(a - W), ty - L * Math.sin(a - W)); ctx.lineTo(tx - L * Math.cos(a + W), ty - L * Math.sin(a + W)); ctx.closePath(); ctx.fill();
        };
        const n = d.pts.length;
        if (d.arrowEnd && n > 1) head(d.pts[n - 1], d.pts[n - 2]);
        if (d.arrowStart && n > 1) head(d.pts[0], d.pts[1]);
      }
    }
    ctx.restore();
  }
}
const S0 = (view, p) => view.toScreen(p);

/** The title block in the bottom-right corner: Project fields, the Sheet's name and number. */
export function drawTitleBlock(ctx, view, C, project, sheet) {
  const tb = titleBlockLayout(sheet);
  const S = (p) => view.toScreen(p);
  ctx.save();
  ctx.strokeStyle = C.sheetEdge; ctx.lineWidth = Math.max(1, mm(0.2) * view.scale);
  for (const c of tb.cells) {
    const [x0, y0] = S([c.box.x0, c.box.y0]), [x1, y1] = S([c.box.x1, c.box.y1]);
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    const lpx = mm(1.1) * view.scale;
    if (lpx >= 4) {
      ctx.fillStyle = C.sheetEdge; ctx.globalAlpha = 0.75; ctx.font = `${lpx}px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText(c.label, x0 + mm(0.8) * view.scale, y0 + mm(0.5) * view.scale);
      ctx.globalAlpha = 1;
    }
    const vpx = c.size * view.scale, value = c.value(project, sheet);
    if (value && vpx >= 4) {
      ctx.fillStyle = C.sheetEdge; ctx.font = `${c.bold ? '600 ' : ''}${vpx}px ${FONT}`; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      const small = c.box.y1 - c.box.y0 < mm(5);
      ctx.save(); ctx.beginPath(); ctx.rect(x0, y0, x1 - x0, y1 - y0); ctx.clip();
      ctx.fillText(value, small ? x0 + (mm(0.8) + (c.label.length + 1) * mm(0.6)) * view.scale : x0 + mm(1.5) * view.scale, small ? (y0 + y1) / 2 : y0 + (y1 - y0) * 0.6);
      ctx.restore();
    }
  }
  const [bx0, by0] = S([tb.box.x0, tb.box.y0]), [bx1, by1] = S([tb.box.x1, tb.box.y1]);
  ctx.lineWidth = Math.max(1.5, mm(0.35) * view.scale); ctx.strokeRect(bx0, by0, bx1 - bx0, by1 - by0);
  ctx.restore();
}

/**
 * Draw a Sheet: markup, Wires, Symbols, fields, Junctions, then the placement ghost and a Wire
 * being drawn. With `only` (a Set of ids) it draws just those items and nothing around them: the
 * highlight pass (view/highlight.js) uses that to draw the selection in its style.
 */
export function drawSheet(ctx, view, C, project, sheet0, { selection = new Set(), only = null, ghost = null, bounds, wiring = null, target = null, placement = null, display = DEFAULT_DISPLAY, ghostLabel = null, erc = null, ercFocus = null, ghostDrawing = null } = {}) {
  const toScreen = (p) => view.toScreen(p);
  const wireW = Math.max(1.5, WIRE * view.scale);
  const sheet = only ? { ...sheet0, symbols: sheet0.symbols.filter((x) => only.has(x.id)), wires: sheet0.wires.filter((x) => only.has(x.id)), labels: (sheet0.labels || []).filter((x) => only.has(x.id)), noConnects: (sheet0.noConnects || []).filter((x) => only.has(x.id)), drawings: (sheet0.drawings || []).filter((x) => only.has(x.id)) } : sheet0;
  if (only) { ghost = null; wiring = null; target = null; ghostLabel = null; erc = null; ghostDrawing = null; }
  // the title block and markup go underneath the circuit
  if (!only) drawTitleBlock(ctx, view, C, project, sheet);
  drawDrawings(ctx, view, C, project, sheet, sheet.drawings || []);
  if (ghostDrawing) drawDrawings(ctx, view, C, project, sheet, [ghostDrawing], { alpha: 0.6 });
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = C.wire; ctx.lineWidth = wireW;
  // horizontal Wires hop over vertical ones they cross without connecting
  const hops = new Map();
  if (display.wireHops) for (const c of wireCrossings(sheet)) { if (!hops.has(c.over)) hops.set(c.over, []); hops.get(c.over).push(c.at[0]); }
  const r = Math.max(4, HOP * view.scale);
  ctx.beginPath();
  for (const w of sheet.wires) {
    const xs = hops.get(w.id);
    if (!xs) { strokeWire(ctx, view, w.a, w.b); continue; }
    const [ax, ay] = view.toScreen(w.a), [bx] = view.toScreen(w.b);
    const dir = bx >= ax ? 1 : -1;
    const pts = xs.map((x) => view.toScreen([x, w.a[1]])[0]).sort((p, q) => (p - q) * dir);
    ctx.moveTo(ax, ay);
    for (const x of pts) {
      ctx.lineTo(x - dir * r, ay);
      // a semicircle bridge, bulging up the screen
      ctx.arc(x, ay, r, dir > 0 ? Math.PI : 0, dir > 0 ? 0 : Math.PI, dir < 0);
    }
    ctx.lineTo(bx, ay);
  }
  ctx.stroke();
  ctx.restore();
  const conn = connectedPins(project, sheet0);
  for (const sym of sheet.symbols) {
    const comp = project.components[sym.componentId];
    const part = partOf(project, comp);
    if (!part) continue;
    const unit = part.units[sym.unit || 0];
    const connected = new Set(unit ? unit.pins.filter((pn) => conn.has(`${sym.id}:${pn.number}`)).map((pn) => pn.number) : []);
    drawUnit(ctx, toScreen, view.scale, part, sym.unit, sym, null, C, { connected, colorConnected: display.colorConnectedPins, markUnconnected: display.markUnconnectedPins }); // fields come from the placer
  }
  // each part's origin: + (unlocked) or × (locked)
  if (!only) for (const sym of sheet.symbols) { const [x, y] = view.toScreen(sym.at); drawOriginMark(ctx, x, y, !!sym.locked, C.symbolBody || '#888'); }
  drawLabels(ctx, view, C, sheet.labels || []);
  drawFields(ctx, view, C, project, sheet, placement || placeFields(project, sheet, { measure: measureText }), selection);
  // Junction dots, derived from the Wires and Pins
  ctx.fillStyle = C.junction;
  const jr = Math.max(2.5, JUNCTION * view.scale);
  for (const j of only ? [] : junctions(project, sheet)) { const [x, y] = view.toScreen(j); ctx.beginPath(); ctx.arc(x, y, jr, 0, Math.PI * 2); ctx.fill(); }
  // no-connect markers: a cross on the Pin tip
  const nc = Math.max(3, mm(0.6) * view.scale);
  for (const n of sheet.noConnects || []) {
    const [x, y] = view.toScreen(n.at);
    ctx.save(); ctx.strokeStyle = C.noConnect; ctx.lineWidth = Math.max(1.5, mm(0.18) * view.scale); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x - nc, y - nc); ctx.lineTo(x + nc, y + nc); ctx.moveTo(x + nc, y - nc); ctx.lineTo(x - nc, y + nc); ctx.stroke();
    ctx.restore();
  }
  // ERC markers while the ERC card is open: a small badge at each problem, the focused one ringed
  if (erc) {
    for (const v of erc) {
      const [x, y] = view.toScreen(v.at);
      const r = 6;
      ctx.save();
      ctx.fillStyle = v.severity === 'error' ? C.ercError : C.ercWarning;
      ctx.globalAlpha = 0.9;
      ctx.beginPath(); ctx.moveTo(x + 4, y - 4 - r * 1.6); ctx.lineTo(x + 4 + r, y - 4); ctx.lineTo(x + 4 - r, y - 4); ctx.closePath(); ctx.fill();
      if (v.id === ercFocus) {
        ctx.globalAlpha = 1; ctx.strokeStyle = v.severity === 'error' ? C.ercError : C.ercWarning; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, Math.max(10, mm(1.5) * view.scale), 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
    }
  }
  // a Wire being drawn, and the Pin/Wire it would end on
  if (wiring && wiring.length > 1) {
    ctx.save(); ctx.globalAlpha = 0.75; ctx.strokeStyle = C.wire; ctx.lineWidth = wireW; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); wiring.map((p) => view.toScreen(p)).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
    ctx.restore();
  }
  if (target) {
    const [x, y] = view.toScreen(target);
    ctx.save(); ctx.strokeStyle = C.selection; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, Math.max(5, mm(0.8) * view.scale), 0, Math.PI * 2); ctx.stroke(); ctx.restore();
  }
  if (ghostLabel) drawLabels(ctx, view, C, [ghostLabel], { alpha: 0.6 });
  if (ghost) {
    drawUnit(ctx, toScreen, view.scale, ghost.part, ghost.unit || 0, ghost, { reference: ghost.ref || ghost.part.prefix + '?', value: ghost.part.defaultValue }, C, { alpha: 0.6 });
  }
}

/** A tile thumbnail of a Part's first Unit, centred and fitted into size x size px. */
export function symbolThumbnail(part, C, size = 144) {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  const unit = part.units[0];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = ([x, y]) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  for (const g of unit.graphics) shapePoints(g).forEach(add);
  for (const p of unit.pins) add(p.at);
  const pad = size * 0.14;
  const scale = Math.min((size - 2 * pad) / Math.max(1, x1 - x0), (size - 2 * pad) / Math.max(1, y1 - y0));
  const ox = size / 2 - ((x0 + x1) / 2) * scale, oy = size / 2 - ((y0 + y1) / 2) * scale;
  const toScreen = ([x, y]) => [x * scale + ox, y * scale + oy];
  // thick enough to read at tile size
  // just the shape: pin names and numbers are unreadable at tile size
  drawUnit(ctx, toScreen, Math.max(scale, 3 / LINE), part, 0, { at: [0, 0], rot: 0, mirror: false }, null, C, { bare: true });
  return c.toDataURL('image/png');
}

/**
 * A Footprint's pads on a small canvas, in the Board colour theme: copper pads (through-hole
 * ones in the through-hole colour with their drill), the courtyard dashed, pad numbers on top.
 */
export function drawFootprintPreview(canvas, fp, C) {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.width, H = canvas.height;
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.fillStyle = C.background; ctx.fillRect(0, 0, W, H);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  for (const p of fp.pads) { add(p.at[0] - p.size[0] / 2, p.at[1] - p.size[1] / 2); add(p.at[0] + p.size[0] / 2, p.at[1] + p.size[1] / 2); }
  const crt = (fp.graphics || []).find((g) => g.layer === 'F.CrtYd' && g.type === 'rect');
  if (crt) { add(crt.a[0], crt.a[1]); add(crt.b[0], crt.b[1]); }
  const pad = 16;
  const s = Math.min((W - 2 * pad) / Math.max(1, x1 - x0), (H - 2 * pad) / Math.max(1, y1 - y0));
  const T = ([x, y]) => [W / 2 + (x - (x0 + x1) / 2) * s, H / 2 + (y - (y0 + y1) / 2) * s];
  if (crt) {
    const [ax, ay] = T(crt.a), [bx, by] = T(crt.b);
    ctx.save(); ctx.setLineDash([4, 3]); ctx.strokeStyle = C['F.CrtYd'] || '#888'; ctx.lineWidth = 1; ctx.strokeRect(ax, ay, bx - ax, by - ay); ctx.restore();
  }
  for (const p of fp.pads) {
    const [cx, cy] = T(p.at), w = p.size[0] * s, h = p.size[1] * s;
    ctx.fillStyle = p.drill ? (C.padThroughHole || C['F.Cu']) : C['F.Cu'];
    ctx.beginPath();
    if (p.shape === 'circle' || p.shape === 'oval') ctx.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2);
    else if (p.shape === 'roundrect' && ctx.roundRect) ctx.roundRect(cx - w / 2, cy - h / 2, w, h, Math.min(w, h) * 0.25);
    else ctx.rect(cx - w / 2, cy - h / 2, w, h);
    ctx.fill();
    if (p.drill) { ctx.fillStyle = C.drill || '#000'; ctx.beginPath(); ctx.arc(cx, cy, (p.drill * s) / 2, 0, Math.PI * 2); ctx.fill(); }
  }
  const fs = Math.max(8, Math.min(12, Math.min(...fp.pads.map((p) => Math.min(p.size[0], p.size[1]) * s)) * 0.7));
  if (fs >= 8) {
    ctx.fillStyle = '#fff'; ctx.font = `600 ${fs}px "Segoe UI", system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,.7)'; ctx.shadowBlur = 2;
    const seen = new Set();
    for (const p of fp.pads) { if (seen.has(p.number) && fp.pads.length > 3) continue; seen.add(p.number); const [cx, cy] = T(p.at); ctx.fillText(p.number, cx, cy); }
  }
}
