// Eagle import journey, part 2: the imported Project is saved and opens again after a restart.
const app = window.electrocad;
const fails = [];
const check = (name, cond, info) => { if (!cond) fails.push(name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); };
const [id, tracks] = JSON.parse(localStorage.getItem('smoke.eagle') || '[]');
check('same-project', app.project.id === id && app.project.name === 'regulator', app.project.name);
check('tracks', app.project.board.tracks.length === tracks);
check('sheets', app.project.schematic.sheets.length === 2);
return { fails };
