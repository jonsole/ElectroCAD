// Gerber viewer journey (#28): a routed Board → Generate → the canvas shows the files read back,
// layer by layer → toggle a layer, Bottom view, Measure → save the zip, open it again as fab files
// (a deflate-free zip through the native dialog) → Compare with… the same zip: every layer matches.
const app = window.electrocad;
const fails = [];
const check = (name, cond, info) => { if (!cond) fails.push(name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); };
const L = window.electrocadLib, G = 1270000, MM = 1e6;
const native = window.electroNative;
const part = (n) => app.workspace('schematic').editor.parts.find((x) => x.name === n);
const raf = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
app.edit('demo', (pr) => {
  pr.name = 'Gerber Smoke';
  const s = pr.schematic.sheets[0];
  const r1 = L.project.addComponent(pr, s, part('Resistor'), [G * 20, G * 20]).comp;
  const r2 = L.project.addComponent(pr, s, part('Resistor'), [G * 40, G * 20]).comp;
  const pin = (c, n) => { const y = s.symbols.find((q) => q.componentId === c.id); return L.project.pinPositions(pr, y).find((x) => x.pin.number === n).at; };
  L.schematic.addWire(pr, s, [pin(r1, '2'), pin(r2, '1')]);
  pr.board.outline = [{ type: 'rect', a: [0, 0], b: [30e6, 20e6], layer: 'Edge.Cuts' }];
});
app.setWorkspace('board'); await raf();
const ed = app.workspace('board').editor;
ed.annotate();
[...document.querySelectorAll('.annotate-modal button')].find((b) => b.textContent === 'Apply').click();
app.edit('place', (pr) => { const f = (ref) => pr.board.footprints.find((x) => pr.components[x.componentId].ref === ref); f('R1').at = [8 * MM, 8 * MM]; f('R2').at = [20 * MM, 8 * MM]; });
app.edit('via', (pr) => pr.board.vias.push({ id: 'vs', at: [14 * MM, 14 * MM], drill: 400000, diameter: 800000, from: 'F.Cu', to: 'B.Cu', net: '' }));
app.setWorkspace('gerber'); await raf();
const gws = document.querySelector('.ws-root[data-ws="gerber"]');
const panel = app.gerberPanel, viewer = panel.viewer;
const btn = (t) => [...gws.querySelectorAll('.toolbar button')].find((b) => b.title.startsWith(t) || b.textContent.trim().startsWith(t));
check('buttons', btn('Make the fab files') && btn('View a fab zip') && btn('Compare the generated'));
await panel.generate();
await raf();
check('shown', viewer.layers.length === 11 && panel.source === 'generated', viewer.layers.map((l) => l.layer));
check('layer-rows', gws.querySelectorAll('.fab-layer-row').length === 11);
check('drawn', viewer.layers.find((l) => l.layer === 'F.Cu').runs.length >= 1 && viewer.box && viewer.box.x1 - viewer.box.x0 >= 29.9 * MM, viewer.box);
// hide the top silk
const silk = [...gws.querySelectorAll('.fab-layer-row')].find((r) => /Top silk/.test(r.textContent));
silk.querySelector('input').click();
check('hidden', viewer.hidden.has(viewer.layers.find((l) => l.layer === 'F.SilkS').name));
// Bottom view
gws.querySelector('.segmented button[data-id="bottom"]').click(); await raf();
check('bottom', viewer.side === 'bottom' && viewer.mirrorX(viewer.box.x0) === viewer.box.x1 && /bottom view/.test(panel.status()));
gws.querySelector('.segmented button[data-id="top"]').click();
// Measure from the via to R2's pad 1 (19.0875, 8): click on screen where they are
panel.setTool('measure');
const cv = app.workspace('gerber').view, r = cv.canvas.getBoundingClientRect();
const at = (x, y) => { const [sx, sy] = cv.view.toScreen([x * MM, y * MM]); return { clientX: r.left + sx, clientY: r.top + sy, button: 0, bubbles: true, pointerId: 7 }; };
cv.canvas.dispatchEvent(new PointerEvent('pointerdown', at(14, 14)));
cv.canvas.dispatchEvent(new PointerEvent('pointerdown', at(14, 8)));
check('measure', viewer.measure?.done && Math.abs(Math.hypot(viewer.measure.b[0] - viewer.measure.a[0], viewer.measure.b[1] - viewer.measure.a[1]) - 6 * MM) < 0.05 * MM, viewer.measure);
panel.setTool('select');
// save the zip, open it as fab files
const file = `/tmp/electrocad-smoke-gerber-${Date.now()}.zip`;
await native.smokeDialog(file);
await panel.download();
await native.smokeDialog([file]);
await panel.openFiles();
await raf();
check('opened', panel.source === 'opened' && panel.opened?.layers.length === 11 && /Every layer a board house needs/.test(gws.textContent), panel.opened?.layers.map((l) => l.layer));
// compare the generated files with that zip: all the same
await native.smokeDialog([file]);
const c = await panel.compareWith();
await raf();
check('compared', c?.result && c.result.align.by === 'drills' && c.result.layers.every((e) => e.missing || e.stats.match === 1), c?.result?.layers.map((e) => [e.layer, e.stats?.match]) || c);
check('compare-rows', gws.querySelectorAll('.fab-cmp-row').length >= 10 && /100\.00%/.test(gws.querySelector('.fab-cmp').textContent));
// a layer's differences as an overlay
gws.querySelector('.fab-cmp-row:not(:disabled)').click(); await raf();
check('overlay', !!viewer.diff && gws.querySelector('.fab-cmp-legend'));
check('report', /fab comparison/.test(panel.compareText()) && /Top copper\s+100\.00%/.test(panel.compareText()), panel.compareText());
return { fails, out: { zip: file } };
