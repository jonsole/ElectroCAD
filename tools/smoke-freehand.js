// Freehand routing journey (#92): bend style 7 (picked by right-click from bend 4) routes a track
// that follows the pointer, off the grid and at any angle; finishing on the target pad commits it
// in one undo step and the airwire goes; Backspace takes a fixed stretch back.
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
check('rats-1', unrouted() === 1, ed._rats.unrouted);
document.querySelector('[data-ws="board"] .mode-group [data-mode="free"]').click();
key('x');
[...document.querySelectorAll('[data-ws="board"] .corner-seg button')].find((b) => b.dataset.bend === '4').click();
const ch = document.querySelector('[data-ws="board"] input[aria-label="Chamfer (mm)"]'); ch.value = '0'; ch.dispatchEvent(new Event('change'));
rclick(15, 2);
check('freehand-picked', ed.bend === 7 && document.querySelector('[data-ws="board"] .corner-seg button.active')?.dataset.bend === '7', ed.bend);
// an S from R1's pad 2 to R2's pad 1, off the grid
click(5.9125, 5);
check('started', !!ed.route && ed.route.corner === 'free');
const S = (t) => [5.9125 + 15.175 * t, 5 + 9 * t + 3.3 * Math.sin(t * 2 * Math.PI)];
for (let i = 1; i <= 60; i++) { const [x, y] = S(i / 60 * 0.97); move(x, y); }
check('stroke', (ed.route.stroke || []).length > 10 && ed.routeView.segments.length >= 4, { n: ed.route.stroke?.length, segs: ed.routeView.segments.length });
// a click fixes it; Backspace takes the whole stretch back
const mid = S(0.5);
const before = ed.route.points.length;
const full = ed.route.stroke.length;
for (let i = 58; i >= 30; i--) { const [x, y] = S(i / 60 * 0.97); move(x, y); }   // back along the stroke
check('backs-up', ed.route.stroke.length < full * 0.7, { full, now: ed.route.stroke.length });
click(...mid);
check('fixed', ed.route.points.length > before + 2 && ed.route.stroke.length === 0, ed.route.points.length);
key('Backspace');
check('backspace-stretch', ed.route.points.length === 1, ed.route.points.length);
for (let i = 1; i <= 60; i++) { const [x, y] = S(i / 60 * 0.97); move(x, y); }
const undo0 = app.history.undoStack.length;
click(21.0875, 14);
check('finished', !ed.route && app.history.undoStack.length === undo0 + 1);
const ts = app.project.board.tracks;
const offGrid = ts.some((t) => [t.a, t.b].some((p) => p[0] % 500000 || p[1] % 500000));
const odd = ts.some((t) => { const a = Math.atan2(t.b[1] - t.a[1], t.b[0] - t.a[0]) * 180 / Math.PI; return Math.abs(a / 45 - Math.round(a / 45)) > 0.05; });
check('tracks', ts.length >= 4 && ts.length < 40 && offGrid && odd, { n: ts.length, offGrid, odd });
check('joined', ts.every((t, i) => i === 0 || ts.some((u) => u.b[0] === t.a[0] && u.b[1] === t.a[1])));
check('rats-0', unrouted() === 0, ed._rats.unrouted);
app.undo();
check('undo', app.project.board.tracks.length === 0 && unrouted() === 1);
key('Escape');
return { fails };
