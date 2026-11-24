// Part picker journey (ticket #4): drag-and-drop with R while dragging, click-then-click,
// Enter on a tile, select + mirror, delete, undo/redo, autosave and a drawn Symbol.
const app = window.electrocad;
const fails = [];
const out = {};
const check = (name, cond, info) => { if (!cond) fails.push(name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ws = app.workspace('schematic');
const ed = ws.editor;
const canvas = ws.view.canvas;
const cr = canvas.getBoundingClientRect();
const tile = (name) => document.querySelector(`.part-tile[aria-label="${name}"]`);
const center = (el) => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
const pev = (target, type, x, y, extra = {}) => target.dispatchEvent(new PointerEvent(type, { pointerId: 1, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y, bubbles: true, cancelable: true, ...extra }));
const key = (k) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
const refs = () => Object.values(app.project.components).map((c) => c.ref).sort();
const syms = () => app.project.schematic.sheets[0].symbols;

check('tiles', ['Resistor', 'Capacitor', 'LED'].every((n) => tile(n)), [...document.querySelectorAll('.part-tile')].map((t) => t.textContent));
check('thumbs', [...document.querySelectorAll('.part-tile img')].every((i) => i.src.startsWith('data:image/png')));

// 1. Drag the Resistor onto the sheet, pressing R while dragging.
let [tx, ty] = center(tile('Resistor'));
const dropAt = [cr.left + cr.width * 0.4, cr.top + cr.height * 0.45];
pev(tile('Resistor'), 'pointerdown', tx, ty);
pev(document, 'pointermove', tx - 30, ty);
pev(document, 'pointermove', dropAt[0], dropAt[1]);
check('ghost-while-dragging', !!ed.placing && !!ed.placing.at && ed.placing.drag);
key('r');
pev(document, 'pointerup', dropAt[0], dropAt[1]);
check('dragged-r1', JSON.stringify(refs()) === '["R1"]' && syms()[0].rot === 90 && !ed.placing, [refs(), syms()[0]?.rot]);
const snapped = syms()[0].at.every((v) => v % 1270000 === 0);
check('snapped', snapped, syms()[0].at);
check('one-undo-step', app.history.undoStack.length === 1, app.history.undoStack.length);

// 2. Dropping outside the canvas cancels.
[tx, ty] = center(tile('Capacitor'));
pev(tile('Capacitor'), 'pointerdown', tx, ty);
pev(document, 'pointermove', tx - 40, ty);
pev(document, 'pointerup', tx - 40, ty);
check('drop-outside-cancels', refs().length === 1 && !ed.placing, refs());

// 3. Click the Capacitor tile, then click twice on the sheet, then Esc.
pev(tile('Capacitor'), 'pointerdown', tx, ty);
pev(document, 'pointerup', tx, ty);
check('click-mode', !!ed.placing && !ed.placing.drag);
for (const fx of [0.55, 0.62]) {
  const x = cr.left + cr.width * fx, y = cr.top + cr.height * 0.45;
  pev(canvas, 'pointermove', x, y); pev(canvas, 'pointerdown', x, y); pev(canvas, 'pointerup', x, y);
}
key('Escape');
check('click-placed-c1-c2', JSON.stringify(refs()) === '["C1","C2","R1"]' && !ed.placing, refs());

// 4. Enter on the LED tile drops one mid-view.
tile('LED').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
check('enter-placed-d1', refs().includes('D1') && ed.selection.size === 1, refs());

// 5. Select R1 by clicking it, mirror with X, delete with Del.
const r1 = syms().find((y) => app.project.components[y.componentId].ref === 'R1');
const [sx, sy] = ws.view.view.toScreen(r1.at);
pev(canvas, 'pointerdown', cr.left + sx, cr.top + sy); pev(canvas, 'pointerup', cr.left + sx, cr.top + sy);
check('select-click', ed.selection.size === 1 && ed.selection.has(r1.id), [...ed.selection]);
check('hint-selected', /Selected R1/.test(ws.hint.textContent), ws.hint.textContent);
key('x');
check('mirrored', syms().find((y) => y.id === r1.id).mirror === true);
key('Delete');
check('deleted', !refs().includes('R1') && refs().length === 3, refs());

// 6. Undo the delete and the mirror, redo the mirror.
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
check('undo-delete', refs().includes('R1'), refs());
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
check('undo-mirror', syms().find((y) => y.id === r1.id).mirror === false);
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true }));
check('redo-mirror', syms().find((y) => y.id === r1.id).mirror === true);
check('toolbar-undo-redo-state', !ed.btn.undo.disabled && !ed.btn.redo.disabled, [ed.btn.undo.disabled, ed.btn.redo.disabled]); // the Delete is still redoable

// 7. The Symbols are drawn in the theme colours: a pixel on R1's body edge is the symbolBody colour.
ws.view.view.fit({ x0: r1.at[0] - 8e6, y0: r1.at[1] - 8e6, x1: r1.at[0] + 8e6, y1: r1.at[1] + 8e6 }, ws.view.w, ws.view.h, 20);
ws.view.draw();
const C = app.canvasColors('schematic');
let hits = 0;
const want = C.symbolBody.toLowerCase();
const img = ws.view.ctx.getImageData(0, 0, ws.view.canvas.width, ws.view.canvas.height).data;
for (let i = 0; i < img.length; i += 4) {
  const hex = '#' + [img[i], img[i + 1], img[i + 2]].map((x) => x.toString(16).padStart(2, '0')).join('');
  if (hex === want) hits++;
}
out.bodyPixels = hits;
check('symbol-drawn', hits > 50, hits);

// 8. Autosave stores the Components.
await app.saveNow();
const stored = JSON.parse(await window.electroNative.loadProject(app.project.id));
check('saved', Object.keys(stored.components).length === 4 && Object.keys(stored.parts).length === 3, Object.keys(stored.components).length);
const meta = (await window.electroNative.listProjects()).find((m) => m.id === app.project.id);
check('card-count', meta.components === 4, meta);
return { fails, out };
