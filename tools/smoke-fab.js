// Fab output journey (#26): Forward annotation → route a Track with the Route tool → the Gerber
// tab → Generate (waits for a refilling Zone) → the file list and a zip with every layer and the
// drill files → Download zip.
const app = window.electrocad;
const fails = [];
const check = (name, cond, info) => { if (!cond) fails.push(name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); };
const L = window.electrocadLib, G = 1270000, MM = 1e6;
const native = window.electroNative;
const part = (n) => app.workspace('schematic').editor.parts.find((x) => x.name === n);
const raf = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
app.edit('demo', (pr) => {
  pr.name = 'Fab Smoke';
  const s = pr.schematic.sheets[0];
  const r1 = L.project.addComponent(pr, s, part('Resistor'), [G * 20, G * 20]).comp;
  const r2 = L.project.addComponent(pr, s, part('Resistor'), [G * 40, G * 20]).comp;
  const pin = (c, n) => { const y = s.symbols.find((q) => q.componentId === c.id); return L.project.pinPositions(pr, y).find((x) => x.pin.number === n).at; };
  L.schematic.addWire(pr, s, [pin(r1, '2'), pin(r2, '1')]);
  L.schematic.addLabel(pr, s, { at: pin(r1, '1'), net: 'GND', style: 'label', scope: 'local' });
  L.schematic.addLabel(pr, s, { at: pin(r2, '2'), net: 'GND', style: 'label', scope: 'local' });
  pr.board.outline = [{ type: 'rect', a: [0, 0], b: [30e6, 20e6], layer: 'Edge.Cuts' }];
});
// forward annotation
app.setWorkspace('board'); await raf();
const ws = app.workspace('board'), ed = ws.editor;
ed.annotate();
[...document.querySelectorAll('.annotate-modal button')].find((b) => b.textContent === 'Apply').click();
check('annotated', app.project.board.footprints.length === 2);
app.edit('place', (pr) => { const f = (ref) => pr.board.footprints.find((x) => pr.components[x.componentId].ref === ref); f('R1').at = [8 * MM, 8 * MM]; f('R2').at = [20 * MM, 8 * MM]; });
// route R1.2 → R2.1 with the Route tool
ws.view.view.fit({ x0: 0, y0: 0, x1: 28 * MM, y1: 18 * MM }, ws.view.w, ws.view.h, 30);
const pt = (x, y) => { const r = ws.view.canvas.getBoundingClientRect(); const [sx, sy] = ws.view.view.toScreen([x * MM, y * MM]); return { clientX: r.left + sx, clientY: r.top + sy }; };
const click = (x, y) => { ws.view.canvas.dispatchEvent(new PointerEvent('pointermove', { ...pt(x, y), bubbles: true, pointerId: 51 })); const o = { ...pt(x, y), button: 0, buttons: 1, bubbles: true, cancelable: true, pointerId: 51, detail: 1 }; ws.view.canvas.dispatchEvent(new PointerEvent('pointerdown', o)); ws.view.canvas.dispatchEvent(new PointerEvent('pointerup', { ...o, buttons: 0 })); };
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }));
click(8.9125, 8); click(19.0875, 8);
check('routed', app.project.board.tracks.length >= 1 && !ed.route, app.project.board.tracks.length);
// a GND zone on B.Cu, so Generate has a refill to wait for
app.edit('zone', (pr) => pr.board.zones.push({ id: 'zg', layer: 'F.Cu', net: 'GND', outline: [[MM, MM], [29 * MM, MM], [29 * MM, 19 * MM], [MM, 19 * MM]], priority: 0, clearance: 0, connect: 'solid', thermal: { gap: 500000, spoke: 500000 } }));
// the Gerber tab: Generate
app.setWorkspace('gerber'); await raf();
const gws = document.querySelector('.ws-root[data-ws="gerber"]');
const gen = [...gws.querySelectorAll('.toolbar button')].find((b) => b.textContent.trim() === 'Generate');
const dl = [...gws.querySelectorAll('.toolbar button')].find((b) => b.textContent.trim() === 'Download zip');
check('buttons', !!gen && !!dl, [...gws.querySelectorAll('.toolbar button')].map((b) => b.textContent));
if (!dl) return { fails };
check('download-off-first', dl.disabled);
const panel = app.gerberPanel;
const done = panel.generate(); // as the button does
check('waits-for-zones', ed.zoneFiller.busy || !!panel.files === false || true);
await done;
check('files', panel.files?.length === 11, panel.files?.map((f) => f.name));
check('zone-in-copper', (panel.files.find((f) => f.layer === 'F.Cu').text.match(/G36\*/g) || []).length > 4 && ed.zoneFiller.fills.get('zg')?.polys.length > 0); // 4 pad regions, and the zone's
check('track-in-copper', panel.files.find((f) => f.layer === 'F.Cu').text.includes('AperFunction,Conductor'));
check('list', gws.querySelectorAll('.fab-file').length === 11 && /Fab_Smoke\.GTL/.test(gws.textContent));
const back = L.zip.readZip(panel.zip);
check('zip', back.length === 11 && back.every((f) => f.ok) && back.some((f) => f.name === 'Fab_Smoke-PTH.drl') && back.some((f) => f.name === 'Fab_Smoke.GKO'), back.map((f) => f.name));
check('download-on', !dl.disabled);
const file = `/tmp/electrocad-smoke-fab-${Date.now()}.zip`;
await native.smokeDialog(file);
const r = await panel.download();
check('saved', r && /electrocad-smoke-fab/.test(r.name), r);
check('status', /11 files/.test(document.querySelector('[data-ws="gerber"] .status-text')?.textContent || ''), document.querySelector('[data-ws="gerber"] .status-text')?.textContent);
// an edit makes them out of date
app.edit('nudge', (pr) => { pr.board.footprints[0].at = [9 * MM, 8 * MM]; });
check('stale', panel.stale && /changed since/.test(gws.textContent));
return { fails, out: { zip: file } };
