// Routing journey (#20), in Free mode: two resistors on one Net with a third part between them; X starts a track
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
// this journey draws in Free mode (Walkaround has its own)
document.querySelector('[data-ws="board"] .mode-group [data-mode="free"]').click();
check('free-mode', ed.routeMode === 'free');
// the routing options pop up only with the Route tool
const strip = document.querySelector('[data-ws="board"] .route-strip');
check('strip-hidden', strip.hidden && !document.querySelector('[data-ws="board"] .toolbar .corner-seg'));
key('x');
check('strip-shown', !strip.hidden && strip.contains(document.querySelector('[data-ws="board"] .corner-seg')));
key('Escape');
check('strip-hides', strip.hidden);
// 90° with a 1 mm chamfer
[...document.querySelectorAll('[data-ws="board"] .corner-seg button')].find((b) => b.dataset.bend === '0').click();
const ch = document.querySelector('[data-ws="board"] input[aria-label="Mitre (mm)"]'); ch.value = '1'; ch.dispatchEvent(new Event('change'));
check('options', ed.bend === 0 && ed.chamfer === MM && localStorage.getItem('electrocad.boardBend') === '0');
key('x');
check('route-tool', ed.tool === 'route');
click(5.9125, 5);
check('started', !!ed.route && ed.route.width === 250000 && ed.route.layer === 'F.Cu', ed.route);
// right-click cycles Eagle's bend styles while routing, Shift+right-click goes back (#91)
const rclick = (x, y, shiftKey = false) => { const o = { ...pt(x, y), button: 2, buttons: 2, bubbles: true, cancelable: true, pointerId: 52, shiftKey }; ws.view.canvas.dispatchEvent(new PointerEvent('pointerdown', o)); ws.view.canvas.dispatchEvent(new PointerEvent('pointerup', { ...o, buttons: 0 })); };
const activeBend = () => document.querySelector('[data-ws="board"] .corner-seg button.active')?.dataset.bend;
rclick(13, 11);
check('rclick-next', !!ed.route && ed.bend === 1 && ed.route.corner === '45' && ed.route.posture === 'a' && activeBend() === '1', { bend: ed.bend, route: !!ed.route });
rclick(13, 11, true);
check('rclick-back', !!ed.route && ed.bend === 0 && ed.route.corner === '90' && activeBend() === '0');
move(13, 11);
check('collides', ed.routeView.collisions.some((c) => c.kind === 'pad') && ed.routeView.segments.some((s) => s.collides));
key('/');
check('posture', ed.route.posture === 'b' && ed.bend === 4 && ed.route.corner === '90');
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
// after a corner the next leg carries on the way the track was going: bend 0 goes horizontal
// first, but after a run down it carries on down; / keeps the style's order for this leg
key('x');
click(5.9125, 5); click(5.9125, 9); move(12, 12);
check('carries-on', ed.route?.points.length >= 2 && ed.routeView.tail[0][0] === 6 * MM && ed.routeView.tail[0][1] === 12 * MM, ed.routeView?.tail);
key('/'); // bend 4, vertical first: the same way
check('slash-4', ed.bend === 4 && ed.routeView.tail[0][0] === 6 * MM && ed.routeView.tail[0][1] === 12 * MM, ed.routeView.tail);
key('/'); // bend 0 kept for this leg: horizontal first, though the track was going down
check('slash-forces', ed.bend === 0 && ed.routeView.tail[0][0] === 12 * MM && ed.routeView.tail[0][1] === 9 * MM, ed.routeView.tail);
click(12, 12);
move(14, 15);
check('next-leg-auto', ed.route.forced === false && ed.routeView.tail[0][0] === 12 * MM && ed.routeView.tail[0][1] === 15 * MM, ed.routeView.tail);
// undo while routing takes back the last segment and stays in the route, down to its start, where
// routing carries on; the Board's history is untouched
const h0 = app.history.undoStack.length, n0 = ed.route.points.length, tr0 = app.project.board.tracks.length;
check('undo-enabled', !document.querySelector('[data-ws="board"] .toolbar button[title="Undo (Ctrl+Z)"]').disabled);
key('z', { ctrlKey: true });
check('undo-segment', !!ed.route && ed.route.points.length < n0 && ed.tool === 'route' && app.history.undoStack.length === h0 && app.project.board.tracks.length === tr0, ed.route?.points.length);
key('z', { ctrlKey: true, shiftKey: true });
check('redo-waits', !!ed.route && app.project.board.tracks.length === tr0);
for (let i = 0; i < 10; i++) key('z', { ctrlKey: true });
check('undo-to-start', !!ed.route && ed.route.points.length === 1 && ed.tool === 'route' && app.history.undoStack.length === h0 && app.project.board.tracks.length === tr0, [ed.route?.points.length, ed.tool]);
key('Backspace');
check('backspace-at-start', !!ed.route && ed.route.points.length === 1);
key('Escape');
// R8: Esc ends the route, keeping its fixed corners, and stays in Route; Esc again goes to Select
check('esc-nothing-fixed', !ed.route && ed.tool === 'route', [!!ed.route, ed.tool]);
const t8 = app.project.board.tracks.length, h8 = app.history.undoStack.length;
click(5.9125, 5); click(5.9125, 9); move(12, 12); key('Escape');
check('esc-ends', !ed.route && ed.tool === 'route' && app.project.board.tracks.length > t8 && app.history.undoStack.length === h8 + 1 && !app.project.board.tracks.some((t) => t.b[0] === 12 * MM && t.b[1] === 12 * MM), [!!ed.route, ed.tool, app.project.board.tracks.length - t8]);
key('Escape');
check('esc-select', ed.tool === 'select');
app.undo();
// R2: a corner near a via of the route's net snaps onto it (off the grid)
key('x');
click(5.9125, 5);
const rnet = ed.route.net;
key('Escape');
app.edit('via', (pr) => { pr.board.vias.push({ id: 'snapvia', at: [9.37 * MM, 9.21 * MM], drill: 300000, diameter: 600000, from: 'F.Cu', to: 'B.Cu', net: rnet }); });
click(5.9125, 5); move(9.4, 9.25);
check('snap-via', ed.cursor && ed.cursor[0] === 9.37 * MM && ed.cursor[1] === 9.21 * MM, ed.cursor);
key('Escape'); key('Escape');
app.undo();
return { fails };
