# Key decisions and rationale

## Pi SDK in an Electron utility process

The agent session (Pi SDK `@earendil-works/pi-coding-agent`) runs in an Electron `utilityProcess` (`apps/desktop/src/agent`), not in main or the renderer. Long model runs and tool calls stay off the UI and window-management thread, and the renderer keeps no network access. Main relays agent commands and agent events between the preload bridge and the agent process.

## safeStorage vault owned by main

API keys live in `credentials.json`, each value encrypted with Electron `safeStorage` (OS keychain), file mode 0600. Only the main process decrypts; the agent process asks through vault messages, and the renderer never sees keys. Built-in providers and gateways share this one store, so no key is set through runtime overrides.

## MCP through Pi's built-in extension, registered per agent

Pi's MCP extension is created with an empty config loader; the app's own extension registers only the open conversation's agent servers from `mcp.json` and re-registers the difference live on agent switch, agent edits, and `mcp.json` changes (`apps/desktop/src/agent/mcp.ts`). This reuses Pi's transports, OAuth, and `codemode` exposure while letting each agent connect just its servers. Status comes from parsing Pi's `/mcp` output because the extension exposes no status API.

## Agents instead of a separate chat mode

There is no separate "chat mode"; agents are profiles (rules, tools/MCP/skills subsets, model, workspace). A chat-only experience is an agent with a restricted tool set. One default agent keeps first-run simple.

## Approval based on tool tier and readOnlyHint

Approval follows a tool tier: built-ins have fixed tiers, MCP tools are `read` only when the server marks them `readOnlyHint`, everything unknown is `exec`. Under `auto`, read runs and everything else asks, so business users confirm any change by default while lookups stay friction-free. The shell is off by default and asks when on, unless its policy is explicitly set to `allow` after a warning (confirmation dialog plus a standing alert in Settings); `edit` is off because non-developers use `write`.

## Everyone may edit Settings

No admin lock; the tech team configures, but any user can change Settings (product owner's decision). Teams can also deploy `agent/mcp.json` and skills folders directly.

## API-key providers only

LLM providers use API-key sign-in; subscription OAuth is out of scope. Gateways cover company-hosted or proxy endpoints.
