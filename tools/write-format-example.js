// Regenerates docs/formats/example.ecad (from test/fixtures/sample-project.js) and
// docs/formats/ecad.schema.json (from src/renderer/core/ecad-schema.js).
// Run after changing the Native format: node tools/write-format-example.js
const path = require('node:path');
const fs = require('node:fs');
(async () => {
  const { sampleProject, readableIds } = await import('../test/fixtures/sample-project.js');
  const { serialize } = await import('../src/renderer/core/project.js');
  const { ECAD_SCHEMA } = await import('../src/renderer/core/ecad-schema.js');
  const dir = path.join(__dirname, '..', 'docs', 'formats');
  const write = (name, text) => { fs.writeFileSync(path.join(dir, name), text); console.log('wrote', path.relative(process.cwd(), path.join(dir, name))); };
  write('example.ecad', serialize(readableIds(sampleProject())));
  write('ecad.schema.json', JSON.stringify(ECAD_SCHEMA, null, 2) + '\n');
})();
