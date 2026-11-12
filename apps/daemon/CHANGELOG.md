# @workspace/daemon

## 0.11.3

### Patch Changes

- Updated dependencies [68fd487]
  - @workspace/shared@0.1.1
  - @workspace/agent-core@0.1.3

## 0.11.2

### Patch Changes

- be81544: A research report that compares numbers now includes a chart: a mermaid chart (`pie`, `xychart-beta`, `quadrantChart`, `sankey-beta`, `treemap-beta`) in the Markdown, which the app draws in the Files panel, and the same chart as inline SVG in the HTML report (mermaid does not run there). The plan card also no longer fails with "An answer … is not one of the options" when a clarifying question reuses the id `depth` or `start`, and the prompt says the report goes into `research/` through `research_report`, never `write`.
- Updated dependencies [be81544]
  - @workspace/agent-core@0.1.2

## 0.11.1

### Patch Changes

- ba917ce: Research fixes. The plan card no longer fails with "An answer … is not one of the options" when a clarifying question reuses the id `depth` or `start`: those ids are made unique and the clarifying questions are validated. Reports are always written into the workspace's `research/` folder by the app (the prompt says not to use `write` for them), and a report that compares numbers now includes a chart — an `svg` block in the Markdown that the app draws, and the same chart inline in the HTML.
- Updated dependencies [ba917ce]
  - @workspace/agent-core@0.1.1

## 0.11.0

### Minor Changes

- 2bb1d39: Diagrams and previews in the chat: mermaid diagrams and SVG pictures in replies are drawn instead of shown as code, with a switch back to the code. HTML pages, dashboards and Chart.js charts run after you press **Run**, in a sandboxed frame with no internet access, no navigation and no access to the app; they can be saved to the workspace's `artifacts` folder and opened in the Files panel, which now previews `.html` files the same way (desktop app only; the phone shows the code).

  Deep research is now a **mode**, like Claude Research or Gemini Deep Research: `/research [quick|standard|deep] <question>` in the app, or `/research` in Telegram and Zalo; no depth means standard. The agent frames the question, shows a **plan you confirm** (with the depth and, for comparisons, the items and fields), researches in rounds with parallel helpers (up to 8 at Deep), records the sources it cites, rates each key claim, critiques its own draft (a four-role red team at Deep, with one loop-back round), and saves a cited Markdown report and a self-contained HTML report in `research/` — written by the app, so no approval is asked. A banner shows the phase, pages read and sources cited; opening it lists the sources and, on the phone, the report. In Telegram the plan comes with buttons and the report arrives as `.md` and `.html` files; Zalo relies on text and the saved path. The built-in `deep-research` skill is removed (its playbook now lives in the mode); an unmodified copy is removed from existing installs.

  The agent now replies in the language you write in, cites sources as [1], [2] with a Sources list, names the files it saved, treats text from MCP tools and files (not only web pages) as data rather than instructions, and asks before deleting, sending to other people or changing many records.

### Patch Changes

- 2bb1d39: Quitting the app (including from the tray) now stops the daemon it started, even when the daemon was left behind by an earlier, crashed app and reused. The daemon tells clients in its handshake whether an app started it (`hello_ok.spawnedByApp`), and main shuts it down on quit in that case. A daemon started by the login service or from a terminal still keeps running, so background work is unaffected.
- Updated dependencies [2bb1d39]
- Updated dependencies [2bb1d39]
  - @workspace/shared@0.1.0
  - @workspace/agent-core@0.1.0

## 0.10.1

### Patch Changes

- 810191f: Security and performance hardening.

  - **Reading files:** the agent asks before it reads a file outside the workspace. It never reads PP Agent's own data folder (keys, tokens, settings) or `~/.ssh`.
  - **Browser tool:** looking at pages still runs on its own. Opening pages, clicking, typing and running scripts now ask first, and the agent cannot open addresses on this computer or the local network.
  - **Cookie import:** you pick which sites to import. Imported cookies are stored encrypted.
  - **Telegram and Zalo group chats:** every tool asks the owner first, and yolo mode does not apply. Your personal memory stays out of these chats, and each message shows who sent it. Only the owner can steer a running reply. Wrong pairing codes lock out only the person who sent them.
  - **Phone access:** a phone can no longer set up Telegram or Zalo, choose "always allow" for an app, create or delete workspaces, clear chats or memory, or turn the background service on or off. Devices unused for 30 days are signed out.
    - Requests that name an unknown host are refused.
    - Uploads are written straight to disk.
  - **Web search keys:** changing a search provider's address now clears its saved key.
  - **Approval cards:** cards show the whole command. On Telegram and Zalo, long commands show their start and end.
  - **Workspace skills and MCP servers:** skills in a workspace folder load only after you trust that folder. An MCP server's "read-only" labels count only when you mark the server trusted.
  - **Chat replies:** images from the internet no longer load inside replies.
  - **App and updates:** the app binary is locked down with Electron fuses. Windows updates install in-app only when the build is signed.
  - **Background service:** it no longer restarts every 10 seconds while the app's own background process is running. An existing service file is fixed automatically after the next update. The background log is rotated at 5 MB.
  - **Speed:**
    - The chat list is cached.
    - Long replies stream without re-rendering the whole conversation.
    - Settings load on demand.
    - Older screenshots are dropped from the model's context.
    - The terminal now has flow control.
    - Hidden browser tabs are throttled.
  - **Dependencies:** undici and body-parser are updated for security fixes.

- Updated dependencies [810191f]
  - @workspace/agent-core@0.0.5
  - @workspace/shared@0.0.5

## 0.10.0

### Minor Changes

- 25d0f11: Use several skills in one message: after picking a skill, type `/` again to add another. Picked skills (and `/goal`) now show as chips in the message box instead of raw `/skill:name` text, and the chat, titles, search and edit-and-resend all understand a message with several skills. The message box always has two rows (text, then controls), and the thinking level moved into the model menu as a slider. Arrow keys keep the highlighted slash command in view. The file tree and its tabs use vscode-icons file and folder icons. On a phone the sidebar covers the whole screen like Settings, and a chat's age no longer overlaps its title. Settings section actions stay on the title row, and the main and side panels lose their outline.

### Patch Changes

- Updated dependencies [25d0f11]
  - @workspace/shared@0.0.4
  - @workspace/agent-core@0.0.4

## 0.9.0

### Minor Changes

- cc137a9: PP Agent for iOS and Android: a phone app that connects to PP Agent on your computer through Phone access. Scan the pairing QR code in Settings › Phone access to connect and pair in one step, or type the computer's address (a Tailscale address works too). The app keeps you signed in, can use the microphone for voice input, and shares exported conversations through the phone's share sheet. Build it from `apps/mobile` with Xcode or Android Studio; it is not in the app stores yet.

  On phones the composer keeps its buttons on one row: a long model name is shortened and the thinking level shows as an icon.

### Patch Changes

- Updated dependencies [cc137a9]
  - @workspace/shared@0.0.3
  - @workspace/agent-core@0.0.3

## 0.8.0

### Minor Changes

- 6df5258: Phone access: use PP Agent from a phone (or another computer) on the same network, in its web browser. Turn it on in **Settings › Phone access**, scan the QR code, and the phone pairs in one step; then chat, attach photos and files, answer approvals, and change most settings from a layout made for small screens (full-screen Settings with a section list, actions always visible on touch, safe areas, add to home screen). The daemon serves the app, so it keeps working with the window closed when PP Agent runs in the background. Paired devices are listed with Unpair; pairing codes are one-time and expire after 10 minutes. The connection is plain HTTP, so Settings warns to use it only on trusted networks, and settings that let the agent run programs without asking (MCP servers, tool permissions, turning on the shell or yolo mode) can only be changed on the computer.

### Patch Changes

- Updated dependencies [6df5258]
  - @workspace/shared@0.0.2
  - @workspace/agent-core@0.0.2

## 0.7.2

### Patch Changes

- Updated dependencies [b3fe6fb]
- Updated dependencies [b3fe6fb]
  - @workspace/shared@0.0.1
  - @workspace/agent-core@0.0.1
