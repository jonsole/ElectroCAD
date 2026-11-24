// Launches ElectroCAD with Electron. Some hosts (for example editor extension
// processes) export ELECTRON_RUN_AS_NODE, which would make Electron behave like
// plain Node, so it is removed here before starting the app (as in DabbleCAD).
const { spawn } = require('node:child_process');
const path = require('node:path');
const electron = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [path.join(__dirname, '..'), ...process.argv.slice(2)], { stdio: 'inherit', env });
child.on('exit', (code) => process.exit(code == null ? 1 : code));
