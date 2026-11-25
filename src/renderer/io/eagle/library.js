// Eagle libraries (the <library> elements in .lbr, .sch and .brd files) -> ElectroCAD Parts and
// Footprints (#35, import side; used by the .sch/.brd import #36).
//   deviceset -> Part      gate -> Unit      symbol -> the Unit's graphics and Pins
//   device    -> one of the Part's Footprints (fpId), its connects -> the Pin map
//   package   -> Footprint
// Pins are numbered by the pads they connect to (Eagle names pins; ElectroCAD numbers them), so
// the Board's pads and the Schematic's pins line up. A pin connected to several pads (GND on a
// regulator's tab and pin) becomes stacked pins at one tip, one per pad.
import { textCentre } from '../../core/boardDrawings.js';
import { placedRot, nm, pt, rotOf, arcMid, pinBase, restring, PACKAGE_LAYER, Report } from './common.js';

const PIN_LENGTH = { point: 0, short: 2_540_000, middle: 5_080_000, long: 7_620_000 };
const PIN_TYPE = { nc: 'no_connect', in: 'input', out: 'output', io: 'bidirectional', oc: 'open_collector', hiz: 'tri_state', pas: 'passive', pwr: 'power_in', sup: 'power_out' };
/** Pin rotation -> the direction from its tip (Eagle's pin origin) into the body. */
const PIN_DIR = { 0: 'R', 90: 'U', 180: 'L', 270: 'D' };

/** Eagle's automatic pad and via sizes, from its default design rules (the board's rules override). */
export const DEFAULT_RESTRING = { padRatio: 0.25, padMin: 254_000, padMax: 508_000, viaRatio: 0.25, viaMin: 203_200, viaMax: 508_000 };

// ---------------------------------------------------------------- shapes

function wireShape(w, layer) {
  const a = pt(w.attr('x1'), w.attr('y1')), b = pt(w.attr('x2'), w.attr('y2'));
  const curve = Number(w.attr('curve', 0));
  const g = curve ? { type: 'arc', start: a, mid: arcMid(a, b, curve), end: b } : { type: 'line', pts: [a, b] };
  if (layer) g.layer = layer;
  return g;
}

/** Eagle shapes (wire, circle, rectangle, polygon, text) -> ElectroCAD graphics; `layerOf(eagleLayer)` -> layer or null (skip). */
function shapes(el, layerOf, text = (t) => t, report = new Report(), { anchored = false } = {}) {
  const out = [];
  for (const c of el.children) {
    const L = layerOf(Number(c.attr('layer')));
    if (L === null) continue;
    const layer = L === undefined ? undefined : L;
    const withLayer = (g) => (layer ? { ...g, layer } : g);
    if (c.name === 'wire') out.push(wireShape(c, layer));
    else if (c.name === 'circle') {
      const r = nm(c.attr('radius'));
      if (r > 0) out.push(withLayer({ type: 'circle', c: pt(c.attr('x'), c.attr('y')), r, ...(Number(c.attr('width', 0)) === 0 ? { fill: 'outline' } : {}) }));
    } else if (c.name === 'rectangle') {
      const a = pt(c.attr('x1'), c.attr('y1')), b = pt(c.attr('x2'), c.attr('y2'));
      const { rot } = rotOf(c.attr('rot'));
      if (!rot) out.push(withLayer({ type: 'rect', a: [Math.min(a[0], b[0]), Math.min(a[1], b[1])], b: [Math.max(a[0], b[0]), Math.max(a[1], b[1])], fill: 'outline' }));
      else {
        // a rotated rectangle: a filled polygon about its centre
        const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2, t = (rot * Math.PI) / 180, cs = Math.cos(t), sn = Math.sin(t);
        const corners = [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]]].map(([x, y]) => [Math.round(cx + (x - cx) * cs + (y - cy) * sn), Math.round(cy - (x - cx) * sn + (y - cy) * cs)]);
        out.push(withLayer({ type: 'poly', pts: corners, fill: 'outline' }));
      }
    } else if (c.name === 'polygon') {
      const v = c.all('vertex');
      if (v.length >= 3) {
        if (v.some((x) => Number(x.attr('curve', 0)))) report.add('Curved polygon edges were drawn straight');
        out.push(withLayer({ type: 'poly', pts: v.map((x) => pt(x.attr('x'), x.attr('y'))), fill: 'outline' }));
      }
    } else if (c.name === 'text') {
      const t = text(c.text.trim(), Number(c.attr('layer')));
      if (!t) continue;
      const size = nm(c.attr('size', 1.778));
      // Eagle's anchor, alignment and angle as they are (#84): the text is placed with its real
      // string and the board's font when drawn, turns with the element and is kept readable
      const { rot, mirror, spin } = rotOf(c.attr('rot'));
      if (anchored) out.push(withLayer({ type: 'text', at: pt(c.attr('x'), c.attr('y')), text: t, size, rot: placedRot(rot, mirror), align: c.attr('align', 'bottom-left'), ...(spin ? { spin: true } : {}) }));
      // a Symbol's text is drawn upright about its centre: where Eagle's anchored, turned text has it
      else out.push(withLayer({ type: 'text', at: textCentre(t, { at: pt(c.attr('x'), c.attr('y')), size, rot: placedRot(rot, mirror), mirror, align: c.attr('align', 'bottom-left'), font: 'vector' }), text: t, size }));
    }
  }
  return out;
}

// ---------------------------------------------------------------- packages -> Footprints

/** An Eagle <package> -> an ElectroCAD Footprint. */
export function packageToFootprint(pkg, { report = new Report(), rules = DEFAULT_RESTRING, shapes: shapeRules = null } = {}) {
  const pads = [];
  let holes = 0;
  for (const c of pkg.children) {
    if (c.name === 'smd') {
      let w = nm(c.attr('dx')), h = nm(c.attr('dy'));
      const { rot } = rotOf(c.attr('rot'));
      const q = ((Math.round(rot / 90) % 4) + 4) % 4;
      if (Math.abs(rot - Math.round(rot / 90) * 90) > 0.01) report.add(`SMD pads turned off 90° steps were squared up (${pkg.attr('name')})`);
      if (q % 2) [w, h] = [h, w];
      const bottom = Number(c.attr('layer')) === 16;
      const layers = [bottom ? 'B.Cu' : 'F.Cu'];
      if (c.attr('cream') !== 'no') layers.push(bottom ? 'B.Paste' : 'F.Paste');
      if (c.attr('stop') !== 'no') layers.push(bottom ? 'B.Mask' : 'F.Mask');
      const round = Number(c.attr('roundness', 0));
      pads.push({ number: c.attr('name'), at: pt(c.attr('x'), c.attr('y')), shape: round >= 100 && w === h ? 'circle' : round > 0 ? 'roundrect' : 'rect', size: [w, h], layers });
    } else if (c.name === 'pad') {
      const drill = nm(c.attr('drill'));
      let d = nm(c.attr('diameter', 0));
      if (!d) d = drill + 2 * restring(drill, rules.padRatio, rules.padMin, rules.padMax);
      // the board's design rules may override the library's shape (Eagle's Shapes tab)
      const ruled = shapeRules && (c.attr('first') === 'yes' && shapeRules.first >= 0 ? shapeRules.first : shapeRules.top);
      const shape = ruled >= 0 && ruled != null ? (['square', 'round', 'octagon'][ruled] || c.attr('shape', 'round')) : c.attr('shape', 'round');
      const { rot } = rotOf(c.attr('rot'));
      const turned = Math.round(rot / 90) % 2 === 1;
      let pad;
      if (shape === 'square') pad = { shape: 'rect', size: [d, d] };
      else if (shape === 'long' || shape === 'offset') {
        pad = { shape: 'oval', size: turned ? [d, 2 * d] : [2 * d, d] };
        if (shape === 'offset') report.add('Offset pads were centred on their hole');
      } else if (shape === 'octagon') pad = { shape: 'chamfer', size: [d, d] }; // a regular octagon, as Eagle's OC8 (#70)
      else pad = { shape: 'circle', size: [d, d] };
      // on the inner layers Eagle makes it round, its size from the inner restring only (#82)
      const inner = rules.innerRatio != null ? drill + 2 * restring(drill, rules.innerRatio, rules.innerMin, rules.innerMax) : 0;
      pads.push({ number: c.attr('name'), at: pt(c.attr('x'), c.attr('y')), ...pad, drill, ...(inner ? { innerSize: inner } : {}), layers: c.attr('stop') === 'no' ? ['*.Cu'] : ['*.Cu', '*.Mask'] });
    } else if (c.name === 'hole') {
      const drill = nm(c.attr('drill'));
      // a non-plated hole: no copper, and the solder mask opened over it (as Eagle does)
      pads.push({ number: '', at: pt(c.attr('x'), c.attr('y')), shape: 'circle', size: [drill, drill], drill, layers: ['*.Mask'] });
      holes++;
    }
  }
  const graphics = shapes(pkg, (L) => (PACKAGE_LAYER[L] ?? null),
    (t, L) => (t === '>NAME' || t === '>name' ? '${REF}' : t === '>VALUE' || t === '>value' ? '${VALUE}' : L === 25 || L === 27 ? null : t), report, { anchored: true });
  // the courtyard (#67): the package's own keepout outline (tKeepout/bKeepout, layers 39/40), Eagle's
  // equivalent, round its pads; a keepout that is just a circle stays round. A package without one
  // gets none (Eagle doesn't check it either)
  const extent = (list) => {
    const xs = [], ys = [];
    for (const p of pads) { xs.push(p.at[0] - p.size[0] / 2, p.at[0] + p.size[0] / 2); ys.push(p.at[1] - p.size[1] / 2, p.at[1] + p.size[1] / 2); }
    for (const g of list) {
      if (g.type === 'text') continue;
      const q = g.pts || (g.type === 'rect' ? [g.a, g.b] : g.type === 'circle' ? [[g.c[0] - g.r, g.c[1] - g.r], [g.c[0] + g.r, g.c[1] + g.r]] : g.type === 'arc' ? [g.start, g.mid, g.end] : []);
      for (const [x, y] of q) { xs.push(x); ys.push(y); }
    }
    return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  };
  const keepout = shapes(pkg, (L) => (L === 39 || L === 40 ? undefined : null), () => null);
  if (keepout.length === 1 && keepout[0].type === 'circle') {
    const k = keepout[0];
    graphics.push({ type: 'circle', layer: 'F.CrtYd', c: k.c, r: k.r + (k.width || 0) / 2 });
  } else if (keepout.length) {
    const own = extent(keepout);
    graphics.push({ type: 'rect', layer: 'F.CrtYd', a: [own.x0, own.y0], b: [own.x1, own.y1] });
  }
  void holes;
  return { name: pkg.attr('name'), pads, graphics };
}

// ---------------------------------------------------------------- symbols and devicesets -> Parts

function symbolUnit(sym, gateName, numberOf) {
  const pins = [];
  for (const p of sym.all('pin')) {
    const name = p.attr('name');
    const { rot } = rotOf(p.attr('rot'));
    const pads = numberOf(name);
    const vis = p.attr('visible', 'both');
    for (const number of pads) {
      pins.push({ number, name: pinBase(name), at: pt(p.attr('x'), p.attr('y')), dir: PIN_DIR[(Math.round(rot / 90) * 90) % 360] || 'R', length: PIN_LENGTH[p.attr('length', 'long')] ?? PIN_LENGTH.long, type: PIN_TYPE[p.attr('direction', 'io')] || 'unspecified', _vis: vis });
    }
  }
  const vis = pins.map((p) => p._vis);
  for (const p of pins) delete p._vis;
  const graphics = shapes(sym, (L) => (L === 94 || L === 97 || L === 98 || L === 93 ? undefined : null),
    (t) => (/^>(NAME|VALUE|PART|GATE)$/i.test(t) || t.startsWith('>') ? null : t));
  return {
    name: gateName,
    ...(vis.length && vis.every((v) => v === 'pin' || v === 'off') ? { hidePinNumbers: true } : {}),
    ...(vis.length && vis.every((v) => v === 'pad' || v === 'off') ? { hidePinNames: true } : {}),
    // Eagle draws pin names at 1.778 mm, 1.905 mm in from the pin's end (#79)
    pinNameSize: 1_524_000, pinNameOffset: 1_905_000,
    graphics, pins,
  };
}

/** Is this deviceset a supply symbol (GND, VCC…): pins all `sup` and no package? */
export function isSupply(ds, lib) {
  const devices = ds.path('devices')?.all('device') || [];
  if (devices.some((d) => d.attr('package'))) return false;
  const gates = ds.path('gates')?.all('gate') || [];
  const pins = gates.flatMap((g) => lib.symbols.get(g.attr('symbol'))?.all('pin') || []);
  return pins.length > 0 && pins.every((p) => p.attr('direction') === 'sup');
}

/** A deviceset with no pins at all (a drawing frame, a logo). */
export function isPinless(ds, lib) {
  const gates = ds.path('gates')?.all('gate') || [];
  return !gates.some((g) => (lib.symbols.get(g.attr('symbol'))?.all('pin') || []).length);
}

/** Read a <library> element: its symbols, packages and devicesets, by name. */
export function readLibrary(libEl) {
  const byName = (path, tag) => new Map((libEl.path(path)?.all(tag) || []).map((e) => [e.attr('name'), e]));
  return { name: libEl.attr('name'), symbols: byName('symbols', 'symbol'), packages: byName('packages', 'package'), devicesets: byName('devicesets', 'deviceset') };
}

/** The fpId a device's Footprint is kept under in its Part. */
export const fpIdOf = (device) => device.attr('name') || device.attr('package') || 'default';

/**
 * An Eagle deviceset -> an ElectroCAD Part (with its Footprints and Pin maps), keyed
 * `eagle/<library>/<deviceset>`. Pins are numbered by the pads of the first device with a package.
 */
export function devicesetToPart(lib, ds, { report = new Report(), rules = DEFAULT_RESTRING, numbers = null } = {}) {
  const gates = ds.path('gates')?.all('gate') || [];
  const devices = ds.path('devices')?.all('device') || [];
  const withPkg = devices.filter((d) => d.attr('package'));
  const numbering = withPkg[0] || null;
  const connects = (dev) => {
    const m = new Map(); // `${gate}\t${pin}` -> [pads]
    for (const c of dev?.path('connects')?.all('connect') || []) m.set(`${c.attr('gate')}\t${c.attr('pin')}`, String(c.attr('pad')).trim().split(/\s+/));
    return m;
  };
  const numMap = connects(numbering);
  const used = new Set();
  const units = gates.map((g) => {
    const sym = lib.symbols.get(g.attr('symbol'));
    if (!sym) { report.add(`Symbol ${g.attr('symbol')} is missing from library ${lib.name}`); return { name: g.attr('name'), graphics: [], pins: [] }; }
    return symbolUnit(sym, g.attr('name').replace(/^G\$\d+$/, 'A'), (pinName) => {
      let pads = numMap.get(`${g.attr('name')}\t${pinName}`);
      if (!pads) pads = [numbering ? `${g.attr('name')}.${pinName}` : pinName]; // a pin with no pad (or no package)
      const nums = pads.map((n) => { let k = n; while (used.has(k)) k = `${n}'`; used.add(k); return k; });
      numbers?.set(`${g.attr('name')}\t${pinName}`, nums); // Eagle's (gate, pin) -> these Pin numbers
      return nums;
    });
  });
  // gate names as Unit names: A, B, C… when Eagle calls them G$1…
  if (units.length > 1) units.forEach((u, i) => { if (/^G\$+\d+$/.test(gates[i].attr('name'))) u.name = String.fromCharCode(65 + i); });
  const footprints = {}, pinMap = {};
  for (const dev of withPkg) {
    const pkg = lib.packages.get(dev.attr('package'));
    if (!pkg) { report.add(`Package ${dev.attr('package')} is missing from library ${lib.name}`); continue; }
    const id = fpIdOf(dev);
    footprints[id] = packageToFootprint(pkg, { report, rules });
    if (dev === numbering) continue;
    // this device's pads for the numbering device's pins
    const m = connects(dev), map = {};
    for (const [k, pads] of numMap) { const other = m.get(k); if (other) pads.forEach((p, i) => { if (other[i] !== undefined && other[i] !== p) map[p] = other[i]; }); }
    if (Object.keys(map).length) pinMap[id] = map;
  }
  const name = ds.attr('name').replace(/[*?]+$/, '') || ds.attr('name');
  return {
    id: `eagle/${lib.name}/${ds.attr('name')}`,
    name,
    prefix: ds.attr('prefix') || 'U',
    ...(ds.attr('uservalue') === 'yes' ? {} : { defaultValue: name }),
    origin: { library: `eagle:${lib.name}`, partId: ds.attr('name'), version: 1 },
    units, footprints, pinMap,
  };
}

export { Report };
