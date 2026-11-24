// Save / reopen journey (ticket #3), run inside the real app:  npm run test:smoke -- smoke-save.js
// Dialogs are answered through the smoke-only queue instead of clicking.
const app = window.electrocad;
const { project: P, units: U } = window.electrocadLib;
const native = window.electroNative;
const fails = [];
const out = {};
const check = (name, cond, info) => { if (!cond) fails.push(name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); };
const dir = window.__smokeDir || '/tmp';
const file = `${dir}/electrocad-smoke-${Date.now()}.ecad`;
const newer = `${dir}/electrocad-smoke-newer-${Date.now()}.ecad`;

check('starts-unsaved', app.saveState.textContent === 'Not saved yet', app.saveState.textContent);

// Give the Project some content: a name, two Units of one Component, a Wire and a Global label.
app.nameInput.value = 'Smoke project';
app.nameInput.dispatchEvent(new Event('change'));
check('dirty-after-rename', app.file.dirty && app.saveState.textContent === 'Unsaved changes', app.saveState.textContent);
const part = {
  id: 'smoke-opamp', name: 'Dual op-amp', prefix: 'U', defaultValue: 'LM358', origin: null,
  units: [
    { name: 'A', graphics: [], pins: [{ number: '1', name: 'OUT', at: [U.mm(7.62), 0], dir: 'L', length: U.mm(2.54), type: 'output' }] },
    { name: 'B', graphics: [], pins: [{ number: '8', name: 'V+', at: [0, -U.mm(5.08)], dir: 'D', length: U.mm(2.54), type: 'power_in' }] },
  ],
  footprints: { 'SOIC-8': { name: 'SOIC-8', pads: [], graphics: [] } }, pinMap: { 'SOIC-8': { 1: '1', 8: '8' } },
};
const sheet = app.project.schematic.sheets[0];
const { comp } = P.addComponent(app.project, sheet, part, [U.mm(50), U.mm(50)]);
P.addComponent(app.project, sheet, part, [U.mm(90), U.mm(50)], { component: comp, unit: 1 });
comp.mpn = { manufacturer: 'TI', number: 'LM358DR' };
sheet.wires.push({ id: 'w1', a: [U.mm(10), U.mm(10)], b: [U.mm(30), U.mm(10)] });
sheet.labels.push({ id: 'l1', at: [U.mm(30), U.mm(10)], rot: 0, net: '+5V', scope: 'global', style: 'power' });
const before = P.serialize(app.project);

// Save: the first save asks where (answered by the queue), then saves in place.
await native.smokeDialog(file);
check('save', await app.saveProject(), 'saveProject returned false');
check('saved-state', !app.file.dirty && app.saveState.textContent === 'Saved' && app.file.path === file, [app.saveState.textContent, app.file.path]);
check('title', document.title.startsWith('Smoke project'), document.title);
app.markDirty();
check('save-in-place', await app.saveProject(), 'second save failed (should not need a dialog)');

// New project, then reopen the file: identical content.
check('new', await app.newProject({ force: true }));
check('new-is-empty', Object.keys(app.project.components).length === 0 && app.nameInput.value === 'Untitled');
await native.smokeDialog(file);
check('open', await app.openProject({ force: true }), 'openProject returned false');
out.reopened = P.serialize(app.project) === before;
check('round-trip', out.reopened, 'reopened project differs from what was saved');
check('opened-state', app.nameInput.value === 'Smoke project' && app.saveState.textContent === 'Saved', [app.nameInput.value, app.saveState.textContent]);
check('workspaces-rebuilt', app.workspace('schematic').statusText.textContent.startsWith('1 components'), app.workspace('schematic').statusText.textContent);

// A file from a newer version is refused and the open Project is left untouched.
const future = JSON.parse(before); future.version = P.VERSION + 1;
const keep = app.project;
app.project = future; // borrow the save path to write the future-version file
await native.smokeDialog(newer);
await app.saveProject({ as: true });
app.project = keep; app.file = { name: 'x', path: file, dirty: false };
const snapshot = P.serialize(app.project);
await native.smokeDialog(newer);
check('newer-refused', (await app.openProject({ force: true })) === false);
check('unchanged-after-refusal', P.serialize(app.project) === snapshot);
const toastText = [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | ');
out.toast = toastText.slice(-160);
check('newer-message', /newer version of ElectroCAD/.test(toastText), toastText);

// Cancelling a dialog changes nothing.
check('cancel-open', (await app.openProject({ force: true })) === false);
return { fails, out };
