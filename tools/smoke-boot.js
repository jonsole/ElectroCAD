// Boot journey, run inside the real app:  npm run test:smoke
// Checks the shell matches docs/UI.md: four Workspace tabs, each with its own pan/zoom,
// the DabbleCAD-style chrome, and the coordinate pill reporting integer-nm world positions in mm.
const app = window.electrocad;
const fails = [];
const out = {};
const check = (name, cond, info) => { if (!cond) fails.push(name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); };
const raf = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

check('app', !!app && !!app.workspaces, typeof app);
const ids = app.workspaces.map((w) => w.id);
check('four-tabs', JSON.stringify(ids) === JSON.stringify(['schematic', 'board', 'gerber', 'library']), ids);
check('tab-buttons', document.querySelectorAll('.workspace-bar .ws-tab').length === 4);
for (const sel of ['.topbar .logo-mark', '.topbar .design-name', '.toolbar', '.hint-bar', '.tool-col', '.side-panel', '.bottom-bar']) {
  check('chrome ' + sel, !!document.querySelector(`.ws-root.active ${sel}, ${sel}`), sel);
}
// the hint bar is off unless turned on in Settings; the Schematic has no side panel, the Parts card instead
const hb = () => getComputedStyle(document.querySelector('.ws-root.active .hint-bar')).display;
check('hint-bar-off', hb() === 'none', hb());
app.applyHintBar(true);
check('hint-bar-on', hb() !== 'none', hb());
app.applyHintBar(false);
check('no-schematic-side', !document.querySelector('.ws-root[data-ws="schematic"] .side-panel') && !!document.querySelector('.ws-root[data-ws="schematic"] .parts-card'));
check('desktop-bridge', !!window.electroNative, 'window.electroNative missing');
check('dark-theme', document.documentElement.dataset.theme === 'dark');

// Schematic is first and visible, with a canvas that has a size.
app.setWorkspace('schematic');
await raf();
const sch = app.workspace('schematic');
check('schematic-active', sch.el.classList.contains('active'));
check('canvas-sized', sch.view.w > 300 && sch.view.h > 300, [sch.view.w, sch.view.h]);

// Coordinate pill: a screen point maps to integer-nm world coordinates shown in mm.
const v = sch.view.view;
const target = [127e6, 63.5e6]; // 127 mm, 63.5 mm
const sp = v.toScreen(target);
sch.view.setCursor(sp);
out.pill = sch.view.coords.textContent;
check('coord-pill', /X 127\.00\s+Y 63\.50 mm/.test(out.pill), out.pill);

// Zoom the schematic about a point; the world point under it stays put.
const before = v.toWorld([400, 300]);
const scale0 = v.scale;
sch.view.canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -300, clientX: sch.view.canvas.getBoundingClientRect().left + 400, clientY: sch.view.canvas.getBoundingClientRect().top + 300, bubbles: true, cancelable: true }));
const after = v.toWorld([400, 300]);
check('wheel-zoom', v.scale > scale0 * 1.2, [scale0, v.scale]);
check('zoom-about-cursor', Math.abs(after[0] - before[0]) < 1 && Math.abs(after[1] - before[1]) < 1, [before, after]);
const schView = JSON.stringify(v.toJSON());

// Pan with a right-drag.
const rect = sch.view.canvas.getBoundingClientRect();
const pe = (type, x, y, buttons) => new PointerEvent(type, { pointerId: 7, button: type === 'pointerdown' ? 2 : -1, buttons, clientX: rect.left + x, clientY: rect.top + y, bubbles: true, cancelable: true });
const o0 = [v.ox, v.oy];
sch.view.canvas.dispatchEvent(pe('pointerdown', 300, 300, 2));
sch.view.canvas.dispatchEvent(pe('pointermove', 350, 280, 2));
sch.view.canvas.dispatchEvent(pe('pointerup', 350, 280, 0));
check('right-drag-pan', Math.abs(v.ox - o0[0] - 50) < 1e-6 && Math.abs(v.oy - o0[1] + 20) < 1e-6, [o0, [v.ox, v.oy]]);
const schAfterPan = JSON.stringify(v.toJSON());

// Every workspace switches in, draws, and keeps its own view.
for (const id of ['board', 'gerber', 'library']) {
  app.setWorkspace(id);
  await raf();
  const ws = app.workspace(id);
  check('active ' + id, ws.el.classList.contains('active') && !sch.el.classList.contains('active'));
  check('sized ' + id, ws.view.w > 300, ws.view.w);
  check('own-view ' + id, ws.view.view !== v && JSON.stringify(ws.view.view.toJSON()) !== schAfterPan);
}
app.workspace('board').view.view.zoomAt(100, 100, 3);
app.setWorkspace('schematic');
await raf();
check('schematic-view-kept', JSON.stringify(v.toJSON()) === schAfterPan, [schView, schAfterPan, JSON.stringify(v.toJSON())]);

// Theme toggle redraws in light and back.
app.toggleTheme();
check('light-theme', document.documentElement.dataset.theme === 'light');
app.toggleTheme();
check('dark-again', document.documentElement.dataset.theme === 'dark');

// Show the board workspace for the screenshot.
app.setWorkspace('board');
await raf();
return { fails, out };
