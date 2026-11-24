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
