// Schematic → Netlist (docs/DESIGN.md §4). Union-find over connection points:
//   - the two ends of each Wire join;
//   - a Wire end or Pin that lies on another Wire (a T-join) joins that Wire;
//   - points at the same coordinates join;
// Every set that touches a Pin and has a Wire or a second Pin is a Net. Crossing Wires
// don't connect unless one ends on the other. Labels join Nets from ticket #7.
import { pinPositions, padForPin } from './project.js';
import { onSegment, key } from './geom.js';

/** Natural order for Reference designators: C2 < R1 < R2 < R10. */
export function compareRefs(a, b) {
  const pa = /^(.*?)(\d*)$/.exec(a), pb = /^(.*?)(\d*)$/.exec(b);
  return pa[1].localeCompare(pb[1]) || (Number(pa[2]) || 0) - (Number(pb[2]) || 0) || a.localeCompare(b);
}

class UnionFind {
  constructor() { this.parent = new Map(); }
  find(k) {
    if (!this.parent.has(k)) this.parent.set(k, k);
    let r = k;
    while (this.parent.get(r) !== r) r = this.parent.get(r);
    while (this.parent.get(k) !== r) { const n = this.parent.get(k); this.parent.set(k, r); k = n; }
    return r;
  }
  union(a, b) { const ra = this.find(a), rb = this.find(b); if (ra !== rb) this.parent.set(ra, rb); }
}

/** Pins on a Sheet with their world positions and Component data. */
function sheetPins(project, sheet) {
  const out = [];
  for (const sym of sheet.symbols) {
    const comp = project.components[sym.componentId];
    if (!comp) continue;
    for (const { pin, at } of pinPositions(project, sym)) {
      out.push({ at, ref: comp.ref, pin: pin.number, pad: padForPin(project, comp, pin.number), componentId: comp.id, symbolId: sym.id });
    }
  }
  return out;
}

export function buildNetlist(project) {
  const uf = new UnionFind();
  const pins = [];
  const wired = new Set(); // point keys touched by a Wire
  for (const sheet of project.schematic.sheets) {
    const sp = sheetPins(project, sheet);
    pins.push(...sp);
    const prefix = sheet.id + ':';
    const k = (p) => prefix + key(p);
    for (const w of sheet.wires) { uf.union(k(w.a), k(w.b)); wired.add(k(w.a)); wired.add(k(w.b)); }
    // T-joins: any Wire end or Pin lying on a Wire joins it
    const points = [...sheet.wires.flatMap((w) => [w.a, w.b]), ...sp.map((x) => x.at)];
    for (const p of points) {
      for (const w of sheet.wires) {
        if (onSegment(p, w.a, w.b)) { uf.union(k(p), k(w.a)); wired.add(k(p)); }
      }
    }
    for (const x of sp) x.key = k(x.at);
    for (const x of sp) uf.find(x.key);
  }
  // group Pins by root
  const groups = new Map();
  for (const x of pins) {
    const r = uf.find(x.key);
    if (!groups.has(r)) groups.set(r, { pins: [], wired: false });
    const g = groups.get(r);
    g.pins.push(x);
    if (wired.has(x.key)) g.wired = true;
  }
  const nets = [];
  const unconnected = [];
  for (const g of groups.values()) {
    const ps = g.pins.map(({ ref, pin, pad, componentId }) => ({ ref, pin, pad, componentId }))
      .sort((a, b) => compareRefs(a.ref, b.ref) || compareRefs(a.pin, b.pin));
    if (ps.length < 2 && !g.wired) { unconnected.push(...ps); continue; }
    const first = ps[0];
    nets.push({ name: `Net-(${first.ref}-Pad${first.pad})`, pins: ps });
  }
  nets.sort((a, b) => compareRefs(a.pins[0].ref, b.pins[0].ref) || compareRefs(a.pins[0].pad, b.pins[0].pad));
  unconnected.sort((a, b) => compareRefs(a.ref, b.ref) || compareRefs(a.pin, b.pin));
  return { nets, unconnected };
}

/**
 * Junction dots on a Sheet: where three or more connections meet (Wire ends and Pins), or a
 * Wire end lands in the middle of another Wire. Derived, never stored.
 */
export function junctions(project, sheet) {
  const count = new Map();
  const add = (p, n = 1) => { const k = key(p); count.set(k, (count.get(k) || 0) + n); };
  const ends = sheet.wires.flatMap((w) => [w.a, w.b]);
  for (const p of ends) add(p);
  const pinPts = sheet.symbols.flatMap((s) => pinPositions(project, s).map((x) => x.at));
  const endKeys = new Set(ends.map(key));
  for (const p of pinPts) if (endKeys.has(key(p))) add(p);
  // a Wire end strictly inside another Wire counts that Wire twice (it passes through)
  for (const p of ends) {
    for (const w of sheet.wires) {
      const inside = onSegment(p, w.a, w.b) && key(p) !== key(w.a) && key(p) !== key(w.b);
      if (inside) add(p, 2);
    }
  }
  const out = [];
  const seen = new Set();
  for (const p of ends) {
    const k = key(p);
    if (!seen.has(k) && count.get(k) >= 3) { seen.add(k); out.push(p); }
  }
  return out;
}
