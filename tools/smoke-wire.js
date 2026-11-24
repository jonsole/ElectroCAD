// Wires and Netlist journey (#5), part 1: place parts, draw wires with real clicks (including a
// T-join), check the Netlist panel and junctions, undo/redo, save. Part 2 reopens after a restart.
const app = window.electrocad;
const { project: P } = window.electrocadLib;
const fails = [];
const out = {};
const check = (name, cond, info) => { if (!cond) fails.push(name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); };
const ws = app.workspace('schematic');
const ed = ws.editor;
const canvas = ws.view.canvas;
const key = (k, extra = {}) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra }));
const G = 1270000;
// big parts on screen
ws.view.view.fit({ x0: 40 * G, y0: 30 * G, x1: 90 * G, y1: 60 * G }, ws.view.w, ws.view.h, 20);
const click = (world, detail = 1) => {
  const r = canvas.getBoundingClientRect();
  const [sx, sy] = ws.view.view.toScreen(world);
  const o = { pointerId: 1, button: 0, buttons: 1, clientX: r.left + sx, clientY: r.top + sy, bubbles: true, cancelable: true, detail };
  canvas.dispatchEvent(new PointerEvent('pointermove', o));
  canvas.dispatchEvent(new PointerEvent('pointerdown', o));
  canvas.dispatchEvent(new PointerEvent('pointerup', { ...o, buttons: 0 }));
};
const lib = ed.parts;
const R = lib.find((x) => x.name === 'Resistor'), C = lib.find((x) => x.name === 'Capacitor');
const place = (part, at, rot = 0) => { ed.beginPlace(part); ed.placing.rot = rot; click(at); key('Escape'); };
place(R, [50 * G, 40 * G]);
place(R, [70 * G, 40 * G]);
place(C, [60 * G, 50 * G], 90);
const pin = (ref, n) => { const s = app.project.schematic.sheets[0].symbols.find((y) => app.project.components[y.componentId].ref === ref); return P.pinPositions(app.project, s).find((x) => x.pin.number === n).at; };

// R1.2 -> R2.1 with the Wire tool: click start, click end on a Pin finishes.
key('w');
check('wire-tool', ed.tool === 'wire' && ed.toolBtn.wire.classList.contains('active'));
click(pin('R1', '2'));
check('wiring-started', !!ed.wiring);
click(pin('R2', '1'));
check('auto-finished-on-pin', !ed.wiring && app.project.schematic.sheets[0].wires.length === 1, app.project.schematic.sheets[0].wires.length);

// C1.2 (upper Pin after rotating) up to the middle of that Wire: a T-join; clicking on the Wire finishes it.
const c2 = pin('C1', '2');
click(c2);
click([c2[0], 40 * G], 1);
check('finished-on-wire', !ed.wiring, ed.wiring);
key('Escape'); // back to Select
check('select-tool', ed.tool === 'select');

const nl = window.electrocadLib.netlist.buildNetlist(app.project);
out.nets = nl.nets.map((n) => n.name + ':' + n.pins.map((x) => x.ref + '.' + x.pin).join(','));
check('one-net-three-pins', nl.nets.length === 1 && nl.nets[0].pins.length === 3, out.nets);
check('junction', window.electrocadLib.netlist.junctions(app.project, app.project.schematic.sheets[0]).length === 1);

// Netlist panel shows it.
ed.netlistBtn.click();
const panel = document.querySelector('.netlist-panel');
check('panel-open', panel && panel.style.display !== 'none' && /C1\.2/.test(panel.textContent) && /R2\.1/.test(panel.textContent), panel && panel.textContent);

// Undo the T-join: the panel updates live; redo brings it back.
key('z', { ctrlKey: true });
check('undo-updates-panel', !/C1\.2/.test(panel.querySelector('.nl-net:not(.nl-unconnected)')?.textContent || ''), panel.textContent);
key('z', { ctrlKey: true, shiftKey: true });
check('redo', /C1\.2/.test(panel.textContent));

// Select a wire by clicking it and delete it; undo restores.
const w0 = app.project.schematic.sheets[0].wires[0];
click([(w0.a[0] + w0.b[0]) / 2 + G / 2, w0.a[1]]);
check('wire-selected', ed.selection.size === 1, [...ed.selection]);
key('Delete');
check('wire-deleted', app.project.schematic.sheets[0].wires.length === 1);
key('z', { ctrlKey: true });
check('wire-restored', app.project.schematic.sheets[0].wires.length === 2);

// Drawn: some pixels in the Wire colour.
ws.view.draw();
const want = app.canvasColors('schematic').wire;
const img = ws.view.ctx.getImageData(0, 0, canvas.width, canvas.height).data;
let n = 0;
for (let i = 0; i < img.length; i += 4) if ('#' + [img[i], img[i + 1], img[i + 2]].map((x) => x.toString(16).padStart(2, '0')).join('') === want) n++;
check('wires-drawn', n > 100, n);

await app.saveNow();
localStorage.setItem('smoke.netlist', JSON.stringify(window.electrocadLib.netlist.buildNetlist(app.project)));
return { fails, out };
