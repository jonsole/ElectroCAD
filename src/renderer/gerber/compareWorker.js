// The fab comparison worker (#28): reads two sets of fab files and compares them layer by layer
// off the main thread (a 4-layer board takes a few seconds). Messages:
//   { seq, ours: [{ name, text }], theirs: [{ name, text }], res, tol } ->
//   { seq, result: { align, frame, layers: [{ layer, label, ours, theirs, stats, missing, diff }] }, skipped }
import { readFabFiles, compareLayers } from '../core/gerber/compare.js';

self.onmessage = (e) => {
  const { seq, ours, theirs, res, tol } = e.data;
  try {
    const A = readFabFiles(ours), B = readFabFiles(theirs);
    const result = compareLayers(A.layers, B.layers, { res, tol, keepDiff: true });
    const transfer = result.layers.filter((l) => l.diff).map((l) => l.diff.buffer);
    self.postMessage({ seq, result, skipped: B.skipped, theirWarnings: B.layers.flatMap((l) => l.warnings.map((w) => `${l.name}: ${w}`)) }, transfer);
  } catch (err) {
    self.postMessage({ seq, error: String(err?.message || err) });
  }
};
