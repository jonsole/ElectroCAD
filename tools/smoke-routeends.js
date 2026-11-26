// Routing from and to copper that isn't a pad (#87, #88, #89): with the Route tool, start on the
// free end of a track and finish on a pad; start on a pad and finish on a track end and on a via;
// branch off the middle of a track (a T-junction), which splits it. Each clears the airwire, DRC
// shows nothing unrouted, and one undo takes it back.
const app = window.electrocad;
const fails = [];
const check = (name, cond, info) => { if (!cond) fails.push(name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const L = window.electrocadLib, G = 1270000, MM = 1e6;
const part = (n) => app.workspace('schematic').editor.parts.find((x) => x.name === n);
app.edit('demo', (pr) => {
  const s = pr.schematic.sheets[0];
  const r1 = L.project.addComponent(pr, s, part('Resistor'), [G * 20, G * 20]).comp;
  const r2 = L.project.addComponent(pr, s, part('Resistor'), [G * 40, G * 20]).comp;
  const pin = (c, n) => L.project.pinPositions(pr, s.symbols.find((q) => q.componentId === c.id)).find((x) => x.pin.number === n).at;
  L.schematic.addWire(pr, s, [pin(r1, '2'), pin(r2, '1')]);
  pr.board.outline = [{ type: 'rect', a: [0, 0], b: [40e6, 25e6], layer: 'Edge.Cuts' }];
});
app.setWorkspace('board');
await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
const ws = app.workspace('board'), ed = ws.editor;
ed.annotate();
[...document.querySelectorAll('.annotate-modal button')].find((b) => b.textContent === 'Apply').click();
let net;
const P1 = [6.9125, 8], P2 = [29.0875, 16];
app.edit('place', (pr) => {
  const f = (ref) => pr.board.footprints.find((x) => pr.components[x.componentId].ref === ref);
  f('R1').at = [6 * MM, 8 * MM]; f('R2').at = [30 * MM, 16 * MM];
  net = Object.keys(pr.board.annotation.nets).find((n) => pr.board.annotation.nets[n].length === 2);
  // a track from R1's pad 2 along y = 8 to x = 24 (free end), and a via of the net at (24, 12)
  pr.board.tracks.push({ id: 's', a: [P1[0] * MM, 8 * MM], b: [24 * MM, 8 * MM], width: 250000, layer: 'F.Cu', net });
});
const base = structuredClone(app.project.board);
ws.view.view.fit({ x0: 3 * MM, y0: 4 * MM, x1: 33 * MM, y1: 20 * MM }, ws.view.w, ws.view.h, 20);
const pt = (x, y) => { const r = ws.view.canvas.getBoundingClientRect(); const [sx, sy] = ws.view.view.toScreen([x * MM, y * MM]); return { clientX: r.left + sx, clientY: r.top + sy }; };
const ev = (type, x, y, buttons) => ws.view.canvas.dispatchEvent(new PointerEvent(type, { ...pt(x, y), button: 0, buttons, bubbles: true, cancelable: true, pointerId: 55 }));
const clickAt = async (x, y) => { ev('pointermove', x, y, 0); ev('pointerdown', x, y, 1); ev('pointerup', x, y, 0); await wait(40); };
const unrouted = () => ed._rats.wires.length;
const undo = async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true })); await wait(50); };
const same = () => JSON.stringify(app.project.board.tracks) === JSON.stringify(base.tracks) && JSON.stringify(app.project.board.vias) === JSON.stringify(base.vias);
check('airwire', unrouted() === 1);
ed.setTool('route');
check('route-tool', ed.tool === 'route');

// #87: start on the free end of the track, finish on R2's pad
await clickAt(24, 8);
check('start-on-end', ed.route && ed.route.net === net && ed.route.points[0][0] === 24 * MM, ed.route);
await clickAt(P2[0], P2[1]);
check('finish-on-pad', !ed.route && unrouted() === 0, unrouted());
await undo();
check('undo-1', same());

// #88: start on R2's pad, finish on the track end (the ring shows first)
await clickAt(P2[0], P2[1]);
ev('pointermove', 24, 8, 0); await wait(30);
check('target-ring', ed.routeView?.target?.kind === 'end', ed.routeView?.target);
await clickAt(24, 8);
check('finish-on-end', !ed.route && unrouted() === 0, unrouted());
await undo();

// #88: finish on a via of the net
app.edit('via', (pr) => { pr.board.tracks.push({ id: 'w', a: [24 * MM, 8 * MM], b: [24 * MM, 12 * MM], width: 250000, layer: 'F.Cu', net }); pr.board.vias.push({ id: 'v', at: [24 * MM, 12 * MM], diameter: 600000, drill: 300000, from: 'F.Cu', to: 'B.Cu', net }); });
await clickAt(P2[0], P2[1]);
await clickAt(24, 12.1);
check('finish-on-via', !ed.route && unrouted() === 0, unrouted());
await undo(); await undo();
check('undo-2', same());

// #89: branch off the middle of the track to R2's pad: the track is split at the T
await clickAt(16, 8.05);
check('start-along', ed.route?.joins?.[0]?.id === 's', ed.route);
await clickAt(P2[0], P2[1]);
check('t-routed', !ed.route && unrouted() === 0, unrouted());
const s = app.project.board.tracks.find((t) => t.id === 's');
check('split', s && s.b[0] === 16 * MM && app.project.board.tracks.some((t) => t.id !== 's' && t.a[0] === 16 * MM && t.a[1] === 8 * MM && t.b[0] === 24 * MM), app.project.board.tracks.map((t) => [t.id, t.a, t.b]));
await ed.runDrc(); await wait(50);
check('drc-clean', !ed.drc.list.some((v) => v.rule === 'clearance' || v.rule === 'unrouted'), ed.drc.list.map((v) => v.message));
ed.drcCard?.toggle?.(false);
await undo();
check('undo-3', same());

// a click on nothing says where a track can start
await clickAt(16, 18);
check('nothing', !ed.route);
ed.setTool('select');
return { fails };
