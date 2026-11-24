# Fields are placed automatically by Field styles; a field moved by hand is pinned

In most schematic editors every Reference designator and Value has to be nudged by hand. In ElectroCAD a **Field style** decides how a Component's fields look and where they go. Each Project has a default style, and selected Components can use another. Field positions are not stored by default: a placer works them out live from the style.
- **Candidates:** the placer tries the style's preferred positions in order, each relative to the Symbol's body and orientation.
- **What it avoids:** other fields, Symbol bodies, Pins and Wires.
- **When it runs:** again whenever something nearby moves.
- **A crowded spot:** when every candidate overlaps, the field takes the least-overlapping one and gets a warning marker.
- **Moving a field by hand:** that field becomes **pinned**. It stores its position relative to the Symbol and is never moved again until the user chooses "Re-apply style".

Value formatting in a style (for example RKM `4k7`) changes only how the Value is drawn. The Component's stored Value stays as typed, and BOM grouping compares parsed values, so `4k7`, `4.7k` and `4700` group together.

Styles in use are copied into the Project, as Parts are (ADR-0004), so a file looks the same anywhere. The user's own styles also live in the app settings, like Colour themes.

## Considered Options

- **Store every field position (KiCad/Eagle):** rejected because that is the chore this decision removes.
- **Automatic placement with no manual moves:** rejected because the placer will sometimes be wrong. Pinning gives the user the last word.
- **Rewriting stored Values to the style's format:** rejected because it would make a display preference change the BOM and exports.
