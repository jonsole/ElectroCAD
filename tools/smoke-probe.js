// Cross-probing journey (#18): split view shows both editors; selecting a Symbol highlights its
// Footprint (and scrolls to it); selecting a Footprint highlights its Symbol; double-clicking a
// Wire selects its whole Net, whose Pads light up; double-clicking a pad selects its Net, whose
// Wires light up on the Schematic; clearing the selection clears the highlight.
const app = window.electrocad;
const fails = [];
const check = (name, cond, info) => { if (!cond) fails.push(name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); };
const L = window.electrocadLib, G = 1270000;
const part = (n) => app.workspace('schematic').editor.parts.find((x) => x.name === n);
let ids;
app.setWorkspace('schematic');
app.edit('demo', (pr) => {
  const s = pr.schematic.sheets[0];
  const r1 = L.project.addComponent(pr, s, part('Resistor'), [G * 20, G * 20]).comp;
  const r2 = L.project.addComponent(pr, s, part('Resistor'), [G * 40, G * 20]).comp;
  const pin = (c, n) => { const y = s.symbols.find((q) => q.componentId === c.id); return L.project.pinPositions(pr, y).find((x) => x.pin.number === n).at; };
  L.schematic.addWire(pr, s, [pin(r1, '2'), [pin(r1, '2')[0] + 4 * G, pin(r1, '2')[1]]]);
  L.schematic.addWire(pr, s, [[pin(r1, '2')[0] + 4 * G, pin(r1, '2')[1]], pin(r2, '1')]);
  pr.board.outline = [{ type: 'rect', a: [0, 0], b: [30e6, 20e6], layer: 'Edge.Cuts' }];
  ids = { r1: r1.id, r2: r2.id };
});
const sed = app.workspace('schematic').editor, bed = app.workspace('board').editor;
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F8', bubbles: true }));
[...document.querySelectorAll('.annotate-modal button')].find((b) => b.textContent === 'Apply').click();
app.toggleSplit(true);
await new Promise((r) => requestAnimationFrame(r));
const sws = app.workspace('schematic'), bws = app.workspace('board');
check('split', sws.el.classList.contains('active') && bws.el.classList.contains('active') && sws.el.classList.contains('focused'));
const sheet = () => app.project.schematic.sheets[0];
// Symbol -> Footprint, and the Board scrolls to it
bws.view.view.fit({ x0: -200e6, y0: -200e6, x1: -150e6, y1: -150e6 }, bws.view.w, bws.view.h, 10); // look somewhere else
sed.selection = new Set([sheet().symbols.find((y) => y.componentId === ids.r1).id]); sed.refresh();
check('probe-comp', app.probe?.source === 'schematic' && app.probe.probe.components.has(ids.r1));
const fp1 = app.project.board.footprints.find((f) => f.componentId === ids.r1);
const [fx, fy] = bws.view.view.toScreen(fp1.at);
check('board-scrolled', fx > 0 && fx < bws.view.w && fy > 0 && fy < bws.view.h, [fx, fy, bws.view.w, bws.view.h]);
// double-click a Wire: its whole Net (both segments) is selected; its Pads are the probe
const [wx, wy] = sws.view.view.toScreen([(sheet().wires[0].a[0] + sheet().wires[0].b[0]) / 2, sheet().wires[0].a[1]]);
const r = sws.view.canvas.getBoundingClientRect();
sed.inspector.el.style.display = 'none'; // keep the card from covering the wire in this narrow pane
sws.view.canvas.dispatchEvent(new MouseEvent('dblclick', { clientX: r.left + wx, clientY: r.top + wy, bubbles: true, cancelable: true }));
sed.inspector.el.style.display = '';
check('net-selected', sed.selection.size === 2 && sheet().wires.every((w) => sed.selection.has(w.id)), [...sed.selection]);
check('probe-net', app.probe.probe.nets.size === 1, app.probe && [...app.probe.probe.nets]);
// Footprint -> Symbol: make the Board the active pane and select R2's Footprint
app.setWorkspace('board');
check('focus-board', bws.el.classList.contains('focused') && sws.el.classList.contains('active'));
bed.fpSel = new Set([app.project.board.footprints.find((f) => f.componentId === ids.r2).id]); bed.refresh();
check('probe-back', app.probe.source === 'board' && app.probe.probe.components.has(ids.r2));
check('schematic-targets', sed._probeTargets(app.project)?.has(sheet().symbols.find((y) => y.componentId === ids.r2).id));
// right-click a pad → Select net: its Net, whose Wires light on the Schematic
const nets = Object.entries(app.project.board.annotation.nets).find(([, ps]) => ps.includes(`${ids.r1}:2`));
const br = bws.view.canvas.getBoundingClientRect();
for (const q of bed._padPoints()) {
  const [px, py] = bws.view.view.toScreen(q);
  bed.contextMenu({ clientX: br.left + px, clientY: br.top + py });
  const item = [...document.querySelectorAll('.menu .menu-item')].find((m) => m.textContent.toLowerCase().includes(`select net ${nets[0].toLowerCase()}`));
  if (item) { item.click(); break; }
  document.querySelectorAll('.menu').forEach((m) => m.remove());
}
check('pad-select-net', [...bed.netSel][0]?.toLowerCase() === nets[0].toLowerCase(), [...bed.netSel]);
const lit = sed._probeTargets(app.project);
check('pad-net-wires', lit && sheet().wires.every((w) => lit.has(w.id)), lit && [...lit]);
// clearing the selection clears the highlight
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
check('cleared', !app.probeFor('schematic'));
app.toggleSplit(false);
check('unsplit', !bws.el.classList.contains('active') || !sws.el.classList.contains('active'));
return { fails };
