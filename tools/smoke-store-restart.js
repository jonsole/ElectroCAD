// Project store journey, part 2: a fresh app process on the same app data reopens the last
// Project, and Your projects lists everything that was saved.
const app = window.electrocad;
const native = window.electroNative;
const fails = [];
const check = (name, cond, info) => { if (!cond) fails.push(name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); };
const l = await native.listProjects();
check('reopened-last', app.nameInput.value === 'Beta' && app.project.id === localStorage.getItem('smoke.betaId'), [app.nameInput.value, app.project.id]);
check('three-projects', l.length === 3 && l.filter((m) => m.name === 'Alpha').length === 2, l.map((m) => m.name));
await app.projects.show();
const cards = [...document.querySelectorAll('.dash-card:not(.dash-new)')];
check('cards', cards.length === 3 && cards.filter((c) => c.classList.contains('current')).length === 1, cards.length);
return { fails };
