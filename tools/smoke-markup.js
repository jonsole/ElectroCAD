// Markup journey (#59): text (with variables), a dashed box, a line with an arrow; edit text by
// double-click; Sheet setup changes the paper (the frame follows) and the title block; double-
// clicking the title block opens Sheet setup; everything survives a restart.
const app = window.electrocad;
const fails = [];
const check = (name, cond, info) => { if (!cond) fails.push(name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); };
const ed = app.workspace('schematic').editor;
const ws = app.workspace('schematic');
const G = 1270000;
const key = (k, more = {}) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...more }));
ws.view.view.fit({ x0: 0, y0: 0, x1: 120 * G, y1: 90 * G }, ws.view.w, ws.view.h, 10);
const pt = (x, y) => { const r = ws.view.canvas.getBoundingClientRect(); const [sx, sy] = ws.view.view.toScreen([x * G, y * G]); return { clientX: r.left + sx, clientY: r.top + sy }; };
const click = (x, y, detail = 1) => {
  const o = { ...pt(x, y), button: 0, buttons: 1, bubbles: true, cancelable: true, pointerId: 11, detail };
  ws.view.canvas.dispatchEvent(new PointerEvent('pointermove', { ...o, buttons: 0 }));
  ws.view.canvas.dispatchEvent(new PointerEvent('pointerdown', o)); ws.view.canvas.dispatchEvent(new PointerEvent('pointerup', { ...o, buttons: 0 }));
};
const sheet = () => app.project.schematic.sheets[0];
// a dashed box
key('b'); click(10, 10); click(40, 30);
check('rect', sheet().drawings.length === 1 && sheet().drawings[0].style === 'dashed');
// a text note with a variable, typed in place
key('t'); click(12, 8);
let box = document.querySelector('.field-edit.text-edit');
check('text-box', !!box);
box.value = 'Power (${SHEET_NAME})'; box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
const note = sheet().drawings.find((d) => d.type === 'text');
check('text', note?.text === 'Power (${SHEET_NAME})', note);
// a line with an arrow at the end (inspector)
key('i'); click(60, 10); click(50, 20); click(50, 20, 2); // a real double-click: a click, then the second click
const line = sheet().drawings.find((d) => d.type === 'line');
check('line', line && line.pts.length === 2, line);
ed.selection = new Set([line.id]); ed.refresh();
const arrow = [...document.querySelectorAll('.inspector .check-row')].find((l) => /Arrow at end/.test(l.textContent))?.querySelector('input');
arrow.checked = true; arrow.dispatchEvent(new Event('change'));
check('arrow', sheet().drawings.find((d) => d.type === 'line').arrowEnd === true);
key('Escape'); key('Escape');
// double-click the note edits its raw text
ed.setTool('select');
const at = note.at;
ws.view.canvas.dispatchEvent(new MouseEvent('dblclick', { ...pt(at[0] / G + 1, at[1] / G), bubbles: true, cancelable: true }));
box = document.querySelector('.field-edit.text-edit');
check('dblclick-raw', box?.value === 'Power (${SHEET_NAME})', box?.value);
if (box) { box.value = 'Supply on ${SHEET_NAME}'; box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); }
check('edited', sheet().drawings.find((d) => d.type === 'text').text === 'Supply on ${SHEET_NAME}');
// move the box with the arrow keys, then undo
const rect = sheet().drawings.find((d) => d.type === 'rect');
ed.selection = new Set([rect.id]); ed.refresh(); key('ArrowRight');
check('moved', sheet().drawings.find((d) => d.type === 'rect').a[0] === 11 * G);
key('z', { ctrlKey: true });
check('undo', sheet().drawings.find((d) => d.type === 'rect').a[0] === 10 * G);
// resize handles: drag the box's bottom-right corner
const drag = (x0, y0, x1, y1) => {
  const o = (x, y, buttons) => ({ ...pt(x, y), button: 0, buttons, bubbles: true, cancelable: true, pointerId: 14 });
  ws.view.canvas.dispatchEvent(new PointerEvent('pointermove', o(x0, y0, 0)));
  ws.view.canvas.dispatchEvent(new PointerEvent('pointerdown', o(x0, y0, 1)));
  ws.view.canvas.dispatchEvent(new PointerEvent('pointermove', o((x0 + x1) / 2, (y0 + y1) / 2, 1)));
  ws.view.canvas.dispatchEvent(new PointerEvent('pointermove', o(x1, y1, 1)));
  ws.view.canvas.dispatchEvent(new PointerEvent('pointerup', o(x1, y1, 0)));
};
ed.setTool('select');
ed.selection = new Set([rect.id]); ed.refresh();
check('handles', ed._handles().length === 8);
drag(40, 30, 45, 35);
const resized = sheet().drawings.find((d) => d.type === 'rect');
check('resized', resized.b[0] === 45 * G && resized.b[1] === 35 * G && resized.a[0] === 10 * G, [resized.a, resized.b]);
// a line's end handle
const ln = sheet().drawings.find((d) => d.type === 'line');
ed.selection = new Set([ln.id]); ed.refresh();
drag(50, 20, 50, 25);
check('line-end', sheet().drawings.find((d) => d.type === 'line').pts[1][1] === 25 * G, sheet().drawings.find((d) => d.type === 'line').pts);
ed.selection.clear(); ed.refresh();
// object snapping: a new line ending near the box's corner lands on it, not on the half grid
key('i'); click(60, 40); click(45.3, 35.2); click(45.3, 35.2, 2);
const snapped = sheet().drawings.filter((d) => d.type === 'line').at(-1);
check('snap-to-corner', snapped.pts.at(-1)[0] === 45 * G && snapped.pts.at(-1)[1] === 35 * G, snapped.pts);
key('Escape'); ed.setTool('select'); ed.selection.clear(); ed.refresh();
// grid and origin are per Sheet: the gear on a Sheet row opens its setup dialog
ed.toggleSheets(true);
document.querySelector(`.sheets-panel .sheet-row[data-sheet="${sheet().id}"] button[title^="Sheet setup"]`).click();
let dlg = document.querySelector('.modal');
dlg.querySelector('select[aria-label="Grid"]').value = String(2 * G);
dlg.querySelector('input[aria-label="Origin X (mm)"]').value = '5';
[...dlg.querySelectorAll('button')].find((b) => b.textContent === 'Apply').click();
check('sch-grid', sheet().grid.main === 2 * G && ws.view.grid === 2 * G && sheet().origin[0] === 5e6, [sheet().grid, sheet().origin]);
key('z', { ctrlKey: true });
check('sch-grid-undo', sheet().grid.main === G && sheet().origin[0] === 0);
// the toolbar Grid button opens the Grid card for the current sheet
ed.gridCard.button.click();
const gc = document.querySelector('[data-ws="schematic"] .grid-card');
check('sch-grid-card', ed.gridCard.open && gc.querySelector('.fp-count').textContent === sheet().name);
const gcs = gc.querySelector('select[aria-label="Alt grid"]'); gcs.value = String(G / 2 / 5); gcs.dispatchEvent(new Event('change'));
check('sch-card-alt', sheet().grid.alt === G / 10, sheet().grid);
key('z', { ctrlKey: true });
ed.gridCard.toggle(false);
ed.toggleSheets(false);
key('o'); click(10.2, 10.1);
check('sch-origin', JSON.stringify(sheet().origin) === JSON.stringify([10 * G, 10 * G]) && ws.view.origin === sheet().origin, sheet().origin);
key('z', { ctrlKey: true });
// Sheet setup: A3 portrait, title block fields; the frame follows
ed.sheetSetup();
const modalEl = document.querySelector('.modal');
modalEl.querySelector('select[aria-label="Paper size"]').value = 'A3';
modalEl.querySelector('select[aria-label="Orientation"]').value = 'portrait';
modalEl.querySelector('input[aria-label="Title"]').value = 'Smoke board';
modalEl.querySelector('input[aria-label="Revision"]').value = 'C';
[...modalEl.querySelectorAll('button')].find((b) => b.textContent === 'Apply').click();
check('paper', JSON.stringify(sheet().paper) === '{"size":"A3","orientation":"portrait"}' && ws.view.frame.x1 === 297e6 && ws.view.frame.y1 === 420e6, [sheet().paper, ws.view.frame]);
check('title-block', app.project.titleBlock.title === 'Smoke board' && app.project.titleBlock.revision === 'C');
// double-clicking the title block opens Sheet setup
const tb = window.electrocadLib.drawings.titleBlockLayout(sheet()).box;
ws.view.view.fit({ x0: tb.x0 - 10e6, y0: tb.y0 - 10e6, x1: tb.x1 + 10e6, y1: tb.y1 + 10e6 }, ws.view.w, ws.view.h, 10);
ws.view.canvas.dispatchEvent(new MouseEvent('dblclick', { ...pt((tb.x0 + tb.x1) / 2 / G, (tb.y0 + tb.y1) / 2 / G), bubbles: true, cancelable: true }));
check('tb-dblclick', !!document.querySelector('.modal') && /Sheet setup/.test(document.querySelector('.modal').textContent));
document.querySelector('.modal button[title], .modal .modal-close, .modal button:last-of-type')?.click();
document.querySelectorAll('.modal-backdrop, .modal-wrap').forEach((x) => x.remove());
localStorage.setItem('smoke.markup', JSON.stringify(sheet().drawings.map((d) => d.type).sort()));
await app.saveNow();
return { fails };
