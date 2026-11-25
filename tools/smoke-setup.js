// Board setup journey (#24): the toolbar opens Board setup; picking OSH Park and Apply preset fills
// the Design rules (one undo step); a rule stays editable and shows as edited; a Power net class is
// added, VCC assigned to it, and a track routed from a VCC pad takes the class's width; the Gerber
// tab shows the preset.
const app = window.electrocad;
const fails = [];
const check = (name, cond, info) => { if (!cond) fails.push(name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); };
const L = window.electrocadLib, G = 1270000, MM = 1e6;
const part = (n) => app.workspace('schematic').editor.parts.find((x) => x.name === n);
app.edit('demo', (pr) => {
  const s = pr.schematic.sheets[0];
  const rs = [0, 1].map((i) => L.project.addComponent(pr, s, part('Resistor'), [G * (20 + i * 20), G * 20]).comp);
  const pin = (c, n) => { const y = s.symbols.find((q) => q.componentId === c.id); return L.project.pinPositions(pr, y).find((x) => x.pin.number === n).at; };
  L.schematic.addLabel(pr, s, { at: pin(rs[0], '2'), net: 'VCC', style: 'label', scope: 'local' });
  L.schematic.addLabel(pr, s, { at: pin(rs[1], '1'), net: 'VCC', style: 'label', scope: 'local' });
  pr.board.outline = [{ type: 'rect', a: [0, 0], b: [30e6, 20e6], layer: 'Edge.Cuts' }];
});
app.setWorkspace('board');
await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
const ws = app.workspace('board'), ed = ws.editor;
ed.annotate();
[...document.querySelectorAll('.annotate-modal button')].find((b) => b.textContent === 'Apply').click();
app.edit('place', (pr) => { const f = (ref) => pr.board.footprints.find((x) => pr.components[x.componentId].ref === ref); f('R1').at = [5 * MM, 5 * MM]; f('R2').at = [20 * MM, 5 * MM]; });
const b = () => app.project.board;
check('generic', b().preset === 'generic-2');
[...document.querySelectorAll('[data-ws="board"] .toolbar button')].find((x) => x.textContent.includes('Board setup')).click();
const dlg = document.querySelector('.board-setup');
check('open', !!dlg);
const fab = dlg.querySelector('select[aria-label="Fab"]'); fab.value = 'OSH Park'; fab.dispatchEvent(new Event('change'));
const undo0 = app.history.undoStack.length;
[...dlg.querySelectorAll('button')].find((x) => x.textContent === 'Apply preset').click();
check('applied', b().preset === 'oshpark-2' && b().rules.clearance === 152400 && b().rules.edgeClearance === 381000 && app.history.undoStack.length === undo0 + 1, b().rules);
const tw = dlg.querySelector('input[aria-label="Track width"]'); tw.value = '0.2'; tw.dispatchEvent(new Event('change'));
check('edited', b().rules.trackWidth === 200000 && /edited: track width/.test(dlg.textContent));
// net classes
[...dlg.querySelectorAll('.setup-tabs button')].find((x) => x.dataset.tab === 'classes').click();
[...dlg.querySelectorAll('button')].find((x) => x.textContent.includes('Add net class')).click();
check('class-added', !!b().netClasses.Power);
const w = dlg.querySelector('input[aria-label="Power Track width"]'); w.value = '0.6'; w.dispatchEvent(new Event('change'));
const sel = dlg.querySelector('select[aria-label="Class of VCC"]'); sel.value = 'Power'; sel.dispatchEvent(new Event('change'));
check('assigned', b().netClasses.Power.trackWidth === 600000 && b().netClasses.Power.nets.includes('VCC'), b().netClasses);
[...dlg.querySelectorAll('button')].find((x) => x.textContent === 'Close').click();
// route from R1's VCC pad: the class's width
ws.view.view.fit({ x0: 0, y0: 0, x1: 28 * MM, y1: 18 * MM }, ws.view.w, ws.view.h, 30);
const pt = (x, y) => { const r = ws.view.canvas.getBoundingClientRect(); const [sx, sy] = ws.view.view.toScreen([x * MM, y * MM]); return { clientX: r.left + sx, clientY: r.top + sy }; };
const pad = app.project.board.footprints.find((f) => app.project.components[f.componentId].ref === 'R1');
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }));
const at = [pad.at[0] / MM + 0.9125, pad.at[1] / MM];
ws.view.canvas.dispatchEvent(new PointerEvent('pointermove', { ...pt(...at), bubbles: true, pointerId: 44 }));
ws.view.canvas.dispatchEvent(new PointerEvent('pointerdown', { ...pt(...at), button: 0, buttons: 1, bubbles: true, cancelable: true, pointerId: 44, detail: 1 }));
check('route-width', ed.route?.width === 600000 && ed.route.net === 'VCC', ed.route && [ed.route.net, ed.route.width]);
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
// the Gerber tab shows the preset
app.setWorkspace('gerber');
await new Promise((r) => requestAnimationFrame(r));
check('gerber-preset', /OSH Park 2-layer \(edited\)/.test(document.querySelector('[data-ws="gerber"] .gerber-preset').textContent), document.querySelector('[data-ws="gerber"] .gerber-preset')?.textContent);
return { fails };
