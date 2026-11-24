# 3D models belong to Footprints: generated where we can, imported otherwise

Components get 3D models for the Board's 3D preview (#40) and for designing enclosures. A model shows the package (an SOIC body, a 5 mm LED), and the package is what a Footprint describes. So the model is a property of the **Footprint**, as in KiCad, not of the Part. Swapping a Component's Footprint (ADR-0008) swaps its model too.

A Footprint gets an optional `model`, with one of two sources and a placement:

- **Generated:** `{ source: 'generated', generator, params }`, e.g. `soic` with `{ n: 8 }`. The model is rebuilt from the same numbers as the Footprint, so it never goes stale and costs nothing to store. Every built-in Footprint has one: chip parts with end caps, SOIC/DIP/SOT bodies with leads, QFN, pin headers, axial and radial parts, 5 mm LEDs. No third-party models are bundled, as with Footprints (#12).
- **Imported mesh:** `{ source: 'mesh', meshKey }`, where `meshKey` points into a `models` table (in the Project, and in Libraries for user Footprints). Each mesh is stored once, as binary glTF (GLB) in base64, in millimetres, as Footprints are stored once (format version 3). A mesh can come from:
  - **DabbleCAD:** STL, 3MF or GLB, so a model designed in DabbleCAD can go straight onto a Footprint.
  - **Manufacturers and KiCad:** STEP and VRML (`.wrl`). STEP is read by a WebAssembly CAD kernel loaded only when a STEP file is imported. It is tessellated to a mesh on import, so the rest of the app only ever deals with meshes.
- **Placement:** `{ offset: [x, y, z] (nm), rotate: [x, y, z] (degrees), scale }` relative to the Footprint origin, set in the Footprint editor's 3D view (#19) for imported meshes, and fixed for generated ones.

A Footprint with no model shows a box sized from its courtyard, at a default height (#40).

**Going the other way:** the populated Board can be exported for DabbleCAD (3MF and GLB), so an enclosure can be designed around it. STEP export for other CAD tools is not planned.

## Considered Options

- **Model on the Part:** rejected. One Part has several Footprints (0402 to 1206), and each needs a different body.
- **Store references to model files on disk (KiCad):** rejected. Projects must be self-contained (ADR-0004); a Project opened elsewhere would lose its models.
- **Keep STEP as STEP:** rejected. Every viewer would then need the CAD kernel. A mesh is all the preview and DabbleCAD need.
- **Bundle KiCad's model library:** rejected for the same reason as its Footprints: size and licence. Generated models cover the built-in parts.
