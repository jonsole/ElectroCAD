// Eagle import journey (#36): Import → Eagle → the .sch and .brd (a multi-select Open dialog) → a
// new Project with both sheets and the placed, routed board → the import summary says the Netlist
// and the signals match Eagle's and lists what changed → the Schematic is zoomed to what's drawn.
const app = window.electrocad;
const fails = [];
const check = (name, cond, info) => { if (!cond) fails.push(name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); };
const native = window.electroNative;
const raf = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
const before = app.project.id;
// the Import menu has Eagle (KiCad later)
app.importBtn.click(); await raf();
const items = [...document.querySelectorAll('.menu .menu-item')];
const eagle = items.find((b) => /Eagle/.test(b.textContent));
check('menu', !!eagle && items.some((b) => /KiCad/.test(b.textContent) && b.getAttribute('aria-disabled') === 'true'), items.map((b) => b.textContent));
await native.smokeDialog(['test/fixtures/eagle/regulator.sch', 'test/fixtures/eagle/regulator.brd']);
eagle?.click();
for (let i = 0; i < 50 && app.project.id === before; i++) await new Promise((r) => setTimeout(r, 100));
await raf();
const p = app.project, b = p.board;
check('new-project', p.id !== before && p.name === 'regulator', p.name);
check('sheets', p.schematic.sheets.length === 2);
check('parts', Object.values(p.components).map((c) => c.ref).sort().join() === 'R1,R2,U1,U2', Object.values(p.components).map((c) => c.ref));
check('board', b.footprints.length === 4 && b.tracks.length === 13 && b.vias.length === 1 && b.zones.length === 1, [b.footprints.length, b.tracks.length, b.vias.length, b.zones.length]);
check('bottom', b.footprints.find((f) => p.components[f.componentId].ref === 'U2')?.side === 'B');
check('locked', b.footprints.find((f) => p.components[f.componentId].ref === 'U1')?.locked === true);
check('on-board', app.active.id === 'board');
// the summary
const m = document.querySelector('.import-report');
check('report', !!m && /The Netlist matches Eagle's nets, pin for pin/.test(m.textContent) && /Every board signal matches/.test(m.textContent), m?.textContent);
check('losses', /Octagonal pads became round/.test(m?.textContent || '') && /Curved tracks/.test(m?.textContent || ''));
[...(m?.querySelectorAll('button') || [])].find((x) => x.textContent === 'Done')?.click();
await raf();
check('closed', !document.querySelector('.import-report'));
// the Schematic shows what's drawn, not the whole empty sheet
app.setWorkspace('schematic'); await raf();
const sv = app.workspace('schematic').view;
check('fitted', sv.view.scale > 1e-5, sv.view.scale);
// the zone fills on the board
app.setWorkspace('board'); await raf();
const ed = app.workspace('board').editor;
await ed.whenZonesFilled();
check('zone-filled', ed.zoneFiller.fills.get(b.zones[0].id)?.polys.length > 0);
localStorage.setItem('smoke.eagle', JSON.stringify([p.id, b.tracks.length]));
return { fails };
