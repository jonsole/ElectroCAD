// Field styles journey (#52): parts close together never get overlapping fields; switching the
// Project default (Compact, RKM values) and a per-part override redraw the fields; each is one
// undo step; the choice is saved with the Project.
const app = window.electrocad;
const fails = [];
const out = {};
const check = (name, cond, info) => { if (!cond) fails.push(name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); };
const ws = app.workspace('schematic');
const ed = ws.editor;
const G = 1270000;
const byName = (n) => ed.parts.find((x) => x.name === n);
const [R, C, L] = [byName('Resistor'), byName('Capacitor'), byName('LED')];
const put = (part, x, y, rot = 0, value) => {
  ed.beginPlace(part); ed.placing.rot = rot; ed.placing.at = [x * G, y * G];
  const r = ed.commitPlace(); ed.endPlace();
  if (value) app.edit('value', (p) => { p.components[r.comp.id].value = value; });
  return r;
};
put(R, 50, 40, 0, '4.7k'); put(R, 58, 40, 0, '2.2'); put(R, 66, 40, 0, '330');
put(C, 46, 48, 90, '0.1u'); put(C, 52, 48, 90, '10u'); put(R, 58, 48, 90, '1M'); put(L, 66, 50, 90);
const draw = () => { ws.view.view.fit({ x0: 40 * G, y0: 33 * G, x1: 76 * G, y1: 58 * G }, ws.view.w, ws.view.h, 20); ws.view.draw(); return ed.placement; };
const boxes = (pl) => [...pl.values()].flatMap((r) => r.items.map((i) => ({ ...i.box, text: i.text })));
const overlaps = (pl) => {
  const bs = boxes(pl); const bad = [];
  for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
    const a = bs[i], b = bs[j];
    if (a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1) bad.push(a.text + '/' + b.text);
  }
  return bad;
};
const texts = (pl) => boxes(pl).map((b) => b.text).sort();

let pl = draw();
check('classic-no-overlap', overlaps(pl).length === 0, overlaps(pl));
check('classic-texts', texts(pl).includes('4.7k') && texts(pl).includes('R1'), texts(pl));

// Project default via the picker footer.
const sel = document.querySelector('select[data-role="field-style-default"]');
check('footer-select', !!sel && sel.value === 'classic', sel && sel.value);
const undoDepth = app.history.undoStack.length;
sel.value = 'compact'; sel.dispatchEvent(new Event('change'));
pl = draw();
out.compact = texts(pl);
check('compact-one-line', texts(pl).includes('R1 4.7k') && texts(pl).includes('D1') && !texts(pl).includes('LED'), texts(pl));
check('compact-no-overlap', overlaps(pl).length === 0, overlaps(pl));
check('one-undo-step', app.history.undoStack.length === undoDepth + 1);
document.querySelector('select[data-role="field-style-default"]').value = 'rkm';
document.querySelector('select[data-role="field-style-default"]').dispatchEvent(new Event('change'));
pl = draw();
out.rkm = texts(pl);
check('rkm-drawn', ['4k7', '2R2', '330R', '100n'].every((t) => texts(pl).includes(t)), texts(pl));
check('stored-unchanged', Object.values(app.project.components).some((c) => c.value === '4.7k'));

// Per-part override through the Fields menu on a selection.
const r2 = app.project.schematic.sheets[0].symbols.find((y) => app.project.components[y.componentId].ref === 'R2');
ed.selection = new Set([r2.id]); ed.refresh();
check('fields-button-enabled', !ed.btn.fields.disabled);
ed.btn.fields.click();
const item = [...document.querySelectorAll('.menu-item')].find((m) => m.textContent.trim() === 'Compact');
check('menu', !!item);
item.click();
check('override', app.project.components[r2.componentId].fieldStyle === 'compact');
pl = draw();
// R2 sits pin-to-pin between R1 and R3, so its one-line Compact text can only go above or below
const r2items = pl.get(r2.id).items;
check('override-applied', r2items.length === 1 && r2items[0].text === 'R2 2.2', r2items.map((i) => i.text));
check('override-no-overlap', overlaps(pl).length === 0, overlaps(pl));
check('others-still-rkm', texts(pl).includes('4k7'));
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
check('override-undone', !app.project.components[r2.componentId].fieldStyle);

// Saved with the Project.
await app.saveNow();
const stored = JSON.parse(await window.electroNative.loadProject(app.project.id));
check('saved-default', stored.fieldStyles.default === 'rkm' && stored.fieldStyles.styles.rkm && stored.version === window.electrocadLib.project.VERSION, stored.fieldStyles.default);
return { fails, out };
