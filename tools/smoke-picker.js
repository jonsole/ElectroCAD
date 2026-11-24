// Part picker journey (#12): category select and search filter the tiles; multi-Unit tiles have
// a Unit badge; the footprint row picks a Preferred footprint (applied on drop, remembered per
// Part) or any other Footprint through "Other…".
const app = window.electrocad;
const fails = [];
const check = (name, cond, info) => { if (!cond) fails.push(name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); };
const ed = app.workspace('schematic').editor;
const ws = app.workspace('schematic');
const tiles = () => [...document.querySelectorAll('.part-tile')].map((t) => t.getAttribute('aria-label'));
const cat = document.querySelector('.side-filter select');
const search = document.querySelector('.side-search input[aria-label="Search parts"]');
check('all', tiles().length >= 30 && tiles().includes('Resistor') && tiles().includes('Conn_02x05') && tiles().includes('AMS1117-3.3'), tiles().length);
cat.value = 'ICs'; cat.dispatchEvent(new Event('change'));
check('ics', tiles().join() === 'LM324,LM358,NE555,74HC00', tiles());
check('badge', document.querySelector('.part-tile[aria-label="LM324"] .unit-badge')?.textContent === '×5' && !document.querySelector('.part-tile[aria-label="NE555"] .unit-badge'));
search.value = 'op-amp'; search.dispatchEvent(new Event('input'));
check('search-in-category', tiles().join() === 'LM324,LM358', tiles());
cat.value = 'All'; cat.dispatchEvent(new Event('change'));
search.value = 'header 2x'; search.dispatchEvent(new Event('input'));
check('search-all', tiles().length === 9 && tiles().every((t) => t.startsWith('Conn_02x')), tiles());
search.value = ''; search.dispatchEvent(new Event('input'));

// the footprint row follows the tile; choose 1206 for the Resistor and drop one
const tile = document.querySelector('.part-tile[aria-label="Resistor"]');
tile.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true, clientX: 5, clientY: 5 }));
document.dispatchEvent(new PointerEvent('pointerup', { button: 0, bubbles: true, clientX: 5, clientY: 5 }));
const chips = () => [...document.querySelectorAll('.fp-row .fp-chip')].map((c) => c.textContent);
check('chips', chips().join() === '0402,0603,0805,1206,THT,Other…', chips());
check('default-on', document.querySelector('.fp-chip.on')?.textContent === '0805');
document.querySelector('.fp-chip[data-fp="R_1206"]').click();
check('chosen', document.querySelector('.fp-chip.on')?.textContent === '1206');
const G = 1270000;
ed.placing.at = [40 * G, 40 * G]; const a = ed.commitPlace(); ed.endPlace();
check('applied', a.comp.footprint?.fpId === 'R_1206', a.comp.footprint);
ed.placeAtViewCenter(ed.parts.find((x) => x.name === 'Resistor'));
const b = Object.values(app.project.components).find((c) => c.ref === 'R2');
check('remembered', b?.footprint?.fpId === 'R_1206', b?.footprint);
// Other…: any Footprint, Pin n -> Pad n
document.querySelector('.fp-other').click();
const pop = document.querySelector('.fp-search-pop');
const q = pop.querySelector('input'); q.value = 'axial din0207'; q.dispatchEvent(new Event('input'));
pop.querySelector('.menu-item').click();
check('other-on', /R_Axial|DIN0207/.test(document.querySelector('.fp-other')?.textContent + document.querySelector('.fp-other')?.title) && document.querySelector('.fp-other.on'));
ed.beginPlace(ed.parts.find((x) => x.name === 'Resistor')); ed.placing.at = [60 * G, 40 * G]; const c = ed.commitPlace(); ed.endPlace();
check('other-applied', !!c.comp.footprint?.fpKey && app.project.footprints[c.comp.footprint.fpKey].footprint.name.startsWith('R_Axial'), c.comp.footprint);
// a different Part keeps its own choice (none: its default)
ed.placeAtViewCenter(ed.parts.find((x) => x.name === 'Capacitor'));
check('per-part', Object.values(app.project.components).find((x) => x.ref === 'C1')?.footprint?.fpId === 'C_0805');
check('no-preview-left', !document.querySelector('.fp-preview'));
// views: Icons, Small icons, List, Details (Explorer's View menu), remembered in this browser
document.querySelector('.picker-view').click();
const viewItems = [...document.querySelectorAll('.menu .menu-item')].map((x) => x.textContent);
check('view-menu', viewItems.join() === 'Icons,Small icons,List,Details,No groups,Group by category,Group by manufacturer', viewItems);
[...document.querySelectorAll('.menu .menu-item')].find((x) => x.textContent === 'List').click();
const grid = document.querySelector('.picker-grid');
check('list-view', grid.classList.contains('view-list') && localStorage.getItem('electrocad.pickerView') === 'list');
// placing still works from a List row
const n0 = Object.keys(app.project.components).length;
const row = document.querySelector('.part-tile[aria-label="Diode"]');
row.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true, clientX: 5, clientY: 5 }));
document.dispatchEvent(new PointerEvent('pointerup', { button: 0, bubbles: true, clientX: 5, clientY: 5 }));
ed.placing.at = [80 * G, 40 * G]; ed.commitPlace(); ed.endPlace();
check('list-place', Object.keys(app.project.components).length === n0 + 1);
ed.setPickerGroup('none'); // sorting is easiest to check on a flat table
ed.setPickerView('details');
const heads = [...grid.querySelectorAll('.pd-col')].map((x) => x.textContent.replace(/[▲▼]/g, '').trim());
check('details-cols', heads.join() === 'Name,Category,Value,Units,Fp', heads);
const names = () => [...grid.querySelectorAll('.part-tile')].map((t) => t.getAttribute('aria-label'));
check('details-sorted-by-name', names()[0] === '74HC00', names().slice(0, 3));
[...grid.querySelectorAll('.pd-col')].find((x) => x.textContent.startsWith('Units')).click();
[...document.querySelectorAll('.picker-grid .pd-col')].find((x) => x.textContent.startsWith('Units')).click();
check('details-sort-units-desc', ['LM324', '74HC00'].includes(names()[0]) && names()[2] === 'LM358', names().slice(0, 3));
check('details-cells', document.querySelector('.part-tile[aria-label="Resistor"] .pd-category')?.textContent === 'Passives');
ed.setPickerView('icons');
check('icons-back', grid.classList.contains('view-icons'));
ed.setPickerGroup('category');
// the tree: grouped by category by default; fold a group; group by manufacturer; search opens groups
const groups = () => [...grid.querySelectorAll('.pg-head')].map((x) => x.dataset.group);
check('tree-category', groups().join() === 'Passives,Semiconductors,Connectors,ICs,Power', groups());
grid.querySelector('.pg-head[data-group="Connectors"]').click();
check('folded', !tiles().some((t) => t.startsWith('Conn_')) && grid.querySelector('.pg-head[data-group="Connectors"]').getAttribute('aria-expanded') === 'false');
check('folded-remembered', JSON.parse(localStorage.getItem('electrocad.pickerFolded')).includes('category:Connectors'));
search.value = 'conn_01x0'; search.dispatchEvent(new Event('input'));
check('search-opens', tiles().length === 9 && groups().join() === 'Connectors', [groups(), tiles().length]);
search.value = ''; search.dispatchEvent(new Event('input'));
grid.querySelector('.pg-head[data-group="Connectors"]').click();
check('unfolded', tiles().some((t) => t === 'Conn_02x05'));
ed.setPickerGroup('manufacturer');
check('tree-mfr', groups().join() === 'Advanced Monolithic Systems,Nexperia,Texas Instruments,Generic', groups());
check('mfr-members', [...grid.querySelectorAll('.pg-head[data-group="Texas Instruments"] ~ .part-tile')].slice(0, 3).map((t) => t.getAttribute('aria-label')).join() === 'LM324,LM358,NE555');
ed.setPickerGroup('none');
check('no-groups', groups().length === 0 && tiles().length >= 30);
ed.setPickerGroup('category');
return { fails };
