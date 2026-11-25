# The ElectroCAD Project file (`.ecad`), version 6

A Project is one JSON file, the Native format ([ADR-0004](../adr/0004-native-format-is-json-foreign-formats-are-lossy-converters.md)). This page describes every key the app writes today, for review and for anyone writing a tool that reads or writes `.ecad` files.

- **Schema:** [`ecad.schema.json`](ecad.schema.json) (JSON Schema 2020-12), generated from `src/renderer/core/ecad-schema.js`, which the app also uses to check every file it opens.
- **Example:** [`example.ecad`](example.ecad), an LED indicator on two Sheets that uses every feature below.
- **Kept honest by tests:** `test/formats.test.js` checks the example and freshly built Projects against the schema. The schema is strict, so a key the app starts writing fails the tests until it is documented here. Regenerate the example and the schema copy with `node tools/write-format-example.js`.
- **Code:** `src/renderer/core/project.js` (factories, `serialize`, `deserialize`, migrations).

## Conventions

| What | Rule |
| --- | --- |
| Encoding | UTF-8 JSON, indented one space, newline at the end. Short lists of plain values (points, layer lists) are written on one line, so a moved point is a one-line diff. Key order carries no meaning. |
| Lengths and coordinates | Integer **nanometres** ([ADR-0003](../adr/0003-integer-nanometre-coordinates.md)). 1 mm = 1,000,000; 1 mil = 25,400; the schematic grid (50 mil) = 1,270,000. |
| Axes | +X right, **+Y down** (screen and KiCad convention). |
| Points | `[x, y]`. |
| Rotation | Degrees, counter-clockwise **on screen**. The Schematic uses 0, 90, 180, 270; Board Footprints any angle in [0, 360), to 0.01° (the only non-integer geometry). |
| Mirror | A left-right flip (x → −x) in the object's own frame, applied **before** rotation. |
| Placing local points | `world = rotate(mirror(local), rot) + at`. For 90° CCW on screen, `(x, y) → (y, −x)`. Code: `place()` / `unplace()` in `core/geom.js`. |
| Ids | Strings, unique within the Project. The app makes random ones with a one-letter prefix: `p` Project, `s` Sheet, `c` Component, `y` Symbol, `w` Wire, `l` label. Parts are keyed by Library origin (`builtin-mini/resistor@1`), table Footprints by `library/name`. |
| References | By id or key: a Symbol's `componentId`, a Component's `partId` and `footprint`. Board objects refer to **Nets by name** ([ADR-0015](../adr/0015-board-objects-in-the-native-format.md)). |
| Not stored | Anything derived: Nets and their names, Junction dots, field positions (unless pinned), connected-pin marks, wire hops. |

## Versions and compatibility

- `format` is always `"electrocad"`. `version` is the format version, currently **7** (version 6 added the snap grids, grid origins and the Board's `annotation`; version 7 moved the Schematic's grid and origin onto each Sheet).
- **Before 1.0 there is no compatibility** ([ADR-0014](../adr/0014-no-file-compatibility-before-1-0.md)). `version` goes up with every format change, and a file of any other version is refused with a message saying which version wrote it. There are no migrations.
- **Opening is strict.** The file is checked against the schema, and then against what a schema can't express (`projectProblems()` in `project.js`):
  - ids unique across the file, Reference designators unique, Sheet names unique regardless of case;
  - every `partId`, `componentId`, `fpId`, `fpKey`, `fieldStyle` and `unit` points at something that exists;
  - Power symbols are global, and net names are non-empty with no spaces;
  - every Component is placed on some Sheet.

  Unknown keys are refused. A file with problems is not opened; the message lists them in plain words (`sheet "Indicator" symbol 1.rot: 45 is not one of [0,90,180,270]`).

## Project (top level)

| Key | Type | Meaning |
| --- | --- | --- |
| `format` | `"electrocad"` | File type marker. |
| `version` | `2` | Format version. |
| `id` | string | The Project's id; also its key in the Project store. |
| `name` | string | Shown on the home screen and in the title bar. |
| `parts` | `{ [partKey]: Part }` | A frozen copy of every Part in use ([ADR-0004](../adr/0004-native-format-is-json-foreign-formats-are-lossy-converters.md)), keyed by Library origin `library/partId@version` so Parts from different Libraries never clash. A Part with no origin (made in the Project) uses its own id. Parts nothing uses are removed. |
| `components` | `{ [componentId]: Component }` | The Components: one per Reference designator. |
| `footprints` | `{ [fpKey]: { library, footprint } }` | Footprints Components use that are not one of their Part's Preferred footprints, each stored once (`library/name`, with `~2`… if two differ). Unused ones are removed. |
| `schematic` | `{ sheets: [Sheet], textFont?, showSheetRefs? }` | At least one Sheet, in display order. `textFont`: `system` (absent: the default) or `vector`, how schematic text is drawn (#79). `showSheetRefs`: Global labels show the other sheets their net is on (#76); new Projects `true`, absent `false`. |
| `board` | Board | The PCB: the layer stack, the Outline and rules today. |
| `fieldStyles` | `{ default, styles }` | `default` is a key in `styles`; `styles` holds every Field style the Project uses ([ADR-0012](../adr/0012-fields-are-placed-automatically-by-field-styles.md)). |
| `titleBlock` | `{ title, company, author, revision, date, comment }` | The title block on every Sheet (#59); an empty title shows the Project name. Sheet name and number are filled in per Sheet. |

## Part

A generic Part ([ADR-0005](../adr/0005-generic-multi-unit-parts.md)): its Symbol Units, Preferred footprints and Pin maps.

| Key | Type | Meaning |
| --- | --- | --- |
| `id` | string | Same as its key in `parts`. |
| `name` | string | Shown in the Part picker and inspector. |
| `prefix` | string | Reference designator prefix: `R`, `C`, `D`, `U`… |
| `defaultValue` | string? | The Value a new Component gets. |
| `keywords` | string? | Space-separated words for the picker's search. |
| `origin` | `{ library, partId, version }`? | Library origin: the Part's key, and Update from Library (#39). Omitted for a Part made in the Project. |
| `units` | `[Unit]` | At least one. Unit *n* of a Component is placed as a Symbol with `unit: n`. |
| `footprints` | `{ [fpId]: Footprint }`? | Preferred footprints. |
| `pinMap` | `{ [fpId]: { [pinNumber]: padNumber } }`? | Pin → Pad per Preferred footprint. A missing entry means Pin *n* → Pad *n*. |

**Unit** (the Symbol drawing of one Unit, in its own frame with the origin at the Symbol's `at`):

| Key | Type | Meaning |
| --- | --- | --- |
| `name` | string | `A`, `B`… |
| `hidePinNumbers`, `hidePinNames` | boolean? | Drawing switches. |
| `graphics` | `[Shape]` | The body. |
| `pins` | `[Pin]` | See below. |

A Unit says nothing about where fields go: Field styles place them ([ADR-0012](../adr/0012-fields-are-placed-automatically-by-field-styles.md)).

**Pin:** `number` (string), `name` (`"~"` = none), `at` (the connection tip, on the 50 mil grid), `dir` (`L`/`R`/`U`/`D`, from the tip into the body), `length` (nm), `type` (`passive`, `input`, `output`, `bidirectional`, `tri_state`, `power_in`, `power_out`, `open_collector`, `open_emitter`, `unspecified`, `no_connect`; used by ERC, #11). Optional (#63): `shape` (`line`, the default; `inverted`, a bubble at the body; `clock`, a wedge inside it; `inverted-clock`), and `showName` / `showNumber` (`false` hides this Pin's name or number, whatever the Unit's switches).

**Overbars** (#63): in pin names, Net labels (so Net names), fields and Schematic text, `~{…}` draws a bar over the text inside, as KiCad writes it: `~{RESET}`, `IS/~{RD}`. An unclosed `~{` runs to the end; a `~` not followed by `{` is itself. The text is drawn and measured without the markup.

**Shape** (Symbol bodies and Footprint graphics):

| `type` | Keys |
| --- | --- |
| `rect` | `a`, `b` (opposite corners) |
| `line` | `pts` (a polyline, at least 2 points) |
| `poly` | `pts` (closed when it has a fill) |
| `circle` | `c` (centre), `r` (radius, nm) |
| `arc` | `start`, `mid` (any point on the arc), `end`: three points, so no angles are stored and the ends meet the next segment exactly |
| `text` | `at` (the centre), `text`, `size` (height, nm); drawn upright whatever the rotation |

Every shape may have `fill` (`none`, `background` = the theme's symbol fill, `outline` = filled with the line colour), `width` (a **multiplier** on the standard line width, not nm) and, in Footprints, `layer` (`F.SilkS`, `F.CrtYd`, `F.Fab`…).

**Footprint:** `name`, `pads`, and optional `graphics` (Shapes with a `layer`). A **Pad** has `number`, `at`, `shape` (`rect`, `circle`, `oval`, `roundrect`), `size` (`[w, h]`), `layers` (e.g. `["F.Cu", "F.Paste", "F.Mask"]`) and, for through-hole, `drill`.

Footprint text (#84) can carry `rot` (degrees, relative to the Footprint; it turns with it and is kept readable), `align` (Eagle's anchors: `at` is that point of the text, placed with the real string) and `spin` (never turned the other way up). Text without `rot` is drawn upright, centred on `at`.

Courtyard rectangles and circles may carry `generated: true` (#67): an importer made them because the library had none (older Eagle imports; current ones make none), and DRC reports their overlaps as warnings. Pads may be `chamfer` (#70): a rectangle with corners cut by `chamfer` (a fraction of the shorter side, default 0.2929: a regular octagon on a square) at `corners` (`tl`, `tr`, `br`, `bl`; default all). Through-hole pads may carry `innerSize` (#82): their diameter on the inner copper layers, where they are round. Zones may carry `minWidth` (#82): copper narrower than it is left out of the fill.

## Component

| Key | Type | Meaning |
| --- | --- | --- |
| `id` | string | Key in `components`. |
| `partId` | string | Key in `parts`. |
| `ref` | string | Reference designator. Unique in the Project, no spaces. |
| `value` | string | **As typed.** A Field style's Value format (RKM, SI) changes only how it is drawn. |
| `mpn` | `{ manufacturer, number }` or `null` | Ordering details. |
| `footprint` | `{ fpId }`, `{ fpKey }` or `null` | `fpId`: a Preferred footprint, key in the Part's `footprints`, Pins mapped by its `pinMap`. `fpKey`: any other Footprint, key in the Project's `footprints`, Pin *n* → Pad *n* ([ADR-0008](../adr/0008-footprint-is-a-live-component-property.md)). |
| `fields` | `{ [name]: string }` | Custom fields (the inspector's Custom fields). |
| `fieldStyle` | string? | Key in `fieldStyles.styles`. Absent means the Project default. |

## Sheet

| Key | Type | Meaning |
| --- | --- | --- |
| `id` | string | |
| `name` | string | Unique in the Project regardless of case; no `/` (used in qualified Net names like `Power/EN`). |
| `symbols` | `[Symbol]` | Placed Units. |
| `wires` | `[Wire]` | |
| `busses` | `[Bus]`? | Bus segments (#64). Optional. |
| `labels` | `[Label]` | Net labels, Global labels and Power symbols; and Bus labels (`bus: true`, #64), which show their Bus's name and name no Net. |
| `noConnects` | `[{ id, at }]` | No-connect markers on Pin tips (#11); always empty today. |
| `drawings` | `[Drawing]` | Markup (#59): text notes, lines, rectangles, circles and arcs. Never connects. |
| `paper` | `{ size, orientation }` | `A4`, `A3`, `A2`, `Letter` or `Tabloid`; `landscape` or `portrait`. Sets the frame and the print size. |
| `grid` | `{ main, alt }` | This Sheet's snap grids in nm (default 50 and 25 mil). Alt selects `alt` while drawing, moving or resizing; markup snaps to half the grid. |
| `origin` | point | This Sheet's grid origin, from the paper's top-left corner (default `[0, 0]`). The grid, rulers and coordinates measure from it. |

**Symbol** (one placed Unit):

| Key | Type | Meaning |
| --- | --- | --- |
| `id` | string | |
| `componentId` | string | Key in `components`. |
| `unit` | integer | Index into the Part's `units`. |
| `at` | point | Origin, on the 50 mil grid. |
| `rot` | 0, 90, 180, 270 | |
| `mirror` | boolean | |
| `fieldPins` | `{ [fieldKey]: point }`? | Fields dragged by hand (#53): the text centre in the Symbol's **own frame**, so the field follows the Symbol when it moves, rotates or mirrors (the text is always drawn upright). Field keys: `reference`, `value`, `footprint`, `mpn`. Absent when no field is pinned; Re-apply style removes it. |
| `locked` | boolean? | A locked part doesn't move, rotate or mirror; its origin shows a × instead of a +. Absent when unlocked. |

**Wire:** `{ id, a, b }`. A straight run between two grid points (the editor only draws horizontal and vertical runs). Wires connect where an end touches another Wire's end or runs into its middle (a T), or touches a Pin tip. Crossing Wires don't connect. A Wire end on a Bus (a bus entry) joins only its own Wire there, not a Wire crossing the Bus at that point (#64).

**Bus** (#64): `{ id, a, b, name }`, a straight run drawn like a thick Wire. Segments that touch are one Bus and share its `name`, which lists its members in Eagle's notation: names and ranges separated by commas, `D[0..7]` (D0 to D7, either way round), `A,B,~{WR}`; KiCad's group `{SDA SCL}` is read too. A Bus connects nothing: Nets cross it by name, and ERC warns when a Net entering it isn't a member or when it has no name.

**Label:**

| Key | Type | Meaning |
| --- | --- | --- |
| `id` | string | |
| `at` | point | Connection point. |
| `rot` | 0, 90, 180, 270 | Net and Global labels are drawn so their text never reads upside down. |
| `net` | string | Net name, stored **as typed**; names match regardless of case ([ADR-0013](../adr/0013-net-names-match-regardless-of-case.md)). |
| `scope` | `local` / `global` | `local` joins Pins with the same name on this Sheet; `global` on every Sheet. |
| `style` | `label` / `power` / `gnd` | `power` and `gnd` are Power symbols and always have `scope: "global"`. |
| `shape` | `text` / `flag`? | How a Net or Global label looks (#81): the name on the wire, or a pointed flag. Absent: by scope (`local` text, `global` flag). It never changes what the label joins. |
| `size` | nm? | Text height. Absent: 1.27 mm. |
| `showRefs` | boolean? | A Global label's own choice to show sheet references (#76). Absent: the Schematic's `showSheetRefs`. The sheet numbers themselves are never stored; they come from the Netlist. |

How Nets are built from these (not stored): see [DESIGN.md §4](../DESIGN.md#4-connectivity-netlist) and `core/netlist.js`. In short: a Net's name comes from its labels (Power symbol before Global label before Net label), or is generated as `Net-(R1-Pad2)` from its lowest Reference designator.

**Drawing** (markup on a Sheet; `style` is `solid`, `dashed` or `dotted`):

| `type` | Keys |
| --- | --- |
| `text` | `at` (start, middle or end of the first line, by `align`), `text` (may hold `${TITLE}`… variables, stored raw), `size` (nm), `bold`, `italic`, `align` (`left`/`center`/`right`), `rot` (0 or 90) |
| `line` | `pts` (a polyline), `style`, `arrowStart`, `arrowEnd` |
| `rect` | `a`, `b`, `style`, `fill` (`none` or `tint`) |
| `circle` | `c`, `r`, `style`, `fill` |
| `arc` | `start`, `mid`, `end`, `style` |

## Board

The shapes are fixed by [ADR-0015](../adr/0015-board-objects-in-the-native-format.md). `stack`, `preset`, `outline` and `rules` have content today; the lists fill in as the Board tickets land.

| Key | Type | Meaning |
| --- | --- | --- |
| `stack` | `{ copper: 2 \| 4, thickness }` | Layer stack. Copper layers: `F.Cu`, `B.Cu`, plus `In1.Cu`, `In2.Cu` for 4 layers. |
| `preset` | string | The Fab preset the rules came from, for reference only (#24): `generic-2`, `generic-4`, `jlcpcb-2`, `jlcpcb-4`, `pcbway-2`, `pcbway-4`, `oshpark-2`, `oshpark-4` (`core/presets.js`). The rules can be edited after applying it. |
| `fab` | `{ naming: 'protel' \| 'kicad', drillUnits: 'mm' \| 'inch' }` (optional) | Fab output settings, filled by the preset, editable; used by the Fab output (#26). |
| `rules` | `{ clearance, trackWidth, viaDrill, viaDiameter, minHole, annularRing, edgeClearance }` | Design rules, all nm. |
| `outline` | `[Shape]` | Edge.Cuts (#15): `rect` and `circle` shapes, and `line` (two points) and `arc` (start, mid, end) segments that must form closed loops. Segment ends must meet **exactly**, to the nanometre. A rounded rectangle or a polygon is stored as lines and arcs. A loop inside another loop's extents is a cut-out. Layer visibility and the active layer are per-browser settings and are not saved here. |
| `footprints` | `[{ id, componentId, at, rot, side, locked, texts? }]` | Where each Component sits (#17). `rot` is any angle (degrees, [0, 360), to 0.01°); `side` is `F` or `B`. Pads and graphics come from the Component's footprint, not copied. `texts` (#65): this placement's own Reference / Value text, `{ ref?, value? }`, each `{ at, rot, size, layer, hidden? }` in the Footprint's frame (`at` the text's centre; `rot` relative to the Footprint; `layer` as on a front-side Footprint, swapped on the back). Absent: where the Footprint draws them. |
| `tracks` | `[{ id, a, b, width, layer, net }]` | Straight copper segments (#20). `layer` a copper layer, `net` a Net name. |
| `vias` | `[{ id, at, drill, diameter, from, to, net }]` | v1 has through vias only: `from: "F.Cu"`, `to: "B.Cu"` (#21). |
| `zones` | `[{ id, layer, net, outline, priority, clearance, connect?, thermal: { gap, spoke } }]` | Copper pours (#23). `outline` has at least 3 points. `priority`: higher fills first and wins overlaps with other Nets. `clearance`: the least gap to other Nets' copper (the Net classes' clearance applies when larger; 0 for just the classes'). `connect`: `thermal` (default) or `solid`, how same-Net pads join. `thermal.gap` and `thermal.spoke`: the relief's gap round a pad and its spoke width. The fill is **not stored**; it is recomputed. |
| `netClasses` | `{ [name]: { trackWidth, clearance, viaDrill, viaDiameter, nets } }` | `nets` is a list of Net names (#24). |
| `drawings` | `[BoardDrawing]`? | The Board's own text and graphics (#66) on any silk, fab, courtyard, mask, paste or copper layer: `{ id, type, layer, … }` with `text { text, at (centre), size, rot }`, `line { pts }`, `arc { start, mid, end }`, `rect { a, b }`, `circle { c, r }`, `poly { pts }`. Shapes have an optional `width` (pen, nm; absent: the layer's default) and `fill: "outline"`. Text is mirrored on `B.*` layers. Copper drawings have no Net. Absent: none. |
| `textFont` | `stroke` / `vector`? | Board text metrics, on screen and in the silk Gerbers (#79): ElectroCAD's stroke font, size = capital height (absent: the default), or Eagle's vector font, size = full height. |
| `grid` | `{ main, alt }` | Snap grids in nm (default 0.5 and 0.1 mm). |
| `origin` | point | The grid origin (default `[0, 0]`). |
| `annotation` | `{ components: { [componentId]: { ref, value } }, nets: { [netName]: ["componentId:pad"] } }` | What the Board was last told by Forward annotation (#16). The Board draws References, Values and Pad nets from here; the next annotation lists the differences against the Schematic. |

Board objects refer to Nets **by name**, matched regardless of case. Nets themselves are never stored: the Schematic is their source ([ADR-0002](../adr/0002-schematic-is-the-source-of-truth-for-nets.md)).

## Field style

Embedded in `fieldStyles.styles`, and the body of a Field style file (below).

| Key | Type | Meaning |
| --- | --- | --- |
| `id`, `name` | string | |
| `builtin` | boolean? | A copy of a built-in style (Classic, Compact, Stacked right, RKM). |
| `arrangement` | `stacked` / `one-line` | One field per line, or all on one line (`R1 10k`). |
| `show` | `{ reference, value, footprint, mpn, hideValueIfPartName }` | Which fields are drawn. |
| `text` | `{ size, bold, italic, gap }` | `size` and `gap` (space from the body) in nm. |
| `valueFormat` | `as-typed` / `rkm` / `si` | Display only. |
| `placement` | `{ horizontal: [slot], vertical: [slot] }` | Slots to try in order, for horizontal and vertical Symbols: `split` (Reference above, Value below), `above`, `below`, `right`, `left`. |

## Review history

Format version 3 resolved the points raised in the first review of version 2:

| Point | Resolution |
| --- | --- |
| Every coordinate on its own line made files long and diffs noisy | Short lists are written on one line; the example went from 823 to 517 lines. |
| No rule for when the version goes up | [ADR-0014](../adr/0014-no-file-compatibility-before-1-0.md): every change, no compatibility before 1.0. |
| Opening only checked the structure | Opening checks the full schema plus cross-references, and lists every problem. |
| Parts keyed by Library id could clash | Keyed by Library origin (`library/partId@version`). |
| Non-preferred Footprints copied into every Component | The Project `footprints` table, referenced by `fpKey`. |
| `Unit.fields` unused | Removed. |
| Board object shapes undecided | [ADR-0015](../adr/0015-board-objects-in-the-native-format.md), and in the schema. |

## Other files

| File | Where | Format |
| --- | --- | --- |
| Colour theme (`.json`) | Settings → Colours → Export / Import | `{ format: "electrocad-theme", version: 1, kind: "schematic" \| "board", name, colors: { [token]: "#rrggbb" \| number } }`. Token ids are `TOKENS` in `core/themes.js` (e.g. `wire`, `netLabel`, `F.Cu`; `zoneOpacity` is a number from 0 to 1). On import, missing tokens are filled from Match app (dark), unknown ones are ignored, bad colours are refused. |
| User Library (`.ecadlib`) | Desktop: `<userData>/libraries/<id>.ecadlib`. Browser: IndexedDB store `libraries` | `{ format: "electrocad-library", version: 2, id, name, parts: { [partId]: Part }, footprints: { [footprintId]: Footprint } }`. A Footprint is the Native format's Footprint (`name`, `pads`, `graphics`); its id is made from its name. A version 1 Library, which had no footprints, opens with an empty table. A Part is the Native format's Part plus the Library-only `category` and `manufacturer`, with `origin: { library: <Library id>, partId, version }`; the version goes up on each save with changes. The id is made from the first name and kept on rename, so Projects' origins still match. Opening checks every Part and Footprint against the schema. Code: `core/library.js`. |
| Field style (`.json`) | Settings → Field styles → Export / Import | `{ format: "electrocad-field-style", version: 1, ...Field style without id and builtin }`. On import, missing settings come from Classic; a bad slot, value format or text size is refused. |
| Project store, desktop | `<userData>/projects/<id>.ecad`, plus `index.json` | Each Project is an `.ecad` file. `index.json` maps id → `{ id, name, modified (ms), components, layers, thumb }`, where `thumb` is a PNG data URL for the home screen. Both are written atomically (temp file + rename). |
| Project store, browser | IndexedDB database `electrocad`, stores `projects` and `meta` | Same content: `projects[id]` is the `.ecad` text, `meta[id]` the card metadata. |
| App settings | Desktop: `<userData>/settings.json`. Browser: `localStorage` | `theme`, `units`, `workspace`, `lastProject`, `colorThemes`, `customThemes`, `customFieldStyles`, `schematicDisplay`. Not part of a Project. |
| Card positions | `localStorage` keys `electrocad.card.schematic-*` | `{ left, top, w, h }` in px for each floating card. Per browser only. |
