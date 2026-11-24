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
return { fails };
