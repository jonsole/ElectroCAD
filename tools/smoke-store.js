// Project store journey, part 1 (ticket #6): create, rename, duplicate, delete, export and import.
// Part 2 (smoke-store-restart.js) runs in a new app process on the same app data.
const app = window.electrocad;
const { project: P, units: U } = window.electrocadLib;
const native = window.electroNative;
const fails = [];
const out = {};
const check = (name, cond, info) => { if (!cond) fails.push(name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const list = async () => (await native.listProjects()).sort((a, b) => a.name.localeCompare(b.name));

// First run: a new Project exists and is already in the store.
await wait(300);
let l = await list();
check('first-run-project', l.length === 1 && l[0].id === app.project.id, l);
check('saved-state', app.saveState.textContent === 'All changes saved', app.saveState.textContent);

// Rename through the top bar: autosaves after a short pause.
app.nameInput.value = 'Alpha'; app.nameInput.dispatchEvent(new Event('change'));
check('unsaved-until-autosave', app.saveState.textContent === 'Unsaved changes', app.saveState.textContent);
await wait(2200);
l = await list();
check('autosaved', l.some((m) => m.name === 'Alpha') && app.saveState.textContent === 'All changes saved', [l.map((m) => m.name), app.saveState.textContent]);
check('thumbnail', /^data:image\/png;base64,/.test(l[0].thumb || ''), (l[0].thumb || '').slice(0, 30));

// Some content so the card counts and the round trip mean something.
const part = { id: 'smoke-r', name: 'Resistor', prefix: 'R', defaultValue: '10k',
  units: [{ name: 'A', graphics: [], pins: [] }], footprints: {}, pinMap: {} };
P.addComponent(app.project, app.project.schematic.sheets[0], part, [U.mm(20), U.mm(20)]);
app.markDirty();
await app.saveNow();
const alphaId = app.project.id;

// Your projects screen opens from the logo.
document.querySelector('.topbar .logo').click();
await wait(400);
check('home-open', app.projects.isOpen);
const cards = () => [...document.querySelectorAll('.dash-card:not(.dash-new)')];
check('one-card', cards().length === 1 && /1 component · 2-layer/.test(cards()[0].textContent), cards().map((c) => c.textContent));
check('current-outlined', cards()[0].classList.contains('current'));

// Create a second project from the dashed card; rename it.
document.querySelector('.dash-new').click();
await wait(500);
check('new-closes-home', !app.projects.isOpen);
check('second-project', app.project.id !== alphaId && (await list()).length === 2, (await list()).length);
await app.renameStored(app.project.id, 'Beta');
check('renamed-open', app.nameInput.value === 'Beta');

// Duplicate Alpha, then delete the duplicate.
const copy = await app.duplicateStored(alphaId);
l = await list();
check('duplicate', l.some((m) => m.name === 'Alpha (copy)' && m.components === 1), l.map((m) => m.name));
await app.deleteStored(copy.id);
l = await list();
check('deleted', l.length === 2 && !l.some((m) => m.id === copy.id), l.map((m) => m.name));

// Open Alpha from its card.
await app.projects.show();
await wait(300);
cards().find((c) => c.dataset.id === alphaId).click();
await wait(400);
check('opened-from-card', app.project.id === alphaId && app.nameInput.value === 'Alpha' && Object.keys(app.project.components).length === 1);

// Export Alpha to a file, then import it: a separate Project with the same content.
const dir = '/tmp';
const file = `${dir}/electrocad-smoke-${Date.now()}.ecad`;
await native.smokeDialog(file);
check('export', await app.exportFile());
await native.smokeDialog(file);
check('import', await app.importFile());
const imported = app.project;
check('import-new-id', imported.id !== alphaId && imported.name === 'Alpha' && Object.keys(imported.components).length === 1, imported.id);
check('import-stored', (await list()).length === 3);

// A newer-version file is refused, an unreadable one too, and nothing changes.
const future = JSON.parse(P.serialize(imported)); future.version = P.VERSION + 1;
const newerFile = `${dir}/electrocad-smoke-newer-${Date.now()}.ecad`;
await native.smokeDialog(newerFile);
await native.exportFile('x.ecad', JSON.stringify(future)); // writes the queued path
const before = P.serialize(app.project);
const count = (await native.listProjects()).length;
await native.smokeDialog(newerFile);
check('newer-refused', (await app.importFile()) === false);
const toasts = [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | ');
check('newer-message', /newer version of ElectroCAD/.test(toasts), toasts.slice(-200));
await native.smokeDialog(`${dir}/does-not-exist-${Date.now()}.ecad`);
check('unreadable-refused', (await app.importFile()) === false);
check('cancel', (await app.importFile()) === false); // empty queue = cancelled dialog
check('unchanged', P.serialize(app.project) === before && (await native.listProjects()).length === count);

// Leave Beta open for the restart check.
const beta = (await list()).find((m) => m.name === 'Beta');
await app.openStored(beta.id);
out.lastProject = beta.id;
localStorage.setItem('smoke.betaId', beta.id);
await app.saveNow();
return { fails, out };
