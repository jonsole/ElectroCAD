# The ElectroCAD Project file (`.ecad`), version 2

A Project is one JSON file, the Native format ([ADR-0004](../adr/0004-native-format-is-json-foreign-formats-are-lossy-converters.md)). This page describes every key the app writes today, for review and for anyone writing a tool that reads or writes `.ecad` files.

- **Schema:** [`ecad.schema.json`](ecad.schema.json) (JSON Schema 2020-12).
- **Example:** [`example.ecad`](example.ecad), an LED indicator on two Sheets that uses every feature below.
- **Kept honest by tests:** `test/formats.test.js` checks the example and freshly built Projects against the schema. The schema is strict, so a key the app starts writing fails the tests until it is documented here. Regenerate the example with `node tools/write-format-example.js`.
- **Code:** `src/renderer/core/project.js` (factories, `serialize`, `deserialize`, migrations).

## Conventions

| What | Rule |
| --- | --- |
| Encoding | UTF-8 JSON, indented one space, newline at the end. Key order carries no meaning. |
| Lengths and coordinates | Integer **nanometres** ([ADR-0003](../adr/0003-integer-nanometre-coordinates.md)). 1 mm = 1,000,000; 1 mil = 25,400; the schematic grid (50 mil) = 1,270,000. |
| Axes | +X right, **+Y down** (screen and KiCad convention). |
| Points | `[x, y]`. |
| Rotation | Degrees, counter-clockwise **on screen**. The Schematic uses 0, 90, 180, 270. |
| Mirror | A left-right flip (x → −x) in the object's own frame, applied **before** rotation. |
| Placing local points | `world = rotate(mirror(local), rot) + at`. For 90° CCW on screen, `(x, y) → (y, −x)`. Code: `place()` / `unplace()` in `core/geom.js`. |
| Ids | Strings, unique within the Project. The app makes random ones with a one-letter prefix: `p` Project, `s` Sheet, `c` Component, `y` Symbol, `w` Wire, `l` label. Built-in Part ids are readable (`mini-resistor`). |
| References | By id: a Symbol's `componentId`, a Component's `partId`. The Board will refer to **Nets by name** (see [Board](#board)). |
| Not stored | Anything derived: Nets and their names, Junction dots, field positions (unless pinned), connected-pin marks, wire hops. |

## Versions and compatibility

- `format` is always `"electrocad"`. `version` is the format version, currently **2**.
- **Opening an older file:** it is migrated step by step (`MIGRATIONS` in `project.js`). Version 1 → 2 adds `fieldStyles` (Classic).
- **Opening a newer file:** refused with a message asking the user to update ElectroCAD. Nothing is guessed.
- **Unknown keys:** readers ignore them and the app keeps them when it saves, so a file edited by a newer app survives a round trip through an older one, as long as the version didn't change.
- **When the version goes up:** whenever an older reader would *misread* a file, not merely miss a feature. Optional keys an older app can safely ignore have been added without a bump; see [Review points](#review-points).
- **What opening checks** (`validate()`): the top-level structure, that every Sheet has its four lists, that Symbols point at existing Components and Components at existing Parts, the shape and kind of each label, a 2- or 4-layer stack, the Board's lists, and the Field styles. It does not check every value against the schema.

## Project (top level)

| Key | Type | Meaning |
| --- | --- | --- |
| `format` | `"electrocad"` | File type marker. |
| `version` | `2` | Format version. |
| `id` | string | The Project's id; also its key in the Project store. |
| `name` | string | Shown on the home screen and in the title bar. |
| `parts` | `{ [partId]: Part }` | A frozen copy of every Part in use ([ADR-0004](../adr/0004-native-format-is-json-foreign-formats-are-lossy-converters.md)). Parts nothing uses are removed. |
| `components` | `{ [componentId]: Component }` | The Components: one per Reference designator. |
| `schematic` | `{ sheets: [Sheet] }` | At least one Sheet, in display order. |
| `board` | Board | The PCB. Only the layer stack and rules are written today. |
| `fieldStyles` | `{ default, styles }` | `default` is a key in `styles`; `styles` holds every Field style the Project uses ([ADR-0012](../adr/0012-fields-are-placed-automatically-by-field-styles.md)). |

## Part

A generic Part ([ADR-0005](../adr/0005-generic-multi-unit-parts.md)): its Symbol Units, Preferred footprints and Pin maps.

| Key | Type | Meaning |
| --- | --- | --- |
| `id` | string | Key in `parts`. |
| `name` | string | Shown in the Part picker and inspector. |
| `prefix` | string | Reference designator prefix: `R`, `C`, `D`, `U`… |
| `defaultValue` | string? | The Value a new Component gets. |
| `keywords` | string? | Space-separated words for the picker's search. |
| `origin` | `{ library, partId, version }`? | Library origin, for Update from Library (#39). |
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
| `fields` | `{ reference: { at }, value: { at } }`? | Library hint only. Field styles place fields; this is kept for import and export. |

**Pin:** `number` (string), `name` (`"~"` = none), `at` (the connection tip, on the 50 mil grid), `dir` (`L`/`R`/`U`/`D`, from the tip into the body), `length` (nm), `type` (`passive`, `input`, `output`, `bidirectional`, `tri_state`, `power_in`, `power_out`, `open_collector`, `open_emitter`, `unspecified`, `no_connect`; used by ERC, #11).

**Shape** (Symbol bodies and Footprint graphics):

| `type` | Keys |
| --- | --- |
| `rect` | `a`, `b` (opposite corners) |
| `line` | `pts` (a polyline, at least 2 points) |
| `poly` | `pts` (closed when it has a fill) |
| `circle` | `c` (centre), `r` (radius, nm) |

Every shape may have `fill` (`none`, `background` = the theme's symbol fill, `outline` = filled with the line colour), `width` (a **multiplier** on the standard line width, not nm) and, in Footprints, `layer` (`F.SilkS`, `F.CrtYd`, `F.Fab`…).

**Footprint:** `name`, `pads`, and optional `graphics` (Shapes with a `layer`). A **Pad** has `number`, `at`, `shape` (`rect`, `circle`, `oval`, `roundrect`), `size` (`[w, h]`), `layers` (e.g. `["F.Cu", "F.Paste", "F.Mask"]`) and, for through-hole, `drill`.

## Component

| Key | Type | Meaning |
| --- | --- | --- |
| `id` | string | Key in `components`. |
| `partId` | string | Key in `parts`. |
| `ref` | string | Reference designator. Unique in the Project, no spaces. |
| `value` | string | **As typed.** A Field style's Value format (RKM, SI) changes only how it is drawn. |
| `mpn` | `{ manufacturer, number }` or `null` | Ordering details. |
| `footprint` | `{ fpId }`, `{ library, footprint }` or `null` | A Preferred footprint (by key in the Part's `footprints`), or any other Footprint embedded in full; the latter maps Pin *n* → Pad *n* ([ADR-0008](../adr/0008-footprint-is-a-live-component-property.md)). |
| `fields` | `{ [name]: string }` | Custom fields (the inspector's Custom fields). |
| `fieldStyle` | string? | Key in `fieldStyles.styles`. Absent means the Project default. |

## Sheet

| Key | Type | Meaning |
| --- | --- | --- |
| `id` | string | |
| `name` | string | Unique in the Project regardless of case; no `/` (used in qualified Net names like `Power/EN`). |
| `symbols` | `[Symbol]` | Placed Units. |
| `wires` | `[Wire]` | |
| `labels` | `[Label]` | Net labels, Global labels and Power symbols. |
| `noConnects` | `[{ id, at }]` | Reserved for #11; always empty today. |

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

**Wire:** `{ id, a, b }`. A straight run between two grid points (the editor only draws horizontal and vertical runs). Wires connect where an end touches another Wire's end or runs into its middle (a T), or touches a Pin tip. Crossing Wires don't connect.

**Label:**

| Key | Type | Meaning |
| --- | --- | --- |
| `id` | string | |
| `at` | point | Connection point. |
| `rot` | 0, 90, 180, 270 | Net and Global labels are drawn so their text never reads upside down. |
| `net` | string | Net name, stored **as typed**; names match regardless of case ([ADR-0013](../adr/0013-net-names-match-regardless-of-case.md)). |
| `scope` | `local` / `global` | `local` joins Pins with the same name on this Sheet; `global` on every Sheet. |
| `style` | `label` / `power` / `gnd` | `power` and `gnd` are Power symbols and always have `scope: "global"`. |

How Nets are built from these (not stored): see [DESIGN.md §4](../DESIGN.md#4-connectivity-netlist) and `core/netlist.js`. In short: a Net's name comes from its labels (Power symbol before Global label before Net label), or is generated as `Net-(R1-Pad2)` from its lowest Reference designator.

## Board

Written today:

| Key | Type | Meaning |
| --- | --- | --- |
| `stack` | `{ copper: 2 \| 4, thickness }` | Layer stack. Copper layers are `F.Cu`, `B.Cu`, plus `In1.Cu`, `In2.Cu` for 4 layers. |
| `preset` | string | Fab preset id (`generic` today; #24). |
| `rules` | `{ clearance, trackWidth, viaDrill, viaDiameter, minHole, annularRing, edgeClearance }` | Design rules, all nm. |
| `outline`, `footprints`, `tracks`, `vias`, `zones` | arrays | Always empty today. |
| `netClasses` | object | Always empty today. |

**Planned** (from [DESIGN.md §3](../DESIGN.md#3-data-model-native-format); these will be specified here, with a version bump if needed, when their tickets land):

```js
outline:    [ Shape ]                                                    // #15, Edge.Cuts
footprints: [ { id, componentId, at, rot, side: 'F' | 'B', locked } ]   // #17, rot any angle
tracks:     [ { id, a, b, width, layer, net } ]                          // #20, net = Net name
vias:       [ { id, at, drill, diameter, from: 'F.Cu', to: 'B.Cu', net } ] // #21
zones:      [ { id, layer, net, outline: [points], priority, clearance, thermal } ] // #23
netClasses: { [name]: { trackWidth, clearance, viaDrill, viaDiameter, nets: [names] } } // #24
```

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

## Review points

Things noticed while writing this page, for the format review. None changes behaviour today.

1. **Readability of diffs.** One-space pretty printing puts every number of every point on its own line: [`example.ecad`](example.ecad) is 823 lines for three parts. Writing each point on one line (`[1270000, 0]`) cuts that to about 620 lines (14% fewer bytes), and a moved point becomes a one-line change in a diff. It is still plain JSON, so readers are unaffected.
2. **When to bump the version.** `fieldPins` (#53) and the label keys (#7) were added as optional keys without a bump, because version-2 readers can ignore them safely. That policy should be written down, here or in an ADR.
3. **Checking on open.** `validate()` checks structure only. A hand-edited file with `rot: 45`, a duplicate `ref` or a non-integer coordinate opens without complaint. Opening could check against the schema and report what's wrong.
4. **Part keys can collide.** Parts are keyed by their Library id (`mini-resistor`). Two Libraries with the same Part id would clash when both are used in one Project. Keying by `origin` (library + partId + version), or giving each embedded copy its own id, would avoid that before user Libraries (#13) and imports (#32, #35) arrive.
5. **Embedded Footprints repeat.** A Footprint that is not Preferred is copied into each Component that uses it, so 50 parts on the same custom Footprint store it 50 times. A Project-level `footprints` table, referenced by key, would store it once.
6. **`Unit.fields` is unused** for drawing, since Field styles place fields. Keep it as an import/export hint, or drop it.
7. **Board planned shapes need decisions** before #15–#24, especially whether Tracks keep `net` as a name (the current plan, so forward annotation can rename it) and how Footprint rotation (any angle) is stored.

## Other files

| File | Where | Format |
| --- | --- | --- |
| Colour theme (`.json`) | Settings → Colours → Export / Import | `{ format: "electrocad-theme", version: 1, kind: "schematic" \| "board", name, colors: { [token]: "#rrggbb" \| number } }`. Token ids are `TOKENS` in `core/themes.js` (e.g. `wire`, `netLabel`, `F.Cu`; `zoneOpacity` is a number from 0 to 1). On import, missing tokens are filled from Match app (dark), unknown ones are ignored, bad colours are refused. |
| Field style (`.json`) | Settings → Field styles → Export / Import | `{ format: "electrocad-field-style", version: 1, ...Field style without id and builtin }`. On import, missing settings come from Classic; a bad slot, value format or text size is refused. |
| Project store, desktop | `<userData>/projects/<id>.ecad`, plus `index.json` | Each Project is an `.ecad` file. `index.json` maps id → `{ id, name, modified (ms), components, layers, thumb }`, where `thumb` is a PNG data URL for the home screen. Both are written atomically (temp file + rename). |
| Project store, browser | IndexedDB database `electrocad`, stores `projects` and `meta` | Same content: `projects[id]` is the `.ecad` text, `meta[id]` the card metadata. |
| App settings | Desktop: `<userData>/settings.json`. Browser: `localStorage` | `theme`, `units`, `workspace`, `lastProject`, `colorThemes`, `customThemes`, `customFieldStyles`, `schematicDisplay`. Not part of a Project. |
| Card positions | `localStorage` keys `electrocad.card.schematic-*` | `{ left, top, w, h }` in px for each floating card. Per browser only. |
