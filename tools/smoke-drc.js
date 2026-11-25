// DRC journey (#25): the DRC button waits for zone fills, then lists the problems with markers;
// clicking one zooms to it and selects what it's about; fixing it and running again clears it.
const app = window.electrocad;
const fails = [];
const check = (name, cond, info) => { if (!cond) fails.push(name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); };
const L = window.electrocadLib, G = 1270000, MM = 1e6;
const part = (n) => app.workspace('schematic').editor.parts.find((x) => x.name === n);
app.edit('demo', (pr) => {
  const s = pr.schematic.sheets[0];
  const rs = [0, 1].map((i) => L.project.addComponent(pr, s, part('Resistor'), [G * (20 + i * 20), G * 20]).comp);
  const pin = (c, n) => { const y = s.symbols.find((q) => q.componentId === c.id); return L.project.pinPositions(pr, y).find((x) => x.pin.number === n).at; };
  L.schematic.addLabel(pr, s, { at: pin(rs[0], '2'), net: 'SIG', style: 'label', scope: 'local' });
  L.schematic.addLabel(pr, s, { at: pin(rs[1], '1'), net: 'SIG', style: 'label', scope: 'local' });
  pr.board.outline = [{ type: 'rect', a: [0, 0], b: [30e6, 20e6], layer: 'Edge.Cuts' }];
});
app.setWorkspace('board');
await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
const ws = app.workspace('board'), ed = ws.editor;
ed.annotate();
[...document.querySelectorAll('.annotate-modal button')].find((b) => b.textContent === 'Apply').click();
app.edit('place', (pr) => {
  const f = (ref) => pr.board.footprints.find((x) => pr.components[x.componentId].ref === ref);
  f('R1').at = [6 * MM, 6 * MM]; f('R2').at = [20 * MM, 6 * MM];
  pr.board.tracks.push({ id: 'sig', a: [6.9125 * MM, 6 * MM], b: [19.0875 * MM, 6 * MM], width: 250000, layer: 'F.Cu', net: 'SIG' });
  pr.board.tracks.push({ id: 'near', a: [10 * MM, 6.35 * MM], b: [16 * MM, 6.35 * MM], width: 250000, layer: 'F.Cu', net: 'X' });
  // a zone, refilling as DRC starts
  pr.board.zones.push({ id: 'zz', layer: 'B.Cu', net: '', outline: [[MM, MM], [29 * MM, MM], [29 * MM, 19 * MM], [MM, 19 * MM]], priority: 0, clearance: 0, connect: 'thermal', thermal: { gap: 500000, spoke: 500000 } });
});
check('zone-pending', ed.zoneFiller.busy);
[...document.querySelectorAll('[data-ws="board"] .toolbar button')].find((b) => b.textContent.trim() === 'DRC').click();
const t0 = Date.now();
while (!ed.drc && Date.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 50));
check('ran', !!ed.drc && !ed.zoneFiller.busy && ed.zoneFiller.fills.has('zz'), ed.drc && ed.drc.list.length);
const card = document.querySelector('[data-ws="board"] [data-card="drc"]');
check('card', card && card.style.display !== 'none' && /1 error/.test(card.textContent), card?.textContent.slice(0, 120));
const rows = [...card.querySelectorAll('.erc-row')];
check('rows', rows.length === 1 && rows[0].dataset.rule === 'clearance', rows.map((r) => r.dataset.rule));
// clicking zooms to it and selects both tracks
const before = ws.view.view.scale;
rows[0].click();
check('zoomed', ws.view.view.scale > before && ed.drcFocus === ed.drc.list[0].id, [before, ws.view.view.scale]);
check('selected', ed.trackSel.has('sig') && ed.trackSel.has('near'), [...ed.trackSel]);
// what is drawn for it (#80): both tracks, the 0.1 mm gap between their edges, the clearance needed
const v0 = ed.drc.list[0];
check('show', v0.show?.shapes?.length === 2 && Math.abs(v0.show.gap.d - 100000) < 5 && v0.show.need > v0.show.gap.d, v0.show);
// the highlight is drawn: the board darkens round it (a pixel far from the pair is dimmer than before)
const px = () => { const c = ws.view.canvas, g = c.getContext('2d'); const d = g.getImageData(Math.round(c.width * 0.12), Math.round(c.height * 0.5), 1, 1).data; return d[0] + d[1] + d[2]; };
ws.view.draw(); const lit = px();
ed.drcFocus = null; ed.drcHover = null; ws.view.draw(); const plain = px();
check('dimmed', lit < plain, [lit, plain]);
// hovering a row previews it
rows[0].dispatchEvent(new MouseEvent('mouseenter'));
check('hover', ed.drcHover === v0.id);
rows[0].dispatchEvent(new MouseEvent('mouseleave'));
check('hover-off', ed.drcHover === null);
ed.drcFocus = v0.id;
// live (#85): moving the track away clears the problem at once, without Run again
app.edit('fix', (pr) => { pr.board.tracks.find((t) => t.id === 'near').a[1] += 1000000; pr.board.tracks.find((t) => t.id === 'near').b[1] += 1000000; });
check('fixed-live', ed.drc.list.length === 0 && /No problems/.test(card.textContent), ed.drc.list.map((v) => v.message));
check('focus-cleared', ed.drcFocus === null);
// moving it back (undo) brings it back, as soon as the zone under it has refilled
app.undo();
check('back-live', ed.drc.list.some((v) => v.rule === 'clearance' && v.items.includes('near')), ed.drc.list.map((v) => v.message));
await ed.whenZonesFilled(); await new Promise((r) => setTimeout(r, 50));
check('back-after-fill', ed.drc.list.filter((v) => v.rule === 'clearance').length === 1, ed.drc.list.map((v) => v.message));
// the background full run agrees
await new Promise((r) => setTimeout(r, 2500));
check('full-agrees', ed.drc.list.filter((v) => v.rule === 'clearance').length === 1 && !/Re-checking/.test(card.textContent), [ed.drc.list.map((v) => v.message), card.textContent.slice(0, 120)]);
// deleting the track clears it again
app.edit('delete', (pr) => { pr.board.tracks = pr.board.tracks.filter((t) => t.id !== 'near'); });
check('clean', ed.drc.list.length === 0 && /No problems/.test(card.textContent), ed.drc.list.map((v) => v.message));
return { fails };
