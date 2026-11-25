// Eagle import journey, part 2: the imported Project is saved and opens again after a restart.
const app = window.electrocad;
const fails = [];
const check = (name, cond, info) => { if (!cond) fails.push(name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); };
const [id, tracks] = JSON.parse(localStorage.getItem('smoke.eagle') || '[]');
check('same-project', app.project.id === id && app.project.name === 'regulator', app.project.name);
check('tracks', app.project.board.tracks.length === tracks);
check('sheets', app.project.schematic.sheets.length === 2);
// the last import's log is kept: Import → Show the last import log
app.importBtn.click();
await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
const item = [...document.querySelectorAll('.menu .menu-item')].find((b) => /Show the last import log/.test(b.textContent));
check('menu-item', item && item.getAttribute('aria-disabled') !== 'true');
item?.click();
await new Promise((r) => requestAnimationFrame(r));
const pre = document.querySelector('.import-log .import-log-text');
check('log-shown', pre && /ElectroCAD import log/.test(pre.textContent) && /DRC: 0 errors/.test(pre.textContent), pre?.textContent?.slice(0, 200));
return { fails };
