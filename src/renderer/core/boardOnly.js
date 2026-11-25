// Board-only Footprints (#74): mounting holes, fiducials, logos, drill legends… placed on the
// Board with no Schematic Component. Each is a board.footprints entry with no componentId:
//   { id, ref, value?, fpKey, at, rot, side, locked, padNets?: { [pad number]: net }, bom?: true }
// Its footprint lives in the Project's footprint table (fpKey); Update from Schematic leaves it
// alone. These are the edits the Board makes on them (each run inside one undo step). DOM-free.
import { uid, addFootprint, nextRef } from './project.js';

/** The Reference prefix a footprint suggests: H for holes, FID for fiducials, LOGO, TP…; else M. */
export function refPrefix(name) {
  const n = String(name || '');
  if (/hole|mount|^mh|standoff|^m\d/i.test(n)) return 'H';
  if (/fid/i.test(n)) return 'FID';
  if (/logo|art|graphic/i.test(n)) return 'LOGO';
  if (/^tp|test/i.test(n)) return 'TP';
  if (/legend/i.test(n)) return 'LEG';
  return 'M';
}

/** Place a board-only Footprint from a library footprint. Returns it. */
export function addBoardOnly(project, library, footprint, at, { ref = null, rot = 0, side = 'F' } = {}) {
  const fpKey = addFootprint(project, library, footprint);
  const bf = { id: uid('f'), ref: ref || nextRef(project, refPrefix(footprint.name)), fpKey, at: [Math.round(at[0]), Math.round(at[1])], rot, side, locked: false };
  project.board.footprints.push(bf);
  return bf;
}

/** Why `ref` can't be a board-only Footprint's Reference (taken, empty, spaces), or null. */
export function refProblem(project, bfId, ref) {
  const r = String(ref ?? '').trim();
  if (!r) return 'A Reference can\'t be empty.';
  if (/\s/.test(r)) return 'A Reference has no spaces.';
  const low = r.toLowerCase();
  if (Object.values(project.components).some((c) => c.ref.toLowerCase() === low)) return `${r} is a part on the Schematic.`;
  if ((project.board.footprints || []).some((f) => !f.componentId && f.id !== bfId && (f.ref || '').toLowerCase() === low)) return `${r} is already on the Board.`;
  return null;
}

/**
 * Change a board-only Footprint: { ref, value, bom, padNet: [number, net] } (net '' clears it).
 * Throws on a Reference that can't be used.
 */
export function setBoardOnly(project, bfId, patch) {
  const bf = project.board.footprints.find((f) => f.id === bfId && !f.componentId);
  if (!bf) throw new Error('No such board-only footprint.');
  if ('ref' in patch) { const m = refProblem(project, bfId, patch.ref); if (m) throw new Error(m); bf.ref = String(patch.ref).trim(); }
  if ('value' in patch) { const v = String(patch.value ?? '').trim(); if (v) bf.value = v; else delete bf.value; }
  if ('bom' in patch) { if (patch.bom) bf.bom = true; else delete bf.bom; }
  if (patch.padNet) {
    const [num, net] = patch.padNet;
    const nets = { ...(bf.padNets || {}) };
    if (String(net || '').trim()) nets[num] = String(net).trim(); else delete nets[num];
    if (Object.keys(nets).length) bf.padNets = nets; else delete bf.padNets;
  }
}

/** Delete board-only Footprints (Schematic ones come and go with Update from Schematic). */
export function deleteBoardOnly(project, ids) {
  const gone = new Set(ids);
  project.board.footprints = project.board.footprints.filter((f) => f.componentId || !gone.has(f.id));
}
