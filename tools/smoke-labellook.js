// Label look journey (#81): a label's look (text on the wire or a flag) is separate from what it
// joins. The Net label tool's strip places a flag; the inspector turns a Global label into text and
// sets its size; scope still joins across sheets; undo puts the look back.
const app = window.electrocad;
const fails = [];
const check = (name, cond, info) => { if (!cond) fails.push(name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ed = app.workspace('schematic').editor;
const ws = app.workspace('schematic');
const G = 1270000;
const key = (k, more = {}) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...more }));
const click = (at) => {
  const r = ws.view.canvas.getBoundingClientRect();
  const [x, y] = ws.view.view.toScreen(at);
  const o = { clientX: r.left + x, clientY: r.top + y, button: 0, buttons: 1, bubbles: true, cancelable: true, pointerId: 1 };
  ws.view.canvas.dispatchEvent(new PointerEvent('pointerdown', o));
  ws.view.canvas.dispatchEvent(new PointerEvent('pointerup', { ...o, buttons: 0 }));
};
const name = (n) => { const box = document.querySelector('.field-edit.label-edit'); box.value = n; box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); };
ws.view.view.fit({ x0: 30 * G, y0: 30 * G, x1: 80 * G, y1: 60 * G }, ws.view.w, ws.view.h, 20);
// L, then Look: Flag in the strip
key('l');
const seg = [...document.querySelectorAll('[data-ws="schematic"] .strip-seg button')];
check('look-choice', seg.map((b) => b.textContent).join() === 'Text,Flag', seg.map((b) => b.textContent));
seg.find((b) => b.textContent === 'Flag')?.click();
click([40 * G, 40 * G]); name('LOCALFLAG');
const lf = ed.sheet.labels.find((l) => l.net === 'LOCALFLAG');
check('local-flag', lf && lf.scope === 'local' && lf.shape === 'flag', lf);
// Ctrl+L: a Global label, a flag by default
key('Escape'); key('l', { ctrlKey: true });
click([40 * G, 50 * G]); name('SDA');
const g = ed.sheet.labels.find((l) => l.net === 'SDA');
check('global-flag', g && g.scope === 'global' && !g.shape, g);
// the inspector: Look -> text, size 1.778
key('Escape'); key('Escape');
ed.selection = new Set([g.id]); ed.refresh(); ed.openProperties?.(); ed.refresh();
await wait(50);
const look = document.querySelector('select[aria-label="Label look"]');
check('inspector-look', look?.value === 'flag', look?.value);
look.value = 'text'; look.dispatchEvent(new Event('change'));
check('now-text', ed.sheet.labels.find((l) => l.id === g.id).shape === 'text');
const size = document.querySelector('input[aria-label="Label text size"]');
size.value = '1.778'; size.dispatchEvent(new Event('change'));
check('size', ed.sheet.labels.find((l) => l.id === g.id).size === 1778000);
// still global: joins a label of the same name on another sheet
check('still-global', ed.sheet.labels.find((l) => l.id === g.id).scope === 'global');
app.undo(); app.undo();
check('undo', !ed.sheet.labels.find((l) => l.id === g.id).shape && !ed.sheet.labels.find((l) => l.id === g.id).size);
return { fails };
