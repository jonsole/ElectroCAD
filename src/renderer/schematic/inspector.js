// Schematic inspector (#9): a floating card at the top right of the canvas, like DabbleCAD's
// 3D Design inspector. For one selected part it edits the Reference designator, Value,
// Footprint, Field style, position/rotation/mirror, MPN and custom fields; for several it offers
// the Field style and the shared commands. Every change is one undo step.
import { h, button, toast } from '../ui/dom.js';
import { validateRef, updateComponent, footprintChoices, footprintKey } from '../core/components.js';
import { moveSelection, rotateSymbols, mirrorSymbols, cleanupWires, placedUnits, setSymbolUnit, unitLetter } from '../core/schematic.js';
import { setComponentFieldStyle, styleFor, hasPinnedFields } from '../core/fields.js';
import { allFieldStyles, fieldStyleById } from '../ui/fieldStyles.js';
import { partOf } from '../core/project.js';
import { validateLabelName, isPower, netNameChoices, canonicalNetName } from '../core/labels.js';
import { snap, SCH_GRID, mm } from '../core/units.js';

const fmtMm = (nm) => String(+(nm / 1e6).toFixed(2));

export class SchematicInspector {
  constructor(editor) {
    this.ed = editor;
    this.el = h('div', { class: 'inspector', role: 'region', 'aria-label': 'Inspector' });
    this.sig = '';
  }

  get app() { return this.ed.app; }
  get project() { return this.ed.project; }

  /**
   * Re-render when the selection or the selected items change. While the user is typing in a box
   * and nothing underneath changed, leave it alone; when something did change (undo, an edit from
   * elsewhere), re-render and put the cursor back in the same box.
   */
  render() {
    const syms = this.ed.sheet.symbols.filter((y) => this.ed.selection.has(y.id));
    const wires = this.ed.sheet.wires.filter((w) => this.ed.selection.has(w.id));
    const labels = (this.ed.sheet.labels || []).filter((l) => this.ed.selection.has(l.id));
    const drawings = (this.ed.sheet.drawings || []).filter((d) => this.ed.selection.has(d.id));
    const comps = syms.map((y) => this.project.components[y.componentId]);
    const sig = JSON.stringify([[...this.ed.selection], syms, wires.length, labels, drawings, comps, this.project.fieldStyles?.default]);
    const focused = this.el.contains(document.activeElement) ? document.activeElement : null;
    const typing = focused && /^(INPUT|TEXTAREA)$/.test(focused.tagName);
    if (typing && sig === this.sig) return;
    this.sig = sig;
    if (!syms.length && !wires.length && !labels.length && !drawings.length) { this.el.replaceChildren(); return; }
    if (drawings.length === 1 && !syms.length && !labels.length && !wires.length) { this._drawing(drawings[0]); return this._refocus(focused); }
    if (syms.length === 1 && !labels.length) this._one(syms[0], wires.length);
    else if (labels.length === 1 && !syms.length) this._label(labels[0], wires.length);
    else this._many(syms, wires, labels);
    this._refocus(focused);
  }

  _refocus(focused) {
    if (focused && focused.getAttribute('aria-label')) {
      const again = this.el.querySelector(`[aria-label="${CSS.escape(focused.getAttribute('aria-label'))}"]`);
      if (again) again.focus({ preventScroll: true });
    }
  }

  /**
   * The card header, as in DabbleCAD: the title (drag it to move the card) and icon buttons for
   * the commands that apply to the selection.
   */
  _head(title, sub, { rotate = true, mirror = false } = {}) {
    const ed = this.ed;
    return h('div', { class: 'insp-head', title: 'Drag to move · double-click here to put the card back' },
      h('div', { class: 'insp-title', title }, title, sub ? h('span', { class: 'insp-sub' }, ' · ' + sub) : null),
      rotate ? button({ icon: 'rotate', title: 'Rotate (R)', onClick: () => ed.rotate() }) : null,
      mirror ? button({ icon: 'mirror', title: 'Mirror (X)', onClick: () => ed.mirror() }) : null,
      button({ icon: 'duplicate', title: 'Duplicate (Ctrl+D)', onClick: () => ed.duplicate() }),
      button({ icon: 'trash', title: 'Delete (Del)', onClick: () => ed.deleteSelection() }));
  }

  _edit(label, fn) {
    try { this.app.edit(label, fn); return true; } catch (err) { return err.message || String(err); }
  }

  _text(label, value, onCommit, { placeholder = '', ariaLabel } = {}) {
    const input = h('input', { class: 'input', type: 'text', value: value ?? '', placeholder, 'aria-label': ariaLabel || label, spellcheck: false });
    const err = h('div', { class: 'insp-error' });
    const commit = () => {
      if (input.value === (value ?? '')) return;
      const r = onCommit(input.value);
      if (r === true || r === undefined) { err.textContent = ''; value = input.value; return; }
      err.textContent = r; input.classList.add('bad'); input.focus();
    };
    input.addEventListener('input', () => { input.classList.remove('bad'); err.textContent = ''; });
    input.addEventListener('change', commit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { commit(); input.blur(); } if (e.key === 'Escape') { input.value = value ?? ''; input.blur(); } e.stopPropagation(); });
    return h('div', { class: 'param param-wide' }, h('label', {}, label), input, err);
  }

  _one(sym, extraWires) {
    const comp = this.project.components[sym.componentId];
    const part = partOf(this.project, comp);
    const unitTag = part.units.length > 1 ? String.fromCharCode(65 + (sym.unit || 0)) : '';
    const rows = [];
    rows.push(this._text('Reference', comp.ref, (v) => {
      const bad = validateRef(this.project, comp.id, v);
      if (bad) return bad;
      return this._edit(`Rename ${comp.ref} to ${v.trim()}`, (p) => updateComponent(p, comp.id, { ref: v }));
    }));
    rows.push(this._text('Value', comp.value, (v) => this._edit(`${comp.ref} value`, (p) => updateComponent(p, comp.id, { value: v }))));

    // multi-Unit Parts: which Unit this Symbol is; swap to any Unit not placed elsewhere (#10)
    if (part.units.length > 1) {
      const placed = placedUnits(this.project, comp.id);
      const sel = h('select', { class: 'select', 'aria-label': 'Unit' }, ...part.units.map((u, i) => {
        const power = u.pins.length && u.pins.every((x) => x.type === 'power_in');
        const taken = placed.has(i) && i !== sym.unit;
        return h('option', { value: String(i), disabled: taken }, `${unitLetter(part, i)}${power ? ' (power)' : ''}${taken ? ' (placed)' : ''}`);
      }));
      sel.value = String(sym.unit || 0);
      sel.addEventListener('change', () => this._edit(`${comp.ref}: Unit ${unitLetter(part, +sel.value)}`, (p) => setSymbolUnit(p, sym.id, +sel.value)));
      const missing = part.units.map((_, i) => i).filter((i) => !placed.has(i)).map((i) => unitLetter(part, i));
      rows.push(h('div', { class: 'param param-wide' }, h('label', {}, 'Unit'), sel,
        missing.length ? h('div', { class: 'insp-note' }, `Not placed yet: ${comp.ref}${missing.join(', ' + comp.ref)}`) : null));
    }

    // Footprint: Preferred first, then any other (identity Pin map)
    const ch = footprintChoices(this.project, comp, this.ed.parts, this.ed.allFootprints());
    const fpSel = h('select', { class: 'select', 'aria-label': 'Footprint', dataset: { role: 'footprint' } },
      ch.preferred.length ? h('optgroup', { label: 'Preferred' }, ...ch.preferred.map((c) => h('option', { value: c.key }, c.label))) : null,
      ch.other.length ? h('optgroup', { label: 'Other footprints (pins map by number)' }, ...ch.other.map((c) => h('option', { value: c.key }, c.label))) : null);
    fpSel.value = footprintKey(this.project, comp);
    fpSel.addEventListener('change', () => {
      const c = [...ch.preferred, ...ch.other].find((x) => x.key === fpSel.value);
      if (c) this._edit(`${comp.ref} footprint`, (p) => updateComponent(p, comp.id, { footprint: c.value }));
    });
    rows.push(h('div', { class: 'param param-wide' }, h('label', {}, 'Footprint'), fpSel));

    rows.push(this._fieldStyle([comp.id]));
    if (hasPinnedFields(sym)) {
      const n = Object.keys(sym.fieldPins).length;
      rows.push(h('div', { class: 'insp-row-btns' },
        h('span', { class: 'insp-note', style: { flex: 1, margin: 0 } }, `${n} field${n === 1 ? '' : 's'} moved by hand`),
        button({ icon: 'wand', label: 'Re-apply style', cls: 'btn-outline', title: 'Let the Field style place these fields again', onClick: () => this.ed.reapplyStyle() })));
    }

    // position, rotation, mirror
    const posInput = (axis) => {
      const inp = h('input', { class: 'input', type: 'number', step: 1.27, value: fmtMm(sym.at[axis]), 'aria-label': axis ? 'Y (mm)' : 'X (mm)' });
      inp.addEventListener('keydown', (e) => e.stopPropagation());
      inp.addEventListener('change', () => {
        const v = parseFloat(inp.value);
        if (!Number.isFinite(v)) { inp.value = fmtMm(sym.at[axis]); return; }
        const target = snap(mm(v), SCH_GRID);
        const delta = axis ? [0, target - sym.at[1]] : [target - sym.at[0], 0];
        if (delta[0] || delta[1]) this._edit(`Move ${comp.ref}`, (p) => { moveSelection(p, this.ed._S(p), [sym.id], delta); cleanupWires(p, this.ed._S(p)); });
        else inp.value = fmtMm(sym.at[axis]);
      });
      return inp;
    };
    const rot = h('select', { class: 'select', 'aria-label': 'Rotation' }, ...[0, 90, 180, 270].map((d) => h('option', { value: d }, `${d}°`)));
    rot.value = String(sym.rot || 0);
    rot.addEventListener('change', () => {
      const steps = ((+rot.value - (sym.rot || 0)) / 90 + 4) % 4;
      if (steps) this._edit(`Rotate ${comp.ref}`, (p) => { for (let i = 0; i < steps; i++) rotateSymbols(p, [sym.id]); });
    });
    const mir = h('input', { type: 'checkbox', checked: !!sym.mirror, 'aria-label': 'Mirrored' });
    mir.addEventListener('change', () => this._edit(`Mirror ${comp.ref}`, (p) => mirrorSymbols(p, [sym.id])));
    rows.push(h('div', { class: 'xy' }, h('span', {}, 'X'), posInput(0), h('span', {}, 'Y'), posInput(1), h('em', {}, 'mm')),
      h('div', { class: 'xy' }, h('span', {}, 'Rot'), rot, h('label', { class: 'check' }, mir, 'Mirror')));

    // MPN and custom fields (collapsible, like the fork's inspector sections)
    const mpn = comp.mpn || { manufacturer: '', number: '' };
    const mpnRows = [
      this._text('Manufacturer', mpn.manufacturer, (v) => this._edit(`${comp.ref} manufacturer`, (p) => updateComponent(p, comp.id, { mpn: { ...(p.components[comp.id].mpn || {}), manufacturer: v } }))),
      this._text('Part number (MPN)', mpn.number, (v) => this._edit(`${comp.ref} MPN`, (p) => updateComponent(p, comp.id, { mpn: { ...(p.components[comp.id].mpn || {}), number: v } }))),
    ];
    const fieldRows = Object.entries(comp.fields || {}).map(([k, v]) => h('div', { class: 'kv-row' },
      h('span', { class: 'kv-key', title: k }, k),
      (() => { const inp = h('input', { class: 'input', type: 'text', value: v, 'aria-label': k }); inp.addEventListener('keydown', (e) => e.stopPropagation());
        inp.addEventListener('change', () => this._edit(`${comp.ref} ${k}`, (p) => updateComponent(p, comp.id, { fields: { ...p.components[comp.id].fields, [k]: inp.value } }))); return inp; })(),
      button({ icon: 'close', cls: 'btn-ghost', title: `Remove ${k}`, onClick: () => this._edit(`${comp.ref} remove ${k}`, (p) => { const f = { ...p.components[comp.id].fields }; delete f[k]; updateComponent(p, comp.id, { fields: f }); }) })));
    const newKey = h('input', { class: 'input', type: 'text', placeholder: 'New field, e.g. Tolerance', 'aria-label': 'New field name' });
    newKey.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && newKey.value.trim()) {
        const k = newKey.value.trim();
        this._edit(`${comp.ref} add ${k}`, (p) => updateComponent(p, comp.id, { fields: { ...p.components[comp.id].fields, [k]: '' } }));
      }
    });
    const sections = [
      h('details', { class: 'insp-section', open: !!comp.mpn }, h('summary', {}, 'Ordering'), ...mpnRows),
      h('details', { class: 'insp-section', open: Object.keys(comp.fields || {}).length > 0 }, h('summary', {}, 'Custom fields'), ...fieldRows, newKey),
    ];
    const note = extraWires ? h('div', { class: 'insp-note' }, `and ${extraWires} wire${extraWires === 1 ? '' : 's'}`) : null;
    this.el.replaceChildren(this._head(comp.ref + unitTag, part.name, { mirror: true }), h('div', { class: 'insp-body' }, note, ...rows), ...sections);
  }

  _fieldStyle(compIds) {
    const comps = compIds.map((id) => this.project.components[id]);
    const own = new Set(comps.map((c) => c.fieldStyle || ''));
    const def = this.project.fieldStyles?.default || 'classic';
    const defName = (fieldStyleById(this.app, def) || styleFor(this.project, null)).name;
    const sel = h('select', { class: 'select', 'aria-label': 'Field style', dataset: { role: 'field-style-part' } },
      h('option', { value: '' }, `Project default (${defName})`),
      ...allFieldStyles(this.app).map((s) => h('option', { value: s.id }, s.name)),
      own.size > 1 ? h('option', { value: '*', disabled: true }, 'Mixed') : null);
    sel.value = own.size > 1 ? '*' : [...own][0];
    sel.addEventListener('change', () => {
      const style = sel.value ? fieldStyleById(this.app, sel.value) : null;
      this._edit('Field style', (p) => setComponentFieldStyle(p, compIds, style));
    });
    return h('div', { class: 'param param-wide' }, h('label', {}, 'Field style'), sel);
  }

  /** One Net label, Global label or Power symbol: its name, kind, position and rotation. */
  _label(l, extraWires) {
    const kind = l.style === 'gnd' ? 'Ground' : isPower(l) ? 'Power symbol' : l.scope === 'global' ? 'Global label' : 'Net label';
    const rows = [];
    const rename = (v) => {
      const bad = validateLabelName(v);
      if (bad) return bad;
      // names match regardless of case: use the spelling the Net already has (ADR-0013)
      const name = canonicalNetName(this.project, v, l.id);
      if (name !== v.trim()) toast(`${v.trim()} is the same net as ${name}, so it uses that spelling.`, 'info', 3500);
      if (name === l.net) { this.render(); return true; }
      if (l.style === 'power') this.ed.nextName.power = name;
      return this._edit(`Rename ${l.net} to ${name}`, (p) => { this._find(p, l.id).net = name; });
    };
    if (isPower(l) && l.style !== 'gnd') {
      // a real list of every power net (a <datalist> would only show the one already typed)
      const sel = h('select', { class: 'select', 'aria-label': 'Power net' }, ...netNameChoices(this.project, l).map((n) => h('option', { value: n }, n)));
      sel.value = l.net;
      sel.addEventListener('change', () => { const r = rename(sel.value); if (r !== true && r !== undefined) sel.value = l.net; });
      rows.push(h('div', { class: 'param param-wide' }, h('label', {}, 'Power net'), sel));
      rows.push(this._text('New net', '', rename, { placeholder: 'Or type one, e.g. +2V5', ariaLabel: 'Net name' }));
    } else rows.push(this._text('Net name', l.net, rename));
    if (!isPower(l)) {
      const sel = h('select', { class: 'select', 'aria-label': 'Label scope' },
        h('option', { value: 'local' }, 'Net label: this sheet only'),
        h('option', { value: 'global' }, 'Global label: every sheet'));
      sel.value = l.scope === 'global' ? 'global' : 'local';
      sel.addEventListener('change', () => this._edit(sel.value === 'global' ? `Make ${l.net} global` : `Make ${l.net} local`, (p) => { this._find(p, l.id).scope = sel.value; }));
      rows.push(h('div', { class: 'param param-wide' }, h('label', {}, 'Joins'), sel));
    } else {
      rows.push(h('div', { class: 'insp-note' }, 'Power symbols join every pin with the same name, on every sheet.'));
    }
    const rot = h('select', { class: 'select', 'aria-label': 'Rotation' }, ...[0, 90, 180, 270].map((r) => h('option', { value: String(r) }, `${r}°`)));
    rot.value = String(l.rot || 0);
    rot.addEventListener('change', () => this._edit(`Rotate ${l.net}`, (p) => { this._find(p, l.id).rot = Number(rot.value); }));
    rows.push(h('div', { class: 'param' }, h('label', {}, 'Rotation'), rot));
    if (extraWires) rows.push(h('div', { class: 'insp-note' }, `and ${extraWires} wire${extraWires === 1 ? '' : 's'}`));
    this.el.replaceChildren(this._head(l.net, kind), h('div', { class: 'insp-body' }, ...rows));
  }

  /** One piece of markup (#59): text (content, size, style, alignment, rotation) or a line/shape (style, arrows, fill). */
  _drawing(d) {
    const set = (label, fn) => this._edit(label, (p) => { const x = (this.ed._S(p).drawings || []).find((y) => y.id === d.id); if (x) fn(x); });
    const sel = (label, value, options, onChange) => {
      const s = h('select', { class: 'select', 'aria-label': label }, ...options.map(([v, t]) => h('option', { value: v }, t)));
      s.value = String(value);
      s.addEventListener('change', () => onChange(s.value));
      return h('div', { class: 'param' }, h('label', {}, label), s);
    };
    const check = (label, value, onChange) => {
      const c = h('input', { type: 'checkbox', checked: !!value, 'aria-label': label });
      c.addEventListener('change', () => onChange(c.checked));
      return h('label', { class: 'check-row' }, c, label);
    };
    const styles = [['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted']];
    const rows = [];
    let title;
    if (d.type === 'text') {
      title = 'Text note';
      const area = h('textarea', { class: 'input insp-textarea', rows: Math.max(2, d.text.split('\n').length), 'aria-label': 'Text', spellcheck: false }, d.text);
      area.addEventListener('change', () => { const v = area.value.replace(/\s+$/, ''); if (v) set('Edit text', (x) => { x.text = v; }); });
      area.addEventListener('keydown', (e) => e.stopPropagation());
      const size = h('input', { class: 'input', type: 'number', min: '0.5', max: '20', step: '0.25', value: String(+(d.size / 1e6).toFixed(2)), 'aria-label': 'Text size (mm)' });
      size.addEventListener('change', () => { const n = Number(size.value); if (n > 0) set('Text size', (x) => { x.size = Math.round(n * 1e6); }); });
      size.addEventListener('keydown', (e) => e.stopPropagation());
      rows.push(h('div', { class: 'param param-wide' }, h('label', {}, 'Text'), area, h('div', { class: 'insp-note' }, 'Shown filled in: ${TITLE}, ${REV}, ${DATE}, ${SHEET_NAME}, ${SHEET_NUMBER}, ${SHEET_COUNT}…')),
        h('div', { class: 'param' }, h('label', {}, 'Size (mm)'), size),
        sel('Align', d.align, [['left', 'Left'], ['center', 'Centre'], ['right', 'Right']], (v) => set('Align text', (x) => { x.align = v; })),
        sel('Rotation', d.rot || 0, [['0', '0°'], ['90', '90°']], (v) => set('Rotate text', (x) => { x.rot = Number(v); })),
        h('div', { class: 'insp-checks' }, check('Bold', d.bold, (v) => set('Bold', (x) => { x.bold = v; })), check('Italic', d.italic, (v) => set('Italic', (x) => { x.italic = v; }))));
    } else {
      title = { line: 'Line', rect: 'Rectangle', circle: 'Circle', arc: 'Arc' }[d.type];
      rows.push(sel('Line', d.style, styles, (v) => set('Line style', (x) => { x.style = v; })));
      if (d.type === 'line') rows.push(h('div', { class: 'insp-checks' }, check('Arrow at start', d.arrowStart, (v) => set('Arrow', (x) => { x.arrowStart = v; })), check('Arrow at end', d.arrowEnd, (v) => set('Arrow', (x) => { x.arrowEnd = v; }))));
      if (d.type === 'rect' || d.type === 'circle') rows.push(h('div', { class: 'insp-checks' }, check('Light fill', d.fill === 'tint', (v) => set('Fill', (x) => { x.fill = v ? 'tint' : 'none'; }))));
    }
    rows.push(h('div', { class: 'insp-note' }, 'Markup never connects to wires or pins.'));
    this.el.replaceChildren(this._head(title, null, { rotate: true }), h('div', { class: 'insp-body' }, ...rows));
  }

  _find(p, id) { return (this.ed._S(p).labels || []).find((x) => x.id === id); }

  _many(syms, wires, labels = []) {
    const compIds = [...new Set(syms.map((y) => y.componentId))];
    const parts = [syms.length ? `${syms.length} part${syms.length === 1 ? '' : 's'}` : null, labels.length ? `${labels.length} label${labels.length === 1 ? '' : 's'}` : null, wires.length ? `${wires.length} wire${wires.length === 1 ? '' : 's'}` : null].filter(Boolean).join(', ');
    const rows = [];
    if (syms.length) {
      const refs = syms.map((y) => this.project.components[y.componentId].ref).sort();
      rows.push(h('div', { class: 'insp-note' }, refs.slice(0, 12).join(', ') + (refs.length > 12 ? '…' : '')));
      rows.push(this._fieldStyle(compIds));
    }
    if (!rows.length) rows.push(h('div', { class: 'insp-note' }, 'Drag to move them; the wires follow.'));
    this.el.replaceChildren(this._head(parts + ' selected', null, { rotate: !!(syms.length || labels.length), mirror: !!syms.length }), h('div', { class: 'insp-body' }, ...rows));
  }
}

