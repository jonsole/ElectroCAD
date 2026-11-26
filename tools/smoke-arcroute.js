// Arc routing journey (#94): bend styles 5 (arc then straight) and 6 (straight then arc), picked by
// right-click and /, each route pad to pad with one arc Track and one straight one, joined end to
// end; the airwire clears and one undo takes the route back. A Round mitre (#95) rounds a bend
// into an arc Track.
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
document.querySelector('[data-ws="board"] .mode-group [data-mode="free"]').click();
key('x');
[...document.querySelectorAll('[data-ws="board"] .corner-seg button')].find((b) => b.dataset.bend === '4').click();
const ch = document.querySelector('[data-ws="board"] input[aria-label="Mitre (mm)"]'); ch.value = '0'; ch.dispatchEvent(new Event('change'));
rclick(15, 2);
check('bend-5', ed.bend === 5 && document.querySelector('[data-ws="board"] .corner-seg button.active')?.dataset.bend === '5', ed.bend);
const route = (label) => {
  click(5.9125, 5);
  move(15, 10);
  check(`${label}-preview`, ed.routeView.segments.some((s) => s.mid), ed.routeView.segments);
  const undo0 = app.history.undoStack.length;
  click(21.0875, 14);
  const ts = app.project.board.tracks;
  check(`${label}-committed`, !ed.route && app.history.undoStack.length === undo0 + 1 && ts.length === 2 && ts.filter((t) => t.mid).length === 1, ts);
  check(`${label}-joined`, ts.some((t) => ts.some((u) => u !== t && u.a[0] === t.b[0] && u.a[1] === t.b[1])));
  check(`${label}-rats`, unrouted() === 0, ed._rats.unrouted);
  return ts;
};
const t5 = route('bend5');
check('bend5-arc-first', !!t5.find((t) => t.mid && t.a[0] === 5.9125 * MM));
app.undo();
check('undo', app.project.board.tracks.length === 0 && unrouted() === 1);
rclick(15, 2);
check('bend-6', ed.bend === 6);
const t6 = route('bend6');
check('bend6-arc-last', !!t6.find((t) => t.mid && t.b[0] === 21.0875 * MM));
app.undo();
// a rounded mitre (#95): bend 0 with Round 1 mm gives two straights joined by an arc
[...document.querySelectorAll('[data-ws="board"] .corner-seg button')].find((b) => b.dataset.bend === '0').click();
ch.value = '1'; ch.dispatchEvent(new Event('change'));
document.querySelector('[data-ws="board"] .mitre-seg [data-mitre="round"]').click();
check('round-picked', ed.mitre === 'round' && localStorage.getItem('electrocad.boardMitre') === '"round"');
click(5.9125, 5);
move(15, 10);
check('round-preview', ed.routeView.segments.filter((s) => s.mid).length === 1, ed.routeView.segments);
click(21.0875, 14);
const tr = app.project.board.tracks;
check('round-committed', tr.length === 3 && tr.filter((t) => t.mid).length === 1 && unrouted() === 0, tr);
document.querySelector('[data-ws="board"] .mitre-seg [data-mitre="straight"]').click();
ch.value = '0'; ch.dispatchEvent(new Event('change'));
key('Escape');
return { fails };
