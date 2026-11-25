// Board-only Footprints (#74): place a plated M3 mounting hole with the Place footprint tool (no
// Schematic part), put its pad on GND in Properties, rename it; Update from Schematic leaves it
// alone; a GND zone connects to it; delete and undo.
const app = window.electrocad;
const fails = [];
const check = (name, cond, info) => { if (!cond) fails.push(name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const L = window.electrocadLib, G = 1270000, MM = 1e6;
const part = (n) => app.workspace('schematic').editor.parts.find((x) => x.name === n);
app.edit('demo', (pr) => {
  const s = pr.schematic.sheets[0];
  const r1 = L.project.addComponent(pr, s, part('Resistor'), [G * 20, G * 20]).comp;
  const pin = L.project.pinPositions(pr, s.symbols.find((q) => q.componentId === r1.id)).find((x) => x.pin.number === '1').at;
  L.schematic.addWire(pr, s, [pin, [pin[0] - 4 * G, pin[1]]]);
  L.schematic.addLabel(pr, s, { at: [pin[0] - 4 * G, pin[1]], net: 'GND', style: 'gnd' });
  pr.board.outline = [{ type: 'rect', a: [0, 0], b: [30e6, 20e6], layer: 'Edge.Cuts' }];
});
app.setWorkspace('board');
await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
const ws = app.workspace('board'), ed = ws.editor;
ed.annotate();
[...document.querySelectorAll('.annotate-modal button')].find((b) => b.textContent === 'Apply').click();
app.edit('place', (pr) => { pr.board.footprints[0].at = [8 * MM, 10 * MM]; });
ws.view.view.fit({ x0: 0, y0: 0, x1: 30 * MM, y1: 20 * MM }, ws.view.w, ws.view.h, 30);
const pt = (x, y) => { const r = ws.view.canvas.getBoundingClientRect(); const [sx, sy] = ws.view.view.toScreen([x * MM, y * MM]); return { clientX: r.left + sx, clientY: r.top + sy }; };
const click = (x, y) => { const o = { ...pt(x, y), button: 0, buttons: 1, bubbles: true, cancelable: true, pointerId: 52, detail: 1 }; ws.view.canvas.dispatchEvent(new PointerEvent('pointermove', { ...o, buttons: 0 })); ws.view.canvas.dispatchEvent(new PointerEvent('pointerdown', o)); ws.view.canvas.dispatchEvent(new PointerEvent('pointerup', { ...o, buttons: 0 })); };
// the tool opens the picker; search and choose
document.querySelector('[data-ws="board"] button[title^="Place footprint"]').click();
await wait(100);
const search = document.querySelector('.board-fp-pick input[type="search"]');
check('picker', !!search);
search.value = 'M3_Pad'; search.dispatchEvent(new Event('input'));
const item = [...document.querySelectorAll('.board-fp-pick .menu-item')].find((b) => /MountingHole_3.2mm_M3_Pad/.test(b.textContent));
check('found', !!item);
item.click();
await wait(50);
click(22, 10);
await wait(100);
const hole = () => app.project.board.footprints.find((f) => !f.componentId);
check('placed', hole() && hole().ref === 'H1' && hole().at[0] === 22 * MM, hole());
check('selected', ed.fpSel.has(hole().id) && ed.tool === 'select');
// Properties: its pad on GND, a new Reference, In BOM stays off
const props = () => document.querySelector('[data-ws="board"] .board-props');
const padNet = props().querySelector('input[aria-label="Pad 1 net"]');
check('props', !!padNet && /On the Board only/.test(props().textContent), props()?.textContent?.slice(0, 120));
padNet.value = 'GND'; padNet.dispatchEvent(new Event('change'));
await wait(50);
check('pad-net', hole().padNets?.['1'] === 'GND', hole());
const ref = props().querySelector('input[aria-label="Reference"]');
ref.value = 'MH1'; ref.dispatchEvent(new Event('change'));
await wait(50);
check('ref', hole().ref === 'MH1');
check('bom-off', !hole().bom && props().querySelector('input[aria-label="In BOM"]')?.checked === false);
// Update from Schematic has nothing to do with it
ed.annotate(); await wait(50);
const modal = document.querySelector('.annotate-modal');
check('annotate-ignores', !modal || !/MH1/.test(modal.textContent), modal?.textContent?.slice(0, 200));
[...document.querySelectorAll('.annotate-modal button')].find((b) => /Apply|Close|Cancel/.test(b.textContent))?.click();
check('still-there', !!hole());
// a GND zone over the board connects to it
app.edit('zone', (pr) => { pr.board.zones.push({ id: 'zg', layer: 'F.Cu', net: 'GND', outline: [[0, 0], [30 * MM, 0], [30 * MM, 20 * MM], [0, 20 * MM]], priority: 0, clearance: 0, connect: 'thermal', thermal: { gap: 500000, spoke: 500000 } }); });
await ed.whenZonesFilled();
const f = ed.zoneFiller.fills.get('zg');
check('zone-joins', f?.thermals.some((t) => t.key === `${hole().id}:1` && t.spokes >= 2), f?.thermals);
// delete it, undo
ed.fpSel = new Set([hole().id]); ed.deleteSelection();
check('deleted', !hole());
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
await wait(50);
check('undo', !!hole() && hole().ref === 'MH1');
ws.view.view.fit({ x0: 0, y0: 0, x1: 30 * MM, y1: 20 * MM }, ws.view.w, ws.view.h, 30);
ed.fpSel = new Set([hole().id]); ed.openProperties?.(); ed.refresh();
await wait(100);
return { fails };
