# In-app AI chat: the user brings their own provider and key, and the chat uses the Agent tools

ElectroCAD has an in-app AI chat in a floating window. The user chooses the provider and supplies their own API key. v1 supports four providers:
- Anthropic (the default; official SDK, default model `claude-opus-5-5`);
- OpenAI (official SDK);
- Google Gemini (official SDK);
- any local or OpenAI-compatible endpoint, such as Ollama or LM Studio.

The chat model gets the **same Agent tools** as the MCP server ([ADR-0009](0009-mcp-server-over-core-commands.md)), so it can do anything an external Agent can, through the same validated commands.

Unlike an MCP client, nothing outside the app gates these calls, so edits are gated in the app. By default edits apply live, each as one labelled undo step ("AI: place R1"), with "Undo this reply". An **Ask before edits** toggle turns each edit into a card the user applies or skips.

Each request carries only a compact Project summary. The model reads more through the read-only tools, and the user can attach a screenshot of the current view. The window states that this data goes to the chosen provider.

API keys:
- **Desktop:** encrypted with the OS keychain (Electron `safeStorage`). Provider calls run in the main process, so the key never reaches the renderer.
- **Browser:** the key stays in memory for the session. It is saved to IndexedDB only when the user ticks "Remember on this device", with a warning that browser storage is not encrypted.

## Considered Options

- **A single provider (Anthropic only):** simpler, but the user wants to choose, and local models matter for offline use.
- **A read-only advisor:** rejected. Sharing the Agent tools costs almost nothing once the MCP tool layer exists.
- **Sending the whole Project JSON every turn:** rejected as too large and costly on real boards.
