# Key decisions and rationale

## The daemon is the only host of the agent

The agent session (Pi SDK `@earendil-works/pi-coding-agent`, `AgentHost` in `packages/agent-core`) runs in one headless Node process, `pp-agentd` (`apps/daemon`), never in Electron main, a utility process or the renderer. The window is a client. Reasons: the agent must keep running (scheduled tasks, the Telegram bot) with the window closed or the app not running; a long model run or tool call stays off the UI thread; and exactly one process owns the sessions, `settings.json` and the vault, so a headless run and a window never write the same files. The renderer keeps no network access. Main only finds, starts, replaces and reconnects to the daemon and relays commands and events. The same bundle runs under a service manager, from a terminal, or spawned by the app with `ELECTRON_RUN_AS_NODE`. See [Process model](../architecture/process-model.md).

## NDJSON frames over a local socket

Main and the daemon talk newline-delimited JSON (`ClientFrame` / `DaemonFrame`, `packages/shared`) over a Unix socket in the data folder (a named pipe on Windows), not over a child-process pipe or a TCP port. A socket lets any number of clients attach to a daemon that outlives them, needs no port, and is limited to the same user by file permissions; a token file adds authentication, and `hello` carries a protocol number and app version so an updated app replaces an outdated daemon instead of speaking to it. See [IPC and message flow](../architecture/ipc-and-messages.md).

## The daemon owns an AES-GCM vault with an OS-keyring master key

API keys, search keys, MCP sign-ins and the Telegram token live in `vault.json`, each entry AES-256-GCM encrypted with its id as authenticated data, file mode 0600. The master key is `PP_AGENT_MASTER_KEY`, else an entry in the OS keyring (`@napi-rs/keyring`), else `vault.key` beside the vault. Electron `safeStorage` only works inside Electron's main process, and the daemon runs without Electron (possibly while the app is closed), so it cannot be the vault. The cost is a weaker last resort where no keyring exists (a headless Linux box); the environment variable lets a deployment keep the key elsewhere. Built-in providers and gateways share this one store, so no key is set through runtime overrides. Credentials of the old `safeStorage` vault are imported once by main (`vault_import`) and the old file is deleted.

## Telegram answers one paired owner

The Telegram channel serves a single person: the one who sends the one-time code (`/pair CODE`) that Settings › Channels › Telegram generated (valid ten minutes, one use; five wrong tries lock pairing for fifteen minutes). Everyone else is ignored, and only the owner's taps approve tool calls. Only one owner is stored (`ownerId`); there is no access list and no group support, because the bot acts with the person's own agent, workspace and approvals. Replies come through long polling, so no webhook or public address is needed. Approvals are asked in the chat, with a ten-minute timeout that denies. See [Background and Telegram](use-case-background-and-telegram.md).

## MCP through Pi's built-in extension, registered per agent

Pi's MCP extension is created with an empty config loader; the app's own extension registers only the open conversation's agent servers from `mcp.json` and re-registers the difference live on agent switch, agent edits, and `mcp.json` changes (`packages/agent-core/src/mcp.ts`). This reuses Pi's transports, OAuth, and `codemode` exposure while letting each agent connect just its servers. Status comes from parsing Pi's `/mcp` output because the extension exposes no status API.

## Agents instead of a separate chat mode

There is no separate "chat mode"; agents are profiles (rules, tools/MCP/skills subsets, model, workspace). A chat-only experience is an agent with a restricted tool set. One default agent keeps first-run simple.

## Approval based on tool tier and readOnlyHint

Approval follows a tool tier: built-ins have fixed tiers, MCP tools are `read` only when the server marks them `readOnlyHint`, everything unknown is `exec`. Under `auto`, read runs and everything else asks, so business users confirm any change by default while lookups stay friction-free. The shell is off by default and asks when on, unless its policy is explicitly set to `allow` after a warning (confirmation dialog plus a standing alert in Settings); `edit` is off because non-developers use `write`.

## Everyone may edit Settings

No admin lock; the tech team configures, but any user can change Settings (product owner's decision). Teams can also deploy `agent/mcp.json` and skills folders directly.

## API-key providers only

LLM providers use API-key sign-in; subscription OAuth is out of scope. Gateways cover company-hosted or proxy endpoints.
