// The Zone fill worker (#23): fills the Zones it is sent off the main thread, so the editor never
// blocks. Messages: { seq, input, ids, known } -> { seq, fills: [[id, fill]] } (core/zones.js).
import { fillZones } from '../core/zones.js';

self.onmessage = (e) => {
  const { seq, input, ids, known } = e.data;
  try {
    self.postMessage({ seq, fills: [...fillZones(input, ids, new Map(known))] });
  } catch (err) {
    self.postMessage({ seq, error: String(err?.message || err), ids });
  }
};
