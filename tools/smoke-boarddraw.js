// Board drawings journey (#66): the Text tool places text on the top silk from the strip; Line,
// Rectangle and Circle draw on the drawing layer; a drawing is picked, dragged, rotated, flipped to
// the bottom, edited in Properties and deleted; undo brings it back. (The Gerbers are unit-tested.)
const app = window.electrocad;
const fails = [];
const check = (name, cond, info) => { if (!cond) fails.push(name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.setWorkspace('board');
await new Promise((r) => requestAnimationFrame(r));
const ws = app.workspace('board');
const ed = ws.editor;
const MM = 1e6;
const key = (k, more = {}) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...more }));
ws.view.view.fit({ x0: -5 * MM, y0: -5 * MM, x1: 55 * MM, y1: 45 * MM }, ws.view.w, ws.view.h, 10);
const pt = (x, y) => { const r = ws.view.canvas.getBoundingClientRect(); const [sx, sy] = ws.view.view.toScreen([x * MM, y * MM]); return { clientX: r.left + sx, clientY: r.top + sy }; };
const ev = (type, x, y, more = {}) => ws.view.canvas.dispatchEvent(new PointerEvent(type, { ...pt(x, y), button: 0, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true, pointerId: 13, ...more }));
const click = (x, y, more = {}) => { ev('pointermove', x, y, { buttons: 0 }); ev('pointerdown', x, y, more); ev('pointerup', x, y, more); };
const drawings = () => app.project.board.drawings || [];
// an outline to draw inside
key('b'); click(0, 0); click(50, 40);
// Text: the button is the real tool now (not "coming in #19")
const textBtn = [...document.querySelectorAll('[data-ws="board"] button')].find((b) => /^Text \(T\)/.test(b.title));
check('text-button', !!textBtn && !textBtn.disabled);
textBtn.click();
check('text-tool', ed.tool === 'text');
const txt = document.querySelector('[data-ws="board"] input[aria-label="Text"]');
txt.value = 'ToyoTune 2.1'; txt.dispatchEvent(new Event('change'));
const size = document.querySelector('[data-ws="board"] input[aria-label="Size"]');
size.value = '1.8'; size.dispatchEvent(new Event('change'));
click(25, 20);
const t = drawings().find((d) => d.type === 'text');
check('text-placed', t && t.text === 'ToyoTune 2.1' && t.layer === 'F.SilkS' && t.size === 1.8 * MM && t.at[0] === 25 * MM && t.at[1] === 20 * MM, t);
// a line on the bottom fab layer, finished with Enter
key('i');
const layer = document.querySelector('[data-ws="board"] select[aria-label="Layer"]');
layer.value = 'B.Fab'; layer.dispatchEvent(new Event('change'));
click(5, 5); click(15, 5); click(15, 10); key('Enter');
const line = drawings().find((d) => d.type === 'line');
check('line', line && line.layer === 'B.Fab' && line.pts.length === 3, line);
// a filled rectangle on top copper
[...document.querySelectorAll('[data-ws="board"] button')].find((b) => /^Rectangle on the drawing layer/.test(b.title)).click();
const layer2 = document.querySelector('[data-ws="board"] select[aria-label="Layer"]');
layer2.value = 'F.Cu'; layer2.dispatchEvent(new Event('change'));
[...document.querySelectorAll('[data-ws="board"] .strip-seg button')].find((b) => b.textContent === 'Filled').click();
click(35, 30); click(40, 35);
const rect = drawings().find((d) => d.type === 'rect');
check('rect', rect && rect.layer === 'F.Cu' && rect.fill === 'outline', rect);
// select the text and drag it 5 mm right
key('Escape'); key('v');
check('select-tool', ed.tool === 'select');
ev('pointermove', 25, 20, { buttons: 0 }); ev('pointerdown', 25, 20); ev('pointermove', 27, 20); ev('pointermove', 30, 20); ev('pointerup', 30, 20);
const t2 = drawings().find((d) => d.id === t.id);
check('picked', ed.drawSel.has(t.id), [...ed.drawSel]);
check('dragged', t2.at[0] === 30 * MM && t2.at[1] === 20 * MM, t2.at);
// R rotates, F flips to the bottom silk
key('r');
check('rotated', drawings().find((d) => d.id === t.id).rot === 90);
key('f');
check('flipped', drawings().find((d) => d.id === t.id).layer === 'B.SilkS');
// Properties: change the text
ws.view.canvas.dispatchEvent(new MouseEvent('dblclick', { ...pt(30, 20), bubbles: true }));
await wait(50);
const pin = document.querySelector('[data-ws="board"] .le-row input[aria-label="Text"]');
check('props', !!pin, document.querySelector('[data-ws="board"] .prop-title')?.textContent);
if (pin) { pin.value = 'REV B'; pin.dispatchEvent(new Event('change')); }
check('edited', drawings().find((d) => d.id === t.id).text === 'REV B');
// delete, then undo
key('Delete');
check('deleted', !drawings().some((d) => d.id === t.id));
app.undo();
check('undo', drawings().find((d) => d.id === t.id)?.text === 'REV B');
// back to the text for the screenshot
ed._selectOnly({ kind: 'drawing', item: drawings().find((d) => d.id === t.id) }); ed.refresh();
return { fails };
