// Board journey, part 2: after a restart the stack, the Outline and hidden layers are back.
const app = window.electrocad;
const fails = [];
const check = (name, cond, info) => { if (!cond) fails.push(name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); };
const b = app.project.board;
check('stack', b.stack.copper === 4);
check('grid-origin', b.grid.main === 1e6 && b.origin[1] === 3e6 && app.workspace('board').view.grid === 1e6, [b.grid, b.origin]);
check('outline', JSON.stringify(b.outline) === localStorage.getItem('smoke.board'), b.outline.length);
const ed = app.workspace('board').editor;
check('hidden-pref', ed.hidden.has('B.SilkS') && !ed.hidden.has('F.Cu'), [...ed.hidden]);
app.setWorkspace('board');
check('state', /Outline closed/.test(document.querySelector('[data-ws="board"] .outline-state').textContent));
return { fails };
