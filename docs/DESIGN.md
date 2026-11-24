# ElectroCAD design

A schematic-capture and PCB-layout editor for 2- and 4-layer hobbyist boards. It runs in the browser and as a desktop app. Terms in **bold** are defined in [CONTEXT.md](../CONTEXT.md), and the decisions behind this design are in [adr/](adr/).

## 1. Goals for v1

| Area | In v1 | Later |
|---|---|---|
| Schematic | Flat multi-Sheet schematic, Wires, Junctions, Net labels (per Sheet), Global labels, Power symbols, multi-Unit Parts, ERC | Hierarchical sheets, buses, Unit (gate) swap |
| Library | Built-in generated starter Library, Part/Symbol/Footprint editors, KiCad and Eagle library import, frozen project copies with "Update from Library" | Online part search |
| Board | Schematic-first only. 2 or 4 copper layers, Outline, Footprint placement, Track routing at 45°/90° with three Routing modes (Shove, Walkaround, Free), through Vias, live-refilled Zones, Net classes, Fab presets, DRC | Differential pairs, length tuning, arcs, blind/buried vias |
| Sync | Forward annotation with a change list (Components added or removed, Nets), live Footprint changes from either editor (ADR-0008), Back annotation of Reference designators, Cross-probing | — |
| Output | Gerber RS-274X (X2 attributes), Excellon drill, BOM CSV, pick-and-place CSV, PDF/SVG schematic print | ODB++, IPC-2581, STEP |
| Interchange | Native `.ecad`. KiCad: read 6+, write 9 (`.kicad_sch`, `.kicad_pcb`, `.kicad_sym`, `.kicad_mod`). Eagle XML 6+ / Fusion Electronics: read and write (`.sch`, `.brd`, `.lbr`) | KiCad 5 legacy, Eagle binary, Altium, EasyEDA |
| 3D | Board preview with three.js (reusing DabbleCAD's viewer): board, copper, silk, box bodies | STEP models |
| Agents (MCP) | One MCP tool layer for Parts, Schematics, Boards and Fab output; headless `electrocad-mcp` (stdio, `.ecad` files) and a live server in the desktop app (ADR-0009) | Browser bridge, autorouting tool |
| Platforms | Browser and Electron desktop, both from M1 | Google Drive (reuse DabbleCAD's `drive.js`) |

Non-goals: simulation, autorouting, multi-user real-time editing, and board-only design with no Schematic ([ADR-0002](adr/0002-schematic-is-the-source-of-truth-for-nets.md)).

## 2. Architecture

```
src/renderer/
  main.js              boot, wires App to the platform
  app.js               shell: workspace tabs (Schematic | Board | Gerber | Library), menus, panels, shortcuts, file I/O
  platform.js          desktop / browser bridge (same contract as DabbleCAD), see §10
  core/                pure model code — no DOM, unit-tested with node --test
    units.js           nm ↔ mm/mil, grids, formatting
    geom.js            points, transforms (rot/mirror), segment maths
    project.js         Project model, factory functions, (de)serialise, version migrations
    history.js         undo/redo transactions
    netlist.js         Schematic → Netlist (union-find over connection points)
    annotate.js        forward/back annotation diff + apply            (M3)
    erc.js             electrical rule check                           (M2)
    drc.js             design rule check                               (M4)
    collide.js         copper collision engine shared by router and DRC (M4)
    router/            walkaround (M4), shove + drag (M6)
    zonefill.js        Zone fill with clipper-lib, runs in a worker     (M4)
    presets.js         Fab presets                                      (M4)
  library/             built-in Part generators (resistor, SOIC-n, header-n…)
  view/
    canvas.js          pan/zoom/grid Canvas2D viewport shared by both editors
    hit.js             hit testing + spatial index                    (M2)
  schematic/           schematic editor: renderer + tools (select, place, wire, label)
  board/               board editor: renderer + tools (place, route, via, zone, outline)
  workers/             zonefill.worker.js (M4)
  io/                  importers/exporters — kicad/, eagle/, gerber/, excellon/, bom/  (M5, M7)
  ui/                  DOM helpers, panels, dialogs (ported from DabbleCAD's ui/ where it fits)
  view3d/              three.js board preview                         (M8)
electron/              main.js + preload.js exposing window.electroNative
tools/                 run.js (launch Electron), smoke tests
```

The **core** layer is plain data and pure functions. Editors read the Project, and every change goes through `history.transact(label, fn)`, which snapshots the Project, applies `fn` and records an undo step. Snapshot undo is simple and plenty fast at hobby-board sizes (a few thousand objects). If profiling ever says otherwise, it can be swapped for patch-based undo behind the same interface. Zone fills are derived data: they are cached alongside the Project but are not part of undo snapshots.

## 3. Data model (Native format)

Every object has a stable string `id`. Coordinates are integer nm with +Y down ([ADR-0003](adr/0003-integer-nanometre-coordinates.md)). Rotation is in degrees, counter-clockwise on screen. The Schematic restricts it to multiples of 90°, and the Board allows any angle for Footprints.

```js
Project {
  format: 'electrocad', version: 1, id, name,
  parts:      { [partId]: Part },        // frozen embedded copies of every Part used (ADR-0004)
  components: { [componentId]: Component },
  schematic:  { sheets: [ Sheet ] },
  board:      Board,
}

Part      { id, name, prefix: 'R', defaultValue,
            origin: { library, partId, version },              // Library origin, for "Update from Library"
            units: [ Symbol ],                                  // ADR-0005: always an array, usually length 1
            footprints: { [fpId]: Footprint },                  // Preferred footprints
            pinMap: { [fpId]: { [pinNumber]: padNumber } } }    // missing entry → identity map
Symbol    { name: 'A', graphics: [ Shape ], pins: [ { number, name, at:[x,y], dir:'L'|'R'|'U'|'D', length, type } ] }
Footprint { name, pads: [ { number, at, shape:'rect'|'circle'|'oval'|'roundrect', size:[w,h], drill?, layers } ],
            graphics: [ Shape on F.SilkS / F.CrtYd / F.Fab ] }

Component { id, partId, ref, value, mpn: { manufacturer, number } | null,
            footprint: { fpId } | { library, footprint: Footprint },  // preferred, or any other Footprint (identity Pin map)
            fields: {} }

Sheet     { id, name,
            symbols: [ { id, componentId, unit: 0, at, rot, mirror } ],   // one entry per placed Unit
            wires:   [ { id, a, b } ],
            labels:  [ { id, at, rot, net, scope:'local'|'global', style:'label'|'gnd'|'power' } ],
            noConnects: [ { id, at } ] }

Board     { stack: { copper: 2|4, thickness }, preset: 'generic' | presetId, outline: [ Shape ],
            footprints: [ { id, componentId, at, rot, side:'F'|'B', locked } ],
            tracks: [ { id, a, b, width, layer, net } ],
            vias:   [ { id, at, drill, diameter, from:'F.Cu', to:'B.Cu', net } ],  // v1: always F.Cu → B.Cu
            zones:  [ { id, layer, net, outline:[pts], priority, clearance, thermal } ],
            rules:  { clearance, trackWidth, viaDrill, viaDiameter, minHole, edgeClearance, annularRing },
            netClasses: { [name]: { trackWidth, clearance, viaDrill, viaDiameter, nets:[...] } } }
```

A Power symbol is a label with `scope: 'global'` and a `gnd` or `power` style. `Board` objects refer to Nets **by name**. Names are stable because every unlabelled Net gets a generated name from its lowest Reference designator and Pad (`Net-(R1-Pad2)`). Forward annotation renames board copper when a Net's name changes.

## 4. Connectivity (Netlist)

`core/netlist.js` turns a Schematic into a Netlist:

1. Gather connection points: every Pin tip of every placed Unit (Symbol transform applied) and every Wire endpoint.
2. Union-find, per Sheet:
   - join the two ends of each Wire;
   - join any point that lies on a Wire (including mid-segment T-joins);
   - join coincident points;
   - join each label to the point it sits on;
   - join Net labels of the same name *on the same Sheet*.
3. Across Sheets: join Global labels and Power symbols of the same name.
4. Every set that touches at least one Pin is a Net. It is named after its labels, with this precedence: Power symbol, then Global label, then Net label. Two different names on one Net is an ERC error. A Net with no label is named `Net-(REF-PadN)`.
5. Pins map to Pads through the Component's Footprint. A Preferred footprint uses its Pin map, and any other Footprint uses the identity map. A Pin with no matching Pad is an ERC error.

Junction dots are *drawn* where three or more Wire ends meet or a Wire end lands mid-wire. They are derived, not stored.

## 5. Editors

The look, layout and components follow the DabbleCAD fork; see [UI.md](UI.md) and [ADR-0007](adr/0007-look-and-feel-follows-the-dabblecad-fork.md).

Both editors share `view/canvas.js`: a Canvas2D viewport with wheel zoom about the cursor, middle- or right-drag pan, a grid, and a screen↔world transform. Rendering redraws the whole scene each frame and only runs when something changes. A spatial index (an R-tree or uniform grid) arrives at M2 for hit testing, routing and DRC. If large boards get slow, WebGL is a renderer swap behind the same draw-list interface.

**Schematic tools:** Select/move (V), Place part (A, then choose the Unit for multi-Unit Parts), Wire (W, orthogonal, auto-ends on a Pin or Wire), Net label (L), Global label (Ctrl+L), GND/Power (G/P), No-connect (Q), Rotate (R), Mirror (X), Delete, plus Undo/Redo (Ctrl+Z / Ctrl+Shift+Z). Grid: 50 mil (1.27 mm), the KiCad convention, so KiCad symbols land on-grid.

**Board tools:** Select/move, Route (X; switch layer with V, which drops a Via), Drag track (D), Via, Zone, Outline, Measure.

**Routing** ([ADR-0006](adr/0006-push-and-shove-routing-in-v1.md)). Tracks are 45°/90° only. All three Routing modes sit on one collision engine (`core/collide.js`, which also backs DRC):
- **Walkaround** (M4): the Track hugs the clearance contour of foreign copper and never moves anything.
- **Free** (M4): no constraint; collisions are highlighted.
- **Shove** (M6, then the default): a new Track or Via pushes existing Tracks and Vias aside, with spring-back when the cursor retreats. Dragging an existing Track segment or corner shoves its neighbours. Locked copper and Pads never move.

The Ratsnest is recomputed incrementally, as a minimum spanning tree per Net over the Pads and copper islands not yet joined.

**Zones refill live.** After each committed edit, only the Zones whose area the edit touched are refilled, in a Web Worker (`workers/zonefill.worker.js`, clipper-lib). While a drag or route is in progress, affected Zones draw as outlines. The new fill appears when the worker finishes. A stale result from a superseded edit is dropped. DRC and Fab output wait for any refill in progress.

**Cross-probing** (M3): selecting a Component or Net in one editor highlights it in the other. If the other editor is visible in a split view, it scrolls to show the selection.

## 6. Layer stack (2 or 4 layers)

| Layer | 2-layer | 4-layer |
|---|---|---|
| F.SilkS, F.Mask, F.Paste | ✓ | ✓ |
| F.Cu | ✓ | ✓ |
| In1.Cu | | ✓ (usually GND Zone) |
| In2.Cu | | ✓ (usually power Zone) |
| B.Cu | ✓ | ✓ |
| B.Paste, B.Mask, B.SilkS | ✓ | ✓ |
| Edge.Cuts (Outline), F/B.CrtYd, F/B.Fab | ✓ | ✓ |

Layer names follow KiCad so import and export are one-to-one. Eagle layers 1/2/15/16 map onto these at the converter boundary. v1 Vias always go from F.Cu to B.Cu.

## 7. Rules

- **ERC:**
  - an unconnected Pin (unless it is marked no-connect);
  - a Net with only one Pin;
  - two output Pins on one Net;
  - a power-input Pin with no driver;
  - two different label names on one Net;
  - a Pin with no matching Pad on the assigned Footprint.
- **DRC:**
  - copper-to-copper clearance (via the collision engine, per Net class);
  - track width, annular ring, hole size, edge clearance;
  - Courtyard overlap;
  - unrouted Nets (the Ratsnest is not empty);
  - Schematic/Board mismatch (Forward annotation is pending).
- **Fab presets** (`core/presets.js`): Generic plus 2–3 popular hobby fabs, each for 2- and 4-layer. Applying a preset copies its values into `board.rules` and the Fab output settings, which you can then edit. `board.preset` records the preset's name for display only.

## 8. Fab output

Gerber X2 for each copper, mask, paste and silk layer plus Edge.Cuts; Excellon for PTH and NPTH; a BOM grouped by Part, Value and MPN; and a pick-and-place CSV in mm with Y flipped (top-left origin to fab bottom-left). All of these are pure functions of the Project, which means they can be tested with golden files. All of this happens in the **Gerber** workspace tab. It generates the files and renders them back from the files themselves, so the user checks exactly what the board house will receive. It also opens external Gerber/Excellon files.

## 9. Interchange

Converters live in `io/kicad/*` and `io/eagle/*`, and each one returns `{ project, report }`, where `report` lists everything that was lost or approximated ([ADR-0004](adr/0004-native-format-is-json-foreign-formats-are-lossy-converters.md)).

- **KiCad:** an S-expression reader for 6, 7, 8 and 9 and a writer for 9 only. Units on disk are mm decimals, which convert exactly to nm. KiCad symbol units map one-to-one onto Part `units`.
- **Eagle (XML, 6+ and Fusion Electronics):** read and write via DOMParser/XMLSerializer. Units are mm and Y is up, so flip Y. Device/Gate/Connect map to Part/Unit/Pin map, and each Eagle technology becomes a Component Value or MPN. Eagle *signals* are re-derived through Forward annotation from the imported Schematic.
- **Board with no schematic** (either format): generate a stub Schematic, with one Component per Footprint and Global labels at each Pin carrying the board's net names, so ADR-0002 still holds. The report says so.

## 10. Storage

`platform.js` exposes one storage contract with two backends:

- **Desktop (Electron):** projects and libraries are real files and folders. A user Library folder lives in the app's data directory.
- **Browser:**
  - **IndexedDB** holds the recent-project list, autosave copies and user Libraries.
  - **Open/Save** uses the File System Access API where the browser has it (Chrome and Edge), so Save writes back to the same file. Elsewhere it falls back to upload and download.

## 11. Agents (MCP server)

[ADR-0009](adr/0009-mcp-server-over-core-commands.md). `src/mcp/` holds the tool layer. It depends only on `core/` and `library/`, so it runs in Node.

- **Transports:**
  - `electrocad-mcp` (stdio): tools take a project path, and `open_project`/`save_project` manage the file.
  - The desktop app (Streamable HTTP on 127.0.0.1, off by default, per-install token) works on the open Project and routes every call through `history.transact('MCP: …')`, so the user sees the changes live and can undo them.
- **Read:**
  - the Project resource (JSON, read-only);
  - `list_parts`, `get_component`, `get_netlist`, `get_board_summary`;
  - `run_erc`, `run_drc`.
- **Library:** `create_part` (Units, Pins, graphics), `generate_footprint` (SOIC-n, headers, chips…), `create_footprint`, `set_preferred_footprints`, `save_to_library`.
- **Schematic:**
  - `add_sheet`;
  - `place_component(part, unit?, footprint?, value?, at?)`, which auto-places on a free spot when `at` is missing;
  - `connect_pins(['R1.2','U1.3'], net?)`, which joins Pins with Wire stubs and Net labels;
  - `add_wire`, `add_net_label`, `add_global_label`, `add_power`, `add_no_connect`;
  - `set_component` (Reference designator, Value, MPN, fields), `set_footprint`, `delete`.
- **Board:**
  - `set_stack`, `set_outline`, `apply_fab_preset`, `set_rules`, `set_net_class`;
  - `forward_annotate`, `place_footprint(ref, at, rot, side)`;
  - `route_track(net, layer, waypoints, width?)`, which runs through the Walkaround router and fails with the blocking object and its clearance;
  - `add_via`, `add_zone`, `delete`.
- **Fab output:** `generate_fab_output(options)`, which returns file names and writes a zip (headless) or offers it in the Gerber tab (desktop); `export_bom`, `export_pick_and_place`.
- **Errors:** every tool validates through the same commands as the UI. A failed call changes nothing and returns a precise, glossary-worded reason.
- **Tests:** the tool layer is pure (Project in, Project plus result out), so it is tested on the core seam. One smoke test drives the headless server end to end, from creating a Part to generating Gerbers.

## 12. Milestones

| # | Milestone | Done when |
|---|---|---|
| **M1** | Scaffold | The app boots in a browser and in Electron; you can place parts, draw wires and see the live Netlist; save/open `.ecad`; undo/redo; netlist unit tests pass |
| M2 | Schematic complete | Multi-Sheet, local/global labels, power, no-connects, multi-Unit placement, ERC, hit-index, copy/paste, Symbol editor, print to PDF/SVG, generated starter Library |
| M3 | Board basics | Layer stack (2/4), Outline, Forward annotation, Footprint placement, Ratsnest, Footprint editor, Cross-probing |
| M4 | Routing and rules | Collision engine, Walkaround + Free routing, Vias, live Zones in a worker, Net classes, Fab presets, DRC |
| M5 | Fab output | Gerber/Excellon/BOM/PnP plus the Gerber viewer; golden-file tests — **first orderable board** |
| M6 | Push-and-shove | Shove mode (default) for Tracks and Vias, drag existing Tracks, spring-back |
| M7 | Interchange | KiCad (read 6+, write 9) and Eagle XML import/export of libraries, then schematics and boards, with loss reports |
| M8 | Polish | 3D preview (three.js, a 2D \| 3D switch on the Board toolbar), Back annotation, "Update from Library" diff, Electron packaging like DabbleCAD |

## 13. Open questions

None at present. All earlier questions were settled in the design review of 2026-11-24 (see ADR-0005 and ADR-0006).
