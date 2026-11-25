// Pin marks and overbars (#63): in the Symbol editor, a Pin's name takes ~{…} markup, its Mark
// (inverted, clock) and what it Shows are set from Properties; placed, the Schematic and the
// print draw the overbar and the marks, with the markup itself never shown.
const app = window.electrocad;
const fails = [];
const check = (name, cond, info) => { if (!cond) fails.push(name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const G = 1270000;
app.setWorkspace('library');
const ws = app.workspace('library'), ed = ws.editor;
const key = (k, more = {}) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...more }));
const click = (x, y) => {
  const r = ws.view.canvas.getBoundingClientRect(); const [sx, sy] = ws.view.view.toScreen([x * G, y * G]);
  const o = { clientX: r.left + sx, clientY: r.top + sy, button: 0, buttons: 1, bubbles: true, cancelable: true, pointerId: 9, detail: 1 };
  ws.view.canvas.dispatchEvent(new PointerEvent('pointermove', { ...o, buttons: 0 }));
  ws.view.canvas.dispatchEvent(new PointerEvent('pointerdown', o)); ws.view.canvas.dispatchEvent(new PointerEvent('pointerup', { ...o, buttons: 0 }));
};
await ed.createPart();
click(-6, -2); click(-6, 2); click(6, 0);
key('b'); click(-2, -3); click(2, 3);
ed.setTool('select');
const props = () => document.querySelector('.lib-props');
const set = (label, v) => { const el = props().querySelector(`[aria-label="${label}"]`); el.value = v; el.dispatchEvent(new Event('change')); };
// pin 1: an active-low reset, inverted, its name only
ed.selection = new Set(['pin:0']); ed.refresh(); ed.openProperties(); await wait(50);
set('Name', '~{RST}'); await wait(20);
set('Mark', 'inverted'); await wait(20);
set('Shows', 'name'); await wait(20);
let p = ed.draft.units[0].pins[0];
check('pin1', p.name === '~{RST}' && p.shape === 'inverted' && p.showNumber === false && p.showName === undefined, p);
// pin 2: a clock
ed.selection = new Set(['pin:1']); ed.refresh(); ed.openProperties(); await wait(50);
set('Name', 'CLK'); await wait(20); set('Mark', 'clock'); await wait(20);
check('pin2', ed.draft.units[0].pins[1].shape === 'clock');
// both: neither shown, then back; the mark cleared back to none
ed.selection = new Set(['pin:0', 'pin:1']); ed.refresh(); ed.openProperties(); await wait(50);
set('Shows', 'none'); await wait(20);
check('multi-none', ed.draft.units[0].pins.slice(0, 2).every((q) => q.showName === false && q.showNumber === false));
set('Shows', 'both'); await wait(20);
check('multi-both', ed.draft.units[0].pins.slice(0, 2).every((q) => q.showName === undefined && q.showNumber === undefined));
ed.selection = new Set(['pin:2']); ed.refresh(); ed.openProperties(); await wait(50);
set('Name', 'Q'); set('Mark', 'inverted-clock'); await wait(20); set('Mark', 'line'); await wait(20);
check('mark-cleared', !('shape' in ed.draft.units[0].pins[2]));
ed.selection = new Set(['pin:0']); ed.refresh(); ed.openProperties(); await wait(50); set('Shows', 'name'); await wait(20);
const name = document.querySelector('.lib-part input[aria-label="Name"]');
name.value = 'Marks'; name.dispatchEvent(new Event('change'));
check('saved', (await ed.save()) === true);
// place it and draw it
const part = Object.values(app.libraries[0].parts)[0];
app.edit('place', (pr) => { const L = window.electrocadLib; L.project.addComponent(pr, pr.schematic.sheets[0], part.part || part, [40 * G, 40 * G]); });
app.setWorkspace('schematic');
const sws = app.workspace('schematic');
sws.view.view.fit({ x0: 30 * G, y0: 34 * G, x1: 50 * G, y1: 46 * G }, sws.view.w, sws.view.h, 10);
sws.view.draw();
await wait(100);
// the print: the name without its markup
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true }));
await wait(200);
const modal = () => document.querySelector('.print-modal') || document.querySelector('.modal');
const textSel = modal().querySelector('select[aria-label="Text"]');
textSel.value = 'sans'; textSel.dispatchEvent(new Event('change'));
await wait(150);
const svg = decodeURIComponent(modal().querySelector('.print-preview').src);
check('print-name', svg.includes('>RST<') && !svg.includes('~{'), svg.length);
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
await wait(100);
return { fails };
