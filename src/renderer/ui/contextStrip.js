// The context strip: a small floating toolbar at the top of the canvas with the options for the
// tool in use (corner style while routing, corner radius for rectangles…) or the actions for what
// is selected (rotate, flip, delete…), so the main toolbar keeps only what always applies. Each
// editor says what to show from its refresh(); the strip rebuilds only when that changes, so a
// field being typed in keeps its focus.
import { h, button, icon } from './dom.js';

export class ContextStrip {
  constructor(label = 'Options') {
    this.el = h('div', { class: 'tool-strip context-strip', role: 'toolbar', 'aria-label': label, hidden: true });
    this.key = null;
    // clicks on the strip aren't clicks on the canvas
    for (const ev of ['pointerdown', 'mousedown', 'dblclick', 'wheel']) this.el.addEventListener(ev, (e) => e.stopPropagation(), { passive: ev === 'wheel' });
  }

  mount(host) { host.append(this.el); return this; }

  /**
   * Show the strip for `key` (any string naming the context and the values it shows), built by
   * `build()` -> [elements]. Null or an empty build hides it.
   */
  show(key, build) {
    if (!key) { this.hide(); return; }
    if (key === this.key && !this.el.hidden) return;
    const kids = (build() || []).filter(Boolean);
    this.key = key;
    if (!kids.length) { this.el.hidden = true; return; }
    this.el.replaceChildren(...kids);
    this.el.hidden = false;
  }

  hide() { this.key = null; this.el.hidden = true; }
}

// ---------------------------------------------------------------- the pieces

const stop = (el) => { el.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' && el.tagName === 'INPUT') el.blur(); if (e.key === 'Escape') el.blur(); }); return el; };

/** The strip's title: what the options are for. */
export const stripLabel = (text, ic = null) => h('span', { class: 'tool-strip-label' }, ic ? icon(ic, 15) : null, text);
export const stripSep = () => h('span', { class: 'sep' });

/** An icon (and optional label) button. */
export function stripButton({ icon: ic, label, title, onClick, active = false, danger = false, disabled = false }) {
  const b = button({ icon: ic, label, title, cls: 'btn-ghost strip-btn' + (danger ? ' strip-danger' : ''), onClick });
  if (active) b.classList.add('active');
  b.disabled = disabled;
  return b;
}

/** A number field with its unit; onSet(value) on change or Enter. */
export function stripNumber({ label, value, unit = '', step = '0.05', min = '0', max = null, onSet, width = 64, title = '', placeholder = '' }) {
  const i = stop(h('input', { class: 'input', type: 'number', step, min, ...(max != null ? { max } : {}), value: value == null ? '' : String(value), placeholder, 'aria-label': label, style: { width: width + 'px' } }));
  i.addEventListener('change', () => { const v = parseFloat(i.value); if (Number.isFinite(v)) onSet(v); });
  return h('label', { class: 'strip-field', title: title || label }, h('span', {}, label), i, unit ? h('em', {}, unit) : null);
}

/** A select; options [[value, text]]; onSet(value). */
export function stripSelect({ label, value, options, onSet, title = '', showLabel = true }) {
  const s = stop(h('select', { class: 'select', 'aria-label': label }, ...options.map(([v, t]) => h('option', { value: String(v) }, t))));
  s.value = String(value);
  s.addEventListener('change', () => onSet(s.value));
  return h('label', { class: 'strip-field', title: title || label }, showLabel ? h('span', {}, label) : null, s);
}

/** A segmented choice: items [[id, text, title]]. */
export function stripSegmented({ label, items, value, onPick }) {
  return h('div', { class: 'segmented strip-seg', role: 'radiogroup', 'aria-label': label },
    ...items.map(([id, text, title]) => h('button', { class: 'btn' + (id === value ? ' active' : ''), type: 'button', role: 'radio', 'aria-checked': String(id === value), title: title || text, dataset: { value: id }, onClick: () => onPick(id) }, text)));
}
