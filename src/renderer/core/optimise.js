// Track optimisation (#104, #96 T1-T8), as Eagle's "optimizing": tidy redundant copper left by
// routing and editing. At a free join (two track ends meeting on a layer with no other track, no
// via and no pad there) two segments of one net, layer and width become one when they run on in a
// straight line (T3), fold back on themselves (T5: the spike goes) or are arcs of one circle
// turning the same way (T6); zero-length segments go (T4). Locked tracks are left alone (T7).
// DOM-free.
import { placedPads, padNets } from './footprint.js';
import { trackArc } from './trackGeom.js';

const eq = (p, q) => p[0] === q[0] && p[1] === q[1];
const key = (layer, p) => `${layer}|${p[0]},${p[1]}`;
const TAU = 2 * Math.PI;

/** Is `p` on segment a-b's line (within 1 nm per mm of its length)? */
const inLine = (a, b, p) => Math.abs((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) <= Math.hypot(b[0] - a[0], b[1] - a[1]) * 1;

/**
 * Merge two tracks meeting at their free join `P` into one, or null when they can't be: `t`
 * ends at P, so does `u`.
 */
function merge(t, u, P) {
  if (t.net !== u.net || t.layer !== u.layer || t.width !== u.width || t.locked || u.locked) return null;
  const A = eq(t.a, P) ? t.b : t.a, B = eq(u.a, P) ? u.b : u.a;
  if (!t.mid && !u.mid) {
    if (!inLine(A, P, B)) return null;
    // straight on (T3) or folded back (T5): either way one segment from A to B carries the joint
    if (eq(A, B)) return { remove: true };
    return { a: A, b: B };
  }
  if (t.mid && u.mid) {
    // T6: arcs of one circle, turning the same way
    const k1 = trackArc({ a: A, mid: t.mid, b: P }), k2 = trackArc({ a: P, mid: u.mid, b: B });
    if (!k1 || !k2) return null;
    if (Math.hypot(k1.c[0] - k2.c[0], k1.c[1] - k2.c[1]) > 1000 || Math.abs(k1.r - k2.r) > 1000) return null;
    if (Math.sign(k1.sweep) !== Math.sign(k2.sweep)) return null;
    const sweep = k1.sweep + k2.sweep;
    if (Math.abs(sweep) >= TAU - 1e-3) return null; // a whole circle can't be one arc
    const m = k1.a0 + sweep / 2;
    return { a: A, b: B, mid: [Math.round(k1.c[0] + k1.r * Math.cos(m)), Math.round(k1.c[1] + k1.r * Math.sin(m))] };
  }
  return null;
}

/**
 * Optimise the Board's Tracks in place. `scope`: the ids of the Tracks an edit touched (only joins
 * at their ends are looked at), or null for every Track. Returns how many Tracks went.
 */
export function optimiseTracks(project, board = project.board, scope = null) {
  const tracks = board.tracks || [];
  const before = tracks.length;
  // where a join isn't free: vias (every layer) and pads (on their layers)
  const vias = new Set((board.vias || []).map((v) => `${v.at[0]},${v.at[1]}`));
  const nets = padNets(board), view = { ...project, board };
  const padKeys = new Set();
  for (const bf of board.footprints || []) for (const pad of placedPads(view, bf, nets)) {
    for (const l of pad.layers) padKeys.add(l === '*.Cu' ? `*|${pad.at[0]},${pad.at[1]}` : key(l, pad.at));
  }
  const fixed = (layer, p) => vias.has(`${p[0]},${p[1]}`) || padKeys.has(key(layer, p)) || padKeys.has(`*|${p[0]},${p[1]}`);
  let list = tracks.slice();
  // T4: zero length
  list = list.filter((t) => t.locked || !eq(t.a, t.b) || (scope && !scope.has(t.id)));
  const live = new Set(scope ? [...scope] : list.map((t) => t.id));
  for (let pass = 0; pass < 1000; pass++) {
    // the track ends at each point, per layer
    const ends = new Map();
    for (const t of list) for (const p of [t.a, t.b]) { const k = key(t.layer, p); if (!ends.has(k)) ends.set(k, []); ends.get(k).push(t); }
    let done = false;
    for (const t of list) {
      if (!live.has(t.id)) continue;
      for (const P of [t.a, t.b]) {
        const here = ends.get(key(t.layer, P));
        if (here.length !== 2 || fixed(t.layer, P)) continue;
        const u = here.find((x) => x !== t);
        if (!u || u === t) continue;
        const m = merge(t, u, P);
        if (!m) continue;
        list = list.filter((x) => x !== t && x !== u);
        if (!m.remove) {
          const n = { ...t, a: m.a, b: m.b };
          delete n.mid;
          if (m.mid) n.mid = m.mid;
          list.push(n);
          live.add(n.id);
        }
        done = true;
        break;
      }
      if (done) break;
    }
    if (!done) break;
  }
  board.tracks = list;
  return before - list.length;
}
