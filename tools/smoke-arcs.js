// Arc track journey (#93): a curved Track (a, mid, b) draws as an arc, is picked by clicking on the
// curve (far from its chord), shows as an arc with its radius in Properties, joins its pads in the
// ratsnest, and DRC measures clearance to the curve: a track near the arc's top is flagged.
const app = window.electrocad;
const fails = [];
const check = (name, cond, info) => { if (!cond) fails.push(name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); };
const L = window.electrocadLib, G = 1270000, MM = 1e6;
const part = (n) => app.workspace('schematic').editor.parts.find((x) => x.name === n);
app.edit('demo', (pr) => {
  const s = pr.schematic.sheets[0];
  const rs = [0, 1].map((i) => L.project.addComponent(pr, s, part('Resistor'), [G * (20 + i * 20), G * 20]).comp);
  const pin = (c, n) => { const y = s.symbols.find((q) => q.componentId === c.id); return L.project.pinPositions(pr, y).find((x) => x.pin.number === n).at; };
  L.schematic.addLabel(pr, s, { at: pin(rs[0], '2'), net: 'SIG', style: 'label', scope: 'local' });
  L.schematic.addLabel(pr, s, { at: pin(rs[1], '1'), net: 'SIG', style: 'label', scope: 'local' });
  pr.board.outline = [{ type: 'rect', a: [0, 0], b: [30e6, 20e6], layer: 'Edge.Cuts' }];
});
app.setWorkspace('board');
await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
const ws = app.workspace('board'), ed = ws.editor;
ed.annotate();
[...document.querySelectorAll('.annotate-modal button')].find((b) => b.textContent === 'Apply').click();
// pads at (6.9125, 6) and (19.0875, 6); the arc bulges 4 mm up through (13, 2): radius 6.632 mm, centre (13, 8.632)
app.edit('place', (pr) => {
  const f = (ref) => pr.board.footprints.find((x) => pr.components[x.componentId].ref === ref);
  f('R1').at = [6 * MM, 6 * MM]; f('R2').at = [20 * MM, 6 * MM];
  pr.board.tracks.push({ id: 'arc', a: [6.9125 * MM, 6 * MM], mid: [13 * MM, 2 * MM], b: [19.0875 * MM, 6 * MM], width: 250000, layer: 'F.Cu', net: 'SIG' });
});
ws.view.view.fit({ x0: 0, y0: 0, x1: 28 * MM, y1: 18 * MM }, ws.view.w, ws.view.h, 30); ws.view.draw();
const unrouted = () => Object.values(ed._rats.unrouted).reduce((a, b) => a + b, 0);
check('joined', unrouted() === 0, ed._rats.unrouted);
// drawn as an arc: copper colour at the top of the curve, none on the chord's middle
const px = (x, y) => { const [sx, sy] = ws.view.view.toScreen([x * MM, y * MM]); const d = ws.view.ctx.getImageData(Math.round(sx * devicePixelRatio), Math.round(sy * devicePixelRatio), 1, 1).data; return d[0] > 150 && d[1] < 120; };
check('drawn', px(13, 2) && !px(13, 6), [px(13, 2), px(13, 6)]);
// picked on the curve (3.3 mm from its chord)
const pt = (x, y) => { const r = ws.view.canvas.getBoundingClientRect(); const [sx, sy] = ws.view.view.toScreen([x * MM, y * MM]); return { clientX: r.left + sx, clientY: r.top + sy }; };
const click = (x, y) => { const o = { ...pt(x, y), button: 0, buttons: 1, bubbles: true, cancelable: true, pointerId: 71, detail: 1 }; ws.view.canvas.dispatchEvent(new PointerEvent('pointermove', { ...o, buttons: 0 })); ws.view.canvas.dispatchEvent(new PointerEvent('pointerdown', o)); ws.view.canvas.dispatchEvent(new PointerEvent('pointerup', { ...o, buttons: 0 })); };
ed.setTool('select');
click(9, 8.632 - Math.sqrt(6.632 ** 2 - 16));
check('picked', ed.trackSel.size === 1 && ed.trackSel.has('arc'), [...ed.trackSel]);
click(13, 6.6);
check('chord-empty', !ed.trackSel.has('arc'), [...ed.trackSel]);
click(13, 2);
ed.openProperties();
const props = document.querySelector('[data-ws="board"] .inspector')?.textContent || document.body.textContent;
check('props', /an arc, radius 6\.63/.test(props), props.slice(0, 300));
// DRC: a track of another net 0.3 mm above the arc's top (5.7 mm from the chord) is too close
app.edit('near', (pr) => { pr.board.tracks.push({ id: 'near', a: [12 * MM, 1.7 * MM], b: [14 * MM, 1.7 * MM], width: 250000, layer: 'F.Cu', net: 'X' }); });
[...document.querySelectorAll('[data-ws="board"] .toolbar button')].find((b) => b.textContent.trim() === 'DRC').click();
const t0 = Date.now();
while (!ed.drc && Date.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 50));
check('drc', !!ed.drc && ed.drc.list.some((v) => v.rule === 'clearance' && v.items.includes('arc') && v.items.includes('near')), ed.drc?.list.map((v) => v.message));
app.edit('away', (pr) => { pr.board.tracks.find((t) => t.id === 'near').a = [12 * MM, 0.8 * MM]; pr.board.tracks.find((t) => t.id === 'near').b = [14 * MM, 0.8 * MM]; });
await new Promise((r) => setTimeout(r, 300));
check('drc-clear', !ed.drc.list.some((v) => v.rule === 'clearance'), ed.drc.list.map((v) => v.message));
return { fails };
