// Eagle 6+ / Fusion Electronics XML: units, rotations and layers, shared by the library,
// schematic and board converters. Eagle works in millimetres with +Y up; ElectroCAD in integer
// nanometres with +Y down (ADR-0003): the conversion happens here and nowhere else.

/** Eagle mm -> nm. */
export const nm = (v) => Math.round(Number(v || 0) * 1e6) || 0;
/** An Eagle point (mm, Y up) -> [x, y] nm, Y down. */
export const pt = (x, y) => [nm(x), -nm(y) || 0];

/** A length with units ("8mil", "0.2mm", "0.01inch", "0.3") -> nm (bare numbers are mm). */
export function len(s) {
  const m = /^\s*(-?[\d.]+)\s*(mil|mm|inch|in|mic)?\s*$/i.exec(String(s ?? ''));
  if (!m) return 0;
  const v = Number(m[1]);
  switch ((m[2] || 'mm').toLowerCase()) {
    case 'mil': return Math.round(v * 25_400);
    case 'inch': case 'in': return Math.round(v * 25_400_000);
    case 'mic': return Math.round(v * 1000);
    default: return Math.round(v * 1e6);
  }
}

/** Eagle rotation "MR90" / "R45" / "SMR180" -> { rot (degrees, anticlockwise), mirror, spin }. */
export function rotOf(s) {
  const r = String(s || 'R0');
  const deg = Number((/R(-?[\d.]+)/.exec(r) || [0, 0])[1]) || 0;
  return { rot: ((deg % 360) + 360) % 360, mirror: r.includes('M'), spin: r.includes('S') };
}

/**
 * Eagle "MR<θ>" rotates by θ and then mirrors X; ElectroCAD (Symbols and Footprints alike) mirrors X
 * and then rotates. Mirroring after a turn of θ is mirroring before a turn of -θ, so a mirrored
 * Eagle part at θ is ours at 360 - θ. (Found importing a real board: a mirrored 0603 at MR90 had its
 * pads swapped against the tracks.)
 */
export const placedRot = (rot, mirror) => (mirror ? (360 - rot) % 360 : rot);

/**
 * An Eagle text's angle as ours, its alignment and whether it's mirrored. Eagle keeps text readable:
 * turned past 90° (up to 270°) it's drawn the other way up, anchored on the opposite corner, unless
 * it's spun ('S').
 */
export function eagleTextAngle(c) {
  const r = rotOf(c.attr('rot'));
  let rot = r.rot, align = c.attr('align', 'bottom-left');
  if (!r.spin && rot > 90 && rot <= 270) {
    rot -= 180;
    const flip = { bottom: 'top', top: 'bottom', left: 'right', right: 'left', center: 'center' };
    align = align === 'center' ? 'center' : align.split('-').map((x) => flip[x]).join('-');
  }
  return { rot: placedRot(rot, r.mirror), align, mirror: r.mirror };
}

/** A rotation as ElectroCAD keeps it on the Schematic (a multiple of 90). */
export const rot90 = (deg) => ((Math.round(deg / 90) * 90) % 360 + 360) % 360;

/** Eagle's layer numbers. */
export const EAGLE_LAYERS = {
  TOP: 1, BOTTOM: 16, PADS: 17, VIAS: 18, UNROUTED: 19, DIMENSION: 20, TPLACE: 21, BPLACE: 22, TORIGINS: 23, BORIGINS: 24,
  TNAMES: 25, BNAMES: 26, TVALUES: 27, BVALUES: 28, TSTOP: 29, BSTOP: 30, TCREAM: 31, BCREAM: 32, TKEEPOUT: 39, BKEEPOUT: 40,
  TRESTRICT: 41, BRESTRICT: 42, VRESTRICT: 43, DRILLS: 44, HOLES: 45, MILLING: 46, MEASURES: 47, DOCUMENT: 48, REFERENCE: 49,
  TDOCU: 51, BDOCU: 52, NETS: 91, BUSSES: 92, PINS: 93, SYMBOLS: 94, NAMES: 95, VALUES: 96, INFO: 97, GUIDE: 98,
};

/** Footprint graphics layers: Eagle -> ElectroCAD (the Footprint's own side). */
export const PACKAGE_LAYER = { 21: 'F.SilkS', 25: 'F.SilkS', 51: 'F.Fab', 27: 'F.Fab', 22: 'B.SilkS', 26: 'B.SilkS', 52: 'B.Fab', 28: 'B.Fab' };

/** The midpoint of an Eagle wire with `curve` degrees (an arc from a to b, anticlockwise for +). */
export function arcMid(a, b, curveDeg) {
  // a, b in nm (Y down); Eagle's curve is anticlockwise in Y up = clockwise on screen.
  const t = (curveDeg * Math.PI) / 180;
  const [ax, ay] = a, [bx, by] = b;
  const mx = (ax + bx) / 2, my = (ay + by) / 2;
  const dx = bx - ax, dy = by - ay, chord = Math.hypot(dx, dy);
  if (!chord || !t) return [Math.round(mx), Math.round(my)];
  const r = chord / 2 / Math.sin(Math.abs(t) / 2);
  const h = r * Math.cos(t / 2); // centre's distance from the chord midpoint (signed by the sweep)
  // unit normal to the chord, pointing to the centre's side for a positive (anticlockwise in Y up) sweep
  const nx = dy / chord, ny = -dx / chord; // in Y down, this is to the left of a->b as seen on screen
  const cx = mx + nx * h * Math.sign(t), cy = my + ny * h * Math.sign(t);
  // the arc's midpoint is on the far side of the chord from the centre, at radius r
  const ux = mx - cx, uy = my - cy, ul = Math.hypot(ux, uy) || 1;
  const s = Math.abs(t) > Math.PI ? -1 : 1;
  return [Math.round(cx + (ux / ul) * r * s), Math.round(cy + (uy / ul) * r * s)];
}

/** Points along an arc from a to b with `curve` degrees, for copper drawn as straight segments. */
export function arcPoints(a, b, curveDeg, maxStepDeg = 10) {
  const mid = arcMid(a, b, curveDeg);
  const n = Math.max(2, Math.ceil(Math.abs(curveDeg) / maxStepDeg));
  // circle through a, mid, b
  const [ax, ay] = a, [bx, by] = mid, [cx, cy] = b;
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (!d) return [a, b];
  const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
  const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
  const r = Math.hypot(ax - ux, ay - uy);
  const a0 = Math.atan2(ay - uy, ax - ux), am = Math.atan2(by - uy, bx - ux), a1 = Math.atan2(cy - uy, cx - ux);
  const norm = (x) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  let sweep = norm(a1 - a0);
  if (norm(am - a0) > sweep) sweep -= 2 * Math.PI;
  return Array.from({ length: n + 1 }, (_, i) => (i === 0 ? a : i === n ? b : [Math.round(ux + r * Math.cos(a0 + (sweep * i) / n)), Math.round(uy + r * Math.sin(a0 + (sweep * i) / n))]));
}

/** "GND@2" -> "GND" (Eagle's way of naming several pins alike). */
export const pinBase = (name) => String(name).replace(/@[^@]*$/, '');

/** Eagle's restring (annular ring) for an automatic pad or via size: clamp(drill * ratio, min, max). */
export const restring = (drill, ratio, min, max) => Math.min(max, Math.max(min, Math.round(drill * ratio)));

/** A loss report: notes collected while converting, each said once with a count. */
export class Report {
  constructor() { this.notes = new Map(); }
  add(msg, n = 1) { this.notes.set(msg, (this.notes.get(msg) || 0) + n); }
  list() { return [...this.notes].map(([m, c]) => (c > 1 ? `${m} (×${c})` : m)); }
}
