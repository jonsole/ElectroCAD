import { App } from './app.js';
import * as project from './core/project.js';
import * as units from './core/units.js';

// The app has its own menus; keep the browser's right-click menu off the canvas and
// chrome, but leave it on text fields for copy, paste and spelling (as DabbleCAD does).
document.addEventListener('contextmenu', (e) => {
  const t = e.target;
  if (t instanceof Element && t.closest('input, textarea, [contenteditable="true"]')) return;
  e.preventDefault();
});

const app = new App();
window.electrocad = app; // used by the smoke tests
window.electrocadLib = { project, units };
app.init().catch((err) => {
  console.error(err);
  const boot = document.getElementById('boot');
  if (boot) boot.querySelector('.boot-sub').textContent = 'Could not start: ' + (err && err.message);
});
