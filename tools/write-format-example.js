// Regenerates docs/formats/example.ecad from test/fixtures/sample-project.js.
// Run after changing the Native format: node tools/write-format-example.js
const path = require('node:path');
const fs = require('node:fs');
(async () => {
  const { sampleProject, readableIds } = await import('../test/fixtures/sample-project.js');
  const { serialize } = await import('../src/renderer/core/project.js');
  const out = path.join(__dirname, '..', 'docs', 'formats', 'example.ecad');
  fs.writeFileSync(out, serialize(readableIds(sampleProject())));
  console.log('wrote', path.relative(process.cwd(), out));
})();
