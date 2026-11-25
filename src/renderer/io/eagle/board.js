// Eagle .brd -> ElectroCAD Board (#36). The Board's Footprints come from Forward annotation of the
// Schematic (ADR-0002), then each Eagle element sets its place, rotation, side and lock. Eagle's
// signals are not taken as they are: the Nets come from the Schematic, and each signal's copper
// takes the Net of the pads it touches (a signal whose pads the Schematic splits is reported).
//   layers 1 / 16 -> F.Cu / B.Cu; inner layers in use (up to two) -> In1.Cu, In2.Cu
//   layer 20 (Dimension) -> the Outline; signal wires -> Tracks; vias -> Vias; polygons -> Zones
//   design rules and net classes -> Design rules and Net classes
// A board without its schematic gets a stub Schematic: one Part per package, net labels on its pins.
import { uid, newSheet, addFootprint } from '../../core/project.js';
import { changeList, applyChanges } from '../../core/annotate.js';
import { padNets } from '../../core/footprint.js';
import { mm } from '../../core/units.js';
import { nm, pt, len, rotOf, arcMid, arcPoints, restring, Report, placedRot } from './common.js';
import { packageToFootprint } from './library.js';
import { textCentre } from '../../core/boardDrawings.js';
import { growOutline } from '../../core/zones.js';
import { libraries } from './schematic.js';

const G = 1_270_000;

/** Eagle's <designrules> as numbers (nm, or ratios). */
export function designRules(boardEl) {
  const p = new Map((boardEl.child('designrules')?.all('param') || []).map((x) => [x.attr('name'), x.attr('value')]));
  const L = (k, d) => (p.has(k) ? len(p.get(k)) : d);
  const R = (k, d) => (p.has(k) ? Number(p.get(k)) : d);
  return {
    params: p,
    clearance: Math.max(L('mdWireWire', 203_200), L('mdWirePad', 203_200), L('mdWireVia', 203_200), L('mdPadPad', 203_200), L('mdPadVia', 203_200), L('mdViaVia', 203_200), L('mdSmdPad', 0), L('mdSmdVia', 0), L('mdSmdSmd', 0)),
    minWidth: L('msWidth', 254_000),
    minDrill: L('msDrill', 609_600),
    edge: L('mdCopperDimension', 1_016_000),
    restring: {
      padRatio: R('rvPadTop', 0.25), padMin: L('rlMinPadTop', 254_000), padMax: L('rlMaxPadTop', 508_000),
      viaRatio: R('rvViaOuter', 0.25), viaMin: L('rlMinViaOuter', 203_200), viaMax: L('rlMaxViaOuter', 508_000),
    },
    layerSetup: p.get('layerSetup') || '',
    // Shapes tab: -1 as in the library, 0 square, 1 round, 2 octagon (first: pads marked first="yes")
    padShapes: { top: R('psTop', -1), first: R('psFirst', -1) },
    // Masks tab: vias with a drill this big or bigger get a mask opening (0: none)
    viaStopLimit: L('mlViaStopLimit', 0),
    // Supply tab: the gap round a pad joined to a polygon through a thermal
    thermalIsolate: L('slThermalIsolate', 254_000),
  };
}

/**
 * Put an Eagle board into `project` (which already has its Schematic, or a stub one is made).
 * `eagle`: what the schematic import found (parts by name), or null for a board on its own.
 */
export function importEagleBoard(root, project, { report = new Report(), eagle = null } = {}) {
  const drawing = root.child('drawing');
  const brd = drawing?.child('board');
  if (!brd) throw new Error('This is not an Eagle board (.brd): there is no <board> in it.');
  const libs = libraries(drawing);
  const rules = designRules(brd);
  const signals = brd.path('signals')?.all('signal') || [];
  const elements = brd.path('elements')?.all('element') || [];

  // ---- copper layers in use
  const used = new Set();
  for (const s of signals) for (const c of s.children) if (c.attr('layer') != null) used.add(Number(c.attr('layer')));
  for (const n of (rules.layerSetup.match(/\d+/g) || []).map(Number)) used.add(n);
  const inner = [...used].filter((n) => n >= 2 && n <= 15).sort((a, b) => a - b);
  if (inner.length > 2) report.add(`Inner copper layers past two (${inner.slice(2).join(', ')}) were left out: ElectroCAD makes 2- or 4-layer boards`);
  const layerName = new Map([[1, 'F.Cu'], [16, 'B.Cu']]);
  const eagleLayerNames = new Map((root.path('drawing/layers')?.all('layer') || []).map((l) => [Number(l.attr('number')), l.attr('name')]));
  if (inner.length) { layerName.set(inner[0], 'In1.Cu'); if (inner[1]) layerName.set(inner[1], 'In2.Cu'); }
  const b = project.board;
  b.stack.copper = inner.length ? 4 : 2;
  if (inner.length === 1) report.add('One inner copper layer: the board becomes 4-layer with In2.Cu empty');

  // ---- rules and classes
  b.preset = 'Eagle design rules';
  b.rules = { ...b.rules, clearance: rules.clearance, trackWidth: rules.minWidth, viaDrill: rules.minDrill, minHole: rules.minDrill,
    viaDiameter: rules.minDrill + 2 * restring(rules.minDrill, rules.restring.viaRatio, rules.restring.viaMin, rules.restring.viaMax),
    annularRing: Math.min(rules.restring.padMin, rules.restring.viaMin), edgeClearance: rules.edge };

  // ---- the Schematic side: a stub when there is none
  if (!eagle) stubSchematic(project, brd, libs, signals, elements, rules, report);

  // ---- each element's Component and its Footprint
  const compByRef = new Map(Object.values(project.components).map((c) => [c.ref, c]));
  const fpOfElement = new Map();
  for (const el of elements) {
    const lib = libs.get(el.attr('library'));
    const pkg = lib?.packages.get(el.attr('package'));
    if (!pkg) { report.add(`Element ${el.attr('name')}: its package ${el.attr('package')} is not in the file`); continue; }
    const comp = compByRef.get(el.attr('name'));
    if (!comp) { report.add(`${el.attr('name')} is on the Board but not on the Schematic; it was left off`); continue; }
    const fp = packageToFootprint(pkg, { report, rules: rules.restring, shapes: rules.padShapes });
    fpOfElement.set(el.attr('name'), fp);
    // the Board's package is the one that counts (the Schematic's library copy may be older). It
    // replaces the Part's own Footprint, so the Part's Pin map (pin 1 -> pad "TMS") still applies.
    const part = comp.footprint?.fpId && project.parts?.[comp.partId];
    if (part?.footprints?.[comp.footprint.fpId]) part.footprints[comp.footprint.fpId] = fp;
    else comp.footprint = { fpKey: addFootprint(project, `eagle:${el.attr('library')}`, fp) };
  }
  // the Footprints and the Board's record of Nets, from the Schematic
  applyChanges(project, changeList(project));
  for (const el of elements) {
    const comp = compByRef.get(el.attr('name'));
    const bf = comp && b.footprints.find((f) => f.componentId === comp.id);
    if (!bf) continue;
    const { rot, mirror } = rotOf(el.attr('rot'));
    bf.at = pt(el.attr('x'), el.attr('y'));
    bf.rot = Math.round(placedRot(rot, mirror) * 100) / 100;
    bf.side = mirror ? 'B' : 'F';
    bf.locked = el.attr('locked') === 'yes';
  }

  // ---- the Outline (layer 20) and what else is drawn on the board
  b.outline = [];
  b.drawings = [];
  const dims = [];
  for (const c of brd.path('plain')?.children || []) {
    const layer = Number(c.attr('layer'));
    if (layer === 20 || layer === 46) {
      if (c.name === 'wire') {
        const a = pt(c.attr('x1'), c.attr('y1')), e = pt(c.attr('x2'), c.attr('y2'));
        const curve = Number(c.attr('curve', 0));
        dims.push(curve ? { type: 'arc', start: a, mid: arcMid(a, e, curve), end: e, layer: 'Edge.Cuts' } : { type: 'line', pts: [a, e], layer: 'Edge.Cuts' });
      } else if (c.name === 'circle') dims.push({ type: 'circle', c: pt(c.attr('x'), c.attr('y')), r: nm(c.attr('radius')), layer: 'Edge.Cuts', fill: 'none' });
      else if (c.name === 'rectangle') { const p1 = pt(c.attr('x1'), c.attr('y1')), p2 = pt(c.attr('x2'), c.attr('y2')); dims.push({ type: 'rect', a: [Math.min(p1[0], p2[0]), Math.min(p1[1], p2[1])], b: [Math.max(p1[0], p2[0]), Math.max(p1[1], p2[1])], layer: 'Edge.Cuts' }); }
    } else if (c.name === 'hole') report.add('Board holes (outside packages) were left out');
    else if (c.name === 'polygon' && layerName.has(layer)) {
      b.zones.push(zoneOf(c, layerName.get(layer), '', report, rules));
    } else if (['text', 'wire', 'circle', 'rectangle', 'polygon'].includes(c.name)) {
      // the board's own text and graphics (#66): silk, names, values, docu, stop, cream and copper
      const L = DRAWING_LAYER[layer] || layerName.get(layer);
      const made = L ? plainDrawing(c, L) : [];
      if (made.length) b.drawings.push(...made);
      else report.add(`Board drawings on layer ${layer}${eagleLayerNames.get(layer) ? ` ${eagleLayerNames.get(layer)}` : ''} (${c.name}) were left out`);
    }
  }
  b.outline = dims;
  if (!b.outline.length) report.add('The board has no outline on layer 20 (Dimension)');

  // ---- signals: copper takes the Net of the pads it touches
  const nets = padNets(b);
  const compRefToId = new Map(Object.values(project.components).map((c) => [c.ref, c.id]));
  const netOfSignal = new Map();
  const mismatched = [], details = [];
  for (const s of signals) {
    const pads = s.all('contactref').map((c) => `${compRefToId.get(c.attr('element'))}:${c.attr('pad')}`);
    const counts = new Map();
    for (const k of pads) { const n = nets.get(k); if (n) counts.set(n, (counts.get(n) || 0) + 1); }
    const net = [...counts].sort((x, y) => y[1] - x[1])[0]?.[0] || (pads.length ? '' : s.attr('name'));
    netOfSignal.set(s.attr('name'), net);
    if (counts.size > 1 || (net && pads.some((k) => nets.get(k) !== net))) {
      mismatched.push(s.attr('name'));
      const odd = s.all('contactref').filter((c) => nets.get(`${compRefToId.get(c.attr('element'))}:${c.attr('pad')}`) !== net)
        .map((c) => `${c.attr('element')}.${c.attr('pad')} (${nets.get(`${compRefToId.get(c.attr('element'))}:${c.attr('pad')}`) || (compRefToId.get(c.attr('element')) ? 'no net' : 'not on the Schematic')})`);
      details.push(`Signal ${s.attr('name')} (${net || 'no net'} here): ${odd.slice(0, 12).join(', ')}${odd.length > 12 ? `, and ${odd.length - 12} more` : ''} differ`);
    }
    for (const c of s.children) {
      if (c.name === 'wire') {
        const L = layerName.get(Number(c.attr('layer')));
        if (!L) { if (Number(c.attr('layer')) !== 19) report.add(`Copper on layer ${c.attr('layer')} was left out`); continue; }
        const a = pt(c.attr('x1'), c.attr('y1')), e = pt(c.attr('x2'), c.attr('y2'));
        const curve = Number(c.attr('curve', 0));
        const pts = curve ? arcPoints(a, e, curve) : [a, e];
        if (curve) report.add('Curved tracks were made of short straight segments');
        for (let i = 1; i < pts.length; i++) if (pts[i][0] !== pts[i - 1][0] || pts[i][1] !== pts[i - 1][1]) b.tracks.push({ id: uid('t'), a: pts[i - 1], b: pts[i], width: nm(c.attr('width')) || rules.minWidth, layer: L, net });
      } else if (c.name === 'via') {
        const drill = nm(c.attr('drill'));
        const extent = c.attr('extent', '1-16');
        if (extent !== '1-16') report.add(`Blind and buried vias (${extent}) became through vias`);
        if (c.attr('shape') && c.attr('shape') !== 'round') report.add('Square and octagonal vias became round');
        const d = nm(c.attr('diameter', 0)) || drill + 2 * restring(drill, rules.restring.viaRatio, rules.restring.viaMin, rules.restring.viaMax);
        b.vias.push({ id: uid('v'), at: pt(c.attr('x'), c.attr('y')), drill, diameter: Math.max(d, drill + 2 * rules.restring.viaMin), from: 'F.Cu', to: 'B.Cu', net, ...(rules.viaStopLimit > 0 && drill >= rules.viaStopLimit ? { tented: false } : {}) });
      } else if (c.name === 'polygon') {
        const L = layerName.get(Number(c.attr('layer')));
        if (!L) { report.add(`A polygon on layer ${c.attr('layer')} was left out`); continue; }
        b.zones.push(zoneOf(c, L, net, report, rules));
      }
    }
  }
  for (const d of details) report.add(d);

  // ---- net classes
  const classes = brd.path('classes')?.all('class') || [];
  for (const cl of classes) {
    const w = len(cl.attr('width', '0')), d = len(cl.attr('drill', '0'));
    const self = cl.all('clearance').find((x) => x.attr('class') === cl.attr('number'));
    const clr = self ? len(self.attr('value')) : 0;
    if (cl.attr('number') === '0') { if (w) b.rules.trackWidth = w; if (clr) b.rules.clearance = Math.max(b.rules.clearance, clr); continue; }
    const members = signals.filter((s) => s.attr('class') === cl.attr('number')).map((s) => netOfSignal.get(s.attr('name'))).filter(Boolean);
    if (!members.length) continue;
    const drill = d || b.rules.viaDrill;
    b.netClasses[cl.attr('name') || `Class ${cl.attr('number')}`] = {
      trackWidth: w || b.rules.trackWidth, clearance: clr || b.rules.clearance, viaDrill: drill,
      viaDiameter: drill + 2 * restring(drill, rules.restring.viaRatio, rules.restring.viaMin, rules.restring.viaMax), nets: [...new Set(members)],
    };
  }
  return { project, report, mismatched, details, netOfSignal };
}

/**
 * An Eagle polygon as a Zone. Eagle draws a polygon's outline with its wire width, so the copper
 * reaches half that width past the vertices: the outline is grown to match. The thermal gap is the
 * board's slThermalIsolate; the spoke is the polygon's width (as Eagle draws them); clearance is the
 * polygon's isolate (0: the board's rules apply, as in Eagle). orphans="yes" keeps islands.
 * Checked against the Gerbers a board house made from a real Eagle board: matching these takes the
 * inner planes from 99.4-99.7% to 99.6-99.9%.
 */
function zoneOf(c, layer, net, report, rules = null) {
  const v = c.all('vertex');
  const pts = [];
  v.forEach((x, i) => {
    const a = pt(x.attr('x'), x.attr('y'));
    const nx = v[(i + 1) % v.length];
    const curve = Number(x.attr('curve', 0));
    if (curve) { const arc = arcPoints(a, pt(nx.attr('x'), nx.attr('y')), curve); pts.push(...arc.slice(0, -1)); } else pts.push(a);
  });
  if (c.attr('pour') === 'hatch') report.add('Hatched polygons became solid zones');
  const rank = Number(c.attr('rank', 1));
  const thermals = c.attr('thermals', 'yes') !== 'no';
  const width = nm(c.attr('width', 0.254));
  return {
    id: uid('z'), layer, net: net || '', outline: growOutline(pts, Math.round(width / 2)), priority: Math.max(0, 7 - rank),
    clearance: len(c.attr('isolate', '0')), connect: thermals ? 'thermal' : 'solid',
    thermal: { gap: rules?.thermalIsolate || 254_000, spoke: Math.max(width, 127_000) },
    ...(c.attr('orphans') === 'yes' ? { keepIslands: true } : {}),
  };
}

/** A Schematic for a board on its own: a Part per package, pins = pads, a net label on each connected pin. */
function stubSchematic(project, brd, libs, signals, elements, rules, report) {
  report.add('No schematic: a stub Schematic was made from the board (one symbol per part, net labels on its pins)');
  const sheet = project.schematic.sheets[0] || (project.schematic.sheets[0] = newSheet('Sheet 1'));
  const padNet = new Map();
  for (const s of signals) for (const c of s.all('contactref')) padNet.set(`${c.attr('element')}\t${c.attr('pad')}`, s.attr('name'));
  let col = 0, row = 0;
  for (const el of elements) {
    const lib = libs.get(el.attr('library'));
    const pkg = lib?.packages.get(el.attr('package'));
    if (!pkg) continue;
    const fp = packageToFootprint(pkg, { report, rules: rules.restring });
    const pads = fp.pads.filter((p) => p.number);
    if (!pads.length) continue;
    const id = `eagle-stub/${el.attr('library')}/${el.attr('package')}`;
    const h = Math.max(1, pads.length);
    project.parts[id] ||= {
      id, name: el.attr('package'), prefix: (el.attr('name').match(/^[A-Za-z]+/) || ['U'])[0],
      units: [{ name: 'A', graphics: [{ type: 'rect', a: [0, -G], b: [4 * G, h * 2 * G], fill: 'background' }],
        pins: pads.map((p, i) => ({ number: p.number, name: p.number, at: [-2 * G, i * 2 * G], dir: 'R', length: 2 * G, type: 'passive' })) }],
      footprints: { [el.attr('package')]: fp }, pinMap: {},
    };
    const comp = { id: uid('c'), partId: id, ref: el.attr('name'), value: el.attr('value') || el.attr('package'), mpn: null, footprint: { fpId: el.attr('package') }, fields: {} };
    project.components[comp.id] = comp;
    // stack the symbols down the sheet, in columns
    const sym = { id: uid('y'), componentId: comp.id, unit: 0, at: [mm(25.4) + col * 16 * G, mm(20.32) + row], rot: 0, mirror: false };
    sheet.symbols.push(sym);
    pads.forEach((p, i) => {
      const net = padNet.get(`${el.attr('name')}\t${p.number}`);
      if (net) sheet.labels.push({ id: uid('l'), at: [sym.at[0] - 2 * G, sym.at[1] + i * 2 * G], rot: 0, net, scope: 'local', style: 'label' });
    });
    row += (h + 2) * 2 * G;
    if (row > mm(160)) { row = 0; col++; }
  }
  sheet.paper = { size: col > 3 ? 'A2' : col > 1 ? 'A3' : 'A4', orientation: 'landscape' };
}

// ---------------------------------------------------------------- board drawings (#66)

/** Eagle's drawing layers -> ours (copper 1 and 16 come from the stack). */
const DRAWING_LAYER = { 21: 'F.SilkS', 25: 'F.SilkS', 22: 'B.SilkS', 26: 'B.SilkS', 27: 'F.Fab', 51: 'F.Fab', 28: 'B.Fab', 52: 'B.Fab', 29: 'F.Mask', 30: 'B.Mask', 31: 'F.Paste', 32: 'B.Paste', 39: 'F.CrtYd', 40: 'B.CrtYd' };

/**
 * One Eagle <plain> item as Board drawings on `layer`: wires (straight or curved), circles (width 0:
 * filled), rectangles (always filled, possibly turned), polygons (filled) and text (one drawing per
 * line, in Eagle's vector-font metrics, anchored by its alignment).
 */
function plainDrawing(c, layer) {
  const width = (w) => { const v = nm(w); return v > 0 ? { width: v } : {}; };
  if (c.name === 'wire') {
    const a = pt(c.attr('x1'), c.attr('y1')), e = pt(c.attr('x2'), c.attr('y2'));
    const curve = Number(c.attr('curve', 0));
    return [curve ? { id: uid('d'), type: 'arc', layer, start: a, mid: arcMid(a, e, curve), end: e, ...width(c.attr('width')) }
      : { id: uid('d'), type: 'line', layer, pts: [a, e], ...width(c.attr('width')) }];
  }
  if (c.name === 'circle') {
    const w = nm(c.attr('width'));
    return [{ id: uid('d'), type: 'circle', layer, c: pt(c.attr('x'), c.attr('y')), r: nm(c.attr('radius')), ...(w > 0 ? { width: w } : { width: 0, fill: 'outline' }) }];
  }
  if (c.name === 'rectangle') {
    const p1 = pt(c.attr('x1'), c.attr('y1')), p2 = pt(c.attr('x2'), c.attr('y2'));
    const { rot } = rotOf(c.attr('rot'));
    const a = [Math.min(p1[0], p2[0]), Math.min(p1[1], p2[1])], bb = [Math.max(p1[0], p2[0]), Math.max(p1[1], p2[1])];
    if (!rot) return [{ id: uid('d'), type: 'rect', layer, a, b: bb, width: 0, fill: 'outline' }];
    const cx = (a[0] + bb[0]) / 2, cy = (a[1] + bb[1]) / 2, t = (rot * Math.PI) / 180, co = Math.cos(t), si = Math.sin(t);
    const turn = ([x, y]) => [Math.round(cx + (x - cx) * co + (y - cy) * si), Math.round(cy - (x - cx) * si + (y - cy) * co)];
    return [{ id: uid('d'), type: 'poly', layer, pts: [a, [bb[0], a[1]], bb, [a[0], bb[1]]].map(turn), width: 0, fill: 'outline' }];
  }
  if (c.name === 'polygon') {
    const v = c.all('vertex');
    return v.length >= 3 ? [{ id: uid('d'), type: 'poly', layer, pts: v.map((x) => pt(x.attr('x'), x.attr('y'))), ...width(c.attr('width')), fill: 'outline' }] : [];
  }
  // text: Eagle anchors it at its alignment point (bottom left by default); ours is the centre
  const lines = String(c.text || '').replace(/\r/g, '').split('\n').map((l) => l.trim());
  const size = nm(c.attr('size', 1.778));
  const r = rotOf(c.attr('rot'));
  let rot = r.rot, align = c.attr('align', 'bottom-left');
  const mirror = r.mirror;
  // Eagle keeps text readable: turned past 90° (up to 270°) it's drawn the other way up, with the
  // anchor on the opposite corner, unless it's spun ('S')
  if (!r.spin && rot > 90 && rot <= 270) {
    rot -= 180;
    const flip = { bottom: 'top', top: 'bottom', left: 'right', right: 'left', center: 'center' };
    align = align === 'center' ? 'center' : align.split('-').map((x) => flip[x]).join('-');
  }
  const ours = placedRot(rot, mirror);
  const pitch = size * (1 + Number(c.attr('distance', 50)) / 100);
  const at0 = pt(c.attr('x'), c.attr('y'));
  const t = (ours * Math.PI) / 180, co = Math.cos(t), si = Math.sin(t);
  // later lines go down the page in the text's own frame (multi-line text grows downwards from a bottom anchor's first line)
  const down = ([x, y]) => [Math.round(x * co + y * si), Math.round(-x * si + y * co)];
  const v = align.startsWith('bottom') ? -(lines.length - 1) : align.startsWith('top') ? 0 : -(lines.length - 1) / 2;
  const out = [];
  lines.forEach((line, i) => {
    if (!line) return;
    const [dx, dy] = down([0, (v + i) * pitch]);
    out.push({ id: uid('d'), type: 'text', layer, text: line, size, rot: ours, at: textCentre(line, { at: [at0[0] + dx, at0[1] + dy], size, rot: ours, mirror, align, font: 'vector' }) });
  });
  return out;
}
