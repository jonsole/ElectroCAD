// Track optimisation journey (#104, #96 T1-T8): with Optimise on (the default), a straight route
// placed in several clicks commits as one track; with it off, one track per click; the setting is
// saved with the board (undoable); Optimise tracks tidies existing tracks in one undo step.
const app = window.electrocad;
const fails = [];
const check = (name, cond, info) => { if (!cond) fails.push(name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); };
const L = window.electrocadLib, G = 1270000, MM = 1e6;
const part = (n) => app.workspace('schematic').editor.parts.find((x) => x.name === n);
app.edit('demo', (pr) => {
  const s = pr.schematic.sheets[0];
  const r1 = L.project.addComponent(pr, s, part('Resistor'), [G * 20, G * 20]).comp;
  const r2 = L.project.addComponent(pr, s, part('Resistor'), [G * 40, G * 20]).comp;
  const pin = (c, n) => { const y = s.symbols.find((q) => q.componentId === c.id); return L.project.pinPositions(pr, y).find((x) => x.pin.number === n).at; };
  L.schematic.addWire(pr, s, [pin(r1, '2'), pin(r2, '1')]);
  pr.board.outline = [{ type: 'rect', a: [0, 0], b: [30e6, 20e6], layer: 'Edge.Cuts' }];
});
app.setWorkspace('board');
await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
const ws = app.workspace('board'), ed = ws.editor;
ed.annotate();
[...document.querySelectorAll('.annotate-modal button')].find((b) => b.textContent === 'Apply').click();
app.edit('place', (pr) => { const f = (ref) => pr.board.footprints.find((x) => pr.components[x.componentId].ref === ref); f('R1').at = [5 * MM, 5 * MM]; f('R2').at = [22 * MM, 14 * MM]; });
ws.view.view.fit({ x0: 0, y0: 0, x1: 28 * MM, y1: 18 * MM }, ws.view.w, ws.view.h, 30);
const pt = (x, y) => { const r = ws.view.canvas.getBoundingClientRect(); const [sx, sy] = ws.view.view.toScreen([x * MM, y * MM]); return { clientX: r.left + sx, clientY: r.top + sy }; };
const move = (x, y) => ws.view.canvas.dispatchEvent(new PointerEvent('pointermove', { ...pt(x, y), button: 0, buttons: 0, bubbles: true, pointerId: 61 }));
const click = (x, y) => { move(x, y); const o = { ...pt(x, y), button: 0, buttons: 1, bubbles: true, cancelable: true, pointerId: 61, detail: 1 }; ws.view.canvas.dispatchEvent(new PointerEvent('pointerdown', o)); ws.view.canvas.dispatchEvent(new PointerEvent('pointerup', { ...o, buttons: 0 })); };
const rclick = (x, y, shiftKey = false) => { const o = { ...pt(x, y), button: 2, buttons: 2, bubbles: true, cancelable: true, pointerId: 62, shiftKey }; ws.view.canvas.dispatchEvent(new PointerEvent('pointerdown', o)); ws.view.canvas.dispatchEvent(new PointerEvent('pointerup', { ...o, buttons: 0 })); };
const key = (k) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
const unrouted = () => Object.values(ed._rats.unrouted).reduce((a, b) => a + b, 0);
document.querySelector('[data-ws="board"] .mode-group [data-mode="free"]').click();
key('x');
ed.setBend(0);
const toggle = document.querySelector('[data-ws="board"] .optimise-toggle');
check('on-by-default', toggle && toggle.classList.contains('active') && app.project.board.optimise !== false);
const straight = () => { click(5.9125, 5); click(9, 5); click(12, 5); click(15, 5); key('Enter'); };
const net0 = () => app.project.board.tracks.length;
straight();
check('merged', net0() === 1 && [app.project.board.tracks[0].a[0], app.project.board.tracks[0].b[0]].sort((x, y) => x - y).join() === [5.9125 * MM, 15 * MM].join(), app.project.board.tracks.map((t) => [t.a, t.b]));
app.undo();
// off: saved with the board, undoable
toggle.click();
check('off', app.project.board.optimise === false && !toggle.classList.contains('active'));
straight();
check('unmerged', net0() === 3, net0());
// Optimise tracks: one undo step
const h0 = app.history.undoStack.length;
document.querySelector('[data-ws="board"] .route-strip button[title^="Optimise tracks now"]').click();
check('optimised-now', net0() === 1 && app.history.undoStack.length === h0 + 1, net0());
app.undo();
check('undo-now', net0() === 3);
app.undo(); // the route
app.undo(); // the toggle
check('toggle-undo', app.project.board.optimise !== false && toggle.classList.contains('active'));
key('Escape');
return { fails };
