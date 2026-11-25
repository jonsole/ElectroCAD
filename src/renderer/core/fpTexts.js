// A placed Footprint's Reference and Value text (#65): where its Footprint draws them by default,
// or the placement's own override in bf.texts = { ref?, value? }, each { at, rot, size, layer,
// hidden } in the Footprint's own frame (so it moves, turns and flips with the Footprint):
//   at     the text's centre, Footprint coordinates (nm)
//   rot    degrees anticlockwise, relative to the Footprint
//   layer  as on a front-side Footprint (F.SilkS, F.Fab…); a back-side one draws it on B.*
//   hidden true: not drawn (Eagle's display="off")
// The board view, the silk Gerbers and hit testing all go through placedFieldTexts. DOM-free.
import { fpTransform, flipLayer } from './footprint.js';
import { footprintOf } from './project.js';

export const FIELD_KEYS = ['ref', 'value'];
const TOKEN = { ref: '${REF}', value: '${VALUE}' };
export const FIELD_NAME = { ref: 'Reference', value: 'Value' };

/** Which field a Footprint text shows: 'ref', 'value' or null. */
export const fieldOfText = (gr) => (gr.type !== 'text' ? null : gr.text.includes(TOKEN.ref) ? 'ref' : gr.text.includes(TOKEN.value) ? 'value' : null);

/** The world -> Footprint-frame transform (the inverse of fpTransform). */
export function fpInverse(bf) {
  const t = ((bf.rot || 0) * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  const m = bf.side === 'B' ? -1 : 1;
  return ([x, y]) => {
    const dx = x - bf.at[0], dy = y - bf.at[1];
    const lx = dx * c - dy * s, ly = dx * s + dy * c;
    return [Math.round(lx * m), Math.round(ly)];
  };
}

const norm = (a) => Math.round((((a % 360) + 360) % 360) * 100) / 100;
/** A field's world angle from its angle in the Footprint's frame (mirrored on the back), and back again. */
export const worldRot = (bf, rot) => norm(bf.side === 'B' ? (bf.rot || 0) - rot : (bf.rot || 0) + rot);
export const localRot = (bf, rot) => norm(bf.side === 'B' ? (bf.rot || 0) - rot : rot - (bf.rot || 0));

/**
 * Where the Footprint itself puts a field, in its own frame: its first text showing the field
 * (drawn upright, so its angle cancels the Footprint's), else the automatic one: the Reference on
 * the silk above the courtyard (1 mm), the Value on the fab layer below it (0.7 mm).
 */
export function fieldDefault(fp, key, bf = null) {
  const own = (fp?.graphics || []).find((g) => fieldOfText(g) === key);
  const up = bf ? localRot(bf, 0) : 0;
  if (own) return { at: own.at, rot: up, size: own.size, layer: own.layer || 'F.SilkS', own: true };
  const crt = (fp?.graphics || []).find((g) => /CrtYd$/.test(g.layer || '') && g.type === 'rect');
  if (key === 'ref') return { at: [0, (crt ? Math.min(crt.a[1], crt.b[1]) : -1_000_000) - 800_000], rot: up, size: 1_000_000, layer: 'F.SilkS', own: false };
  return { at: [0, (crt ? Math.max(crt.a[1], crt.b[1]) : 1_000_000) + 600_000], rot: up, size: 700_000, layer: 'F.Fab', own: false };
}

/** A field's placement in the Footprint's frame: the override over the default. */
export function fieldPlacement(fp, bf, key) {
  const d = fieldDefault(fp, key, bf), o = bf.texts?.[key];
  return o ? { ...d, ...o, overridden: true } : { ...d, overridden: false };
}

/**
 * The Reference and Value a placed Footprint shows where they've been moved, resized or hidden
 * (#65), as board drawings (core/boardDrawings.js shape): [{ key, type: 'text', text, at, size,
 * rot, layer, hidden }] in board coordinates. Fields with no override are drawn by the Footprint's
 * own graphics (or the automatic texts) as before, and are left out unless `all`.
 */
export function placedFieldTexts(project, bf, { ref, value, all = false } = {}) {
  const fp = footprintOf(project, project.components[bf.componentId]);
  const T = fpTransform(bf);
  const out = [];
  for (const key of FIELD_KEYS) {
    if (!all && !bf.texts?.[key]) continue;
    const p = fieldPlacement(fp, bf, key);
    const str = key === 'ref' ? ref : value;
    out.push({ key, id: `${bf.id}:${key}`, type: 'text', text: String(str ?? ''), at: T(p.at), size: p.size, rot: worldRot(bf, p.rot), layer: flipLayer(p.layer, bf.side), hidden: !!p.hidden, overridden: p.overridden, own: p.own });
  }
  return out;
}

/** The Reference and Value strings a placed Footprint shows (what the Board was last told). */
export function fieldStrings(project, bf) {
  const a = project.board.annotation?.components?.[bf.componentId], c = project.components[bf.componentId];
  return { ref: a?.ref ?? c?.ref ?? '', value: a?.value ?? c?.value ?? '' };
}

/** Set (merge into) a field's override; `null` removes it (Reset to Footprint). */
export function setFieldOverride(project, bfId, key, patch) {
  const bf = project.board.footprints.find((f) => f.id === bfId);
  if (!bf) return;
  if (patch === null) {
    if (bf.texts) { delete bf.texts[key]; if (!Object.keys(bf.texts).length) delete bf.texts; }
    return;
  }
  const fp = footprintOf(project, project.components[bf.componentId]);
  const cur = bf.texts?.[key] || (({ own, ...d }) => d)(fieldDefault(fp, key, bf));
  const next = { ...cur, ...patch };
  if (!next.hidden) delete next.hidden;
  bf.texts = { ...(bf.texts || {}), [key]: next };
}
