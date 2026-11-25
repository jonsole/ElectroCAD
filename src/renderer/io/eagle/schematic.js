// Eagle .sch -> ElectroCAD Schematic (#36). Parts from the file's own libraries (./library.js);
// each sheet becomes a Sheet, moved onto its paper on the 2.54 mm grid (Eagle's Y-up origin is the
// sheet's bottom left; ElectroCAD's paper starts at its top left, Y down).
//   instance -> Symbol (gate -> Unit); a supply part (GND, +5V…) -> a power symbol
//   net segment wires -> Wires; Eagle joins a net's segments by name, ElectroCAD by labels, so a
//   net with several segments, or a name of its own, gets a label on each segment (global when
//   it reaches more than one sheet, or has a power symbol)
// After the import the Netlist is compared with Eagle's nets, pin by pin (verify()).
import { eagleOverbar } from '../../core/overbar.js';
import { newProject, newSheet, uid, pinPositions } from '../../core/project.js';
import { symbolBounds } from '../../core/schematic.js';
import { labelBounds, LABEL_TEXT } from '../../core/labels.js';
import { buildNetlist } from '../../core/netlist.js';
import { PAPER_SIZES } from '../../core/drawings.js';
import { rot90 as r90geom, unplace } from '../../core/geom.js';
import { textCentre } from '../../core/boardDrawings.js';
import { strokeWidthOf } from '../../core/strokefont.js';
import { pinnedFieldAt } from '../../core/fields.js';
import { nm, pt, rotOf, rot90, pinBase, Report, placedRot, eagleTextAngle } from './common.js';
import { readLibrary, devicesetToPart, isSupply, isPinless, fpIdOf } from './library.js';

const GRID = 2_540_000; // keep the sheet's offset on Eagle's 0.1" grid, so pins stay on ElectroCAD's
const isAuto = (name) => /^N\$\d+$/.test(name);
// part attributes (#71): which name the MPN and its manufacturer, and Eagle's own (not fields)
const MPN_ATTR = /^(MPN|MF_PN|PARTNO|PART_NUMBER|MANUFACTURER_PART_NUMBER)$/i;
const MF_ATTR = /^(MANUFACTURER|MF|MFR|VENDOR)$/i;
const RESERVED_ATTR = /^(NAME|VALUE|PART|GATE)$/i;
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
  // only Eagle's cross-reference labels show sheet references (#76); its plain labels never do
  project.schematic.showSheetRefs = false;
  const xrefFormat = sch.attr('xreflabel');
  // parts: components, supply symbols, frames
  const parts = new Map();
  const partDefs = new Map();
  const fieldNames = new Set(); // part attribute names that became fields (#71)
  const shownAttrs = new Set(); // ...and those Eagle shows on the sheet
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
    // the part's attributes (#71): its device technology's, with the part's own values over those
    // that aren't constant, and the part's own extra ones; names kept as written
    const attrs = new Map(); // name -> value
    for (const a of tech?.all('attribute') || []) attrs.set(a.attr('name'), { value: a.attr('value') ?? '', constant: a.attr('constant') === 'yes' });
    for (const a of pe.all('attribute')) {
      const n = a.attr('name'), cur = attrs.get(n);
      if (!n || RESERVED_ATTR.test(n) || cur?.constant) continue;
      attrs.set(n, { value: a.attr('value') ?? '', constant: false });
    }
    const mpnName = [...attrs.keys()].find((n) => MPN_ATTR.test(n)), mfName = [...attrs.keys()].find((n) => MF_ATTR.test(n));
    const fields = {};
    for (const [n, a] of attrs) if (n !== mpnName && n !== mfName) { fields[n] = a.value; fieldNames.add(n); }
    const comp = {
      id: uid('c'), partId: part.id, ref: pe.attr('name'),
      value: pe.attr('value') ?? (ds.attr('uservalue') === 'yes' ? '' : `${ds.attr('name').replace(/[*?]+$/, '')}${dev?.attr('name') || ''}`),
      mpn: mpnName && attrs.get(mpnName).value ? { manufacturer: (mfName && attrs.get(mfName).value) || '', number: attrs.get(mpnName).value } : null,
      footprint: dev?.attr('package') && part.footprints[fpIdOf(dev)] ? { fpId: fpIdOf(dev) } : null,
      fields,
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
      const nn = eagleOverbar(n.attr('name')); // Eagle's `!` overbars as markup (#63)
      if (!netsByName.has(nn)) netsByName.set(nn, []);
      for (const seg of n.all('segment')) {
        netsByName.get(nn).push({ si, seg });
        for (const pr of seg.all('pinref')) pinNet.set(`${pr.attr('part')}\t${pr.attr('gate')}\t${pr.attr('pin')}`, nn);
      }
    }
  });
  const powered = new Set(); // nets with a power symbol: their labels go global

  let smashedFields = 0; // Eagle's moved NAME / VALUE, as pinned fields (#65)
  sheetsEl.forEach((se, si) => {
    const place = sheetPlacement(se, parts, libs);
    const sheet = { ...newSheet(se.path('description')?.text?.trim() || `Sheet ${si + 1}`), paper: place.paper };
    project.schematic.sheets.push(sheet);
    se.T = place.T; se.sheet = sheet;
    for (const inst of se.path('instances')?.all('instance') || []) {
      const p = parts.get(inst.attr('part'));
      if (!p || p.frame) continue;
      const { rot: eRot, mirror } = rotOf(inst.attr('rot'));
      const rot = placedRot(eRot, mirror);
      if (rot % 90) report.add('Symbols turned off 90° steps were squared up');
      if (p.supply) {
        // one power symbol per supply pin, on the net it names
        const gate = (p.ds.path('gates')?.all('gate') || []).find((g) => g.attr('name') === inst.attr('gate'));
        const sym = p.lib.symbols.get(gate?.attr('symbol'));
        for (const pin of sym?.all('pin') || []) {
          const local = pt(pin.attr('x'), pin.attr('y'));
          const off = r90geom(local, rot90(rot), mirror);
          const at0 = place.T(inst.attr('x'), inst.attr('y'));
          const net = pinNet.get(`${inst.attr('part')}\t${inst.attr('gate')}\t${pin.attr('name')}`) || eagleOverbar(pinBase(pin.attr('name')));
          powered.add(net);
          sheet.labels.push({ id: uid('l'), at: [at0[0] + off[0], at0[1] + off[1]], rot: rot90(rot), net, scope: 'global', style: GROUND.test(net) ? 'gnd' : 'power' });
        }
        continue;
      }
      const unit = Math.max(0, p.gates.indexOf(inst.attr('gate')));
      const sym = { id: uid('y'), componentId: p.comp.id, unit, at: place.T(inst.attr('x'), inst.attr('y')), rot: rot90(rot), mirror };
      sheet.symbols.push(sym);
      // moved ("smashed") NAME / VALUE (#65): their centres become the Symbol's pinned fields
      for (const a of inst.all('attribute')) {
        const key = a.attr('name') === 'NAME' ? 'reference' : a.attr('name') === 'VALUE' ? 'value' : null;
        if (!key && a.attr('display') !== 'off' && !RESERVED_ATTR.test(a.attr('name') || '')) shownAttrs.add(a.attr('name'));
        if (!key || a.attr('x') == null || a.attr('display') === 'off') continue;
        const str = key === 'reference' ? `${inst.attr('part')}${p.gates.length > 1 ? inst.attr('gate') || '' : ''}` : (p.comp.value || ' ');
        const t = eagleTextAngle(a);
        const c = textCentre(str, { at: place.T(a.attr('x'), a.attr('y')), size: nm(a.attr('size', 1.778)), rot: t.rot, mirror: t.mirror, align: t.align, font: 'vector' });
        sym.fieldPins = { ...(sym.fieldPins || {}), [key]: unplace(c, sym.at, sym.rot, sym.mirror) };
        smashedFields++;
      }
    }
    // plain drawings: lines and text
    for (const c of se.path('plain')?.children || []) {
      if (c.name === 'wire') sheet.drawings.push({ id: uid('d'), type: 'line', pts: [place.T(c.attr('x1'), c.attr('y1')), place.T(c.attr('x2'), c.attr('y2'))], style: c.attr('style') === 'shortdash' || c.attr('style') === 'longdash' ? 'dashed' : c.attr('style') === 'dashdot' ? 'dotted' : 'solid', arrowStart: false, arrowEnd: false });
      else if (c.name === 'text' && c.text.trim()) sheet.drawings.push({ id: uid('d'), type: 'text', at: place.T(c.attr('x'), c.attr('y')), text: eagleOverbar(c.text.trim()), size: nm(c.attr('size', 1.778)), bold: false, italic: false, align: 'left', rot: rotOf(c.attr('rot')).rot % 180 === 90 ? 90 : 0 });
      else if (c.name !== 'text') report.add(`Sheet drawings (${c.name}) were left out`);
    }
  });

  if (fieldNames.size) report.add(`Part attributes became component fields (in Properties): ${[...fieldNames].sort().join(', ')}`);
  if (shownAttrs.size) report.add(`Part attributes Eagle shows on the sheet stay in Properties only: ${[...shownAttrs].sort().join(', ')}`);
  if (smashedFields) report.add('Moved (smashed) NAME and VALUE texts kept where Eagle has them (pinned fields)', smashedFields);
  implicitPower(project, parts, pinNet, powered, report);

  // wires first (all nets), then trim ends that land on another net, then the labels that join a
  // net's segments by name, on the wires that are left
  const segWires = []; // { wire, net, sheet, seg }
  const wiresOf = new Map(); // seg -> its wires
  for (const [netName, segs] of netsByName) {
    for (const { si, seg } of segs) {
      const se = sheetsEl[si], sheet = se.sheet, T = se.T;
      const wires = [];
      for (const w of seg.all('wire')) {
        if (Number(w.attr('curve', 0))) report.add('Curved wires were drawn straight');
        const a = T(w.attr('x1'), w.attr('y1')), b = T(w.attr('x2'), w.attr('y2'));
        if (a[0] === b[0] && a[1] === b[1]) continue;
        const wire = { id: uid('w'), a, b };
        sheet.wires.push(wire); wires.push(wire);
        segWires.push({ wire, net: netName, sheet, seg, T });
      }
      wiresOf.set(seg, wires);
    }
  }
  // Busses (#64): their wires as Bus segments, named as Eagle names them; their labels as Bus labels
  let nBus = 0;
  for (const se of sheetsEl) {
    const sheet = se.sheet, T = se.T;
    for (const b of se.path('busses')?.all('bus') || []) {
      const name = eagleOverbar(b.attr('name') || '');
      for (const seg of b.all('segment')) {
        const segs = [];
        for (const w of seg.all('wire')) {
          const a = T(w.attr('x1'), w.attr('y1')), c = T(w.attr('x2'), w.attr('y2'));
          if (a[0] === c[0] && a[1] === c[1]) continue;
          const x = { id: uid('b'), a, b: c, name };
          (sheet.busses ||= []).push(x); segs.push(x);
        }
        if (segs.length) nBus++;
        for (const l of seg.all('label')) {
          const at = nearestOnWires(T(l.attr('x'), l.attr('y')), segs);
          if (!at) continue;
          const lab = eagleLabel({ at, rot: labelRot(l.attr('rot')), net: name, scope: 'local', shape: l.attr('xref') === 'yes' ? 'flag' : 'text', size: nm(l.attr('size', 1.778)) });
          lab.bus = true;
          sheet.labels.push(lab);
        }
      }
    }
  }
  if (nBus) report.add('Busses came over as Busses (their wires are bus entries; nets join by name, as in Eagle)', nBus);
  trimForeignEnds(project, parts, segWires, report);
  const invented = []; // segments that need a label Eagle didn't draw
  for (const [netName, segs] of netsByName) {
    const sheetsOf = new Set(segs.map((s) => s.si));
    const scope = sheetsOf.size > 1 || powered.has(netName) ? 'global' : 'local';
    const needsLabel = segs.length > 1 || !isAuto(netName);
    for (const { si, seg } of segs) {
      const sheet = sheetsEl[si].sheet, T = sheetsEl[si].T;
      const wires = wiresOf.get(seg).filter((w) => sheet.wires.includes(w));
      // a segment with a power symbol is named by it
      if (!needsLabel || seg.all('pinref').some((pr) => parts.get(pr.attr('part'))?.supply)) continue;
      // where a label sits: Eagle's labels, moved onto their wire; else the first wire's start, or the first pin
      const spots = [];
      // a plain Eagle label is the name written on the wire; xref="yes" is the flag (#81); both keep Eagle's size
      for (const l of seg.all('label')) spots.push({ at: nearestOnWires(T(l.attr('x'), l.attr('y')), wires), rot: labelRot(l.attr('rot')), shape: l.attr('xref') === 'yes' ? 'flag' : 'text', size: nm(l.attr('size', 1.778)), xref: l.attr('xref') === 'yes' });
      for (const s of spots) if (s.at) sheet.labels.push(eagleLabel({ at: s.at, rot: s.rot, net: netName, scope, shape: s.shape, size: s.size, xref: s.xref }));
      // Eagle named the net without drawing a label: one is needed here, placed once Eagle's own are down
      if (!spots.length) invented.push({ sheet, wires, seg, net: netName, scope });
    }
  }
  const xrefs = project.schematic.sheets.reduce((n, sh) => n + sh.labels.filter((l) => l.showRefs).length, 0);
  if (xrefs) report.add(`Cross-reference labels show the other sheets their net is on, e.g. [2,5]${xrefFormat ? ` (Eagle's format ${xrefFormat} also gives the frame column and row, which ElectroCAD doesn't have)` : ''}`, xrefs);
  const inventedReport = placeInventedLabels(project, parts, invented);
  if (inventedReport.moved) report.add('Nets Eagle names without a label got one, placed clear of pins and other labels', inventedReport.moved);
  if (inventedReport.crowded) report.add('Labels added for named nets with no fully clear spot (placed where they overlap least)', inventedReport.crowded);
  if (!project.schematic.sheets.length) project.schematic.sheets.push(newSheet('Sheet 1'));
  const result = { project, report, eagle: { parts, netsByName, pinNet } };
  result.verify = () => verifySchematic(project, parts, netsByName, report);
  return result;
}

/**
 * Eagle joins a power pin (direction "pwr") that no wire reaches to the net named like the pin:
 * the hidden VCC and GND of a 74xx gate P that is never placed ("addlevel=request"), say.
 * ElectroCAD joins only what is drawn, so such a gate is placed under the part's drawing, and each
 * such pin gets a power label naming its net.
 */
function implicitPower(project, parts, pinNet, powered, report) {
  const placedUnits = [];
  let labels = 0;
  for (const [ref, p] of parts) {
    if (!p.comp) continue;
    const gates = p.ds.path('gates')?.all('gate') || [];
    gates.forEach((g, unit) => {
      const sym = p.lib.symbols.get(g.attr('symbol'));
      const pins = (sym?.all('pin') || []).filter((pn) => pn.attr('direction') === 'pwr' && !pinNet.has(`${ref}\t${g.attr('name')}\t${pn.attr('name')}`));
      if (!pins.length) return;
      let ys = null;
      for (const sh of project.schematic.sheets) { const y = sh.symbols.find((q) => q.componentId === p.comp.id && q.unit === unit); if (y) { ys = { sheet: sh, y }; break; } }
      if (!ys) {
        // never placed: put it on the sheet of the part's first unit, in a row under what's drawn
        const sheet = project.schematic.sheets.find((sh) => sh.symbols.some((q) => q.componentId === p.comp.id)) || project.schematic.sheets[0];
        if (!sheet || pins.length !== (sym?.all('pin') || []).length) return; // only gates that are all power pins
        const ys0 = sheet.symbols.flatMap((q) => [q.at[1]]), xs0 = sheet.symbols.map((q) => q.at[0]);
        const row = placedUnits.filter((u) => u.sheet === sheet).length;
        const at = [Math.round(((xs0.length ? Math.min(...xs0) : 25_400_000) + row * 15_240_000) / 2_540_000) * 2_540_000, Math.round(((ys0.length ? Math.max(...ys0) : 25_400_000) + 20_320_000) / 2_540_000) * 2_540_000];
        const y = { id: uid('y'), componentId: p.comp.id, unit, at, rot: 0, mirror: false };
        sheet.symbols.push(y);
        placedUnits.push({ sheet, ref: `${ref} ${g.attr('name')}` });
        ys = { sheet, y };
      }
      const where = new Map(pinPositions(project, ys.y).map((x) => [x.pin.number, x.at]));
      for (const pn of pins) {
        const net = eagleOverbar(pinBase(pn.attr('name')));
        for (const num of p.numbers.get(`${g.attr('name')}\t${pn.attr('name')}`) || []) {
          const at = where.get(num);
          if (!at) continue;
          ys.sheet.labels.push({ id: uid('l'), at, rot: 0, net, scope: 'global', style: GROUND.test(net) ? 'gnd' : 'power' });
          pinNet.set(`${ref}\t${g.attr('name')}\t${pn.attr('name')}`, net);
          powered.add(net);
          labels++;
        }
      }
    });
  }
  if (placedUnits.length) report.add(`Hidden power gates were placed under the drawing so their pins can be labelled: ${placedUnits.map((u) => u.ref).join(', ')}`);
  if (labels) report.add('Power pins Eagle connects by name were given power labels', labels);
}

const onWire = (q, w) => {
  const [ax, ay] = w.a, [bx, by] = w.b;
  if ((q[0] - ax) * (by - ay) !== (q[1] - ay) * (bx - ax)) return false;
  return q[0] >= Math.min(ax, bx) && q[0] <= Math.max(ax, bx) && q[1] >= Math.min(ay, by) && q[1] <= Math.max(ay, by);
};

/**
 * Eagle keeps nets apart by name, so a wire may end on another net's wire or pin without joining
 * it: a bus entry ending on the (dropped) bus where another net's wire runs, say. ElectroCAD joins
 * what touches, so such an end would merge the two nets. A dead-end stub that only touches the
 * other net is removed; a longer wire is pulled back off it.
 */
function trimForeignEnds(project, parts, segWires, report) {
  const bySheet = new Map();
  for (const sw of segWires) { if (!bySheet.has(sw.sheet)) bySheet.set(sw.sheet, []); bySheet.get(sw.sheet).push(sw); }
  const pinPts = new Map(); // seg -> its pins' points
  const pinsOf = (seg) => {
    if (!pinPts.has(seg)) pinPts.set(seg, seg.all('pinref').map((pr) => pinAt(project, parts, pr)).filter(Boolean));
    return pinPts.get(seg);
  };
  let removed = 0, pulled = 0;
  for (const [sheet, list] of bySheet) {
    const segsHere = [...new Set(list.map((x) => x.seg))];
    for (const sw of list) {
      for (const end of ['a', 'b']) {
        const e = sw.wire[end];
        // an end on a Bus (a bus entry, #64) is where Eagle drew it: the Bus joins nothing
        if ((sheet.busses || []).some((b) => onWire(e, b))) continue;
        const foreign = list.some((o) => o.net !== sw.net && o.wire !== sw.wire && sheet.wires.includes(o.wire) && onWire(e, o.wire))
          || segsHere.some((sg) => sg !== sw.seg && !list.find((x) => x.seg === sg && x.net === sw.net) && pinsOf(sg).some((q) => q[0] === e[0] && q[1] === e[1]));
        if (!foreign) continue;
        const own = list.some((o) => o.net === sw.net && o.wire !== sw.wire && sheet.wires.includes(o.wire) && onWire(e, o.wire)) || pinsOf(sw.seg).some((q) => q[0] === e[0] && q[1] === e[1]);
        if (own) continue; // a real shared point: nothing to do
        const other = sw.wire[end === 'a' ? 'b' : 'a'];
        const len = Math.hypot(e[0] - other[0], e[1] - other[1]);
        if (len <= 3_600_000) { sheet.wires.splice(sheet.wires.indexOf(sw.wire), 1); removed++; break; }
        const k = 1_270_000 / len;
        sw.wire[end] = [Math.round(e[0] + (other[0] - e[0]) * k), Math.round(e[1] + (other[1] - e[1]) * k)];
        pulled++;
      }
    }
  }
  if (removed) report.add(`Wire stubs (bus entries) ending on another net were removed, so the nets stay apart`, removed);
  if (pulled) report.add(`Wire ends that landed on another net were pulled back 1.27 mm, so the nets stay apart`, pulled);
}

/**
 * The way a net label's text runs. Eagle's mirror flips the reading direction across the vertical:
 * a label at angle θ, mirrored, runs at 180° - θ (MR180 reads to the right, as R0 does; MR0 to the
 * left, as R180 does). Found on a real design: MR180 labels came in pointing the wrong way.
 */
export function labelRot(r) {
  const { rot, mirror } = rotOf(r);
  return rot90(mirror ? 180 - rot : rot);
}

/**
 * Labels for nets Eagle names without drawing one (#75). Each goes where it collides with nothing:
 * not over a pin, a symbol or another label, nor where another net's wire crosses. It tries a loose
 * wire end first (reading outward), then half-grid points along the segment's wires (longest wire,
 * middle first, reading either way); when none is fully clear it takes the one that overlaps least.
 * A segment with no wire gets its label at its first pin, the only place it can connect.
 */
function placeInventedLabels(project, parts, invented) {
  let moved = 0, crowded = 0;
  const G = 2_540_000;
  const blockersOf = new Map(); // sheet -> { boxes, pins }
  const blockers = (sheet) => {
    if (!blockersOf.has(sheet)) {
      const boxes = [], pins = [];
      for (const y of sheet.symbols) {
        const b = symbolBounds(project, y);
        if (b) boxes.push(b);
        for (const q of pinPositions(project, y)) pins.push(q.at);
        // the names and values Eagle moved (#65): pinned where it has them, so keep clear of them too
        const comp = project.components[y.componentId];
        for (const [key, str] of [['reference', comp?.ref || ''], ['value', comp?.value || '']]) {
          const at = pinnedFieldAt(y, key);
          if (!at || !str) continue;
          const hw = strokeWidthOf(str, 1_778_000, 'vector') / 2, hh = 900_000;
          boxes.push({ x0: at[0] - hw, y0: at[1] - hh, x1: at[0] + hw, y1: at[1] + hh });
        }
      }
      blockersOf.set(sheet, { boxes, pins, labels: sheet.labels.map((l) => labelBounds(l)) });
    }
    return blockersOf.get(sheet);
  };
  const meets = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
  const has = (b, q) => q[0] >= b.x0 && q[0] <= b.x1 && q[1] >= b.y0 && q[1] <= b.y1;
  const dirRot = (dx, dy) => (Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 0 : 180) : (dy < 0 ? 90 : 270));
  for (const { sheet, wires, seg, net, scope } of invented) {
    const B = blockers(sheet);
    const make = (at, rot) => eagleLabel({ at, rot, net, scope, shape: 'text' }); // the name on the wire, as a plain Eagle label
    // a label joins every wire through its point: never where another net's wire crosses this one
    const foreignWires = sheet.wires.filter((w) => !wires.includes(w));
    const onForeign = (q) => foreignWires.some((w) => onWire(q, w));
    // how badly a label at this spot collides: 0 is clear. A covered pin counts most, then the area
    // it shares with symbols and other labels. 0.25 mm of slack, so a symbol hanging from the same
    // wire (its outline starts at the wire) doesn't count as a meeting.
    const overlap = (a, x) => Math.max(0, Math.min(a.x1, x.x1) - Math.max(a.x0, x.x0)) * Math.max(0, Math.min(a.y1, x.y1) - Math.max(a.y0, x.y0));
    const cost = (l) => {
      if (onForeign(l.at)) return Infinity;
      const b = labelBounds(l), e = 250_000;
      const shrunk = { x0: b.x0 + e, y0: b.y0 + e, x1: b.x1 - e, y1: b.y1 - e };
      const area = Math.max(1, (shrunk.x1 - shrunk.x0) * (shrunk.y1 - shrunk.y0));
      let c = 0;
      // pins: 0.1 mm in is covered (a text label's box is short, #81, so the 0.25 mm slack would miss them)
      const pinBox = { x0: b.x0 + 100_000, y0: b.y0 + 100_000, x1: b.x1 - 100_000, y1: b.y1 - 100_000 };
      for (const q of B.pins) if (has(pinBox, q) && (q[0] !== l.at[0] || q[1] !== l.at[1])) c += 10;
      for (const x of B.boxes) if (meets(shrunk, x)) c += 1 + overlap(shrunk, x) / area;
      for (const x of B.labels) if (meets(shrunk, x)) c += 3 + overlap(shrunk, x) / area;
      return c;
    };
    let chosen = null;
    if (wires.length) {
      const key = (q) => `${q[0]},${q[1]}`;
      const pinSet = new Set(B.pins.map(key)), ends = new Map();
      for (const w of wires) for (const q of [w.a, w.b]) ends.set(key(q), (ends.get(key(q)) || 0) + 1);
      const cands = [];
      // 1. a loose end, reading away from its wire
      for (const w of wires) for (const [e, o] of [[w.a, w.b], [w.b, w.a]]) {
        if (pinSet.has(key(e)) || ends.get(key(e)) > 1) continue;
        cands.push(make(e, dirRot(e[0] - o[0], e[1] - o[1])));
      }
      // 2. along the wires, longest first, from the middle outward, either way along
      const byLen = [...wires].sort((a, b) => Math.hypot(b.b[0] - b.a[0], b.b[1] - b.a[1]) - Math.hypot(a.b[0] - a.a[0], a.b[1] - a.a[1]));
      for (const w of byLen) {
        const dx = w.b[0] - w.a[0], dy = w.b[1] - w.a[1], L = Math.hypot(dx, dy);
        const n = Math.max(1, Math.floor(L / (G / 2))); // every half grid step
        const order = Array.from({ length: n + 1 }, (_, k) => k).sort((p, q) => Math.abs(p - n / 2) - Math.abs(q - n / 2));
        for (const k of order) {
          const at = [Math.round(w.a[0] + (dx * k) / n), Math.round(w.a[1] + (dy * k) / n)];
          if (pinSet.has(key(at))) continue;
          const r = dirRot(dx, dy);
          cands.push(make(at, r), make(at, (r + 180) % 360));
        }
      }
      // the first clear spot (in the order above), else the least-bad one, else the old spot
      let best = null, bestCost = Infinity;
      for (const c of cands) { const k = cost(c); if (k === 0) { best = c; bestCost = 0; break; } if (k < bestCost) { best = c; bestCost = k; } }
      if (best && bestCost === 0) { chosen = best; moved++; } else { chosen = best || make(wires[0].a, 0); crowded++; }
    } else {
      const at = pinAt(project, parts, seg.child('pinref'));
      if (at) chosen = make(at, 0);
    }
    if (chosen) { sheet.labels.push(chosen); B.labels.push(labelBounds(chosen)); }
  }
  return { moved, crowded };
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
  // and no net here may join pins Eagle keeps on different nets
  const eagleNet = new Map();
  for (const [netName, segs] of netsByName) for (const { seg } of segs) for (const pr of seg.all('pinref')) {
    const p = parts.get(pr.attr('part'));
    if (p?.comp && !p.supply) for (const num of p.numbers.get(`${pr.attr('gate')}\t${pr.attr('pin')}`) || []) eagleNet.set(`${p.comp.ref}\t${num}`, netName);
  }
  for (const n of nl.nets) {
    const names = [...new Set(n.pins.map((p) => eagleNet.get(`${p.ref}\t${p.pin}`)).filter(Boolean))];
    if (names.length > 1) mismatches.push(`Nets ${names.join(' and ')} are joined into one here (${n.name})`);
  }
  for (const m of mismatches) report.add(m);
  return { ok: !mismatches.length, mismatches, netlist: nl };
}

/** A Net or Global label made by the import: `shape` and `size` stored only where they differ from the defaults (#81). */
function eagleLabel({ at, rot, net, scope, shape, size = 0, xref = false }) {
  const l = { id: uid('l'), at, rot, net, scope, style: 'label' };
  if (xref && scope === 'global') l.showRefs = true; // Eagle's cross-reference labels show where the net goes (#76)
  if (shape && shape !== (scope === 'global' ? 'flag' : 'text')) l.shape = shape;
  if (size > 0 && size !== LABEL_TEXT) l.size = size;
  return l;
}
