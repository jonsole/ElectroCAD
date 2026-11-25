// Sheet references (#76): the other Sheets a Global label's Net continues on, from the Netlist, so
// they follow every edit. DOM-free.
import { buildNetlist } from './netlist.js';
import { showsRefs } from './labels.js';

/**
 * For every label that shows sheet references (showsRefs): label id -> the 1-based numbers of the
 * other Sheets its Net is on (has a Wire or a label there), in order. `netlist` may be passed in.
 */
export function sheetRefs(project, netlist = buildNetlist(project)) {
  const sheets = project.schematic.sheets;
  const sheetOfLabel = new Map(), sheetOfWire = new Map();
  sheets.forEach((s, i) => { for (const l of s.labels || []) sheetOfLabel.set(l.id, i); for (const w of s.wires || []) sheetOfWire.set(w.id, i); });
  const byLabel = new Map();
  for (const n of netlist.nets) {
    if (!n.labels?.length) continue;
    const on = new Set([...n.labels.map((id) => sheetOfLabel.get(id)), ...(n.wires || []).map((id) => sheetOfWire.get(id))].filter((i) => i !== undefined));
    for (const id of n.labels) byLabel.set(id, on);
  }
  const out = new Map();
  sheets.forEach((s, i) => {
    for (const l of s.labels || []) {
      if (!showsRefs(project, l)) continue;
      const on = byLabel.get(l.id);
      out.set(l.id, on ? [...on].filter((k) => k !== i).sort((a, b) => a - b).map((k) => k + 1) : []);
    }
  });
  return out;
}
