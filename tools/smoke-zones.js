// Zones journey (#23): Z draws a Zone (with no pad or track under its first corner it takes GND); it
// fills in the Web Worker, round other nets' copper with thermal reliefs on GND pads; Properties
// edit it (one undo step each); moving a track refills only the Zone it is in; a drag shows the
// touched Zone as an outline; whenZonesFilled() waits for refills; Del deletes. The Zone is saved
// (smoke-zones-restart.js reopens it).
const app = window.electrocad;
const fails = [];
const check = (name, cond, info) => { if (!cond) fails.push(name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); };
const L = window.electrocadLib, G = 1270000, MM = 1e6;
const part = (n) => app.workspace('schematic').editor.parts.find((x) => x.name === n);
app.edit('demo', (pr) => {
  const s = pr.schematic.sheets[0];
  const rs = [0, 1, 2].map((i) => L.project.addComponent(pr, s, part('Resistor'), [G * (20 + i * 20), G * 20]).comp);
  const pin = (c, n) => { const y = s.symbols.find((q) => q.componentId === c.id); return L.project.pinPositions(pr, y).find((x) => x.pin.number === n).at; };
  L.schematic.addLabel(pr, s, { at: pin(rs[0], '1'), net: 'GND', style: 'label', scope: 'local' });
  L.schematic.addLabel(pr, s, { at: pin(rs[1], '1'), net: 'GND', style: 'label', scope: 'local' });
  L.schematic.addLabel(pr, s, { at: pin(rs[0], '2'), net: 'SIG', style: 'label', scope: 'local' });
  L.schematic.addLabel(pr, s, { at: pin(rs[2], '1'), net: 'SIG', style: 'label', scope: 'local' });
  pr.board.outline = [{ type: 'rect', a: [0, 0], b: [40e6, 20e6], layer: 'Edge.Cuts' }];
});
app.setWorkspace('board');
await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
const ws = app.workspace('board'), ed = ws.editor;
ed.annotate();
[...document.querySelectorAll('.annotate-modal button')].find((b) => b.textContent === 'Apply').click();
app.edit('place', (pr) => {
  const f = (ref) => pr.board.footprints.find((x) => pr.components[x.componentId].ref === ref);
  f('R1').at = [6 * MM, 6 * MM]; f('R2').at = [15 * MM, 6 * MM]; f('R3').at = [32 * MM, 14 * MM];
  pr.board.tracks.push({ id: 'sig1', a: [6.9125 * MM, 6 * MM], b: [6.9125 * MM, 14 * MM], width: 250000, layer: 'F.Cu', net: 'SIG' });
  pr.board.tracks.push({ id: 'sig2', a: [6.9125 * MM, 14 * MM], b: [31.0875 * MM, 14 * MM], width: 250000, layer: 'F.Cu', net: 'SIG' });
});
ws.view.view.fit({ x0: -1 * MM, y0: -1 * MM, x1: 41 * MM, y1: 21 * MM }, ws.view.w, ws.view.h, 30);
const pt = (x, y) => { const r = ws.view.canvas.getBoundingClientRect(); const [sx, sy] = ws.view.view.toScreen([x * MM, y * MM]); return { clientX: r.left + sx, clientY: r.top + sy }; };
const move = (x, y, buttons = 0) => ws.view.canvas.dispatchEvent(new PointerEvent('pointermove', { ...pt(x, y), button: 0, buttons, bubbles: true, pointerId: 43 }));
const down = (x, y, detail = 1) => ws.view.canvas.dispatchEvent(new PointerEvent('pointerdown', { ...pt(x, y), button: 0, buttons: 1, bubbles: true, cancelable: true, pointerId: 43, detail }));
const up = (x, y) => ws.view.canvas.dispatchEvent(new PointerEvent('pointerup', { ...pt(x, y), button: 0, buttons: 0, bubbles: true, pointerId: 43 }));
const click = (x, y, detail = 1) => { move(x, y); down(x, y, detail); up(x, y); };
const key = (k, more = {}) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...more }));
// two zones: a big GND one, and a small one on B.Cu with no pad under its corner
key('z');
check('zone-tool', ed.tool === 'zone' && ed.activeLayer === 'F.Cu');
const undo0 = app.history.undoStack.length;
for (const [x, y] of [[1, 1], [20, 1], [20, 10], [1, 10]]) click(x, y);
click(1, 10, 2); // double-click closes it
const b = app.project.board;
check('added', b.zones.length === 1 && app.history.undoStack.length === undo0 + 1, b.zones.length);
const z = b.zones[0];
check('net-gnd', z.net === 'GND' && z.layer === 'F.Cu' && z.outline.length === 4, [z.net, z.layer, z.outline.length]);
check('selected', ed.zoneSel.has(z.id) && ed.tool === 'select');
const t0 = performance.now();
await ed.whenZonesFilled();
const f = ed.zoneFiller.fills.get(z.id);
check('filled', f && f.polys.length >= 1, f);
check('worker', ed.zoneFiller.workers.size > 0 && !ed.zoneFiller.noWorkers, 'filled on the main thread'); // one worker per layer (#73)
check('thermals', f.thermals.length === 2 && f.thermals.every((t) => t.spokes >= 2), f.thermals);
console.log('[smoke] zone fill ms', Math.round(performance.now() - t0));
// clearance to the SIG track (checked with the collision engine's distance)
const ring = (fl) => fl.polys.flatMap((poly) => poly.flatMap((r) => r.map((q, i) => [q, r[(i + 1) % r.length]])));
const gap = Math.min(...ring(f).map(([a, c]) => L.collision.shapeDistance({ type: 'capsule', a, b: c, r: 0 }, { type: 'capsule', a: b.tracks[0].a, b: b.tracks[0].b, r: 125000 })));
check('clearance', gap >= b.rules.clearance - 10000, gap);
// Properties: priority, solid pads, net
const props = document.querySelector('[data-ws="board"] .board-props');
check('props', /Zone on F\.Cu/.test(props.textContent) && props.querySelector('select[aria-label="Zone net"]').value === 'GND');
[...props.querySelectorAll('[data-connect]')].find((x) => x.dataset.connect === 'solid').click();
check('solid', b.zones[0].connect === 'solid');
await ed.whenZonesFilled();
check('solid-fill', ed.zoneFiller.fills.get(z.id).thermals.length === 0);
const pri = document.querySelector('[data-ws="board"] .board-props input[aria-label="Priority"]'); pri.value = '2'; pri.dispatchEvent(new Event('change'));
check('priority', b.zones[0].priority === 2);
// a second zone elsewhere (B.Cu), then moving the track refills only the first
ed.setActiveLayer('B.Cu');
key('z');
for (const [x, y] of [[25, 2], [38, 2], [38, 8], [25, 8]]) click(x, y);
key('Enter');
check('second', b.zones.length === 2 && b.zones[1].layer === 'B.Cu' && b.zones[1].net === 'GND', b.zones[1]);
await ed.whenZonesFilled();
const z2 = b.zones[1].id;
const sent = [];
const orig = ed.zoneFiller._send.bind(ed.zoneFiller);
ed.zoneFiller._send = (msg) => { sent.push(...msg.ids); orig(msg); };
app.edit('move track', (pr) => { pr.board.tracks[0].a = [6.9125 * MM, 7 * MM]; });
check('only-touched', sent.length === 1 && sent[0] === z.id, sent);
// #105: while it refills, the old fill stays on screen (no outline-only flicker); the new one fades in
const oldFill = ed.zoneFiller.fills.get(z.id);
check('old-fill-while-pending', !ed._zonesAsOutlines(b).has(z.id) && !!oldFill);
await ed.whenZonesFilled();
const fading = ed.zoneFiller.fade();
check('fades-in', ed.zoneFiller.fills.get(z.id) !== oldFill && (fading.get(z.id)?.old === oldFill || !fading.size), [...fading.keys()]);
await new Promise((r) => setTimeout(r, 220));
check('fade-done', !ed.zoneFiller.fade().size);
ed.zoneFiller._send = orig;
// dragging a footprint inside the zone draws it as an outline until the drop
ed.setActiveLayer('F.Cu');
key('Escape');
down(15, 5.6); move(15.5, 5.6, 1); move(16.5, 5.6, 1);
check('drag-outline', ed.drag?.moved && ed._zonesAsOutlines({ ...b, footprints: ed.previewFps, zones: b.zones }).has(z.id) && !ed._zonesAsOutlines({ ...b, footprints: ed.previewFps, zones: b.zones }).has(z2));
up(16.5, 5.6);
await ed.whenZonesFilled();
check('refilled', !ed._zonesAsOutlines(b).size);
// select by clicking inside, delete, undo
key('Escape');
click(12, 9);
check('click-select', ed.zoneSel.has(z.id), [...ed.zoneSel]);
key('Delete');
check('deleted', b.zones.length === 1 || app.project.board.zones.length === 1);
key('z', { ctrlKey: true });
check('undo', app.project.board.zones.length === 2);
// a corner dragged onto its neighbour merges with it: one corner fewer, in one undo step
{
  const zz = () => app.project.board.zones.find((q) => q.id === z.id);
  ed.zoneSel = new Set([z.id]); ed.refresh();
  const pts0 = zz().outline.map((q) => [...q]), n0 = pts0.length, h0 = app.history.undoStack.length;
  const [ax, ay] = pts0[1].map((v) => v / MM), [bx, by] = pts0[2].map((v) => v / MM);
  move(ax, ay); down(ax, ay);
  for (let k = 1; k <= 6; k++) move(ax + (bx - ax) * k / 6, ay + (by - ay) * k / 6, 1);
  up(bx, by);
  check('corner-merged', zz().outline.length === n0 - 1 && app.history.undoStack.length === h0 + 1 && !zz().outline.some((q) => q[0] === pts0[1][0] && q[1] === pts0[1][1]), zz().outline);
  key('z', { ctrlKey: true });
  check('corner-merge-undo', zz().outline.length === n0, zz().outline);
}
// saved with the project (connect, priority)
await app.saveNow();
localStorage.setItem('smoke.zones', JSON.stringify(app.project.board.zones.map((q) => [q.id, q.net, q.layer, q.priority, q.connect])));
return { fails };
