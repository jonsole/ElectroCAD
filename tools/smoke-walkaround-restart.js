// After a restart (#22): the routing mode chosen last time (Free) is still chosen.
const app = window.electrocad;
const fails = [];
const check = (name, cond, info) => { if (!cond) fails.push(name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); };
app.setWorkspace('board');
await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
const ed = app.workspace('board').editor;
const group = document.querySelector('[data-ws="board"] .mode-group');
check('remembered', ed.routeMode === 'free' && group.querySelector('[data-mode="free"]').classList.contains('active') && !group.querySelector('[data-mode="walkaround"]').classList.contains('active'));
return { fails };
