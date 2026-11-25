// Sheet references journey (#76): Global labels show the other sheets their net is on, e.g. [2];
// clicking the number goes to that sheet with the net's labels there selected; the references
// follow the Netlist (a third sheet adds itself) and Sheet setup turns them off.
const app = window.electrocad;
const fails = [];
const check = (name, cond, info) => { if (!cond) fails.push(name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const { project: P, schematic: S } = window.electrocadLib;
const ws = app.workspace('schematic');
const ed = ws.editor;
const G = 1270000;
const [R] = ed.parts;
check('default-on', app.project.schematic.showSheetRefs === true);
ed.addSheet();
const [s1, s2] = app.project.schematic.sheets;
const put = (sheet, x, y, net) => app.edit('setup', (p) => {
  const sh = p.schematic.sheets.find((s) => s.id === sheet.id);
  const sym = S.placeSymbol(p, sh, R, [x * G, y * G]).sym;
  return S.addLabel(p, sh, { at: P.pinPositions(p, sym).find((q) => q.pin.number === '1').at, net, scope: 'global' });
});
const l1 = put(s1, 40, 40, 'D_A8');
const l2 = put(s2, 60, 50, 'D_A8');
ed.switchSheet(s1.id);
check('refs', JSON.stringify(ed.refs.get(l1.id)) === '[2]' && JSON.stringify(ed.refs.get(l2.id)) === '[1]', [...ed.refs]);
ws.view.view.fit({ x0: 20 * G, y0: 25 * G, x1: 70 * G, y1: 55 * G }, ws.view.w, ws.view.h, 20);
await wait(50);
// click the 2
const box = ed.refBoxes(app.project.schematic.sheets[0].labels.find((l) => l.id === l1.id))[0];
check('box', box && box.sheet === 2, box);
const r = ws.view.canvas.getBoundingClientRect();
const [sx, sy] = ws.view.view.toScreen([(box.box.x0 + box.box.x1) / 2, (box.box.y0 + box.box.y1) / 2]);
const o = { clientX: r.left + sx, clientY: r.top + sy, button: 0, buttons: 1, bubbles: true, cancelable: true, pointerId: 3 };
ws.view.canvas.dispatchEvent(new PointerEvent('pointerdown', o));
ws.view.canvas.dispatchEvent(new PointerEvent('pointerup', { ...o, buttons: 0 }));
await wait(50);
check('jumped', ed.sheet.id === s2.id, ed.sheet.name);
check('selected-there', ed.selection.has(l2.id), [...ed.selection]);
// a third sheet joins the net: both others list it
ed.addSheet();
const s3 = app.project.schematic.sheets[2];
put(s3, 40, 40, 'D_A8');
check('three', JSON.stringify(ed.refs.get(l2.id)) === '[1,3]', ed.refs.get(l2.id));
// the Properties choice: hide on this label
ed.switchSheet(s2.id);
ed.selection = new Set([l2.id]); ed.openProperties?.(); ed.refresh();
await wait(50);
const sel = document.querySelector('select[aria-label="Sheet references"]');
check('props', !!sel && sel.value === '', sel?.value);
if (sel) { sel.value = 'hide'; sel.dispatchEvent(new Event('change')); }
check('hidden', !ed.refs.has(l2.id) && app.project.schematic.sheets[1].labels.find((l) => l.id === l2.id).showRefs === false);
return { fails };
