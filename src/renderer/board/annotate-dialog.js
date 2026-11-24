// The Forward annotation dialog (#16): what the Schematic would change on the Board, grouped,
// with Apply (one undo step) and Cancel.
import { h, button, icon, modal, toast } from '../ui/dom.js';
import { changeList, applyChanges, isEmpty } from '../core/annotate.js';

const SECTIONS = [
  ['Footprints', ['add', 'remove']],
  ['References and values', ['ref', 'value']],
  ['Nets', ['net-add', 'net-remove', 'net-rename', 'net-pads']],
];

const list = (pads) => (pads.length > 6 ? `${pads.slice(0, 6).join(', ')} and ${pads.length - 6} more` : pads.join(', '));

/** One change as [icon, kind label, text]. */
function describe(c) {
  switch (c.kind) {
    case 'add': return ['plus', 'Add', `${c.ref} (${c.value}) · ${c.footprint}`];
    case 'remove': return ['trash', 'Remove', `${c.ref}: no longer on the Schematic`];
    case 'ref': return ['pencil', 'Rename', `${c.from} → ${c.to}`];
    case 'value': return ['pencil', 'Value', `${c.ref}: ${c.from || '(none)'} → ${c.to || '(none)'}`];
    case 'net-add': return ['plus', 'New net', `${c.net}: ${list(c.pads)}`];
    case 'net-remove': return ['trash', 'Net gone', `${c.net} (was ${list(c.pads)})`];
    case 'net-rename': return ['pencil', 'Rename net', `${c.from} → ${c.to} (tracks, vias and zones follow)`];
    case 'net-pads': return ['wire', 'Pads', `${c.net}: ${[c.added.length ? `+ ${list(c.added)}` : '', c.removed.length ? `− ${list(c.removed)}` : ''].filter(Boolean).join('  ')}`];
    default: return ['info', c.kind, ''];
  }
}

export function openAnnotateDialog(app, { onApplied } = {}) {
  const changes = changeList(app.project);
  const m = modal({ title: 'Update Board from Schematic', width: 620, cls: 'annotate-modal' });
  const body = [];
  if (isEmpty(changes)) body.push(h('div', { class: 'annotate-empty' }, icon('check', 18), h('span', {}, 'The Board is up to date with the Schematic.')));
  else if (!changes.changes.length) body.push(h('p', { class: 'modal-text' }, 'Only the Board\'s record of References and Values needs refreshing.'));
  for (const [title, kinds] of SECTIONS) {
    const rows = changes.changes.filter((c) => kinds.includes(c.kind));
    if (!rows.length) continue;
    body.push(h('div', { class: 'annotate-section' },
      h('div', { class: 'annotate-head' }, title, h('span', { class: 'annotate-count' }, String(rows.length))),
      h('div', { class: 'annotate-list', role: 'list' }, ...rows.map((c) => {
        const [ic, label, text] = describe(c);
        return h('div', { class: `annotate-row k-${c.kind}`, role: 'listitem' }, icon(ic, 14), h('span', { class: 'annotate-kind' }, label), h('span', { class: 'annotate-text', title: text }, text));
      }))));
  }
  for (const w of changes.warnings) body.push(h('div', { class: 'annotate-warn' }, icon('info', 16), h('span', {}, w)));
  const adds = changes.changes.filter((c) => c.kind === 'add').length;
  if (adds) body.push(h('p', { class: 'side-note' }, `New Footprints arrive in a group beside the Outline${app.project.board.outline.length ? '' : ' (at the origin: there is no Outline yet)'}.`));
  const apply = button({ label: 'Apply', cls: 'btn-primary', title: 'Update the Board (one undo step)', onClick: () => {
    app.edit('Update Board from Schematic', (p) => applyChanges(p, changeList(p)));
    m.close();
    const n = changes.changes.length;
    toast(n ? `Board updated: ${n} change${n === 1 ? '' : 's'}.` : 'Board updated.', 'info', 2500);
    onApplied?.(changes);
  } });
  apply.disabled = isEmpty(changes);
  m.body.append(h('div', { class: 'annotate-body' }, ...body),
    h('div', { class: 'modal-actions' }, button({ label: isEmpty(changes) ? 'Close' : 'Cancel', cls: 'btn-outline', onClick: () => m.close() }), apply));
  return m;
}
