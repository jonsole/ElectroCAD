import { App } from './app.js';
import { storageEvents } from './platform.js';
import { toast } from './ui/dom.js';
import * as project from './core/project.js';
import * as units from './core/units.js';
import * as netlist from './core/netlist.js';
import * as labels from './core/labels.js';
import * as drawings from './core/drawings.js';
import * as schematic from './core/schematic.js';
import * as collision from './core/collision.js';

// The app has its own menus; keep the browser's right-click menu off the canvas and
// chrome, but leave it on text fields for copy, paste and spelling (as DabbleCAD does).
document.addEventListener('contextmenu', (e) => {
  const t = e.target;
  if (t instanceof Element && t.closest('input, textarea, [contenteditable="true"]')) return;
  e.preventDefault();
});

const app = new App();
window.electrocad = app; // used by the smoke tests
window.electrocadLib = { project, units, netlist, schematic, labels, drawings, collision };
// Starting up: say what's wrong instead of sitting on "Loading…" (another tab holding the
// browser store open, or a saved project or setting this build can't use), and offer a way out.
const bootMessage = (text, { error = false, actions = true } = {}) => {
  const boot = document.getElementById('boot');
  if (!boot) return;
  boot.querySelector('.boot-sub').textContent = text;
  boot.classList.toggle('boot-error', error);
  boot.querySelector('.boot-actions')?.remove();
  if (!actions) return;
  const btn = (label, onClick, primary) => Object.assign(document.createElement('button'), { className: 'btn ' + (primary ? 'btn-primary' : 'btn-outline'), type: 'button', textContent: label, onclick: onClick });
  const row = document.createElement('div');
  row.className = 'boot-actions';
  row.append(btn('Reload', () => location.reload(), true),
    btn('Start with a new project', () => { try { sessionStorage.setItem('electrocad.skipLast', '1'); } catch { /* private mode */ } location.reload(); }));
  boot.append(row);
};
storageEvents.onBlocked = () => bootMessage('ElectroCAD is open in another tab or window with an older version. Close or reload that tab and this one carries on.');
storageEvents.onReplaced = () => { if (document.getElementById('boot')) return; toast('ElectroCAD was updated in another tab. Reload this tab to keep saving.', 'error', 15000); };
const slow = setTimeout(() => bootMessage('Still loading… If this doesn\'t finish, another ElectroCAD tab may be holding the browser storage, or the page is an old cached copy: close the other tabs, then Reload (Ctrl+Shift+R).'), 8000);
app.init().then(() => clearTimeout(slow)).catch((err) => {
  clearTimeout(slow);
  console.error(err);
  bootMessage(`Could not start: ${(err && err.message) || err}. Reload to try again, or start with a new project (your saved projects stay in Your projects).`, { error: true });
});
