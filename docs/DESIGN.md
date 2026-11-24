# ElectroCAD design

A schematic-capture and PCB-layout editor for 2- and 4-layer hobbyist boards. It runs in the browser and as a desktop app. Terms in **bold** are defined in [CONTEXT.md](../CONTEXT.md), and the decisions behind this design are in [adr/](adr/).

## 1. Goals for v1

| Area | In v1 | Later |
|---|---|---|
| Schematic | Multi-sheet flat schematic, Wires, Junctions, Net labels, Power symbols, ERC | Hierarchical sheets, buses |
| Library | Built-in starter Library, Part/Symbol/Footprint editors, KiCad and Eagle library import | Online part search |
| Board | 2 or 4 copper layers, Outline, Footprint placement, manual Track routing with walkaround, through Vias, Zones, Net classes, DRC | Push-and-shove, blind/buried vias, diff pairs, length tuning |
| Sync | Forward annotation with a change list, Back annotation of Reference designators and Footprints | Live cross-probing with highlights both ways (cheap, may slip into v1) |
| Output | Gerber RS-274X (X2 attributes), Excellon drill, BOM CSV, pick-and-place CSV, PDF/SVG schematic print | ODB++, IPC-2581, STEP |
| Interchange | Native `.ecad`; import and export KiCad 7+ (`.kicad_sch`, `.kicad_pcb`, `.kicad_sym`, `.kicad_mod`) and Eagle 7+/Fusion XML (`.sch`, `.brd`, `.lbr`) | Altium, EasyEDA import |
| 3D | — | Board preview with three.js (DabbleCAD already ships it) |

Non-goals: simulation, autorouting, and multi-user real-time editing.

## 2. Architecture

```
src/renderer/
  main.js              boot, wires App to the platform
  app.js               shell: tabs (Schematic | Board | Library), menus, panels, shortcuts, file I/O
  platform.js          desktop / browser bridge (same contract as DabbleCAD)
  core/                pure model code — no DOM, unit-tested with node --test
    units.js           nm ↔ mm/mil, grids, formatting
    geom.js            points, transforms (rot/mirror), segment maths
    project.js         Project model, factory functions, (de)serialise, version migrations
    history.js         undo/redo transactions
    netlist.js         Schematic → Netlist (union-find over connection points)
    annotate.js        forward/back annotation diff + apply            (M3)
    drc.js / erc.js    rule checks                                     (M4/M2)
    zonefill.js        Zone fill with clipper-lib                      (M4)
  library/             built-in Parts, Symbol/Footprint generators (resistor, SOIC-n, header-n…)
  view/
    canvas.js          pan/zoom/grid Canvas2D viewport shared by both editors
    hit.js             hit testing + spatial index                    (M2)
  schematic/           schematic editor: renderer + tools (select, place, wire, label)
  board/               board editor: renderer + tools (place, route, via, zone, outline)
  io/                  importers/exporters — kicad/, eagle/, gerber/, excellon/, bom/  (M5–M6)
  ui/                  DOM helpers, panels, dialogs (ported from DabbleCAD's ui/ where it fits)
electron/              main.js + preload.js exposing window.electroNative
tools/                 run.js (launch Electron), smoke tests
```

The **core** layer is plain data and pure functions. Editors read the Project, and every change goes through `history.transact(label, fn)`, which snapshots the Project, applies `fn` and records an undo step. Snapshot undo is simple and plenty fast at hobby-board sizes (a few thousand objects). If profiling ever says otherwise, it can be swapped for patch-based undo behind the same interface.

## 3. Data model (Native format)

Every object has a stable string `id`. Coordinates are integer nm with +Y down ([ADR-0003](adr/0003-integer-nanometre-coordinates.md)). Rotation is in degrees, counter-clockwise on screen, and v1 restricts it to multiples of 90° in the Schematic (any angle on the Board).

```js
Project {
  format: 'electrocad', version: 1, id, name,
  parts:      { [partId]: Part },        // embedded copies of every Part used
  components: { [componentId]: { id, partId, ref, value, footprintId, fields: {} } },
  schematic:  { sheets: [ Sheet ] },
  board:      Board,
}

Part      { id, name, prefix: 'R', symbol: Symbol, footprints: { [fpId]: Footprint }, pinMap: { [fpId]: { [pin]: pad } } }
Symbol    { graphics: [ Shape ], pins: [ { number, name, at:[x,y], dir:'L'|'R'|'U'|'D', length, type } ] }
Footprint { name, pads: [ { number, at, shape:'rect'|'circle'|'oval'|'roundrect', size:[w,h], drill?, layers } ],
            graphics: [ Shape on F.SilkS / F.CrtYd / F.Fab ] }

Sheet     { id, name, symbols: [ { id, componentId, at, rot, mirror } ],
            wires: [ { id, a, b } ], labels: [ { id, at, rot, net, style:'label'|'gnd'|'power' } ] }

Board     { stack: { copper: 2|4, thickness }, outline: [ Shape ],
            footprints: [ { id, componentId, at, rot, side:'F'|'B', locked } ],
            tracks: [ { id, a, b, width, layer, net } ], vias: [ { id, at, drill, diameter, net } ],
            zones:  [ { id, layer, net, outline:[pts], priority, clearance, thermal } ],
            rules:  { clearance, trackWidth, viaDrill, viaDiameter, minHole, edgeClearance },
            netClasses: { [name]: { trackWidth, clearance, viaDrill, viaDiameter, nets:[...] } } }
```

`Board` objects refer to Nets **by name**. Names are stable because every unlabelled Net gets a generated name from its lowest Reference designator and Pad (`Net-(R1-Pad2)`). Forward annotation renames board copper when a Net's name changes.

## 4. Connectivity (Netlist)

`core/netlist.js` turns a Schematic into a Netlist:

1. Gather connection points: every Pin tip (Symbol transform applied) and every Wire endpoint.
2. Union-find: join the two ends of each Wire; join any point that lies on a Wire (including mid-segment T-joins); join coincident points; join labels to the point they sit on; join all labels of the same name, across Sheets.
3. Every resulting set that touches at least one Pin is a Net. It is named after its label (a Power symbol wins over a plain label, and a clash between two names is reported as an ERC error), or `Net-(REF-PadN)` otherwise.
4. Pins map to Pads through the Component's Part Pin map, giving the board-side `pad → net` table.

Junction dots are *drawn* where three or more Wire ends meet or a Wire end lands mid-wire. They are derived, not stored.

## 5. Editors

Both editors share `view/canvas.js`: a Canvas2D viewport with wheel zoom about the cursor, middle- or right-drag pan, a grid, and a screen↔world transform. Rendering redraws the whole scene each frame and only runs when something changes. A spatial index (an R-tree or uniform grid) arrives at M2 for hit testing and DRC. If large boards get slow, WebGL is a renderer swap behind the same draw-list interface.

**Schematic tools:** Select/move (V), Place part (A), Wire (W, orthogonal, auto-ends on a Pin or Wire), Net label (L), GND/Power (G/P), Rotate (R), Mirror (X), Delete, plus Undo/Redo (Ctrl+Z / Ctrl+Shift+Z). Grid: 50 mil (1.27 mm), the KiCad convention, so KiCad symbols land on-grid.

**Board tools:** Select/move, Route (X; switch layer with V, which drops a Via), Via, Zone, Outline, Measure. Routing in v1 is *walkaround*: the track being drawn follows the cursor at 45°/90° and stops at the clearance boundary of foreign copper. Push-and-shove comes later. The Ratsnest is recomputed incrementally, as a minimum spanning tree per Net over the Pads and copper islands not yet joined.

**Cross-probing:** selecting a Component or Net in one editor highlights it in the other.

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

Layer names follow KiCad so import and export are one-to-one. Eagle layers 1/2/15/16 map onto these at the converter boundary.

## 7. Rule checks

- **ERC:** an unconnected Pin (unless it is marked no-connect), a Net with only one Pin, two output Pins on one Net, a power-input Pin with no driver, conflicting labels on one Net.
- **DRC:** copper-to-copper clearance (Clipper offset plus polygon intersection, per Net class), track width, annular ring, hole size, edge clearance, Courtyard overlap, unrouted Nets (the Ratsnest is not empty), and Schematic/Board mismatch (Forward annotation is pending).

## 8. Fab output

Gerber X2 for each copper, mask, paste and silk layer plus Edge.Cuts; Excellon for PTH and NPTH; a BOM grouped by Part and Value; and a pick-and-place CSV in mm with Y flipped (top-left origin to fab bottom-left). All of these are pure functions of the Project, which means they can be tested with golden files. A built-in Gerber viewer re-renders the output so the user can check it before ordering.

## 9. Interchange

Converters live in `io/kicad/*` and `io/eagle/*`, and each one returns `{ project, report }`, where `report` lists everything that was lost or approximated ([ADR-0004](adr/0004-native-format-is-json-foreign-formats-are-lossy-converters.md)).

- **KiCad:** an S-expression reader/writer. Units are already nm on disk (as mm decimals), so the only thing to remap is symbol units (KiCad multi-unit symbols ↔ our single Symbol; v1 imports each unit as a separate Symbol on the same Component).
- **Eagle:** XML via DOMParser. Units are mm and Y is up, so flip Y. A Device/Gate/Connect maps to Part/Symbol/Pin map, and Eagle *signals* are re-derived through Forward annotation from the imported Schematic.

## 10. Milestones

| # | Milestone | Done when |
|---|---|---|
| **M1** | Scaffold (this commit) | The app boots in a browser and in Electron; you can place parts, draw wires and see the live Netlist; save/open `.ecad`; undo/redo; netlist unit tests pass |
| M2 | Schematic complete | Multi-sheet, labels/power, ERC, hit-index, copy/paste, Symbol editor, print to PDF/SVG |
| M3 | Board basics | Layer stack, Outline, Forward annotation, Footprint placement, Ratsnest, Footprint editor |
| M4 | Routing and rules | Track/Via routing with walkaround, Zones with fill, Net classes, DRC |
| M5 | Fab output | Gerber/Excellon/BOM/PnP plus the Gerber viewer; golden-file tests |
| M6 | Interchange | KiCad and Eagle import/export of libraries, then schematics and boards, with loss reports |
| M7 | Polish | 3D preview (three.js), Back annotation, cross-probing, Electron packaging like DabbleCAD |

## 11. Open questions

1. **Multi-unit Parts** (for example a quad op-amp): does v1 need them? They affect the Symbol model (one Symbol vs `units: [Symbol]`) and KiCad/Eagle import fidelity. *Recommendation:* model `units` from day one even if the UI only edits one.
2. **Library storage outside a Project:** a user library folder (desktop) or IndexedDB (browser)? Probably both, behind `platform.js`, the same way DabbleCAD handles designs.
3. **Hosting the web version:** GitHub Pages like DabbleCAD-preview?
