// Eagle .sch -> ElectroCAD Schematic (#36). Parts from the file's own libraries (./library.js);
// each sheet becomes a Sheet, moved onto its paper on the 2.54 mm grid (Eagle's Y-up origin is the
// sheet's bottom left; ElectroCAD's paper starts at its top left, Y down).
//   instance -> Symbol (gate -> Unit); a supply part (GND, +5V…) -> a power symbol
//   net segment wires -> Wires; Eagle joins a net's segments by name, ElectroCAD by labels, so a
//   net with several segments, or a name of its own, gets a label on each segment (global when
//   it reaches more than one sheet, or has a power symbol)
// After the import the Netlist is compared with Eagle's nets, pin by pin (verify()).
import { newProject, newSheet, uid, pinPositions } from '../../core/project.js';
import { buildNetlist } from '../../core/netlist.js';
import { PAPER_SIZES } from '../../core/drawings.js';
import { rot90 as r90geom } from '../../core/geom.js';
import { nm, pt, rotOf, rot90, pinBase, Report } from './common.js';
import { readLibrary, devicesetToPart, isSupply, isPinless, fpIdOf } from './library.js';

const GRID = 2_540_000; // keep the sheet's offset on Eagle's 0.1" grid, so pins stay on ElectroCAD's
const isAuto = (name) => /^N\$\d+$/.test(name);
const GROUND = /^(A|D|P|S)?GND\w*$|^VSS\w*$|^0V$/i;

/** Read the libraries of a drawing (sch, brd or lbr) by name. */
export function libraries(drawingEl) {
  const libs = new Map();
  const host = drawingEl.child('schematic') || drawingEl.child('board');
  for (const l of host?.child('libraries')?.all('library') || []) libs.set(l.attr('name'), readLibrary(l));
  const own = drawingEl.child('library'); // an .lbr
  if (own) { const l = readLibrary(own); libs.set(l.name || 'library', l); }
  return libs;
}

/** Where the points of a sheet go: offset so its content lands on the paper, on the 0.1" grid. */
function sheetPlacement(sheetEl, parts, libs) {
  const xs = [], ys = [];
  const add = (x, y) => { xs.push(Number(x)); ys.push(Number(y)); };
  for (const i of sheetEl.path('instances')?.all('instance') || []) add(i.attr('x'), i.attr('y'));
  for (const w of sheetEl.path('nets')?.children.flatMap((n) => n.all('segment')).flatMap((s) => s.all('wire')) || []) { add(w.attr('x1'), w.attr('y1')); add(w.attr('x2'), w.attr('y2')); }
  for (const w of sheetEl.path('plain')?.all('wire') || []) { add(w.attr('x1'), w.attr('y1')); add(w.attr('x2'), w.attr('y2')); }
  // a frame's own extent
  let frame = null;
  for (const i of sheetEl.path('instances')?.all('instance') || []) {
    const p = parts.get(i.attr('part')); if (!p?.frame) continue;
    const sym = libs.get(p.lib)?.symbols.get(p.frameSymbol);
    let fx1 = 0, fy1 = 0;
    for (const s of sym?.children || []) for (const k of ['x1', 'x2', 'x']) if (s.attr(k) != null) fx1 = Math.max(fx1, Number(s.attr(k)));
    for (const s of sym?.children || []) for (const k of ['y1', 'y2', 'y']) if (s.attr(k) != null) fy1 = Math.max(fy1, Number(s.attr(k)));
    frame = { x: Number(i.attr('x')), y: Number(i.attr('y')), w: fx1, h: fy1 };
  }
  if (frame) { add(frame.x, frame.y); add(frame.x + frame.w, frame.y + frame.h); }
  const minX = xs.length ? Math.min(...xs) : 0, maxX = xs.length ? Math.max(...xs) : 200, minY = ys.length ? Math.min(...ys) : 0, maxY = ys.length ? Math.max(...ys) : 100;
  const margin = frame ? 0 : 12.7;
  const w = maxX - minX + 2 * margin, h = maxY - minY + 2 * margin;
  const fits = Object.entries(PAPER_SIZES).filter(([, [W, H]]) => w <= W + 0.01 && h <= H + 0.01).sort((a, b) => a[1][0] * a[1][1] - b[1][0] * b[1][1]);
  const [size] = fits[0] || ['A0'];
  const ox = Math.round(((-minX + margin) * 1e6) / GRID) * GRID, oy = Math.round(((maxY + margin) * 1e6) / GRID) * GRID;
  return { T: (x, y) => [nm(x) + ox, -nm(y) + oy], paper: { size, orientation: 'landscape' } };
}

/**
 * An Eagle .sch (parsed XML root) -> { project, report, verify, eagle } where eagle holds what the
 * board import needs (parts by name, the pin numbering).
 */
export function importEagleSchematic(root, { name = 'Imported', report = new Report() } = {}) {
  const drawing = root.child('drawing');
  const sch = drawing?.child('schematic');
  if (!sch) throw new Error('This is not an Eagle schematic (.sch): there is no <schematic> in it.');
  const libs = libraries(drawing);
  const project = newProject(name);
  project.schematic.sheets = [];
  // parts: components, supply symbols, frames
  const parts = new Map();
  const partDefs = new Map();
  for (const pe of sch.path('parts')?.all('part') || []) {
    const lib = libs.get(pe.attr('library'));
    const ds = lib?.devicesets.get(pe.attr('deviceset'));
    if (!lib || !ds) { report.add(`Part ${pe.attr('name')}: its device set ${pe.attr('library')}/${pe.attr('deviceset')} is not in the file`); continue; }
    const dev = (ds.path('devices')?.all('device') || []).find((d) => d.attr('name') === (pe.attr('device') || '')) || ds.path('devices')?.child('device');
    if (isPinless(ds, lib)) {
      const g = ds.path('gates')?.child('gate');
      parts.set(pe.attr('name'), { frame: true, lib: lib.name, frameSymbol: g?.attr('symbol') });
      continue;
    }
    if (isSupply(ds, lib)) { parts.set(pe.attr('name'), { supply: true, lib, ds }); continue; }
    const key = `${lib.name}\t${ds.attr('name')}`;
    if (!partDefs.has(key)) {
      const numbers = new Map();
      const part = devicesetToPart(lib, ds, { report, numbers });
      partDefs.set(key, { part, numbers });
      project.parts[part.id] = part;
    }
    const { part, numbers } = partDefs.get(key);
    const tech = dev?.path('technologies')?.all('technology').find((t) => t.attr('name') === (pe.attr('technology') || '')) || null;
    const mpnAttr = tech?.all('attribute').find((a) => /^(MPN|MF_PN|PARTNO|PART_NUMBER|MANUFACTURER_PART_NUMBER)$/i.test(a.attr('name')));
    const comp = {
      id: uid('c'), partId: part.id, ref: pe.attr('name'),
      value: pe.attr('value') ?? (ds.attr('uservalue') === 'yes' ? '' : `${ds.attr('name').replace(/[*?]+$/, '')}${dev?.attr('name') || ''}`),
      mpn: mpnAttr?.attr('value') ? { manufacturer: tech.all('attribute').find((a) => /^(MANUFACTURER|MF|MFR|VENDOR)$/i.test(a.attr('name')))?.attr('value') || '', number: mpnAttr.attr('value') } : null,
      footprint: dev?.attr('package') && part.footprints[fpIdOf(dev)] ? { fpId: fpIdOf(dev) } : null,
      fields: {},
    };
    project.components[comp.id] = comp;
    parts.set(pe.attr('name'), { comp, part, lib, ds, dev, numbers, gates: (ds.path('gates')?.all('gate') || []).map((g) => g.attr('name')) });
  }

  // Eagle's nets, gathered across sheets: name -> [{ sheet, segment }]
  const sheetsEl = sch.path('sheets')?.all('sheet') || [];
  const netsByName = new Map();
  const pinNet = new Map(); // `${part}\t${gate}\t${pin}` -> net name
  sheetsEl.forEach((se, si) => {
    for (const n of se.path('nets')?.all('net') || []) {
      const nn = n.attr('name');
      if (!netsByName.has(nn)) netsByName.set(nn, []);
      for (const seg of n.all('segment')) {
        netsByName.get(nn).push({ si, seg });
        for (const pr of seg.all('pinref')) pinNet.set(`${pr.attr('part')}\t${pr.attr('gate')}\t${pr.attr('pin')}`, nn);
      }
    }
  });
  const powered = new Set(); // nets with a power symbol: their labels go global

  sheetsEl.forEach((se, si) => {
    const place = sheetPlacement(se, parts, libs);
    const sheet = { ...newSheet(se.path('description')?.text?.trim() || `Sheet ${si + 1}`), paper: place.paper };
    project.schematic.sheets.push(sheet);
    se.T = place.T; se.sheet = sheet;
    for (const inst of se.path('instances')?.all('instance') || []) {
      const p = parts.get(inst.attr('part'));
      if (!p || p.frame) continue;
      const { rot, mirror } = rotOf(inst.attr('rot'));
      if (rot % 90) report.add('Symbols turned off 90° steps were squared up');
      if (p.supply) {
        // one power symbol per supply pin, on the net it names
        const gate = (p.ds.path('gates')?.all('gate') || []).find((g) => g.attr('name') === inst.attr('gate'));
        const sym = p.lib.symbols.get(gate?.attr('symbol'));
        for (const pin of sym?.all('pin') || []) {
          const local = pt(pin.attr('x'), pin.attr('y'));
          const off = r90geom(local, rot90(rot), mirror);
          const at0 = place.T(inst.attr('x'), inst.attr('y'));
          const net = pinNet.get(`${inst.attr('part')}\t${inst.attr('gate')}\t${pin.attr('name')}`) || pinBase(pin.attr('name'));
          powered.add(net);
          sheet.labels.push({ id: uid('l'), at: [at0[0] + off[0], at0[1] + off[1]], rot: rot90(rot), net, scope: 'global', style: GROUND.test(net) ? 'gnd' : 'power' });
        }
        continue;
      }
      const unit = Math.max(0, p.gates.indexOf(inst.attr('gate')));
      sheet.symbols.push({ id: uid('y'), componentId: p.comp.id, unit, at: place.T(inst.attr('x'), inst.attr('y')), rot: rot90(rot), mirror });
    }
    // plain drawings: lines and text
    for (const c of se.path('plain')?.children || []) {
      if (c.name === 'wire') sheet.drawings.push({ id: uid('d'), type: 'line', pts: [place.T(c.attr('x1'), c.attr('y1')), place.T(c.attr('x2'), c.attr('y2'))], style: c.attr('style') === 'shortdash' || c.attr('style') === 'longdash' ? 'dashed' : c.attr('style') === 'dashdot' ? 'dotted' : 'solid', arrowStart: false, arrowEnd: false });
      else if (c.name === 'text' && c.text.trim()) sheet.drawings.push({ id: uid('d'), type: 'text', at: place.T(c.attr('x'), c.attr('y')), text: c.text.trim(), size: nm(c.attr('size', 1.778)), bold: false, italic: false, align: 'left', rot: rotOf(c.attr('rot')).rot % 180 === 90 ? 90 : 0 });
      else if (c.name !== 'text') report.add(`Sheet drawings (${c.name}) were left out`);
    }
    if (se.path('busses')?.children.length) report.add('Busses were left out (their nets keep their labels)');
  });

  // wires and the labels that join a net's segments by name
  for (const [netName, segs] of netsByName) {
    const sheetsOf = new Set(segs.map((s) => s.si));
    const scope = sheetsOf.size > 1 || powered.has(netName) ? 'global' : 'local';
    const needsLabel = segs.length > 1 || !isAuto(netName);
    for (const { si, seg } of segs) {
      const se = sheetsEl[si], sheet = se.sheet, T = se.T;
      const wires = [];
      for (const w of seg.all('wire')) {
        if (Number(w.attr('curve', 0))) report.add('Curved wires were drawn straight');
        const a = T(w.attr('x1'), w.attr('y1')), b = T(w.attr('x2'), w.attr('y2'));
        if (a[0] === b[0] && a[1] === b[1]) continue;
        const wire = { id: uid('w'), a, b };
        sheet.wires.push(wire); wires.push(wire);
      }
      // a segment with a power symbol is named by it
      if (!needsLabel || seg.all('pinref').some((pr) => parts.get(pr.attr('part'))?.supply)) continue;
      // where a label sits: Eagle's labels, moved onto their wire; else the first wire's start, or the first pin
      const spots = [];
      for (const l of seg.all('label')) spots.push({ at: nearestOnWires(T(l.attr('x'), l.attr('y')), wires), rot: rot90(rotOf(l.attr('rot')).rot) });
      if (!spots.length) {
        const at = wires[0]?.a || pinAt(project, parts, seg.child('pinref'));
        if (at) spots.push({ at, rot: 0 });
      }
      for (const s of spots) if (s.at) sheet.labels.push({ id: uid('l'), at: s.at, rot: s.rot, net: netName, scope, style: 'label' });
    }
  }
  if (!project.schematic.sheets.length) project.schematic.sheets.push(newSheet('Sheet 1'));
  const result = { project, report, eagle: { parts, netsByName, pinNet } };
  result.verify = () => verifySchematic(project, parts, netsByName, report);
  return result;
}

/** The nearest point on a set of wires (on a wire end or its run), for a label to sit on. */
function nearestOnWires(p, wires) {
  if (!wires.length) return null;
  let best = null, bd = Infinity;
  for (const w of wires) {
    const [ax, ay] = w.a, [bx, by] = w.b, dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    const t = L ? Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / L)) : 0;
    const q = [Math.round(ax + t * dx), Math.round(ay + t * dy)];
    // keep it on the grid along the wire when the wire is straight up or across
    if (dx === 0) q[1] = Math.round(q[1] / 1_270_000) * 1_270_000; else if (dy === 0) q[0] = Math.round(q[0] / 1_270_000) * 1_270_000;
    const inRun = (v, a, b) => v >= Math.min(a, b) && v <= Math.max(a, b);
    if (!inRun(q[0], ax, bx) || !inRun(q[1], ay, by)) { q[0] = Math.round(ax + t * dx); q[1] = Math.round(ay + t * dy); }
    const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2;
    if (d < bd) { bd = d; best = q; }
  }
  return best;
}

function pinAt(project, parts, pr) {
  if (!pr) return null;
  const p = parts.get(pr.attr('part'));
  if (!p?.comp) return null;
  for (const s of project.schematic.sheets) for (const y of s.symbols) {
    if (y.componentId !== p.comp.id || p.gates[y.unit] !== pr.attr('gate')) continue;
    const want = new Set(p.numbers.get(`${pr.attr('gate')}\t${pr.attr('pin')}`) || []);
    const hit = pinPositions(project, y).find((x) => want.has(x.pin.number));
    if (hit) return hit.at;
  }
  return null;
}

/**
 * Compare the imported Netlist with Eagle's nets: every pin Eagle put on a net must be on one
 * ElectroCAD net with the same pins. Returns { ok, mismatches: [text] } and notes them in the report.
 */
export function verifySchematic(project, parts, netsByName, report = new Report()) {
  const nl = buildNetlist(project);
  const where = new Map(); // `${ref}\t${pin number}` -> our net
  for (const n of nl.nets) for (const p of n.pins) where.set(`${p.ref}\t${p.pin}`, n);
  const mismatches = [];
  for (const [netName, segs] of netsByName) {
    const pins = [];
    for (const { seg } of segs) for (const pr of seg.all('pinref')) {
      const p = parts.get(pr.attr('part'));
      if (!p?.comp) continue;
      for (const num of p.numbers.get(`${pr.attr('gate')}\t${pr.attr('pin')}`) || []) pins.push(`${p.comp.ref}\t${num}`);
    }
    const ours = new Set(pins.map((k) => where.get(k)));
    if (pins.length > 1 && (ours.size !== 1 || ours.has(undefined))) mismatches.push(`Net ${netName}: its pins ${pins.map((k) => k.replace('\t', '.')).join(', ')} are not all on one net here`);
  }
  for (const m of mismatches) report.add(m);
  return { ok: !mismatches.length, mismatches, netlist: nl };
}
