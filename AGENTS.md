# ElectroCAD

Browser and desktop schematic-capture + 2/4-layer PCB layout editor. Plain JavaScript ES modules, Vite, Electron, the same stack as DabbleCAD. Read `docs/DESIGN.md` for architecture and milestones.

- Run the editor: `npm run dev` (browser) or `npm start` (Electron).
- Tests: `npm test` (unit tests, `node --test`) and `npm run test:smoke` (smoke journeys in real Electron via `tools/smoke.js`; Linux without a display uses `xvfb-run`). Model code in `src/renderer/core/` and the view maths in `src/renderer/view/transform.js` are DOM-free and unit-tested.
- UI follows the DabbleCAD fork (ADR-0007, `docs/UI.md`). Ported code keeps DabbleCAD's credit in `NOTICE`.
- All lengths are integer nanometres with +Y down (ADR-0003).

## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues on `jonsole/ElectroCAD`. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
