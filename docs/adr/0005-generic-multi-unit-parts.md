# Parts are generic and can have several Units

A Part is a generic definition ("Resistor", "LM324"), not a purchasable item. The Value and MPN live on the Component, so a project with forty resistors uses one Part. A Part holds `units: [Symbol]` from the first file-format version, even though most Parts have one Unit. Adding Units later would change every Symbol reference in every file. Both KiCad (units) and Eagle (gates) need them for faithful import. Each Component places each of its Units separately (U1A, U1B), and all Units map onto the Component's single Footprint.

## Considered Options

- **One Part per MPN** (Eagle technologies or Altium database libraries): an exact BOM, but libraries explode. MPN on the Component gives the same BOM.
