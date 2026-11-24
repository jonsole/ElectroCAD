// Wires and Netlist journey, part 2: after a restart the reopened Project has the same Netlist.
const app = window.electrocad;
const fails = [];
const check = (name, cond, info) => { if (!cond) fails.push(name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); };
const now = JSON.stringify(window.electrocadLib.netlist.buildNetlist(app.project));
check('netlist-unchanged', now === localStorage.getItem('smoke.netlist'), [now, localStorage.getItem('smoke.netlist')]);
check('wires-kept', app.project.schematic.sheets[0].wires.length === 2);
return { fails };
