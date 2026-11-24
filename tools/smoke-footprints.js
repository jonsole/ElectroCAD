// Footprint placement journey (#17): annotate two resistors; drag one (the Ratsnest follows the
// drag live); R rotates, F flips to the back (B.Cu pads), L locks (then a drag does nothing);
// Properties sets an exact angle; swapping the Footprint from the Board and from the Schematic
// inspector swaps it in place (placement kept); everything is undoable.
const app = window.electrocad;
const fails = [];
const check = (name, cond, info) => { if (!cond) fails.push(name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); };
const L = window.electrocadLib, G = 1270000, MM = 1e6;
const part = (n) => app.workspace('schematic').editor.parts.find((x) => x.name === n);
let ids;
app.edit('demo', (pr) => {
  const s = pr.schematic.sheets[0];
  const r1 = L.project.addComponent(pr, s, part('Resistor'), [G * 20, G * 20]).comp;
  const r2 = L.project.addComponent(pr, s, part('Resistor'), [G * 40, G * 20]).comp;
  const pin = (c, n) => { const y = s.symbols.find((q) => q.componentId === c.id); return L.project.pinPositions(pr, y).find((x) => x.pin.number === n).at; };
  L.schematic.addWire(pr, s, [pin(r1, '2'), pin(r2, '1')]);
  pr.board.outline = [{ type: 'rect', a: [0, 0], b: [30e6, 20e6], layer: 'Edge.Cuts' }];
  ids = { r1: r1.id, r2: r2.id };
});
app.setWorkspace('board');
const ws = app.workspace('board'), ed = ws.editor;
ed.annotate();
[...document.querySelectorAll('.annotate-modal button')].find((b) => b.textContent === 'Apply').click();
const fp = (id) => app.project.board.footprints.find((f) => f.componentId === id);
ws.view.view.fit({ x0: -5 * MM, y0: -5 * MM, x1: 60 * MM, y1: 30 * MM }, ws.view.w, ws.view.h, 10);
const pt = (x, y) => { const r = ws.view.canvas.getBoundingClientRect(); const [sx, sy] = ws.view.view.toScreen([x, y]); return { clientX: r.left + sx, clientY: r.top + sy }; };
const ev = (type, x, y, buttons) => ws.view.canvas.dispatchEvent(new PointerEvent(type, { ...pt(x, y), button: 0, buttons, bubbles: true, cancelable: true, pointerId: 21 }));
const key = (k, more = {}) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...more }));
const key0 = (k) => key(k);
check('rats-start', Object.values(ed._rats.unrouted).reduce((a, b) => a + b, 0) === 1, ed._rats.unrouted);
// drag R1 by 10 mm left and 8 mm down; mid-drag the Ratsnest already follows
const f1 = fp(ids.r1), a0 = [...f1.at];
ev('pointermove', a0[0], a0[1], 0); ev('pointerdown', a0[0], a0[1], 1);
ev('pointermove', a0[0] - 5 * MM, a0[1] + 4 * MM, 1);
ev('pointermove', a0[0] - 10 * MM, a0[1] + 8 * MM, 1);
const wire = ed._rats.wires[0];
check('rats-live', wire && (Math.abs(wire.a[1] - (a0[1] + 8 * MM)) < 2 * MM || Math.abs(wire.b[1] - (a0[1] + 8 * MM)) < 2 * MM), wire);
check('not-yet-moved', fp(ids.r1).at[0] === a0[0]);
ev('pointerup', a0[0] - 10 * MM, a0[1] + 8 * MM, 0);
check('moved', fp(ids.r1).at[0] === a0[0] - 10 * MM && fp(ids.r1).at[1] === a0[1] + 8 * MM, [a0, fp(ids.r1).at]);
check('selected', ed.fpSel.has(fp(ids.r1).id) && /Reference/.test(ed.propsEl.textContent));
key0('r');
check('rot90', fp(ids.r1).rot === 90);
key0('f');
check('flipped', fp(ids.r1).side === 'B');
// exact angle from Properties
const rot = ed.propsEl.querySelector('input[aria-label="Rotation"]');
rot.value = '33.333'; rot.dispatchEvent(new Event('change'));
check('angle', fp(ids.r1).rot === 33.33, fp(ids.r1).rot);
// lock: a drag does nothing
key0('l');
check('locked', fp(ids.r1).locked === true);
const b0 = [...fp(ids.r1).at];
key('ArrowRight');
check('locked-stays', fp(ids.r1).at[0] === b0[0]);
key0('l');
// swap the Footprint on the Board: placement kept
const sel = ed.propsEl.querySelector('select[aria-label="Footprint"]');
const tht = [...sel.options].find((o) => /THT|Axial|PinHeader/.test(o.textContent));
sel.value = tht.value; sel.dispatchEvent(new Event('change'));
const comp = () => app.project.components[ids.r1];
check('swap-board', window.electrocadLib.project.footprintOf(app.project, comp()).name === tht.textContent && fp(ids.r1).rot === 33.33 && fp(ids.r1).side === 'B', [window.electrocadLib.project.footprintOf(app.project, comp())?.name, tht.textContent]);
check('swap-rats', Object.values(ed._rats.unrouted).reduce((a, b) => a + b, 0) === 1);
// …and from the Schematic inspector
app.setWorkspace('schematic');
const sed = app.workspace('schematic').editor;
sed.selection = new Set([app.project.schematic.sheets[0].symbols.find((y) => y.componentId === ids.r1).id]); sed.refresh();
const ssel = document.querySelector('.inspector select[aria-label="Footprint"]');
const smd = [...ssel.options].find((o) => /0603/.test(o.textContent));
ssel.value = smd.value; ssel.dispatchEvent(new Event('change'));
check('swap-schematic', /0603/.test(window.electrocadLib.project.footprintOf(app.project, comp()).name) && fp(ids.r1).side === 'B' && fp(ids.r1).rot === 33.33);
// undo the swap: back to the THT one, still in place
key('z', { ctrlKey: true });
check('undo-swap', window.electrocadLib.project.footprintOf(app.project, comp()).name === tht.textContent);
app.setWorkspace('board');
await app.saveNow();
return { fails };
