// ERC journey (#11): the No-connect tool (Q) marks and unmarks a Pin; the ERC card is live, lists
// problems errors first, jumps to another Sheet, and applies a fix as one undo step.
const app = window.electrocad;
const fails = [];
const check = (name, cond, info) => { if (!cond) fails.push(name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); };
const { project: P, schematic: S } = window.electrocadLib;
const ed = app.workspace('schematic').editor;
const ws = app.workspace('schematic');
const G = 1270000;
const R = ed.parts.find((x) => x.name === 'Resistor');
const put = (x, y) => { ed.beginPlace(R); ed.placing.at = [x * G, y * G]; const r = ed.commitPlace(); ed.endPlace(); return r.sym; };
const pin = (s, n) => P.pinPositions(app.project, s).find((x) => x.pin.number === n).at;
const key = (k, more = {}) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...more }));
ws.view.view.fit({ x0: 20 * G, y0: 20 * G, x1: 80 * G, y1: 60 * G }, ws.view.w, ws.view.h, 20);
const click = (at) => {
  const r = ws.view.canvas.getBoundingClientRect(); const [x, y] = ws.view.view.toScreen(at);
  const o = { clientX: r.left + x, clientY: r.top + y, button: 0, buttons: 1, bubbles: true, cancelable: true, pointerId: 5 };
  ws.view.canvas.dispatchEvent(new PointerEvent('pointerdown', o)); ws.view.canvas.dispatchEvent(new PointerEvent('pointerup', { ...o, buttons: 0 }));
};
const r1 = put(40, 40);
document.querySelector('button[title^="Electrical rule check"]').click();
const card = () => document.querySelector('.erc-panel');
// problems listed (Info rows, e.g. pins marked no-connect, aren't problems)
const rows = () => [...card().querySelectorAll('.erc-row:not(.erc-info)')].map((x) => x.dataset.rule);
const infos = () => card().querySelectorAll('.erc-row.erc-info').length;
check('card-open', card().style.display !== 'none' && rows().join() === 'unconnected-pin,unconnected-pin', rows());
check('count', /2 errors/.test(card().querySelector('.fp-count').textContent));
// Q, click both Pin tips: no problems left
key('q');
check('tool', ed.tool === 'noConnect');
click(pin(r1, '1')); click(pin(r1, '2'));
check('marked', app.project.schematic.sheets[0].noConnects.length === 2 && rows().length === 0 && infos() === 2, rows());
check('clean-note', /No problems/.test(card().querySelector('.fp-count').textContent));
click(pin(r1, '2')); // again: unmarked
check('unmarked', app.project.schematic.sheets[0].noConnects.length === 1 && rows().join() === 'unconnected-pin');
key('Escape');
// a marker moves with its part
ed.selection = new Set([r1.id]); ed.nudge(2, 0);
const moved = app.project.schematic.sheets[0].symbols[0];
check('marker-follows', P.pinPositions(app.project, moved).some((x) => x.at[0] === app.project.schematic.sheets[0].noConnects[0].at[0] && x.at[1] === app.project.schematic.sheets[0].noConnects[0].at[1]));
// a problem on another Sheet: clicking it switches there
ed.addSheet();
const r2 = put(40, 40);
app.edit('labels', (p) => { const s2 = p.schematic.sheets[1]; S.addLabel(p, s2, { at: pin(r2, '1'), net: 'VCC', style: 'power' }); S.addLabel(p, s2, { at: pin(r2, '2'), net: 'vcc', style: 'power' }); });
ed.switchSheet(app.project.schematic.sheets[0].id);
const mixed = [...card().querySelectorAll('.erc-row')].find((x) => x.dataset.rule === 'mixed-spelling');
check('mixed-listed', !!mixed && /Sheet 2/.test(mixed.textContent), rows());
mixed?.click();
check('jumped', ed.sheet.id === app.project.schematic.sheets[1].id && card().querySelector('.erc-row.on')?.dataset.rule === 'mixed-spelling');
const depth = app.history.undoStack.length;
card().querySelector('.erc-row[data-rule="mixed-spelling"] .erc-fix').click();
check('fixed', app.project.schematic.sheets[1].labels.every((l) => l.net === 'VCC') && app.history.undoStack.length === depth + 1 && !rows().includes('mixed-spelling'));
key('z', { ctrlKey: true });
check('fix-undone', rows().includes('mixed-spelling'));
// the filter: severity chips and a part/net search
const chip = (sev) => card().querySelector(`.erc-chip[data-severity="${sev}"]`);
check('chip-counts', chip('error').querySelector('.erc-n').textContent === '1' && chip('warning').querySelector('.erc-n').textContent === '1' && chip('info').querySelector('.erc-n').textContent === '1',
  ['error', 'warning', 'info'].map((x) => chip(x).querySelector('.erc-n').textContent));
chip('error').click();
check('errors-hidden', !rows().includes('unconnected-pin') && rows().includes('mixed-spelling') && chip('error').getAttribute('aria-pressed') === 'false');
chip('error').click();
const search = card().querySelector('.erc-search');
search.value = 'vc'; search.dispatchEvent(new Event('input'));
check('search-net', rows().join() === 'mixed-spelling' && infos() === 0, rows());
search.value = 'R1'; search.dispatchEvent(new Event('input'));
check('search-part', rows().join() === 'unconnected-pin' && infos() === 1, rows());
check('search-keeps-focus-element', card().querySelector('.erc-search') === search);
search.value = 'zzz'; search.dispatchEvent(new Event('input'));
check('no-match', /Nothing for "zzz"/.test(card().textContent));
search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
check('esc-clears', search.value === '' && rows().length === 2);
document.querySelector('button[title^="Electrical rule check"]').click();
check('closed', card().style.display === 'none');
return { fails };
