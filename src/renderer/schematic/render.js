// Draws Symbols on the schematic canvas with the Schematic Colour theme (#51).
// Graphics are in the Symbol's local frame (nm); `place` applies the Symbol's rotation/mirror.
import { place } from '../core/geom.js';
import { partOf } from '../core/project.js';
import { mm } from '../core/units.js';
import { junctions, connectedPins, wireCrossings } from '../core/netlist.js';
import { placeFields, styleFor } from '../core/fields.js';
import { labelShape, labelFrame, labelBounds, isPower, LABEL_TEXT } from '../core/labels.js';

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
    ctx.beginPath();
    if (g.type === 'rect') {
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
    if (!unit.hidePinNumbers && scale * TEXT > 5) {
      ctx.fillStyle = C.pinNumber; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText(pin.number, (ax + bx) / 2, (ay + by) / 2 - 2);
    }
    if (!unit.hidePinNames && pin.name && pin.name !== '~' && scale * TEXT > 5) {
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
    const pts = g.type === 'rect' ? [g.a, g.b] : g.type === 'circle' ? [[0, g.c[1] - g.r], [0, g.c[1] + g.r]] : g.pts || [];
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
    if (selection.has(l.id)) {
      const b = labelBounds(l, measureText);
      const [x0, y0] = view.toScreen([b.x0, b.y0]), [x1, y1] = view.toScreen([b.x1, b.y1]);
      ctx.save(); ctx.setLineDash([5, 4]); ctx.strokeStyle = C.selection; ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(x0) - 3.5, Math.round(y0) - 3.5, x1 - x0 + 7, y1 - y0 + 7);
      ctx.restore();
    }
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

/** Draw a Sheet: Wires, Symbols, fields, Junctions, then selection, the placement ghost and a Wire being drawn. */
export function drawSheet(ctx, view, C, project, sheet, { selection = new Set(), ghost = null, bounds, wiring = null, target = null, placement = null, display = DEFAULT_DISPLAY, ghostLabel = null, erc = null, ercFocus = null } = {}) {
  const toScreen = (p) => view.toScreen(p);
  const wireW = Math.max(1.5, WIRE * view.scale);
  ctx.save();
  ctx.lineCap = 'round';
  // Wires (selected ones get a selection-coloured halo underneath)
  const selWires = sheet.wires.filter((w) => selection.has(w.id));
  if (selWires.length) {
    ctx.strokeStyle = C.selection; ctx.globalAlpha = 0.45; ctx.lineWidth = wireW + 6;
    ctx.beginPath(); for (const w of selWires) strokeWire(ctx, view, w.a, w.b); ctx.stroke();
    ctx.globalAlpha = 1;
  }
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
  const conn = connectedPins(project, sheet);
  for (const sym of sheet.symbols) {
    const comp = project.components[sym.componentId];
    const part = partOf(project, comp);
    if (!part) continue;
    const unit = part.units[sym.unit || 0];
    const connected = new Set(unit ? unit.pins.filter((pn) => conn.has(`${sym.id}:${pn.number}`)).map((pn) => pn.number) : []);
    drawUnit(ctx, toScreen, view.scale, part, sym.unit, sym, null, C, { connected, colorConnected: display.colorConnectedPins, markUnconnected: display.markUnconnectedPins }); // fields come from the placer
    if (selection.has(sym.id) && bounds) {
      const b = bounds(sym);
      const [x0, y0] = view.toScreen([b.x0, b.y0]), [x1, y1] = view.toScreen([b.x1, b.y1]);
      ctx.save(); ctx.setLineDash([5, 4]); ctx.strokeStyle = C.selection; ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(x0) - 3.5, Math.round(y0) - 3.5, x1 - x0 + 7, y1 - y0 + 7);
      ctx.restore();
    }
  }
  drawLabels(ctx, view, C, sheet.labels || [], { selection });
  drawFields(ctx, view, C, project, sheet, placement || placeFields(project, sheet, { measure: measureText }), selection);
  // Junction dots, derived from the Wires and Pins
  ctx.fillStyle = C.junction;
  const jr = Math.max(2.5, JUNCTION * view.scale);
  for (const j of junctions(project, sheet)) { const [x, y] = view.toScreen(j); ctx.beginPath(); ctx.arc(x, y, jr, 0, Math.PI * 2); ctx.fill(); }
  // no-connect markers: a cross on the Pin tip
  const nc = Math.max(3, mm(0.6) * view.scale);
  for (const n of sheet.noConnects || []) {
    const [x, y] = view.toScreen(n.at);
    if (selection.has(n.id)) { ctx.save(); ctx.strokeStyle = C.selection; ctx.setLineDash([3, 3]); ctx.lineWidth = 1; ctx.strokeRect(x - nc - 4, y - nc - 4, (nc + 4) * 2, (nc + 4) * 2); ctx.restore(); }
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
  for (const g of unit.graphics) { if (g.a) { add(g.a); add(g.b); } if (g.pts) g.pts.forEach(add); if (g.c) { add([g.c[0] - g.r, g.c[1] - g.r]); add([g.c[0] + g.r, g.c[1] + g.r]); } }
  for (const p of unit.pins) add(p.at);
  const pad = size * 0.14;
  const scale = Math.min((size - 2 * pad) / Math.max(1, x1 - x0), (size - 2 * pad) / Math.max(1, y1 - y0));
  const ox = size / 2 - ((x0 + x1) / 2) * scale, oy = size / 2 - ((y0 + y1) / 2) * scale;
  const toScreen = ([x, y]) => [x * scale + ox, y * scale + oy];
  // thick enough to read at tile size
  drawUnit(ctx, toScreen, Math.max(scale, 3 / LINE), part, 0, { at: [0, 0], rot: 0, mirror: false }, null, C);
  return c.toDataURL('image/png');
}
