# Board objects in the Native format: Nets by name, Footprints by Component, fills not stored

Format version 3 fixes the shape of the Board objects before the Board tickets (#15–#24) start, so they all build on the same decisions. The schema (`core/ecad-schema.js`) already describes them; the arrays stay empty until their tickets land.

- **Nets are referred to by name.** Tracks, Vias, Zones and Net classes store a Net's name (`"+3V3"`, `"Net-(R1-Pad2)"`), matched regardless of case (ADR-0013). Nets themselves are never stored: the Schematic is their source (ADR-0002). Forward annotation (#16) renames board copper when a Net's name changes. A copper item whose name matches no Net is reported (DRC, #25) and its copper is kept, rather than being deleted silently.
- **A board Footprint is a placement of a Component:** `{ id, componentId, at, rot, side, locked }`. Its pads and graphics come from the Component's footprint (ADR-0008) and are not copied, so a Footprint swap in either editor updates the Board at once. One board Footprint per Component.
- **Board rotation is any angle,** stored as degrees in `[0, 360)` rounded to 0.01°. It is the one non-integer geometry value: lengths stay integer nm (ADR-0003), and pad positions are computed from it and rounded to nm.
- **The Outline is shapes on Edge.Cuts:** lines and arcs forming closed loops. An arc is stored as three points (`start`, `mid`, `end`), so no angles or radii need rounding and an arc's end always meets the next segment exactly.
- **Zone fills are not stored.** A Zone keeps its outline, Net, layer, priority, clearance and thermal relief (`gap`, `spoke`). The fill is recomputed from those and the rules (live refill, #23), as Nets are, so a file can't hold a stale fill.
- **Vias in v1 are through vias:** `from: "F.Cu"`, `to: "B.Cu"`, always, as DESIGN.md §3 plans. The two keys are stored so blind and buried vias can come later without a new shape.
- **Copper layer names** are KiCad's: `F.Cu`, `In1.Cu`, `In2.Cu`, `B.Cu`.

## Considered Options

- **Refer to Nets by id:** rejected. Nets are derived and have no stable id. A name is what the user sees, what KiCad and Eagle store, and what survives a re-annotation.
- **Copy the Footprint onto the Board:** rejected. It would fork from the Component after a Footprint swap, which ADR-0008 rules out.
- **Store Zone fills (as KiCad does):** rejected. They are large, derived, and go stale; Gerber output recomputes them anyway.
- **Arcs as centre, radius and angles:** rejected. Angles need rounding, so ends drift from the next segment's start.
