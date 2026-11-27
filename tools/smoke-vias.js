// Vias journey (#21): route from R1 to R2 going down to B.Cu and back up with V (two vias on the
// Net); the Via tool takes the Net of the track it lands on; U selects the whole connection;
// width and layer edits; deleting the connection; all undoable. 4-layer: the layer pair choice.
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
const move = (x, y) => ws.view.canvas.dispatchEvent(new PointerEvent('pointermove', { ...pt(x, y), button: 0, buttons: 0, bubbles: true, pointerId: 51 }));
const click = (x, y) => { move(x, y); const o = { ...pt(x, y), button: 0, buttons: 1, bubbles: true, cancelable: true, pointerId: 51, detail: 1 }; ws.view.canvas.dispatchEvent(new PointerEvent('pointerdown', o)); ws.view.canvas.dispatchEvent(new PointerEvent('pointerup', { ...o, buttons: 0 })); };
const key = (k, more = {}) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...more }));
const b = () => app.project.board;
[...document.querySelectorAll('[data-ws="board"] .corner-seg button')].find((x) => x.dataset.bend === '0').click();
const ch = document.querySelector('[data-ws="board"] input[aria-label="Mitre (mm)"]'); ch.value = '0'; ch.dispatchEvent(new Event('change'));
check('pair-hidden-2layer', document.querySelector('[data-ws="board"] .pair-box').hidden);
key('x');
click(5.9125, 5);
move(10, 5); key('v');
check('to-bcu', ed.route.layer === 'B.Cu' && ed.activeLayer === 'B.Cu' && ed.route.vias.length === 1);
move(10, 14); click(10, 14);
move(18, 14); key('v');
check('to-fcu', ed.route.layer === 'F.Cu' && ed.route.vias.length === 2);
// undo while routing takes the via back to the layer before, still routing; the Board is untouched
const u0 = app.history.undoStack.length;
key('z', { ctrlKey: true });
check('undo-via', !!ed.route && ed.route.layer === 'B.Cu' && ed.activeLayer === 'B.Cu' && ed.route.vias.length === 1 && app.history.undoStack.length === u0, ed.route && [ed.route.layer, ed.activeLayer, ed.route.vias.length]);
move(18, 14); key('v');
check('via-again', ed.route.layer === 'F.Cu' && ed.route.vias.length === 2);
click(21.0875, 14);
check('routed', !ed.route && b().vias.length === 2 && b().tracks.some((t) => t.layer === 'B.Cu') && b().tracks.some((t) => t.layer === 'F.Cu'), [b().vias.length, b().tracks.map((t) => t.layer)]);
const net = b().tracks[0].net;
check('via-net', b().vias.every((v) => v.net === net && v.from === 'F.Cu' && v.to === 'B.Cu'));
check('rats-0', Object.values(ed._rats.unrouted).reduce((a, c) => a + c, 0) === 0, ed._rats.unrouted);
// the Via tool: on the B.Cu track it takes its Net
ed.setTool('via');
click(10, 9);
check('via-tool', b().vias.length === 3 && b().vias[2].net === net, b().vias[2]);
key('z', { ctrlKey: true });
// select a track, then U: the whole connection
key('v'); // Select tool
const bt = b().tracks.find((t) => t.layer === 'B.Cu');
click((bt.a[0] + bt.b[0]) / 2 / MM, (bt.a[1] + bt.b[1]) / 2 / MM);
check('one', ed.trackSel.size === 1, ed.trackSel.size);
key('u');
check('connection', ed.trackSel.size === b().tracks.length + b().vias.length, [ed.trackSel.size, b().tracks.length, b().vias.length]);
// width for all the selected tracks
const w = ed.propsEl.querySelector('input[aria-label="Width"]'); w.value = '0.4'; w.dispatchEvent(new Event('change'));
check('width', b().tracks.every((t) => t.width === 0.4 * MM));
key('z', { ctrlKey: true });
check('width-undo', b().tracks.every((t) => t.width === 0.25 * MM));
// one track to another layer
key('Escape'); click((bt.a[0] + bt.b[0]) / 2 / MM, (bt.a[1] + bt.b[1]) / 2 / MM);
const ly = ed.propsEl.querySelector('select[aria-label="Track layer"]'); ly.value = 'F.Cu'; ly.dispatchEvent(new Event('change'));
check('layer', b().tracks.find((t) => t.id === bt.id).layer === 'F.Cu');
key('z', { ctrlKey: true });
// delete the whole connection
click((bt.a[0] + bt.b[0]) / 2 / MM, (bt.a[1] + bt.b[1]) / 2 / MM); key('u'); key('Delete');
check('deleted', !b().tracks.length && !b().vias.length);
key('z', { ctrlKey: true });
check('undo', b().tracks.length > 0 && b().vias.length === 2);
// #106: drag a via with Select: its tracks on both layers follow, the net stays routed, one undo step
key('Escape');
const v0 = structuredClone(b().vias[0]), vx = v0.at[0] / MM, vy = v0.at[1] / MM;
const ptr = (type, x, y, buttons) => ws.view.canvas.dispatchEvent(new PointerEvent(type, { ...pt(x, y), button: 0, buttons, bubbles: true, cancelable: true, pointerId: 81 }));
const hv = app.history.undoStack.length;
ptr('pointermove', vx, vy, 0); ptr('pointerdown', vx, vy, 1); ptr('pointermove', vx + 0.5, vy + 1, 1); ptr('pointermove', vx + 1, vy + 2, 1);
check('via-drag-preview', ed.trackDrag?.kind === 'via' && !!ed.trackDrag.result, ed.trackDrag?.kind);
ptr('pointerup', vx + 1, vy + 2, 0);
const v1 = b().vias.find((v) => v.id === v0.id);
const rats = () => Object.values(ed._rats.unrouted).reduce((a, c) => a + c, 0);
check('via-moved', v1.at[0] === v0.at[0] + MM && v1.at[1] === v0.at[1] + 2 * MM && app.history.undoStack.length === hv + 1, v1.at);
check('via-tracks-follow', b().tracks.filter((t) => [t.a, t.b].some((q) => q[0] === v1.at[0] && q[1] === v1.at[1])).length >= 2 && rats() === 0, rats());
key('z', { ctrlKey: true });
check('via-undo', b().vias.find((v) => v.id === v0.id).at[0] === v0.at[0]);
// V5: its X in Properties
key('Escape'); ptr('pointermove', vx, vy, 0); ptr('pointerdown', vx, vy, 1); ptr('pointerup', vx, vy, 0);
ed.openProperties();
const vX = ed.propsEl.querySelector('input[aria-label="Via X"]');
check('via-x-field', !!vX);
vX.value = String((v0.at[0] - (b().origin?.[0] || 0)) / MM + 1); vX.dispatchEvent(new Event('change'));
check('via-x', b().vias.find((v) => v.id === v0.id).at[0] === v0.at[0] + MM && rats() === 0, [b().vias.find((v) => v.id === v0.id).at, rats()]);
key('z', { ctrlKey: true });
// 4 layers: the routing strip offers layer pairs
document.querySelector('[data-ws="board"] .stack-row button:nth-child(2)').click();
key('x');
check('pairs-4layer', !document.querySelector('[data-ws="board"] .pair-box').hidden && document.querySelector('[data-ws="board"] select[aria-label="Via layer pair"]').options.length === 6);
key('Escape');
return { fails };
