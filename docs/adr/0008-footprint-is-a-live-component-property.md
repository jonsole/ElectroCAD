# The Footprint is a live property of the Component, edited from either editor

A Component's Footprint is a single field on the Component. It is chosen when the Part is placed (from the Part picker's footprint row) and can be changed from either the Schematic or the Board inspector. Both editors see the change at once: a Footprint already on the Board is swapped in place, keeping its position, rotation and side. Tracks that no longer reach a Pad show up in the Ratsnest and DRC, and the swap is one undo step. This narrows [ADR-0002](0002-schematic-is-the-source-of-truth-for-nets.md): Forward annotation still carries Components being added or removed and Net changes, and Back annotation is now only Reference designator renumbering. Nets still come only from the Schematic. A footprint is physical packaging, not connectivity, so editing it from the Board doesn't create a second source of truth.

## Considered Options

- **Pending until annotation** (classic KiCad/Eagle): a footprint change waits for Forward or Back annotation. Rejected because it adds steps and a stale state for something that has one obvious owner.
