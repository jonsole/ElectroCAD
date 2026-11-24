// Markup journey, part 2: after a restart the markup, paper and title block are back.
const app = window.electrocad;
const fails = [];
const check = (name, cond, info) => { if (!cond) fails.push(name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); };
const s = app.project.schematic.sheets[0];
check('drawings', JSON.stringify(s.drawings.map((d) => d.type).sort()) === localStorage.getItem('smoke.markup'), s.drawings.map((d) => d.type));
check('paper', s.paper.size === 'A3' && s.paper.orientation === 'portrait');
check('title', app.project.titleBlock.title === 'Smoke board');
check('frame', app.workspace('schematic').view.frame.y1 === 420e6);
return { fails };
