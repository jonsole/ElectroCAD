// Zone fill benchmark (#73): times fillZones on Eagle boards and prints a hash of the fills, so a
// speed-up can be checked to give exactly the same copper. Not a CI gate.
//   node tools/bench-zones.js <board.brd> [<schematic.sch>] [--runs 3]
// With no arguments it uses the toyotune boards beside this checkout (../jonsole/toyotune).
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
(async () => {
  const { importEagle } = await import('../src/renderer/io/eagle/index.js');
  const { zoneInput, fillZones } = await import('../src/renderer/core/zones.js');
  const args = process.argv.slice(2);
  const runs = Number(args[args.indexOf('--runs') + 1]) || (args.includes('--runs') ? 1 : 3);
  const files = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--runs');
  const D = path.join(__dirname, '..', '..', 'jonsole', 'toyotune', 'hw', 'toyotune_lv_2p1', 'pcb');
  const boards = files.length ? [files] : [[path.join(D, 'toyotune_3s.brd'), path.join(D, 'toyotune_3s.sch')], [path.join(D, 'toyotune_3s_lvc.brd')]];
  for (const [brd, sch] of boards) {
    const { project } = importEagle({ brd: fs.readFileSync(brd, 'utf8'), ...(sch ? { sch: fs.readFileSync(sch, 'utf8') } : {}), name: 'bench' });
    const input = zoneInput(project);
    const times = [];
    let fills;
    for (let i = 0; i < runs; i++) {
      const t0 = performance.now();
      fills = fillZones(input);
      times.push(performance.now() - t0);
    }
    // keyed by each Zone's layer and outline (ids are new on every import), in a stable order
    const ref = (key) => { const [id, pad] = key.split(':'); return `${project.components[id]?.ref ?? id}:${pad}`; };
    const stable = (f) => ({ ...f, thermals: f.thermals.map((t) => ({ ...t, key: ref(t.key) })).sort((a, b) => (a.key < b.key ? -1 : 1)) });
    const keyed = input.zones.map((z) => [z.layer, z.priority, z.outline, stable(fills.get(z.id))]).sort((a, b) => (JSON.stringify(a.slice(0, 3)) < JSON.stringify(b.slice(0, 3)) ? -1 : 1));
    const hash = crypto.createHash('sha256').update(JSON.stringify(keyed)).digest('hex').slice(0, 16);
    const b = project.board;
    console.log(`${path.basename(brd)}: ${b.zones.length} zones, ${b.tracks.length} tracks, ${b.vias.length} vias, ${input.pads.length} pads`);
    console.log(`  fill: best ${Math.min(...times).toFixed(0)} ms, runs ${times.map((t) => t.toFixed(0)).join(' / ')} ms; fills ${hash}`);
  }
})();
