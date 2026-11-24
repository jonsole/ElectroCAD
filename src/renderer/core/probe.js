// Cross-probing (#18): what is selected in one editor, as Components and Nets, and what that
// means in the other. DOM-free. A probe is { components: Set<componentId>, nets: Set<lower-case
// Net name> }; Net names match regardless of case (ADR-0013).
import { buildNetlist } from './netlist.js';
import { padNets } from './footprint.js';

export const emptyProbe = () => ({ components: new Set(), nets: new Set() });
export const probeIsEmpty = (p) => !p || (!p.components.size && !p.nets.size);
export const probeKey = (p) => (p ? JSON.stringify([[...p.components].sort(), [...p.nets].sort()]) : '');

/** Schematic selection -> probe: selected Symbols give their Components; selected Wires and labels their Nets. */
export function probeFromSchematic(project, sheet, ids, netlist = null) {
  const probe = emptyProbe();
  const sel = new Set(ids);
  for (const y of sheet.symbols) if (sel.has(y.id)) probe.components.add(y.componentId);
  const wires = sheet.wires.filter((w) => sel.has(w.id)).map((w) => w.id);
  const labels = (sheet.labels || []).filter((l) => sel.has(l.id)).map((l) => l.id);
  if (wires.length || labels.length) {
    for (const n of (netlist || buildNetlist(project)).nets) {
      if (n.wires?.some((w) => wires.includes(w)) || n.labels?.some((l) => labels.includes(l))) probe.nets.add(n.name.toLowerCase());
    }
  }
  return probe;
}

/** Board selection -> probe: selected Footprints give their Components; `nets` (e.g. a pad's) are added as they are. */
export function probeFromBoard(project, fpIds, nets = []) {
  const probe = emptyProbe();
  for (const f of project.board.footprints) if (fpIds.includes(f.id)) probe.components.add(f.componentId);
  for (const n of nets) if (n) probe.nets.add(n.toLowerCase());
  return probe;
}

/** What to highlight on a Sheet for a probe: its Symbols of the Components, and the Wires and labels of the Nets. */
export function schematicTargets(project, sheet, probe, netlist = null) {
  const ids = new Set();
  if (probeIsEmpty(probe)) return ids;
  for (const y of sheet.symbols) if (probe.components.has(y.componentId)) ids.add(y.id);
  if (probe.nets.size) {
    const here = new Set([...sheet.wires.map((w) => w.id), ...(sheet.labels || []).map((l) => l.id)]);
    for (const n of (netlist || buildNetlist(project)).nets) {
      if (!probe.nets.has(n.name.toLowerCase())) continue;
      for (const id of [...(n.wires || []), ...(n.labels || [])]) if (here.has(id)) ids.add(id);
    }
  }
  return ids;
}

/**
 * What to highlight on the Board: whole Footprints of the Components, and the Pads (and later
 * Tracks, Vias and Zones) of the Nets. Returns { footprints: Set<id>, pads: Set<"componentId:pad">, copper: Set<id> }.
 */
export function boardTargets(project, probe) {
  const out = { footprints: new Set(), pads: new Set(), copper: new Set() };
  if (probeIsEmpty(probe)) return out;
  const b = project.board;
  for (const f of b.footprints) if (probe.components.has(f.componentId)) out.footprints.add(f.id);
  if (probe.nets.size) {
    for (const [k, net] of padNets(b)) if (probe.nets.has(net.toLowerCase())) out.pads.add(k);
    for (const x of [...(b.tracks || []), ...(b.vias || []), ...(b.zones || [])]) if (x.net && probe.nets.has(x.net.toLowerCase())) out.copper.add(x.id);
  }
  return out;
}

/** Which Sheet shows most of a probe (to switch to it when the probe is on another Sheet). */
export function sheetForProbe(project, probe, netlist = null) {
  let best = null, bn = 0;
  const nl = netlist || buildNetlist(project);
  for (const s of project.schematic.sheets) {
    const n = schematicTargets(project, s, probe, nl).size;
    if (n > bn) { bn = n; best = s; }
  }
  return best;
}
