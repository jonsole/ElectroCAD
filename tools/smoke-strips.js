// Context strips journey: the main toolbars no longer carry selection-only buttons; a strip over
// the canvas shows the tool's options or the selection's actions, in every editor.
const app = window.electrocad;
const fails = [];
const check = (name, cond, info) => { if (!cond) fails.push(name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); };
const L = window.electrocadLib, G = 1270000, MM = 1e6;
const strip = (ws) => document.querySelector(`[data-ws="${ws}"] .context-strip`);
const btn = (ws, title) => [...strip(ws).querySelectorAll('button')].find((b) => (b.title || '').startsWith(title) || b.textContent.trim() === title);
const raf = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
// ---- Schematic: a part selected
const sch = app.workspace('schematic').editor;
const part = (n) => sch.parts.find((x) => x.name === n);
app.edit('demo', (pr) => { const s = pr.schematic.sheets[0]; L.project.addComponent(pr, s, part('Resistor'), [G * 20, G * 20]); L.project.addComponent(pr, s, part('Resistor'), [G * 40, G * 20]); });
app.setWorkspace('schematic'); await raf();
check('sch-toolbar-slim', !document.querySelector('[data-ws="schematic"] .toolbar button[title="Delete (Del)"]') && !document.querySelector('[data-ws="schematic"] .toolbar button[title="Rotate (R)"]'));
check('sch-hidden', strip('schematic').hidden);
const y = app.project.schematic.sheets[0].symbols[0];
sch.selection = new Set([y.id]); sch.refresh();
check('sch-shown', !strip('schematic').hidden && /R1/.test(strip('schematic').textContent), strip('schematic').textContent);
btn('schematic', 'Rotate 90°').click();
check('sch-rotated', app.project.schematic.sheets[0].symbols[0].rot === 90, app.project.schematic.sheets[0].symbols[0].rot);
btn('schematic', 'Delete').click();
check('sch-deleted', app.project.schematic.sheets[0].symbols.length === 1 && strip('schematic').hidden);
// ---- Board: tools and selections
app.edit('outline', (pr) => { pr.board.outline = [{ type: 'rect', a: [0, 0], b: [30e6, 20e6], layer: 'Edge.Cuts' }]; });
app.setWorkspace('board'); await raf();
const ed = app.workspace('board').editor;
ed.annotate();
[...document.querySelectorAll('.annotate-modal button')].find((b) => b.textContent === 'Apply').click();
check('board-toolbar-slim', !document.querySelector('[data-ws="board"] .toolbar button[title^="Rotate"]') && !document.querySelector('[data-ws="board"] .toolbar button[title^="Flip"]'));
ed.setTool('outline');
check('rect-strip', /Rectangle/.test(strip('board').textContent) && !!strip('board').querySelector('input[aria-label="Corner radius"]'));
ed.setTool('zone');
check('zone-strip', /Zone/.test(strip('board').textContent) && !!strip('board').querySelector('select[aria-label="Net"]'));
ed.setTool('route');
check('route-own-strip', strip('board').hidden && !document.querySelector('[data-ws="board"] .route-strip').hidden);
ed.setTool('select');
check('select-none', strip('board').hidden);
const fp = app.project.board.footprints[0];
ed.fpSel = new Set([fp.id]); ed.refresh();
check('fp-strip', !strip('board').hidden && !!btn('board', 'Rotate 90° anticlockwise'), strip('board').textContent);
const step = strip('board').querySelector('select[aria-label="Rotation step"]'); step.value = '45'; step.dispatchEvent(new Event('change'));
btn('board', 'Rotate 45° anticlockwise').click();
check('fp-rot', app.project.board.footprints[0].rot === 45 && localStorage.getItem('electrocad.boardRotStep') === '45', app.project.board.footprints[0].rot);
const ang = strip('board').querySelector('input[aria-label="Angle"]'); ang.value = '30'; ang.dispatchEvent(new Event('change'));
check('fp-angle', app.project.board.footprints[0].rot === 30);
btn('board', 'Flip').click();
check('fp-flip', app.project.board.footprints[0].side === 'B');
btn('board', 'Lock').click();
check('fp-lock', app.project.board.footprints[0].locked === true && btn('board', 'Unlock'));
// a track
app.edit('track', (pr) => pr.board.tracks.push({ id: 'tt', a: [MM, MM], b: [5 * MM, MM], width: 250000, layer: 'F.Cu', net: 'A' }));
ed.fpSel.clear(); ed.trackSel = new Set(['tt']); ed.refresh();
const w = strip('board').querySelector('input[aria-label="Width"]'); w.value = '0.4'; w.dispatchEvent(new Event('change'));
check('track-width', app.project.board.tracks[0].width === 400000);
btn('board', 'Delete').click();
check('track-deleted', app.project.board.tracks.length === 0 && strip('board').hidden);
// ---- Library: the Footprint editor's strip shows only in Footprint mode
app.setWorkspace('library'); await raf();
check('lib-toolbar-slim', !document.querySelector('[data-ws="library"] .toolbar button[title="Delete (Del)"]'));
return { fails };
