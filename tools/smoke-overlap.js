// Overlapping items journey (#78): a line drawn across a symbol's body can be clicked, right-clicked,
// double-clicked and dragged; elsewhere in the body the symbol is picked; at a pin the symbol comes
// first; clicking again on the same spot steps through what's under it.
const app = window.electrocad;
const { schematic: S } = window.electrocadLib;
const fails = [];
const check = (name, cond, info) => { if (!cond) fails.push(name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); };
const ws = app.workspace('schematic');
const ed = ws.editor;
const canvas = ws.view.canvas;
const G = 1270000;
const raf = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
// the part with the biggest body
const sized = ed.parts.map((p) => { const ys = p.units[0].pins.map((q) => q.at[1]); return { p, h: Math.max(...ys) - Math.min(...ys) }; }).sort((a, b) => b.h - a.h);
const part = sized[0].p;
ed.beginPlace(part); ed.placing.at = [60 * G, 40 * G]; const { sym } = ed.commitPlace(); ed.endPlace();
const b = S.symbolBounds(app.project, sym);
const cy = Math.round((b.y0 + b.y1) / 2 / G) * G, x0 = b.x0 + (b.x1 - b.x0) * 0.35, x1 = b.x0 + (b.x1 - b.x0) * 0.65;
app.edit('line', (pr) => { pr.schematic.sheets[0].drawings = [...(pr.schematic.sheets[0].drawings || []), { id: 'dline', type: 'line', pts: [[Math.round(x0), cy], [Math.round(x1), cy]], style: 'solid', arrowStart: false, arrowEnd: false }]; });
ws.view.view.fit({ x0: b.x0 - 10 * G, y0: b.y0 - 10 * G, x1: b.x1 + 10 * G, y1: b.y1 + 10 * G }, ws.view.w, ws.view.h, 20);
await raf();
const scr = ([x, y]) => { const r = canvas.getBoundingClientRect(); const s = ws.view.view.toScreen([x, y]); return [r.left + s[0], r.top + s[1]]; };
// as a browser sends them: pointer events carry 0 clicks, and separate clicks are some time apart
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const click = async (world) => { await wait(400); const [x, y] = scr(world); const o = { pointerId: 9, button: 0, buttons: 1, clientX: x, clientY: y, bubbles: true, cancelable: true, detail: 0 }; canvas.dispatchEvent(new PointerEvent('pointerdown', o)); canvas.dispatchEvent(new PointerEvent('pointerup', { ...o, buttons: 0 })); };
const sel = () => [...ed.selection].join(',');
const onLine = [Math.round((x0 + x1) / 2), cy], inBody = [Math.round((x0 + x1) / 2), Math.round(b.y0 + (cy - b.y0) / 2)];

// 1. the line, not the part
await click(onLine);
check('line-picked', sel() === 'dline', sel());
// 2. elsewhere in the body: the part
await click(inBody);
check('body-picks-part', sel() === sym.id, sel());
// 3. clicking again on the same spot steps between them
await click(onLine);
check('line-again', sel() === 'dline', sel());
await click(onLine);
check('cycle-to-part', sel() === sym.id, sel());
await click(onLine);
check('cycle-back', sel() === 'dline', sel());
// 4. at a pin, the part comes first
const pinAt = window.electrocadLib.project.pinPositions(app.project, sym)[0].at;
check('pin-picks-part', ed._hitsAt(pinAt, ws.view.view.scale)[0]?.id === sym.id, ed._hitsAt(pinAt, ws.view.view.scale).map((x) => x.id));
// 5. right-click on the line selects the line
ed.selection = new Set(); ed.refresh();
const [mx, my] = scr(onLine);
ed.contextMenu({ clientX: mx, clientY: my });
check('menu-on-line', sel() === 'dline', sel());
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
document.querySelectorAll('.menu').forEach((m) => m.remove());
// 6. double-click on the line opens the line's Properties
ed.selection = new Set(); ed.refresh();
canvas.dispatchEvent(new MouseEvent('dblclick', { clientX: mx, clientY: my, bubbles: true, cancelable: true }));
check('dblclick-line', sel() === 'dline', sel());
// 7. dragging the line moves it, not the part
const symAt = [...sym.at];
const [sx, sy] = scr(onLine), [tx, ty] = scr([onLine[0], cy + 4 * G]);
canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 9, button: 0, buttons: 1, clientX: sx, clientY: sy, bubbles: true, cancelable: true, detail: 1 }));
canvas.dispatchEvent(new PointerEvent('pointermove', { pointerId: 9, button: -1, buttons: 1, clientX: sx, clientY: sy + 8, bubbles: true }));
canvas.dispatchEvent(new PointerEvent('pointermove', { pointerId: 9, button: -1, buttons: 1, clientX: tx, clientY: ty, bubbles: true }));
canvas.dispatchEvent(new PointerEvent('pointerup', { pointerId: 9, button: 0, buttons: 0, clientX: tx, clientY: ty, bubbles: true }));
const line = app.project.schematic.sheets[0].drawings.find((d) => d.id === 'dline');
const symNow = app.project.schematic.sheets[0].symbols.find((y) => y.id === sym.id);
check('line-moved', line.pts[0][1] === cy + 4 * G, line.pts.map((q) => q.map((v) => v / G)));
check('part-stayed', symNow.at[0] === symAt[0] && symNow.at[1] === symAt[1], symNow.at);
return { fails };
