// Library journey (#13): make a two-Unit Part from scratch (a save with a Unit without Pins is
// refused), save it to a new Library, find it in the Schematic picker, place it (recording its
// Library origin), undo stays in the Library tab, copy a built-in Part; it survives a restart.
const app = window.electrocad;
const fails = [];
const check = (name, cond, info) => { if (!cond) fails.push(name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); };
const G = 1270000;
app.setWorkspace('library');
const ws = app.workspace('library');
const ed = ws.editor;
const key = (k, more = {}) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...more }));
const click = (x, y) => {
  const r = ws.view.canvas.getBoundingClientRect(); const [sx, sy] = ws.view.view.toScreen([x * G, y * G]);
  const o = { clientX: r.left + sx, clientY: r.top + sy, button: 0, buttons: 1, bubbles: true, cancelable: true, pointerId: 9, detail: 1 };
  ws.view.canvas.dispatchEvent(new PointerEvent('pointermove', { ...o, buttons: 0 }));
  ws.view.canvas.dispatchEvent(new PointerEvent('pointerdown', o)); ws.view.canvas.dispatchEvent(new PointerEvent('pointerup', { ...o, buttons: 0 }));
};
await ed.createPart();
check('new-part', ed.draft && ed.tool === 'pin' && app.libraries.length === 1 && app.libraries[0].name === 'My parts');
click(-6, -2); click(-6, 2); click(6, 0);
check('pins', ed.draft.units[0].pins.map((p) => `${p.number}${p.dir}`).join() === '1R,2R,3L', ed.draft.units[0].pins.map((p) => `${p.number}${p.dir}`));
key('b'); click(-2, -1); click(2, 1);
check('rect', ed.draft.units[0].graphics.length === 2);
// the Project's undo history is untouched by Part edits
const projectUndo = app.history.undoStack.length;
key('z', { ctrlKey: true });
check('undo-in-library', ed.draft.units[0].graphics.length === 1 && app.history.undoStack.length === projectUndo);
key('z', { ctrlKey: true, shiftKey: true });
check('redo', ed.draft.units[0].graphics.length === 2);
// resize handles: drag the box's right side out half a grid, then undo
const drag = (x0, y0, x1, y1) => {
  const r = ws.view.canvas.getBoundingClientRect();
  const o = (x, y, buttons) => { const [sx, sy] = ws.view.view.toScreen([x * G, y * G]); return { clientX: r.left + sx, clientY: r.top + sy, button: 0, buttons, bubbles: true, cancelable: true, pointerId: 15 }; };
  ws.view.canvas.dispatchEvent(new PointerEvent('pointermove', o(x0, y0, 0)));
  ws.view.canvas.dispatchEvent(new PointerEvent('pointerdown', o(x0, y0, 1)));
  ws.view.canvas.dispatchEvent(new PointerEvent('pointermove', o(x1, y1, 1)));
  ws.view.canvas.dispatchEvent(new PointerEvent('pointerup', o(x1, y1, 0)));
};
ed.setTool('select'); ed.selection = new Set(['g:1']); ed.refresh();
drag(2, 0, 2.5, 0);
check('lib-resize', ed.draft.units[0].graphics[1].b[0] === 2.5 * G, ed.draft.units[0].graphics[1]);
key('z', { ctrlKey: true });
check('lib-resize-undo', ed.draft.units[0].graphics[1].b[0] === 2 * G);
ed.selection.clear(); ed.refresh();
// a second Unit without Pins can't be saved
document.querySelector('.ws-root[data-ws="library"] .chip-add').click();
check('unit-b', ed.draft.units.length === 2 && ed.unit === 1);
check('problem-shown', /Unit B has no pins/.test(document.querySelector('.lib-problems')?.textContent || ''));
check('save-refused', (await ed.save()) === false && !Object.keys(app.libraries[0].parts).length);
key('p'); click(-6, 0);
const name = document.querySelector('.lib-part input[aria-label="Name"]');
name.value = 'Dual buffer'; name.dispatchEvent(new Event('change'));
check('saved', (await ed.save()) === true && app.libraries[0].parts['new-part']?.origin.version === 1, Object.keys(app.libraries[0].parts));
// the Schematic picker has it, under the Library in the category select
app.setWorkspace('schematic');
const sch = app.workspace('schematic').editor;
const opt = [...document.querySelectorAll('.side-filter select option')].find((o) => o.textContent === 'My parts');
check('category-option', !!opt);
check('in-picker', !!document.querySelector('.part-tile[aria-label="Dual buffer"]'));
const part = sch.parts.find((p) => p.name === 'Dual buffer');
sch.beginPlace(part); sch.placing.at = [40 * G, 40 * G]; const r = sch.commitPlace(); sch.endPlace();
check('origin', r && app.project.parts[r.comp.partId]?.origin?.library === 'my-parts' && r.comp.partId === 'my-parts/new-part@1', r?.comp.partId);
// a built-in Part opens as a copy, saved into the Library
app.setWorkspace('library');
const builtinRow = [...document.querySelectorAll('.lib-group[data-library="builtin"] .lib-part-row')].find((b) => b.textContent.includes('NE555'));
builtinRow.click();
await new Promise((res) => setTimeout(res, 50));
check('copy-open', ed.draft?.name === 'NE555' && ed.libId === 'my-parts');
check('copy-saved', (await ed.save()) === true && Object.keys(app.libraries[0].parts).length === 2);
localStorage.setItem('smoke.lib', JSON.stringify(Object.keys(app.libraries[0].parts).sort()));
return { fails };
