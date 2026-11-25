// Reference / Value journey (#65): drag a footprint's Reference on the Board (it becomes that
// placement's own text), undo it, drag it again, then hide the Value and Reset the Reference in
// Properties. The text moves with the footprint.
const app = window.electrocad;
const fails = [];
const check = (name, cond, info) => { if (!cond) fails.push(name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const L = window.electrocadLib, G = 1270000, MM = 1e6;
const part = (n) => app.workspace('schematic').editor.parts.find((x) => x.name === n);
let id;
app.edit('demo', (pr) => {
  const s = pr.schematic.sheets[0];
  id = L.project.addComponent(pr, s, part('Resistor'), [G * 20, G * 20]).comp.id;
  pr.board.outline = [{ type: 'rect', a: [0, 0], b: [30e6, 20e6], layer: 'Edge.Cuts' }];
});
app.setWorkspace('board');
const ws = app.workspace('board'), ed = ws.editor;
ed.annotate();
[...document.querySelectorAll('.annotate-modal button')].find((b) => b.textContent === 'Apply').click();
const bf = () => app.project.board.footprints.find((f) => f.componentId === id);
app.edit('place', (p) => { p.board.footprints.find((f) => f.componentId === id).at = [10 * MM, 10 * MM]; });
ws.view.view.fit({ x0: 0, y0: 0, x1: 25 * MM, y1: 20 * MM }, ws.view.w, ws.view.h, 10);
await wait(50);
const pt = (x, y) => { const r = ws.view.canvas.getBoundingClientRect(); const [sx, sy] = ws.view.view.toScreen([x, y]); return { clientX: r.left + sx, clientY: r.top + sy }; };
const ev = (type, x, y, buttons) => ws.view.canvas.dispatchEvent(new PointerEvent(type, { ...pt(x, y), button: 0, buttons, bubbles: true, cancelable: true, pointerId: 22 }));
// where R1 is drawn now (the automatic Reference above the courtyard)
const hit = (x, y) => ed._hitFieldText([x, y], 0.2 * MM);
// find the reference text by scanning above the footprint
let start = null;
for (let y = 10 * MM; y > 5 * MM && !start; y -= 0.1 * MM) { const h = hit(10 * MM, y); if (h?.key === 'ref') start = [10 * MM, y]; }
check('found-ref', !!start);
const drag = (from, to) => { ev('pointermove', ...from, 0); ev('pointerdown', ...from, 1); ev('pointermove', from[0] + 0.5 * MM, from[1], 1); ev('pointermove', ...to, 1); ev('pointerup', ...to, 0); };
drag(start, [start[0] + 5 * MM, start[1]]);
check('override', bf().texts?.ref && bf().texts.ref.at[0] === 5 * MM, bf().texts);
check('selected', ed.fpSel.has(bf().id));
check('footprint-stayed', bf().at[0] === 10 * MM);
app.undo();
check('undo', !bf().texts);
drag(start, [start[0] + 5 * MM, start[1]]);
// the text moves with the footprint
app.edit('move', (p) => { p.board.footprints.find((f) => f.componentId === id).at = [12 * MM, 10 * MM]; });
check('moves-with', ed._hitFieldText([start[0] + 7 * MM, start[1]], 0.2 * MM)?.key === 'ref');
// Properties: hide the Value, reset the Reference
ed.fpSel = new Set([bf().id]); ed.openProperties(); ed.refresh();
await wait(50);
const show = document.querySelector('input[aria-label="Show Value"]');
check('props', !!show && show.checked);
if (show) { show.checked = false; show.dispatchEvent(new Event('change')); }
check('value-hidden', bf().texts?.value?.hidden === true);
const resetBtn = document.querySelector('.field-text-row[data-field="ref"] button');
check('reset-enabled', resetBtn && !resetBtn.disabled);
resetBtn?.click();
check('reset', !bf().texts?.ref && bf().texts?.value?.hidden === true, bf().texts);
return { fails };
