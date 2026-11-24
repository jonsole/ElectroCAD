# No file compatibility before 1.0; the format version still goes up with every change

Until ElectroCAD reaches version 1.0, the Native format (`.ecad`) changes whenever the design needs it, with **no migrations**. Each change raises `version` in `core/project.js` and the schema, and a file of any other version is refused with a message saying which version wrote it.

**Why:** the format is still being shaped (format version 3 re-keys Parts and adds a Footprints table, for example). Migration code written now would carry every early mistake forward and slow the format down while it is cheapest to fix. There are no users with files to protect yet.

What this means in practice:

- **Version numbers:** `version` goes up on **every** format change. It costs nothing and gives a clear "this file is from version N" message instead of a confusing one.
- **Opening a file:** the file is checked strictly against `core/ecad-schema.js`, plus the rules a schema can't express (`projectProblems()`). Unknown keys are refused rather than ignored. A damaged or mismatched file is refused with a plain list of what is wrong, and it is never half-opened.
- **Projects saved by older development builds** can't be opened after a format change, including those in a browser's Project store. That is accepted until 1.0.
- **Docs, schema and example change together:** `docs/formats/ecad.md`, `ecad.schema.json` (generated) and `example.ecad` (generated) change with the code, and `test/formats.test.js` fails until they do.

## At 1.0

Before 1.0 ships, a new ADR replaces this one with the long-term rules. Expected:

- migrations for every later version;
- unknown keys ignored and preserved, so a newer app's file survives an older one;
- a written rule for which changes need a version bump.

## Considered Options

- **Migrations from now on** (as version 2 had for version 1): rejected for now. The cost is real and nobody needs it before 1.0.
- **Ignoring unknown keys from now on:** rejected for now. Strict checking catches bugs in the app's own writer while the format is moving.
