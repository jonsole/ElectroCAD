// Inspector journey (#9): appears on selection and hides when cleared; edits are single undo
// steps; a duplicate Reference designator is refused with a message and changes nothing.
const app = window.electrocad;
const fails = [];
const check = (name, cond, info) => { if (!cond) fails.push(name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); };
const ed = app.workspace('schematic').editor;
const G = 1270000;
const [R] = ed.parts;
const put = (x, y) => { ed.beginPlace(R); ed.placing.at = [x * G, y * G]; const r = ed.commitPlace(); ed.endPlace(); return r; };
const a = put(40, 40), b = put(60, 40);
const insp = () => document.querySelector('.inspector');
ed.selection = new Set(); ed.refresh();
check('sheet-card-when-empty', !!insp().querySelector('select[aria-label="Grid"]'));
ed.selection = new Set([a.sym.id]); ed.refresh();
check('shown-on-select', /R1/.test(insp().querySelector('.insp-title').textContent));
check('header-icons', ['Rotate (R)', 'Mirror (X)', 'Duplicate (Ctrl+D)', 'Delete (Del)'].every((t) => insp().querySelector(`.insp-head button[title="${t}"]`)));
{ // each card moves by its header and resizes from its corner on its own; double-click docks it
  const card = insp();
  const ev = (type, x, y, target) => target.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, button: 0, buttons: 1, bubbles: true, pointerId: 7 }));
  const head = card.querySelector('.insp-title').getBoundingClientRect();
  const before = card.getBoundingClientRect();
  ev('pointerdown', head.left + 5, head.top + 5, card.querySelector('.insp-title')); ev('pointermove', head.left - 195, head.top + 45, card); ev('pointerup', head.left - 195, head.top + 45, card);
  const after = card.getBoundingClientRect();
  check('card-moved', card.classList.contains('card-free') && Math.abs(after.left - (before.left - 200)) < 2 && Math.abs(after.top - (before.top + 40)) < 2, [before.left, after.left]);
  ev('pointerdown', after.right - 4, after.bottom - 4, card); ev('pointermove', after.right + 56, after.bottom - 4, card); ev('pointerup', after.right + 56, after.bottom - 4, card);
  check('card-resized', Math.abs(card.getBoundingClientRect().width - (after.width + 60)) < 2, card.getBoundingClientRect().width);
  check('card-remembered', !!localStorage.getItem('electrocad.card.schematic-inspector'));
  // the Netlist card stays docked and moves separately
  ed.toggleNetlist(true);
  const nl = document.querySelector('.netlist-panel');
  check('netlist-still-docked', nl.parentElement.classList.contains('float-stack'));
  const nh = nl.querySelector('.fp-head b').getBoundingClientRect();
  ev('pointerdown', nh.left + 3, nh.top + 3, nl.querySelector('.fp-head b')); ev('pointermove', nh.left - 297, nh.top + 103, nl); ev('pointerup', nh.left - 297, nh.top + 103, nl);
  check('netlist-moved-alone', nl.classList.contains('card-free') && Math.abs(card.getBoundingClientRect().left - after.left) < 2);
  for (const c of [card, nl]) c.querySelector('.insp-head, .fp-head').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  check('cards-docked-again', card.parentElement.classList.contains('float-stack') && nl.parentElement.classList.contains('float-stack') && !card.style.left
    && !localStorage.getItem('electrocad.card.schematic-inspector') && !localStorage.getItem('electrocad.card.schematic-netlist'));
  check('dock-order', [...document.querySelector('.float-stack').children].indexOf(card) < [...document.querySelector('.float-stack').children].indexOf(nl));
  ed.toggleNetlist(false);
}

const set = (label, v) => { const i = insp().querySelector(`input[aria-label="${label}"]`); i.value = v; i.dispatchEvent(new Event('change')); return i; };
const depth = () => app.history.undoStack.length;
let d = depth();
set('Reference', 'R2');
check('dup-refused', app.project.components[a.comp.id].ref === 'R1' && /already used/.test(insp().querySelector('.insp-error').textContent) && depth() === d);
set('Reference', 'R9');
check('renamed', app.project.components[a.comp.id].ref === 'R9' && depth() === d + 1);
set('Value', '1k');
check('value', app.project.components[a.comp.id].value === '1k' && depth() === d + 2);
const fp = insp().querySelector('select[data-role="footprint"]');
fp.value = [...fp.options].find((o) => o.textContent === 'LED_0805_2012Metric').value; fp.dispatchEvent(new Event('change'));
check('footprint', app.project.footprints[app.project.components[a.comp.id].footprint.fpKey]?.footprint.name === 'LED_0805_2012Metric' && depth() === d + 3, app.project.components[a.comp.id].footprint);
set('Y (mm)', '63.5');
check('moved', app.project.schematic.sheets[0].symbols.find((y) => y.id === a.sym.id).at[1] === 50 * G);
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
check('undo-two', app.project.components[a.comp.id].footprint.fpId === 'R_0805' && app.project.components[a.comp.id].value === '1k');
check('inspector-follows-undo', insp().querySelector('select[data-role="footprint"]').selectedOptions[0].textContent === 'R_0805_2012Metric');
ed.selection = new Set([a.sym.id, b.sym.id]); ed.refresh();
check('multi', /2 parts selected/.test(insp().querySelector('.insp-title').textContent));
const fs = insp().querySelector('select[data-role="field-style-part"]');
fs.value = 'compact'; fs.dispatchEvent(new Event('change'));
check('multi-field-style', [a.comp.id, b.comp.id].every((id) => app.project.components[id].fieldStyle === 'compact'));
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
check('esc-sheet-card', !!insp().querySelector('select[aria-label="Grid"]'));

// Double-click a field on the canvas to edit it in place.
const ws = app.workspace('schematic');
ws.view.view.fit({ x0: 30 * G, y0: 30 * G, x1: 70 * G, y1: 60 * G }, ws.view.w, ws.view.h, 20);
ws.view.draw();
const symA = app.project.schematic.sheets[0].symbols.find((y) => y.componentId === a.comp.id);
const valItem = ed.placement.get(symA.id).items.find((i) => i.keys.includes('value'));
const r = ws.view.canvas.getBoundingClientRect();
// the parts use Compact here, so the field is one line ("R9 1k"): aim at the Value end
const [vx, vy] = ws.view.view.toScreen([valItem.box.x1 - (valItem.box.x1 - valItem.box.x0) * 0.1, (valItem.box.y0 + valItem.box.y1) / 2]);
ws.view.canvas.dispatchEvent(new MouseEvent('dblclick', { clientX: r.left + vx, clientY: r.top + vy, bubbles: true, cancelable: true }));
let box = document.querySelector('.field-edit');
check('dblclick-opens-editor', !!box && box.value === app.project.components[a.comp.id].value, box && box.value);
const depth2 = app.history.undoStack.length;
box.value = '22k';
box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
check('dblclick-value-saved', app.project.components[a.comp.id].value === '22k' && !document.querySelector('.field-edit') && app.history.undoStack.length === depth2 + 1);
ed.editField(symA.id, 'reference');
box = document.querySelector('.field-edit');
box.value = app.project.components[b.comp.id].ref;
box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
check('dblclick-dup-refused', !!document.querySelector('.field-edit') && /already used/.test(document.querySelector('.field-edit-tip').textContent));
box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
check('esc-cancels', !document.querySelector('.field-edit') && app.history.undoStack.length === depth2 + 1);
return { fails };
