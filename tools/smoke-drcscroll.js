// DRC list scrolling: with more problems than the card shows, clicking one far down keeps the list
// where it was (it used to jump back to the top on every click).
const app = window.electrocad;
const fails = [];
const check = (name, cond, info) => { if (!cond) fails.push(name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const MM = 1e6;
app.edit('demo', (pr) => {
  pr.board.outline = [{ type: 'rect', a: [0, 0], b: [60e6, 60e6], layer: 'Edge.Cuts' }];
  // 30 pairs of tracks of different nets 0.1 mm apart: 30 clearance errors
  for (let i = 0; i < 30; i++) {
    const y = (2 + i * 1.8) * MM;
    pr.board.tracks.push({ id: `a${i}`, a: [5 * MM, y], b: [20 * MM, y], width: 250000, layer: 'F.Cu', net: `A${i}` });
    pr.board.tracks.push({ id: `b${i}`, a: [5 * MM, y + 350000], b: [20 * MM, y + 350000], width: 250000, layer: 'F.Cu', net: `B${i}` });
  }
});
app.setWorkspace('board');
await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
const ed = app.workspace('board').editor;
await ed.runDrc();
await wait(100);
const list = () => document.querySelector('[data-ws="board"] .drc-list');
const rows = () => [...list().querySelectorAll('.erc-row')];
check('many', rows().length >= 30, rows().length);
check('scrolls', list().scrollHeight > list().clientHeight + 50, [list().scrollHeight, list().clientHeight]);
list().scrollTop = list().scrollHeight; // to the bottom
await wait(50);
const before = list().scrollTop;
const last = rows()[rows().length - 1];
last.click();
await wait(100);
check('kept', list().scrollTop > before - 40 && list().scrollTop > 0, [before, list().scrollTop]);
const inView = () => { const on = list().querySelector('.erc-row.on'); if (!on) return false; const r = on.getBoundingClientRect(), b = list().getBoundingClientRect(); return r.top >= b.top - 1 && r.bottom <= b.bottom + 1; };
check('focused-in-view', inView());
// clicking another row near the top after scrolling up keeps that place too
list().scrollTop = 0; await wait(50);
rows()[1].click(); await wait(100);
check('kept-top', list().scrollTop < 40 && inView(), list().scrollTop);
return { fails };
