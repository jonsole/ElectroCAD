// Footprint editor journey, part 2: after a restart the saved footprints are in the Library.
const app = window.electrocad;
const fails = [];
const check = (name, cond, info) => { if (!cond) fails.push(name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); };
const lib = app.libraries.find((l) => l.id === localStorage.getItem('smoke.fp'));
const names = Object.values(lib?.footprints || {}).map((f) => f.name);
check('footprints', names.includes('Smoke_2pad') && names.some((n) => /PinHeader_2x03/.test(n)), names);
app.setWorkspace('library');
document.querySelector('[data-ws="library"] .segmented button[data-id="footprint"]').click();
check('listed', [...document.querySelectorAll('[data-ws="library"] .lib-part-name')].some((e) => e.textContent === 'Smoke_2pad'));
return { fails };
