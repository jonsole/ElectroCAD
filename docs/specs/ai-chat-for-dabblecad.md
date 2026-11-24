# Spec: In-app AI chat for DabbleCAD Plus

> **For the DabbleCAD session implementing this.** This feature was designed for ElectroCAD, a sibling app on the same stack (see ElectroCAD's ADR-0010 and the "AI chat" sections of `docs/DESIGN.md` and `docs/UI.md`). This spec restates it in DabbleCAD's own terms so it can be built in `jonsole/DabbleCAD` without reading ElectroCAD.
>
> - The method names quoted below come from DabbleCAD at commit `bbbbe6e`. Check them against the current code before relying on them.
> - Where this spec and the DabbleCAD code disagree, trust the code and keep the behaviour described here.

## Problem Statement

A DabbleCAD user who wants to build something ("a 40 mm phone stand with a cable slot", "a box with a lid and four screw holes") has to know which shapes to combine, how to size and place them, and how to group them into solids and holes. Beginners don't know where to start. Experienced users repeat tedious steps, such as patterns, alignments and exact sizes. They also want to ask questions about their design ("how tall is this?", "why does this group look wrong?") without leaving the app. They want to use the AI model they already pay for (Claude, ChatGPT, Gemini, or a local model) and not be tied to one vendor or an account with DabbleCAD.

## Solution

An **AI chat** in a floating window inside DabbleCAD. The user picks an **AI provider** (Anthropic, OpenAI, Google Gemini, or a local or OpenAI-compatible endpoint) and enters their own API key.
- **What it can do:** the chat model can read the open design and edit it through a set of **Agent tools**: add shapes, size and place them, make holes, group, align, mirror, pattern and so on. Every tool is built on DabbleCAD's existing Editor commands.
- **How edits are applied:** by default edits apply live, each as one undo step labelled "AI: …", and every reply has **Undo this reply**. An **Ask before edits** toggle turns proposed edits into cards the user applies or skips.
- **What is sent to the provider:** each request carries only a compact design summary. The model reads more through read-only tools, and the user can attach a screenshot of the view. The window says what is sent and to whom.
- **Keys:** desktop keys are encrypted with the OS keychain and never reach the renderer. Browser keys stay in memory unless the user opts in to saving them.

## User Stories

### Setup

1. As a user, I want to open Settings → AI and choose a provider (Anthropic, OpenAI, Google Gemini, Local / OpenAI-compatible), so that I can use the AI I already have.
2. As a user, I want to paste my API key, show or hide it, and press "Test connection", so that I know it works before I chat.
3. As a user, I want to choose a model from a list fetched from the provider, so that I can trade cost against quality.
4. As an Anthropic user, I want Claude Opus 5.5 (`claude-opus-5-5`) selected by default, with an effort setting, so that I get a strong default without configuring anything.
5. As a local-model user, I want to enter a base URL (e.g. `http://localhost:11434/v1` for Ollama) with no key, so that I can chat offline and privately.
6. As a desktop user, I want my key stored encrypted by the operating system, so that it isn't sitting in a plain file.
7. As a browser user, I want my key kept only for this session unless I tick "Remember on this device", with a warning that browser storage isn't encrypted, so that I choose the risk.
8. As a user with no key set, I want the chat window to show a one-click "Set up AI" prompt, so that I know what to do.

### Chatting

9. As a user, I want an AI button in the top bar that toggles a floating chat window, so that I can chat without leaving my workspace.
10. As a user, I want to move the window by its header and resize it from its corners, and have its position, size and open state remembered, so that it stays out of my way.
11. As a user, I want the chat available in every workspace (3D Design and Laser in v1), so that I don't lose the conversation when I switch.
12. As a user, I want replies to stream in as they're written, with a Stop button, so that I'm not left waiting.
13. As a user, I want to ask questions about my design ("what's the total height?", "which shapes are holes?") and get answers based on the real design, so that I can understand it.
14. As a user, I want an "Attach view" button that sends a screenshot of the current viewport, so that the AI can see what I see.
15. As a user, I want "New chat", so that I can start fresh.
16. As a user, I want a line in the window naming the provider and model and saying that a design summary, tool results and any attached views are sent to them, so that I know where my data goes.
17. As a user, I want provider errors (invalid key, rate limit, no network) shown inline with Retry, and nothing applied, so that a failure never damages my design.

### Editing through the chat

18. As a user, I want to ask "make a 60×40×20 mm box with 2 mm walls and a lid" and have it built in my design, so that I can go from an idea to a model quickly.
19. As a user, I want each AI edit to be one undo step labelled "AI: …" in the normal undo history, so that Ctrl+Z works as usual.
20. As a user, I want **Undo this reply** on each reply that made edits, so that I can reject everything it did in one click.
21. As a user, I want each tool call shown as a compact chip (e.g. "⚙ add_shape Box 60×40×20 ✓") that expands to show inputs and results, so that I can see what the AI did.
22. As a cautious user, I want an **Ask before edits** toggle that shows each proposed edit as a card with Apply / Skip, plus Apply all, so that nothing changes without my say-so.
23. As a user, I want the AI to select what it just made, so that I can carry on editing it by hand.
24. As a user, I want the AI to respect locked shapes, so that it never moves anything I've locked.
25. As a user, I want the AI to use my current units and snap settings, so that what it makes fits my design.
26. As a Laser workspace user, I want the AI to arrange and edit 2D shapes and set layer settings (speed, power, passes), so that I can prepare jobs faster.
27. As a Laser workspace user, I want the AI to be **unable** to connect to, start, frame, jog or otherwise drive the laser machine, so that it can never fire a laser.

## Implementation Decisions

### Architecture

- **Agent tool layer.** This is a new DOM-free module that defines each Agent tool as `{ name, description, inputSchema (JSON Schema), kind: 'read' | 'edit', run(editor, input) → result }`.
  - Edit tools call the **existing Editor commands**, never the scene directly. That way validation, snapping, locks, outlines and undo behave exactly as for the user.
  - Tools address nodes by **id**. Editor methods that act on the selection should be called by selecting the target ids, running the command, and leaving the new or changed nodes selected (story 23).
  - Each edit tool call is wrapped so that it ends in exactly one `commit()` with the label `AI: <summary>`. DabbleCAD's history currently stores unlabelled snapshots, so add an optional label to history entries; the undo/redo UI can show it.
- **Chat loop.** This is provider-neutral. For each user message it:
  1. builds the request: a stable system prompt, the tool definitions, the conversation, and this turn's **design summary**;
  2. streams the reply;
  3. runs tool calls through the tool layer (or holds them as cards in Ask mode);
  4. returns the tool results to the model;
  5. repeats until the model stops.
  Tool errors go back to the model as error results so it can correct itself.
- **Provider adapters.** Each one maps the chat loop to and from that provider's **official SDK**:
  - **Anthropic:** `@anthropic-ai/sdk`.
  - **OpenAI:** `openai`.
  - **Google Gemini:** `@google/genai`.
  - **Local / OpenAI-compatible:** the `openai` SDK with a user-supplied `baseURL`; the key is optional.
  Each adapter converts the shared JSON Schema tool definitions to the provider's format and normalises streamed text, tool calls, tool results and errors.

### Anthropic adapter details

- **Model:** default `claude-opus-5-5`. The model list comes from the Models API.
- **Streaming:** use streaming with `max_tokens` around 64000.
- **Thinking:** adaptive. Claude Opus 5.5 cannot have thinking disabled, so depth is set with `output_config.effort`. Its default is `medium`; expose low, medium and high in settings.
- **Tools:** use `strict: true` and `tool_choice: auto`, because forced tool choice returns a 400 on this model. Set `eager_input_streaming: true` on the tools, and validate each parsed tool input against its schema before running it. Treat invalid or truncated input as an error result.
- **Prompt caching:** keep the system prompt and tool list byte-stable, put a cache breakpoint after them, and put the per-turn design summary in the user turn after the breakpoint.
- **Refusals:** check `stop_reason` before reading content, and show a `refusal` politely. Enable server-side fallbacks (beta `server-side-fallback-2026-07-01`, `fallbacks: "default"`).
- **Errors:** use the SDK's typed errors (authentication, rate limit, connection) to choose the inline message and Retry.

### Where calls run, and keys

- **Desktop (Electron):** calls run in the **main process**. Add IPC channels to the preload bridge in the same style as the existing `call('…')` entries:
  - `ai:set-key`, `ai:has-key`, `ai:clear-key`, `ai:models` and `ai:test`;
  - `ai:chat`, which starts a streamed request; stream events go back on an `ai:event` channel, like `update:progress`;
  - `ai:cancel`.
  Keys are encrypted with Electron `safeStorage` and stored next to the settings. They are never sent to the renderer: `ai:has-key` returns only a boolean.
  The renderer runs the tool layer and sends tool results back over IPC. The main process only talks to the provider.
- **Browser:**
  - Calls go directly from the page, using each SDK's explicit browser-access opt-in (check each SDK's docs for the current option name).
  - The key is kept in memory. It is saved to browser storage only when "Remember on this device" is ticked, with a warning.
  - Add the provider hosts (`api.anthropic.com`, `api.openai.com`, `generativelanguage.googleapis.com`) to the CSP `connect-src`. Localhost is already allowed.
  - Remote custom OpenAI-compatible URLs are **desktop-only**, and the settings explain why.

### Design summary (sent each turn)

The summary contains:
- the design name, the active workspace and the units;
- the workplane (origin and orientation, as the Editor defines it);
- the node count;
- each top-level node: id, name, kind, colour, hole/solid, locked, hidden, and world bounding box (min/max in the design units);
- the selection ids.

For large designs, cap it at about 200 nodes with a note to use `list_nodes`. Nothing is sent before the user sends a message.

### Agent tools (v1)

The tool descriptions must say which axis is up and which units are used, exactly as DabbleCAD defines them.

| Tool | Kind | Built on (Editor at `bbbbe6e`) |
|---|---|---|
| `get_design_summary` | read | — |
| `list_nodes(filter?)`, `get_node(id)` (params, matrix, bounds, children) | read | `node()`, `bounds()` |
| `list_shape_catalog(category?, query?)`: ids, names, categories, parameter names and ranges | read | `CATALOG`, `CATEGORIES` |
| `measure(idA, idB?)`: size, distance, gaps | read | `bounds()` |
| `add_shape(catalogId, params?, size?, position?, rotation?, color?, hole?, name?)` | edit | `nodeFromCatalog()`, `addNode()`/`placeAt()`, `setSize()`, `setPosition()`, `rotateSelection()` |
| `set_params(id, params)` (shape parameters such as radius, steps, text) | edit | `setParam()` |
| `set_size(id, x?, y?, z?, uniform?)`, `set_position(id, x?, y?, z?)`, `rotate(id, axis, degrees)`, `nudge(ids, dx, dy, dz)`, `drop_to_workplane(ids)` | edit | `setSize()`, `setPosition()`, `rotateSelection()`, `nudge()`, `dropToWorkplane()` |
| `set_color(ids, color)`, `set_hole(ids, hole)`, `rename(id, name)` | edit | `setColor()`, `setHole()`, `rename()` |
| `group(ids, mode: union\|intersect\|bundle)`, `ungroup(id)` | edit | `group()`, `ungroup()` |
| `align(ids, axis, mode)`, `mirror(ids, axis)` | edit | `align()`, `mirror()` |
| `duplicate(ids)`, `pattern(ids, type, count, dx?, dy?, dz?, angle?)` | edit | `duplicate()`, `pattern()` |
| `delete(ids)` | edit | `deleteSelection()` |
| `select(ids)` | edit (UI only, no undo step) | `select()` |
| Laser: `list_laser_layers`, `set_laser_layer(layer, mode?, speed?, power?, passes?…)`, `add_laser_shape(kind, params, position)`, `arrange_laser(ids, …)` | read / edit | the Laser workspace's model and ops (map to their existing commands) |

Edit tools refuse locked nodes, unknown ids and out-of-range parameters. A refused call changes nothing and returns a short reason that names the offending node or parameter. There is **no tool** that connects to, starts, pauses, frames, homes or jogs a laser or printer, or sends G-code. Do not expose those commands under any name.

### UI (DabbleCAD fork style)

- **Window:** an **AI** button (sparkle icon, added to the inline icon table) in the top bar's right-hand group toggles the chat window. The window uses the existing tokens (`--panel`, `--border`, `--shadow`) with a 10 px radius, and has a drag header and resize corners.
- **Header:** the provider and model (a click opens a quick model switch), the **Ask before edits** toggle, New chat, and Close.
- **Message list:** user and assistant messages. Tool chips are expandable. **Undo this reply** sits under replies that made edits. Ask mode shows Edit cards with Apply / Skip and Apply all.
- **Input:** a multi-line box (Enter sends, Shift+Enter adds a new line), **Attach view** (shows a thumbnail before sending), and Stop while streaming.
- **Footer:** a muted line, "Sends a design summary and tool results to <provider>".
- **Settings → AI:**
  - provider select;
  - key field with show/hide and Test connection;
  - model select;
  - effort (Anthropic) or temperature (others) where supported;
  - base URL (Local);
  - "Remember on this device" (browser only).
- **Attach view:** renders the current viewport to a PNG, about 1024 px on the long side. For the three.js viewport, render a frame and read it back, because the drawing buffer may not be preserved.

## Testing Decisions

- **What makes a good test:** it asserts on observable results, such as the design's nodes, sizes, positions, groups and holes after a tool call, the undo history, the messages sent to a provider, and the chips and cards shown. It does not assert on internal call order or private state.
- **Tool layer:** test each tool on a fresh Editor with a fixture design. Cover the happy path, refusal of locked nodes and unknown ids, out-of-range parameters, and "one commit per call" (undo restores the prior design exactly).
- **Chat loop:** use a **scripted fake provider**, a fixed sequence of text and tool calls, to cover:
  - live apply, and Undo this reply;
  - Ask mode with apply, skip and apply all, where skipped edits are reported back to the model;
  - tool-error recovery;
  - cancellation in the middle of a stream.
  No network is used.
- **Adapters:** test each provider's request and response mapping against recorded fixtures: text, a streamed tool call, a tool result, a refusal or error, and invalid or truncated tool input.
- **Smoke test:** add one through DabbleCAD's existing `--smoke=script` runner. The app opens the chat with the fake provider, which adds a box and a cylinder hole and groups them; Undo this reply then restores the empty design.
- **Manual check with a real key:** "Make a 60×40×20 mm box with 2 mm walls" produces a hollow box of the right outer size.

## Out of Scope

- The **Slicer workspace**, and any tool that touches printers or lasers as devices (see the safety rule above).
- Voice input, image generation, and creating shapes from a photo. Attach view is for the model's understanding only.
- An MCP server for external agents. ElectroCAD has one (its ADR-0009). DabbleCAD could reuse this tool layer for it later.
- Account-based or hosted AI; users always bring their own key.
- Autonomous long-running agents. The chat works turn by turn with the user present.

## Further Notes

- Keep the tool layer free of DOM code, so it can later be served over MCP (headless or from the desktop app) without changes, as ElectroCAD does.
- The system prompt should describe DabbleCAD's model in its own vocabulary: shapes, holes, groups (union, intersect, bundle), the workplane, units and snap. It should tell the model to prefer few, precise tool calls, to read before it edits, to select its results, and never to move locked nodes.
- Provider model lists change often. Fetch them from the provider and don't hard-code them, except for the Anthropic default `claude-opus-5-5`.
