// Zones (#23): copper pours on a copper layer, filled around other Nets' copper with clipper-lib.
// A Zone stores only its outline and settings (ADR-0015); the fill is computed:
//   1. the outline, inside the Board's Outline less its edge clearance;
//   2. less higher-priority Zones' fills (on the same layer, another Net) by the clearance;
//   3. less other Nets' copper (Tracks, Vias, pads) by the clearance (the Zone's, or the Net
//      classes', whichever is larger);
//   4. same-Net pads join solid, or through thermal reliefs: a gap round the pad crossed by up to
//      four spokes along the pad's axes (a spoke that would break clearance or end in nothing is
//      left out);
//   5. islands that touch none of the Zone's own Net's copper are removed (unless keepIslands).
// Everything here is plain data in, plain data out, so the same code runs in the Web Worker
// (board/zoneWorker.js) and, synchronously, in the tests. DOM-free.
import { copperDrawingTracks } from './boardDrawings.js';
import ClipperLib from 'clipper-lib';
import { placedPads, padNets, padByLayers } from './footprint.js';
import { copperLayerNames, outlineLoops } from './board.js';
import { arcCircle } from './geom.js';
import { padShape, netRules } from './collision.js';
import { uid } from './project.js';

const CL = ClipperLib;
const low = (s) => String(s || '').toLowerCase();
const ARC_TOL = 5_000; // nm: how closely rounded corners follow the circle (their chords cut inside it,
// so keep-outs grow by this much more and the fill never comes closer than the clearance)
const MARGIN = 2 * ARC_TOL; // the extra clearance that keeps chords outside the clearance, with room for rounding

/** Defaults for a new Zone. */
export const ZONE_DEFAULTS = { priority: 0, clearance: 0, connect: 'thermal', thermal: { gap: 500_000, spoke: 500_000 } };

/** A new Zone on `layer` for `net` with the given outline points (at least three). */
export function newZone(layer, net, outline, opts = {}) {
  return { id: uid('z'), layer, net: net || '', outline: outline.map((p) => [Math.round(p[0]), Math.round(p[1])]), priority: opts.priority ?? 0, clearance: opts.clearance ?? 0, connect: opts.connect || 'thermal', thermal: { ...ZONE_DEFAULTS.thermal, ...(opts.thermal || {}) } };
}

// ---------------------------------------------------------------- geometry helpers

const P = (pts) => pts.map(([x, y]) => ({ X: Math.round(x), Y: Math.round(y) }));
const unP = (path) => path.map((q) => [q.X, q.Y]);

function circlePts(c, r, n = 48) {
  return Array.from({ length: n }, (_, i) => [c[0] + r * Math.cos((i / n) * 2 * Math.PI), c[1] + r * Math.sin((i / n) * 2 * Math.PI)]);
}

/** Paths grown (or shrunk, d < 0) by d with round corners. */
function offset(paths, d, open = false, tol = ARC_TOL) {
  if (!paths.length) return [];
  if (!d && !open) return paths;
  const co = new CL.ClipperOffset(2, tol);
  co.AddPaths(paths, CL.JoinType.jtRound, open ? CL.EndType.etOpenRound : CL.EndType.etClosedPolygon);
  const out = new CL.Paths();
  co.Execute(out, d);
  return out;
}

/**
 * A closed outline grown by d (round corners): its outermost ring as points. For outlines drawn
 * with a pen, such as Eagle's polygons, whose copper reaches half the pen's width past the vertices.
 */
export function growOutline(pts, d) {
  if (!d || pts.length < 3) return pts;
  const out = offset([pts.map(([x, y]) => ({ X: Math.round(x), Y: Math.round(y) }))], d);
  if (!out.length) return pts;
  const area = (r) => Math.abs(r.reduce((a, q, i) => { const n = r[(i + 1) % r.length]; return a + q.X * n.Y - n.X * q.Y; }, 0));
  return out.reduce((a, b) => (area(b) > area(a) ? b : a)).map((q) => [q.X, q.Y]);
}

function clip(type, subj, clipPaths, fill = CL.PolyFillType.pftNonZero) {
  const c = new CL.Clipper();
  c.AddPaths(subj, CL.PolyType.ptSubject, true);
  if (clipPaths?.length) c.AddPaths(clipPaths, CL.PolyType.ptClip, true);
  const out = new CL.Paths();
  c.Execute(type, out, fill, fill);
  return out;
}
const union = (a, b = []) => clip(CL.ClipType.ctUnion, a, b);
const diff = (a, b) => (b.length ? clip(CL.ClipType.ctDifference, a, b) : a);
const inter = (a, b) => clip(CL.ClipType.ctIntersection, a, b);
const area = (paths) => paths.reduce((s, p) => s + CL.Clipper.Area(p), 0);

/** A collision-engine shape grown by d, as paths. */
function shapePaths(shape, d) {
  if (shape.type === 'capsule') {
    const r = shape.r + d;
    if (r <= 0) return [];
    if (shape.a[0] === shape.b[0] && shape.a[1] === shape.b[1]) return [P(circlePts(shape.a, r))];
    return offset([P([shape.a, shape.b])], r, true);
  }
  return offset([P(shape.pts)], d);
}

/** The Board's Outline as filled paths (cut-outs as holes), or null when it isn't closed. */
export function boardArea(outline) {
  const loops = outlineLoops(outline || []);
  if (!loops.length) return null;
  const paths = [];
  for (const loop of loops) {
    const pts = [];
    for (const { shape: s, reversed } of loop) {
      let q;
      if (s.type === 'rect') q = [s.a, [s.b[0], s.a[1]], s.b, [s.a[0], s.b[1]]];
      else if (s.type === 'circle') q = circlePts(s.c, s.r, 96);
      else if (s.type === 'line') q = s.pts;
      else if (s.type === 'arc') {
        const c = arcCircle(s.start, s.mid, s.end);
        if (!c) q = [s.start, s.end];
        else {
          const ang = (p) => Math.atan2(p[1] - c.c[1], p[0] - c.c[0]);
          const norm = (x) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
          const a0 = ang(s.start);
          let sweep = norm(ang(s.end) - a0);
          if (norm(ang(s.mid) - a0) > sweep) sweep -= 2 * Math.PI;
          const n = Math.max(2, Math.ceil(Math.abs(sweep) / (Math.PI / 32)));
          q = Array.from({ length: n + 1 }, (_, i) => (i === 0 ? s.start : i === n ? s.end : [c.c[0] + c.r * Math.cos(a0 + (sweep * i) / n), c.c[1] + c.r * Math.sin(a0 + (sweep * i) / n)]));
        }
      } else q = s.pts || [];
      pts.push(...(reversed ? [...q].reverse() : q));
    }
    if (pts.length >= 3) paths.push(P(pts));
  }
  // even-odd: a loop inside another is a cut-out
  return clip(CL.ClipType.ctUnion, paths, [], CL.PolyFillType.pftEvenOdd);
}

// ---------------------------------------------------------------- input

/**
 * What a fill needs, as plain data (it crosses to the Worker): the Board's rules, Outline, Zones,
 * Tracks and Vias, and every placed pad with its Net and copper layers.
 */
export function zoneInput(project, board = project.board, extraTracks = []) {
  const copper = copperLayerNames(board.stack.copper);
  const nets = padNets(board), view = { ...project, board };
  const pads = [];
  for (const bf of board.footprints || []) {
    for (const pad of placedPads(view, bf, nets)) {
      const layers = pad.layers.includes('*.Cu') ? copper : pad.layers.filter((l) => copper.includes(l));
      // inner layers see a through-hole pad's inner shape (#82)
      for (const { pad: q, layers: ls } of padByLayers(pad, layers)) pads.push({ key: `${bf.componentId}:${pad.number}`, at: q.at, size: q.size, shape: q.shape, rot: q.rot || 0, net: q.net || '', layers: ls, drill: q.drill || 0 });
    }
  }
  return {
    rules: board.rules, netClasses: board.netClasses || {}, outline: board.outline || [], copper,
    // drawings on copper (#66) are net-less copper the pour keeps clear of
    zones: board.zones || [], tracks: [...(board.tracks || []), ...copperDrawingTracks(board), ...extraTracks], vias: board.vias || [], pads,
  };
}

const boardOf = (input) => ({ rules: input.rules, netClasses: input.netClasses });
const clearanceOf = (input, z, net) => Math.max(z.clearance || 0, netRules(boardOf(input), z.net).clearance, netRules(boardOf(input), net).clearance);

function zoneBox(z, m = 0) {
  const xs = z.outline.map((p) => p[0]), ys = z.outline.map((p) => p[1]);
  return { x0: Math.min(...xs) - m, y0: Math.min(...ys) - m, x1: Math.max(...xs) + m, y1: Math.max(...ys) + m };
}
const boxesMeet = (a, b) => a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0;
function itemBox(it) {
  if (it.a) { const r = it.width / 2; return { x0: Math.min(it.a[0], it.b[0]) - r, y0: Math.min(it.a[1], it.b[1]) - r, x1: Math.max(it.a[0], it.b[0]) + r, y1: Math.max(it.a[1], it.b[1]) + r }; }
  const r = it.diameter ? it.diameter / 2 : Math.hypot(...it.size) / 2;
  return { x0: it.at[0] - r, y0: it.at[1] - r, x1: it.at[0] + r, y1: it.at[1] + r };
}

/** The Zones that meet Zone z on its layer and come before it (higher priority). */
function above(input, z) {
  const b = zoneBox(z, maxClearance(input));
  return input.zones.filter((o) => o.id !== z.id && o.layer === z.layer && (o.priority > z.priority || (o.priority === z.priority && o.id < z.id)) && boxesMeet(b, zoneBox(o)));
}
const maxClearance = (input) => Math.max(input.rules.clearance || 0, input.rules.edgeClearance || 0, ...Object.values(input.netClasses).map((c) => c.clearance || 0), ...input.zones.map((z) => z.clearance || 0));

/**
 * The fill with every part narrower than `w` taken away (#82): shrunk by half of it and grown back,
 * as a pen that wide fills it (Eagle's polygon width; KiCad's minimum width). Necks and slivers
 * between clearances go; wider copper keeps its shape.
 */
function minWidthOnly(fill, w) {
  if (!(w > 0) || !fill.length) return fill;
  const shrunk = offset(fill, -w / 2);
  return shrunk.length ? offset(shrunk, w / 2) : [];
}

/** Fill order: highest priority first (ties by id, so the order is stable). */
export const fillOrder = (zones) => [...zones].sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : 1));

// ---------------------------------------------------------------- the fill

/**
 * Fill one Zone. `higher`: the fills (as returned here) of Zones above it, by id.
 * Returns { polys: [[outer, ...holes]] (point lists), thermals: [{ key, spokes }], islands }.
 *
 * The work is done with the Zone's centre moved to the origin (#73): the JavaScript Clipper does
 * its arithmetic in doubles while every coordinate is within ±47.45 mm, and falls back to slow
 * big integers past that. The shift is a whole number of nm, so nothing is rounded by it.
 */
export function fillZone(input, z, higher = new Map()) {
  if (!z.outline || z.outline.length < 3) return { polys: [], thermals: [], islands: 0 };
  const b = zoneBox(z);
  const d = [-Math.round((b.x0 + b.x1) / 2), -Math.round((b.y0 + b.y1) / 2)];
  if (!d[0] && !d[1]) return fillZoneHere(input, z, higher);
  const f = fillZoneHere(shiftInput(input, d), shiftZone(z, d), new Map([...higher].map(([id, h]) => [id, shiftFill(h, d)])));
  return shiftFill(f, [-d[0], -d[1]]);
}

const sh = (p, [dx, dy]) => [p[0] + dx, p[1] + dy];
const shiftZone = (z, d) => ({ ...z, outline: z.outline.map((p) => sh(p, d)) });
const shiftFill = (f, d) => ({ ...f, polys: f.polys.map((poly) => poly.map((ring) => ring.map((p) => sh(p, d)))) });
function shiftShape(g, d) {
  const o = { ...g };
  for (const k of ['a', 'b', 'c', 'start', 'mid', 'end', 'at']) if (g[k]) o[k] = sh(g[k], d);
  if (g.pts) o.pts = g.pts.map((p) => sh(p, d));
  return o;
}
function shiftInput(input, d) {
  return {
    ...input,
    outline: input.outline.map((g) => shiftShape(g, d)),
    zones: input.zones.map((z) => shiftZone(z, d)),
    tracks: input.tracks.map((t) => ({ ...t, a: sh(t.a, d), b: sh(t.b, d) })),
    vias: input.vias.map((v) => ({ ...v, at: sh(v.at, d) })),
    pads: input.pads.map((q) => ({ ...q, at: sh(q.at, d) })),
  };
}

function fillZoneHere(input, z, higher) {
  const empty = { polys: [], thermals: [], islands: 0 };
  if (!z.outline || z.outline.length < 3) return empty;
  let region = union([P(z.outline)]);
  const edge = input.rules.edgeClearance || 0;
  const bArea = boardArea(input.outline);
  if (bArea) region = inter(region, offset(bArea, -edge - MARGIN));
  if (!region.length) return empty;
  const net = z.net || '', foreign = (n) => !net || low(n) !== low(net);
  const box = zoneBox(z, maxClearance(input) + (z.thermal?.gap || 0) + (z.thermal?.spoke || 0));
  const onLayer = (it) => (it.layer ? it.layer === z.layer : it.layers ? it.layers.includes(z.layer) : true);

  // what the fill keeps clear of
  const keepOut = [];
  for (const o of above(input, z)) {
    if (!foreign(o.net)) continue;
    const f = higher.get(o.id);
    const paths = f ? f.polys.flatMap((poly) => poly.map(P)) : [P(o.outline)];
    keepOut.push(...offset(union(paths), clearanceOf(input, z, o.net) + MARGIN));
  }
  const near = (it) => onLayer(it) && boxesMeet(box, itemBox(it));
  for (const t of input.tracks) if (near(t) && foreign(t.net)) keepOut.push(...shapePaths({ type: 'capsule', a: t.a, b: t.b, r: t.width / 2 }, clearanceOf(input, z, t.net) + MARGIN));
  for (const v of input.vias) if (boxesMeet(box, itemBox(v)) && foreign(v.net)) keepOut.push(...shapePaths({ type: 'capsule', a: v.at, b: v.at, r: v.diameter / 2 }, clearanceOf(input, z, v.net) + MARGIN));
  const own = [];
  // non-plated holes (a pad with a drill and no copper here): the fill keeps the clearance from the hole
  for (const pad of input.pads) {
    // (a pad with copper on other layers isn't one: since #82 a through-hole pad comes as an outer
    // and an inner entry, and the outer one must not count as a hole on the inner layers)
    if (!(pad.drill > 0) || pad.layers.length || !boxesMeet(box, itemBox(pad))) continue;
    keepOut.push(...shapePaths({ type: 'capsule', a: pad.at, b: pad.at, r: pad.drill / 2 }, clearanceOf(input, z, '') + MARGIN));
  }
  for (const pad of input.pads) {
    if (!near(pad)) continue;
    if (foreign(pad.net)) keepOut.push(...shapePaths(padShape(pad), clearanceOf(input, z, pad.net) + MARGIN));
    else own.push(pad);
  }
  const allowed = diff(region, union(keepOut));

  // same-Net pads: solid, or a thermal gap crossed by spokes
  const thermals = [];
  let fill = allowed;
  if (z.connect !== 'solid' && own.length) {
    const gap = z.thermal?.gap ?? ZONE_DEFAULTS.thermal.gap, spoke = z.thermal?.spoke ?? ZONE_DEFAULTS.thermal.spoke;
    const reliefs = union(own.flatMap((pad) => shapePaths(padShape(pad), gap)));
    fill = diff(allowed, reliefs);
    // each pad's four candidate spokes: the bridge across the gap must be clear, and the tip must
    // land on the fill. The fill is cut down to all the bridges (tips) at once first (#73), so each
    // test intersects a small piece rather than the whole fill
    const cand = [];
    for (const pad of own) {
      const t = ((pad.rot || 0) * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
      const R = ([x, y]) => [pad.at[0] + x * c + y * s, pad.at[1] - x * s + y * c];
      const w = spoke / 2;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const half = (dx ? pad.size[0] : pad.size[1]) / 2;
        const sgn = dx || dy;
        const span = (a0, a1) => {
          const lo = Math.min(a0 * sgn, a1 * sgn), hi = Math.max(a0 * sgn, a1 * sgn);
          return dx ? P([[lo, -w], [hi, -w], [hi, w], [lo, w]].map(R)) : P([[-w, lo], [w, lo], [w, hi], [-w, hi]].map(R));
        };
        cand.push({ pad, bridge: [span(half, half + gap)], tip: [span(half + gap, half + gap + spoke)], spoke: span(0, half + gap + spoke / 2) });
      }
    }
    const nearBridges = cand.length ? inter(allowed, union(cand.flatMap((x) => x.bridge))) : [];
    const nearTips = cand.length ? inter(fill, union(cand.flatMap((x) => x.tip))) : [];
    const spokes = [];
    const count = new Map(own.map((pad) => [pad, 0]));
    for (const x of cand) {
      if (area(inter(x.bridge, nearBridges)) < 0.98 * area(x.bridge)) continue;
      if (area(inter(x.tip, nearTips)) < 0.5 * area(x.tip)) continue;
      spokes.push(x.spoke);
      count.set(x.pad, count.get(x.pad) + 1);
    }
    for (const pad of own) thermals.push({ key: pad.key, spokes: count.get(pad) });
    fill = minWidthOnly(fill, z.minWidth);
    if (spokes.length) fill = union(fill, inter(spokes, allowed));
  }

  if (z.connect === 'solid' || !own.length) fill = minWidthOnly(fill, z.minWidth);

  // islands: keep the pieces that touch this Net's copper (a Zone with no Net keeps them all)
  const tree = new CL.PolyTree();
  const c = new CL.Clipper();
  c.AddPaths(fill, CL.PolyType.ptSubject, true);
  c.Execute(CL.ClipType.ctUnion, tree, CL.PolyFillType.pftNonZero, CL.PolyFillType.pftNonZero);
  const pieces = [];
  const walk = (node) => {
    for (const outer of node.Childs()) {
      pieces.push([outer.Contour(), ...outer.Childs().map((hole) => hole.Contour())]);
      for (const hole of outer.Childs()) walk(hole);
    }
  };
  walk(tree);
  let anchors = null;
  if (net) {
    const a = [];
    const reach = z.connect !== 'solid' ? (z.thermal?.gap ?? 0) + 1_000 : 1_000;
    for (const pad of own) a.push(...shapePaths(padShape(pad), reach));
    for (const t of input.tracks) if (near(t) && !foreign(t.net)) a.push(...shapePaths({ type: 'capsule', a: t.a, b: t.b, r: t.width / 2 }, 1_000));
    for (const v of input.vias) if (boxesMeet(box, itemBox(v)) && !foreign(v.net)) a.push(...shapePaths({ type: 'capsule', a: v.at, b: v.at, r: v.diameter / 2 }, 1_000));
    anchors = union(a);
  }
  // a piece only needs testing against the anchor rings whose box meets its own (#73); a hole's box
  // is inside its outline's, so no hole is taken without its outline
  const ringBox = (r) => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const q of r) { if (q.X < x0) x0 = q.X; if (q.X > x1) x1 = q.X; if (q.Y < y0) y0 = q.Y; if (q.Y > y1) y1 = q.Y; } return { x0, y0, x1, y1 }; };
  const anchorBoxes = anchors ? anchors.map(ringBox) : [];
  const touchesAnchor = (outer) => {
    const b = ringBox(outer);
    const near = anchors.filter((_, i) => boxesMeet(b, anchorBoxes[i]));
    return near.length > 0 && inter([outer], near).length > 0;
  };
  const kept = [];
  let islands = 0;
  for (const piece of pieces) {
    if (anchors && !z.keepIslands && !touchesAnchor(piece[0])) { islands++; continue; }
    kept.push(piece.map(unP));
  }
  return { polys: kept, thermals, islands };
}

/**
 * Fill Zones `ids` (all of them when omitted), highest priority first, using `known` fills (by id)
 * for Zones above them that aren't being refilled. Returns a Map id -> fill.
 */
export function fillZones(input, ids = null, known = new Map()) {
  const want = ids ? new Set(ids) : new Set(input.zones.map((z) => z.id));
  const done = new Map(known);
  const out = new Map();
  for (const z of fillOrder(input.zones)) {
    if (!want.has(z.id)) continue;
    const f = fillZone(input, z, done);
    done.set(z.id, f);
    out.set(z.id, f);
  }
  return out;
}

// ---------------------------------------------------------------- what an edit touched

/** A short hash of a string (cyrb53). */
function hash(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) { const ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/**
 * A signature per Zone of everything its fill depends on: the Zone, the rules, the Outline, the
 * copper near it on its layer and the Zones above it. A Zone needs refilling when its signature
 * changes, so an edit refills only the Zones whose area it touched.
 */
export function zoneSignatures(input) {
  const sigs = new Map();
  const shared = JSON.stringify([input.rules, input.netClasses, input.outline]);
  for (const z of fillOrder(input.zones)) {
    const box = zoneBox(z, maxClearance(input) + (z.thermal?.gap || 0) + (z.thermal?.spoke || 0));
    const onLayer = (it) => (it.layer ? it.layer === z.layer : it.layers ? it.layers.includes(z.layer) : true);
    const near = (it) => onLayer(it) && boxesMeet(box, itemBox(it));
    const parts = [
      z, shared,
      input.tracks.filter(near).map((t) => [t.a, t.b, t.width, t.net]),
      input.vias.filter((v) => boxesMeet(box, itemBox(v))).map((v) => [v.at, v.diameter, v.net]),
      input.pads.filter((p) => near(p) || (p.drill > 0 && boxesMeet(box, itemBox(p)))).map((p) => [p.at, p.size, p.shape, p.rot, p.net, p.drill || 0]),
      above(input, z).map((o) => sigs.get(o.id) || o.id),
    ];
    sigs.set(z.id, hash(JSON.stringify(parts)));
  }
  return sigs;
}

// ---------------------------------------------------------------- hit testing

/** Is point p inside the polygon pts (even-odd)? */
export function inPolygon(p, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Move Zones (in place) by d. */
export function moveZones(zones, ids, [dx, dy]) {
  for (const z of zones) if (ids.has(z.id)) z.outline = z.outline.map(([x, y]) => [x + dx, y + dy]);
}
