// Zone refill scheduling (#23). After each committed edit the editor calls update(project): the
// Zones whose signature changed (core/zones.js zoneSignatures: their outline, settings, and the
// copper, Outline and higher-priority Zones they depend on) are sent to the Web Worker to refill;
// the rest keep their fills. Results come back tagged with the request's number, and a result
// that a newer request has superseded is thrown away. whenFilled() resolves once nothing is
// pending, for DRC and export. Without Worker support (tests, odd hosts) the fill runs on a timer.
import { zoneInput, zoneSignatures, fillZones } from '../core/zones.js';

export class ZoneFiller {
  /**
   * @param {() => void} onFilled  called when new fills arrive
   * @param {{ worker?: () => Worker | null }} [o]  how to make the worker (null: fill on a timer)
   */
  constructor(onFilled = () => {}, o = {}) {
    this.onFilled = onFilled;
    this.makeWorker = o.worker || (() => new Worker(new URL('./zoneWorker.js', import.meta.url), { type: 'module' }));
    this.fills = new Map();     // zone id -> fill
    this.filledSig = new Map(); // zone id -> the signature its fill was made for
    this.pending = new Map();   // zone id -> { seq, sig }
    this.seq = 0;
    this.waiters = [];
    this.w = undefined;
  }

  _worker() {
    if (this.w !== undefined) return this.w;
    try {
      this.w = this.makeWorker();
      if (this.w) {
        this.w.onmessage = (e) => this._done(e.data);
        this.w.onerror = (e) => { console.warn('Zone fill worker failed; filling on the main thread.', e?.message || e); try { this.w.terminate(); } catch { /* gone */ } this.w = null; this._resend(); };
      }
    } catch (e) { console.warn('No Zone fill worker; filling on the main thread.', e?.message || e); this.w = null; }
    return this.w;
  }

  /** Refill the Zones of `project` that changed since their last fill. Returns the ids sent. */
  update(project, board = project.board) {
    const input = zoneInput(project, board);
    const sigs = zoneSignatures(input);
    for (const id of [...this.fills.keys()]) if (!sigs.has(id)) { this.fills.delete(id); this.filledSig.delete(id); }
    for (const id of [...this.pending.keys()]) if (!sigs.has(id)) this.pending.delete(id);
    const stale = [...sigs].filter(([id, s]) => this.filledSig.get(id) !== s && this.pending.get(id)?.sig !== s).map(([id]) => id);
    if (!stale.length) { this._settle(); return []; }
    // everything not up to date goes in one request (Zones below depend on those above)
    const ids = [...sigs.keys()].filter((id) => this.filledSig.get(id) !== sigs.get(id));
    const seq = ++this.seq;
    for (const id of ids) this.pending.set(id, { seq, sig: sigs.get(id) });
    const known = [...this.fills].filter(([id]) => !ids.includes(id));
    this.last = { seq, input, ids, known };
    this._send(this.last);
    return ids;
  }

  _send(msg) {
    const w = this._worker();
    if (w) { w.postMessage(msg); return; }
    setTimeout(() => this._done({ seq: msg.seq, fills: [...fillZones(msg.input, msg.ids, new Map(msg.known))] }), 0);
  }

  /** The worker died: fill the latest request here instead. */
  _resend() { if (this.last && this.pending.size) this._send(this.last); }

  _done({ seq, fills, error }) {
    if (error) { console.warn('Zone fill failed:', error); for (const [id, p] of [...this.pending]) if (p.seq === seq) this.pending.delete(id); this._settle(); return; }
    let any = false;
    for (const [id, f] of fills || []) {
      const p = this.pending.get(id);
      if (!p || p.seq !== seq) continue; // superseded by a newer request
      this.fills.set(id, f); this.filledSig.set(id, p.sig); this.pending.delete(id);
      any = true;
    }
    if (any) this.onFilled();
    this._settle();
  }

  _settle() {
    if (this.pending.size) return;
    const ws = this.waiters; this.waiters = [];
    for (const r of ws) r();
  }

  /** Resolves once no refill is pending (DRC and export call this before reading the fills). */
  whenFilled() { return this.pending.size ? new Promise((r) => this.waiters.push(r)) : Promise.resolve(); }

  /** Ids of Zones whose fill doesn't match `input` (a board being dragged or routed): drawn as outlines. */
  staleIds(input) {
    const out = new Set();
    for (const [id, s] of zoneSignatures(input)) if (this.filledSig.get(id) !== s) out.add(id);
    return out;
  }

  get busy() { return this.pending.size > 0; }
}
