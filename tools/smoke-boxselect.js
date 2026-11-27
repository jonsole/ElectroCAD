// Box selection and rip-up on the Board: with the Select tool, a box dragged on empty space left to
// right takes what's wholly inside it, right to left what it touches; pressing on a selected
// footprint drags the group, its tracks with it, in one undo step. The Rip up tool lights the run
// under the pointer, a click takes it (pad to pad) back to an airwire, Shift+click just one
// segment, and a box everything in it; each is one undo step.
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
const ev = (type, x, y, buttons, shiftKey = false) => ws.view.canvas.dispatchEvent(new PointerEvent(type, { ...pt(x, y), button: 0, buttons, shiftKey, bubbles: true, cancelable: true, pointerId: 54 }));
const key = (k, more = {}) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...more }));
const unrouted = () => Object.values(ed._rats.unrouted).reduce((a, b) => a + b, 0);
const box = async (x0, y0, x1, y1) => { ev('pointermove', x0, y0, 0); ev('pointerdown', x0, y0, 1); for (let k = 1; k <= 4; k++) ev('pointermove', x0 + (x1 - x0) * k / 4, y0 + (y1 - y0) * k / 4, 1); ev('pointerup', x1, y1, 0); await wait(40); };
const r1 = () => app.project.board.footprints.find((f) => app.project.components[f.componentId]?.ref === 'R1');
const tr = (id) => app.project.board.tracks.find((t) => t.id === id);
ed.setTool('select');
// window (left to right): R1 and the U's left leg, not the bottom run that goes on to R2
await box(3, 6, 9, 12.4);
check('window', ed.fpSel.has(r1().id) && ed.fpSel.size === 1 && ed.trackSel.has('u1') && !ed.trackSel.has('u2') && !ed.trackSel.has('o'), [[...ed.fpSel], [...ed.trackSel]]);
// crossing (right to left): touching the bottom run's middle takes just it
await box(21, 12.4, 19, 11.6);
check('crossing', ed.trackSel.size === 1 && ed.trackSel.has('u2') && !ed.fpSel.size, [[...ed.fpSel], [...ed.trackSel]]);
// Shift adds a box to the selection
ev('pointermove', 3, 6, 0); ev('pointerdown', 3, 6, 1, true); for (let k = 1; k <= 4; k++) ev('pointermove', 3 + 6 * k / 4, 6 + 6.4 * k / 4, 1); ev('pointerup', 9, 12.4, 0); await wait(40);
check('shift-adds', ed.trackSel.has('u2') && ed.trackSel.has('u1') && ed.fpSel.has(r1().id), [[...ed.fpSel], [...ed.trackSel]]);
// a click on empty space clears it
ev('pointermove', 20, 20, 0); ev('pointerdown', 20, 20, 1); ev('pointerup', 20, 20, 0); await wait(30);
check('cleared', !ed.fpSel.size && !ed.trackSel.size);
// move the group: R1 and its leg go up 1 mm together, in one undo step
await box(3, 6, 9, 12.4);
const h0 = app.history.undoStack.length, at0 = [...r1().at], u10 = structuredClone(tr('u1'));
ev('pointermove', 6, 8, 0); ev('pointerdown', 6, 8, 1); ev('pointermove', 6, 7.5, 1); ev('pointermove', 6, 7, 1); await wait(30);
check('group-preview', ed.previewTracks?.find((t) => t.id === 'u1')?.a[1] === u10.a[1] - MM, ed.previewTracks?.find((t) => t.id === 'u1'));
ev('pointerup', 6, 7, 0); await wait(50);
check('group-moved', r1().at[1] === at0[1] - MM && tr('u1').a[1] === u10.a[1] - MM && tr('u1').b[1] === u10.b[1] - MM && app.history.undoStack.length === h0 + 1, [r1().at, tr('u1')]);
check('group-others-stay', tr('u2').a[1] === 12 * MM);
app.undo(); await wait(30);
check('group-undo', r1().at[1] === at0[1] && JSON.stringify(tr('u1')) === JSON.stringify(u10));
// arrows nudge the tracks in the selection too
key('ArrowRight');
check('nudge', tr('u1').a[0] === u10.a[0] + app.project.board.grid.main && r1().at[0] === at0[0] + app.project.board.grid.main);
app.undo(); await wait(30);
// the Rip up tool
const ripBtn = document.querySelector('[data-ws="board"] button[title^="Rip up"]');
check('rip-tool', !!ripBtn);
ripBtn.click();
check('rip-active', ed.tool === 'ripup');
const n0 = unrouted();
ev('pointermove', 20, 12, 0); await wait(20);
check('rip-hover', ed.ripHover && ['u1', 'u2', 'u3'].every((id) => ed.ripHover.has(id)) && !ed.ripHover.has('o'), ed.ripHover && [...ed.ripHover]);
const h1 = app.history.undoStack.length;
ev('pointerdown', 20, 12, 1); ev('pointerup', 20, 12, 0); await wait(40);
check('rip-run', !tr('u1') && !tr('u2') && !tr('u3') && !!tr('o') && unrouted() === n0 + 1 && app.history.undoStack.length === h1 + 1, [app.project.board.tracks.map((t) => t.id), unrouted()]);
app.undo(); await wait(30);
check('rip-undo', !!tr('u1') && !!tr('u2') && !!tr('u3') && unrouted() === n0);
// Shift+click: just that segment
ev('pointermove', 20, 12, 0); ev('pointerdown', 20, 12, 1, true); ev('pointerup', 20, 12, 0); await wait(40);
check('rip-segment', !tr('u2') && !!tr('u1') && !!tr('u3'), app.project.board.tracks.map((t) => t.id));
app.undo(); await wait(30);
// a box: everything in it (the other net's track, wholly inside)
await box(1, 12.6, 39, 13.3);
check('rip-box', !tr('o') && !!tr('u2'), app.project.board.tracks.map((t) => t.id));
app.undo(); await wait(30);
check('rip-box-undo', !!tr('o'));
ed.setTool('select');
return { fails };
