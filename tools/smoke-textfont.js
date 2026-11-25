// Text font journey (#79): the schematic's and the board's text font are Project settings. Sheet setup
// picks system or vector for every sheet (Print starts from it; undo puts it back); Board setup picks
// the board's stroke or Eagle vector metrics.
const app = window.electrocad;
const fails = [];
const check = (name, cond, info) => { if (!cond) fails.push(name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const modal = () => document.querySelector('.modal');
const ed = app.workspace('schematic').editor;
check('new-project-system', !app.project.schematic.textFont && !app.project.board.textFont);
// Sheet setup -> vector
ed.sheetSetup();
await wait(100);
const font = modal().querySelector('select[aria-label="Text font"]');
check('sheet-font-shown', font && font.value === 'system', font?.value);
font.value = 'vector';
[...modal().querySelectorAll('button')].find((b) => b.textContent === 'Apply').click();
await wait(100);
check('schematic-vector', app.project.schematic.textFont === 'vector', app.project.schematic.textFont);
// Print starts from the Project's font
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true }));
await wait(200);
check('print-follows', document.querySelector('.print-modal select[aria-label="Text"]')?.value === 'vector');
document.querySelector('.print-modal')?.closest('.modal-backdrop, .modal-overlay')?.remove?.();
[...document.querySelectorAll('.print-modal button')].find((b) => /Cancel|Close/.test(b.textContent))?.click();
await wait(100);
// undo puts the system font back
app.history.undo();
await wait(50);
check('undo', !app.project.schematic.textFont, app.project.schematic.textFont);
// Board setup -> Eagle vector
app.setWorkspace('board');
app.workspace('board').editor.setup();
await wait(150);
const bfont = document.querySelector('.board-setup select[aria-label="Text font"]');
check('board-font-shown', bfont && bfont.value === 'stroke', bfont?.value);
bfont.value = 'vector'; bfont.dispatchEvent(new Event('change'));
await wait(100);
check('board-vector', app.project.board.textFont === 'vector', app.project.board.textFont);
document.querySelector('.board-setup select[aria-label="Text font"]').scrollIntoView();
return { fails };
