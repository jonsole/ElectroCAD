// Multi-Unit journey (#10): click an LM324 tile and click five times: U1A–U1E, then the strip
// offers New U2; the Unit strip can pick another Unit; deleting one Unit keeps U1; the inspector
// swaps a Unit; the Netlist maps every Unit onto the one SOIC-14.
const app = window.electrocad;
const fails = [];
const check = (name, cond, info) => { if (!cond) fails.push(name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); };
const ed = app.workspace('schematic').editor;
const ws = app.workspace('schematic');
const G = 1270000;
ws.view.view.fit({ x0: 0, y0: 0, x1: 160 * G, y1: 90 * G }, ws.view.w, ws.view.h, 20);
const r = ws.view.canvas.getBoundingClientRect();
const click = (x, y) => {
  const [sx, sy] = ws.view.view.toScreen([x * G, y * G]);
  const o = { clientX: r.left + sx, clientY: r.top + sy, button: 0, buttons: 1, bubbles: true, cancelable: true, pointerId: 4 };
  ws.view.canvas.dispatchEvent(new PointerEvent('pointermove', { ...o, buttons: 0 }));
  ws.view.canvas.dispatchEvent(new PointerEvent('pointerdown', o));
  ws.view.canvas.dispatchEvent(new PointerEvent('pointerup', { ...o, buttons: 0 }));
};
const tile = document.querySelector('.part-tile[aria-label="LM324"]');
check('tile', !!tile);
tile.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true, clientX: 5, clientY: 5 }));
document.dispatchEvent(new PointerEvent('pointerup', { button: 0, bubbles: true, clientX: 5, clientY: 5 }));
const strip = () => document.querySelector('.unit-strip');
check('strip-shown', strip() && !strip().hidden && strip().querySelectorAll('.us-unit').length === 5);
for (let i = 0; i < 5; i++) click(20 + 25 * i, 20);
const sheet = app.project.schematic.sheets[0];
const U1 = Object.values(app.project.components).find((c) => c.ref === 'U1');
check('five-units', sheet.symbols.map((y) => y.unit).join() === '0,1,2,3,4' && Object.keys(app.project.components).length === 1, sheet.symbols.map((y) => y.unit));
check('then-new', /New U2/.test(strip().textContent) && strip().querySelector('.us-new.on'));
// choose U1's… nothing left: choose New, place U2A, then pick U2C from the strip
click(20, 60);
const unitBtn = (letter) => [...strip().querySelectorAll('.us-unit')].find((b) => b.textContent === letter);
unitBtn('C').click();
click(45, 60);
const U2 = Object.values(app.project.components).find((c) => c.ref === 'U2');
check('picked-c', sheet.symbols.filter((y) => y.componentId === U2?.id).map((y) => y.unit).join() === '0,2');
check('placed-greyed', unitBtn('A').disabled && unitBtn('C').disabled && !unitBtn('B').disabled);
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
check('strip-hidden', strip().hidden);
// delete U1B: U1 stays; the inspector on U1A offers B again and swaps
const u1b = sheet.symbols.find((y) => y.componentId === U1.id && y.unit === 1);
ed.selection = new Set([u1b.id]); ed.deleteSelection();
check('kept-u1', !!app.project.components[U1.id] && sheet.symbols.filter((y) => y.componentId === U1.id).length === 4);
const u1a = sheet.symbols.find((y) => y.componentId === U1.id && y.unit === 0);
ed.selection = new Set([u1a.id]); ed.openProperties(); // double-click or right-click → Properties…
const sel = document.querySelector('.inspector select[aria-label="Unit"]');
check('unit-select', !!sel && !sel.querySelector('option[value="1"]').disabled && sel.querySelector('option[value="2"]').disabled);
sel.value = '1'; sel.dispatchEvent(new Event('change'));
check('swapped', sheet.symbols.find((y) => y.id === u1a.id).unit === 1);
check('title', /U1B/.test(document.querySelector('.inspector .insp-title').textContent));
// one Footprint for all Units
const nl = window.electrocadLib.netlist.buildNetlist(app.project);
const pads = nl.unconnected.filter((x) => x.ref === 'U1').map((x) => x.pad).sort((a, b) => a - b).join();
check('pads', pads === '4,5,6,7,8,9,10,11,12,13,14', pads);
return { fails };
