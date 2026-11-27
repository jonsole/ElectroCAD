// Context strips journey: the main toolbars no longer carry selection-only buttons; a strip over
// the canvas shows the tool's options or the selection's actions, in every editor. Properties
// open only from a double-click or right-click → Properties…, and close when the selection changes.
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
// every selection strip ends with Properties, which opens the selection's Properties
const propsBtn = (ws) => strip(ws).querySelector('.strip-props');
check('sch-props-button', propsBtn('schematic') === strip('schematic').querySelector('.strip-body').lastElementChild);
propsBtn('schematic').click();
check('sch-props-open', sch.propsOpen && /R1/.test(document.querySelector('.inspector .insp-title')?.textContent));
propsBtn('schematic').click();
check('sch-props-toggle', !sch.propsOpen);
btn('schematic', 'Lock').click();
check('sch-locked-disabled', btn('schematic', 'Locked: unlock to rotate')?.disabled && btn('schematic', 'Locked: unlock to mirror')?.disabled && !btn('schematic', 'Unlock').disabled);
btn('schematic', 'Unlock').click();
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
// nothing selected: the Select tool's own strip, with the Optimise toggle (#104)
check('select-none', !strip('board').hidden && !!strip('board').querySelector('.optimise-toggle') && !strip('board').querySelector('.strip-props'));
const fp = app.project.board.footprints[0];
ed.fpSel = new Set([fp.id]); ed.refresh();
check('fp-strip', !strip('board').hidden && !!btn('board', 'Rotate 90° anticlockwise'), strip('board').textContent);
check('fp-props-button', propsBtn('board') === strip('board').querySelector('.strip-body').lastElementChild);
const step = strip('board').querySelector('select[aria-label="Rotation step"]'); step.value = '45'; step.dispatchEvent(new Event('change'));
btn('board', 'Rotate 45° anticlockwise').click();
check('fp-rot', app.project.board.footprints[0].rot === 45 && localStorage.getItem('electrocad.boardRotStep') === '45', app.project.board.footprints[0].rot);
const ang = strip('board').querySelector('input[aria-label="Angle"]'); ang.value = '30'; ang.dispatchEvent(new Event('change'));
check('fp-angle', app.project.board.footprints[0].rot === 30);
btn('board', 'Flip').click();
check('fp-flip', app.project.board.footprints[0].side === 'B');
btn('board', 'Lock').click();
check('fp-lock', app.project.board.footprints[0].locked === true && btn('board', 'Unlock'));
// locked: what would move it is greyed out, on the strip and the right-click menu
check('fp-locked-disabled', btn('board', 'Locked: unlock to rotate').disabled && btn('board', 'Flip').disabled && strip('board').querySelector('input[aria-label="Angle"]').disabled && !btn('board', 'Unlock').disabled);
{
  const v = app.workspace('board').view, r = v.canvas.getBoundingClientRect(), [sx, sy] = v.view.toScreen(app.project.board.footprints[0].at);
  ed.contextMenu({ clientX: r.left + sx, clientY: r.top + sy });
  const it = (t) => [...document.querySelectorAll('.menu .menu-item')].find((m) => m.textContent.includes(t));
  check('fp-locked-menu', it('Flip')?.classList.contains('disabled') && it('anticlockwise')?.classList.contains('disabled') && !it('Unlock')?.classList.contains('disabled'));
  document.querySelectorAll('.menu').forEach((m) => m.remove());
}
// a track
app.edit('track', (pr) => pr.board.tracks.push({ id: 'tt', a: [MM, MM], b: [5 * MM, MM], width: 250000, layer: 'F.Cu', net: 'A' }));
ed.fpSel.clear(); ed.trackSel = new Set(['tt']); ed.refresh();
check('track-props-button', propsBtn('board') === strip('board').querySelector('.strip-body').lastElementChild);
propsBtn('board').click();
check('track-props-open', ed.cards.card('props').isOpen && /1 track/.test(ed.propsEl.textContent));
const w = strip('board').querySelector('input[aria-label="Width"]'); w.value = '0.4'; w.dispatchEvent(new Event('change'));
check('track-width', app.project.board.tracks[0].width === 400000);
btn('board', 'Delete').click();
check('track-deleted', app.project.board.tracks.length === 0 && !strip('board').querySelector('.strip-props') && !!strip('board').querySelector('.optimise-toggle'));
// right-click a footprint → Properties… opens its Properties; selecting something else closes it
check('props-closed', !ed.cards.card('props').isOpen);
{
  const v = app.workspace('board').view, r = v.canvas.getBoundingClientRect(), [sx, sy] = v.view.toScreen(app.project.board.footprints[0].at);
  ed.contextMenu({ clientX: r.left + sx, clientY: r.top + sy });
  const item = [...document.querySelectorAll('.menu .menu-item')].find((m) => m.textContent.includes('Properties…'));
  check('menu-props', !!item && ed.fpSel.has(app.project.board.footprints[0].id));
  item?.click();
  check('props-open', ed.cards.card('props').isOpen && /Reference/.test(ed.propsEl.textContent));
  ed.fpSel.clear(); ed.refresh(); // the selection changes
  check('props-follow-close', !ed.cards.card('props').isOpen);
}
// the strip moves by its grip (three bars at its left), remembered; double-click puts it back
{
  const st = strip('board'), grip = st.querySelector('.strip-grip');
  ed.fpSel = new Set([app.project.board.footprints[0].id]); ed.refresh();
  const r0 = st.getBoundingClientRect(), g = grip.getBoundingClientRect();
  const pe = (type, x, y) => (type === 'pointerdown' ? grip : window).dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, pointerId: 77 }));
  pe('pointerdown', g.left + 3, g.top + 5); pe('pointermove', g.left + 203, g.top + 125); pe('pointerup', g.left + 203, g.top + 125);
  const r1 = st.getBoundingClientRect();
  check('strip-moved', Math.abs(r1.left - r0.left - 200) < 2 && Math.abs(r1.top - r0.top - 120) < 2 && !!localStorage.getItem('electrocad.strip.board'), [r0.left, r0.top, r1.left, r1.top]);
  ed.setTool('route');
  const rs = document.querySelector('[data-ws="board"] .route-strip').getBoundingClientRect();
  // the routing strip takes the same place, kept inside the canvas (it may be wider than the context strip)
  const rsEl = document.querySelector('[data-ws="board"] .route-strip'), host = rsEl.offsetParent.getBoundingClientRect();
  const wantLeft = Math.min(r1.left, host.left + Math.max(0, host.width - rs.width));
  check('route-strip-follows', Math.abs(rs.left - wantLeft) < 2 && Math.abs(rs.top - r1.top) < 2, [rs.left, rs.top, wantLeft]);
  ed.setTool('select'); ed.fpSel = new Set([app.project.board.footprints[0].id]); ed.refresh();
  grip.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  const r2 = st.getBoundingClientRect();
  check('strip-home', Math.abs(r2.left - r0.left) < 2 && Math.abs(r2.top - r0.top) < 2 && !localStorage.getItem('electrocad.strip.board'));
  ed.fpSel.clear(); ed.refresh();
}
// ---- Library: the Footprint editor's strip shows only in Footprint mode
app.setWorkspace('library'); await raf();
check('lib-toolbar-slim', !document.querySelector('[data-ws="library"] .toolbar button[title="Delete (Del)"]'));
return { fails };
