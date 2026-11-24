import { App } from './app.js';
import * as project from './core/project.js';
import * as units from './core/units.js';
import * as netlist from './core/netlist.js';
import * as labels from './core/labels.js';
import * as drawings from './core/drawings.js';
import * as schematic from './core/schematic.js';

// The app has its own menus; keep the browser's right-click menu off the canvas and
// chrome, but leave it on text fields for copy, paste and spelling (as DabbleCAD does).
document.addEventListener('contextmenu', (e) => {
  const t = e.target;
  if (t instanceof Element && t.closest('input, textarea, [contenteditable="true"]')) return;
  e.preventDefault();
});

const app = new App();
window.electrocad = app; // used by the smoke tests
window.electrocadLib = { project, units, netlist, schematic, labels, drawings };
app.init().catch((err) => {
  console.error(err);
  const boot = document.getElementById('boot');
  if (boot) boot.querySelector('.boot-sub').textContent = 'Could not start: ' + (err && err.message);
});
