// DRC approvals (#69): approve a problem from the DRC card with a note; it hides and stops
// counting, the "1 approved" chip shows it again with Unapprove; undo; moving one of its tracks
// brings it back.
const app = window.electrocad;
const fails = [];
const check = (name, cond, info) => { if (!cond) fails.push(name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const MM = 1e6;
app.edit('demo', (pr) => {
  pr.board.outline = [{ type: 'rect', a: [0, 0], b: [40e6, 30e6], layer: 'Edge.Cuts' }];
  pr.board.tracks.push({ id: 'a1', a: [5 * MM, 10 * MM], b: [20 * MM, 10 * MM], width: 250000, layer: 'F.Cu', net: 'A' });
  pr.board.tracks.push({ id: 'b1', a: [5 * MM, 10.35 * MM], b: [20 * MM, 10.35 * MM], width: 250000, layer: 'F.Cu', net: 'B' });
  pr.board.tracks.push({ id: 'a2', a: [5 * MM, 20 * MM], b: [20 * MM, 20 * MM], width: 250000, layer: 'F.Cu', net: 'A' });
  pr.board.tracks.push({ id: 'b2', a: [5 * MM, 20.35 * MM], b: [20 * MM, 20.35 * MM], width: 250000, layer: 'F.Cu', net: 'B' });
});
app.setWorkspace('board');
await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
const ed = app.workspace('board').editor;
await ed.runDrc();
await wait(100);
const card = () => document.querySelector('[data-ws="board"] .drc-list').parentElement;
const rows = () => [...document.querySelectorAll('[data-ws="board"] .drc-list .erc-row')];
const sum = () => document.querySelector('[data-ws="board"] .drc-sum')?.textContent || '';
check('two', rows().length === 2 && /2 errors/.test(sum()), sum());
// approve the first, with a note
rows()[0].querySelector('button[title^="Approve"]').click();
await wait(50);
const note = document.querySelector('.modal textarea[aria-label="Note"]');
check('note-box', !!note);
note.value = 'Fine as built';
[...document.querySelectorAll('.modal button')].find((b) => b.textContent.trim() === 'Approve').click();
await wait(100);
check('approved', app.project.board.drcApprovals?.length === 1 && app.project.board.drcApprovals[0].note === 'Fine as built', app.project.board.drcApprovals);
check('hidden', rows().length === 1 && /1 error\b/.test(sum()), [rows().length, sum()]);
const chip = () => document.querySelector('[data-ws="board"] .erc-chip-approved');
check('chip', chip() && /1 approved/.test(chip().textContent));
// show approved: the row is back, dimmed, with its note and Unapprove
chip().click(); await wait(50);
const ap = rows().find((r) => r.classList.contains('approved'));
check('shown', rows().length === 2 && ap && /Fine as built/.test(ap.textContent) && /Unapprove/.test(ap.textContent));
// undo the approval, redo it
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
await wait(100);
check('undo', !app.project.board.drcApprovals && /2 errors/.test(sum()), sum());
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true }));
await wait(100);
check('redo', app.project.board.drcApprovals?.length === 1);
// move one of its tracks: the approval lapses and the problem counts again
const approvedItems = app.project.board.drcApprovals[0].items;
app.edit('move', (p) => { const t = p.board.tracks.find((x) => x.id === approvedItems[0]); t.a = [t.a[0] + 1 * MM, t.a[1]]; });
await wait(300);
ed.renderDrc();
check('lapsed', /2 errors/.test(sum()) && !document.querySelector('[data-ws="board"] .erc-chip-approved'), sum());
// Unapprove from the card
await ed.runDrc(); await wait(50);
rows()[0].querySelector('button[title^="Approve"]').click(); await wait(50);
[...document.querySelectorAll('.modal button')].find((b) => b.textContent.trim() === 'Approve').click(); await wait(100);
if (!ed.drcShowApproved) chip().click();
await wait(50);
[...rows().find((r) => r.classList.contains('approved')).querySelectorAll('button')].find((b) => /Unapprove/.test(b.textContent)).click();
await wait(100);
check('unapproved', /2 errors/.test(sum()) && !rows().some((r) => r.classList.contains('approved')), sum());
void card;
return { fails };
