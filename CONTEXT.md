# ElectroCAD

ElectroCAD is a schematic-capture and PCB-layout editor that runs in the browser and as a desktop app. A user draws a circuit as a schematic and lays out the matching board in a single project.

## Language

### Project and documents

**Project**:
The unit a user opens and saves. It holds one Schematic, one Board and the Library parts they use.
_Avoid_: Design, file, workspace

**Schematic**:
The logical drawing of the circuit: Symbols joined by Wires and Net labels, spread over one or more Sheets.
_Avoid_: Diagram, circuit

**Sheet**:
One page of a Schematic.
_Avoid_: Page

**Board**:
The physical layout: an Outline, a Layer stack, and placed Footprints joined by Tracks, Vias and Zones.
_Avoid_: PCB (fine in prose, but not as a model name), layout

### Library

**Library**:
A named collection of Parts.

**Part**:
A buyable component definition. It pairs one Symbol with one or more Footprints through a Pin map.
_Avoid_: Device (Eagle's word), component (save that for placed instances)

**Symbol**:
The schematic graphic of a Part: its body drawing and Pins.

**Footprint**:
The board graphic of a Part: its Pads, silkscreen and courtyard.
_Avoid_: Package, land pattern, decal

**Pin**:
A connection point on a Symbol, identified by a Pin number.

**Pad**:
A copper connection point on a Footprint, identified by a Pad number. A Pad is either through-hole (THT) or surface-mount (SMD).

**Pin map**:
The mapping from a Part's Pin numbers to the Pad numbers of one Footprint.
_Avoid_: Connect (Eagle's word)

### Placed things

**Component**:
One placed instance of a Part in the Project, identified by its Reference designator. It appears once in the Schematic as a Symbol and once on the Board as a Footprint.
_Avoid_: Instance, element, part (when you mean the placed one)

**Reference designator**:
The unique, human-facing name of a Component, such as R1, U3 or J2.
_Avoid_: Refdes (fine in code), name, label

**Value**:
The free-text electrical value of a Component, such as 10k or 100nF.

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
A named marker that joins every Wire carrying the same name into one Net, even across Sheets.
_Avoid_: Port, tag

**Power symbol**:
A Net label drawn as a power or ground glyph, such as GND or +3V3.

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
A plated hole that joins Tracks on different Copper layers. In v1 every Via goes through all layers.

**Zone**:
A copper area on one Copper layer, filled with a Net and kept clear of other Nets.
_Avoid_: Pour, polygon (Eagle's word), plane

**Outline**:
The closed shape that defines the edge of the Board.
_Avoid_: Edge cuts (KiCad's layer name), dimension

### Rules and output

**Design rules**:
The manufacturing constraints of a Board, such as minimum clearance, track width and drill size.

**Net class**:
A named group of Nets that share track width, clearance and via sizes.

**DRC**:
Design rule check. It finds places where the Board breaks its Design rules or is unrouted.

**ERC**:
Electrical rule check. It finds Schematic mistakes such as unconnected Pins or two outputs driving one Net.

**Forward annotation**:
Pushing Schematic changes (new Components, changed Nets) onto the Board.
_Avoid_: Update PCB, sync (too vague)

**Back annotation**:
Pushing Board-side changes, such as a renumbered Reference designator or a swapped Footprint, back to the Schematic.

**Fab output**:
The files a board house needs: Gerber, Excellon drill, BOM and pick-and-place.
_Avoid_: CAM files, production files

### Interchange

**Native format**:
ElectroCAD's own project file (`.ecad`), which is lossless for everything ElectroCAD models.

**Importer / Exporter**:
A converter between the Native format and a foreign format: KiCad (`.kicad_sch`, `.kicad_pcb`, `.kicad_sym`, `.kicad_mod`) or Eagle (`.sch`, `.brd`, `.lbr`).
_Avoid_: Translator, plugin
