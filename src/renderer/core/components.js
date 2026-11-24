// Component edits for the inspector (#9): Reference designator, Value, MPN, custom fields and
// Footprint (a Preferred footprint, or any other, which uses the identity Pin map: ADR-0008).
import { partOf, footprintRef, footprintOf, pruneOrphans } from './project.js';

/** Why a Reference designator can't be used, or null when it's fine. */
export function validateRef(project, compId, ref) {
  const r = String(ref ?? '').trim();
  if (!r) return "The reference can't be empty.";
  if (/\s/.test(r)) return 'Use no spaces in a reference (e.g. R12).';
  for (const c of Object.values(project.components)) if (c.id !== compId && c.ref === r) return `${r} is already used by another part.`;
  return null;
}

/**
 * Apply edits to a Component. `patch` may hold ref, value, mpn ({ manufacturer, number }, empty
 * clears it), fields ({ name: value }) and footprint ({ fpId } or { library, footprint }).
 * Throws (changing nothing) when the reference is not valid.
 */
export function updateComponent(project, compId, patch) {
  const c = project.components[compId];
  if (!c) throw new Error('That part no longer exists.');
  if ('ref' in patch) {
    const err = validateRef(project, compId, patch.ref);
    if (err) throw new Error(err);
  }
  if ('ref' in patch) c.ref = String(patch.ref).trim();
  if ('value' in patch) c.value = String(patch.value);
  if ('mpn' in patch) {
    const m = patch.mpn || {};
    const manufacturer = String(m.manufacturer || '').trim(), number = String(m.number || '').trim();
    c.mpn = manufacturer || number ? { manufacturer, number } : null;
  }
  if ('fields' in patch) {
    const f = {};
    for (const [k, v] of Object.entries(patch.fields || {})) if (String(k).trim()) f[String(k).trim()] = String(v);
    c.fields = f;
  }
  if ('footprint' in patch) {
    c.footprint = footprintRef(project, patch.footprint);
    pruneOrphans(project); // drops a table Footprint nothing uses any more
  }
}

/**
 * Footprints a Component can use: its Part's Preferred footprints (with their Pin maps) first,
 * then every other Footprint in `library`'s Parts and in `footprints` (e.g. every generated
 * Footprint; identity Pin map). Each choice is { label, value, key }.
 */
export function footprintChoices(project, comp, library, footprints = []) {
  const part = partOf(project, comp);
  const preferred = Object.entries(part?.footprints || {}).map(([fpId, fp]) => ({ label: fp.name, value: { fpId }, key: 'p:' + fpId }));
  const names = new Set(preferred.map((c) => c.label));
  const other = [];
  for (const lp of library) {
    for (const fp of Object.values(lp.footprints || {})) {
      if (names.has(fp.name)) continue;
      names.add(fp.name);
      other.push({ label: fp.name, value: { library: lp.origin?.library || 'builtin', footprint: structuredClone(fp) }, key: 'o:' + fp.name });
    }
  }
  for (const fp of footprints) {
    if (names.has(fp.name)) continue;
    names.add(fp.name);
    other.push({ label: fp.name, value: { library: 'builtin', footprint: structuredClone(fp) }, key: 'o:' + fp.name });
  }
  other.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  return { preferred, other };
}

/** The key of a Component's current choice in footprintChoices. */
export const footprintKey = (project, comp) => (!comp.footprint ? '' : comp.footprint.fpId ? 'p:' + comp.footprint.fpId : 'o:' + footprintOf(project, comp)?.name);
