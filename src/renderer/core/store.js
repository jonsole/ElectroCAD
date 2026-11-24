// Project store logic that doesn't depend on where Projects are kept (ADR-0011):
// card metadata, ordering, importing and duplicating. The storage backends live in
// platform.js (desktop folder, browser IndexedDB).
import { deserialize, uid, FILE_EXTENSION } from './project.js';

/** Metadata shown on a Your projects card. */
export function projectMeta(project, { modified = Date.now(), thumb = null } = {}) {
  return {
    id: project.id,
    name: project.name,
    modified,
    components: Object.keys(project.components).length,
    layers: project.board.stack.copper,
    thumb,
  };
}

export const describeMeta = (m) => `${m.components} component${m.components === 1 ? '' : 's'} · ${m.layers}-layer`;

export const sortNewestFirst = (list) => [...list].sort((a, b) => (b.modified || 0) - (a.modified || 0) || String(a.name).localeCompare(String(b.name)));

/**
 * Turn an .ecad file into a Project for the store. Throws ProjectFileError for files that
 * can't be opened. A file whose id is already in the store becomes a separate Project.
 */
export function importProject(text, existingIds) {
  const p = deserialize(text);
  if (existingIds.has(p.id)) p.id = uid('p');
  return p;
}

/** A separate copy of a Project, named "Name (copy)", "Name (copy 2)", … avoiding `takenNames`. */
export function duplicateProject(project, takenNames = []) {
  const copy = structuredClone(project);
  copy.id = uid('p');
  const taken = new Set(takenNames);
  let name = `${project.name} (copy)`;
  for (let n = 2; taken.has(name); n++) name = `${project.name} (copy ${n})`;
  copy.name = name;
  return copy;
}

export const exportFileName = (project) => `${(project.name || '').replace(/[\\/:*?"<>|]/g, '-').trim() || 'Untitled'}.${FILE_EXTENSION}`;

/** Thumbnails show the Board once it has an Outline or Footprints, otherwise the first Sheet. */
export const hasBoardContent = (project) => project.board.outline.length > 0 || project.board.footprints.length > 0;
