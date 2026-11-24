// Routing journey (#20): two resistors on one Net with a third part between them; X starts a track
// on a pad; the corner style and chamfer come from the toolbar; crossing the other part's pads is
// flagged live; clicking the target pad commits (one undo step) and its Ratsnest line goes;
// selecting a track and Del deletes it; Esc cancels a route.
const app = window.electrocad;
const fails = [];
const check = (name, cond, info) => { if (!cond) fails.push(name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); };
const L = window.electrocadLib, G = 1270000, MM = 1e6;
const part = (n) => app.workspace('schematic').editor.parts.find((x) => x.name === n);
app.edit('demo', (pr) => {
  const s = pr.schematic.sheets[0];
  const r1 = L.project.addComponent(pr, s, part('Resistor'), [G * 20, G * 20]).comp;
  const r2 = L.project.addComponent(pr, s, part('Resistor'), [G * 40, G * 20]).comp;
  const r3 = L.project.addComponent(pr, s, part('Resistor'), [G * 30, G * 40]).comp;
  const pin = (c, n) => { const y = s.symbols.find((q) => q.componentId === c.id); return L.project.pinPositions(pr, y).find((x) => x.pin.number === n).at; };
  L.schematic.addWire(pr, s, [pin(r1, '2'), pin(r2, '1')]);
  L.schematic.addLabel(pr, s, { at: pin(r3, '1'), net: 'X', style: 'label', scope: 'local' });
  pr.board.outline = [{ type: 'rect', a: [0, 0], b: [30e6, 20e6], layer: 'Edge.Cuts' }];
});
app.setWorkspace('board');
await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
const ws = app.workspace('board'), ed = ws.editor;
ed.annotate();
[...document.querySelectorAll('.annotate-modal button')].find((b) => b.textContent === 'Apply').click();
app.edit('place', (pr) => { const f = (ref) => pr.board.footprints.find((x) => pr.components[x.componentId].ref === ref); f('R1').at = [5 * MM, 5 * MM]; f('R2').at = [22 * MM, 14 * MM]; f('R3').at = [13 * MM, 9 * MM]; f('R3').rot = 90; });
ws.view.view.fit({ x0: 0, y0: 0, x1: 28 * MM, y1: 18 * MM }, ws.view.w, ws.view.h, 30);
const pt = (x, y) => { const r = ws.view.canvas.getBoundingClientRect(); const [sx, sy] = ws.view.view.toScreen([x * MM, y * MM]); return { clientX: r.left + sx, clientY: r.top + sy }; };
const move = (x, y) => ws.view.canvas.dispatchEvent(new PointerEvent('pointermove', { ...pt(x, y), button: 0, buttons: 0, bubbles: true, pointerId: 41 }));
const click = (x, y) => { move(x, y); const o = { ...pt(x, y), button: 0, buttons: 1, bubbles: true, cancelable: true, pointerId: 41, detail: 1 }; ws.view.canvas.dispatchEvent(new PointerEvent('pointerdown', o)); ws.view.canvas.dispatchEvent(new PointerEvent('pointerup', { ...o, buttons: 0 })); };
const key = (k, more = {}) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...more }));
const unrouted = () => Object.values(ed._rats.unrouted).reduce((a, b) => a + b, 0);
check('rats-1', unrouted() === 1, ed._rats.unrouted);
// toolbar: 90° with a 1 mm chamfer
[...document.querySelectorAll('[data-ws="board"] .corner-seg button')].find((b) => b.dataset.corner === '90').click();
const ch = document.querySelector('[data-ws="board"] input[aria-label="Chamfer (mm)"]'); ch.value = '1'; ch.dispatchEvent(new Event('change'));
check('options', ed.corner === '90' && ed.chamfer === MM && localStorage.getItem('electrocad.boardCorner') === '"90"');
key('x');
check('route-tool', ed.tool === 'route');
click(5.9125, 5);
check('started', !!ed.route && ed.route.width === 250000 && ed.route.layer === 'F.Cu', ed.route);
move(13, 11);
check('collides', ed.routeView.collisions.some((c) => c.kind === 'pad') && ed.routeView.segments.some((s) => s.collides));
key('/');
check('posture', ed.route.posture === 'b');
key('/');
click(17, 5);
check('corner', ed.route.points.length === 2);
key('Backspace');
check('back', ed.route.points.length === 1);
click(17, 5);
const undo0 = app.history.undoStack.length;
click(21.0875, 14);
check('done', !ed.route && app.project.board.tracks.length === 4, app.project.board.tracks.length); // two legs, the chamfer, and the drop to the pad
check('chamfered', app.project.board.tracks.some((t) => t.a[0] !== t.b[0] && t.a[1] !== t.b[1]));
check('one-undo', app.history.undoStack.length === undo0 + 1);
check('rats-0', unrouted() === 0, ed._rats.unrouted);
// Esc cancels a route in progress
click(5.9125, 5); move(10, 10); key('Escape');
check('cancel', !ed.route && app.project.board.tracks.length === 4);
// select a track and delete it
key('v');
const t0 = app.project.board.tracks[0];
click((t0.a[0] + t0.b[0]) / 2 / MM, (t0.a[1] + t0.b[1]) / 2 / MM);
check('track-selected', ed.trackSel.has(t0.id), [...ed.trackSel]);
key('Delete');
check('deleted', app.project.board.tracks.length === 3 && unrouted() === 1);
key('z', { ctrlKey: true });
check('undo-delete', app.project.board.tracks.length === 4);
return { fails };
