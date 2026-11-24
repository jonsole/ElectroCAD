// Labels and Sheets journey, part 2: after a restart the two Sheets, their labels and the Netlist are back.
const app = window.electrocad;
const fails = [];
const check = (name, cond, info) => { if (!cond) fails.push(name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); };
const now = JSON.stringify(window.electrocadLib.netlist.buildNetlist(app.project));
check('netlist-unchanged', now === localStorage.getItem('smoke.labels'), [now, localStorage.getItem('smoke.labels')]);
check('sheets-kept', app.project.schematic.sheets.length === 2 && app.project.schematic.sheets.map((s) => s.labels.length).join() === '2,2');
return { fails };
