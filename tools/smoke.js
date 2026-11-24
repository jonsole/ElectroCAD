// Runs the smoke journeys against the built app in real Electron (modelled on DabbleCAD's
// tools/test.js). Linux without a display runs under xvfb-run; software rendering keeps
// headless machines happy. Usage: npm run test:smoke  (builds first)
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const electron = require('electron');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const shots = fs.mkdtempSync(path.join(os.tmpdir(), 'electrocad-shots-'));
const suites = process.argv.slice(2).filter((a) => !a.startsWith('--'));
// Suites joined with '+' run one after another on the same app data (to test restarts).
const list = suites.length ? suites : ['smoke-boot.js', 'smoke-store.js+smoke-store-restart.js', 'smoke-themes.js+smoke-themes-restart.js', 'smoke-place.js', 'smoke-wire.js+smoke-wire-restart.js', 'smoke-fields.js', 'smoke-select.js', 'smoke-inspector.js', 'smoke-labels.js+smoke-labels-restart.js', 'smoke-pinned.js+smoke-pinned-restart.js', 'smoke-units.js'];

let failed = false;
const runs = [];
for (const group of list) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'electrocad-userdata-'));
  for (const suite of group.split('+')) runs.push({ suite, userData });
}
for (const { suite, userData } of runs) {
  console.log(`\n=== ${suite} (offline) ===`);
  const args = [root, '--smoke=' + path.join(__dirname, suite), '--shot=' + path.join(shots, suite.replace(/\.js$/, '.png')), '--software', '--offline', '--user-data=' + userData];
  // Chromium refuses to run as root without --no-sandbox (CI containers often run as root).
  if (process.platform === 'linux' && process.getuid && process.getuid() === 0) args.push('--no-sandbox');
  let cmd = electron, cmdArgs = args;
  if (process.platform === 'linux' && !process.env.DISPLAY) { cmd = 'xvfb-run'; cmdArgs = ['-a', electron, ...args]; }
  const result = spawnSync(cmd, cmdArgs, { cwd: root, env, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
  const out = (result.stdout || '') + (result.stderr || '');
  const line = out.split(/\r?\n/).find((t) => t.startsWith('[smoke result] '));
  process.stdout.write(out.split(/\r?\n/).filter((t) => t.startsWith('[smoke') || t.startsWith('[renderer:3]') || t.startsWith('[renderer gone')).join('\n') + '\n');
  if (result.error || result.status !== 0 || !line) {
    failed = true;
    console.error(`${suite} FAILED (status ${result.status}${result.error ? ', ' + result.error.message : ''})`);
    if (!line) console.error(out.slice(-3000));
  } else console.log(`${suite} passed`);
}
console.log('\nScreenshots in', shots);
process.exit(failed ? 1 : 0);
