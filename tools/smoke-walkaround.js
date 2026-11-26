// Walkaround journey (#22): two resistors on one Net with a third part (another Net) in the way.
// Walkaround is the default mode; the track proposed to the far pad goes round the third part's
// pads clear of them, clicking the pad commits clearance-legal Tracks, and a cursor on foreign
// copper stops the track short. The Free choice is remembered (smoke-walkaround-restart.js).
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
app.edit('place', (pr) => { const f = (ref) => pr.board.footprints.find((x) => pr.components[x.componentId].ref === ref); f('R1').at = [5 * MM, 5 * MM]; f('R2').at = [22 * MM, 14 * MM]; f('R3').at = [12 * MM, 5 * MM]; f('R3').rot = 0; });
ws.view.view.fit({ x0: 0, y0: 0, x1: 28 * MM, y1: 18 * MM }, ws.view.w, ws.view.h, 30);
const pt = (x, y) => { const r = ws.view.canvas.getBoundingClientRect(); const [sx, sy] = ws.view.view.toScreen([x * MM, y * MM]); return { clientX: r.left + sx, clientY: r.top + sy }; };
const move = (x, y) => ws.view.canvas.dispatchEvent(new PointerEvent('pointermove', { ...pt(x, y), button: 0, buttons: 0, bubbles: true, pointerId: 41 }));
const click = (x, y) => { move(x, y); const o = { ...pt(x, y), button: 0, buttons: 1, bubbles: true, cancelable: true, pointerId: 41, detail: 1 }; ws.view.canvas.dispatchEvent(new PointerEvent('pointerdown', o)); ws.view.canvas.dispatchEvent(new PointerEvent('pointerup', { ...o, buttons: 0 })); };
const key = (k, more = {}) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...more }));
const unrouted = () => Object.values(ed._rats.unrouted).reduce((a, b) => a + b, 0);
const group = document.querySelector('[data-ws="board"] .mode-group');
const btn = (m) => group.querySelector(`[data-mode="${m}"]`);
// Shove is the default (#29); this journey is about Walkaround
check('default-shove', ed.routeMode === 'shove' && btn('shove').classList.contains('active') && !btn('shove').disabled && !btn('walkaround').classList.contains('active'));
btn('walkaround').click();
check('walkaround-on', ed.routeMode === 'walkaround' && btn('walkaround').classList.contains('active'));
key('x');
click(5.9125, 5);
check('started', !!ed.route);
// straight at R2's pad would cross R3 (rotated, between them)
move(21.0875, 14);
const v = ed.routeView;
check('clear', v.collisions.length === 0 && !v.segments.some((s) => s.collides) && !v.blocked, { c: v.collisions.length, blocked: v.blocked });
check('reaches', v.end[0] === 21.0875 * MM && v.end[1] === 14 * MM, v.end);
// in Free mode the same pointer collides
btn('free').click();
check('free-collides', ed.routeView.collisions.length > 0 && localStorage.getItem('electrocad.boardRouteMode') === '"free"');
btn('walkaround').click();
check('back-clear', ed.routeView.collisions.length === 0);
// the pointer on R3's pad: the track stops short of it
const r3 = app.project.board.footprints.find((x) => app.project.components[x.componentId].ref === 'R3');
move(r3.at[0] / MM - 0.9125, r3.at[1] / MM);
check('blocked', ed.routeView.blocked && ed.routeView.collisions.length === 0, ed.routeView.blocked);
// finish on R2's pad
const undo0 = app.history.undoStack.length;
click(21.0875, 14);
check('done', !ed.route && app.project.board.tracks.length >= 2, app.project.board.tracks.length);
check('one-undo', app.history.undoStack.length === undo0 + 1);
check('rats-0', unrouted() === 0, ed._rats.unrouted);
const idx = L.collision.copperIndex(app.project);
const bad = app.project.board.tracks.filter((t) => idx.collisions(app.project.board, { type: 'capsule', a: t.a, b: t.b, r: t.width / 2 }, t.layer, t.net).length);
check('legal', bad.length === 0, bad);
// leave Free chosen, for the restart
btn('free').click();
return { fails };
