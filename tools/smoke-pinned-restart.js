// Pinned fields journey, part 2: after a restart the pinned Value is still pinned in the same place.
const app = window.electrocad;
const fails = [];
const check = (name, cond, info) => { if (!cond) fails.push(name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); };
const sym = app.project.schematic.sheets[0].symbols[0];
check('pin-kept', JSON.stringify(sym?.fieldPins) === localStorage.getItem('smoke.pin'), [sym?.fieldPins, localStorage.getItem('smoke.pin')]);
return { fails };
