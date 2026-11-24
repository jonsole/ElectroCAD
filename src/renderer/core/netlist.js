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
  const wired = new Set(); // point keys touched by a Wire or a label
  const labelsAt = new Map(); // point key -> labels there
  const sheetName = new Map(); // label id -> its Sheet's name
  for (const sheet of project.schematic.sheets) {
    for (const l of sheet.labels || []) sheetName.set(l.id, sheet.name);
    const sp = sheetPins(project, sheet);
    pins.push(...sp);
    const prefix = sheet.id + ':';
    const k = (p) => prefix + key(p);
    for (const w of sheet.wires) { uf.union(k(w.a), k(w.b)); wired.add(k(w.a)); wired.add(k(w.b)); }
    const labels = sheet.labels || [];
    // T-joins: any Wire end, Pin or label point lying on a Wire joins it
    const points = [...sheet.wires.flatMap((w) => [w.a, w.b]), ...sp.map((x) => x.at), ...labels.map((l) => l.at)];
    for (const p of points) {
      for (const w of sheet.wires) {
        if (onSegment(p, w.a, w.b)) { uf.union(k(p), k(w.a)); wired.add(k(p)); }
      }
    }
    // labels: Net labels join their name on this Sheet; Global labels and Power symbols join
    // their name on every Sheet
    for (const l of labels) {
      const name = String(l.net || '').trim();
      if (!name) continue;
      const p = k(l.at);
      wired.add(p);
      const global = l.scope === 'global' || l.style === 'power' || l.style === 'gnd';
      const k2 = name.toLowerCase(); // names match regardless of case (ADR-0013)
      uf.union(p, global ? `global:${k2}` : `${prefix}label:${k2}`);
      if (!labelsAt.has(p)) labelsAt.set(p, []);
      labelsAt.get(p).push(l);
    }
    for (const x of sp) x.key = k(x.at);
    for (const x of sp) uf.find(x.key);
  }
  // labels on each group (for naming): Power symbol > Global label > Net label > generated
  const groupLabels = new Map();
  for (const [p, ls] of labelsAt) {
    const r = uf.find(p);
    if (!groupLabels.has(r)) groupLabels.set(r, []);
    groupLabels.get(r).push(...ls);
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
  const rank = (l) => (l.style === 'power' || l.style === 'gnd' ? 0 : l.scope === 'global' ? 1 : 2);
  const nets = [];
  const unconnected = [];
  for (const [r, g] of groups) {
    const ps = g.pins.map(({ ref, pin, pad, componentId }) => ({ ref, pin, pad, componentId }))
      .sort((a, b) => compareRefs(a.ref, b.ref) || compareRefs(a.pin, b.pin));
    const ls = groupLabels.get(r) || [];
    if (ps.length < 2 && !g.wired && !ls.length) { unconnected.push(...ps); continue; }
    const first = ps[0];
    const names = netNames(ls, rank);
    const net = { name: names[0]?.spelling || `Net-(${first.ref}-Pad${first.pad})`, pins: ps };
    if (names.length > 1) net.conflict = names.map((n) => n.spelling); // two different names on one Net: an ERC error (#11)
    if (names[0]?.spellings.length > 1) net.spellings = names[0].spellings; // one name, mixed case: an ERC warning (ADR-0013)
    if (names[0] && names[0].rank === 2) net.sheet = sheetName.get(names[0].labels[0].id);
    nets.push(net);
  }
  // a Net label name used on several Sheets makes separate Nets: qualify them with the Sheet name
  const count = new Map();
  const low = (n) => n.name.toLowerCase();
  for (const n of nets) count.set(low(n), (count.get(low(n)) || 0) + 1);
  for (const n of nets) if (count.get(low(n)) > 1 && n.sheet) n.name = `${n.sheet}/${n.name}`;
  for (const n of nets) delete n.sheet;
  nets.sort((a, b) => compareRefs(a.pins[0].ref, b.pins[0].ref) || compareRefs(a.pins[0].pad, b.pins[0].pad));
  unconnected.sort((a, b) => compareRefs(a.ref, b.ref) || compareRefs(a.pin, b.pin));
  return { nets, unconnected };
}

/**
 * The distinct names among a Net's labels, compared regardless of case (ADR-0013), best first:
 * by kind (Power symbol, Global label, Net label), then alphabetically. A name's spelling is the
 * one most of its best-ranked labels use (ties: alphabetical); `spellings` lists every spelling
 * seen, that one first.
 */
function netNames(labels, rank) {
  const byKey = new Map();
  for (const l of labels) {
    const spelling = String(l.net).trim();
    const k = spelling.toLowerCase();
    if (!byKey.has(k)) byKey.set(k, { rank: rank(l), counts: new Map(), labels: [] });
    const e = byKey.get(k);
    e.rank = Math.min(e.rank, rank(l));
    e.counts.set(spelling, (e.counts.get(spelling) || 0) + 1);
    e.labels.push(l);
  }
  const byCase = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const out = [...byKey.values()].map((e) => {
    const best = e.labels.filter((l) => rank(l) === e.rank);
    const topCount = new Map();
    for (const l of best) { const x = String(l.net).trim(); topCount.set(x, (topCount.get(x) || 0) + 1); }
    const spelling = [...topCount].sort((a, b) => b[1] - a[1] || byCase(a[0], b[0]))[0][0];
    const spellings = [...e.counts].sort((a, b) => (a[0] === spelling ? -1 : b[0] === spelling ? 1 : b[1] - a[1] || byCase(a[0], b[0]))).map((x) => x[0]);
    return { rank: e.rank, spelling, spellings, labels: best };
  });
  return out.sort((a, b) => a.rank - b.rank || a.spelling.localeCompare(b.spelling));
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

/**
 * Pins with something attached: a Wire end or run touching the Pin tip, or another Pin at the
 * same point. Returns a Set of `${symbolId}:${pinNumber}`. Drawing only (connected Pins take the
 * Wire colour); connectivity itself comes from buildNetlist.
 */
export function connectedPins(project, sheet) {
  const out = new Set();
  const tips = new Map();
  for (const sym of sheet.symbols) {
    for (const { pin, at } of pinPositions(project, sym)) {
      const k = key(at);
      if (!tips.has(k)) tips.set(k, []);
      tips.get(k).push(`${sym.id}:${pin.number}`);
    }
  }
  for (const [k, ids] of tips) {
    const at = k.split(',').map(Number);
    if (ids.length > 1 || sheet.wires.some((w) => onSegment(at, w.a, w.b)) || (sheet.labels || []).some((l) => key(l.at) === k)) for (const id of ids) out.add(id);
  }
  return out;
}

/**
 * Places where two Wires cross without connecting: one horizontal and one vertical run that
 * intersect strictly inside both (neither ends there). Returns [{ at, over, under }] where
 * `over` is the horizontal Wire (drawn with a hop) and `under` the vertical one.
 */
export function wireCrossings(sheet) {
  const horiz = sheet.wires.filter((w) => w.a[1] === w.b[1] && w.a[0] !== w.b[0]);
  const vert = sheet.wires.filter((w) => w.a[0] === w.b[0] && w.a[1] !== w.b[1]);
  const out = [];
  for (const h of horiz) {
    const y = h.a[1], hx0 = Math.min(h.a[0], h.b[0]), hx1 = Math.max(h.a[0], h.b[0]);
    for (const v of vert) {
      const x = v.a[0], vy0 = Math.min(v.a[1], v.b[1]), vy1 = Math.max(v.a[1], v.b[1]);
      if (x > hx0 && x < hx1 && y > vy0 && y < vy1) out.push({ at: [x, y], over: h.id, under: v.id });
    }
  }
  return out;
}
