// Zones journey, part 2: after a restart the Zones are back and fill again.
const app = window.electrocad;
const fails = [];
const check = (name, cond, info) => { if (!cond) fails.push(name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); };
const zs = app.project.board.zones.map((q) => [q.id, q.net, q.layer, q.priority, q.connect]);
check('zones', JSON.stringify(zs) === localStorage.getItem('smoke.zones'), zs);
app.setWorkspace('board');
await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
const ed = app.workspace('board').editor;
await ed.whenZonesFilled();
const fz = app.project.board.zones.find((z) => z.layer === 'F.Cu'), bz = app.project.board.zones.find((z) => z.layer === 'B.Cu');
check('filled', ed.zoneFiller.fills.get(fz.id)?.polys.length > 0, [...ed.zoneFiller.fills.keys()]);
check('b-empty', ed.zoneFiller.fills.get(bz.id)?.polys.length === 0 && ed.zoneFiller.fills.get(bz.id).islands === 1); // no GND copper on B.Cu: its one island is removed
return { fails };
