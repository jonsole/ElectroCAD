# File formats

| Format | Reference |
| --- | --- |
| Project (`.ecad`), the Native format | [ecad.md](ecad.md), schema [ecad.schema.json](ecad.schema.json), example [example.ecad](example.ecad) |
| Colour theme, Field style, Project store, settings | [ecad.md → Other files](ecad.md#other-files) |
| KiCad and Eagle | Converters, not native formats ([ADR-0004](../adr/0004-native-format-is-json-foreign-formats-are-lossy-converters.md)); tickets #32–#37 |

When the Native format changes: update `ecad.schema.json` and `ecad.md`, run `node tools/write-format-example.js`, and run `npm test` (`test/formats.test.js` fails until the schema describes every key the app writes).
