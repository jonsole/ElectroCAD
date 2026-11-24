// Footprint editor journey (#19): switch the Library tab to Footprint; draw a footprint by hand
// (two pads, one turned through-hole; a courtyard); the problems update; save it; the Generator
// makes a 2x3 pin header with a live preview; save that too; in the Symbol editor a new Part gets
// the hand-made footprint as Preferred, with a Pin map swapping its pads; it survives a restart.
const app = window.electrocad;
const fails = [];
const check = (name, cond, info) => { if (!cond) fails.push(name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); };
const MM = 1e6;
app.setWorkspace('library');
await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); // the canvas is sized
const ws = app.workspace('library');
document.querySelector('[data-ws="library"] .segmented button[data-id="footprint"]').click();
const fe = app.fpEditor;
check('mode', app.libMode === 'footprint' && ws.editor === fe);
const key = (k, more = {}) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...more }));
const click = (x, y) => {
  const r = ws.view.canvas.getBoundingClientRect(); const [sx, sy] = ws.view.view.toScreen([x * MM, y * MM]);
  const o = { clientX: r.left + sx, clientY: r.top + sy, button: 0, buttons: 1, bubbles: true, cancelable: true, pointerId: 31, detail: 1 };
  ws.view.canvas.dispatchEvent(new PointerEvent('pointermove', { ...o, buttons: 0 }));
  ws.view.canvas.dispatchEvent(new PointerEvent('pointerdown', o)); ws.view.canvas.dispatchEvent(new PointerEvent('pointerup', { ...o, buttons: 0 }));
};
await fe.createFootprint();
ws.view.view.fit({ x0: -5 * MM, y0: -4 * MM, x1: 5 * MM, y1: 4 * MM }, ws.view.w, ws.view.h, 10);
check('pad-tool', fe.tool === 'pad');
click(-1.5, 0); click(1.5, 0);
check('two-pads', fe.draft.pads.map((p) => `${p.number}@${p.at[0] / MM}`).join() === '1@-1.5,2@1.5', fe.draft.pads.map((p) => [p.number, p.at]));
// make pad 2 through-hole from Properties
key('Escape'); click(1.5, 0);
const type = fe.propsEl.querySelector('select[aria-label="Type"]');
type.value = 'tht'; type.dispatchEvent(new Event('change'));
check('tht', fe.draft.pads[1].layers.includes('*.Cu') && fe.draft.pads[1].drill > 0);
check('warn-courtyard', /no courtyard/.test(fe.fpEl.textContent));
// a courtyard rectangle on F.CrtYd
fe.activeLayer = 'F.CrtYd'; key('b'); click(-3, -1.5); click(3, 1.5);
check('courtyard', fe.draft.graphics.some((g) => g.layer === 'F.CrtYd' && g.type === 'rect') && !/no courtyard/.test(fe.fpEl.textContent), [fe.tool, fe.activeLayer, fe.draft.graphics, fe.drawing]);
const name = fe.fpEl.querySelector('input[aria-label="Footprint name"]');
name.value = 'Smoke_2pad'; name.dispatchEvent(new Event('change'));
check('saved', await fe.save());
const lib = app.libraries.find((l) => Object.values(l.footprints).some((f) => f.name === 'Smoke_2pad'));
check('in-library', !!lib);
// the Generator: a 2x3 header
const m = fe.generator();
const pk = document.querySelector('.gen-modal select[aria-label="Package"]'); pk.value = 'header'; pk.dispatchEvent(new Event('change'));
const rows = document.querySelector('.gen-modal select[aria-label="Rows"]'); rows.value = '2'; rows.dispatchEvent(new Event('change'));
const n = document.querySelector('.gen-modal input[aria-label="Pins per row"]'); n.value = '3'; n.dispatchEvent(new Event('input'));
check('preview', /PinHeader_2x03/.test(document.querySelector('.gen-modal .gen-name').textContent) && !!document.querySelector('.gen-modal canvas'));
[...document.querySelectorAll('.gen-modal button')].find((b) => b.textContent === 'Create').click();
await new Promise((r) => setTimeout(r, 50));
check('generated', fe.draft?.pads.length === 6 && fe.draft.pads.every((p) => p.drill > 0), fe.draft?.pads.length);
void m;
check('saved-2', await fe.save());
// Symbol editor: a Part with two Pins gets Smoke_2pad as Preferred, with pins swapped
document.querySelector('[data-ws="library"] .segmented button[data-id="symbol"]').click();
const se = app.libEditor;
check('symbol-mode', app.libMode === 'symbol' && ws.editor === se);
await se.createPart();
ws.view.view.fit({ x0: -20 * 1270000, y0: -15 * 1270000, x1: 20 * 1270000, y1: 15 * 1270000 }, ws.view.w, ws.view.h, 10);
const G = 1270000;
const clickG = (x, y) => {
  const r = ws.view.canvas.getBoundingClientRect(); const [sx, sy] = ws.view.view.toScreen([x * G, y * G]);
  const o = { clientX: r.left + sx, clientY: r.top + sy, button: 0, buttons: 1, bubbles: true, cancelable: true, pointerId: 32, detail: 1 };
  ws.view.canvas.dispatchEvent(new PointerEvent('pointermove', { ...o, buttons: 0 }));
  ws.view.canvas.dispatchEvent(new PointerEvent('pointerdown', o)); ws.view.canvas.dispatchEvent(new PointerEvent('pointerup', { ...o, buttons: 0 }));
};
clickG(-6, 0); clickG(6, 0);
se.addFootprintMenu(document.body);
const item = [...document.querySelectorAll('.fp-search-pop .menu-item')].find((b) => /Smoke_2pad/.test(b.textContent));
check('menu-has-user-fp', !!item && /My parts|Smoke/.test(item.textContent));
item?.click();
const fpId = Object.keys(se.draft.footprints)[0];
se.pinMapDialog(fpId);
const sel1 = document.querySelector('.modal select[aria-label="Pad for pin 1"]'); sel1.value = '2'; sel1.dispatchEvent(new Event('change'));
const sel2 = document.querySelector('.modal select[aria-label="Pad for pin 2"]'); sel2.value = '1'; sel2.dispatchEvent(new Event('change'));
[...document.querySelectorAll('.modal button')].find((b) => b.textContent === 'Apply').click();
check('pinmap', JSON.stringify(se.draft.pinMap[fpId]) === '{"1":"2","2":"1"}', se.draft.pinMap);
localStorage.setItem('smoke.fp', lib.id);
return { fails };
