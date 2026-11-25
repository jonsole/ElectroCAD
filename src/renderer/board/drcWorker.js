// The DRC worker (#85): a full design rule check off the main thread, the safety net behind the
// live re-checks. Messages: { seq, project, fills } -> { seq, list } (core/drc.js).
import { runDrc } from '../core/drc.js';

self.onmessage = (e) => {
  const { seq, project, fills } = e.data;
  try {
    self.postMessage({ seq, list: runDrc(project, new Map(fills)) });
  } catch (err) {
    self.postMessage({ seq, error: String(err?.message || err) });
  }
};
