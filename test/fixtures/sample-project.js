// A small Project that uses every part of the Native format written today: two Sheets, three
// kinds of Part, Wires, every kind of label, a pinned field, an MPN, a custom field, a
// per-Component Field style and a non-preferred (embedded) Footprint. Used by the format tests
// and by tools/write-format-example.js to produce docs/formats/example.ecad.
import { newProject, newSheet, addComponent } from '../../src/renderer/core/project.js';
import { addWire, addLabel, addDrawing } from '../../src/renderer/core/schematic.js';
import { drawingDefaults } from '../../src/renderer/core/drawings.js';
import { updateComponent } from '../../src/renderer/core/components.js';
import { pinField, setComponentFieldStyle, BUILTIN_FIELD_STYLES } from '../../src/renderer/core/fields.js';
import { RESISTOR, CAPACITOR, LED } from '../../src/renderer/library/mini.js';
import { SCH_GRID as G } from '../../src/renderer/core/units.js';
import { pinPositions } from '../../src/renderer/core/project.js';

export function sampleProject() {
  const p = newProject('LED indicator');
  const [s1] = p.schematic.sheets;
  s1.name = 'Power';
  const s2 = newSheet('Indicator');
  p.schematic.sheets.push(s2);
  const pin = (sym, n) => pinPositions(p, sym).find((x) => x.pin.number === n).at;

  // Sheet 1: a decoupling capacitor between +3V3 and GND
  const c1 = addComponent(p, s1, CAPACITOR, [G * 20, G * 20], { rot: 90 });
  const [c1a, c1b] = [pin(c1.sym, '1'), pin(c1.sym, '2')].sort((a, b) => a[1] - b[1]);
  addLabel(p, s1, { at: c1a, net: '+3V3', style: 'power' });
  addLabel(p, s1, { at: c1b, net: 'GND', style: 'gnd' });

  // Sheet 2: +3V3 -> R1 -> D1 -> GND, with a Global label on the R1-D1 net
  const r1 = addComponent(p, s2, RESISTOR, [G * 20, G * 20]);
  const d1 = addComponent(p, s2, LED, [G * 32, G * 20]);
  addLabel(p, s2, { at: pin(r1.sym, '1'), net: '+3V3', style: 'power' });
  addWire(p, s2, [pin(r1.sym, '2'), pin(d1.sym, '2')]);
  addLabel(p, s2, { at: [G * 26, G * 20], net: 'LED_A', scope: 'global' });
  addLabel(p, s2, { at: pin(d1.sym, '1'), net: 'GND', style: 'gnd', rot: 0 });
  addLabel(p, s2, { at: [G * 26, G * 30], net: 'SPARE', rot: 180 });

  updateComponent(p, r1.comp.id, { value: '330', mpn: { manufacturer: 'Yageo', number: 'RC0805FR-07330RL' }, fields: { Tolerance: '1%' } });
  updateComponent(p, d1.comp.id, { footprint: { library: 'User', footprint: { name: 'LED_1206', pads: [
    { number: '1', at: [-1_600_000, 0], shape: 'roundrect', size: [1_000_000, 1_700_000], layers: ['F.Cu', 'F.Paste', 'F.Mask'] },
    { number: '2', at: [1_600_000, 0], shape: 'roundrect', size: [1_000_000, 1_700_000], layers: ['F.Cu', 'F.Paste', 'F.Mask'] }] } } });
  setComponentFieldStyle(p, [d1.comp.id], BUILTIN_FIELD_STYLES.find((s) => s.id === 'rkm'));
  pinField(p, r1.sym.id, 'value', [G * 20, G * 23]);

  // markup, the title block and paper sizes (#59)
  p.titleBlock = { title: 'LED indicator', company: 'Example Ltd', author: 'A. Designer', revision: 'B', date: '2026-11-24', comment: 'Sample for docs/formats' };
  s2.paper = { size: 'A3', orientation: 'portrait' };
  addDrawing(p, s1, { type: 'text', at: [G * 10, G * 8], text: '${TITLE}: power\nDecoupling next to U1', ...drawingDefaults('text'), bold: true });
  addDrawing(p, s1, { type: 'rect', a: [G * 8, G * 10], b: [G * 32, G * 30], ...drawingDefaults('rect') });
  addDrawing(p, s2, { type: 'line', pts: [[G * 40, G * 14], [G * 33, G * 19]], ...drawingDefaults('line'), arrowEnd: true });
  addDrawing(p, s2, { type: 'circle', c: [G * 26, G * 20], r: G * 3, ...drawingDefaults('circle'), style: 'dotted' });
  addDrawing(p, s2, { type: 'arc', start: [G * 18, G * 26], mid: [G * 20, G * 28], end: [G * 22, G * 26], ...drawingDefaults('arc') });
  return p;
}

/** Rename random ids to short readable ones (p1, s1, c1…) so the example reads well and stays stable. */
export function readableIds(project) {
  let text = JSON.stringify(project);
  const counts = {};
  const seen = new Map();
  const visit = (v) => {
    if (Array.isArray(v)) return v.forEach(visit);
    if (v && typeof v === 'object') {
      if (typeof v.id === 'string' && /^[pscylwnd][0-9a-z]{8,}$/.test(v.id) && !seen.has(v.id)) {
        const k = v.id[0];
        counts[k] = (counts[k] || 0) + 1;
        seen.set(v.id, `${k}${counts[k]}`);
      }
      Object.values(v).forEach(visit);
    }
  };
  visit(project);
  for (const [from, to] of seen) text = text.split(`"${from}"`).join(`"${to}"`);
  return JSON.parse(text);
}
