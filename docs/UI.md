# UI guide

ElectroCAD's look and feel follows jonsole's DabbleCAD fork ([ADR-0007](adr/0007-look-and-feel-follows-the-dabblecad-fork.md)). The Schematic and Board editors are laid out like the fork's **Laser** workspace:

![DabbleCAD fork, Laser workspace (reference)](images/dabblecad-laser-reference.png)

## Ported from the fork

Copy these rather than restyle them, and keep the attribution in `NOTICE`:

- **Design tokens and theming:** the `:root` and `:root[data-theme='light']` custom properties (`--bg`, `--panel`, `--panel-2`, `--panel-3`, `--border`, `--text`, `--muted`, `--accent`, `--accent-soft`, `--danger`, `--select`, `--shadow`), with `data-theme` on `<html>`. Dark is the default.
- **Type:** 13px/1.4 system UI stack (Segoe UI, system-ui…), with `ui-monospace` for coordinates and numbers.
- **Components:**
  - `.btn` variants (`-primary`, `-outline`, `-danger`, `-ghost`, `.active`), `.segmented`, `.mode-group` and `.sep`;
  - `.input` and `.select`, `.menu`, `.modal`, `.field`/`.row`, `.toast`, `.kbd` and `.mode-banner`;
  - the scrollbars.
- **DOM helper and icons:** the `h()` element builder, `button()`, `popupMenu()`, the dialogs, `toast()`, and the inline 24×24 stroke-icon table. ElectroCAD-specific icons are added to the same table in the same stroke style.
- **Shell pieces:** the top bar, workspace tabs (`.workspace-bar`, `.ws-tab`), the toolbar, and the boot splash.

## Screen layout

Projects live in the **Project store** and autosave (ADR-0011). The save state next to the project name reads "Saving…" or "All changes saved".
- **Logo:** opens **Your projects**.
- **File menu:** New project (Ctrl+N), Your projects…, Open file… (Ctrl+O, imports an `.ecad` into the store), Save as file… (Ctrl+Shift+S; a download in the browser). Ctrl+S saves to the store at once.
- **Import and Export** are only for KiCad and Eagle files.

### Your projects (home screen)

This is a full-window page over the app, ported from the fork's "Your designs" dashboard (`.dashboard`, `.dash-head`, `.dash-grid`, `.dash-card`).
- **Header:** the logo, then **Open file…**, **Projects folder** (desktop only) and **Back to project**.
- **Body:** a "Your projects" title and a card grid:
  - first, a dashed **Create new project** card;
  - then one card per Project, newest first, each with a 4:3 thumbnail, the name, the edited time ("5 min ago") and "12 components · 2-layer";
  - the open Project's card is outlined in accent.
- **Card actions:** clicking a card opens it. Its ⋯ menu has Open, Duplicate, Rename, Save as file… and Delete (with confirmation).
- **Keyboard:** cards are focusable and Enter opens them.

```
┌ Top bar (48) ─ logo · name · commit │ project name · save state ──── File · Import · Export │ theme · help · about · settings ┐
├ Workspace tabs (36) ─ Schematic · Board · Gerber · Library ───────────────────────────────────────────────────────────┤
├ Toolbar (44) ─ file/edit actions │ undo/redo │ copy/paste/delete │ workspace actions … ───── Routing mode [Shove|Walk|Free] ┤
├ Hint bar (40) ─ "Nothing selected. Pick a tool on the left…" / active tool options (width, via, layer) ──────────────────┤
│ Tools │ rulers                                                         │ Side panel (344): collapsible ▾ SECTIONS     │
│ (46)  │ canvas                                                         │                                               │
│       │                                              [X 12.70 Y 5.08 mm] │                                               │
├ Bottom bar ─ chips (Sheets in Schematic, Copper layers in Board) ───────────────────── status: "12 components · 2-layer · grid 50 mil" ┤
```

| Area | Schematic | Board |
|---|---|---|
| **Tool palette** (left, icon buttons, active = accent) | Select, Wire, Net label, Global label, Power, No-connect, Text, Measure | Select, Route, Via, Zone, Outline, Text, Measure |
| **Toolbar** | Undo/redo, paste, the cards (Parts, Grid, Sheets, Netlist, ERC), Print; selection actions (rotate, mirror, Fields, duplicate, copy, delete) are on the **context strip** | Undo/redo, the cards, Grid, Update from Schematic, Board setup, DRC, plus the **Routing mode** `.mode-group` (Shove / Walkaround / Free); tool options and selection actions are on the **context strip** |
| **Right side panel** | **Part picker**, modelled on the fork's 3D Design shape panel (see below) | Collapsible uppercase sections like the Laser workspace's LAYERS / LASER: LAYERS (rows with a coloured chip, name, visibility, active), PROPERTIES, NET CLASSES, DRC |
| **Inspector** | Floating card at the top-right of the canvas, like the 3D Design inspector ("Box" card). It shows the selected Component's Reference designator, Value, MPN, Footprint and fields, and hides when nothing is selected | PROPERTIES section: the same Component fields, including **Footprint**, plus position, rotation, side and lock. A Footprint change from either inspector swaps the Footprint in place on the Board at once (ADR-0008) |
| **Bottom chips** (like the Laser workspace's colour palette) | One chip per Sheet; click to switch | One chip per Copper layer (and silk/mask); click to set the active layer |
| **Coordinate pill** | Bottom-left of the canvas, monospace, as in the Laser workspace | Same |
| **Mode banner** | Shows tool hints with `kbd` keys, e.g. "Wire: click to bend · Esc to finish" | e.g. "Routing: V via · / posture · Backspace undo segment" |

## Parts card, floating and docked panels

The schematic has no fixed side panel (ported from DabbleCAD's dockable panels, `feature/parts-panel`):

- **Parts** (a labelled button on the toolbar) opens the part picker as a floating **Parts** card. It sits at the top right, and the other cards start to its left.
  - Its close button or the Parts button closes it.
  - Whether it is open is remembered.
  - Dropping a tile back on the card cancels the placement.
- **No fixed side panels.** The Board's are now the **Layers** card (copper stack, layer rows, active layer) and the **Properties** card (selected footprint or outline shape, and the Outline's state). The Net classes and DRC cards come with #24 and #25.
  - The Library's are the **Libraries**, **Part** and **Properties** cards in Symbol mode, and the **Footprints**, **Footprint** and **Properties** cards in Footprint mode. The Symbol | Footprint switch shows that mode's cards and their toolbar buttons.
  - Each card has an icon button on its editor's toolbar, lit while open; whether it is open is remembered.
- **One title bar** on every card, as DabbleCAD's panels:
  - a 16 px accent icon, the title in semibold (with a muted detail such as "· Sheet 1" or "· 3 nets"), any action buttons, then the close **×** on the right;
  - the inspector's close × deselects.
- **Every card** (Parts, inspector, Grid, Sheets, Netlist, ERC, Layers, Properties, Libraries…) floats over the canvas.
  - Drag a card by its header to move it.
  - Drag it to the left or right edge of the canvas, or onto a docked column, and drop it on the highlighted strip to **dock** it. The column sits beside the canvas, which makes room.
  - Docked cards stack top to bottom, in the order dropped. Drag one out by its header (after 6 px of movement).
  - Columns resize from their inner edge; double-click the edge for the default width.
  - Double-click a card's header to send it back to its usual place.
  - Where each card is, and each column's width, is remembered per browser.
- **Hint bar** (context help): the line of help under the toolbar is off by default. Settings → "Show the hint bar (context help) under the toolbar" turns it on.
- **Narrow windows:** below 1500 px wide, labelled toolbar buttons show only their icons, except Parts. Toolbars never squash their buttons.

## Schematic Part picker

The Schematic's right-hand panel works like the fork's **3D Design shape panel**, with Parts in place of shapes:

![DabbleCAD fork, 3D Design shape panel (reference)](images/dabblecad-3d-reference.png)

- **Sheets, Netlist and ERC** are not in the picker: they are a group of icon-only buttons on the toolbar, after Fields. Each opens a floating card over the canvas; a lit button means its card is open.
- **View button** next to the category select, like Explorer's View menu: **Icons** (the tile grid), **Small icons** (a small thumbnail with the name beside it, two columns), **List** (one row each) and **Details** (a table of Name, Category, Value, Units and Fp, sorted by clicking a heading). Every view drags, clicks and drops the same way.
- **Tree** (the same menu): **Group by category** (the default), **Group by manufacturer** or **No groups**. Each group has a header with a chevron and a count; clicking it folds or unfolds the group. While searching, every group with a match is open. Manufacturers come from the Library (Generic for parts everyone makes); like the category, they stay in the Library and aren't copied into Projects. The view, grouping and folded groups are remembered in this browser.
- **Category select** (`.side-filter`): All, Passives, Semiconductors, Connectors, ICs, Power, then one entry per user Library ("My parts").
- **Search** (`.side-search`): matches Part name, keywords and Value. It searches all categories when "All" is chosen.
- **Tile grid** (`.shape-grid` / `.shape-tile`, 3 columns): each tile is a thumbnail of the Part's Symbol (Unit A) drawn from its graphics, with the Part name underneath. Thumbnails show just the Symbol's shape (pin names and numbers are unreadable at tile size). Hovering highlights it in accent; a multi-Unit Part shows a `×5` Unit count badge at the top right.
- **Placing:**
  - **Drag a tile onto the Sheet:** a ghost of the Symbol follows the cursor, snapped to the 50 mil grid. R rotates and X mirrors while dragging, releasing places it, and Esc or dropping outside the canvas cancels.
  - **Click a tile, then click on the Sheet:** places it. You stay in place mode for more copies until Esc.
  - **Enter or Space on a focused tile:** drops it in the middle of the view.
  - **Every drop:** creates a Component with the next free Reference designator and the Part's default Value, as one undo step.
  - **Multi-Unit Parts** (#10, ADR-0005), e.g. an LM324: each click places one Unit. The next click offers the next unplaced Unit of an existing Component of that Part (gaps first, on any Sheet), then Unit A of a new Component once all are down. A strip at the top of the canvas shows the Component's Units: placed ones are struck through, the next one is lit, and "New U2" starts a new Component. Click a letter to place a different Unit. The ghost and the hint show what the next click places (`U1B`).
  - **Unit tags** after a Reference are the Unit's own name when it's a short label, unique in the Part: A, B… for built-in Parts, and Eagle's gate names (P, J, -1…) for imported ones. Otherwise they're A, B… by position. Power-only Units (every Pin a power input) don't count: a Part with one ordinary Unit and a power Unit shows a bare Reference on the ordinary one (`IC9`, not `IC9A`), and the power Unit keeps its tag (`IC9P`) (#62).
  - **Units in the inspector:** a Unit select swaps a placed Symbol to any Unit not placed elsewhere (gate swap), and a note lists the Units not placed yet. Deleting one Unit keeps the Component; deleting its last Unit removes it. All Units share the Component's one Footprint.
  - **Multi-Unit Parts:** dropping one again offers the next unplaced Unit of the last Component (U1B…) before starting a new Component.
- **Footprint row** (under the tiles, above the footer): hovering a tile, or the last tile clicked or dragged, shows the Part's Preferred footprints as chips, such as `0402 · 0603 · 0805 · 1206 · THT`, with a small pad preview on hover. The chosen chip applies to the next drop and is remembered per Part. The default is the one chosen last for that Part in this session, otherwise the Part's first Preferred footprint (0805 for chip parts). Chips are in size order; package parts show their package (`SOIC-14`, `DIP-14`, `SOT-223`). "Other…" opens a footprint search that can choose any Footprint, which then uses the identity Pin map.
- **Footer** (`.side-foot`): **Import** (KiCad/Eagle libraries) and **New part** (opens the Library tab with an empty Part).

### Starter Library

Generated by `library/footprints.js` and `library/starter.js` (#12); no third-party library is bundled. Footprints use IPC-7351 nominal land patterns and KiCad's names, so exports and imports line up.

| Category | Parts | Preferred footprints |
| --- | --- | --- |
| Passives | Resistor, Capacitor, Capacitor (polarised), Inductor | 0402, 0603, 0805, 1206 and a THT one (axial, disc, radial) |
| Semiconductors | LED, Diode, NPN (BC847), PNP (BC857), N-MOSFET (2N7002) | chip sizes + THT (LED 5 mm, DO-41); SOT-23 |
| Connectors | Conn_01x01–01x10, Conn_02x02–02x10 | 2.54 mm pin headers |
| ICs | LM324 (4+1 Units), LM358 (2+1), NE555, 74HC00 (4+1) | SOIC and DIP |
| Power | AMS1117-3.3 | SOT-223 (tab = pin 2) |

"Other…" also offers SOT-23-5 and QFN-16/20/24/32 packages, and every footprint above.

## Drawing Wires

The Wire tool (W) draws orthogonal runs with one corner between clicks.
- **The corner follows the direction you're already going:**
  - after a vertical run, the next run starts vertical, and after a horizontal run it starts horizontal;
  - the first run continues an existing Wire it starts from, or leaves straight out of the Pin it starts on.
- **If that would run through another Pin,** the corner goes the other way.
- **`/`** flips the corner for the rest of the Wire.

**Showing connections** (Settings → Schematic display; app settings, not per Project):
- **Connected Pins** (option, **off** by default): a Pin with a Wire on its tip, or touching another Pin, draws in the Wire colour.
- **Bare Pins** (option, on by default): a Pin with nothing on it gets a small open circle at its tip.
- **Junctions:** a dot where Wires really connect (a T-join, or three or more ends).
- **Crossings** (option, on by default): where a horizontal and a vertical Wire cross without connecting, the horizontal one draws a small semicircle **hop** over the other.

**Text** (Sheet setup → Text, kept with the Project; #79): schematic text (pin names and numbers, References and Values, labels, sheet text, the title block) is drawn in the operating system's sans font, or in ElectroCAD's **vector font**: the same single-stroke glyphs as the board's silk and the silk Gerber (`core/strokefont.js`), sized and spaced as Eagle's. New projects use the system font; Eagle imports use the vector font (and Eagle's metrics on the board, below).
- In the vector font a text **size** is the full height of a capital, pen included, as in Eagle. Capitals are 0.915 of it between stroke centres and the pen 0.1. Like Eagle's, the font is proportional: most characters advance 0.922 of the size, the narrow ones less (i, l, t and comma about two thirds, r five sixths, the full stop half), and its capital I is a plain stroke (#83). These are Eagle's own metrics, measured from a board house's Gerbers and from boxes a designer drew round parts of pin names, so imported layouts line up.
- Field placement, labels and selection measure text in the chosen style, so they always fit what's drawn.
- **Overbars** (#63): `~{…}` in a pin name, label, field or text draws a bar over the text inside: `~{RESET}`, `IS/~{RD}`. Screen and print draw the bar; the markup itself isn't shown. On the board, pad labels show the name without the bar.
- **Pin marks and what a pin shows** (#63): a pin's Properties in the Symbol editor have **Mark** (None, Inverted: a bubble at the body; Clock: a wedge inside it; Inverted clock) and **Shows** (Name and number, Name only, Number only, Neither). With several pins selected, both set all of them. A Unit's own pin name / number switches still hide them all.
- **Pin text per Unit:** the Symbol editor's **Pin text** row sets a Unit's pin name size, pin number size and the gap between a pin's inner end and its name (empty means the default: about 1 mm text, 0.6 mm gap). Eagle imports use Eagle's 1.524 mm (60 mil) names, 1.905 mm in from the pin.

## Busses

- **Bus (Shift+W)** in the tool palette draws a Bus like a Wire (click corners, double-click or click an existing Bus to finish), thicker and in the theme's **Bus** colour (#64). A run joined to an existing Bus takes its name. A new Bus with no name is selected and its Properties open on **Name**.
- **The name lists its members**, as in Eagle: names and ranges separated by commas, `D[0..7]` for D0 to D7 (either way round), `A,B,~{WR}`, or both. Eagle's alias is read too: in `ATBUS:A[0..31],RESET`, ATBUS names the bus and the members are A0 to A31 and RESET. So is KiCad's `{SDA SCL}`. Properties list the members it gives. Renaming changes every segment of the Bus and its labels.
- **Bus entries are Wires** ending on the Bus (often a short 45° stub). A Bus connects nothing itself: nets cross it by name, as in Eagle and KiCad. A Wire end on a Bus doesn't join a Wire that happens to cross the Bus at that point.
- **Bus labels:** the Net label or Global label tool clicked on a named Bus puts down a label showing the Bus's name. It names no net, moves with the Bus and goes when the Bus is deleted.
- **Editing:** Busses select, box-select, move (taking their entries' ends and labels along), copy, paste and delete like Wires, and print.
- **ERC** warns about a Bus with no name, and about a net entering a Bus whose name doesn't list it (e.g. `CLK enters bus D[0..7], which doesn't list it`).

## Labels, Power symbols and Sheets

- **Net label (L)**, **Global label (Ctrl+L)**, **Power symbol (P)** and **Ground (G)** are tools in the left palette. A ghost follows the cursor; R turns it. Clicking a Pin, a Wire (end or middle) or a grid point opens a name box there; Enter places, Esc cancels. Ground goes down at once as GND, and a Power symbol goes down at once with the last power net used (+5V the first time). Double-click a power symbol's name to pick another net: a drop-down under the name box lists every power net (+3V3, +5V, VCC… and any the Project uses, so a voltage typed once is offered on every power symbol), narrowing as you type; arrow keys and Enter or a click choose. The next Power symbol then uses that net. The inspector has the same list as a Power net select, plus a box for a new net. (Not a `<datalist>`: browsers hide datalist choices that don't match the text already in the box.) A name with spaces is refused in the box, like a bad Reference.
- The name box offers the net names already in the Project. After a Net label the next one offers the name with its number bumped (D0 → D1).
- Text stays readable: Net and Global labels turned 180° or 270° read left-to-right or bottom-to-top, sitting on the other side of their point. Power symbols turn freely with upright text.
- **Look** (#81) is separate from what a label joins. **Text** writes the name on the wire, above it (beside it when vertical), with a short tick; **Flag** puts it in a pointed box. A Net label is text and a Global label a flag unless you choose otherwise: the label tools' strip has **Look: Text | Flag** for the next labels. A global text label still joins on every sheet, and a local flag only on its own. The colour still says which: global labels in the Global label colour.
- **Sheet references** (#76): a Global label can show the other sheets its net is on after its name, e.g. `D_A8 [2,5]`. They come from the Netlist, so they change as the net spreads to more sheets or leaves one. **Click a number** to go to that sheet: the net's labels there are selected and zoomed to. Sheet setup → Text has the default for every Global label (**Show sheet references on global labels**, on for new projects); the inspector's **Sheet references** can show or hide them on one label. They print too.
- Labels select, move, copy, rotate and delete with everything else. A label sitting on a Wire that moves goes with it. Double-click a label to rename it. The inspector edits the name, whether it joins on this sheet only or every sheet, its look, its text size (1.27 mm by default) and its rotation.
- Names match regardless of case (ADR-0013): `+3v3` and `+3V3` are one Net. Typing a name that differs from an existing Net only by case stores the existing spelling and says so in a toast. Mixed spellings from an import are kept on the labels; the Net shows the most used one, and ERC (#11) warns about them.
- Net names: Power symbol beats Global label beats Net label beats the generated `Net-(R1-Pad2)`. Local labels named alike on two Sheets are two Nets, shown as `Sheet 1/EN` and `Sheet 2/EN`. Two different names on one Net are kept for ERC (#11).
- **Sheets** are flat. The bottom bar has a chip per Sheet (click to switch, double-click to rename) and a + to add one after the current Sheet. The Sheets icon on the toolbar opens a card listing them with rename, move up/down and delete (the last Sheet stays). Each is one undo step; deleting a Sheet takes its parts with it and says so in a toast.

## Markup, title block and sheet sizes

- **Markup tools** in the palette, after No-connect. Markup never connects to Wires or Pins. Points snap to half a grid (25 mil).
  - **Text (T):** click and type; Enter finishes, Shift+Enter starts a new line. Double-click a note to edit its raw text.
  - **Line (I):** click points; double-click or Enter finishes.
  - **Rectangle (B):** click two corners. It starts dashed, for boxing a section.
  - **Circle (C):** click the centre, then the edge.
  - **Arc (A):** click the start, a point on the arc, then the end.
- **Editing:** markup selects, moves, copies, rotates (R; text turns between 0° and 90°), deletes and box-selects with everything else.
- **Resize handles:** select one shape (not text) to show its handles. Each handle snaps to half a grid.
  - Rectangle: square handles on the corners and sides; dragging past the opposite side flips the rectangle.
  - Circle: four handles that set the radius.
  - Arc: its two ends, plus a round handle in the middle. Moving an end keeps the arc's shape; the middle handle bends it.
  - Line: one handle per point. A two-point line also has a round handle in the middle that moves it square to itself.
  - The pointer changes over a handle. One drag is one undo step.
- **Inspector:**
  - text: content, size, alignment, rotation, bold, italic;
  - lines and shapes: solid, dashed or dotted, arrows at either end of a line, and a light fill for rectangles and circles.
- **Colour:** markup uses the theme's **Notes and markup** colour.
- **Text variables:** `${TITLE}`, `${COMPANY}`, `${AUTHOR}`, `${REV}`, `${DATE}`, `${COMMENT}`, `${SHEET_NAME}`, `${SHEET_NUMBER}`, `${SHEET_COUNT}` and `${PROJECT}` are drawn filled in. The raw text is what you edit, and an unknown variable is left as typed.
- **Title block:** the bottom-right corner of every Sheet shows the title (the Project name when empty), the Sheet name, "Sheet n of N", company, revision, date, author and comment, in the theme's sheet-edge colour.
- **Sheet setup** opens with the gear on a sheet's row in the Sheets card, by double-clicking the title block, or from **Sheet setup…** in the right-click menu on empty canvas. It sets:
  - that Sheet's paper size (A4, A3, A2, Letter, Tabloid) and orientation; the canvas frame and Home follow it, and Print uses it;
  - that Sheet's grid, Alt grid and origin (X and Y in mm from the paper's top-left corner, with Reset);
  - the Project's text font (every sheet): system or vector (see Text, above), and whether Global labels show sheet references;
  - the Project's title block fields.

## Print and export

**Print** (toolbar, or Ctrl+P) opens a dialog with a live preview of the first page:

- **Sheets:** all of them, or one.
- **Colours:** ElectroCAD Light (the default), Classic paper, or black and white. They don't follow the editor's theme.
- **Text:** the **vector font** (letters are strokes), or **searchable text** in Helvetica that a PDF reader can find and copy. Starts at the Project's own text font.
- **Export PDF:** the chosen Sheets in one file, each page at its Sheet's paper size, with a border and the title block. With searchable text, characters Helvetica can't show become `?`, except Ω, which is written "Ohm". Open the PDF in any viewer to print it.
- **Export SVG:** one Sheet per file, at its paper size in millimetres.

Output is drawn by the editor's own drawing code through vector back ends (`print/vector.js`), so it matches the screen. Editor-only marks (unconnected pin rings, ERC markers, selection) are left out.

## No-connects and ERC

- **No-connect (Q)** in the tool palette: click a Pin tip to mark it as left open on purpose (a cross in the theme's No-connect colour); click a marker to remove it. Markers move, copy and delete with their part, and can be selected and deleted on their own.
- **ERC** (the check icon in the toolbar's card group) opens a floating card that is **live**: it reruns after every change while open. The header counts errors and warnings ("2 errors · 1 warning", or "No problems").
- **Filter bar** under the header: **Errors**, **Warnings** and **Info** chips, each with its count, show or hide that kind (all on by default); a search box (`Part or net, e.g. U1 or VCC`) keeps the rows that involve a part or net whose name starts with what is typed, regardless of case (`r1` finds R1 and R10, `u1a` finds U1A, `vc` finds VCC). Esc in the box clears it. The canvas markers follow the filter.
- **Rows** come errors first (a red dot), then warnings (an amber diamond), then Info (a blue ring: pins marked no-connect, for review), with the Sheet's name when there are several Sheets. Clicking a row switches to its Sheet, zooms to it and rings it on the canvas. While the card is open every problem on the Sheet has a small marker.
- **Fixes:** a row with a fix has a button, e.g. **Rename to GND** for mixed spellings. It applies the fix as one undo step.
- **Rules** (`core/erc.js`, a pure function of the Project):

| Rule | Severity |
| --- | --- |
| A Pin isn't connected and isn't marked no-connect | error |
| Two outputs drive one Net | error |
| A power input has nothing supplying its Net (a Power symbol counts as the supply) | error |
| One Net has two different names | error |
| A Pin has no matching Pad on the Component's Footprint | error |
| A multi-Unit part's power Unit isn't placed | error (other Units: warning) |
| One name in mixed case (`GND`/`gnd`, ADR-0013) | warning, with a Rename fix |
| A Net reaches a single Pin | warning |
| A no-connect marker on a connected Pin, or on no Pin | warning |
| A Component has no Footprint | warning |
| Fields that couldn't find a free spot | warning |
| A Pin marked no-connect | info |

## Selecting and moving

- **Selecting:** click to select, Shift-click to add or remove an item, and drag on an empty canvas to box-select. Dragging **left to right** takes only items fully inside the box (solid outline); **right to left** takes anything the box touches (dashed outline). Ctrl+A selects all.
- **Overlapping items** (#78): a line, shape or wire drawn over a part's body is picked before the part when you click on its stroke; elsewhere in the body, the part is picked; at one of the part's pins, the part comes first. **Click again on the same spot** to step to the next item under the cursor (on release, so pressing and dragging still moves what's selected). Right-click and double-click (Properties) use the same order.
- **Moving:** drag a selected item to move the whole selection, with a live preview. Arrow keys nudge by one grid step, or ten with Shift. Every move is one undo step.
- **Wires follow what moves and stay square:**
  - a Wire whose both ends move goes with them;
  - a Wire with one moving end stretches. If its far end is a plain corner, the corner slides along so an L stays an L; otherwise the original run stays on its line, so T-joins onto it stay connected, and a new corner reaches the moved end;
  - a Wire T-joined onto a Wire that moves goes along with it.
  - a dragged Wire whose end sits on a Pin of a part that isn't moving stays on the Pin: a short run (with a corner if needed) joins them.
- **Connectivity never changes when you move things.**
- **Tidying on release:** when you release a drag (and after nudging, moving from the inspector or drawing a Wire), the Wires are tidied in the same undo step:
  - straight runs that meet end to end are joined, unless a Pin, a third Wire or a Wire passing through connects there;
  - runs lying on top of each other on the same line become one, so no segment is left hidden under another;
  - zero-length runs and duplicates are removed.
  This never changes connectivity.
- **Copy, paste, duplicate:** Ctrl+C, Ctrl+V (pastes under the cursor) and Ctrl+D (a copy four grid steps away). Pasted Components get the next free Reference designators and keep their Value, Footprint and Field style. Wires between copied parts come along.

## Editing fields on the canvas

- **Double-click to edit:** double-click a Reference designator or Value on the canvas and an edit box opens over the text, with the text selected.
  - **Enter**, or clicking away, saves as one undo step. **Esc** cancels.
  - A Reference that is taken, empty or has spaces is refused: Enter shows a red tip and keeps the box open; clicking away drops the edit with a short message.
  - The Value is edited as typed, even when the Field style shows it differently (for example RKM `4k7`).
  - With one-line styles ("R1 10k"), the half you double-click decides which field you edit.
- **Single click** on a field selects its part.

## Schematic inspector

The inspector is a floating card at the top right of the canvas, like the fork's 3D Design inspector. It stacks above the Netlist panel when both are open, and hides when nothing is selected.

Selecting something never leaves the inspector over it or over the mouse. If the card would cover them, it slides to the first free corner of the canvas (top left, bottom right, bottom left) until the selection changes; the view doesn't move. Picking the card up by its header puts it back. It also never hides what you just added. When a part you place, or something you paste or duplicate, would land under the inspector or another open card, the view pans the least distance that clears it, keeping it on screen.

- **One part selected:**
  - the title shows the Reference designator and the Part name;
  - **Reference** must be unique, with no spaces; a clash is refused with an inline message;
  - **Value**;
  - **Footprint:** Preferred footprints first, then *Other footprints (pins map by number)*;
  - **Field style:** "Project default" or any style;
  - **X / Y** in mm, snapped to the grid, with Wires following;
  - **Rotation** and **Mirror**;
  - collapsible **Ordering** (manufacturer and MPN) and **Custom fields** (add, edit, remove).
- **Several items selected:** the count, the selected references, a shared **Field style**, and Rotate, Mirror and Delete.
- **Editing:** every change is one undo step, and the card follows undo and redo.

### Moving and sizing the cards

The inspector, Sheets and Netlist cards start docked in a column at the top right, like DabbleCAD's inspector. Each card moves on its own: drag its header to float it anywhere over the canvas, and drag its bottom-right corner to resize it (width 250–520 px). A floating card comes to the front when touched, stays fully inside the canvas, and its place and size are remembered in this browser. Double-click an empty part of a card's header to dock it again. As in DabbleCAD, the inspector's header has icon buttons for the selection: Rotate, Mirror (parts only), Duplicate and Delete.

The Part picker draws each part on the Schematic colour theme's paper colour, so a tile looks like the part on the sheet.

## Field styles

- **Where styles are chosen:**
  - **Picker footer:** a **Field style** select sets the Project default. New Components use it, and so do existing Components that have no style of their own.
  - **Inspector:** selecting Components and picking a style there applies it to just those Components. "Project default" clears the override.
- **Managing styles:** Settings → Field styles has the same duplicate, edit, import and export flow as Colour themes.
  - The editor has a placement list you can reorder for horizontal and for vertical Symbols, checkboxes for which fields show, text size, bold, italic and gap, and the Value format.
  - A live preview shows a few parts in a crowded group.
- **Placing fields:** they move automatically as you work. Dragging a field (press on its text, not the part) moves just that field and pins it, snapped to a quarter grid, one undo step per drag. In a one-line style the half you grab comes out on its own.
  - A pinned field keeps its place relative to its part when the part moves, rotates or mirrors; the text stays upright. Other fields keep clear of it.
  - While its part is selected, a pinned field shows a small pin glyph and a faint dashed line to the part. The inspector says how many fields were moved by hand.
  - **Re-apply style** (in the Fields menu, the inspector and the right-click menu) unpins the selected parts' fields so the style places them again.
- **Right-click menu** (as in DabbleCAD): a right-click that doesn't pan opens Copy, Paste, Duplicate, Delete, Rotate, Mirror and Re-apply style for what's under the cursor, or Paste, Select all and Fit on empty canvas. Right-drag still pans.
- **Crowded spots:** a field that can't find a free spot gets a small amber triangle, a note in the hint bar, and an ERC warning ("R7 fields overlap C3").

## Highlighting the selection

Selected things look the same in every editor: Schematic parts, wires, labels, no-connects and markup; Board footprints and outline shapes; Symbol editor pins and graphics. **Settings → Highlight selected things with** picks the style:

- **Glow** (default): a soft halo in the selection colour around the things' own lines, bodies and text.
- **Colour:** the selected things are drawn in the selection colour. Symbol bodies keep their fill.
- **Box:** a dashed box around each selected thing.
- **Fade the rest:** everything else fades towards the background, so the selection stands out.
- **Brighten** (as in Eagle): the selected things are redrawn in their own colours, more saturated and lighter, the same on dark and light canvases. Greys can't be saturated, so they only get lighter. Symbol bodies keep their fill.

The colour is the **Selection** colour of each Colour theme (Settings → Colours), so the Schematic and the Board can differ. Resize handles, the snap mark and a pinned field's tether are drawn on top whatever the style. The future cross-probing (#18) and net highlighting will use the same styles.

## Grids, origin and snapping

The Schematic, Board and Library editors work the same way here.

- **Two grids.** Each editor has a main grid and an **Alt grid**.
  - Hold **Alt** while drawing, moving or resizing to snap to the Alt grid. The canvas shows the Alt grid while Alt is held, and the status bar says "(Alt)".
  - **The Grid button** (a grid icon, lit while open) on each editor's toolbar opens the **Grid card**, a floating card like Sheets, Netlist and ERC. It holds:
    - Grid and Alt grid;
    - the origin's X and Y in mm, with a button to pick it on the canvas (the Origin tool) and a Reset button;
    - on the Schematic, the settings of the **current sheet**, whose name is shown in the card's header. Each sheet has its own grid and origin, which are also in its Sheet setup dialog (the gear on its row in the Sheets card);
    - in the Library, only the grids and the pick button: there the origin is the Symbol's anchor.
  - Defaults:
    - Schematic: 50 mil, Alt 25 mil, for each new sheet. Markup snaps to half the grid.
    - Board: 0.5 mm, Alt 0.1 mm.
    - Library: 50 mil, Alt 25 mil. Pins snap to the grid and graphics to half of it.
  - The Schematic and Board grids are saved in the Project. The Library's are a per-browser preference.
  - Arrow keys nudge by one main-grid step.
- **Origin tool (O)** in each palette.
  - Schematic (per sheet) and Board: click to move the grid origin. The grid lines, rulers and the coordinate pill then measure from it. **Reset** in the Grid card puts it back; the card and the Sheet setup dialog also take X and Y in mm.
  - Library: the origin is the Symbol's anchor (where it is placed from). Clicking a point shifts the whole Part, every Unit, so that point becomes the anchor. The drawing stays where it is on screen and the origin mark moves.
  - The origin snaps onto handles like everything else.
  - The origin is marked by a cross with a small ring in every workspace, drawn over the content in the theme's **Origin mark** colour.
- **Snapping to objects.** While drawing, moving or resizing, a point that comes near another object's snap point jumps onto it, and a diamond marks the spot. Snap points are:
  - handles (corners, ends and arc mid-points);
  - on the Schematic: Pin ends, Wire ends, labels and no-connects;
  - in the Library: Pin tips;
  - on the Board: Pads, once Footprints arrive (#16 and #17);
  - the origin.

  A moved selection snaps by its handle nearest the pointer. Otherwise points go to the grid.
- **Settings → Snap to objects within:** how close the pointer must be, in screen pixels: Off, or 5–30 px (default 10).

## Board: layer stack and Outline

The Board tab (#15) edits the board's layer stack and its Outline. Footprints, Tracks and Zones come with their tickets.

- **LAYERS section.**
  - At the top: a **2 layers | 4 layers** segmented control and a board-thickness select (0.8–2.0 mm).
  - Going back to 2 layers is refused, with a toast, while Tracks, Zones or drawings are on In1.Cu or In2.Cu.
  - One row per layer, using KiCad names: copper (F.Cu, In1.Cu, In2.Cu, B.Cu), then silk, mask, paste, courtyard and fab for each side, then Edge.Cuts.
  - Each row has a coloured chip, the layer's name, and an eye button that shows or hides the layer.
  - Click a row to make that layer the **active layer**. The active layer is always shown.
  - **Show all** and **Only active** set every layer's visibility at once.
  - Layer colours come from the Board colour theme (Settings → Colours).
  - Visibility is remembered per browser.
- **Bottom chips:** the copper layers and Edge; click one to make it the active layer.
- **Outline tools** (on the palette, below the routing tools). Picking one makes Edge.Cuts the active layer. Everything snaps to the 0.5 mm grid.
  - **B, Outline rectangle:** click two corners. **Corner radius** in PROPERTIES rounds the corners of new rectangles; a rounded rectangle is stored as four lines and four arcs.
  - **P, Outline polygon:** click each corner. **A** makes the next side an arc: click a point it passes through, then where it ends. **Backspace** removes the last corner. Clicking the first corner closes the polygon; a ring marks it under the cursor.
  - **C, Circle:** click the centre, then the edge. Use it for a round board or a mounting hole.
  - The shape follows the cursor as a dashed preview. **Esc** cancels it, and a second Esc returns to Select.
- **Board text and graphics** (#66; on the palette under the Outline tools). They draw on the **drawing layer** chosen in their strip: any silk, fab, courtyard, mask or paste layer, or copper. Top silk to start; the choice is remembered.
  - **T, Text:** type the text and its size in the strip, then click to place it (centred on the click). Keep clicking to place more. Text uses the board's text font (Board setup → Text) and is mirrored on the bottom layers, as it reads from the back.
  - **I, Line:** click points; double-click or **Enter** finishes, **Backspace** takes back a point.
  - **Rectangle** and **Circle:** two clicks. **Width** in the strip sets the pen (the layer's default to start: 0.15 mm on silk); **Filled** fills them.
  - **Selecting:** click a drawing (on a shown layer) to select it; drawings are picked before the footprints under them. Drag to move it, or use the arrow keys. A line, rectangle or circle shows the usual resize handles.
    - **R** / **Shift+R** turn the selection about its middle; **F** flips it to the other side (F.SilkS ↔ B.SilkS, mirrored); **Del** deletes.
    - The strip and PROPERTIES change the layer, the text, its size and angle, the pen width and the fill.
  - **On copper** a drawing has no net: Zones pour round it, routing keeps clear of it, and DRC checks other copper's clearance to it (named "board text "REV A"" and so on). It goes in the copper Gerber with the NonConductor function.
  - Every drawing goes into its layer's Gerber (silk, mask, paste and copper), drawn from the same geometry as the board view.
- **M, Measure:** click two points. A label shows the distance and dx/dy in mm.
- **Select (V):**
  - Click an outline shape to select it; Shift-click adds to the selection. A new rectangle or polygon starts with all its pieces selected; click one to pick it out.
  - **Resize handles** appear on a single selected shape, the same handles as schematic markup, snapping to 0.5 mm. The Outline stays closed:
    - moving an end also moves the neighbouring end that meets it;
    - a straight side's round middle handle moves the side square to itself. A rounded corner next to it moves with it unchanged, and the side beyond the corner stretches. Dragging a rounded rectangle's side therefore resizes it and keeps the corners round.
  - Drag to move the selection, or nudge it 0.5 mm with the arrow keys.
  - **Del** deletes it.
  - PROPERTIES shows the selected shape: width and height for a rectangle, diameter for a circle, end points for a line or arc.
- **Outline state** is always shown at the bottom of PROPERTIES:
  - when closed: "Outline closed · 50 × 40 mm · 1 cut-out";
  - when not: a red note saying where it is open. Each loose end gets a red ring on the canvas.
  - A loop inside another loop is a **cut-out**, and the board is shaded inside its loops, leaving cut-outs clear.
- **Home** fits the board once there is an Outline.
- Each tab keeps its own pan and zoom.

## Forward annotation (Update Board from Schematic)

**Update from Schematic** on the Board toolbar, or **F8** from any tab, opens a dialog (#16). It lists what the Schematic changes on the Board:
- **Footprints:** parts to add, with their Value and Footprint, and parts no longer on the Schematic, which are removed.
- **References and values:** renamed References and changed Values.
- **Nets:**
  - new nets, with their pads;
  - nets that are gone;
  - **renamed** nets, matched by the pads they share; tracks, vias, zones and net classes follow the new name;
  - pads that joined or left a net.
- **Warnings:** placed parts without a Footprint, which stay off the Board until one is chosen.

**Apply** updates the Board in one undo step; **Cancel** leaves it as it is. Running it again straight away says "The Board is up to date with the Schematic."

- **Where new Footprints go:** in rows to the right of the Outline (at the origin when there is none), sorted by Reference, 2 mm apart, on the grid.
- **What the Board shows:**
  - Footprints show their pads in copper colours (through-hole pads with the drill), the courtyard dashed, the Reference on silk above and the Value on fab below.
  - Zoomed in, each pad shows its number and net. An unnamed net shows as its pad, e.g. `R1-2`.
  - Copper is drawn as it's stacked, a layer at a time from the bottom up (B.Cu, In2.Cu, In1.Cu, F.Cu): each layer's zones, then its pads, then its tracks and copper drawings. So a back track never covers a front pad. Through-hole pads and vias, on every layer, go over all of it.
  - This text (Reference, Value, pad numbers and nets) is drawn over the copper: tracks, vias and the track being routed never hide it.
  - The Board draws References, Values and pad nets from what it was last told. A Schematic edit reaches the Board when you apply the update.
  - Footprint swaps are not in the list: they apply straight away (ADR-0008).
- **Snapping:** pad centres are snap targets.

## Placing Footprints and the Ratsnest

#17 covers moving Footprints on the Board, the inspector in PROPERTIES, live Footprint swaps and the Ratsnest.

- **Board-only footprints** (#74): mounting holes, fiducials, logos, test coupons… with no part on the Schematic.
  - **Place footprint** (tool palette, under Zone) opens a search of the footprint libraries (the built-in one has `MountingHole_2.2mm_M2` to `M4`, plain or `_Pad` with a copper ring, and `Fiducial_1mm`, `Fiducial_1.5mm`); click where it goes. Its Reference is suggested from the footprint (H, FID, LOGO, TP, then the next free number) and is unique across the Schematic's parts and the Board.
  - **Properties:** Reference, Value, a **net for each pad** (e.g. a plated mounting hole on GND: zones connect to it with thermals, the ratsnest and DRC treat it like any pad), and **In BOM** (off by default: mounting holes, fiducials and logos aren't bought). Position, rotation, side, lock and its text as for any footprint.
  - **Update from Schematic** leaves them alone. Delete removes them (the Schematic's footprints still come and go with the Schematic). DRC checks them (clearance, courtyard, rings, edge) and they're in the fab output.

- **Select and move.**
  - Click a Footprint to select it; Shift-click adds to the selection. Front-side Footprints are picked first, or back-side ones while a B.* layer is active.
  - Drag to move: the Footprint's origin lands on the grid (hold Alt for the Alt grid). Arrow keys nudge.
  - A selected Footprint's courtyard is outlined in the selection colour, dashed when it is locked.
- **Reference and Value text** (#65). Drag a Footprint's Reference or Value on the board to move just that text (the Footprint is selected and stays put); it snaps to the grid. The moved text belongs to this placement and is kept in the Footprint's frame, so it moves, turns and flips with it. PROPERTIES → **Reference and Value text** has, for each: **Show**, size (mm), layer (silk or fab, on the Footprint's side), angle, and **Reset** (back to where the Footprint draws it). The silk Gerbers use the same placement. A locked Footprint's text doesn't move.
- **Keys** (also on the toolbar):
  - **R** turns the selection 90° (Shift+R the other way). Several Footprints turn about the middle of their origins.
  - **F** flips to the other side. The Footprint mirrors left-right, its pads move to B.Cu / B.Paste / B.Mask, and its silk text reads mirrored.
  - **L** locks or unlocks. A locked Footprint can't be moved, turned or flipped; a toast says so.
  - **Del** doesn't delete Footprints: they come from the Schematic.
- **PROPERTIES** for one Footprint:
  - **Reference**, **Value** and **MPN** edit the Component, so the Schematic changes too, and the Board's record with it.
  - **Footprint**: Preferred footprints first, then any other. A swap applies at once and keeps position, rotation and side (ADR-0008). The same happens from the Schematic inspector's Footprint select. Pad nets follow the Pin map.
  - **X**, **Y** (from the grid origin), **Rotation** (any angle, to 0.01°), **Side** and **Locked**.
  - Each change is one undo step.
- **Ratsnest.**
  - A thin line in the theme's Ratsnest colour for each unrouted connection: a minimum spanning tree per net over its pads and the copper already joining them.
  - It follows a drag live, and changes straight away after a swap or a flip.
  - Zone fills are copper too: a pad reached by a fill (solidly or through its thermal spokes), a via inside one, or a track ending in one joins it. A ground or power plane connects everything dropped onto it, and DRC's Unrouted check agrees. It updates when a refill lands.
  - The status bar counts the unrouted connections.

## Cross-probing and split view

Selecting something in one editor highlights the same thing in the other (#18). The other editor uses the same style as selections (Settings → Highlight) in its theme's **Highlight** colour.

- **What links to what:**
  - A part (Symbol) highlights its Footprint, and a Footprint highlights its Symbol, switching to the Sheet it is on.
  - A Wire or label highlights its Net's pads (and its tracks, vias and zones once they exist).
  - A pad's Net highlights its Wires and labels.
- **Selecting a whole Net:**
  - On the Schematic, double-clicking a Wire (or a ground symbol) selects its whole Net on that Sheet. Double-clicking other labels still renames them.
  - On the Board, double-clicking a pad selects its Net and highlights all its pads.
  - A toast names the Net and counts its pins or pads.
- **Split view** (the **Split** button at the right of the workspace tabs) shows the Schematic and the Board side by side.
  - Clicking in a pane makes it the active one (accent frame), and keys and undo go there.
  - The other pane scrolls to bring the cross-probed item into view, zooming out only if it doesn't fit.
  - With one view, switching tabs shows the highlight, scrolled into view.
  - The choice is remembered.
- Clearing the selection clears the highlight.

## Component origins and locking

Every placed part on the Schematic, and every footprint on the Board, marks its origin with a small **+** when it can move, or a small **×** when it is locked. The mark is a fixed size on screen, and on the Board it's in the footprint side's silk colour, over the copper.
- **What greys out:** when everything selected is locked, the actions that would move it are greyed out. That covers rotate, the step and angle, flip and mirror on the context strip; the same right-click menu items; and the position, rotation, side and mirror fields in Properties. Lock/Unlock, Delete and Properties stay available. With a mix of locked and unlocked parts, the actions stay on and apply to the unlocked ones.
- **Board:** **L** locks a footprint, or use Lock on its context strip or right-click menu. A locked footprint doesn't move, rotate or flip.
- **Schematic:** Lock is on the selection's context strip and right-click menu. There's no key, because L is the Net label tool. A locked part doesn't move, rotate or mirror; its wires stay put, and a toast says when some of a selection stayed put. Saved as `locked` on the symbol.

## Properties

Everywhere (the Schematic, the Board and both Library editors), an item's **Properties** card opens only when you ask for it:
- **Opening it:** every selection's context strip ends with a **Properties** button, which is always there because double-click does something else in places. You can also double-click the item (a part, footprint, track, via, zone, outline shape, pin, pad or graphic), or right-click it and choose **Properties…**. The button shows lit while the card is open, and clicking it again closes it.
- **A wire's Properties** (or a whole net's, after double-clicking a wire) show:
  - the net it carries and where the name comes from: its labels, or an automatic name from its first pin;
  - the net class the Board routes it with, which you can change here (Board setup → Net classes defines them);
  - every pin on the net, and the sheets it reaches;
  - **Select the whole net**;
  - the selected wire's ends and length, or the total length of several wires.
- **Closing it:** it belongs to the selection it was opened for, so selecting something else, or clearing the selection, closes it. Its × closes it as well.
- **Double-click exceptions:** on the Schematic, double-clicking a Reference or Value still edits it in place, a net label is renamed in place, a text note is edited in place, and a wire selects its net.
- **Select net:** on the Board, a pad's net is selected from its right-click menu (**Select net …**).
- **Right-click menus:** the Board and the Library editors now have one, like the Schematic. On an item it offers Properties… and the item's actions (rotate, flip, lock, select the connection or net, delete); on empty board it offers Fit, Update from Schematic, Board setup and Run DRC.
- **Show on Board / Show on Schematic:** right-click a part on the Schematic for **Show on Board**, or a footprint on the Board for **Show on Schematic**. It switches to the other view (or focuses its pane in Split view), selects the same component there (on its sheet) and zooms to it. On a wire, track, via, zone or pad, the menu offers the same for the net (**Show the net on Board / on Schematic**). When the other side doesn't have it yet, a message says so (e.g. Update from Schematic first).
- **Not in Properties:** board information isn't a property. Whether the Outline is closed, with its size, shows at the bottom of the Layers card and in the status bar. The Footprint editor's **New pads** settings are on the Pad tool's context strip.

## Context strips

A small floating toolbar at the top of the canvas (`ui/contextStrip.js`, styled like the routing strip) shows the options for the tool in use or the actions for what is selected. The main toolbar keeps only what always applies: undo and redo, paste, the cards, the grid, and the workspace's own commands. Delete, rotate, flip, lock, mirror and Fields are off it now.
- **Board:**
  - **Route** (X): the routing strip (corners, chamfer, the via layer pair).
  - **Rectangle** (B): corner radius.
  - **Polygon** (P): straight or arc for the next side, and undo corner.
  - **Zone** (Z): the layer, and the new zone's net (from the first corner, none, or a chosen net). **Close** appears once there are three corners.
  - **Footprints selected:**
    - Rotate anticlockwise and clockwise by the **step** (90°, 45°, 30°, 15°, 10°, 5° or 1°, remembered; R and Shift+R use it too).
    - The exact **angle** (one footprint).
    - **Flip**, **Lock** or Unlock, and Properties.
  - **Tracks or vias selected:** width, layer, via drill and diameter, **Connection** (U) and delete.
  - **Zone selected:** net, layer, priority, Thermal or Solid pads, and delete.
  - **Outline shapes selected:** delete.
- **Schematic:**
  - **Placing a part:** rotate, mirror, and stop.
  - **Label, power and ground tools:** rotate.
  - **A selection:** rotate, mirror and **Fields** (parts), duplicate, copy, delete.
- **Library** (Symbol and Footprint editors): the selection's turn (pins or pads), delete and Properties; the Pad tool's **New pads** (shape, size, SMD or through-hole, drill). Pad shapes include **Chamfered (octagon)** (#70): a rectangle with its corners cut by **Chamfer** (a fraction of the shorter side; 0.293 makes a square a regular octagon, Eagle's octagon pads). A through-hole pad's Properties also have **Inner size** (#82): its diameter on the inner copper layers, where it is round (0: as on top and bottom).

The strip rebuilds only when its context changes, so a field being typed in keeps its focus. Clicks on it don't reach the canvas.

**Moving a strip:** drag the grip at its left end (three vertical bars) to move the strip anywhere over the canvas. It stays there, kept inside the canvas, and is remembered per editor; on the Board the routing strip shares the place. Double-click the grip to put it back at the top left.

## Routing tracks

**Route (X)** draws Tracks (#20):
- **Start:** click a pad on the active copper layer. A through-hole pad is on every layer; pick the layer in Layers or with the bottom chips. A track can also start on copper that already carries a net (#87, #89): a via (on every layer), the end of a track on the active layer, or a point part-way along one (a T-junction). The route takes that copper's net. Or click an airwire (#90): the route starts at its nearer end, switching the active layer to that end's if it's only on another layer (an SMD pad on the back, a track on another layer; a toast says so), and the airwire's other end is marked with a dashed ring as where to finish.
- **Width and net:** the track takes the pad's Net and its Net class's width (or the default rule).
- **Placing corners:** click to fix corners. Points snap to the grid, pad centres and handles.
- **Square at pads:** with 45° corners a track never leaves or enters a pad at 45°. Its first run out of the start pad, and its last run into a pad of its Net under the pointer, go straight along the pad's axes. The bend sits a track width beyond the pad's edge.
  - **/** chooses which axis it leaves along (the way's major axis, or its minor one).
  - Walkaround keeps the rule.
  - 90° corners are square anyway; Any angle is left free.
- **Airwires while routing:** the airwires update as the track is drawn, counting the proposed track, its vias and anything it pushes as routed, so the remaining airwire runs from the route's tip to what's still unconnected. They follow a track drag the same way.
- **Finishing:** click a pad of the same Net, or a via, a track end or a point along a track of the Net on the routing layer (#88, #89). Copper the click would finish on is ringed. A track started or finished part-way along another is split there when it's committed, in the same undo step. The ratsnest counts a track end lying on another track of its net (a T) as connected, split or not. Double-click or Enter ends the track where it is.
- **Keys while routing:** **/** flips which way the bend goes, **Backspace** takes back the last corner, **Esc** cancels.
- **Routing options** pop up in a strip at the top of the canvas while the Route tool is active, and hide with any other tool (remembered per browser):
  - **90° | 45° | Any:** how tracks bend, as Eagle's bend styles.
  - **Chamfer** (mm), as Eagle's mitre: every bend of 90° or sharper is cut back by that length on both sides and joined at 45°. Bends you click get it too; it shortens when a segment is too short. 0 for none.
- **Routing mode** (the `.mode-group` at the right of the Board toolbar; the choice is remembered):
  - **Shove** (the default, #29, `core/shove.js`): the track goes where you draw it and pushes other nets' tracks aside to keep their clearance. A pushed track keeps both of its ends (what it connects stays connected): the stretch beside the new copper is lifted clear in a **bump**, joined back by two 45° ramps, and a bump can push the next track in turn (a chain of parallel tracks moves together). It is worked out afresh from the board as it was for every pointer position, so pushed tracks **spring back** as you pull away; nothing moves until the route is finished, and one undo takes the route and the pushes back. **Pads, vias, copper drawings and locked tracks never move** (Locked, in a track's or via's Properties): where a push would need them to, or a bump wouldn't fit inside its track (near its end), or it would crowd the board edge, the track **walks round** instead, as in Walkaround.
  - **Vias in Shove mode** (#30): a via in the way moves clear, in the nearest of the eight 45° directions away from the new copper, as little as it takes; the ends of its own net's tracks that meet it go with it (still connected), and the moved via pushes what it then crowds, on every layer. A via dropped mid-route (V), or placed with the **Via** tool while the routing mode is Shove, pushes other nets' tracks and vias aside on every layer too (the toast says how many). Locked vias never move.
  - **Dragging tracks** (#31), with the **Select** tool: a click on a track selects it; press on a track segment and drag (a few pixels or more). The segment slides sideways and stays parallel. Each neighbour keeps its own direction, lengthening or shortening to meet it, so 45° and 90° corners stay 45° and 90°. Where a neighbour can't follow (the end is on a pad, a via or a junction, or the neighbour runs the same way), a short jog joins the old end to the moved segment. Press on a corner where two segments of one net meet, with no pad or via there, and drag it: it moves to the pointer and the two segments are redrawn to it with 45° corners. In Shove mode other nets' tracks and vias are pushed aside as you drag and spring back as you return. A drag that would hit something that can't move (a pad, a locked track, the board edge) stays at the last place it fitted. Release commits it as one undo step.
  - **Walkaround** (#22): the tentative track goes round other Nets' copper (pads, tracks, vias) and keeps the Outline's edge clearance. It follows their clearance contour at 45° or 90°, takes the shorter way round, and never makes a clearance violation. Nothing existing moves.
    - With no way round, or with the pointer on another Net's copper, the track stops at the first obstacle on the straight way. A red ✕ marks where it stopped and a dashed line runs on to the pointer. A click fixes the track up to the ✕.
    - Clicking a pad of the same Net finishes only if there's a clear way to it.
    - With a chamfer set, the track gives obstacles a wider berth so the cut corners stay legal.
    - The search is A* over a 45°/90° lattice anchored on the last corner (`core/walkaround.js`), every segment checked exactly with the collision engine.
  - **Free:** tracks go where you draw them.
- **Collisions show live** (in Free mode; Walkaround avoids them):
  - a faint band shows the clearance the track must keep;
  - segments too close to another Net's copper (pads, tracks, vias) turn red, and the copper they hit is outlined in red.
  - Clearance is the larger of the two Nets' classes. The collision engine (`core/collision.js`) is shared with DRC (#25).
- **Committing:** a finished track is one undo step. Its Ratsnest line goes once the pads are joined.
- **Track selection:**
  - Select (V) picks a track (Shift adds); Del deletes; Esc deselects.
  - A selected track's Net highlights its Wires on the Schematic (cross-probing).
  - Moving and editing tracks comes with #21.

## Vias, layer changes and editing tracks

#21 adds vias and track editing:
- **V while routing** fixes the track up to the pointer and drops a **through via** there (F.Cu to B.Cu, ADR-0015). Routing carries on from the via on the other layer of the **layer pair**, and the active layer follows.
  - On a 4-layer board, the routing strip adds **V switches: A ↔ B** to choose the pair (any two copper layers, remembered).
  - Backspace steps back through a via. Vias take their size from the Net class.
- **Via tool** (palette): click to place a standalone through via. It takes the Net of the track, via or pad it lands on, or none.
- **Selecting copper:** Select picks tracks and vias (vias first).
  - **U** extends the selection to the whole connection: every track and via joined end to end, stopping at pads.
  - **Del** deletes the selection (a segment, or the whole connection after U).
- **PROPERTIES for selected copper:**
  - the count, the Net and the length;
  - **Width** and **Layer** for the tracks;
  - **Via drill** and **Via diameter** for the vias;
  - a "Whole connection (U)" button and Delete.
  - Mixed values show blank or "Mixed". Every edit is one undo step.

## Gerber tab: fab output

The **Gerber** tab makes the files a board house needs (#26).
- **Generate** waits for any zone refill in progress, then makes:
  - **Gerber RS-274X with X2 attributes**, one file per layer of the 2- or 4-layer stack: each copper layer, F/B mask, F/B paste, F/B silk and Edge.Cuts (`core/fab.js`, a pure function of the Project and its zone fills).
  - **Excellon** drill files for plated holes (vias and plated pads) and non-plated ones (pads with no copper).
- **File names and units** follow the Fab output settings in Board setup: Protel extensions (`.GTL`, `.GBL`, `.G1`/`.G2` inner, `.GTS`/`.GBS` mask, `.GTP`/`.GBP` paste, `.GTO`/`.GBO` silk, `.GKO` outline) or descriptive `-F_Cu.gbr` names; drills in mm or inches.
- **What goes into each layer:**
  - **Copper:** zone fills first, as hole-free regions. Each fill is cut into bands at its holes, so nothing needs clear polarity, which would also erase other copper. Then tracks (round apertures), vias on every copper layer, and pads. Circles, axis-aligned rectangles and ovals are flashed apertures; turned rectangles and rounded rectangles are regions, and turned ovals are strokes. X2 aperture functions are Conductor, ViaPad, SMDPad and ComponentPad.
  - **Mask:** an opening at each pad with mask, and at each non-plated hole, grown by 0.05 mm. Vias are tented unless a via's **Tented** box (in its Properties) is unticked, for a test point. The file's polarity is Negative.
  - **Paste:** SMD pads only.
  - **Silk:** footprint silk lines, shapes and text. Text uses ElectroCAD's own stroke font (`core/strokefont.js`), mirrored on B.SilkS, in the board's text font metrics (Board setup → Text, #79); the board view draws the same glyphs. Footprints without their own Reference text get it above the courtyard, as on screen.
  - **Edge.Cuts:** the outline (`Profile`).
- **Coordinates:** the Project's nanometres with +Y down become Gerber millimetres in 4.6 format, which is 1 nm per unit, with Y up. The flip happens only here (ADR-0003).
- **The panel** lists the files with their layers and sizes. **Download zip** saves them as `<project>-fab.zip`, a stored zip made by `core/zip.js`. **Checks** shows the DRC result at generation time and an open outline, and the list says when the board has changed since generation.
- **Zone clearance from holes:** zone fills also keep the clearance from non-plated holes.
- **BOM and pick-and-place** (#27, `core/assembly.js`), ticked in **Output** (off by default; for assembly):
  - **BOM** (`<project>-bom.csv`): one row per group of identical parts (same Part, Value, Footprint, MPN, manufacturer and custom fields): Quantity, References (sorted, R2 before R10), Value, Footprint, MPN, Manufacturer, Part, then a column per custom field (e.g. an Eagle import's supplier codes, #71). It lists every part on the Schematic, and the board-only footprints marked **In BOM** (#74).
  - **Pick-and-place** (`<project>-pnp.csv`): Designator, Value, Footprint, Mid X and Mid Y in mm, Rotation (degrees counter-clockwise, as seen from the top) and Side (Top or Bottom), for each footprint on the Board (board-only ones when In BOM), at its origin. X and Y are in the Gerbers' own coordinates (Y up, the same origin), so the placement lines up with the copper; an Eagle import's come out as Eagle's own positions.
  - Both go into the fab zip, and each can be saved on its own from the file list.

### Viewing and comparing fab files (#28)

The canvas shows fab files **read back by ElectroCAD's own Gerber and Excellon readers** (`core/gerber/`), not the Board, so what you see is what the board house receives.
- **Generate** shows the generated files. **Open fab files…** shows any fab zip or loose Gerber and drill files from another tool or a board house; **Showing** switches between the two.
- **Layers** lists each file with its layer, found from its X2 attributes or its name (Protel, Eagle and descriptive names): tick to show or hide, **Show all**, **Hide all**. A note icon means the reader skipped something (an image transform, incremental coordinates…); hover to see it.
- **Top / Bottom** (B) views from either side. Bottom mirrors the board and draws the bottom layers on top.
- **Measure** (M): click two points; the distance and dx, dy are in mm.
- **Checks**, for opened files: which layers a board house needs are missing (copper, mask, outline, drills), files whose layer isn't known, and what the reader noted. For generated files: DRC at generation, an open outline, and layers not generated.
- What the readers cover: apertures (circle, rectangle, obround, polygon, with holes), macros including Eagle's OC8 (variables, arithmetic, primitives 1, 4, 5, 6, 7, 20, 21), regions, arcs (multi and single quadrant), clear polarity, step and repeat, offsets, legacy G54/G70/G71, X2 attributes; Excellon in mm or inches, leading or trailing zeros, implied or explicit decimals, G85 and routed slots. Zips may be stored or deflated (`unzip`, with the platform's `DecompressionStream`).

**Compare with…** checks the generated files against a reference set, a zip or loose files: what a board house built from before, or another tool's output for the same board.
- The sets are lined up first: by the commonest shift between drill holes of the same size, so a few changed holes don't matter, or by the outline when there are no drills.
- Each layer pair is drawn at 25 µm and compared (`compareLayers`). Differences closer than 0.05 mm to the other set's copper aren't counted (arcs drawn as chords, octagons for circles). Outlines are compared as lines of one width.
- **Compare** lists each layer with its match, green at 99.9% or more, and says when one set lacks a layer (paste, often). Click a layer to see where they differ: red only ours, blue only theirs, grey both.
- Some layers always differ a little, and the panel says why: silk (each tool's own font, and References), zone fills (each tool's own thermal and clearance rules), and outlines (some tools also draw holes there).
- **Copy report** copies the comparison as text, with the alignment and each layer's areas, to paste into an issue.
- It runs in a worker (`gerber/compareWorker.js`); a 4-layer board takes a few seconds.

Checked against a real board: a 4-layer design imported from Eagle and compared with the files a board house built it from matches 100% on both outer copper layers, both masks and the drills, and 99.4–99.7% on the inner planes (pour details).

## Board setup: Fab presets, Design rules and Net classes

**Board setup** (Board toolbar; or **Board setup…** on the Gerber tab) has two tabs (#24). Every change is its own undo step and shows at once.
- **Design rules:**
  - **Fab preset:** pick a board house (Generic, JLCPCB, PCBWay, OSH Park; the board's layer count picks its 2- or 4-layer preset) and **Apply preset**. It copies the house's values into the Design rules and the Fab output settings (`core/presets.js`).
    - The values are the houses' standard-price capabilities, a little inside their minimums; a note under the picker gives the house's minimums.
    - The board keeps its own copy, so every rule stays editable. The preset name is shown for reference only, with "edited" and the changed rules once they differ (an edited rule has an accent border and a dot; its tooltip gives the preset's value).
    - A preset for the other layer count is flagged, with a button for the right one.
  - **Rules** (mm): clearance, track width, via drill, via diameter, minimum hole, annular ring, edge clearance. These are the **Default** net class.
  - **Clearance by object** (#68): the clearance between copper of different nets for each pair of objects: Track–Track, Track–Pad, Track–Via, Pad–Pad, Pad–Via, Via–Via (Eagle's Wire–Wire, Wire–Pad… distances). Zone fills and copper drawings count as tracks, SMD pads as pads. Empty (the default) uses the Clearance above. A pair that is set replaces the Default class's clearance for those objects; a Net class with a larger clearance still wins. DRC, the router and Zone fills all use them. Applying a fab preset clears them (its clearance is for every pair).
  - **Fab output:** Gerber file names (Protel extensions or descriptive) and drill file units, used by the Fab output (#26).
  - **Text** (#79): the metrics of footprint text on the board and in the silk Gerbers, kept with the Project. **ElectroCAD stroke** (the default): the size is the capital height, characters advance by the size, the pen is 0.15 of it. **Eagle vector** (Eagle imports use it): the size is the full height including the pen, capitals 0.915 of it, pen 0.1, proportional spacing (0.922 for most characters, less for i, l, t, r and punctuation), as Eagle's Gerbers have it.
- **Net classes:**
  - A table of classes: **Default** (the Design rules, read-only here), then each class's name, track width, clearance, via drill and via diameter (all editable), its net count and Delete. **Add net class** starts from the Design rules.
  - **Nets:** every net on the board with a class picker (filterable). A net is in one class at a time; deleting a class puts its nets back in Default.
  - New tracks take their net's class width and via size; the clearance between two nets is the larger of their classes'. Zones (and DRC, #25) use the same rules. The routing hint and a selected track's Properties name the class.
- The Gerber tab's **Fab preset** section shows the preset the rules came from.

## DRC

**DRC** (Board toolbar) checks the board against its Design rules and Net classes (#25). It first waits for any zone refill in progress, then lists the problems in the **DRC** card, errors first:
- **Clearance** (error): copper of different nets closer than the larger of their classes' clearance, or than the Clearance by object rule for that pair of objects (#68), when one is set. This covers pads, tracks, vias and zone fills, on each copper layer, using the collision engine. The message says which rule asked for it, e.g. `0.152 mm needed (track–via rule)` or `(Default)`.
- **Edge clearance** (error): copper nearer the board edge than the edge clearance, or off the board.
- **Track width** (error): a track narrower than its net class's width.
- **Annular ring** (error): a via or plated pad whose copper ring round the drill is under the annular ring (on a 4-layer board, a pad's inner-layer size counts too).
- **Hole size** (error): a drill under the minimum hole.
- **Courtyard overlap** (error): two footprints on the same side whose courtyards overlap. A courtyard an importer made up because the library had none (marked `generated`, #67; older Eagle imports made them, today's don't) is only a guess, so an overlap involving one is a **warning**, saying so, to check the parts themselves.
- **Board outline** (error): the Outline isn't closed.
- **Unrouted** (warning): each ratsnest connection still to route.
- **Schematic/Board mismatch** (warning): the Schematic has changes the Board hasn't had. Clicking it opens Update from Schematic.

Using the card:
- **Markers:** while the card is open, each problem has a marker on the board (red for errors, amber for warnings), and the copper it's about is outlined lightly in the same colour. The **Errors** and **Warnings** chips filter both the list and the markers.
- **Going to a problem:** click a row to zoom to it and select what it's about (tracks, vias, footprints, zones, or the net for an unrouted one). A hidden copper layer it's on is shown. **Hovering** a row previews the same highlight without moving the view.
- **What the highlight shows** (#80), over the board as it is (the rest isn't dimmed):
  - **Clearance:** both items' copper filled in the error colour (the track segment, the pad's shape, the via, the zone fill's edge); a translucent halo round one of them as wide as the clearance needed, so you see where it crosses the other; and the closest points joined by a short line labelled with the distance and what's needed (e.g. "0.143 mm · 0.152 mm needed").
  - **Edge clearance:** the item and the outline segment it's too near, with the gap and the edge clearance needed.
  - **Track width, annular ring, hole size:** the track, copper ring or drill, labelled with its size and what's needed.
  - **Courtyard overlap:** both courtyards dashed and the overlap filled.
  - **Unrouted:** the connection's airwire, thicker.
- **Approving a problem** (#69): the tick on a row approves it, as fine as it is, with an optional note (e.g. "built and tested"). Approved problems are hidden and don't count, neither in the card's header nor in the Gerber tab's "DRC at generation". An **N approved** chip shows them again, dimmed, with their note and **Unapprove**. Approvals are kept with the Board (saved, undone, shared). An approval belongs to the problem's items as they are: editing anything else keeps it, but moving, resizing or re-netting one of them (a track, via, zone, drawing or footprint) brings the problem back; deleting them drops it. Eagle's own approved errors can't be matched (Eagle keeps a hash of its own), so the import summary counts them and they show until approved here.
- **Staying current** (#85): once DRC has run, every edit re-checks the copper round what it changed straight away (the old and new place of each track, via, footprint, zone or copper drawing, as far round as the largest clearance), and the board-wide checks (courtyards, unrouted, outline) with it. Fix a problem and it leaves the list and the board at once; make one and it appears. Undo and redo re-check the same way.
  - Where a zone is refilling, the card says it is re-checking near the zones, and looks again when the fill arrives.
  - A change that reaches the whole board (rules, net classes, the outline, the layer stack, Update from Schematic) is re-checked by a full run.
  - After a pause in editing a full DRC runs in the background (a Web Worker) as a safety net and replaces the list. **Run again** (or the DRC button) still runs one at once.
- **Code:** DRC is a pure function, `runDrc(project, fills)` in `core/drc.js`.

## Zones

**Zone (Z)** draws a copper pour (#23):
- **Drawing:** click its corners on the active copper layer. Click the first corner, double-click or press Enter to close it. **Backspace** takes back a corner, **Esc** cancels.
- **Its Net:** the pad's or track's Net under the first corner, else GND if the board has one, else none. Change it in Properties.
- **Selecting:** click its edge, or inside it where nothing else is. Drag it to move it, drag a corner to reshape it, **Del** deletes it, the arrows nudge it.
- **Properties:**
  - Net and layer.
  - **Priority:** higher fills first and wins overlaps with other Nets' Zones; the lower one keeps its clearance from the higher one's fill.
  - **Clearance:** the gap kept from other Nets' copper. The Net classes' clearance applies when it is larger; 0 means the classes' alone.
  - **Pads: Thermal | Solid:** how the Zone's own Net's pads join it. Thermal leaves a gap round each pad, crossed by up to four spokes along the pad's axes (thermal gap and spoke width are settings). A spoke that would break clearance, or would end in nothing, is left out.
  - **Min width** (#82): copper narrower than this is left out of the fill, as if a pen that wide filled it, so slivers between clearances go. 0 (the default) keeps everything. Eagle imports use the polygon's width.
  - How the fill went: pieces, islands removed, thermal reliefs (and any pad with fewer than two spokes).
- **The fill** (`core/zones.js`, clipper-lib) is computed, not saved:
  - the outline, inside the board's Outline less the edge clearance;
  - less other Nets' tracks, vias and pads (and higher-priority Zones) by the clearance;
  - with same-Net pads joined;
  - with islands that touch none of the Zone's own Net's copper removed. A Zone with no Net keeps every piece.
- **Live refill:**
  - After every change, only the Zones whose area it touched refill, in Web Workers (`board/zoneWorker.js`, scheduled by `board/zoneFiller.js`), so the editor never waits. Each copper layer fills in a worker of its own, so the layers fill in parallel (#73); `node tools/bench-zones.js` times fills on real boards.
  - A Zone waiting for its new fill shows as a dashed outline; a result that a newer change has superseded is thrown away.
  - While a drag or a route is in progress, the Zones it touches draw as outlines; the fill comes back after the drop.
  - `BoardEditor.whenZonesFilled()` resolves once every fill is up to date, for DRC and export.
- Zones draw under pads and tracks, back layers first, in the layer's colour at the theme's Zone fill opacity.

## Importing Eagle designs

**Import → Eagle schematic and board (.sch, .brd)…** takes Eagle 6+ / Fusion Electronics XML files. Choose the `.sch`, the `.brd`, or both at once (one Open dialog, several files). It always makes a **new Project** named after the files; the open one is saved first and stays in the Projects list.

- **Both files:** the Schematic comes over sheet by sheet, the Board is placed from it as Forward annotation would, then each Eagle element sets its position, rotation, side and lock. Tracks, vias, polygons (as Zones), the outline (arcs and circles included), Net classes and the Design rules come over too: each of Eagle's different-signal distances (`mdWireWire`, `mdWirePad`, `mdWireVia`, `mdPadPad`, `mdPadVia`, `mdViaVia`) sets its Clearance by object pair (#68), raised by the default class's clearance when that is larger, as Eagle keeps the larger. A Net class's own clearance only raises them (0 adds nothing, as in Eagle). Eagle's same-signal SMD distances aren't checked (the summary says so when they're set). The Fab preset reads "Eagle design rules" (Board setup can switch it to a fab's preset).
- **Board only:** a stub Schematic is made, one symbol per part with net labels on its pins, so the Netlist still matches the copper.
- **Schematic only:** the Board is left empty; Update from Schematic (F8) as usual.

The import then shows a summary: what came in, whether the **Netlist matches Eagle's nets pin for pin**, whether **every board signal matches the Schematic**, and a list of what wasn't carried over or was changed (curved tracks become short straight segments, inner layers past two, blind vias become through vias, and so on). Nothing is dropped without being listed there.

Some of Eagle's implicit connections are made visible, because ElectroCAD joins only what is drawn:

- **Hidden power pins.** A power gate Eagle never placed (a 74xx gate P, `addlevel=request`) is placed under the part's drawing. Each power pin no wire reaches gets a power label naming its net (VCC, GND…), as Eagle joins it by name.
- **Busses** (#64). Eagle's busses come over as Busses with Eagle's name (`!` overbars as `~{…}`), and its bus labels as Bus labels. Bus entries stay where Eagle drew them: their ends on the Bus join only the Bus, even where another net's wire crosses it there, as in Eagle. Elsewhere, a wire end that lands on another net's wire (Eagle joins by name, not by touching) is pulled back 1.27 mm, or a dead-end stub removed, so the nets don't merge; both are counted in the summary.
- **Labels** (#81). Eagle's plain labels come over as text on the wire and its cross-reference labels (`xref`) as flags, each at Eagle's size, whatever nets they join. Cross-reference labels on nets that span sheets show their sheet references (#76): the other sheet numbers, not Eagle's frame column and row, which ElectroCAD has no frame grid for. The Project default is off, so Eagle's plain labels don't show them. Labels the import adds for nets Eagle names without one are text.
- **Inner layers of through-hole pads** (#82): on the inner copper layers a pad is round and sized by Eagle's inner restring (`rvPadInner`, `rlMinPadInner`, `rlMaxPadInner`); its shape (square, long, first) is kept on top and bottom only. Polygons keep their width as the zone's minimum width.
- **Courtyards** (#67): Eagle has no courtyard layer; its equivalent is the keepout outline (tKeepout/bKeepout, layers 39/40), which its DRC checks for overlaps. A package that draws one gets it as its courtyard (round its pads; a keepout that is just a circle stays round). A package without one gets no courtyard, as in Eagle, so DRC doesn't check it for overlaps.
- **Moved ("smashed") NAME and VALUE** (#65). On the board they become each footprint's own Reference and Value text (position, size, angle, layer; `display="off"` and a smashed element's deleted NAME or VALUE are hidden). Values on Eagle's tValues/bValues layers go to F.Fab/B.Fab, so, as in Eagle's Gerbers, they aren't on the silk. On the schematic they become the symbol's pinned field positions.
- **Mirrored parts.** Eagle turns a part and then mirrors it; ElectroCAD mirrors and then turns, so `MR90` becomes the back side at 270°.
- **Overbars, pin functions and pin visibility** (#63): Eagle's `!` becomes `~{…}`: a `!` turns the bar on and the next turns it off, and a comma ends it (`!RESET` → `~{RESET}`, `IS/!RD` → `IS/~{RD}`, `!X,!Y` → `~{X},~{Y}`), in pin names, net names (so labels and the board's nets) and schematic text. Pin `function` `dot`, `clk` and `dotclk` become the Inverted, Clock and Inverted clock marks. Each pin's `visible` (both, `pin`: name only, `pad`: number only, `off`) is kept per pin.
- **Board-only elements** (#74). An element with no part on the Schematic (a drill legend, a mounting hole) comes over as a board-only footprint with its package, position, Reference, value and moved texts; its pads on Eagle signals take those nets. The summary lists them.
- **Part attributes** (#71). Each part's attributes (its device technology's, with the part's own values over those that aren't `constant`, plus the part's own extra ones) become component fields, names as written and empty values kept, shown under Custom fields in Properties. An MPN attribute (`MPN`, `MF_PN`, `PARTNO`…) and a manufacturer one (`MF`, `MANUFACTURER`…) fill the MPN instead. The summary lists the field names, and any attributes Eagle shows on the sheet (ElectroCAD shows custom fields in Properties only).
- **Text inside packages** (#84): kept with Eagle's anchor, alignment and angle. On the board it is placed with the real string (the Reference for `>NAME`) and the board's font, turns with the footprint and is kept readable as Eagle keeps it (unless it's spun), so the pin numbers along a header line up with Eagle's Gerbers. Symbol text is centred where Eagle's anchored text has it.
- **Board text and graphics** (`<plain>`, #66): text, wires, arcs, circles, rectangles and polygons on the silk, names, values, docu, stop, cream, keepout and copper layers become Board drawings. Text keeps Eagle's anchor (bottom-left unless aligned), and text turned past 90° is drawn the other way up from the opposite corner, as Eagle keeps it readable (spun `S` text excepted). Multi-line text becomes one drawing per line. Rectangles and width-0 circles are filled, as in Eagle. Drill legends and other user layers are listed as left out.

**The import log.** Every import writes a plain-text log: the files and the Eagle version that saved them, what came in, both net checks with every difference listed, everything not carried over, and the DRC results once the Zones have filled (positions in Eagle's coordinates, mm with Y up, so you can find them in Eagle). **Copy log** and **Save log…** are on the summary, and **Import → Show the last import log** brings it back later, after a restart too. To report a problem with an import, paste the log into an issue.

The Schematic opens zoomed to what's drawn, clear of the cards on the right; the Board opens fitted to its outline. Older binary Eagle files (before 6) need opening and saving in Eagle 6 or later first. KiCad import comes with #33.

## Workspaces

There are four workspace tabs: **Schematic · Board · Gerber · Library**. Each keeps its own pan/zoom and selection when you switch away and back.

- **Board** has a segmented **2D | 3D** control at the right of its toolbar (like the fork's segmented control in the top bar). 3D swaps the canvas for the three.js board preview. The side panel and tabs stay.
- **Gerber** is the Fab output workspace. It generates and views the files in one place:
  - **Toolbar:** Generate, Download zip, Open Gerber files…, Top/Bottom view.
  - **Tool palette:** Pan, Measure.
  - **Canvas:** the generated (or opened) Gerber and Excellon layers, rendered from the files themselves.
  - **Side panel sections:** FAB PRESET, LAYERS (one chip per Gerber/drill file with visibility), OUTPUT (which files to include: Gerber, drill, BOM, pick-and-place), and CHECKS (DRC summary and missing-layer warnings).
  - **Bottom chips:** one per output layer.
- **Library** holds the user's Libraries and the Part, Symbol and Footprint editors:
  - **Side panel sections:** LIBRARIES (tree of libraries and Parts, with search), PART (prefix, default Value, Units, Preferred footprints and Pin maps), and PROPERTIES (the selected Pin, Pad or graphic).
  - **Toolbar:** a segmented **Symbol | Footprint** control picks what the canvas edits.
  - **Tool palette:** changes with that choice. For Symbol: Pin, Line, Rectangle, Circle, Arc, Text. For Footprint: Pad, Line, Rectangle, Circle, Arc, Text, Generator….
  - **Bottom chips:** one per Unit (Symbol) or per footprint layer (Footprint).
  - **What works today (#13, Symbol):**
    - **LIBRARIES** lists your Libraries (a gear menu on each: New part here, Rename, Delete) and the read-only Built-in Library. Clicking a Part opens it; a Built-in Part opens as a copy that Save puts in your Library.
    - **PART** edits the name, prefix, default Value, category, manufacturer, keywords, Units and Preferred footprints (any generated Footprint; Pin n goes to Pad n). A red box lists what stops the Part being saved: no name, a bad prefix, a Unit without Pins, a Pin number used twice, an off-grid Pin, or a Preferred footprint missing a Pad.
    - **PROPERTIES** edits the selected Pin (number, name, direction, length in grid steps, electrical type) or graphic (fill, line width; text and size).
    - **Tools:** Select (V), Pin (P: click a grid point; the Pin gets the next free number and points into the body), Line (L), Rectangle (B), Circle (C), Arc (A: start, a point on the arc, end) and Text (T). Pins snap to 50 mil, graphics to 25 mil. R turns the selected Pins, Del deletes, arrow keys nudge.
    - **Resize handles:** a single selected graphic (not text) shows the same handles as schematic markup, snapping to 25 mil; polygons get one per corner. One drag is one undo step.
    - **Units:** a bottom chip per Unit, + adds one with a copy of the current body.
    - **Saving:** **Save** (Ctrl+S) writes the Part to its Library and raises its version when it changed. Saved Parts appear in the Schematic picker straight away; each Library is also an entry in the picker's category select. Placing one records its Library origin (`library/part@version`).
    - **Undo:** Ctrl+Z in the Library tab undoes Part edits only, not the Project.
    - **The picker's New part** opens the Library tab with a new Part, in "My parts" (made for you if you have no Library yet).
  - **Footprint editor (#19):** the toolbar's **Symbol | Footprint** switch set to Footprint. The canvas draws in the Board's colours.
    - **FOOTPRINTS** lists your Libraries' footprints and the built-in ones (read-only: they open as a copy to save in your Library), with search.
    - **FOOTPRINT** has the name, the Library it saves to, and the problems:
      - errors stop a save: no name, no pads, a pad without a number, a size not above zero, a through-hole pad without a drill or with a drill as big as the pad;
      - warnings don't: a pad number used twice (those pads are joined, as for a tab), no courtyard.
    - **PROPERTIES**:
      - the selected pad: number, shape (rectangle, rounded rectangle, circle, oval), width and height, SMD (F.Cu, F.Paste, F.Mask) or through-hole (every copper layer, mask) with a drill, X and Y;
      - the selected graphic: its layer, and the text and size for text;
      - nothing selected: what the Pad tool makes next.
    - **Tools:**
      - Select (V);
      - Pad (P): the next number;
      - Line (L), Rectangle (B), Circle (C), Arc (A) and Text (T), on the active layer. Text can hold `${REF}` and `${VALUE}`, which the Board fills in with the part's Reference and Value, where the footprint puts them.
    - **Editing:** drag to move, drag a graphic's handles to resize, R turns pads 90° (their width and height swap), arrow keys nudge, Del deletes.
    - **Grid:** 0.05 mm, Alt 0.01 mm by default, in the Grid card. Snapping goes onto pad centres and handles.
    - **Bottom chips:** Pads, Silk, Courtyard and Fab. Click one to make it the active layer for new graphics.
    - **Generator…** makes a standard package from parameters, with a live preview and its name. It is a complete footprint: pads, fab body, silk outline clear of the pads, a pin-1 mark, courtyard, and `${REF}` / `${VALUE}` text. **Create** opens it to edit and save. The packages:
      - chip R / C / L / LED / D (size, pad size, pad centres);
      - SOIC / SOP (pins, pitch, row spacing, pad size, body width);
      - pin header (1 or 2 rows, pins, pitch, pad, drill);
      - DIP (pins, pitch, row spacing, pad, drill).
    - **Save** (Ctrl+S) writes it to its Library ("My parts" is made if you have none). It has its own undo history.
  - **Using footprints on a Part:**
    - In the Symbol editor, PART → Preferred footprints → **Add** lists your Library footprints first (with their Library), then the built-in ones.
    - Each Preferred footprint has a **⇄ Pin map** button: choose the pad for each Pin. It lists the pads no Pin goes to.
    - Your footprints are also offered as "Other footprints" in the Schematic and Board inspectors and the picker's Other….
    - **Footprint** editing is #19.

## Agents (MCP)

- **Settings → Agents:** an "Allow AI agents (MCP)" toggle (off by default), the localhost URL, the token (copy, regenerate), and copy-paste config snippets for Claude Desktop and Claude Code.
- **Top bar pill:** when an Agent is connected, an accent pill ("Agent connected") sits next to the save state. Clicking it opens the Agent activity panel.
- **Agent activity panel:** a floating panel, styled like the fork's dialogs, listing each tool call (time, tool, summary such as "place R1 (Resistor 0805)", result) with an Undo button. Edits also show the fork's toast briefly.

## AI chat

- **Opening it:** an **AI** button (sparkle icon) in the top bar toggles a **floating chat window**, styled like the fork's floating panels (`--panel`, `--border`, `--shadow`, radius 10). The window can be moved by its header and resized from its corners. Its position, size and open state are remembered, and it is available in every Workspace.
- **Header:** the provider and model (a click opens a quick model switch), an **Ask before edits** toggle, New chat, and Close.
- **Message list:** user messages and streamed replies. Each tool call shows as a compact chip such as "⚙ place_component R1 · Resistor 0805 ✓", which expands to show inputs and results. Edits made by a reply are grouped under it with an **Undo this reply** button. With Ask before edits on, proposed edits appear as **Edit cards** with Apply / Skip and an Apply all row.
- **Input:** a multi-line box (Enter sends, Shift+Enter adds a new line), an **Attach view** button (adds a canvas screenshot thumbnail), and a Stop button while streaming.
- **Footer:** a muted line, "Sends a Project summary and tool results to <provider>".
- **Settings → AI:**
  - a provider select (Anthropic, OpenAI, Google Gemini, Local / OpenAI-compatible);
  - an API key field with show/hide and "Test connection";
  - the model select, filled from the provider;
  - effort (Anthropic) or temperature (others) where the provider supports it;
  - the base URL for Local;
  - "Remember on this device" (browser only, with its warning).
  When no key is set, the chat window shows a one-click "Set up AI" prompt instead of the input.

## Canvas colours and colour themes

Canvas colours come from a **Colour theme**, chosen separately for the **Schematic** and the **Board** in Settings → Colours. The UI's dark/light theme only styles the chrome.

- **Who uses which theme:**
  - the Library tab's Symbol editor uses the Schematic theme;
  - its Footprint editor uses the Board theme;
  - the Gerber tab uses the Board theme's layer colours.
- **Built-in themes:**
  - **Match app** (the default for both): the ElectroCAD Dark colours when the UI is dark and ElectroCAD Light when it is light, shown in the tables below.
  - **Classic paper** (Schematic only): a white sheet with a light grey grid, dark-red Symbol bodies on a pale yellow fill, green Wires, blue Net labels and black text. This is the traditional printed-schematic look, and it stays light even in a dark UI.
- **Custom themes:**
  - **Duplicate** any theme, then change any colour with a colour picker. A live preview canvas shows the change.
  - **Rename**, **Delete**, and **Reset** a colour to the theme you duplicated from.
  - **Export** a theme to a `.json` file and **Import** one to share it.
  - Custom themes are stored with the app settings (desktop `settings.json`, browser storage), never in the Project file.
  - Built-in themes are read-only; editing one starts by duplicating it.
- **Rulers** are app chrome, so they follow the app's dark/light theme rather than the canvas theme.
- **Settings → Colours layout:** two theme selects (Schematic, Board) with Duplicate / Edit / Import / Export buttons. The editor is a fork-style modal: a list of the theme's colours grouped as below, each with a swatch, and the preview on the right.

**Schematic theme colours:** background, paper, grid minor, grid major, sheet edge and title block, origin mark, Wire, Junction, Bus, Symbol body line, Symbol body fill, Pin, Pin number, Pin name, Reference designator, Value, Net label, Global label, Power symbol, No-connect, selection, highlight (Cross-probing), ERC error, ERC warning.

**Board theme colours:**
- background, grid minor, grid major, origin mark, Ratsnest, selection, highlight, DRC error;
- one colour per layer: F.Cu, In1.Cu, In2.Cu, B.Cu, F/B.SilkS, F/B.Mask, F/B.Paste, F/B.CrtYd, F/B.Fab, Edge.Cuts;
- Via, through-hole Pad, drill hole;
- Zone fill opacity and inactive-layer dimming.

ElectroCAD Dark values (the "Match app" default in a dark UI):

| Layer | Dark theme | Note |
|---|---|---|
| F.Cu | `#e5484d` | red |
| In1.Cu | `#e5b84d` | amber |
| In2.Cu | `#46a758` | green |
| B.Cu | `#4f8cff` | blue (`--accent` family) |
| Silk | `#e7eaf0` | `--text` |
| Edge.Cuts | `#f2c94c` | |
| Ratsnest | `--muted` | thin |

In the schematic, Wires use the accent green `#46a758`, Symbol bodies use `--text` with a `--panel-2` fill, Pins use `--muted`, and labels use the accent colour. ElectroCAD Light uses darker shades of the same hues.

## Logo

The logo follows the fork's mark: a rounded square in the brand colour with a white letter and an orange "splash" dot. For ElectroCAD that's an "E" whose dot sits on a short trace stub, like a via. The name sits next to the mark, with the short commit hash in monospace after it.
