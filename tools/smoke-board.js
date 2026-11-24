// Board journey (#15): 4 copper layers; a rounded-rectangle Outline; a polygon with an arc side
// that closes on its first corner; a hole; layer visibility and the active layer; moving and
// undo; the Board's pan/zoom survives switching tabs; everything survives a restart.
const app = window.electrocad;
const fails = [];
const check = (name, cond, info) => { if (!cond) fails.push(name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); };
app.setWorkspace('board');
await new Promise((r) => requestAnimationFrame(r));
const ws = app.workspace('board');
const ed = ws.editor;
const MM = 1e6;
const key = (k, more = {}) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...more }));
ws.view.view.fit({ x0: -10 * MM, y0: -10 * MM, x1: 110 * MM, y1: 90 * MM }, ws.view.w, ws.view.h, 10);
const pt = (x, y) => { const r = ws.view.canvas.getBoundingClientRect(); const [sx, sy] = ws.view.view.toScreen([x * MM, y * MM]); return { clientX: r.left + sx, clientY: r.top + sy }; };
const click = (x, y) => {
  const o = { ...pt(x, y), button: 0, buttons: 1, bubbles: true, cancelable: true, pointerId: 12 };
  ws.view.canvas.dispatchEvent(new PointerEvent('pointermove', { ...o, buttons: 0 }));
  ws.view.canvas.dispatchEvent(new PointerEvent('pointerdown', o)); ws.view.canvas.dispatchEvent(new PointerEvent('pointerup', { ...o, buttons: 0 }));
};
const board = () => app.project.board;
check('empty-hint', /No board yet/.test(ws.hint.textContent), ws.hint.textContent);
// 4 copper layers: the panel and the chips follow
[...document.querySelectorAll('[data-ws="board"] .stack-row button')].find((b) => b.textContent === '4 layers').click();
check('stack-4', board().stack.copper === 4);
check('panel-4', [...document.querySelectorAll('[data-ws="board"] .ll-row')].some((r) => r.dataset.layer === 'In2.Cu'));
check('chips-4', [...ws.chipStrip.querySelectorAll('.chip')].map((c) => c.dataset.layer).join() === 'F.Cu,In1.Cu,In2.Cu,B.Cu,Edge.Cuts');
// rounded rectangle 0,0 – 50,40 with 3 mm corners
key('o');
const r = document.querySelector('[data-ws="board"] input[aria-label="Corner radius"]');
r.value = '3'; r.dispatchEvent(new Event('change'));
check('active-edge', ed.activeLayer === 'Edge.Cuts');
click(0, 0); click(50, 40);
check('rounded', board().outline.length === 8 && board().outline.filter((s) => s.type === 'arc').length === 4, board().outline.length);
check('closed', /Outline closed · 50 × 40 mm/.test(document.querySelector('[data-ws="board"] .outline-state').textContent));
// a hole
key('c'); click(10, 10); click(11.5, 10);
check('hole', board().outline.at(-1).type === 'circle' && board().outline.at(-1).r === 1.5 * MM);
// a polygon with an arc side, left open, then closed
key('p'); click(70, 0); click(90, 0); key('a'); click(100, 10); click(90, 20);
click(70, 20); click(70, 0);
const n = board().outline.length;
check('polygon', n === 8 + 1 + 4 && board().outline.filter((s) => s.type === 'arc').length === 5, n);
check('closed-2', /Outline closed · 100 × 40 mm · 2 separate pieces · 1 cut-out/.test(document.querySelector('[data-ws="board"] .outline-state').textContent), document.querySelector('[data-ws="board"] .outline-state').textContent);
// select the hole and move it with the arrows, then undo
key('Escape'); key('v');
click(11.5, 10);
check('select', ed.selection.size === 1 && board().outline[[...ed.selection][0]].type === 'circle', [...ed.selection]);
key('ArrowRight');
check('nudge', board().outline[8].c[0] === 10.5 * MM);
key('z', { ctrlKey: true });
check('undo', board().outline[8].c[0] === 10 * MM);
// deleting a side opens the Outline; undo closes it
ed.selection = new Set([0]); key('Delete');
check('open', /open at one gap/.test(document.querySelector('[data-ws="board"] .outline-state').textContent), document.querySelector('[data-ws="board"] .outline-state').textContent);
key('z', { ctrlKey: true });
check('reclosed', board().outline.length === n);
// hiding a layer; making F.Cu active shows it again
document.querySelector('[data-ws="board"] .ll-row[data-layer="F.Cu"] .mini').click();
check('hidden', ed.hidden.has('F.Cu'));
document.querySelector('[data-ws="board"] .ll-row[data-layer="F.Cu"]').click();
check('active-shown', ed.activeLayer === 'F.Cu' && !ed.hidden.has('F.Cu'));
document.querySelector('[data-ws="board"] .ll-row[data-layer="B.SilkS"] .mini').click();
// refusing 2 layers while inner layers are used is covered by unit tests; here 2 → 4 → keep 4
// resize handles: drag the rounded rectangle's right side out 10 mm; corners stay round, loop closed
const drag = (x0, y0, x1, y1) => {
  const o = (x, y, buttons) => ({ ...pt(x, y), button: 0, buttons, bubbles: true, cancelable: true, pointerId: 13 });
  ws.view.canvas.dispatchEvent(new PointerEvent('pointermove', o(x0, y0, 0)));
  ws.view.canvas.dispatchEvent(new PointerEvent('pointerdown', o(x0, y0, 1)));
  ws.view.canvas.dispatchEvent(new PointerEvent('pointermove', o((x0 + x1) / 2, (y0 + y1) / 2, 1)));
  ws.view.canvas.dispatchEvent(new PointerEvent('pointermove', o(x1, y1, 1)));
  ws.view.canvas.dispatchEvent(new PointerEvent('pointerup', o(x1, y1, 0)));
};
key('v');
const right = board().outline.findIndex((s) => s.type === 'line' && s.pts[0][0] === 50 * MM && s.pts[1][0] === 50 * MM);
ed.selection = new Set([right]); ed.refresh();
check('handles', ed._handles().length === 3, ed._handles().length);
drag(50, 20, 60, 20);
const rr = board().outline.slice(0, 8);
const xs = rr.flatMap((s) => (s.pts || [s.start, s.end]).map((q) => q[0]));
check('side-resized', Math.max(...xs) === 60 * MM, Math.max(...xs));
check('still-closed', /Outline closed · 100 × 40 mm/.test(document.querySelector('[data-ws="board"] .outline-state').textContent), document.querySelector('[data-ws="board"] .outline-state').textContent);
// the hole's handle sets its radius
const hole = board().outline.findIndex((s) => s.type === 'circle');
ed.selection = new Set([hole]); ed.refresh();
drag(11.5, 10, 13, 10);
check('hole-radius', board().outline[hole].r === 3 * MM, board().outline[hole].r);
key('z', { ctrlKey: true });
check('hole-undo', board().outline[hole].r === 1.5 * MM);
// the Board's view is kept across tabs
const view = JSON.stringify(ws.view.view.toJSON());
app.setWorkspace('schematic'); await new Promise((r2) => requestAnimationFrame(r2)); app.setWorkspace('board');
check('view-kept', JSON.stringify(ws.view.view.toJSON()) === view);
localStorage.setItem('smoke.board', JSON.stringify(board().outline));
await app.saveNow();
return { fails };
