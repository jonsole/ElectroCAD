// The import log (#36): a plain-text record of one Eagle import, to keep or to paste into an issue.
// What came in, how the Netlist and the board's signals compare with Eagle's, everything that
// wasn't carried over or was changed, and (once the Zones have filled) what DRC finds. Pure:
// the editor adds the DRC part when it has it.
import { DRC_RULES } from '../../core/drc.js';

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const kb = (n) => (n < 1024 ? `${n} B` : `${Math.round(n / 1024).toLocaleString('en-GB')} kB`);
/** The Eagle version a file was saved with ("7.7.0"), or ''. */
export const eagleVersion = (text) => (/<eagle\b[^>]*\bversion="([^"]+)"/.exec(String(text).slice(0, 4000)) || [])[1] || '';

/** A count of DRC results by check, and the first few of each: lines for the log. */
export function drcLines(violations, perRule = 10) {
  if (!violations) return ['DRC: not run yet (it runs once the Zones have filled).'];
  if (!violations.length) return ['DRC: no problems.'];
  const out = [`DRC: ${plural(violations.filter((v) => v.severity === 'error').length, 'error')}, ${plural(violations.filter((v) => v.severity === 'warning').length, 'warning')}. Positions are Eagle's (mm, Y up).`];
  for (const [rule, label] of DRC_RULES) {
    const vs = violations.filter((v) => v.rule === rule);
    if (!vs.length) continue;
    out.push(`  ${label}: ${vs.length}`);
    for (const v of vs.slice(0, perRule)) out.push(`    - ${v.at ? `(${(v.at[0] / 1e6).toFixed(3)}, ${(-v.at[1] / 1e6).toFixed(3)}) ` : ''}${v.message}`);
    if (vs.length > perRule) out.push(`    - … and ${vs.length - perRule} more`);
  }
  return out;
}

/**
 * The log as text. `r`: importEagle's result; `files`: { sch, brd } as { name, text };
 * `app`: { version, build }; `date`: a Date; `drc`: DRC results or null.
 */
export function importLog(r, { files = {}, app = {}, date = new Date(), drc = undefined } = {}) {
  const p = r.project, b = p.board, nl = r.check.schematic.netlist;
  const L = [];
  L.push('ElectroCAD import log', '=====================');
  L.push(`ElectroCAD ${app.version || '?'}${app.build ? ` (${app.build})` : ''} · ${date.toISOString().replace('T', ' ').slice(0, 16)} UTC`);
  for (const k of ['sch', 'brd']) {
    const f = files[k];
    if (f) L.push(`${k === 'sch' ? 'Schematic' : 'Board'}: ${f.name} (Eagle ${eagleVersion(f.text) || '?'}, ${kb(f.text.length)})`);
  }
  L.push(`Project: ${p.name}`, '');
  L.push('What came in', '------------');
  if (files.sch) L.push(`Schematic: ${plural(p.schematic.sheets.length, 'sheet')}, ${plural(Object.keys(p.components).length, 'part')}, ${plural(nl ? nl.nets.length : 0, 'net')}${nl?.unconnected?.length ? `, ${plural(nl.unconnected.length, 'unconnected pin')}` : ''}`);
  if (files.brd) {
    L.push(`Board: ${b.stack.copper}-layer, ${plural(b.footprints.length, 'footprint')} (${b.footprints.filter((f) => f.side === 'B').length} on the bottom, ${b.footprints.filter((f) => f.locked).length} locked), ${plural(b.tracks.length, 'track segment')}, ${plural(b.vias.length, 'via')}, ${plural(b.zones.length, 'zone')}, ${plural((b.outline || []).length, 'outline shape')}`);
    const nc = Object.keys(b.netClasses || {});
    L.push(`Rules: clearance ${(b.rules.clearance / 1e6).toFixed(3)} mm, track ${(b.rules.trackWidth / 1e6).toFixed(3)} mm, via ${(b.rules.viaDrill / 1e6).toFixed(3)}/${(b.rules.viaDiameter / 1e6).toFixed(3)} mm${nc.length ? `; Net classes: ${nc.join(', ')}` : ''}`);
  }
  L.push('', 'Checks', '------');
  if (files.sch) {
    const s = r.check.schematic;
    L.push(s.ok ? '[ok] The Netlist matches Eagle\'s nets, pin for pin (nothing split, nothing joined).' : `[!!] ${plural(s.mismatches.length, 'net difference')} from Eagle's nets:`);
    for (const m of s.mismatches) L.push(`  - ${m}`);
  }
  if (files.brd && files.sch) {
    const d = r.check.signalDetails || [];
    L.push(!r.check.signals.length ? '[ok] Every board signal matches the Schematic\'s nets.' : `[!!] ${plural(r.check.signals.length, 'board signal')} don't match the Schematic:`);
    for (const m of d) L.push(`  - ${m}`);
  }
  L.push(...drcLines(drc === undefined ? null : drc).map((x, i) => (i === 0 ? `${drc && !drc.some((v) => v.severity === 'error') ? '[ok]' : drc ? '[!!]' : '[..]'} ${x}` : x)));
  L.push('', 'Not carried over, or changed', '----------------------------');
  const notes = r.report.filter((t) => !(r.check.schematic.mismatches || []).includes(t) && !(r.check.signalDetails || []).includes(t));
  if (!notes.length) L.push('Nothing.');
  for (const t of notes) L.push(`- ${t}`);
  return L.join('\n') + '\n';
}
