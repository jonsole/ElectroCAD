// Busses (#64): a Bus is drawn like a Wire, thicker, and carries no connection itself. Nets cross
// it by name, as in Eagle and KiCad: a Wire ending on a Bus (a bus entry) belongs to whatever Net
// it is, and ERC warns when that Net isn't one of the Bus's members.
//
// A Sheet's `busses` are segments { id, a, b, name }; segments that touch are one Bus and share
// its name. The name lists the members, Eagle's notation: names and ranges separated by commas,
// `D[0..7]` (D0…D7, either way round), `A,B,~{WR}` (overbar markup kept, #63); KiCad's group
// `{SIG1 SIG2}` is read too. DOM-free.
import { onSegment } from './geom.js';

/** The Net names a Bus name lists, in order, without repeats. */
export function busMembers(name) {
  const out = [];
  const add = (n) => { if (n && !out.includes(n)) out.push(n); };
  for (const item of splitTop(String(name ?? ''))) {
    // a KiCad group {A B}, maybe with a prefix (PRE{A B} -> PRE.A, PRE.B as KiCad names them)
    const g = /^([^~{}]*)\{([^{}]*)\}$/.exec(item);
    if (g && !item.startsWith('~{')) { for (const x of g[2].split(/\s+/)) if (x) add(g[1] ? `${g[1]}.${x}` : x); continue; }
    const r = /^(.*)\[(\d+)\.\.(\d+)\](.*)$/.exec(item);
    if (r) {
      const [lo, hi] = [Number(r[2]), Number(r[3])];
      const step = lo <= hi ? 1 : -1;
      for (let i = lo; ; i += step) { add(`${r[1]}${i}${r[4]}`); if (i === hi) break; }
      continue;
    }
    add(item);
  }
  return out;
}

/** Split at commas and spaces that aren't inside braces (overbar markup, KiCad groups). */
function splitTop(s) {
  const out = [];
  let cur = '', depth = 0;
  for (const ch of s) {
    if (ch === '{') depth++;
    else if (ch === '}') depth = Math.max(0, depth - 1);
    if (depth === 0 && (ch === ',' || /\s/.test(ch))) { if (cur) out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

const touch = (s, t) => [s.a, s.b].some((p) => onSegment(p, t.a, t.b)) || [t.a, t.b].some((p) => onSegment(p, s.a, s.b));

/** A Sheet's Busses: the segments that touch, grouped. [{ segs, name }] (name: the first set). */
export function busGroups(sheet) {
  const segs = sheet.busses || [];
  const parent = segs.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) if (touch(segs[i], segs[j])) parent[find(i)] = find(j);
  const groups = new Map();
  segs.forEach((s, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(s); });
  return [...groups.values()].map((g) => ({ segs: g, name: g.find((s) => s.name)?.name || '' }));
}

/** The segments of the Bus segment `id` belongs to (itself included). */
export function busOf(sheet, id) {
  return busGroups(sheet).find((g) => g.segs.some((s) => s.id === id))?.segs || [];
}

/** The Bus segment within `tol` of `pt`, nearest first, or null. */
export function hitBus(sheet, pt, tol) {
  let best = null, bestD = tol * tol;
  for (const s of sheet.busses || []) {
    const d = dist2(pt, s.a, s.b);
    if (d <= bestD) { best = s; bestD = d; }
  }
  return best;
}

function dist2(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)) : 0;
  const x = a[0] + t * dx - p[0], y = a[1] + t * dy - p[1];
  return x * x + y * y;
}

/** The Bus (group) a point lies on, or null. */
export function busAt(sheet, pt) {
  return busGroups(sheet).find((g) => g.segs.some((s) => onSegment(pt, s.a, s.b))) || null;
}
