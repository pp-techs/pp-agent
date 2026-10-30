# Computer use (the agent's `computer` tool)

The `computer` tool lets the agent use desktop apps on macOS and Windows through [cua-driver](https://github.com/trycua/cua) (MIT): it lists apps and windows, reads a window's accessibility tree (rows with element tokens) and screenshots, and clicks, types, presses keys, scrolls, drags and uses menus, delivered in the background where the app allows it. It is off by default and works only in conversations of the PP Agent window.

```mermaid
sequenceDiagram
  participant P as Pi session (daemon)
  participant G as approval-gate
  participant T as computer tool (agent-core)
  participant S as DaemonServer
  participant M as Main (DaemonClient)
  participant A as ComputerAutomation
  participant D as cua-driver (child of main)
  M->>S: computer_available { available } (window created, every reconnection)
  P->>G: tool_call computer { action, app, … }
  G->>G: tier by action; app protected / blocked / allowed / ask
  G-->>P: run, block, or approval card (first use of the app)
  P->>T: execute
  T->>S: ComputerBridge.request
  S->>M: computer_request { id, request } (newest client that offered it)
  M->>A: run(request, signal)
  A->>D: MCP tools/call (list_apps, get_window_state, click, …)
  D-->>A: text, structured content, image
  A-->>M: { text, image?, apps? }
  M->>S: computer_response { id, ok, result | error }
  S-->>T: result (60 s timeout; aborts with the tool call)
  T-->>P: fenced <screen> text (+ image)
```

## Who owns what

| Piece                                       | Owner                                                                                  | Why                                                                                                                                                                           |
| ------------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| cua-driver process, macOS grants            | Main (`apps/desktop/src/main/computer/`)                                               | macOS attributes Accessibility and Screen Recording to the responsible app of the process chain. Main spawns the driver directly, so PP Agent's own grants are the ones used. |
| Tool, approvals, always-allowed and blocked | Daemon (`packages/agent-core/src/computer-tool.ts`, `computer-apps.ts`, approval gate) | The daemon decides what runs; `settings.json` (`computerApps`) is the daemon's.                                                                                               |
| Settings › Computer use                     | Renderer (`apps/web/src/components/settings/computer-section.tsx`)                     | Status and grants through `window.ppAgent.computer`, lists and the on/off switch through agent commands.                                                                      |

A login-service daemon runs outside PP Agent's process chain, so it never starts the driver itself: without a window the tool answers that PP Agent must be open.

## The driver

- `scripts/fetch-cua-driver.mjs` downloads the release binary (checksum-pinned, version `0.38.0`) into `resources/cua-driver/<os>-<arch>/`: `cua-driver` on macOS (the universal binary reduced to the build's architecture with `lipo`), `cua-driver.exe` and `cua-driver-uia.exe` on Windows. electron-builder copies it outside the asar archive and signs it with the app on macOS. Linux builds have none; `ComputerStatus.supported` is false and main never offers the tool.
- `CuaDriver` (`driver.ts`) starts `cua-driver mcp --embedded --direct --host-bundle-id com.pptechs.agent` on the first step (`CUA_DRIVER_EMBEDDED=1`): one child that owns the automation runtime and speaks MCP on stdin/stdout (`StdioMcpClient`, `mcp-client.ts`). It stops after 10 minutes without steps, after a permission request and when the app quits (and exits on its own when stdin closes).
- On macOS the child's `HOME` is `<userData>/cua-driver`, so its settings and state stay apart from a cua-driver the person installed (apps it launches go through LaunchServices and do not inherit it; it does not see apps in `~/Applications`). Before the first start, where the driver has no settings yet, `.cua-driver/config.json` is written with `telemetry_enabled: false`. On Windows the driver resolves the profile folder itself, so it shares `%USERPROFILE%\.cua-driver` with any installed cua-driver; the same rule writes telemetry off only when that file does not exist.
- The agent cursor overlay is cua-driver's default.

## Grants (macOS)

`ComputerHost.status()` reads `systemPreferences.isTrustedAccessibilityClient(false)` and `getMediaAccessStatus("screen")`. **Grant access** asks for one grant per click: while Accessibility is missing it asks only for that (the system prompt, which opens its pane); once Accessibility is granted, the next click asks for Screen Recording (a 1×1 `desktopCapturer` request prompts once; afterwards the Screen Recording pane is opened). macOS may ask to quit and reopen PP Agent before a new Screen Recording grant applies. While a grant is missing, every step fails with a message telling the model to send the person to Settings › Computer use. Windows needs no grant.

## Calls

`ComputerAutomation` (`automation.ts`) maps one `ComputerRequest` to driver tools:

| Action                                 | Driver tools                                                                                          |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `apps`                                 | `list_apps`; running and installed apps by id (bundle id where there is one), protected ones left out |
| `launch`                               | `launch_app` (in the background)                                                                      |
| `windows`                              | `list_windows { pid }` (layer 0)                                                                      |
| `snapshot`                             | `get_window_state` (tree; `image` adds a screenshot of at most 1280 px; `query` narrows rows)         |
| `screenshot`                           | `get_window_state { include_accessibility_tree: false }`                                              |
| `click`, `double_click`, `right_click` | the tool of that name, by `element_token` or window pixels                                            |
| `type`, `set_value`, `press`, `hotkey` | `type_text`, `set_value`, `press_key`, `hotkey`                                                       |
| `scroll`, `drag`, `menu`               | `scroll`, `drag`, `invoke_menu`                                                                       |

- Every call but `apps` names an app. Main looks the id up again with `list_apps` on every call, refuses protected apps and PP Agent's own processes (`app.getAppMetrics()`), and acts only on that app's pid: a `window` must be one of its windows (else the front window, highest `z_index`), and a `ref` must be a token of a snapshot `ComputerAutomation` took of that pid (tokens of other apps, made-up ones and stale ones are refused before the driver sees them).
- Steps that change something are followed by `get_window_state { since: "latest" }`: the result is the driver's own report plus what changed in the window, which is the model's check of the step. `foreground: true` sends `delivery_mode: "foreground"` (the driver fronts the window for the step, then restores the person's app).
- Driver refusals (`isError`) become tool errors the model reads; text is cut at 25k characters. The tool fences screen text in `<screen>` and the description says it is untrusted.

## Approvals

- `toolTier("computer")` is `write` for the Tools page, but the gate rates each call by its action (`computerActionTier`): `apps`, `windows`, `snapshot`, `screenshot` are read, the rest write. The tool's policy defaults to `off`; Settings › Computer use switches it between `off` and `auto` (looking runs, acting asks), and Settings › Tools can set `ask` or `allow`.
- App access comes first (`computerAppAccess`, `computer-apps.ts`): an app that is protected (`isProtectedComputerApp`: PP Agent, terminals and script runners, System Settings, Keychain Access, password managers, Windows terminals, Registry Editor, Windows Security, Settings) or on the blocked list is refused; one allowed always (`computerApps.allowed`) or for the conversation (`ConversationState.computerApps`) goes on to the tool rule; any other app gets one approval card that carries `app`. The person answers **Allow once**, **Allow in this chat** (`remember: "conversation"`), **Always allow** (`remember: "always"`, added to `computerApps.allowed`) or **Deny**. The card also covers the step itself, so a write step on a new app asks once.
- Only window conversations pass `computerApps` to the gate; Telegram and Zalo chats, scheduled runs and helpers have none, so the gate blocks the tool there.
- `set_computer_app_access` moves an app between the lists (allowing a protected app is refused); blocking also drops it from every conversation's own list. At most 200 apps per list.
