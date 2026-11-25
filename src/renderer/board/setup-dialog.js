// Board setup (#24): the Fab preset, Design rules and Fab output settings, and the Net classes.
// Every change is its own undo step and shows at once (the dialog redraws from the Project).
import { h, button, icon, modal, toast } from '../ui/dom.js';
import { toMm, mm } from '../core/units.js';
import { FABS, presetFor, presetById, applyPreset, presetState, setRule, RULE_FIELDS, fabSettings } from '../core/presets.js';
import { addNetClass, renameNetClass, deleteNetClass, setNetClassRule, assignNet, netClassOf, boardNets, CLASS_FIELDS, DEFAULT_CLASS } from '../core/netclasses.js';

const fmt = (nm) => String(+toMm(nm).toFixed(4));
const stop = (el) => { el.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' && el.tagName === 'INPUT') el.blur(); }); return el; };

/** Open Board setup on a tab: 'rules' | 'classes'. */
export function openBoardSetup(app, { tab = 'rules' } = {}) {
  const m = modal({ title: 'Board setup', width: 720, cls: 'board-setup' });
  let cur = tab, filter = '';
  const board = () => app.project.board;
  /** One undoable change; errors become a toast. Redraws the dialog. */
  const edit = (label, fn) => {
    try { app.edit(label, fn); } catch (e) { toast(e.message, 'error', 3200); }
    render();
  };
  const tabs = h('div', { class: 'segmented setup-tabs', role: 'tablist', 'aria-label': 'Board setup' });
  const body = h('div', { class: 'setup-body' });
  m.body.append(tabs, body, h('div', { class: 'modal-actions' }, button({ label: 'Close', cls: 'btn-primary', onClick: () => m.close() })));

  function render() {
    tabs.replaceChildren(...[['rules', 'Design rules'], ['classes', 'Net classes']].map(([id, label]) => h('button', { class: 'btn' + (cur === id ? ' active' : ''), type: 'button', role: 'tab', 'aria-selected': String(cur === id), dataset: { tab: id }, onClick: () => { cur = id; render(); } }, label)));
    const active = document.activeElement?.getAttribute?.('aria-label');
    body.replaceChildren(...(cur === 'rules' ? rulesTab() : classesTab()));
    // keep the field being typed in focused across redraws
    if (active) body.querySelector(`[aria-label="${CSS.escape(active)}"]`)?.focus?.();
  }

  function rulesTab() {
    const b = board(), st = presetState(b);
    const fabSel = stop(h('select', { class: 'select', 'aria-label': 'Fab' }, ...FABS.map((f) => h('option', { value: f }, f))));
    fabSel.value = st.preset?.fab || 'Generic';
    const chosen = () => presetFor(fabSel.value, b.stack.copper);
    const note = h('p', { class: 'side-note preset-note' });
    const showNote = () => { const p = chosen(); note.textContent = `${p.name}: ${p.note}`; };
    fabSel.addEventListener('change', showNote);
    showNote();
    const apply = button({ label: 'Apply preset', cls: 'btn-primary', title: 'Copy the preset\'s values into the Design rules and Fab output settings (one undo step); you can edit them afterwards', onClick: () => {
      const p = chosen();
      edit(`Fab preset: ${p.name}`, (pr) => applyPreset(pr, p.id));
      toast(`Rules set from ${p.name}.`, 'info', 1800);
    } });
    const state = st.preset
      ? `Based on ${st.name}${st.edited.length ? ` · edited: ${st.edited.map((k) => RULE_FIELDS.find(([f]) => f === k)[1].toLowerCase()).join(', ')}` : ''}`
      : 'Custom rules';
    const mismatch = st.mismatch ? h('div', { class: 'outline-state bad' }, icon('info', 16), h('span', {}, `${st.name} is for ${st.preset.copper}-layer boards; this board has ${b.stack.copper} layers.`),
      button({ label: `Use ${st.preset.fab} ${b.stack.copper}-layer`, cls: 'btn-ghost', onClick: () => edit(`Fab preset: ${st.preset.fab} ${b.stack.copper}-layer`, (pr) => applyPreset(pr, presetFor(st.preset.fab, b.stack.copper).id)) })) : null;
    const rule = ([k, label, tip]) => {
      const i = stop(h('input', { class: 'input', type: 'number', step: '0.01', min: k === 'edgeClearance' ? '0' : '0.001', value: fmt(b.rules[k]), 'aria-label': label }));
      i.addEventListener('change', () => { const v = parseFloat(i.value); if (Number.isFinite(v)) edit(label, (pr) => setRule(pr, k, mm(v))); else render(); });
      const changed = st.preset && b.rules[k] !== st.preset.rules[k];
      return h('label', { class: 'field rule-field' + (changed ? ' edited' : ''), title: tip + (changed ? ` · the preset has ${fmt(st.preset.rules[k])} mm` : '') },
        h('span', {}, label, changed ? h('b', { class: 'edited-dot', 'aria-label': 'edited' }, ' •') : ''), h('div', { class: 'unit-input' }, i, h('em', {}, 'mm')));
    };
    const f = fabSettings(b);
    const naming = stop(h('select', { class: 'select', 'aria-label': 'Gerber file names' }, h('option', { value: 'protel' }, 'Protel extensions (.GTL, .GBL, .GKO…)'), h('option', { value: 'kicad' }, 'Descriptive (board-F_Cu.gbr…)')));
    naming.value = f.naming;
    naming.addEventListener('change', () => edit('Gerber file names', (pr) => { pr.board.fab = { ...fabSettings(pr.board), naming: naming.value }; }));
    const units = stop(h('select', { class: 'select', 'aria-label': 'Drill file units' }, h('option', { value: 'mm' }, 'Millimetres'), h('option', { value: 'inch' }, 'Inches')));
    units.value = f.drillUnits;
    units.addEventListener('change', () => edit('Drill units', (pr) => { pr.board.fab = { ...fabSettings(pr.board), drillUnits: units.value }; }));
    return [
      h('div', { class: 'setup-group' }, h('div', { class: 'setup-head' }, 'Fab preset'),
        h('div', { class: 'preset-row' }, h('label', { class: 'field' }, h('span', {}, `Board house (${b.stack.copper}-layer)`), fabSel), apply),
        note,
        h('div', { class: 'outline-state ok preset-state', role: 'status' }, icon('check', 16), h('span', {}, state)),
        mismatch,
        h('p', { class: 'side-note' }, 'A preset copies its values in; the board keeps its own copy, so edit any rule below. The preset name is kept for reference only. Check the house\'s current capabilities before ordering.')),
      h('div', { class: 'setup-group' }, h('div', { class: 'setup-head' }, 'Design rules (the Default net class)'),
        h('div', { class: 'rule-grid' }, ...RULE_FIELDS.map(rule))),
      h('div', { class: 'setup-group' }, h('div', { class: 'setup-head' }, 'Fab output'),
        h('div', { class: 'setup-grid' }, h('label', { class: 'field' }, h('span', {}, 'Gerber file names'), naming), h('label', { class: 'field' }, h('span', {}, 'Drill file units'), units)),
        h('p', { class: 'side-note' }, 'Used when the Gerber tab generates the fab files (#26).')),
    ];
  }

  function classesTab() {
    const b = board();
    const classes = Object.entries(b.netClasses || {});
    const head = h('div', { class: 'nc-row nc-head' }, h('span', {}, 'Class'), ...CLASS_FIELDS.map(([, l]) => h('span', {}, `${l} (mm)`)), h('span', {}, 'Nets'), h('span', {}));
    const count = (name) => boardNets(b).filter((n) => netClassOf(b, n) === name).length;
    const def = h('div', { class: 'nc-row nc-default', title: 'Nets in no class use the Design rules: edit them on the Design rules tab' },
      h('span', { class: 'nc-name' }, DEFAULT_CLASS), ...CLASS_FIELDS.map(([k]) => h('span', { class: 'nc-val' }, fmt(b.rules[k]))), h('span', { class: 'nc-count' }, String(count(DEFAULT_CLASS))),
      button({ icon: 'sliders', cls: 'btn-ghost btn-xs', title: 'Edit the Design rules', onClick: () => { cur = 'rules'; render(); } }));
    const rows = classes.map(([name, nc]) => {
      const nameIn = stop(h('input', { class: 'input', type: 'text', value: name, 'aria-label': `Class name ${name}` }));
      nameIn.addEventListener('change', () => { const to = nameIn.value.trim(); if (to && to !== name) edit(`Rename net class ${name}`, (pr) => renameNetClass(pr, name, to)); else render(); });
      const nums = CLASS_FIELDS.map(([k, l]) => {
        const i = stop(h('input', { class: 'input', type: 'number', step: '0.01', min: '0.001', value: fmt(nc[k]), 'aria-label': `${name} ${l}` }));
        i.addEventListener('change', () => { const v = parseFloat(i.value); if (Number.isFinite(v)) edit(`${name}: ${l.toLowerCase()}`, (pr) => setNetClassRule(pr, name, k, mm(v))); else render(); });
        return i;
      });
      return h('div', { class: 'nc-row' }, nameIn, ...nums, h('span', { class: 'nc-count' }, String((nc.nets || []).length)),
        button({ icon: 'trash', cls: 'btn-ghost btn-xs', title: `Delete ${name} (its nets go back to Default)`, onClick: () => edit(`Delete net class ${name}`, (pr) => deleteNetClass(pr, name)) }));
    });
    const add = button({ label: 'Add net class', icon: 'plus', cls: 'btn-outline', onClick: () => {
      let n = 1;
      while (Object.keys(b.netClasses || {}).some((k) => k.toLowerCase() === (n === 1 ? 'power' : `class ${n}`))) n++;
      const name = n === 1 ? 'Power' : `Class ${n}`;
      edit(`Add net class ${name}`, (pr) => addNetClass(pr, name));
      setTimeout(() => body.querySelector(`[aria-label="Class name ${name}"]`)?.select(), 0);
    } });
    // which class each Net is in
    const nets = boardNets(b);
    const search = stop(h('input', { class: 'input', type: 'search', placeholder: 'Filter nets', value: filter, 'aria-label': 'Filter nets' }));
    const list = h('div', { class: 'nc-nets', role: 'list' });
    const fill = () => {
      const q = filter.toLowerCase();
      const shown = nets.filter((n) => !q || n.toLowerCase().includes(q));
      list.replaceChildren(...(shown.length ? shown.map((n) => {
        const sel = stop(h('select', { class: 'select', 'aria-label': `Class of ${n}` }, h('option', { value: DEFAULT_CLASS }, DEFAULT_CLASS), ...classes.map(([c]) => h('option', { value: c }, c))));
        sel.value = netClassOf(b, n);
        sel.addEventListener('change', () => edit(`${n} to ${sel.value}`, (pr) => assignNet(pr, n, sel.value)));
        return h('div', { class: 'nc-net', role: 'listitem' }, h('span', { class: 'nc-net-name', title: n }, n), sel);
      }) : [h('p', { class: 'side-note' }, nets.length ? 'No net matches.' : 'No nets on the Board yet: Update from Schematic (F8) brings them over.')]));
    };
    search.addEventListener('input', () => { filter = search.value; fill(); });
    fill();
    return [
      h('div', { class: 'setup-group' }, h('div', { class: 'setup-head' }, 'Classes'),
        h('div', { class: 'nc-table' }, head, def, ...rows), h('div', { class: 'nc-actions' }, add),
        h('p', { class: 'side-note' }, 'New tracks take their net\'s class width and vias; clearance between two nets is the larger of their classes\'. Zones and DRC use the same rules.')),
      h('div', { class: 'setup-group' }, h('div', { class: 'setup-head' }, `Nets (${nets.length})`), search, list),
    ];
  }

  render();
  return m;
}

export { presetById };
