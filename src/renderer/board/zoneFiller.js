// Zone refill scheduling (#23). After each committed edit the editor calls update(project): the
// Zones whose signature changed (core/zones.js zoneSignatures: their outline, settings, and the
// copper, Outline and higher-priority Zones they depend on) are sent to the Web Worker to refill;
// the rest keep their fills. Results come back tagged with the request's number, and a result
// that a newer request has superseded is thrown away. whenFilled() resolves once nothing is
// pending, for DRC and export. Without Worker support (tests, odd hosts) the fill runs on a timer.
// A Zone depends only on Zones on its own layer, so each layer's Zones go to a worker of their own
// and the layers fill in parallel (#73).
import { zoneInput, zoneSignatures, fillZones } from '../core/zones.js';

const FADE_MS = 150; // a refill fades in this quickly
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

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
    this.workers = new Map(); // layer -> Worker
    this.noWorkers = false;   // a worker couldn't be made or failed: fill on the main thread
    this.fading = new Map();  // zone id -> { old fill (null: none), start }: refills fade in
  }

  _worker(layer) {
    if (this.noWorkers) return null;
    if (this.workers.has(layer)) return this.workers.get(layer);
    let w = null;
    try {
      w = this.makeWorker();
      if (w) {
        w.onmessage = (e) => this._done(e.data);
        w.onerror = (e) => { console.warn('Zone fill worker failed; filling on the main thread.', e?.message || e); this._dropWorkers(); this._resend(); };
      }
    } catch (e) { console.warn('No Zone fill worker; filling on the main thread.', e?.message || e); w = null; }
    if (!w) { this.noWorkers = true; return null; }
    this.workers.set(layer, w);
    return w;
  }

  _dropWorkers() {
    for (const w of this.workers.values()) { try { w.terminate(); } catch { /* gone */ } }
    this.workers.clear();
    this.noWorkers = true;
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

  /** Send a request as one message per layer (each with that layer's Zones, fills and copper). */
  _send(msg) {
    const layerOf = new Map(msg.input.zones.map((z) => [z.id, z.layer]));
    const layers = [...new Set(msg.ids.map((id) => layerOf.get(id)))];
    for (const layer of layers) {
      const part = {
        seq: msg.seq,
        // only the copper that layer's fill looks at: its Tracks and pads (and holes), and the Vias
        // (every Zone still goes: the clearance margin is the largest any Zone asks for)
        input: { ...msg.input, tracks: msg.input.tracks.filter((t) => t.layer === layer), pads: msg.input.pads.filter((q) => !q.layers.length || q.layers.includes(layer)) },
        ids: msg.ids.filter((id) => layerOf.get(id) === layer),
        known: msg.known.filter(([id]) => layerOf.get(id) === layer),
      };
      const w = this._worker(layer);
      if (w) { w.postMessage(part); continue; }
      setTimeout(() => this._done({ seq: part.seq, fills: [...fillZones(part.input, part.ids, new Map(part.known))] }), 0);
    }
  }

  /** The worker died: fill the latest request here instead. */
  _resend() { if (this.last && this.pending.size) this._send(this.last); }

  _done({ seq, fills, error, ids }) {
    if (error) {
      console.warn('Zone fill failed:', error);
      const failed = new Set(ids || []);
      for (const [id, p] of [...this.pending]) if (p.seq === seq && (!ids || failed.has(id))) this.pending.delete(id);
      this._settle(); return;
    }
    let any = false;
    for (const [id, f] of fills || []) {
      const p = this.pending.get(id);
      if (!p || p.seq !== seq) continue; // superseded by a newer request
      this.fading.set(id, { old: this.fills.get(id) || null, start: now() });
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

  /**
   * The refills fading in (#105): id -> { old, t } with t from 0 to 1 over `ms`; finished ones are
   * dropped. Empty when nothing is fading.
   */
  fade(ms = FADE_MS) {
    const out = new Map(), t0 = now();
    for (const [id, f] of [...this.fading]) {
      const t = Math.min(1, (t0 - f.start) / ms);
      if (t >= 1 || !this.fills.has(id)) this.fading.delete(id); else out.set(id, { old: f.old, t });
    }
    return out;
  }
}
