// Tracks follow what they're joined to (#100, #96 E6, E8): after footprints move, rotate or flip,
// or a group of copper moves, the end of every other track that sat on a moved pad, a moved via
// or a moved track end goes with it, so connections stay made. In Free mode the track stretches
// at any angle; in Shove and Walkaround it's redrawn from its far end with the bend style. A
// locked track stays where it is (the connection breaks, the airwire shows it). DOM-free.
import { placedPads, padNets } from './footprint.js';
import { withEnds } from './trackGeom.js';
import { pathTracks, pathFor } from './drag.js';
import { shove, fixedItems } from './shove.js';
import { copperIndex } from './collision.js';
import { copperLayerNames } from './board.js';
import { trackPoints } from './trackGeom.js';

const key = (p) => `${p[0]},${p[1]}`;
const eq = (p, q) => p[0] === q[0] && p[1] === q[1];

/** A footprint's placement as a function, and its inverse (world -> footprint coordinates). */
function placement(bf) {
  const t = ((bf.rot || 0) * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t), m = bf.side === 'B' ? -1 : 1;
  return {
    to: ([x, y]) => { const lx = x * m; return [Math.round(bf.at[0] + lx * c + y * s), Math.round(bf.at[1] - lx * s + y * c)]; },
    from: ([X, Y]) => { const dx = X - bf.at[0], dy = Y - bf.at[1]; return [(dx * c - dy * s) * m, dx * s + dy * c]; },
  };
}

/** Is `p` on pad `pad` (its copper), on copper layer `layer`? */
function onPad(pad, p, layer) {
  if (!(pad.layers.includes(layer) || pad.layers.includes('*.Cu'))) return false;
  const t = (-pad.rot * Math.PI) / 180, dx = p[0] - pad.at[0], dy = p[1] - pad.at[1];
  const lx = dx * Math.cos(t) - dy * Math.sin(t), ly = dx * Math.sin(t) + dy * Math.cos(t);
  return Math.abs(lx) <= pad.size[0] / 2 + 1 && Math.abs(ly) <= pad.size[1] / 2 + 1;
}

/**
 * After an edit (`before`: { footprints, tracks, vias } as they were), bring along the tracks
 * joined to what moved. `style`: STRETCH ({ free: true }) or a bend style ({ corner, posture }).
 * Changes project.board.tracks in place. Returns { changed (the reshaped tracks), kept (locked
 * tracks left behind) }.
 */
export function followMoves(project, before, style = { free: true }) {
  const board = project.board;
  const nets = padNets(board);
  const oldFps = new Map((before.footprints || []).map((f) => [f.id, f]));
  // pads that moved: where each was, and how a point on it maps to where it is now
  const pads = [];
  for (const bf of board.footprints || []) {
    const ob = oldFps.get(bf.id);
    if (!ob || (eq(ob.at, bf.at) && (ob.rot || 0) === (bf.rot || 0) && (ob.side || 'F') === (bf.side || 'F'))) continue;
    const oldP = placement(ob), newP = placement(bf);
    for (const pad of placedPads({ ...project, board: { ...board, footprints: before.footprints } }, ob, nets)) pads.push({ pad, map: (p) => newP.to(oldP.from(p)) });
  }
  // copper that moved: its old ends (per layer) and vias
  const oldTracks = new Map((before.tracks || []).map((t) => [t.id, t]));
  const ends = new Map(); // `${layer}|x,y` -> new point
  for (const t of board.tracks || []) {
    const o = oldTracks.get(t.id);
    if (!o || (eq(o.a, t.a) && eq(o.b, t.b))) continue;
    if (!eq(o.a, t.a)) ends.set(`${t.layer}|${key(o.a)}`, t.a);
    if (!eq(o.b, t.b)) ends.set(`${t.layer}|${key(o.b)}`, t.b);
  }
  const oldVias = new Map((before.vias || []).map((v) => [v.id, v]));
  const vias = new Map();
  for (const v of board.vias || []) { const o = oldVias.get(v.id); if (o && !eq(o.at, v.at)) vias.set(key(o.at), v.at); }
  if (!pads.length && !ends.size && !vias.size) return { changed: [], kept: 0 };
  const whereTo = (t, p) => vias.get(key(p)) || ends.get(`${t.layer}|${key(p)}`) || pads.find((q) => onPad(q.pad, p, t.layer))?.map(p) || null;
  const out = [], changed = [];
  let kept = 0;
  for (const t of board.tracks || []) {
    const o = oldTracks.get(t.id);
    // only tracks the edit didn't move themselves
    if (!o || !eq(o.a, t.a) || !eq(o.b, t.b)) { out.push(t); continue; }
    const na = whereTo(t, t.a), nb = whereTo(t, t.b);
    if (!na && !nb) { out.push(t); continue; }
    if (t.locked) { kept++; out.push(t); continue; }
    if ((na && nb) || style.free || t.mid) {
      const m = withEnds(t, na || t.a, nb || t.b);
      out.push(m); changed.push(m);
      continue;
    }
    // redrawn from its far (unmoved) end with the bend style
    const far = na ? t.b : t.a, to = na || nb;
    const pieces = pathTracks(t, far, pathFor(far, to, style), true);
    out.push(...pieces); changed.push(...pieces);
  }
  board.tracks = out;
  return { changed, kept };
}

/**
 * Shove mode: push other nets' tracks and vias clear of copper an edit changed (`changed`).
 * Pads, drawings and locked copper never move; when the push can't be done, nothing is pushed
 * (DRC reports the clash). Changes project.board in place; returns how many tracks moved.
 */
export function pushClear(project, changed) {
  if (!changed.length) return 0;
  const board = project.board;
  const index = copperIndex(project);
  const pushers = changed.flatMap((s) => { const pts = trackPoints(s, 20_000); return pts.slice(1).map((b, i) => ({ a: pts[i], b, r: s.width / 2, layers: [s.layer], net: s.net, kind: 'track', owner: s.id })); });
  const res = shove(board, pushers, { fixed: fixedItems(index), copper: copperLayerNames(board.stack.copper) });
  if (!res.ok) return 0;
  board.tracks = res.tracks; board.vias = res.vias;
  return res.moved.size;
}
