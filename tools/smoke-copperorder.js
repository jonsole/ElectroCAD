// Copper drawn as it's stacked: a layer at a time, bottom to top (zones, pads, tracks), so a
// back-layer track crossing a front SMD pad goes under it, and a front track over a back pad.
const app = window.electrocad;
const fails = [];
const check = (name, cond, info) => { if (!cond) fails.push(name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); };
const MM = 1e6;
const part = app.workspace('schematic').editor.parts.find((x) => x.name === 'Resistor');
app.edit('demo', (pr) => {
  const s = pr.schematic.sheets[0];
  const L = window.electrocadLib;
  const add = (x, name, layer) => {
    const c = L.project.addComponent(pr, s, part, [1270000 * x, 1270000 * 20]).comp;
    c.footprint = L.project.footprintRef(pr, { library: 'user', footprint: { name, pads: [{ number: '1', at: [0, 0], shape: 'rect', size: [3 * MM, 3 * MM], layers: [layer, layer.replace('Cu', 'Mask')] }, { number: '2', at: [20 * MM, 0], shape: 'rect', size: [1 * MM, 1 * MM], layers: [layer] }], graphics: [] } });
  };
  add(20, 'BIGF', 'F.Cu'); add(40, 'BIGB', 'B.Cu');
  pr.board.outline = [{ type: 'rect', a: [0, 0], b: [40e6, 30e6], layer: 'Edge.Cuts' }];
});
app.setWorkspace('board');
await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
const ws = app.workspace('board'), ed = ws.editor;
ed.annotate();
[...document.querySelectorAll('.annotate-modal button')].find((b) => b.textContent === 'Apply').click();
app.edit('place', (p) => {
  const [f, b] = p.board.footprints;
  f.at = [5 * MM, 8 * MM]; b.at = [5 * MM, 20 * MM]; b.side = 'F';
  // a back track across the front pad, a front track across the back pad
  p.board.tracks.push({ id: 'bt', a: [2 * MM, 8 * MM], b: [8 * MM, 8 * MM], width: 500000, layer: 'B.Cu', net: '' });
  p.board.tracks.push({ id: 'ft', a: [2 * MM, 20 * MM], b: [8 * MM, 20 * MM], width: 500000, layer: 'F.Cu', net: '' });
});
ws.view.view.fit({ x0: 0, y0: 0, x1: 40e6, y1: 30e6 }, ws.view.w, ws.view.h, 10);
ws.view.draw();
const px = (p) => { const c = ws.view.canvas, g = c.getContext('2d'), dpr = c.width / ws.view.w; const [x, y] = ws.view.view.toScreen(p); return [...g.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data].slice(0, 3); };
const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 40);
// the pad's own colour, next to the track, and in the middle where the track crosses it
const frontPad = px([3.9 * MM, 7 * MM]), frontMid = px([3.9 * MM, 8 * MM]);
check('front pad over back track', near(frontPad, frontMid), [frontPad, frontMid]);
const backPad = px([3.9 * MM, 19 * MM]), frontTrack = px([3 * MM, 20 * MM]), backMid = px([3.9 * MM, 20 * MM]);
check('front track over back pad', near(frontTrack, backMid) && !near(backPad, backMid), [backPad, frontTrack, backMid]);
return { fails };
