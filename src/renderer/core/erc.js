// Electrical rule check (#11): a pure function Project -> [violation]. Each violation has
//   { id, rule, severity: 'error' | 'warning' | 'info', message, sheetId, at: [x, y], items: [ids],
//     refs: [Reference designators, with and without the Unit letter], nets: [Net names], fix? }
// `refs` and `nets` are what the ERC card's search matches.
// where `at` is where to look on `sheetId` and `fix` (when there is one) is
//   { label, apply(project) } — an edit the panel offers as a button (one undo step).
// Rules and their wording: docs/UI.md "ERC". Connectivity comes from buildNetlist.
import { buildNetlist, compareRefs } from './netlist.js';
import { partOf, pinPositions, footprintOf, padForPin } from './project.js';
import { unitLetter } from './schematic.js';
import { placeFields } from './fields.js';
import { key, onSegment } from './geom.js';
import { busGroups, busMembers } from './bus.js';

const DRIVERS = new Set(['output', 'power_out', 'bidirectional', 'tri_state', 'open_collector', 'open_emitter']);

/**
 * Check a Project. `measure` (text width, as for placeFields) adds field-overlap warnings; leave it
 * out in callers that don't draw.
 */
export function runErc(project, { measure = null } = {}) {
  const out = [];
  const add = (v) => out.push({ id: `${v.rule}:${v.items.join(',')}`, refs: [], nets: [], ...v, refs: [...new Set(v.refs || [])], nets: [...new Set(v.nets || [])] });
  const rf = (m) => [m.comp.ref, m.comp.ref + unitLetter(m.part, m.sym.unit)];
  const nl = buildNetlist(project);

  // every placed Pin: where it is, what it is
  const pins = new Map(); // `${componentId}:${pin}` -> { comp, part, sym, sheet, pin, at, label }
  for (const sheet of project.schematic.sheets) {
    for (const sym of sheet.symbols) {
      const comp = project.components[sym.componentId];
      const part = partOf(project, comp);
      if (!comp || !part) continue;
      for (const { pin, at } of pinPositions(project, sym)) {
        pins.set(`${comp.id}:${pin.number}`, { comp, part, sym, sheet, pin, at, label: `${comp.ref}${unitLetter(part, sym.unit)} pin ${pin.number}${pin.name && pin.name !== '~' ? ` (${pin.name})` : ''}` });
      }
    }
  }
  const noConnects = new Map(); // `${sheetId}:${x,y}` -> marker
  for (const s of project.schematic.sheets) for (const n of s.noConnects || []) noConnects.set(`${s.id}:${key(n.at)}`, { ...n, sheet: s });
  const pinAt = (p) => noConnects.get(`${p.sheet.id}:${key(p.at)}`);
  const usedMarkers = new Set();

  // unconnected Pins (unless marked no-connect, or a no-connect Pin by type)
  for (const u of nl.unconnected) {
    const p = pins.get(`${u.componentId}:${u.pin}`);
    if (!p) continue;
    const nc = pinAt(p);
    if (nc) {
      usedMarkers.add(nc.id);
      add({ rule: 'no-connect', severity: 'info', message: `${p.label} is marked no-connect.`, sheetId: p.sheet.id, at: p.at, items: [nc.id], refs: rf(p) });
      continue;
    }
    if (p.pin.type === 'no_connect') continue;
    add({ rule: 'unconnected-pin', refs: rf(p), severity: 'error', message: `${p.label} isn't connected. Wire it, or mark it no-connect (Q).`, sheetId: p.sheet.id, at: p.at, items: [p.sym.id + ':' + p.pin.number] });
  }

  for (const net of nl.nets) {
    const members = net.pins.map((x) => pins.get(`${x.componentId}:${x.pin}`)).filter(Boolean);
    const first = members[0];
    const where = first ? { sheetId: first.sheet.id, at: first.at } : { sheetId: project.schematic.sheets[0].id, at: [0, 0] };
    // a no-connect marker on a connected Pin
    for (const m of members) {
      const nc = pinAt(m);
      if (nc && members.length > 1) { usedMarkers.add(nc.id); add({ rule: 'no-connect-connected', refs: rf(m), nets: [net.name], severity: 'warning', message: `${m.label} is marked no-connect but is connected to ${net.name}.`, sheetId: m.sheet.id, at: m.at, items: [nc.id] }); }
      else if (nc) usedMarkers.add(nc.id);
    }
    // a Net with a single Pin (a Wire or label going nowhere)
    if (members.length === 1 && !pinAt(first)) {
      add({ rule: 'single-pin-net', refs: rf(first), nets: [net.name], severity: 'warning', message: `${net.name} only reaches ${first.label}.`, ...where, items: [net.name] });
    }
    // two outputs driving one Net
    const outputs = members.filter((m) => m.pin.type === 'output' || m.pin.type === 'power_out');
    if (outputs.length > 1) {
      add({ rule: 'output-conflict', refs: outputs.flatMap(rf), nets: [net.name], severity: 'error', message: `${net.name} is driven by ${outputs.length} outputs: ${outputs.map((m) => m.label).join(', ')}.`, sheetId: outputs[1].sheet.id, at: outputs[1].at, items: outputs.map((m) => m.sym.id + ':' + m.pin.number) });
    }
    // power inputs with nothing driving them (a Power symbol counts as the supply)
    const powerIn = members.filter((m) => m.pin.type === 'power_in');
    const hasSupply = members.some((m) => DRIVERS.has(m.pin.type) || m.pin.type === 'power_out') || labelsOf(project, net).some((l) => l.style === 'power' || l.style === 'gnd');
    if (powerIn.length && !hasSupply) {
      add({ rule: 'power-undriven', refs: powerIn.flatMap(rf), nets: [net.name], severity: 'error', message: `${powerIn.map((m) => m.label).join(', ')} ${powerIn.length === 1 ? 'is a power input' : 'are power inputs'} with nothing supplying ${net.name}. Add a Power symbol or a power output.`, sheetId: powerIn[0].sheet.id, at: powerIn[0].at, items: [net.name] });
    }
    // two different names on one Net
    if (net.conflict) {
      const l = labelsOf(project, net)[0];
      add({ rule: 'label-conflict', refs: members.flatMap(rf), nets: [net.name, ...net.conflict], severity: 'error', message: `One net has ${net.conflict.length} names: ${net.conflict.join(', ')}. Labels with different names are joined by a wire or pin.`, ...(l ? { sheetId: l.sheet.id, at: l.at } : where), items: [net.name] });
    }
    // one name, mixed case (ADR-0013): a warning with a fix
    if (net.spellings) {
      const odd = labelsOf(project, net).filter((l) => l.net.trim() !== net.name.replace(/^.*\//, ''));
      const name = net.name.replace(/^.*\//, '');
      const ids = odd.map((l) => l.id);
      if (odd.length) {
        add({ rule: 'mixed-spelling', refs: members.flatMap(rf), nets: [net.name, ...net.spellings], severity: 'warning', message: `${net.spellings.join(' and ')} are the same net; use one spelling.`, sheetId: odd[0].sheet.id, at: odd[0].at, items: ids,
          fix: { label: `Rename to ${name}`, apply: (p) => { for (const s of p.schematic.sheets) for (const l of s.labels || []) if (ids.includes(l.id)) l.net = name; } } });
      }
    }
  }

  // Pins with no matching Pad on the Component's Footprint
  const seenComp = new Set();
  for (const p of pins.values()) {
    const fp = footprintOf(project, p.comp);
    if (!fp) {
      if (!seenComp.has(p.comp.id)) { seenComp.add(p.comp.id); add({ rule: 'no-footprint', refs: [p.comp.ref], severity: 'warning', message: `${p.comp.ref} has no footprint.`, sheetId: p.sheet.id, at: p.sym.at, items: [p.comp.id] }); }
      continue;
    }
    const pad = padForPin(project, p.comp, p.pin.number);
    if (!fp.pads.some((x) => x.number === pad)) {
      add({ rule: 'pin-without-pad', refs: rf(p), severity: 'error', message: `${p.label} has no pad ${pad} on ${fp.name}.`, sheetId: p.sheet.id, at: p.at, items: [p.sym.id + ':' + p.pin.number] });
    }
  }

  // Units not placed (a power Unit left off means the chip gets no supply)
  for (const comp of Object.values(project.components)) {
    const part = partOf(project, comp);
    if (!part || part.units.length < 2) continue;
    const placed = project.schematic.sheets.flatMap((s) => s.symbols.filter((y) => y.componentId === comp.id).map((y) => ({ y, s })));
    const missing = part.units.map((u, i) => ({ u, i })).filter(({ i }) => !placed.some(({ y }) => (y.unit || 0) === i));
    if (missing.length && placed.length) {
      const power = missing.some(({ u }) => u.pins.length && u.pins.every((x) => x.type === 'power_in'));
      add({ rule: 'unit-not-placed', refs: [comp.ref, ...missing.map(({ i }) => comp.ref + unitLetter(part, i))], severity: power ? 'error' : 'warning', message: `${missing.map(({ i }) => comp.ref + unitLetter(part, i)).join(', ')} ${missing.length === 1 ? "isn't" : "aren't"} placed${power ? ', so the chip has no power connection' : ''}.`, sheetId: placed[0].s.id, at: placed[0].y.at, items: [comp.id] });
    }
  }

  // no-connect markers that aren't on a Pin
  for (const nc of noConnects.values()) {
    if (usedMarkers.has(nc.id)) continue;
    const onPin = [...pins.values()].some((p) => p.sheet.id === nc.sheet.id && key(p.at) === key(nc.at));
    if (!onPin) add({ rule: 'stray-no-connect', severity: 'warning', message: 'A no-connect marker isn\'t on a pin.', sheetId: nc.sheet.id, at: nc.at, items: [nc.id] });
  }

  // Busses (#64): a Bus needs a name, and a Net entering one (a Wire ending on it) should be one of
  // its members; the Bus itself connects nothing, so a Net that isn't listed is likely a slip
  const netOfWire = new Map();
  for (const net of nl.nets) for (const id of net.wires || []) netOfWire.set(id, net);
  for (const sheet of project.schematic.sheets) {
    for (const g of busGroups(sheet)) {
      const at = g.segs[0].a;
      if (!g.name.trim()) { add({ rule: 'bus-unnamed', severity: 'warning', message: 'A bus has no name. Name it after its members, e.g. D[0..7].', sheetId: sheet.id, at, items: g.segs.map((x) => x.id) }); continue; }
      const members = new Set(busMembers(g.name).map((m) => m.toLowerCase()));
      const seen = new Set();
      for (const w of sheet.wires) {
        const end = [w.a, w.b].find((p) => g.segs.some((b) => onSegment(p, b.a, b.b)));
        const net = end && netOfWire.get(w.id);
        if (!net || seen.has(net.name)) continue;
        seen.add(net.name);
        // a local Net's name carries its Sheet (Sheet 2/EN); a member is named without it
        const name = net.sheet && net.name.startsWith(net.sheet + '/') ? net.name.slice(net.sheet.length + 1) : net.name;
        if (members.has(name.toLowerCase())) continue;
        add({ rule: 'bus-member', nets: [net.name], severity: 'warning', message: `${net.name} enters bus ${g.name}, which doesn't list it.`, sheetId: sheet.id, at: end, items: [w.id] });
      }
    }
  }

  // fields that couldn't find a free spot (only when the caller can measure text)
  if (measure) {
    for (const sheet of project.schematic.sheets) {
      const placement = placeFields(project, sheet, { measure });
      for (const sym of sheet.symbols) {
        const r = placement.get(sym.id);
        if (!r?.flagged) continue;
        const comp = project.components[sym.componentId];
        add({ rule: 'field-overlap', refs: [comp.ref, comp.ref + unitLetter(partOf(project, comp), sym.unit), r.overlapWith].filter((x) => x && x !== 'a wire'), severity: 'warning', message: `${comp.ref}${unitLetter(partOf(project, comp), sym.unit)} fields overlap ${r.overlapWith || 'something'}. Move parts apart, drag the field, or pick another Field style.`, sheetId: sheet.id, at: [r.items[0].x, r.items[0].y], items: [sym.id] });
      }
    }
  }

  const sheetOrder = new Map(project.schematic.sheets.map((s, i) => [s.id, i]));
  const rank = { error: 0, warning: 1, info: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity] || sheetOrder.get(a.sheetId) - sheetOrder.get(b.sheetId) || compareRefs(a.message, b.message));
}

function labelsOf(project, net) {
  if (!net.labels) return [];
  const want = new Set(net.labels);
  return project.schematic.sheets.flatMap((s) => (s.labels || []).filter((l) => want.has(l.id)).map((l) => ({ ...l, sheet: s })));
}

/**
 * The ERC card's filter: which severities to show, and a search over the parts and nets each
 * violation involves. A query matches a Reference designator or Net name that starts with it,
 * regardless of case ("r1" finds R1 and R10, "u1a" finds U1A, "vc" finds VCC).
 */
export function filterViolations(list, { severities = ['error', 'warning', 'info'], query = '' } = {}) {
  const q = String(query).trim().toLowerCase();
  return list.filter((v) => severities.includes(v.severity)
    && (!q || [...v.refs, ...v.nets].some((x) => String(x).toLowerCase().startsWith(q) || String(x).toLowerCase().replace(/^.*\//, '').startsWith(q))));
}
