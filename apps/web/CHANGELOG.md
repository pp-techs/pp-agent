# @workspace/web

## 0.26.2

No changes in this release.

## 0.26.1

No changes in this release.

## 0.26.0

### Minor Changes

- 2bb1d39: Diagrams and previews in the chat: mermaid diagrams and SVG pictures in replies are drawn instead of shown as code, with a switch back to the code. HTML pages, dashboards and Chart.js charts run after you press **Run**, in a sandboxed frame with no internet access, no navigation and no access to the app; they can be saved to the workspace's `artifacts` folder and opened in the Files panel, which now previews `.html` files the same way (desktop app only; the phone shows the code).

  Deep research is now a **mode**, like Claude Research or Gemini Deep Research: `/research [quick|standard|deep] <question>` in the app, or `/research` in Telegram and Zalo; no depth means standard. The agent frames the question, shows a **plan you confirm** (with the depth and, for comparisons, the items and fields), researches in rounds with parallel helpers (up to 8 at Deep), records the sources it cites, rates each key claim, critiques its own draft (a four-role red team at Deep, with one loop-back round), and saves a cited Markdown report and a self-contained HTML report in `research/` — written by the app, so no approval is asked. A banner shows the phase, pages read and sources cited; opening it lists the sources and, on the phone, the report. In Telegram the plan comes with buttons and the report arrives as `.md` and `.html` files; Zalo relies on text and the saved path. The built-in `deep-research` skill is removed (its playbook now lives in the mode); an unmodified copy is removed from existing installs.

  The agent now replies in the language you write in, cites sources as [1], [2] with a Sources list, names the files it saved, treats text from MCP tools and files (not only web pages) as data rather than instructions, and asks before deleting, sending to other people or changing many records.

## 0.25.2

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

## 0.25.1

### Patch Changes

- 3c54f4c: PP Agent has a new logo: leaves growing around one core. It shows in the sidebar, on the empty chat screen and on the connect screen, in brand blue on light and dark themes, with a bolder version at small sizes. The app icon, tray icon, browser tab icon, and the iOS and Android icons and splash screens use it too.

## 0.25.0

### Minor Changes

- 25d0f11: Use several skills in one message: after picking a skill, type `/` again to add another. Picked skills (and `/goal`) now show as chips in the message box instead of raw `/skill:name` text, and the chat, titles, search and edit-and-resend all understand a message with several skills. The message box always has two rows (text, then controls), and the thinking level moved into the model menu as a slider. Arrow keys keep the highlighted slash command in view. The file tree and its tabs use vscode-icons file and folder icons. On a phone the sidebar covers the whole screen like Settings, and a chat's age no longer overlaps its title. Settings section actions stay on the title row, and the main and side panels lose their outline.

### Patch Changes

- Updated dependencies [25d0f11]
  - @workspace/ui@0.0.2

## 0.24.1

No changes in this release.

## 0.24.0

### Minor Changes

- cc137a9: PP Agent for iOS and Android: a phone app that connects to PP Agent on your computer through Phone access. Scan the pairing QR code in Settings › Phone access to connect and pair in one step, or type the computer's address (a Tailscale address works too). The app keeps you signed in, can use the microphone for voice input, and shares exported conversations through the phone's share sheet. Build it from `apps/mobile` with Xcode or Android Studio; it is not in the app stores yet.

  On phones the composer keeps its buttons on one row: a long model name is shortened and the thinking level shows as an icon.

## 0.23.0

### Minor Changes

- 6df5258: Phone access: use PP Agent from a phone (or another computer) on the same network, in its web browser. Turn it on in **Settings › Phone access**, scan the QR code, and the phone pairs in one step; then chat, attach photos and files, answer approvals, and change most settings from a layout made for small screens (full-screen Settings with a section list, actions always visible on touch, safe areas, add to home screen). The daemon serves the app, so it keeps working with the window closed when PP Agent runs in the background. Paired devices are listed with Unpair; pairing codes are one-time and expire after 10 minutes. The connection is plain HTTP, so Settings warns to use it only on trusted networks, and settings that let the agent run programs without asking (MCP servers, tool permissions, turning on the shell or yolo mode) can only be changed on the computer.

### Patch Changes

- Updated dependencies [6df5258]
  - @workspace/ui@0.0.1

## 0.22.4

### Patch Changes

- b3fe6fb: Zalo now answers group chats, not just private ones: Zalo only forwards a group message to the bot when someone @-mentions it or replies to one of its messages, so the owner's tag or reply works right away. Settings › Channels › Zalo gained per-chat settings (label, access, allowed users, busy mode) mirroring Telegram's, letting a chat be opened to specific members instead of the owner only.

## 0.22.3

No changes in this release.

## 0.22.2

No changes in this release.

## 0.22.1

No changes in this release.

## 0.22.0

### Minor Changes

- f924df4: Added a local audit log for debugging. PP Agent now keeps a record of errors and key events (model failures with what the provider actually said and which model it was, approvals asked, background-service drops, app and page crashes) in `logs/audit.log` next to the app's data. It never holds the text of conversations, and keys, tokens, cookies and your account name in file paths are hidden. A failed answer now has a button to copy the provider's error, and Settings › General › Diagnostics exports the log together with the system details and the tail of the background service's log, so you can send one file when you hit "The model returned an error". You can also show the log folder or clear the log there.
- a5ec7aa: Added temporary chats. Press the dashed-bubble toggle in the top bar, or type `/temp`, to start a chat that is kept in memory only: it never appears in the chat list or search, is not summarized into long-term memory, cannot be exported or branched, and is deleted when you open another chat or start a new one. The toggle reads "Temporary" while it is on; press it again to leave for a normal chat. A note on the empty chat marks it too.

## 0.21.1

No changes in this release.

## 0.21.0

No changes in this release.

## 0.20.1

### Patch Changes

- 75fa0ee: The agent's checklist is now pinned above the message box, so you can follow it while the chat scrolls. It shows how many steps are done and can be collapsed to a single line with the step in progress.

## 0.20.0

### Minor Changes

- f7a0b53: Added the `/goal` command. Type `/goal` and what you want done: the agent starts on it and keeps working turn after turn by itself until it reports the goal done. A banner above the message box shows the goal with pause, resume and clear (`/goal pause`, `/goal resume` and `/goal clear` do the same). Stopping the answer pauses the goal, and a turn where the agent only answers or asks something waits for your reply. A conversation opened again shows its goal paused.
- f7a0b53: Sub agents. The agent can now hand up to five research tasks to sub agents in one go and they work at the same time, each showing its own steps in the chat. A task can name one of your Agents, and its sub agent then follows that agent's rules, model and tool list. Sub agents are still read-only: they can read, search and use the web, but cannot change anything.

### Patch Changes

- f7a0b53: A new conversation is titled as soon as you send its first message, without waiting for the reply. Lasting memory notes are now picked up after every reply, including ones you watch to the end, and without you asking: who you are, people you mention, how you want answers, your tools and projects. Notes already saved are not repeated. Before, both only happened when you moved to another conversation while it was still answering.
- f7a0b53: Fixed importing cookies on Windows telling you to quit a browser you had already closed. The message now explains that Chrome, Edge and Brave can keep running in the background (system tray, “Continue running background apps”) and hold the cookies locked. When the browser is not running at all, it shows the real reason (security software or file permissions) instead.
- f7a0b53: The agent's built-in instructions now only explain how to use its tools and skills, without describing the user as an office or non-technical audience.
- f7a0b53: The right panel's buttons are now ordered Files, Browser, Terminal.

## 0.19.0

### Minor Changes

- 6fafe10: Added yolo mode: skips the approval step for every tool that is already allowed, including shell commands once "Allow shell commands" is on, and skips the first-use "Let the agent use X?" card for an app the computer tool opens (protected apps still refuse). Turn it on for every conversation in Settings › Tools, or for just the open chat with the rabbit button in its header or the `/yolo` command. It does not turn on anything by itself, and locked or off tools stay off.
- a540945: Added "Clear all chats" to each workspace's menu in the sidebar, to delete every saved conversation of that workspace at once.

### Patch Changes

- 3107d8f: Fixed the chat view jumping to the top whenever a tool call finished. The patched `@shadcn/react` message scroller no longer re-anchors an already-seen historical turn when a loader swaps for its result in the same render.
- 924607c: When the model fails (timeout, rate limit, server error), the chat now shows one short sentence instead of the raw error text from the provider.

## 0.18.0

### Minor Changes

- cfc6ee2: The agent can use desktop apps on macOS and Windows. Turn it on in **Settings › Computer use** (on macOS, grant Accessibility and Screen Recording there first), then ask it to work in an app: it reads the app's windows, clicks, types, presses keys and uses menus, usually without taking over your screen. The first time it uses an app in a chat, it asks: allow once, in this chat, or always. Looking at a window runs on its own; clicking and typing ask first unless you change that in **Settings › Tools**. It never uses PP Agent itself, terminals, or password and privacy settings, and you can block any other app. It works while the PP Agent window is open.

## 0.17.0

### Minor Changes

- 6b56865: The agent can use the browser in the side panel. Ask it to fill in a form, check a dashboard you are signed in to, or collect information from a site, and it opens tabs (in the profile you name, otherwise the default one), reads the page, clicks, types, picks options, and takes screenshots, while the panel shows every step. It can also work in tabs you already opened. The browser tool runs without asking by default; switch it to ask or off in **Settings › Tools**. It works while the PP Agent window is open.
- 6b56865: A side panel next to the chat (the panel button in the top bar, or Cmd+J / Ctrl+J) with three tools; drag its edge to resize it, or expand it over the chat. **Terminal** opens your own shell in the conversation's workspace folder, with several terminals per workspace. **Files** lists the workspace folder, refreshes as files change, opens files in tabs with a preview of text, code, Markdown and images, and attaches a file to your message. **Browser** opens web pages in tabs, each tab in a profile with its own sign-ins. Manage profiles in **Settings › Browser** and import every cookie of a Chrome, Edge, Brave, Arc or Chromium profile (macOS), of Chrome, Edge, Brave or Chromium (Windows), or of Firefox, so you stay signed in to the same sites. Deleting a profile removes its sign-ins from PP Agent only.

## 0.16.0

No changes in this release.

## 0.15.0

### Minor Changes

- 1028283: Chat with the agent from Zalo. Create a bot with "Zalo Bot Manager", paste its token in **Settings › Channels › Zalo**, and pair your account with a one-time code, as with Telegram. Send text, photos, or voice notes; approvals and questions are answered by replying with a number, since Zalo has no buttons.

### Patch Changes

- 9290c1f: Settings › Models no longer grows the whole panel when editing a gateway. Add/Edit gateway now opens in its own dialog with a fixed header and footer, so only the model list scrolls. Fixed a duplicate card for gateways that are both connected and listed under Custom gateways, and added a delete action for connected gateways.

## 0.14.0

### Minor Changes

- 4b19c02: Notes the agent remembers are now plain markdown files you can read and edit: `MEMORY.md` for notes that hold everywhere, and `.agents/MEMORY.md` in a workspace's folder for that project's notes. Your saved notes move there the first time the app starts. Deleting a workspace no longer deletes its notes. Searching notes matches whole words instead of any letters inside a word.
- 4b19c02: A workspace's rules are now the `AGENTS.md` in its folder, like in other coding agents: edit it in Settings › Workspaces or with any editor, and it applies to every chat there. Rules you had typed into a workspace move into that file the first time the app starts. Skills in the folder's `.agents/skills` are always available in its chats, whichever agent you use.

### Patch Changes

- 44ad2cd: Web search works without any setup. When no search service with a key is turned on, or all of them fail, the agent searches with Exa and then DuckDuckGo, which need no key (the words searched for are sent to them). Services you set up are always tried first, and the result says when no key was used.

## 0.13.0

### Minor Changes

- ba90ff2: A workspace now uses the skills in its folder's `.agents/skills`: the agent can read and follow them in that workspace's chats, and they appear in the `/` menu next to your installed skills.

### Patch Changes

- 0320be1: Buttons that destroy something now look the part: delete, clear, disconnect, sign out and the confirm button of every confirmation dialog use the red destructive style everywhere — notes, scheduled tasks, workspaces, gateways and providers, MCP servers, and the chat sidebar. Non-destructive actions (edit, reconnect, sign in, add) keep their neutral style.
- ba90ff2: Several chats can answer at the same time. Opening another chat or starting a new one no longer stops the answer in progress: it carries on in the background, shows a spinner (or a dot when it waits for your approval or an answer) in the sidebar, and is there in full when you open it again.
- ba90ff2: Sending a message in a long chat keeps the view on it instead of jumping back to the top, and opening another chat starts at its end.

## 0.12.0

No changes in this release.

## 0.11.1

No changes in this release.

## 0.11.0

No changes in this release.

## 0.10.1

No changes in this release.

## 0.10.0

No changes in this release.

## 0.9.2

No changes in this release.

## 0.9.1

No changes in this release.

## 0.9.0

No changes in this release.

## 0.8.1

No changes in this release.

## 0.8.0

No changes in this release.

## 0.7.1

No changes in this release.

## 0.7.0

### Minor Changes

- f749f5a: Chat history. Search your conversations from the sidebar (titles and messages, ignoring case and accents), pin chats to a Pinned group, and export a conversation as Markdown or a printable web page. Messages now have actions: copy, edit and resend, regenerate the last answer, and branch into a new chat. The context popover shows tokens used and the estimated cost of the conversation.
- f749f5a: Custom gateways can now be marked as not needing an API key (Ollama, LM Studio, vLLM), so their models work right away, and the model picker lists the models of gateways that still need a key, marked "Needs key".
- f749f5a: Memory, checklists and helpers. The agent can keep short notes across conversations (Settings › Memory lets you view, edit, delete and switch them off, and each agent has its own switch). For tasks with several steps it shows a live checklist in the chat. It can also hand a research task to a read-only helper that returns only a summary.
- f749f5a: Word, Excel, and PowerPoint files. The agent can now create, read, and edit .docx, .xlsx, and .pptx files in your workspace with the bundled OfficeCLI, including charts and tables. Saving or changing a file asks first. Ready-made Office skills are built in.
- f749f5a: Scheduled tasks and voice input. Settings › Scheduled tasks lets you set prompts that run by themselves every few minutes or hours, daily, or on chosen weekdays, each in the agent and workspace you pick; every run is saved as a conversation in the sidebar. Runs have nobody to approve actions, so anything that needs approval is skipped and noted unless its tool is set to Allow. The microphone button in the message box records up to 5 minutes and writes your speech into the draft; choose the speech-to-text provider, model and language in Settings › General › Voice input.

### Patch Changes

- f749f5a: macOS builds are signed with a Developer ID and notarized when the maintainers have configured certificates, so they open without Gatekeeper warnings.

## 0.6.0

### Minor Changes

- 310bcdc: Context. Compact now works on shorter conversations instead of saying there is nothing to summarize. The chat keeps showing every message after a compaction, with a divider where earlier messages were summarized. Old tool results are replaced with a short note in what the model reads, so long tool-heavy chats fill the context window more slowly; what you see in the chat does not change.

### Patch Changes

- 310bcdc: MCP servers that run a local command (`npx`, `uvx`, and similar) now work when the app is opened from Finder or the Dock. The app reads `PATH` from your login shell at startup.

## 0.5.0

### Minor Changes

- 908a6cd: Languages. The whole app, including errors, approval cards, and dialogs, is now available in English and Tiếng Việt. Choose the language in Settings › General; "System" follows your computer's language.

## 0.4.0

### Minor Changes

- 0f67497: Web search. The agent can search the web (`web_search`) and read pages, PDFs and Office files from the internet (`web_fetch`; private-network addresses are refused). Settings › Tools › Web search picks and orders the search services: SearXNG, Serper, Tavily, Brave, Exa, and webclaw. Keys stay in the encrypted vault. Shell commands can now be set to run without asking, after a confirmation, with a warning shown in Settings while that is on.

## 0.3.0

### Minor Changes

- a43ab07: Context window and model names. The chat's top bar shows how full the model's context window is, with a button to compact the conversation, and a shortcut to the workspace folder. Gateway models now get their context window, reply limit, and display name from the gateway or Pi's model list instead of always 128k, and you can edit both per model. Model names are shown short and readable (`anthropic-subscription/claude-sonnet-5-5` appears as "Claude Sonnet 5.5"), with the id added when two models in a provider share a name.
- a43ab07: Workspaces. The chat list is grouped by workspace, and each workspace (Settings › Workspaces) has its own folder, instructions, and defaults for new chats: agent, model, and thinking level. The working folder moved from agents to workspaces; folders agents used before become workspaces that start with that agent.

## 0.2.0

### Minor Changes

- 18d8e8e: Check for updates. The app looks for a new version when it starts and under Settings › General › Updates, and shows a notice in the sidebar. Windows and Linux (AppImage) download and install the update from inside the app; on macOS and with the `.deb` package it opens the download page.

## 0.1.0

### Minor Changes

- c192e5a: First public release of PP Agent, a desktop AI agent for business teams.

  - Chat with streaming answers, saved conversation history, and approvals before the agent changes anything.
  - Attach files and images; the agent reads PDF, Word, Excel, PowerPoint, and other documents.
  - Connect Pi's built-in AI providers with an API key, or your own OpenAI- or Anthropic-compatible gateways; pick the model and thinking level per conversation.
  - Agents: profiles with their own rules, tools, MCP servers, skills, model, starter prompts, and workspace folder, with import and export.
  - Business systems through MCP servers, managed in Settings, with per-tool approval policies and OAuth sign-in.
  - Skills: import, write, and use them with `/skill:<name>`; slash commands `/new` and `/compact`.
  - Installers for macOS (Apple silicon and Intel), Windows, and Linux.
