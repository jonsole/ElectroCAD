// Field styles UI (ADR-0012, docs/UI.md "Field styles"): the list of styles to choose from,
// Settings → Field styles (duplicate, edit, delete, import, export) and the style editor with a
// live preview of a crowded group of parts.
import { h, button, modal, toast, confirmDialog } from './dom.js';
import { platform } from '../platform.js';
import {
  BUILTIN_FIELD_STYLES, SLOTS, SLOT_LABEL, VALUE_FORMATS, duplicateFieldStyle, exportFieldStyle, importFieldStyle,
  FieldStyleError, setDefaultFieldStyle, placeFields,
} from '../core/fields.js';
import { newProject } from '../core/project.js';
import { placeSymbol, addWire } from '../core/schematic.js';
import { RESISTOR, CAPACITOR, LED } from '../library/mini.js';
import { ViewTransform } from '../view/transform.js';
import { drawSheet, measureText } from '../schematic/render.js';
import { mm, SCH_GRID as G } from '../core/units.js';

const customs = (app) => app.settings.customFieldStyles || [];

/** Every style the user can pick: built-ins, their own, and any only this Project carries. */
export function allFieldStyles(app) {
  const list = [...BUILTIN_FIELD_STYLES, ...customs(app)];
  for (const s of Object.values(app.project.fieldStyles?.styles || {})) if (!list.some((x) => x.id === s.id)) list.push({ ...s, fromProject: true });
  return list;
}

export function fieldStyleById(app, id) { return allFieldStyles(app).find((s) => s.id === id) || null; }

/** Settings → Field styles. */
export function fieldStylesSection(app) {
  const el = h('div', { class: 'colors-section' });
  let current = app.project.fieldStyles?.default || 'classic';
  const render = () => {
    const list = allFieldStyles(app);
    if (!list.some((s) => s.id === current)) current = 'classic';
    const sel = h('select', { class: 'select', 'aria-label': 'Field style to manage', dataset: { role: 'field-style-manage' } },
      ...list.map((s) => h('option', { value: s.id }, s.name + (s.builtin ? '' : s.fromProject ? ' (this project)' : ' (custom)'))));
    sel.value = current;
    sel.addEventListener('change', () => { current = sel.value; render(); });
    const style = list.find((s) => s.id === current);
    const isCustom = customs(app).some((s) => s.id === current);
    const editBtn = button({ label: 'Edit', icon: 'pencil', cls: 'btn-outline', title: isCustom ? 'Edit this style' : 'Built-in styles are read-only: duplicate one to edit it', onClick: () => fieldStyleEditor(app, style, render) });
    editBtn.disabled = !isCustom;
    const delBtn = button({ icon: 'trash', cls: 'btn-outline', title: isCustom ? 'Delete this style' : 'Built-in styles cannot be deleted', onClick: async () => {
      if (!(await confirmDialog('Delete field style', `"${style.name}" will be deleted from your styles. Projects that use it keep their own copy.`, 'Delete', true))) return;
      app.setCustomFieldStyles(customs(app).filter((s) => s.id !== style.id));
      current = 'classic'; render();
    } });
    delBtn.disabled = !isCustom;
    el.replaceChildren(h('div', { class: 'set-group-title' }, 'Field styles'),
      h('div', { class: 'theme-row' },
        h('label', { class: 'field' }, h('span', {}, 'Style'), sel),
        h('div', { class: 'theme-actions' },
          button({ label: 'Duplicate', icon: 'duplicate', cls: 'btn-outline', title: 'Copy this style to make your own', onClick: () => {
            const copy = duplicateFieldStyle(style, customs(app));
            app.setCustomFieldStyles([...customs(app), copy]);
            current = copy.id; render();
            fieldStyleEditor(app, copy, render);
          } }),
          editBtn, delBtn,
          button({ icon: 'import', cls: 'btn-outline', title: 'Import a field style (.json)', onClick: async () => {
            let file;
            try { file = await platform.importFile('theme'); } catch (err) { toast(`Couldn't read that file: ${err.message || err}`, 'error', 7000); return; }
            if (!file) return;
            try {
              const s = importFieldStyle(file.text, customs(app));
              app.setCustomFieldStyles([...customs(app), s]);
              current = s.id; render();
              toast(`Imported field style "${s.name}"`);
            } catch (err) { toast(err instanceof FieldStyleError ? `Couldn't import ${file.name}: ${err.message}` : `Couldn't import ${file.name}.`, 'error', 7000); }
          } }),
          button({ icon: 'export', cls: 'btn-outline', title: 'Export this style (.json)', onClick: async () => {
            const r = await platform.exportFile(`${style.name.replace(/[\\/:*?"<>|]/g, '-')}.json`, exportFieldStyle(style), 'theme');
            if (r) toast(platform.isDesktop ? `Saved ${r.name}` : `Downloaded ${r.name}`);
          } }))),
      h('p', { class: 'side-note' }, 'Pick the style a project uses in the Part picker\'s footer, or for selected parts with the Fields button.'));
  };
  render();
  return el;
}

/** Draw a small crowded group of parts with `style` as the default, for previews. */
export function drawFieldStylePreview(canvas, style, C) {
  const p = newProject();
  const s = p.schematic.sheets[0];
  setDefaultFieldStyle(p, style);
  const r1 = placeSymbol(p, s, RESISTOR, [G * 10, G * 10]); r1.comp.value = '4.7k';
  placeSymbol(p, s, RESISTOR, [G * 20, G * 10]).comp.value = '2.2';
  placeSymbol(p, s, CAPACITOR, [G * 30, G * 12], { rot: 90 }).comp.value = '0.1u';
  placeSymbol(p, s, RESISTOR, [G * 36, G * 12], { rot: 90 }).comp.value = '10k';
  placeSymbol(p, s, LED, [G * 16, G * 20]);
  addWire(p, s, [[G * 14, G * 10], [G * 16, G * 10]]);
  addWire(p, s, [[G * 24, G * 10], [G * 30, G * 10], [G * 30, G * 9]]);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = C.paper; ctx.fillRect(0, 0, canvas.width, canvas.height);
  const v = new ViewTransform();
  v.fit({ x0: G * 3, y0: G * 3, x1: G * 42, y1: G * 25 }, canvas.width, canvas.height, 8);
  drawSheet(ctx, v, C, p, s, { placement: placeFields(p, s, { measure: measureText }) });
}

const mmIn = (nm) => +(nm / 1e6).toFixed(2);

/** Edit a custom Field style; Save updates your styles and the open Project's copy. */
export function fieldStyleEditor(app, style, onDone) {
  const work = structuredClone(style);
  delete work.fromProject;
  const m = modal({ title: 'Edit field style', width: 900, cls: 'theme-editor field-style-editor' });
  const preview = h('canvas', { class: 'theme-preview', width: 420, height: 260 });
  const redraw = () => drawFieldStylePreview(preview, work, app.canvasColors('schematic'));
  const name = h('input', { class: 'input', type: 'text', value: work.name, maxlength: 60 });
  name.addEventListener('input', () => { work.name = name.value.trim() || style.name; });

  const slotList = (which) => {
    const el = h('div', { class: 'slot-list', dataset: { which } });
    const render = () => {
      const list = work.placement[which];
      const unused = SLOTS.filter((s) => !list.includes(s) && !(which === 'vertical' && s === 'split'));
      el.replaceChildren(...[
        ...list.map((slot, i) => h('div', { class: 'slot-row' },
          h('span', { class: 'slot-n' }, String(i + 1)), h('span', { class: 'slot-label' }, SLOT_LABEL[slot]),
          button({ icon: 'arrowUp', cls: 'btn-ghost', title: 'Try earlier', onClick: () => { if (i > 0) { [list[i - 1], list[i]] = [list[i], list[i - 1]]; render(); redraw(); } } }),
          button({ icon: 'arrowDown', cls: 'btn-ghost', title: 'Try later', onClick: () => { if (i < list.length - 1) { [list[i + 1], list[i]] = [list[i], list[i + 1]]; render(); redraw(); } } }),
          button({ icon: 'close', cls: 'btn-ghost', title: 'Remove', onClick: () => { if (list.length > 1) { list.splice(i, 1); render(); redraw(); } } }))),
        unused.length ? h('select', { class: 'select slot-add', 'aria-label': 'Add a position', onChange: (e) => { if (e.target.value) { list.push(e.target.value); render(); redraw(); } } },
          h('option', { value: '' }, '+ Add a position…'), ...unused.map((s) => h('option', { value: s }, SLOT_LABEL[s]))) : null].filter(Boolean));
    };
    render();
    return el;
  };
  const check = (label, get, set) => {
    const cb = h('input', { type: 'checkbox', checked: get() });
    cb.addEventListener('change', () => { set(cb.checked); redraw(); });
    return h('label', { class: 'check-row' }, cb, label);
  };
  const num = (label, get, set, min, max, step) => {
    const inp = h('input', { class: 'input', type: 'number', min, max, step, value: mmIn(get()), style: { width: '80px' } });
    inp.addEventListener('input', () => { const v = parseFloat(inp.value); if (v >= min && v <= max) { set(mm(v)); redraw(); } });
    return h('label', { class: 'le-row' }, h('span', {}, label), inp, h('em', {}, 'mm'));
  };
  const select = (label, options, get, set) => {
    const sel = h('select', { class: 'select' }, ...Object.entries(options).map(([v, t]) => h('option', { value: v }, t)));
    sel.value = get();
    sel.addEventListener('change', () => { set(sel.value); redraw(); });
    return h('label', { class: 'le-row' }, h('span', {}, label), sel, h('em', {}));
  };
  const save = () => {
    app.setCustomFieldStyles(customs(app).map((s) => (s.id === work.id ? work : s)));
    if (app.project.fieldStyles?.styles?.[work.id]) app.updateProjectFieldStyle(work);
    m.close();
    toast(`Saved "${work.name}"`);
    if (onDone) onDone();
  };
  m.body.append(
    h('div', { class: 'theme-editor-grid' },
      h('div', { class: 'theme-tokens' },
        h('label', { class: 'field' }, h('span', {}, 'Name'), name),
        h('div', { class: 'theme-group' }, 'Positions to try, horizontal parts'), slotList('horizontal'),
        h('div', { class: 'theme-group' }, 'Positions to try, vertical parts'), slotList('vertical'),
        h('div', { class: 'theme-group' }, 'Fields'),
        select('Arrangement', { stacked: 'Reference over Value', 'one-line': 'One line (R1 10k)' }, () => work.arrangement, (v) => { work.arrangement = v; }),
        check('Reference designator', () => work.show.reference, (v) => { work.show.reference = v; }),
        check('Value', () => work.show.value, (v) => { work.show.value = v; }),
        check('Hide Value when it is just the Part name (e.g. LED)', () => work.show.hideValueIfPartName, (v) => { work.show.hideValueIfPartName = v; }),
        check('Footprint', () => work.show.footprint, (v) => { work.show.footprint = v; }),
        check('MPN', () => work.show.mpn, (v) => { work.show.mpn = v; }),
        h('div', { class: 'theme-group' }, 'Text'),
        num('Size', () => work.text.size, (v) => { work.text.size = v; }, 0.3, 10, 0.05),
        num('Gap to part', () => work.text.gap, (v) => { work.text.gap = v; }, 0, 5, 0.05),
        check('Bold', () => work.text.bold, (v) => { work.text.bold = v; }),
        check('Italic', () => work.text.italic, (v) => { work.text.italic = v; }),
        select('Value format', VALUE_FORMATS, () => work.valueFormat, (v) => { work.valueFormat = v; })),
      h('div', {}, h('div', { class: 'side-note' }, 'Preview: a crowded group'), preview)),
    h('div', { class: 'modal-actions' },
      button({ label: 'Cancel', cls: 'btn-outline', onClick: () => m.close() }),
      button({ label: 'Save', cls: 'btn-primary', onClick: save })));
  redraw();
  return m;
}
