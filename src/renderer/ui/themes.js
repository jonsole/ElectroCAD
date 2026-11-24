// Settings → Colours: choose the Schematic and Board Colour themes, and duplicate, edit,
// rename, delete, import and export custom ones (#51, docs/UI.md).
import { h, button, modal, toast, confirmDialog } from './dom.js';
import { platform } from '../platform.js';
import { TOKENS, MATCH_APP, listThemes, getTheme, duplicateTheme, importTheme, exportTheme, sourceValue, ThemeError } from '../core/themes.js';
import { drawThemePreview } from '../view/themePreview.js';

const KIND_LABEL = { schematic: 'Schematic', board: 'Board' };
const ui = (app) => (app.settings.theme === 'light' ? 'light' : 'dark');
const customs = (app) => app.settings.customThemes || [];
const chosen = (app, kind) => (app.settings.colorThemes || {})[kind] || MATCH_APP;

/** The Colours block of the Settings dialog. */
export function colorsSection(app) {
  const el = h('div', { class: 'colors-section' });
  const render = () => el.replaceChildren(h('div', { class: 'set-group-title' }, 'Colours'), ...['schematic', 'board'].map((kind) => themeRow(app, kind, render)),
    h('p', { class: 'side-note' }, 'Colour themes are kept with your app settings, not in project files.'));
  render();
  return el;
}

function themeRow(app, kind, rerender) {
  const current = chosen(app, kind);
  const sel = h('select', { class: 'select', 'aria-label': `${KIND_LABEL[kind]} colour theme`, dataset: { kind } },
    ...listThemes(kind, customs(app)).map((t) => h('option', { value: t.id }, t.name + (t.builtin ? '' : ' (custom)'))));
  sel.value = current;
  sel.addEventListener('change', () => { app.setColorTheme(kind, sel.value); rerender(); });
  const isCustom = !getTheme(kind, current, customs(app)).builtin;
  const duplicate = () => {
    const t = duplicateTheme(kind, current, ui(app), customs(app));
    app.setCustomThemes([...customs(app), t]);
    app.setColorTheme(kind, t.id);
    rerender();
    themeEditor(app, t, rerender);
  };
  const edit = () => themeEditor(app, getTheme(kind, current, customs(app)), rerender);
  const del = async () => {
    const t = getTheme(kind, current, customs(app));
    if (!(await confirmDialog('Delete colour theme', `"${t.name}" will be deleted. Canvases using it go back to Match app.`, 'Delete', true))) return;
    app.setCustomThemes(customs(app).filter((x) => x.id !== t.id));
    rerender();
  };
  const imp = async () => {
    let file;
    try { file = await platform.importFile('theme'); } catch (err) { toast(`Couldn't read that file: ${err.message || err}`, 'error', 7000); return; }
    if (!file) return;
    let t;
    try { t = importTheme(file.text, customs(app)); } catch (err) {
      toast(err instanceof ThemeError ? `Couldn't import ${file.name}: ${err.message}` : `Couldn't import ${file.name}.`, 'error', 7000);
      return;
    }
    app.setCustomThemes([...customs(app), t]);
    app.setColorTheme(t.kind, t.id);
    toast(`Imported "${t.name}" as the ${KIND_LABEL[t.kind]} theme`);
    rerender();
  };
  const exp = async () => {
    const t = getTheme(kind, current, customs(app));
    const out = t.builtin ? { kind, name: t.name, colors: app.canvasColors(kind) } : t;
    const r = await platform.exportFile(`${t.name.replace(/[\\/:*?"<>|]/g, '-')}.json`, exportTheme(out), 'theme');
    if (r) toast(platform.isDesktop ? `Saved ${r.name}` : `Downloaded ${r.name}`);
  };
  const editBtn = button({ label: 'Edit', icon: 'pencil', cls: 'btn-outline', title: isCustom ? 'Edit this theme' : 'Built-in themes are read-only: duplicate one to edit it', onClick: edit });
  editBtn.disabled = !isCustom;
  const delBtn = button({ icon: 'trash', cls: 'btn-outline', title: isCustom ? 'Delete this theme' : 'Built-in themes cannot be deleted', onClick: del });
  delBtn.disabled = !isCustom;
  return h('div', { class: 'theme-row' },
    h('label', { class: 'field' }, h('span', {}, `${KIND_LABEL[kind]} colours`), sel),
    h('div', { class: 'theme-actions' },
      button({ label: 'Duplicate', icon: 'duplicate', cls: 'btn-outline', title: 'Copy this theme to make your own', onClick: duplicate }),
      editBtn, delBtn,
      button({ icon: 'import', cls: 'btn-outline', title: 'Import a colour theme (.json)', onClick: imp }),
      button({ icon: 'export', cls: 'btn-outline', title: 'Export this theme (.json)', onClick: exp })));
}

const toHex6 = (c) => {
  if (/^#[0-9a-f]{3}$/i.test(c)) return '#' + c.slice(1).split('').map((x) => x + x).join('');
  return c.slice(0, 7);
};

/** Edit a custom theme: name, every colour, live preview. Changes apply on Save. */
export function themeEditor(app, theme, onDone) {
  const work = structuredClone(theme);
  const m = modal({ title: `Edit colour theme`, width: 860, cls: 'theme-editor' });
  const preview = h('canvas', { class: 'theme-preview', width: 420, height: 260, 'aria-label': 'Preview' });
  const redraw = () => drawThemePreview(preview, work.kind, work.colors);
  const name = h('input', { class: 'input', type: 'text', value: work.name, maxlength: 60 });
  name.addEventListener('input', () => { work.name = name.value.trim() || theme.name; });
  const groups = {};
  for (const tok of TOKENS[work.kind]) (groups[tok.group] ||= []).push(tok);
  const rowFor = (tok) => {
    let input;
    if (tok.type === 'number') {
      input = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: work.colors[tok.id], 'aria-label': tok.label });
      input.addEventListener('input', () => { work.colors[tok.id] = +input.value; redraw(); });
    } else {
      input = h('input', { type: 'color', value: toHex6(work.colors[tok.id]), 'aria-label': tok.label, dataset: { token: tok.id } });
      input.addEventListener('input', () => { work.colors[tok.id] = input.value; redraw(); });
    }
    const reset = button({ icon: 'undo', cls: 'btn-ghost', title: 'Reset to the theme this one was copied from', onClick: () => {
      const v = sourceValue(work, tok.id, ui(app), customs(app));
      work.colors[tok.id] = v;
      input.value = tok.type === 'number' ? v : toHex6(v);
      redraw();
    } });
    return h('div', { class: 'theme-token' }, h('span', {}, tok.label), input, reset);
  };
  const list = h('div', { class: 'theme-tokens' },
    ...Object.entries(groups).flatMap(([g, toks]) => [h('div', { class: 'theme-group' }, g), ...toks.map(rowFor)]));
  const save = () => {
    const next = customs(app).map((t) => (t.id === work.id ? work : t));
    app.setCustomThemes(next);
    m.close();
    toast(`Saved "${work.name}"`);
    if (onDone) onDone();
  };
  m.body.append(
    h('div', { class: 'theme-editor-grid' },
      h('div', {}, h('label', { class: 'field' }, h('span', {}, 'Name'), name), list),
      h('div', {}, h('div', { class: 'side-note' }, `${KIND_LABEL[work.kind]} preview`), preview)),
    h('div', { class: 'modal-actions' },
      button({ label: 'Cancel', cls: 'btn-outline', onClick: () => m.close() }),
      button({ label: 'Save', cls: 'btn-primary', onClick: save })));
  redraw();
  return m;
}
