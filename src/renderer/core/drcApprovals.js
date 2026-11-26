// DRC approvals (#69): a problem the designer decided is fine, kept with the Board as
// board.drcApprovals: [{ key, rule, items, note?, at? }]. An approval matches a DRC result by its
// key: the rule, the items it's about and each item's current geometry and net. So an edit
// elsewhere keeps it, while moving, resizing or re-netting one of its items lapses it (the
// problem shows again). Approvals whose items are gone are pruned. DOM-free.
import { placedPads, padNets, bfFootprint } from './footprint.js';
import { footprintOf } from './project.js';

/** How each kind of item looks to an approval: its geometry and net, or null when it's gone. */
function itemSigs(project, board = project.board) {
  const byId = new Map();
  for (const t of board.tracks || []) byId.set(t.id, () => ['t', t.a, t.b, t.width, t.layer, t.net || '', ...(t.mid ? [t.mid] : [])]);
  for (const v of board.vias || []) byId.set(v.id, () => ['v', v.at, v.diameter, v.drill, v.net || '']);
  for (const z of board.zones || []) byId.set(z.id, () => ['z', z.outline, z.layer, z.net || '', z.priority, z.clearance || 0]);
  for (const d of board.drawings || []) byId.set(d.id, () => ['d', d]);
  const fps = new Map((board.footprints || []).map((bf) => [bf.id, bf]));
  let nets = null;
  const fpSig = (bf) => [bf.at, bf.rot || 0, bf.side || 'F', bfFootprint(project, bf)?.name || ''];
  return (id) => {
    if (byId.has(id)) return byId.get(id)();
    if (fps.has(id)) return ['f', ...fpSig(fps.get(id))];
    // a pad: `${footprint id}:${number}:${x},${y}`
    const m = /^(.+?):([^:]*):(-?\d+),(-?\d+)$/.exec(id);
    const bf = m && fps.get(m[1]);
    if (!bf) return null;
    nets ||= padNets(board);
    const pad = placedPads({ ...project, board }, bf, nets).find((q) => q.number === m[2] && q.at[0] === +m[3] && q.at[1] === +m[4]);
    return pad ? ['p', ...fpSig(bf), pad.number, pad.size, pad.shape, pad.drill || 0, pad.net || ''] : null;
  };
}

/** Is `id` a net name (an unrouted connection's item) rather than a Board item? */
const isNet = (v, id) => v.rule === 'unrouted' && v.items?.[0] === id;

/**
 * The key an approval of DRC result `v` is kept under. `sigs`: itemSigs(project) (made once per
 * list). Results with no Board items (an unrouted connection, the outline) also key on where they
 * are.
 */
export function approvalKey(v, sigs) {
  const items = [...(v.items || [])].sort();
  const parts = items.map((id) => [id, isNet(v, id) ? 'net' : sigs(id)]);
  const where = !items.length || v.rule === 'unrouted' ? [v.at || null, v.show?.wire || null] : null;
  return hash(JSON.stringify([v.rule, parts, where]));
}

function hash(str) {
  let h1 = 0x811c9dc5, h2 = 0x1000193;
  for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = Math.imul(h2 + c, 2654435761); }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
}

/**
 * The DRC results with each approved one marked: `approval` ({ key, note }) on those an approval
 * matches. Returns new objects; the list keeps its order.
 */
export function markApproved(project, list) {
  const approvals = project.board.drcApprovals || [];
  if (!approvals.length) return list.map((v) => (v.approval ? (({ approval, ...rest }) => rest)(v) : v));
  const byKey = new Map(approvals.map((a) => [a.key, a]));
  const sigs = itemSigs(project);
  return list.map((v) => {
    const a = byKey.get(approvalKey(v, sigs));
    const { approval, ...rest } = v;
    return a ? { ...rest, approval: { key: a.key, note: a.note || '' } } : rest;
  });
}

/** The results not approved (what counts: the DRC header, the Gerber tab's "DRC at generation"). */
export const unapproved = (list) => list.filter((v) => !v.approval);

/** Approve DRC result `v` (one edit), with an optional note. Returns the approval. */
export function approve(project, v, note = '') {
  const board = project.board;
  const key = approvalKey(v, itemSigs(project));
  board.drcApprovals = (board.drcApprovals || []).filter((a) => a.key !== key);
  const a = { key, rule: v.rule, items: [...(v.items || [])], ...(String(note).trim() ? { note: String(note).trim() } : {}), ...(v.at ? { at: v.at } : {}) };
  board.drcApprovals.push(a);
  pruneApprovals(project);
  return a;
}

/** Take an approval away (the problem counts again). */
export function unapprove(project, key) {
  const board = project.board;
  board.drcApprovals = (board.drcApprovals || []).filter((a) => a.key !== key);
  if (!board.drcApprovals.length) delete board.drcApprovals;
  pruneApprovals(project);
}

/** Drop approvals whose Board items are gone (deleted Tracks, Vias, Zones, Footprints…). */
export function pruneApprovals(project) {
  const board = project.board;
  if (!board.drcApprovals?.length) { delete board.drcApprovals; return; }
  const sigs = itemSigs(project);
  board.drcApprovals = board.drcApprovals.filter((a) => (a.items || []).every((id) => isNet(a, id) || sigs(id) !== null));
  if (!board.drcApprovals.length) delete board.drcApprovals;
}
