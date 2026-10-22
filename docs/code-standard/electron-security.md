# Electron security rules

Rules enforced in `apps/desktop/src/main/index.ts` and the agent process. Keep them when adding features.

- **Isolated renderer:** `BrowserWindow` uses `contextIsolation: true` and `sandbox: true`. The renderer reaches the system only through the preload bridge (`window.ppAgent`, typed `DesktopBridge`).
- **No navigation:** `will-navigate` is prevented. `setWindowOpenHandler` opens only `http://`/`https://` URLs with `shell.openExternal`; `openExternal` rejects any other protocol.
- **Untrusted IPC input:** `ipcMain.handle` arguments are `unknown`; check types and throw a plain-English error before acting.
- **Path validation:**
  - Reveal in Finder/Explorer only inside the user-data folder or the workspace (`isInside` in `apps/desktop/src/main/files.ts`).
  - Session paths from the renderer must resolve inside the session folder and end in `.jsonl` (`requireSessionPath` in `apps/desktop/src/agent/index.ts`).
  - Agent workspaces must be absolute paths to existing folders (`apps/desktop/src/agent/agents.ts`).
- **Keys stay in main:** API keys live in the vault (`credentials.json`, encrypted with Electron `safeStorage`). Only the main process decrypts; the agent process requests them over the vault channel (`apps/desktop/src/agent/credentials.ts` ↔ `apps/desktop/src/main/vault.ts`). Never send keys to the renderer; views such as `GatewayView` omit them.
- **Approval gate:** tools that write or execute ask before running according to their tool tier and tool policy (`apps/desktop/src/agent/tools.ts`). New tools must declare a tier; untiered tools ask.
