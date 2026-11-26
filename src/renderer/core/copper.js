// Editing Tracks and Vias (#21): the whole connection a piece of copper belongs to, width and
// layer edits, standalone Vias that take the Net of what they land on. DOM-free.
import { shove, fixedItems } from './shove.js';
import { copperIndex } from './collision.js';
import { copperLayerNames } from './board.js';
import { nearestOnTrack } from './trackGeom.js';
import { placedPads, padNets } from './footprint.js';
import { newVia } from './router.js';

const same = (a, b) => a[0] === b[0] && a[1] === b[1];

/**
 * The connection the copper `ids` belong to: every Track and Via joined to them end to end (on
 * the same layer, or through a Via), stopping at pads. Returns a Set of ids.
 */
export function connection(board, ids) {
  const tracks = board.tracks || [], vias = board.vias || [];
  const out = new Set(ids);
  const queue = [...ids];
  while (queue.length) {
    const id = queue.pop();
    const t = tracks.find((x) => x.id === id), v = !t && vias.find((x) => x.id === id);
    const ends = t ? [t.a, t.b] : v ? [v.at] : [];
    for (const e of ends) {
      for (const u of tracks) if (!out.has(u.id) && (same(u.a, e) || same(u.b, e)) && (!t || u.layer === t.layer || vias.some((w) => same(w.at, e)))) { out.add(u.id); queue.push(u.id); }
      for (const w of vias) if (!out.has(w.id) && same(w.at, e)) { out.add(w.id); queue.push(w.id); }
    }
  }
  return out;
}

/** Set the width of Tracks (ids). */
export function setTrackWidth(project, ids, width) {
  if (!(width > 0)) throw new RangeError('A track needs a width above zero.');
  for (const t of project.board.tracks) if (ids.includes(t.id)) t.width = Math.round(width);
}

/** Move Tracks (ids) to another copper layer. */
export function setTrackLayer(project, ids, layer) {
  for (const t of project.board.tracks) if (ids.includes(t.id)) t.layer = layer;
}

export function setViaSize(project, ids, { drill, diameter }) {
  for (const v of project.board.vias) if (ids.includes(v.id)) {
    const d = drill ?? v.drill, D = diameter ?? v.diameter;
    if (!(d > 0 && D > d)) throw new RangeError('A via needs a drill, and a diameter bigger than its drill.');
    v.drill = d; v.diameter = D;
  }
}

/** The Net at `at`: a Track or Via there, else a pad, else none (''). */
export function netAt(project, at, tol = 0) {
  const b = project.board;
  const t = (b.tracks || []).find((x) => nearestOnTrack(x, at).d <= x.width / 2 + tol);
  if (t) return t.net;
  const v = (b.vias || []).find((x) => Math.hypot(at[0] - x.at[0], at[1] - x.at[1]) <= x.diameter / 2 + tol);
  if (v) return v.net;
  const nets = padNets(b);
  for (const bf of b.footprints) for (const p of placedPads(project, bf, nets)) if (Math.abs(at[0] - p.at[0]) <= p.size[0] / 2 + tol && Math.abs(at[1] - p.at[1]) <= p.size[1] / 2 + tol) return p.net;
  return '';
}

/** A standalone Via at `at`, taking the Net of what it lands on. Returns it. */
export function placeVia(project, at, tol = 0, opts = {}) { return placeViaPushing(project, at, tol, opts).via; }

/**
 * Place a Via (as placeVia); in Shove mode (`shove`, #30) it first pushes other Nets' Tracks and
 * Vias aside on every layer. Returns { via, pushed: how many moved (-1: too crowded to push) }.
 */
export function placeViaPushing(project, at, tol = 0, { shove: pushing = false } = {}) {
  const v = newVia(project, at, netAt(project, at, tol));
  let pushed = 0;
  if (pushing) {
    const board = project.board, all = copperLayerNames(board.stack.copper);
    const r = shove(board, [{ a: v.at, b: v.at, r: v.diameter / 2, layers: all, net: v.net, kind: 'via' }], { fixed: fixedItems(copperIndex(project)), copper: all });
    pushed = r.ok ? r.moved.size + r.movedVias.size : -1;
    if (r.ok) { board.tracks = r.tracks; board.vias = r.vias; }
  }
  project.board.vias.push(v);
  return { via: v, pushed };
}
