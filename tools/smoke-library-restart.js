// Library journey, part 2: after a restart the Library and its Parts are back, and in the picker.
const app = window.electrocad;
const fails = [];
const check = (name, cond, info) => { if (!cond) fails.push(name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); };
check('library-kept', app.libraries.length === 1 && JSON.stringify(Object.keys(app.libraries[0].parts).sort()) === localStorage.getItem('smoke.lib'), app.libraries.map((l) => Object.keys(l.parts)));
check('picker', app.workspace('schematic').editor.parts.some((p) => p.name === 'Dual buffer'));
check('library-tab', [...document.querySelectorAll('.lib-group[data-library="my-parts"] .lib-part-row')].length === 2);
return { fails };
