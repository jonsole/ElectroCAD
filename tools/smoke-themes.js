// Colour themes journey (#51), part 1. Part 2 (smoke-themes-restart.js) checks they persist.
const app = window.electrocad;
const native = window.electroNative;
const fails = [];
const out = {};
const check = (name, cond, info) => { if (!cond) fails.push(name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const pixel = (ws, world) => {
  const v = ws.view; v.draw();
  const [sx, sy] = v.view.toScreen(world);
  const d = v.ctx.getImageData(Math.round(sx * v.dpr), Math.round(sy * v.dpr), 1, 1).data;
  return '#' + [d[0], d[1], d[2]].map((x) => x.toString(16).padStart(2, '0')).join('');
};
const sch = app.workspace('schematic');
const sheetMid = [148.5e6 + 0.3e6, 105e6 + 0.3e6]; // between grid lines
const before = pixel(sch, sheetMid);
check('match-app-dark', before === app.canvasColors('schematic').paper, [before, app.canvasColors('schematic').paper]);

// Settings → Colours: pick Classic paper for the Schematic.
app.settingsDialog();
await wait(100);
const schSel = document.querySelector('select[data-kind="schematic"]');
check('selects', !!schSel && !!document.querySelector('select[data-kind="board"]'));
check('builtins', [...schSel.options].map((o) => o.textContent).join('|') === 'Match app|Classic paper', [...schSel.options].map((o) => o.textContent));
schSel.value = 'classic-paper'; schSel.dispatchEvent(new Event('change'));
out.paper = pixel(sch, sheetMid);
check('classic-paper-white', out.paper === '#ffffff', out.paper);
check('ui-still-dark', document.documentElement.dataset.theme === 'dark');

// Duplicate Classic paper, edit the paper colour in the editor, save.
document.querySelector('.theme-row .btn-outline').click(); // Duplicate (first row = Schematic)
await wait(100);
const paperInput = document.querySelector('.theme-editor input[data-token="paper"]');
check('editor-open', !!paperInput);
paperInput.value = '#fff8e0'; paperInput.dispatchEvent(new Event('input'));
[...document.querySelectorAll('.theme-editor .btn-primary')].find((b) => b.textContent === 'Save').click();
await wait(100);
const custom = (app.settings.customThemes || []).find((t) => t.name === 'Classic paper (copy)');
check('custom-saved', !!custom && custom.colors.paper === '#fff8e0', app.settings.customThemes);
check('custom-chosen', app.settings.colorThemes.schematic === custom?.id, app.settings.colorThemes);
out.customPaper = pixel(sch, sheetMid);
check('custom-paper-drawn', out.customPaper === '#fff8e0', out.customPaper);
const stored = await native.getSettings();
check('persisted', stored.colorThemes?.schematic === custom?.id && (stored.customThemes || []).length === 1, stored.colorThemes);

// Board: duplicate Match app, recolour F.Cu, check the layer chip follows.
const boardRow = document.querySelectorAll('.theme-row')[1];
boardRow.querySelector('.btn-outline').click();
await wait(100);
const fcu = document.querySelector('.theme-editor input[data-token="F.Cu"]');
fcu.value = '#00ff00'; fcu.dispatchEvent(new Event('input'));
[...document.querySelectorAll('.theme-editor .btn-primary')].find((b) => b.textContent === 'Save').click();
await wait(100);
const chip = app.workspace('board').chipStrip.querySelector('.chip');
check('board-chip-recoloured', getComputedStyle(chip).backgroundColor === 'rgb(0, 255, 0)', getComputedStyle(chip).backgroundColor);

// Export the board theme, then import it back as a new theme; a bad file is refused.
const dir = '/tmp';
const file = `${dir}/electrocad-theme-${Date.now()}.json`;
await native.smokeDialog(file);
[...document.querySelectorAll('.theme-row')[1].querySelectorAll('button')].find((b) => b.title.startsWith('Export')).click();
await wait(300);
await native.smokeDialog(file);
[...document.querySelectorAll('.theme-row')[1].querySelectorAll('button')].find((b) => b.title.startsWith('Import')).click();
await wait(300);
const boards = (app.settings.customThemes || []).filter((t) => t.kind === 'board');
check('imported', boards.length === 2 && boards[1].colors['F.Cu'] === '#00ff00', boards.map((t) => t.name));
const bad = `${dir}/electrocad-badtheme-${Date.now()}.json`;
await native.smokeDialog(bad);
await native.exportFile('bad.json', JSON.stringify({ format: 'electrocad-theme', version: 1, kind: 'board', colors: { 'F.Cu': 'reddish' } }), 'theme');
await native.smokeDialog(bad);
[...document.querySelectorAll('.theme-row')[1].querySelectorAll('button')].find((b) => b.title.startsWith('Import')).click();
await wait(300);
const toasts = [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | ');
check('bad-refused', /F\.Cu must be a colour/.test(toasts) && (app.settings.customThemes || []).filter((t) => t.kind === 'board').length === 2, toasts.slice(-200));

// Built-ins are read-only: with Match app chosen, Edit and Delete are disabled.
const bsel = document.querySelector('select[data-kind="board"]');
bsel.value = 'match-app'; bsel.dispatchEvent(new Event('change'));
await wait(50);
const brow = document.querySelectorAll('.theme-row')[1];
const editBtn = [...brow.querySelectorAll('button')].find((b) => b.textContent === 'Edit');
check('builtin-readonly', editBtn.disabled, editBtn.outerHTML);
document.querySelector('.modal .btn-ghost[aria-label="Close"]')?.click();
return { fails, out };
