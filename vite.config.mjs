import { defineConfig } from 'vite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(fs.readFileSync(path.join(here, 'package.json'), 'utf8'));

export default defineConfig({
  root: path.join(here, 'src/renderer'),
  base: './',
  define: { __APP_VERSION__: JSON.stringify(version) },
  build: { outDir: path.join(here, 'dist'), emptyOutDir: true, target: 'chrome120' },
  server: { port: 5190, strictPort: true },
});
