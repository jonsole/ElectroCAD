// Colour themes journey, part 2: the chosen and custom themes survive a restart.
const app = window.electrocad;
const fails = [];
const check = (name, cond, info) => { if (!cond) fails.push(name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); };
const custom = (app.settings.customThemes || []).find((t) => t.name === 'Classic paper (copy)');
check('custom-kept', !!custom && app.settings.colorThemes.schematic === custom.id, app.settings.colorThemes);
const ws = app.workspace('schematic');
ws.view.draw();
const [sx, sy] = ws.view.view.toScreen([148.8e6, 105.3e6]);
const d = ws.view.ctx.getImageData(Math.round(sx * ws.view.dpr), Math.round(sy * ws.view.dpr), 1, 1).data;
const hex = '#' + [d[0], d[1], d[2]].map((x) => x.toString(16).padStart(2, '0')).join('');
check('paper-after-restart', hex === '#fff8e0', hex);
return { fails };
