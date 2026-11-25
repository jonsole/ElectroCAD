// Eagle 6+ / Fusion Electronics import (#36): .sch and/or .brd XML -> an ElectroCAD Project, with a
// loss report. Formats other than ElectroCAD's own are lossy converters (ADR-0004): what can't be
// carried over is said, not guessed.
import { parseXml } from '../xml.js';
import { newProject } from '../../core/project.js';
import { Report } from './common.js';
import { importEagleSchematic } from './schematic.js';
import { importEagleBoard } from './board.js';

/** Which Eagle file a text is: 'sch' | 'brd' | 'lbr' | null. */
export function eagleKind(text) {
  if (!/<eagle[\s>]/.test(text.slice(0, 4000))) return null;
  if (/<schematic[\s>]/.test(text)) return 'sch';
  if (/<board[\s>]/.test(text)) return 'brd';
  if (/<library[\s>]/.test(text)) return 'lbr';
  return null;
}

/**
 * Import an Eagle schematic and/or board. Returns { project, report: [text], check } where check
 * says how the Schematic's Netlist compares with Eagle's nets ({ ok, mismatches }) and which board
 * signals don't match the Schematic.
 */
export { importLog, eagleVersion, drcLines } from './log.js';

export function importEagle({ sch = null, brd = null, name = 'Imported from Eagle' } = {}) {
  if (!sch && !brd) throw new Error('Choose an Eagle .sch and/or .brd file.');
  const report = new Report();
  let project, eagle = null, verify = { ok: true, mismatches: [] };
  if (sch) {
    const r = importEagleSchematic(parseXml(sch), { name, report });
    project = r.project; eagle = r.eagle;
    verify = r.verify();
  } else project = newProject(name);
  let board = { mismatched: [] };
  if (brd) board = importEagleBoard(parseXml(brd), project, { report, eagle });
  return { project, report: report.list(), check: { schematic: verify, signals: board.mismatched || [], signalDetails: board.details || [] } };
}
