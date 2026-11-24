// Forward annotation journey (#16): a schematic of two resistors and a capacitor; the dialog lists
// adds and nets; Apply places the Footprints beside the Outline with Pad nets (one undo step);
// F8 again shows "up to date"; renaming a Value and a Net shows in the next list and renames copper.
const app = window.electrocad;
const fails = [];
const check = (name, cond, info) => { if (!cond) fails.push(name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); };
const L = window.electrocadLib, G = 1270000;
const part = (n) => app.workspace('schematic').editor.parts.find((x) => x.name === n);
let ids;
app.edit('demo', (pr) => {
  const s = pr.schematic.sheets[0];
  const r1 = L.project.addComponent(pr, s, part('Resistor'), [G * 20, G * 20]).comp;
  const r2 = L.project.addComponent(pr, s, part('Resistor'), [G * 40, G * 20]).comp;
  const pin = (c, n) => { const y = s.symbols.find((q) => q.componentId === c.id); return L.project.pinPositions(pr, y).find((x) => x.pin.number === n).at; };
  L.schematic.addWire(pr, s, [pin(r1, '2'), pin(r2, '1')]);
  L.schematic.addLabel(pr, s, { at: pin(r1, '1'), net: '+5V', style: 'power', scope: 'global' });
  pr.board.outline = [{ type: 'rect', a: [0, 0], b: [30e6, 20e6], layer: 'Edge.Cuts' }];
  ids = { r1: r1.id, r2: r2.id };
});
app.setWorkspace('board');
const ws = app.workspace('board');
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F8', bubbles: true }));
let dlg = document.querySelector('.annotate-modal');
check('dialog', !!dlg);
const rows = [...dlg.querySelectorAll('.annotate-row')].map((r) => r.textContent);
check('adds', rows.filter((t) => t.startsWith('Add')).length === 2, rows);
check('nets', rows.some((t) => /New net\+5V: R1\.1/.test(t)) && rows.some((t) => /R1\.2, R2\.1/.test(t)), rows);
const undoBefore = app.history.undoStack.length;
[...dlg.querySelectorAll('button')].find((b) => b.textContent === 'Apply').click();
const b = app.project.board;
check('placed', b.footprints.length === 2 && b.footprints.every((f) => f.at[0] > 30e6), b.footprints.map((f) => f.at));
check('one-undo', app.history.undoStack.length === undoBefore + 1);
check('pad-net', Object.keys(b.annotation.nets).includes('+5V') && b.annotation.nets['+5V'].includes(`${ids.r1}:1`), b.annotation.nets);
check('status', /2 footprints/.test(ws.statusText.textContent), ws.statusText.textContent);
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F8', bubbles: true }));
dlg = document.querySelector('.annotate-modal');
check('up-to-date', /up to date/.test(dlg.textContent) && [...dlg.querySelectorAll('button')].find((x) => x.textContent === 'Apply').disabled);
dlg.querySelector('.modal-actions button').click();
// a Value and a Net change; a track on the old net follows the rename
const oldNet = Object.keys(b.annotation.nets).find((n) => n.startsWith('Net-'));
app.edit('track', (pr) => { pr.board.tracks.push({ id: 'tk1', a: [0, 0], b: [1e6, 0], width: 250000, layer: 'F.Cu', net: oldNet }); });
app.edit('edits', (pr) => {
  pr.components[ids.r2].value = '4k7';
  const s = pr.schematic.sheets[0];
  const y = s.symbols.find((q) => q.componentId === ids.r1);
  L.schematic.addLabel(pr, s, { at: L.project.pinPositions(pr, y).find((x) => x.pin.number === '2').at, net: 'MID', style: 'label', scope: 'local' });
});
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F8', bubbles: true }));
dlg = document.querySelector('.annotate-modal');
const rows2 = [...dlg.querySelectorAll('.annotate-row')].map((r) => r.textContent);
check('value-row', rows2.some((t) => /ValueR2: 10k → 4k7/.test(t)), rows2);
check('rename-row', rows2.some((t) => t.includes(`${oldNet} → MID`)), rows2);
[...dlg.querySelectorAll('button')].find((x) => x.textContent === 'Apply').click();
check('copper-renamed', app.project.board.tracks[0].net === 'MID');
check('value-on-board', app.project.board.annotation.components[ids.r2].value === '4k7');
await app.saveNow();
return { fails };
