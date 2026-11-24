// Selection editing journey (#8): drag a part with real pointer events and its wires follow
// (Netlist unchanged, wires stay square); box select window vs crossing; arrow-key nudge;
// copy/paste/duplicate with new references; delete and undo.
const app = window.electrocad;
const { project: P, netlist: NL, schematic: S } = window.electrocadLib;
const fails = [];
const out = {};
const check = (name, cond, info) => { if (!cond) fails.push(name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); };
const ws = app.workspace('schematic');
const ed = ws.editor;
const canvas = ws.view.canvas;
const G = 1270000;
const key = (k, extra = {}) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra }));
const sig = () => JSON.stringify(NL.buildNetlist(app.project).nets.map((n) => n.pins.map((x) => x.ref + '.' + x.pin).sort()).sort());
const square = () => app.project.schematic.sheets[0].wires.every((w) => w.a[0] === w.b[0] || w.a[1] === w.b[1]);
const [R, C] = ed.parts;
const put = (part, x, y, rot = 0) => { ed.beginPlace(part); ed.placing.rot = rot; ed.placing.at = [x * G, y * G]; const r = ed.commitPlace(); ed.endPlace(); return r.sym; };
const r1 = put(R, 50, 40), r2 = put(R, 70, 40), c1 = put(C, 62, 52, 90);
const pin = (s, n) => P.pinPositions(app.project, s).find((x) => x.pin.number === n).at;
app.edit('wires', (pr) => { const sh = pr.schematic.sheets[0]; S.addWire(pr, sh, [pin(r1, '2'), pin(r2, '1')]); const t = pin(c1, '2'); S.addWire(pr, sh, [t, [t[0], 40 * G]]); });
ws.view.view.fit({ x0: 42 * G, y0: 32 * G, x1: 80 * G, y1: 60 * G }, ws.view.w, ws.view.h, 20);
const scr = (world) => { const r = canvas.getBoundingClientRect(); const s = ws.view.view.toScreen(world); return [r.left + s[0], r.top + s[1]]; };
const pe = (type, [x, y], buttons, extra = {}) => canvas.dispatchEvent(new PointerEvent(type, { pointerId: 3, button: type === 'pointermove' ? -1 : 0, buttons, clientX: x, clientY: y, bubbles: true, cancelable: true, ...extra }));
const before = sig();

// 1. Drag R2 by its body: wires follow, nothing disconnects.
const from = scr(r2.at), to = scr([r2.at[0] + 5 * G, r2.at[1] + 8 * G]);
pe('pointerdown', from, 1);
pe('pointermove', [from[0] + 10, from[1] + 10], 1);
pe('pointermove', to, 1);
check('preview-while-dragging', !!ed.preview);
pe('pointerup', to, 0);
const moved = app.project.schematic.sheets[0].symbols.find((y) => y.id === r2.id);
check('moved', moved.at[0] === 75 * G && moved.at[1] === 48 * G, moved.at.map((v) => v / G));
check('netlist-kept', sig() === before, [sig(), before]);
check('square', square());
check('one-undo', (() => { const n = app.history.undoStack.length; key('z', { ctrlKey: true }); const ok = sig() === before && app.project.schematic.sheets[0].symbols.find((y) => y.id === r2.id).at[0] === 70 * G; key('z', { ctrlKey: true, shiftKey: true }); return ok && app.history.undoStack.length === n; })());

// 2. Box select: left-to-right window around R1 only; right-to-left crossing also takes the wire it touches.
key('Escape');
const a = scr([45 * G, 36 * G]), b = scr([56 * G, 44 * G]);
pe('pointerdown', a, 1); pe('pointermove', [a[0] + 8, a[1] + 8], 1); pe('pointermove', b, 1); pe('pointerup', b, 0);
check('window', ed.selection.size === 1 && ed.selection.has(r1.id), [...ed.selection]);
pe('pointerdown', b, 1); pe('pointermove', [b[0] - 8, b[1] - 8], 1); pe('pointermove', a, 1); pe('pointerup', a, 0);
check('crossing', ed.selection.has(r1.id) && ed.selection.size >= 2, [...ed.selection]);

// 3. Arrow-key nudge of R1 alone keeps the net.
ed.selection = new Set([r1.id]); ed.refresh();
key('ArrowUp'); key('ArrowUp');
check('nudged', app.project.schematic.sheets[0].symbols.find((y) => y.id === r1.id).at[1] === 38 * G);
check('nudge-keeps-net', sig() === before && square());

// 4. Copy R1 + R2 + the wire between, paste: new R3/R4 wired together.
ed.selectAll();
key('c', { ctrlKey: true });
check('paste-enabled', !ed.btn.paste.disabled);
ed.cursor = [60 * G, 70 * G];
key('v', { ctrlKey: true });
const refs = Object.values(app.project.components).map((c) => c.ref).sort();
out.refs = refs;
check('pasted-refs', JSON.stringify(refs) === '["C1","C2","R1","R2","R3","R4"]', refs);
const pastedRefs = app.project.schematic.sheets[0].symbols.filter((y) => ed.selection.has(y.id)).map((y) => app.project.components[y.componentId].ref).sort();
check('pasted-selected', JSON.stringify(pastedRefs) === '["C2","R3","R4"]', pastedRefs);
const nets = NL.buildNetlist(app.project).nets.map((n) => n.pins.map((x) => x.ref + '.' + x.pin).sort().join());
check('pasted-net', nets.some((n) => n.includes('R3') && n.includes('R4')), nets);

// 5. Duplicate, delete, undo.
const nComps = Object.keys(app.project.components).length;
key('d', { ctrlKey: true });
check('duplicated', Object.keys(app.project.components).length === nComps + 3, Object.keys(app.project.components).length); // the pasted C2, R3, R4 again
key('Delete');
check('deleted-dup', Object.keys(app.project.components).length === nComps);
key('z', { ctrlKey: true });
check('undo-delete', Object.keys(app.project.components).length === nComps + 3);

// 6. Tidy on release: an S-shaped wire whose middle run collapses becomes one straight run.
key('Escape');
const r5 = put(R, 50, 80), r6 = put(R, 74, 86);
app.edit('s-wire', (pr) => { const sh = pr.schematic.sheets[0]; const a = pin(r5, '2'), b = pin(r6, '1'); S.addWire(pr, sh, [a, [62 * G, a[1]], [62 * G, b[1]], b]); });
const wiresBefore = app.project.schematic.sheets[0].wires.length;
const net56 = () => NL.buildNetlist(app.project).nets.find((n) => n.pins.some((x) => x.ref === app.project.components[r5.componentId].ref))?.pins.map((x) => x.ref + '.' + x.pin).sort().join();
const n0 = net56();
ws.view.view.fit({ x0: 42 * G, y0: 74 * G, x1: 84 * G, y1: 92 * G }, ws.view.w, ws.view.h, 20);
const f6 = scr(r6.at), t6 = scr([r6.at[0], r6.at[1] - 6 * G]);
pe('pointerdown', f6, 1); pe('pointermove', [f6[0], f6[1] - 10], 1); pe('pointermove', t6, 1);
const previewWires = ed.preview.schematic.sheets[0].wires.length;
pe('pointerup', t6, 0);
const after = app.project.schematic.sheets[0].wires.length;
out.tidy = { wiresBefore, previewWires, after };
check('tidied-on-release', after === wiresBefore - 3 + 1, out.tidy); // the three-run S becomes one run
check('tidy-keeps-net', net56() === n0, [net56(), n0]);
check('tidy-same-undo-step', (() => { key('z', { ctrlKey: true }); const back = app.project.schematic.sheets[0].wires.length === wiresBefore; key('z', { ctrlKey: true, shiftKey: true }); return back; })());
return { fails, out };
