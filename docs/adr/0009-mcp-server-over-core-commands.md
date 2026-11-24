# Agents edit Projects through an MCP server built on the same commands as the UI

ElectroCAD exposes one MCP tool layer, built on the DOM-free core, through two transports:
- a headless `electrocad-mcp` command (stdio) that edits `.ecad` files;
- the desktop app, which, when turned on in Settings, serves the same tools on 127.0.0.1 (Streamable HTTP, per-install token) and edits the open Project live.

The tools are domain-level and use the glossary's language, for example `create_part`, `place_component`, `connect_pins`, `set_footprint`, `forward_annotate`, `route_track`, `run_drc` and `generate_fab_output`. Every edit goes through the same validated commands and History transactions as the UI. There is no raw JSON-patch tool; the Project JSON is exposed read-only. Because agents are poor at coordinates:
- `place_component` auto-places when no position is given;
- `connect_pins` joins Pins with Wire stubs and Net labels, so no wire geometry is needed;
- `route_track` takes waypoints and runs them through the Walkaround router, so the result is clearance-legal or the call fails with the reason. This keeps autorouting out of v1.

In the desktop app, each call is one labelled undo step ("MCP: place R1"), listed in an Agent activity panel. There are no in-app prompts, because the MCP client already gates tool calls. The browser version has no MCP server, since a web page cannot host one.

## Considered Options

- **Raw JSON patches:** rejected because they bypass validation (for example duplicate Reference designators or broken Pin maps) and break invariants the editors rely on.
- **A browser bridge over WebSocket:** rejected for the extra moving parts and the larger attack surface.
