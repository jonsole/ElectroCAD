// Shove routing (#29): routing alongside other nets' tracks pushes them aside (the default mode),
// they spring back as the pointer withdraws, the finished route commits them pushed with no DRC
// clearance errors, and one undo puts everything back. A locked track isn't pushed: the route
// walks round it instead.
const app = window.electrocad;
const fails = [];
const check = (name, cond, info) => { if (!cond) fails.push(name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const L = window.electrocadLib, G = 1270000, MM = 1e6;
const part = (n) => app.workspace('schematic').editor.parts.find((x) => x.name === n);
app.edit('demo', (pr) => {
  const s = pr.schematic.sheets[0];
  const r1 = L.project.addComponent(pr, s, part('Resistor'), [G * 20, G * 20]).comp;
  const r2 = L.project.addComponent(pr, s, part('Resistor'), [G * 40, G * 20]).comp;
  const pin = (c, n) => L.project.pinPositions(pr, s.symbols.find((q) => q.componentId === c.id)).find((x) => x.pin.number === n).at;
  L.schematic.addWire(pr, s, [pin(r1, '2'), pin(r2, '1')]);
  pr.board.outline = [{ type: 'rect', a: [0, 0], b: [40e6, 25e6], layer: 'Edge.Cuts' }];
});
app.setWorkspace('board');
await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
const ws = app.workspace('board'), ed = ws.editor;
ed.annotate();
[...document.querySelectorAll('.annotate-modal button')].find((b) => b.textContent === 'Apply').click();
app.edit('place', (pr) => {
  const f = (ref) => pr.board.footprints.find((x) => pr.components[x.componentId].ref === ref);
  f('R1').at = [6 * MM, 7 * MM]; f('R2').at = [34 * MM, 7 * MM];
  for (const [i, y] of [[0, 10.4], [1, 10.9], [2, 11.4]]) pr.board.tracks.push({ id: `x${i}`, a: [2 * MM, y * MM], b: [38 * MM, y * MM], width: 250000, layer: 'F.Cu', net: `SIG${i}` });
});
const before = structuredClone(app.project.board.tracks);
ws.view.view.fit({ x0: 4 * MM, y0: 4 * MM, x1: 36 * MM, y1: 14 * MM }, ws.view.w, ws.view.h, 20);
const pt = (x, y) => { const r = ws.view.canvas.getBoundingClientRect(); const [sx, sy] = ws.view.view.toScreen([x * MM, y * MM]); return { clientX: r.left + sx, clientY: r.top + sy }; };
const move = (x, y) => ws.view.canvas.dispatchEvent(new PointerEvent('pointermove', { ...pt(x, y), button: 0, buttons: 0, bubbles: true, pointerId: 53 }));
const click = (x, y, detail = 1) => { move(x, y); const o = { ...pt(x, y), button: 0, buttons: 1, bubbles: true, cancelable: true, pointerId: 53, detail }; ws.view.canvas.dispatchEvent(new PointerEvent('pointerdown', o)); ws.view.canvas.dispatchEvent(new PointerEvent('pointerup', { ...o, buttons: 0 })); };
check('default-shove', ed.routeMode === 'shove');
ed.setTool('route');
click(6.9125, 7);
check('routing', !!ed.route);
move(24, 10); await wait(50);
check('pushed', !!ed.routeView?.shoved && ed.routeView.shovedIds.has('x0') && !ed.routeView.collisions.length, { shoveFailed: ed.routeView?.shoveFailed });
check('board-untouched', JSON.stringify(app.project.board.tracks) === JSON.stringify(before));
move(24, 8.5); await wait(50);
check('spring-back', !ed.routeView?.shoved);
move(24, 10); await wait(50);
click(24, 10);           // fix the corner where it pushes
ed.finishRoute();
const moved = app.project.board.tracks.filter((t) => t.net === 'SIG0');
check('committed-pushed', moved.length > 1 && moved.some((t) => t.a[1] !== 10.4 * MM), moved.length);
await ed.runDrc(); await wait(50);
check('drc-clean', !ed.drc.list.some((v) => v.rule === 'clearance'), ed.drc.list.filter((v) => v.rule === 'clearance').map((v) => v.message));
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
await wait(50);
check('undo', JSON.stringify(app.project.board.tracks) === JSON.stringify(before));
// lock the first track: the route walks round instead of pushing it
ed.drcCard?.toggle?.(false);
app.edit('lock', (pr) => { pr.board.tracks.find((t) => t.id === 'x0').locked = true; });
ed.setTool('route');
click(6.9125, 7);
move(24, 10); await wait(50);
check('locked-not-pushed', !ed.routeView?.shoved && !!ed.routeView?.shoveFailed);
ed.cancelRoute();
return { fails };
