# Electron security rules

Rules enforced in `apps/desktop/src/main/index.ts`, the daemon (`apps/daemon`) and agent-core. Keep them when adding features.

- **Isolated renderer:** `BrowserWindow` uses `contextIsolation: true` and `sandbox: true`. The renderer reaches the system only through the preload bridge (`window.ppAgent`, typed `DesktopBridge`).
- **No navigation:** `will-navigate` is prevented. `setWindowOpenHandler` opens only `http://`/`https://` URLs with `shell.openExternal`; `openExternal` rejects any other protocol.
- **Untrusted IPC input:** `ipcMain.handle` arguments are `unknown`; check types and throw a plain-English error before acting.
- **Path validation:**
  - Reveal in Finder/Explorer only inside the user-data folder or the workspace (`isInside` in `apps/desktop/src/main/files.ts`).
  - Session paths from the renderer must resolve inside the session folder and end in `.jsonl` (`requireSessionPath` in `packages/agent-core/src/index.ts`).
  - Workspace folders must be absolute paths to existing (or creatable) folders that no other workspace uses (`packages/agent-core/src/workspaces.ts`).
- **Keys stay in the daemon:** API keys, search keys, MCP sign-ins and the Telegram bot token live in `vault.json` (AES-256-GCM, entry id as authenticated data), whose master key comes from `PP_AGENT_MASTER_KEY`, the OS keyring (`@napi-rs/keyring`), or `vault.key` (mode 0600) as the last resort (`apps/daemon/src/vault/index.ts`). Only the daemon reads the vault; the window never receives a key (`GatewayView` and `TelegramStatus` omit them) and main only decrypts the legacy `credentials.json` once, to import it. `safeStorage` is used for nothing else.
- **Local daemon socket:** the daemon listens only on a Unix socket (mode 0600, in a folder owned by the same user) or a Windows named pipe; there is no TCP listener. Every client must send `hello` with the token from `agentd.token` (mode 0600) within 5 s; the token is compared in constant time. Keep it that way: a new transport or a network listener needs its own authentication and a decision recorded in [Key decisions](../project-pdr/key-decisions.md).
- **Channels trust one person:** the Telegram bot answers only the paired owner's private chat, ignores everyone else, and accepts a pairing code only while the person has opened a pairing window in Settings (`packages/agent-core/src/channels/telegram/`). New channels must keep an owner check before anything reaches `AgentHost.gateway`, and approvals must be answerable only by that owner.
- **Approval gate:** tools that write or execute ask before running according to their tool tier and tool policy (`packages/agent-core/src/tools.ts`). New tools must declare a tier; untiered tools ask.
- **Model-controlled URLs:** `web_fetch` connects only through `guardedLookup` (`packages/agent-core/src/web/fetch.ts`), which refuses private, loopback, link-local and metadata addresses at connect time and on each redirect. Any new tool that fetches a model-supplied URL must reuse it. Search-provider requests use fixed or user-configured URLs and are not model-controlled.
