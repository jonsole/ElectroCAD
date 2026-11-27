// Dragging tracks (#31): with the Select tool, drag a segment of a routed U sideways towards
// another net's track: its neighbours follow at 90°, the other track is pushed aside (Shove mode)
// and springs back as the pointer returns; release commits it with no DRC clearance error and the
// ratsnest unchanged; undo puts it back. Then drag a corner.
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
let net;
app.edit('place', (pr) => {
  const f = (ref) => pr.board.footprints.find((x) => pr.components[x.componentId].ref === ref);
  f('R1').at = [6 * MM, 8 * MM]; f('R2').at = [34 * MM, 8 * MM];
  net = Object.keys(pr.board.annotation.nets).find((n) => pr.board.annotation.nets[n].length === 2);
  const a = [6.9125 * MM, 8 * MM], b = [33.0875 * MM, 8 * MM];
  // a U: down, across at y = 12, up
  pr.board.tracks.push({ id: 'u1', a, b: [a[0], 12 * MM], width: 250000, layer: 'F.Cu', net }, { id: 'u2', a: [a[0], 12 * MM], b: [b[0], 12 * MM], width: 250000, layer: 'F.Cu', net }, { id: 'u3', a: [b[0], 12 * MM], b, width: 250000, layer: 'F.Cu', net });
  pr.board.tracks.push({ id: 'o', a: [2 * MM, 12.9 * MM], b: [38 * MM, 12.9 * MM], width: 250000, layer: 'F.Cu', net: 'OTHER' });
});
const before = structuredClone(app.project.board.tracks);
ws.view.view.fit({ x0: 4 * MM, y0: 5 * MM, x1: 36 * MM, y1: 16 * MM }, ws.view.w, ws.view.h, 20);
const pt = (x, y) => { const r = ws.view.canvas.getBoundingClientRect(); const [sx, sy] = ws.view.view.toScreen([x * MM, y * MM]); return { clientX: r.left + sx, clientY: r.top + sy }; };
const ev = (type, x, y, buttons) => ws.view.canvas.dispatchEvent(new PointerEvent(type, { ...pt(x, y), button: 0, buttons, bubbles: true, cancelable: true, pointerId: 54 }));
check('no-drag-tool', !document.querySelector('[data-ws="board"] button[title^="Drag track"]'));
ed.setTool('select');
check('shove-mode', ed.routeMode === 'shove');
ev('pointermove', 20, 12, 0); ev('pointerdown', 20, 12, 1);
ev('pointermove', 20, 12.5, 1); await wait(30);
const res = ed.trackDrag?.result;
check('dragging', !!res);
const u2 = res?.tracks.find((t) => t.id === 'u2');
check('slid', u2 && u2.a[1] === 12.5 * MM && u2.b[1] === 12.5 * MM, u2);
check('neighbours-follow', res && res.tracks.filter((t) => t.net === net).length === 3);
check('pushed', res?.moved?.has('o'), res && [...res.moved]);
ev('pointermove', 20, 12, 1); await wait(30);
check('spring-back', !ed.trackDrag?.result?.moved?.size);
ev('pointermove', 20, 12.5, 1); await wait(30);
ev('pointerup', 20, 12.5, 0); await wait(50);
const now = app.project.board.tracks;
check('committed', now.find((t) => t.id === 'u2')?.a[1] === 12.5 * MM && now.filter((t) => t.net === 'OTHER').length > 1);
await ed.runDrc(); await wait(50);
check('drc-clean', !ed.drc.list.some((v) => v.rule === 'clearance' || v.rule === 'unrouted'), ed.drc.list.map((v) => v.message));
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
await wait(50);
check('undo', JSON.stringify(app.project.board.tracks) === JSON.stringify(before));
// a corner: drag the U's bottom-left corner out
ed.drcCard?.toggle?.(false);
ed.setTool('select');
ev('pointermove', 6.9125, 12, 0); ev('pointerdown', 6.9125, 12, 1);
check('corner', ed.trackDrag?.kind === 'corner', ed.trackDrag);
ev('pointermove', 8, 11, 1); await wait(30);
ev('pointerup', 8, 11, 0); await wait(50);
const after = app.project.board.tracks.filter((t) => t.net === net);
check('corner-moved', after.some((t) => (t.a[0] === 8 * MM && t.a[1] === 11 * MM) || (t.b[0] === 8 * MM && t.b[1] === 11 * MM)), after.map((t) => [t.a, t.b]));
await ed.runDrc(); await wait(50);
check('corner-still-routed', !ed.drc.list.some((v) => v.rule === 'unrouted'));
ed.drcCard?.toggle?.(false);
// the Select tool: a click selects a track without moving it; a drag slides it the same way
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
await wait(50);
ed.setTool('select');
ev('pointermove', 20, 12, 0); ev('pointerdown', 20, 12, 1); ev('pointerup', 20, 12, 0); await wait(50);
check('select-click', ed.trackSel.has('u2') && JSON.stringify(app.project.board.tracks) === JSON.stringify(before));
ev('pointerdown', 20, 12, 1); ev('pointermove', 20, 12.5, 1); await wait(30);
check('select-drag-preview', ed.trackDrag?.result?.moved?.has('o'));
ev('pointerup', 20, 12.5, 0); await wait(50);
check('select-drag', app.project.board.tracks.find((t) => t.id === 'u2')?.a[1] === 12.5 * MM && ed.trackSel.has('u2'));
app.edit('lock', (pr) => { pr.board.tracks.find((t) => t.id === 'u2').locked = true; });
ev('pointerdown', 20, 12.5, 1); ev('pointermove', 20, 11, 1); await wait(30); ev('pointerup', 20, 11, 0); await wait(50);
check('select-locked', app.project.board.tracks.find((t) => t.id === 'u2')?.a[1] === 12.5 * MM);
// a junction: with a stub off the U's bottom-left corner, dragging the corner moves all three
app.undo(); app.undo(); await wait(50);
check('back', JSON.stringify(app.project.board.tracks) === JSON.stringify(before));
app.edit('stub', (pr) => { pr.board.tracks.push({ id: 'st', a: [6.9125 * MM, 12 * MM], b: [4 * MM, 12 * MM], width: 250000, layer: 'F.Cu', net }); });
ev('pointermove', 6.9125, 12, 0); ev('pointerdown', 6.9125, 12, 1);
check('junction-corner', ed.trackDrag?.kind === 'corner', ed.trackDrag);
ev('pointermove', 7.5, 11, 1); ev('pointermove', 8, 10.5, 1); await wait(30);
ev('pointerup', 8, 10.5, 0); await wait(50);
const tj = app.project.board.tracks.filter((t) => t.net === net);
const at = (q, x, y) => q[0] === Math.round(x * MM) && q[1] === Math.round(y * MM);
check('junction-moved', tj.filter((t) => at(t.a, 8, 10.5) || at(t.b, 8, 10.5)).length === 3 && !tj.some((t) => at(t.a, 6.9125, 12) || at(t.b, 6.9125, 12)), tj.map((t) => [t.id, t.a, t.b]));
await ed.runDrc(); await wait(50);
check('junction-still-routed', !ed.drc.list.some((v) => v.rule === 'unrouted'));
ed.drcCard?.toggle?.(false);
return { fails };
