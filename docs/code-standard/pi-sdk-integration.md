# Pi SDK integration rules

The Pi session runs in the agent process (`apps/desktop/src/agent/index.ts`).

- **Own config dir:** set `process.env.PI_CODING_AGENT_DIR` to `<user-data>/agent` before using the SDK, so the app never reads or writes the user's own Pi setup.
- **No discovered extensions:** the resource loader uses `noExtensions: true` and passes `extensionFactories` explicitly (MCP, approval gate, …). Add behaviour as a factory there, not as a file Pi would discover.
- **Skills:** only skills under `<user-data>/agent/skills/` are loaded; the skill filter is read on every reload.
- **Defer changes while running:** settings changes go through `changed(scopes, apply)`, which emits `settings_changed` and records `PendingChanges`. `applyPending()` runs them only when no run is in progress (serialized on `this.applying`), so a conversation is never rebuilt mid-answer.
- **Pick the lightest apply step:**
  - `session.reload()` — when extensions or skills change (reloads extensions and re-registers MCP servers).
  - `mcpServers.sync()` — when only MCP server config changed.
  - `session.setActiveToolsByName(next)` — when only the tool loadout changes; call it only if the set differs, because replacing it drops MCP tools still connecting.
  - Reopen the session (`moveToWorkspace`) — when the agent's workspace changes.
- **Busy session:** prompting while streaming uses `streamingBehavior: "followUp"`; commands that cannot run mid-answer throw `"Wait for the answer to finish."`.
