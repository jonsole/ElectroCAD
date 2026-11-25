// Bus journey (#64): draw a Bus with the Bus tool (Shift+W) and name it in its Properties, draw a
// bus entry from a resistor's net to it, label the Bus; ERC warns when the net isn't a member and
// stops when it is; moving the Bus takes the entry and label along; undo, delete; it prints.
const app = window.electrocad;
const { project: P } = window.electrocadLib;
const fails = [];
const check = (name, cond, info) => { if (!cond) fails.push(name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ws = app.workspace('schematic'), ed = ws.editor, canvas = ws.view.canvas;
const key = (k, extra = {}) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra }));
const G = 1270000;
ws.view.view.fit({ x0: 30 * G, y0: 20 * G, x1: 80 * G, y1: 60 * G }, ws.view.w, ws.view.h, 20);
const click = (world, detail = 1) => {
  const r = canvas.getBoundingClientRect(); const [sx, sy] = ws.view.view.toScreen(world);
  const o = { pointerId: 1, button: 0, buttons: 1, clientX: r.left + sx, clientY: r.top + sy, bubbles: true, cancelable: true, detail };
  canvas.dispatchEvent(new PointerEvent('pointermove', o)); canvas.dispatchEvent(new PointerEvent('pointerdown', o)); canvas.dispatchEvent(new PointerEvent('pointerup', { ...o, buttons: 0 }));
};
const R = ed.parts.find((x) => x.name === 'Resistor');
ed.beginPlace(R); ed.placing.rot = 0; click([40 * G, 40 * G]); key('Escape');
const sheet = () => app.project.schematic.sheets[0];
const r1 = sheet().symbols[0];
const p1 = P.pinPositions(app.project, r1).find((x) => x.pin.number === '2').at;
// the Bus: Shift+W, two clicks and a double-click
key('W', { shiftKey: true });
check('tool', ed.tool === 'bus');
const bx = p1[0] + 10 * G;
click([bx, 25 * G]); click([bx, 55 * G], 2);
check('drawn', sheet().busses.length === 1 && sheet().busses[0].a[0] === bx, sheet().busses);
await wait(50);
// unnamed: selected, Properties open on its name
const nameBox = () => document.querySelector('.inspector input[aria-label="Bus name"]');
check('props', !!nameBox() && ed.selection.has(sheet().busses[0].id));
nameBox().value = 'D[0..3]'; nameBox().dispatchEvent(new Event('change'));
check('named', sheet().busses[0].name === 'D[0..3]');
// a net from R1 pin 2: a wire, then a 45° bus entry, as Wires
key('w');
click(p1); click([bx - 2 * G, p1[1]], 2);
key('w');
click([bx - 2 * G, p1[1]]); ed.wiring.posture = 'h'; // straight to the bus: a slanted entry is one run
ed.wiring.points.push([bx, p1[1] + 2 * G]); ed.finishWire();
key('Escape');
const entry = sheet().wires.find((w) => w.b[0] === bx || w.a[0] === bx);
check('entry', !!entry, sheet().wires);
// ERC: the net has no name, so it isn't one of the Bus's members
const erc = () => window.electrocadLib.erc.runErc(app.project).filter((v) => /^bus/.test(v.rule));
check('erc-not-member', erc().some((v) => v.rule === 'bus-member'), erc());
// name the net D2 (a Net label on its wire): now it is
app.edit('label', (p) => { p.schematic.sheets[0].labels.push({ id: 'lD2', at: p1, rot: 0, net: 'D2', scope: 'local', style: 'label' }); });
check('erc-member', !erc().length, erc());
// a Bus label: the Net label tool on the Bus
ed.setTool('netLabel'); click([bx, 30 * G]);
const bl = sheet().labels.find((l) => l.bus);
check('bus-label', bl && bl.net === 'D[0..3]', sheet().labels);
key('Escape');
// move the Bus: the entry and the label go along
ed.setTool('select');
ed.selection = new Set([sheet().busses[0].id]);
ed.nudge(2, 0);
const e2 = sheet().wires.find((w) => w.id === entry.id);
check('moved', sheet().busses[0].a[0] > bx, sheet().busses[0]);
check('entry-follows', [e2.a, e2.b].some((q) => q[0] === sheet().busses[0].a[0]), e2);
check('label-follows', sheet().labels.find((l) => l.bus).at[0] === sheet().busses[0].a[0]);
key('z', { ctrlKey: true });
check('undo', sheet().busses[0].a[0] === bx);
// it prints: the print preview has the Bus's thick stroke
key('p', { ctrlKey: true }); await wait(200);
const svg = decodeURIComponent(document.querySelector('.print-preview')?.src || '');
check('print', svg.length > 1000);
key('Escape'); await wait(50);
// delete
ed.selection = new Set([sheet().busses[0].id]); ed.refresh();
key('Delete');
check('deleted', !sheet().busses.length && !sheet().labels.some((l) => l.bus), sheet().labels);
key('z', { ctrlKey: true });
check('undo-delete', sheet().busses.length === 1 && sheet().labels.some((l) => l.bus));
ws.view.invalidate();
await wait(100);
return { fails };
