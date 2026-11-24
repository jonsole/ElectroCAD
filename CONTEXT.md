# ElectroCAD

ElectroCAD is a schematic-capture and PCB-layout editor that runs in the browser and as a desktop app. A user draws a circuit as a schematic and lays out the matching board in a single project.

## Language

### Project and documents

**Project**:
The unit a user opens and saves. It holds one Schematic, one Board and the Library parts they use.
_Avoid_: Design, file, workspace

**Workspace**:
One of the four top-level tabs of the editor: Schematic, Board, Gerber or Library.
_Avoid_: Mode, view, page

**Schematic**:
The logical drawing of the circuit: Symbols joined by Wires and Net labels, spread over one or more Sheets.
_Avoid_: Diagram, circuit

**Sheet**:
One page of a Schematic. Sheets are flat peers, not nested, and are joined only by Global labels and Power symbols.
_Avoid_: Page, sub-sheet

**Board**:
The physical layout: an Outline, a Layer stack, and placed Footprints joined by Tracks, Vias and Zones.
_Avoid_: PCB (fine in prose, but not as a model name), layout

### Library

**Library**:
A named collection of Parts.

**Part**:
A reusable, generic component definition such as "Resistor" or "LM324". It has one or more Units and one or more Footprints joined through Pin maps. It is not a specific purchasable item: the Value and MPN belong to the Component.
_Avoid_: Device (Eagle's word), component (save that for placed instances)

**Unit**:
One separately placeable Symbol of a Part, such as one op-amp of a quad op-amp. A Part with a single Symbol has exactly one Unit. Units are lettered A, B, C… after the Reference designator (U1A).
_Avoid_: Gate (Eagle's word), section

**Symbol**:
The schematic graphic of one Unit: its body drawing and Pins.

**Footprint**:
The board graphic of a Part: its Pads, silkscreen and courtyard.
_Avoid_: Package, land pattern, decal

**Pin**:
A connection point on a Symbol, identified by a Pin number.

**Pad**:
A copper connection point on a Footprint, identified by a Pad number. A Pad is either through-hole (THT) or surface-mount (SMD).

**Pin map**:
The mapping from a Part's Pin numbers to the Pad numbers of one Footprint. A Footprint the Part does not list uses the identity Pin map (Pin n goes to Pad n).
_Avoid_: Connect (Eagle's word)

**Preferred footprint**:
A Footprint the Part lists, with its own Pin map. A Component may also be given any other Footprint. The chosen Footprint is a property of the Component, set when it is placed and editable from either editor.

**Library origin**:
The Library and version a Project's embedded Part was copied from. The embedded copy stays frozen until the user runs an explicit update from the Library.
_Avoid_: Link, live reference

### Placed things

**Component**:
One placed instance of a Part in the Project, identified by its Reference designator. It appears in the Schematic once per Unit and on the Board exactly once as a Footprint.
_Avoid_: Instance, element, part (when you mean the placed one)

**Reference designator**:
The unique, human-facing name of a Component, such as R1, U3 or J2.
_Avoid_: Refdes (fine in code), name, label

**Value**:
The free-text electrical value of a Component, such as 10k or 100nF.

**MPN**:
The manufacturer and manufacturer part number of a Component, which makes a generic Part buyable. It is optional and feeds the BOM.
_Avoid_: SKU, order code

### Connectivity

**Net**:
A set of Pins and Pads that must be electrically connected. It is defined by the Schematic.
_Avoid_: Signal (Eagle's word), node

**Netlist**:
All the Nets of a Project together with the Components they connect. The Schematic is its single source of truth.

**Wire**:
A schematic line segment that joins Pins into a Net.
_Avoid_: Trace, connection

**Junction**:
A dot that joins Wires where they cross or meet in a T.

**Net label**:
A named marker that joins every Wire with the same name on the same Sheet into one Net.
_Avoid_: Local label, port, tag

**Global label**:
A named marker that joins every Wire with the same name on every Sheet into one Net.
_Avoid_: Port, off-page connector

**Power symbol**:
A Global label drawn as a power or ground glyph, such as GND or +3V3.

**Ratsnest**:
The straight "airwire" lines drawn on the Board between Pads that share a Net but are not yet joined by copper.
_Avoid_: Airwires (fine in UI text), unrouted

### Board geometry

**Layer stack**:
The ordered set of copper and dielectric layers of a Board. ElectroCAD supports 2 or 4 copper layers.

**Copper layer**:
One conductive layer: F.Cu (top), In1.Cu, In2.Cu or B.Cu (bottom).

**Track**:
A copper line segment on one Copper layer that carries a Net.
_Avoid_: Trace, wire (wire means the schematic line)

**Via**:
A plated hole that joins Tracks on different Copper layers. In v1 every Via is a through via (top to bottom). Blind and buried vias are later.

**Routing mode**:
How the router treats existing copper while a Track is drawn. **Shove** pushes other Tracks and Vias aside, **Walkaround** bends around them without moving them, and **Free** ignores them and only highlights collisions.
_Avoid_: Interactive router setting, push mode

**Zone**:
A copper area on one Copper layer, filled with a Net and kept clear of other Nets.
_Avoid_: Pour, polygon (Eagle's word), plane

**Outline**:
The closed shape that defines the edge of the Board.
_Avoid_: Edge cuts (KiCad's layer name), dimension

### Rules and output

**Design rules**:
The manufacturing constraints of a Board, such as minimum clearance, track width and drill size.

**Fab preset**:
A named starting set of Design rules and Fab output settings that matches one board house's published 2- or 4-layer capabilities. The user can edit it after applying it.
_Avoid_: Fab profile, DRU file

**Net class**:
A named group of Nets that share track width, clearance and via sizes.

**DRC**:
Design rule check. It finds places where the Board breaks its Design rules or is unrouted.

**ERC**:
Electrical rule check. It finds Schematic mistakes such as unconnected Pins or two outputs driving one Net.

**Forward annotation**:
Pushing Schematic changes (Components added or removed, changed Nets) onto the Board. Footprint changes don't need it: they apply to both editors at once.
_Avoid_: Update PCB, sync (too vague)

**Cross-probing**:
Selecting a Component or Net in one editor highlights the same thing in the other.

**Back annotation**:
Pushing Reference designators renumbered on the Board back to the Schematic.

**Fab output**:
The files a board house needs: Gerber, Excellon drill, BOM and pick-and-place.
_Avoid_: CAM files, production files

### Agents

**Agent**:
An AI that reads and edits a Project through the Agent tools: either an external client connected to ElectroCAD's MCP server, or the in-app AI chat.
_Avoid_: Bot, assistant, AI (as a noun for the client)

**Agent tool**:
One domain-level operation offered to Agents, through MCP and the AI chat alike, such as `place_component` or `connect_pins`. Each call is one validated edit, and in the desktop app one undo step.
_Avoid_: Command, endpoint, API call

**Agent activity**:
The desktop app's log of Agent tool calls made on the open Project, each of which can be undone.

**AI chat**:
The in-app conversation window where the user talks to an AI model of their choosing, which acts as an Agent on the open Project.
_Avoid_: Assistant, copilot, bot

**AI provider**:
The service that runs the AI chat's model: Anthropic, OpenAI, Google Gemini, or a local or OpenAI-compatible endpoint. The user supplies its API key.
_Avoid_: Vendor, backend, LLM

**Edit card**:
A proposed Agent edit shown in the AI chat when "Ask before edits" is on. The user applies or skips it.

### Interchange

**Native format**:
ElectroCAD's own project file (`.ecad`), which is lossless for everything ElectroCAD models.

**Importer / Exporter**:
A converter between the Native format and a foreign format: KiCad (`.kicad_sch`, `.kicad_pcb`, `.kicad_sym`, `.kicad_mod`) or Eagle (`.sch`, `.brd`, `.lbr`).
_Avoid_: Translator, plugin
