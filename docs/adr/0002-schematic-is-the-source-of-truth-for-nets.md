# The Schematic is the single source of truth for connectivity

Nets are derived from the Schematic only. The Board never defines a Net. It only holds copper that carries Nets the Schematic named. Schematic changes reach the Board through an explicit **Forward annotation** step that shows a list of changes, not a live sync. The only change that flows back from the Board is Reference designator renumbering, through an explicit **Back annotation**. Footprint choice is a live Component property that either editor can change; see [ADR-0008](0008-footprint-is-a-live-component-property.md). This is how KiCad and Eagle (with forward/back annotation off) behave, and it keeps "why is this pad on that net?" answerable from a single place.

## Consequences

- Board-only copper with no schematic Net (for example a stitching via with no net) is allowed, but its Net is "no net" and DRC flags it unless it is marked intentional.
- An imported `.kicad_pcb` or `.brd` with no matching schematic gets a schematic stub: one Component per Footprint with no Wires, plus the board's nets kept as "board-defined" until the user draws them. The importer must report this.
