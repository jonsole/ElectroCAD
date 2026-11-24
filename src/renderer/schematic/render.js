// Draws Symbols on the schematic canvas with the Schematic Colour theme (#51).
// Graphics are in the Symbol's local frame (nm); `place` applies the Symbol's rotation/mirror.
import { place } from '../core/geom.js';
import { partOf } from '../core/project.js';
import { mm } from '../core/units.js';
import { junctions } from '../core/netlist.js';
import { placeFields, styleFor } from '../core/fields.js';

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
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
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
  // Fields stay upright whatever the rotation (as in KiCad). Horizontal Symbols keep the
  // Part's field positions (above/below the body); vertical ones stack them beside it.
  if (fields && unit.fields && scale * TEXT > 4) {
    ctx.font = `${Math.max(8, TEXT * scale)}px "Segoe UI", system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    const vertical = (sym.rot || 0) % 180 !== 0;
    const side = vertical ? bodyHalfHeight(unit) + mm(1) : 0;
    for (const [key, color, dy] of [['reference', C.reference, -0.65], ['value', C.value, 0.65]]) {
      const f = unit.fields[key];
      if (!f || !fields[key]) continue;
      let x, y;
      if (vertical) { [x, y] = toScreen([sym.at[0] + side, sym.at[1] + dy * TEXT * 1.1]); ctx.textAlign = 'left'; }
      else { [x, y] = P(f.at); ctx.textAlign = 'center'; }
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

const WIRE = mm(0.15);
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

/** Draw placed fields (from core/fields.js placeFields) upright, plus a marker on flagged ones. */
function drawFields(ctx, view, C, project, sheet, placement) {
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

/** Draw a Sheet: Wires, Symbols, fields, Junctions, then selection, the placement ghost and a Wire being drawn. */
export function drawSheet(ctx, view, C, project, sheet, { selection = new Set(), ghost = null, bounds, wiring = null, target = null, placement = null } = {}) {
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
  ctx.beginPath(); for (const w of sheet.wires) strokeWire(ctx, view, w.a, w.b); ctx.stroke();
  ctx.restore();
  for (const sym of sheet.symbols) {
    const comp = project.components[sym.componentId];
    const part = partOf(project, comp);
    if (!part) continue;
    drawUnit(ctx, toScreen, view.scale, part, sym.unit, sym, null, C); // fields come from the placer
    if (selection.has(sym.id) && bounds) {
      const b = bounds(sym);
      const [x0, y0] = view.toScreen([b.x0, b.y0]), [x1, y1] = view.toScreen([b.x1, b.y1]);
      ctx.save(); ctx.setLineDash([5, 4]); ctx.strokeStyle = C.selection; ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(x0) - 3.5, Math.round(y0) - 3.5, x1 - x0 + 7, y1 - y0 + 7);
      ctx.restore();
    }
  }
  drawFields(ctx, view, C, project, sheet, placement || placeFields(project, sheet, { measure: measureText }));
  // Junction dots, derived from the Wires and Pins
  ctx.fillStyle = C.junction;
  const jr = Math.max(2.5, JUNCTION * view.scale);
  for (const j of junctions(project, sheet)) { const [x, y] = view.toScreen(j); ctx.beginPath(); ctx.arc(x, y, jr, 0, Math.PI * 2); ctx.fill(); }
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
  if (ghost) {
    drawUnit(ctx, toScreen, view.scale, ghost.part, 0, ghost, { reference: ghost.part.prefix + '?', value: ghost.part.defaultValue }, C, { alpha: 0.6 });
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
