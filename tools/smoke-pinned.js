// Pinned fields journey (#53): drag a Value by hand (one undo step), it follows its part when the
// part moves, Re-apply style from the right-click menu puts it back, and pins survive a restart.
const app = window.electrocad;
const fails = [];
const check = (name, cond, info) => { if (!cond) fails.push(name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); };
const ed = app.workspace('schematic').editor;
const ws = app.workspace('schematic');
const G = 1270000;
const put = (x, y) => { ed.beginPlace(ed.parts[0]); ed.placing.at = [x * G, y * G]; const r = ed.commitPlace(); ed.endPlace(); return r.sym; };
const sym = put(50, 40);
ws.view.view.fit({ x0: 35 * G, y0: 28 * G, x1: 75 * G, y1: 55 * G }, ws.view.w, ws.view.h, 20);
ed.selection.clear(); ed.refresh(); ws.view.draw();
const r = ws.view.canvas.getBoundingClientRect();
const S = (p) => { const [x, y] = ws.view.view.toScreen(p); return [r.left + x, r.top + y]; };
const ev = (type, [x, y], button = 0) => ws.view.canvas.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, button, buttons: type === 'pointerup' ? 0 : button === 2 ? 2 : 1, bubbles: true, cancelable: true, pointerId: 3 }));
const valueItem = () => ed.placement.get(sym.id).items.find((i) => i.keys.includes('value'));
const v0 = valueItem();
const from = [(v0.box.x0 + v0.box.x1) / 2, (v0.box.y0 + v0.box.y1) / 2];
const depth = app.history.undoStack.length;
ev('pointerdown', S(from)); ev('pointermove', S([from[0] + 4 * G, from[1] + 6 * G])); ev('pointermove', S([from[0] + 6 * G, from[1] + 8 * G])); ev('pointerup', S([from[0] + 6 * G, from[1] + 8 * G]));
ws.view.draw();
const s0 = app.project.schematic.sheets[0].symbols.find((y) => y.id === sym.id);
check('pinned', !!s0.fieldPins?.value && app.history.undoStack.length === depth + 1, s0.fieldPins);
check('part-not-moved', s0.at[0] === 50 * G && s0.at[1] === 40 * G);
const v1 = valueItem();
check('dropped-there', Math.abs(v1.x - (from[0] + 6 * G)) <= G / 4 && Math.abs(v1.y - (from[1] + 8 * G)) <= G / 4 && v1.pinned, [v1.x, v1.y]);
ed.selection = new Set([sym.id]); ed.openProperties();
check('inspector-offers-reapply', [...document.querySelectorAll('.inspector button')].some((b) => /Re-apply style/.test(b.textContent)));
// the part moves: the pinned field goes with it
ed.nudge(4, 0); ws.view.draw();
const v2 = valueItem();
check('follows-part', v2.x === v1.x + 4 * G && v2.y === v1.y, [v1.x, v2.x]);
localStorage.setItem('smoke.pin', JSON.stringify(app.project.schematic.sheets[0].symbols.find((y) => y.id === sym.id).fieldPins));
app.saveNow?.();
// Re-apply style from the right-click menu
const body = S(app.project.schematic.sheets[0].symbols.find((y) => y.id === sym.id).at);
ev('pointerdown', body, 2); ev('pointerup', body, 2);
const item = [...document.querySelectorAll('.menu .menu-item')].find((b) => /Re-apply style/.test(b.textContent));
check('context-menu', !!item && item.getAttribute('aria-disabled') === 'false');
item?.click();
ws.view.draw();
check('unpinned', !app.project.schematic.sheets[0].symbols.find((y) => y.id === sym.id).fieldPins && !valueItem().pinned);
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
check('undo-reapply', !!app.project.schematic.sheets[0].symbols.find((y) => y.id === sym.id).fieldPins);
app.saveNow?.();
return { fails };
