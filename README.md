# ElectroCAD

Schematic capture and 2/4-layer PCB layout that runs in the browser or as a desktop app, with the look and feel of DabbleCAD.

**Status:** early development. The app shell is in place (ticket #2); see the spec in issue #1 and `docs/DESIGN.md` for the plan.

```bash
npm install
npm run dev          # browser, http://localhost:5190
npm start            # desktop (Electron)
npm test             # unit tests (node --test)
npm run test:smoke   # end-to-end smoke journeys in real Electron (Linux: uses xvfb-run when there is no display)
```

- Domain glossary: `CONTEXT.md`
- Decisions: `docs/adr/`
- Architecture and milestones: `docs/DESIGN.md`
- Screen layout and DabbleCAD-style components: `docs/UI.md`

Licensed under Apache-2.0. Parts are ported from DabbleCAD; see `NOTICE`.
