// Labels and Sheets journey (#7): the label tools place Net labels (named in place), Ground and
// Global labels; a second Sheet is added from the bottom bar; a local label of the same name on
// it stays separate, a Global label joins; undo removes a Sheet; everything survives a restart.
const app = window.electrocad;
const fails = [];
const check = (name, cond, info) => { if (!cond) fails.push(name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); };
const { project: P, netlist: N } = window.electrocadLib;
const ed = app.workspace('schematic').editor;
const ws = app.workspace('schematic');
const G = 1270000;
const [R] = ed.parts;
const put = (x, y) => { ed.beginPlace(R); ed.placing.at = [x * G, y * G]; const r = ed.commitPlace(); ed.endPlace(); return r; };
const pin = (sym, n) => P.pinPositions(app.project, sym).find((x) => x.pin.number === n).at;
const key = (k, more = {}) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...more }));
const click = (at) => {
  const r = ws.view.canvas.getBoundingClientRect();
  const [x, y] = ws.view.view.toScreen(at);
  const o = { clientX: r.left + x, clientY: r.top + y, button: 0, buttons: 1, bubbles: true, cancelable: true, pointerId: 1 };
  ws.view.canvas.dispatchEvent(new PointerEvent('pointerdown', o));
  ws.view.canvas.dispatchEvent(new PointerEvent('pointerup', { ...o, buttons: 0 }));
};
const netOf = (ref, p) => N.buildNetlist(app.project).nets.find((n) => n.pins.some((x) => x.ref === ref && x.pin === p));
ws.view.view.fit({ x0: 30 * G, y0: 30 * G, x1: 80 * G, y1: 60 * G }, ws.view.w, ws.view.h, 20);

const a = put(40, 40);
// L: a Net label, named in the box that opens where you click
key('l');
check('net-label-tool', ed.tool === 'netLabel');
click(pin(a.sym, '2'));
const box = document.querySelector('.field-edit.label-edit');
check('name-box', !!box);
box.value = 'EN';
box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
check('net-label-placed', netOf('R1', '2')?.name === 'EN', netOf('R1', '2'));
// a bad name is refused
click(pin(a.sym, '2').map((v, i) => v + (i ? 4 * G : 0)));
const box2 = document.querySelector('.field-edit.label-edit');
box2.value = 'two words';
box2.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
check('bad-name-refused', !!document.querySelector('.field-edit.label-edit') && /no spaces/.test(document.querySelector('.field-edit-tip').textContent));
box2.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
check('esc-cancels', !document.querySelector('.field-edit.label-edit') && app.project.schematic.sheets[0].labels.length === 1);
// G: Ground goes down at once
key('g');
click(pin(a.sym, '1'));
check('ground', netOf('R1', '1')?.name === 'GND');
key('Escape');
check('back-to-select', ed.tool === 'select');
// P: a Power symbol goes down at once with the last power net (+5V the first time), no name box
const c = put(40, 52);
key('p');
click(pin(c.sym, '2'));
check('power-placed-at-once', !document.querySelector('.field-edit.label-edit') && netOf('R2', '2')?.name === '+5V', netOf('R2', '2'));
key('Escape');
// double-click its name to choose another power net; the next one uses it
ws.view.draw();
const pl = app.project.schematic.sheets[0].labels.find((l) => l.net === '+5V');
const bb = window.electrocadLib.labels.labelBounds(pl);
{ const r = ws.view.canvas.getBoundingClientRect(); const [x, y] = ws.view.view.toScreen([(bb.x0 + bb.x1) / 2, bb.y0 + (bb.y1 - bb.y0) * 0.2]);
  ws.view.canvas.dispatchEvent(new MouseEvent('dblclick', { clientX: r.left + x, clientY: r.top + y, bubbles: true, cancelable: true })); }
const pbox = document.querySelector('.field-edit.label-edit');
check('power-dblclick-opens', !!pbox && pbox.value === '+5V' && !!document.getElementById(pbox.getAttribute('list'))?.querySelector('option[value="+3V3"]'));
if (pbox) { pbox.value = '+3V3'; pbox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); }
check('power-renamed', netOf('R2', '2')?.name === '+3V3');
key('p');
click(pin(c.sym, '1'));
check('power-uses-last', netOf('R2', '1')?.name === '+3V3', netOf('R2', '1'));
key('Escape');

// a second Sheet from the bottom bar's +
document.querySelector('.chip-add').click();
check('sheet-added', app.project.schematic.sheets.length === 2 && ed.sheet === app.project.schematic.sheets[1]);
check('chips', document.querySelectorAll('.bottom-bar .text-chip:not(.chip-add)').length === 2);
const b = put(40, 40);
check('placed-on-sheet-2', app.project.schematic.sheets[1].symbols.length === 1 && app.project.schematic.sheets[0].symbols.length === 2);
key('l');
click(pin(b.sym, '2'));
const box3 = document.querySelector('.field-edit.label-edit');
box3.value = 'EN';
box3.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
check('local-stays-separate', netOf('R1', '2').pins.length === 1 && netOf('R3', '2').pins.length === 1);
// the inspector makes it Global: now one EN Net across both Sheets
key('Escape');
ed.selection = new Set([app.project.schematic.sheets[1].labels[0].id]); ed.refresh();
const scope = document.querySelector('.inspector select[aria-label="Label scope"]');
scope.value = 'global'; scope.dispatchEvent(new Event('change'));
app.edit('global on sheet 1', (p) => { p.schematic.sheets[0].labels.find((l) => l.net === 'EN').scope = 'global'; });
check('global-joins', netOf('R1', '2').pins.map((x) => x.ref).join() === 'R1,R3', netOf('R1', '2'));
// GND on Sheet 2 joins GND on Sheet 1
app.edit('gnd 2', (p) => window.electrocadLib.schematic.addLabel(p, p.schematic.sheets[1], { at: pin(b.sym, '1'), net: 'GND', style: 'gnd' }));
check('power-joins', netOf('R3', '1').pins.map((x) => x.ref).join() === 'R1,R3');
// switch Sheets with the chips
document.querySelector('.bottom-bar .text-chip[data-sheet]').click();
check('switched', ed.sheet === app.project.schematic.sheets[0]);
// add then undo a Sheet
document.querySelector('.chip-add').click();
check('third', app.project.schematic.sheets.length === 3);
key('z', { ctrlKey: true });
check('undo-sheet', app.project.schematic.sheets.length === 2 && app.project.schematic.sheets.includes(ed.sheet));
localStorage.setItem('smoke.labels', JSON.stringify(N.buildNetlist(app.project)));
app.saveNow?.();
return { fails };
