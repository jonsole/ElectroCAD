# All coordinates are integer nanometres, with Y pointing down

Every length in the model (schematic and board) is an integer number of nanometres, and +Y points down the screen. This matches KiCad's internal unit, so KiCad import and export round-trip exactly. Mil and millimetre grids are both exact (1 mil = 25 400 nm), and integer maths keeps DRC and Zone filling (Clipper works in integers) free of floating-point drift. Eagle files (in mm or inches, with Y up) are converted at the Importer/Exporter boundary, and so are Gerber files (Y up).

## Considered Options

- **Float millimetres.** Simpler to read, but 0.1 mil grids and repeated transforms drift, and Clipper needs integers anyway.
