import { defineConfig } from 'vite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(fs.readFileSync(path.join(here, 'package.json'), 'utf8'));

// the commit this build was made from (CI sets GITHUB_SHA; locally ask git), shown next to the app name
function git(cmd) { try { return execSync(`git ${cmd}`, { cwd: here, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return ''; } }
const sha = process.env.GITHUB_SHA || git('rev-parse HEAD');
const dirty = !process.env.GITHUB_SHA && !!git('status --porcelain --untracked-files=no -- src');
const build = {
  sha: sha || 'unknown',
  short: sha ? sha.slice(0, 7) + (dirty ? '+' : '') : 'dev',
  branch: process.env.GITHUB_REF_NAME || git('rev-parse --abbrev-ref HEAD'),
  date: new Date().toISOString(),
};

export default defineConfig({
  root: path.join(here, 'src/renderer'),
  base: './',
  define: { __APP_VERSION__: JSON.stringify(version), __APP_BUILD__: JSON.stringify(build) },
  build: { outDir: path.join(here, 'dist'), emptyOutDir: true, target: 'chrome120' },
  server: { port: 5190, strictPort: true },
});
