// Print journey (#14): Ctrl+P opens the Print dialog with a preview; Export PDF writes every Sheet,
// and Export SVG one Sheet, through the save dialog. (The files' contents are unit-tested.)
const app = window.electrocad;
const native = window.electroNative;
const fails = [];
const check = (name, cond, info) => { if (!cond) fails.push(name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ed = app.workspace('schematic').editor;
const G = 1270000;
ed.beginPlace(ed.parts.find((p) => p.name === 'Resistor')); ed.placing.at = [40 * G, 40 * G]; ed.commitPlace(); ed.endPlace();
ed.addSheet();
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true }));
await wait(200);
const modal = () => document.querySelector('.print-modal') || document.querySelector('.modal');
check('dialog', !!modal() && /Print \/ export schematic/.test(modal().textContent));
const img = modal().querySelector('.print-preview');
check('preview', img && img.src.startsWith('data:image/svg+xml') && decodeURIComponent(img.src).includes('R1'));
const which = modal().querySelector('select[aria-label="Sheets"]');
check('all-sheets', which.value === 'all' && /All sheets \(2\)/.test(which.selectedOptions[0].textContent));
const svgBtn = [...modal().querySelectorAll('button')].find((b) => b.textContent.includes('Export SVG'));
check('svg-needs-one-sheet', svgBtn.disabled);
// PDF of both Sheets
const stamp = Date.now();
await native.smokeDialog(`/tmp/electrocad-smoke-${stamp}.pdf`);
[...modal().querySelectorAll('button')].find((b) => b.textContent.includes('Export PDF')).click();
await wait(400);
check('pdf-saved', [...document.querySelectorAll('.toast')].some((t) => t.textContent.includes(`electrocad-smoke-${stamp}.pdf`)), [...document.querySelectorAll('.toast')].map((t) => t.textContent));
check('closed', !document.querySelector('.print-modal'));
// SVG of Sheet 1
document.querySelector('button[title^="Print or export"]').click();
await wait(200);
const which2 = modal().querySelector('select[aria-label="Sheets"]');
which2.value = app.project.schematic.sheets[0].id; which2.dispatchEvent(new Event('change'));
const svg2 = [...modal().querySelectorAll('button')].find((b) => b.textContent.includes('Export SVG'));
check('svg-enabled', !svg2.disabled);
await native.smokeDialog(`/tmp/electrocad-smoke-${stamp}.svg`);
svg2.click();
await wait(400);
check('svg-saved', [...document.querySelectorAll('.toast')].some((t) => t.textContent.includes(`electrocad-smoke-${stamp}.svg`)));
return { fails, out: { pdf: `/tmp/electrocad-smoke-${stamp}.pdf` } };
