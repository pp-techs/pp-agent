# @workspace/desktop

## 0.30.1

### Patch Changes

- 3e41e43: An HTML file's preview fills the whole file tab again instead of stopping at the frame's 150px default height.
- ecf93fe: On a phone: the chat's top bar has a folder button that opens the workspace's files, the arrow above them returns to the chat, and the phone's back gesture leaves the page instead of the app. A Markdown file's YAML frontmatter now shows as the fields it holds rather than as raw `---` lines and a stray heading. HTML previews run in the phone app and in the browser on the local network too — in the same sandbox with no network, charts included — instead of showing as text, and their code is a switch away. Tapping a search or filter field no longer zooms the page (iOS), chat search has a Close button since a phone has no Escape key, and the thinking-level slider is no longer pure black in the light theme. Settings › Remote access has a server icon instead of a phone.

## 0.30.0

### Minor Changes

- 5ef2727: Files, terminals and browser pages open as tabs in the main area, next to the chat, and you switch between them like tabs. This includes the tabs the agent opens and the pages that open from links. Each workspace keeps its own tabs, a "+" starts a terminal or a browser tab (Cmd+T / Ctrl+T opens a browser tab), and a second group splits the main area in two. The right side panel is now the file browser only (Cmd+J / Ctrl+J). The chat keeps running behind the other tabs.
- 5ef2727: The app on a phone can now browse the computer's workspace files: a **Files** page in the sidebar opens folders and shows a file as text or an image: Markdown rendered, code highlighted and copyable, a breadcrumb back to any folder and a filter for long folders. It reads them over the remote connection, only inside the workspace folder, and never from the app's own data folder.

## 0.29.0

### Minor Changes

- 2ba4a99: Settings has one place per job. Voice input is a group of Models ("Speech to text"), MCP servers are a page under Tools, and the browser's sign-in profiles and computer use share a "This computer" section with two tabs. The remaining sections are listed in the order the app is set up, and updates, the configuration bundle and the diagnostics log moved out of General into a new Advanced section.

### Patch Changes

- 2ba4a99: A research run now saves its report in a folder of its own: `research/<question>-<date>/report.md` and `report.html`, instead of loose files directly in `research/`. Each run gets its own folder (`-2`, `-3`… when the name is taken), so reports no longer mix.

## 0.28.0

### Minor Changes

- 480cd3c: Configuration bundles: export the setup of this computer — gateways and default models, agents, MCP servers, tool policies, skill lists — as one file to give other people's copies the same setup, or import one in Settings › General. A file dropped into the app folder as `settings.import.json` is applied at the next start, so a setup script or MDM can configure the app without anyone at the keyboard. Keys and tokens are never in the bundle: each computer keeps its own.

## 0.27.0

### Minor Changes

- 913c4b5: The desktop app can open another computer's PP Agent in its own window, from Settings › Remote access › Work on another computer. It pairs like a phone: type the address, or paste the link from that computer's QR code.

## 0.26.2

### Patch Changes

- be81544: A research report that compares numbers now includes a chart: a mermaid chart (`pie`, `xychart-beta`, `quadrantChart`, `sankey-beta`, `treemap-beta`) in the Markdown, which the app draws in the Files panel, and the same chart as inline SVG in the HTML report (mermaid does not run there). The plan card also no longer fails with "An answer … is not one of the options" when a clarifying question reuses the id `depth` or `start`, and the prompt says the report goes into `research/` through `research_report`, never `write`.

## 0.26.1

### Patch Changes

- ba917ce: Research fixes. The plan card no longer fails with "An answer … is not one of the options" when a clarifying question reuses the id `depth` or `start`: those ids are made unique and the clarifying questions are validated. Reports are always written into the workspace's `research/` folder by the app (the prompt says not to use `write` for them), and a report that compares numbers now includes a chart — an `svg` block in the Markdown that the app draws, and the same chart inline in the HTML.

## 0.26.0

### Minor Changes

- 2bb1d39: Diagrams and previews in the chat: mermaid diagrams and SVG pictures in replies are drawn instead of shown as code, with a switch back to the code. HTML pages, dashboards and Chart.js charts run after you press **Run**, in a sandboxed frame with no internet access, no navigation and no access to the app; they can be saved to the workspace's `artifacts` folder and opened in the Files panel, which now previews `.html` files the same way (desktop app only; the phone shows the code).

  Deep research is now a **mode**, like Claude Research or Gemini Deep Research: `/research [quick|standard|deep] <question>` in the app, or `/research` in Telegram and Zalo; no depth means standard. The agent frames the question, shows a **plan you confirm** (with the depth and, for comparisons, the items and fields), researches in rounds with parallel helpers (up to 8 at Deep), records the sources it cites, rates each key claim, critiques its own draft (a four-role red team at Deep, with one loop-back round), and saves a cited Markdown report and a self-contained HTML report in `research/` — written by the app, so no approval is asked. A banner shows the phase, pages read and sources cited; opening it lists the sources and, on the phone, the report. In Telegram the plan comes with buttons and the report arrives as `.md` and `.html` files; Zalo relies on text and the saved path. The built-in `deep-research` skill is removed (its playbook now lives in the mode); an unmodified copy is removed from existing installs.

  The agent now replies in the language you write in, cites sources as [1], [2] with a Sources list, names the files it saved, treats text from MCP tools and files (not only web pages) as data rather than instructions, and asks before deleting, sending to other people or changing many records.

### Patch Changes

- 2bb1d39: Quitting the app (including from the tray) now stops the daemon it started, even when the daemon was left behind by an earlier, crashed app and reused. The daemon tells clients in its handshake whether an app started it (`hello_ok.spawnedByApp`), and main shuts it down on quit in that case. A daemon started by the login service or from a terminal still keeps running, so background work is unaffected.

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

## 0.24.1

No changes in this release.

## 0.24.0

### Minor Changes

- cc137a9: PP Agent for iOS and Android: a phone app that connects to PP Agent on your computer through Phone access. Scan the pairing QR code in Settings › Phone access to connect and pair in one step, or type the computer's address (a Tailscale address works too). The app keeps you signed in, can use the microphone for voice input, and shares exported conversations through the phone's share sheet. Build it from `apps/mobile` with Xcode or Android Studio; it is not in the app stores yet.

  On phones the composer keeps its buttons on one row: a long model name is shortened and the thinking level shows as an icon.

## 0.23.0

### Minor Changes

- 6df5258: Phone access: use PP Agent from a phone (or another computer) on the same network, in its web browser. Turn it on in **Settings › Phone access**, scan the QR code, and the phone pairs in one step; then chat, attach photos and files, answer approvals, and change most settings from a layout made for small screens (full-screen Settings with a section list, actions always visible on touch, safe areas, add to home screen). The daemon serves the app, so it keeps working with the window closed when PP Agent runs in the background. Paired devices are listed with Unpair; pairing codes are one-time and expire after 10 minutes. The connection is plain HTTP, so Settings warns to use it only on trusted networks, and settings that let the agent run programs without asking (MCP servers, tool permissions, turning on the shell or yolo mode) can only be changed on the computer.

## 0.22.4

### Patch Changes

- b3fe6fb: Zalo now answers group chats, not just private ones: Zalo only forwards a group message to the bot when someone @-mentions it or replies to one of its messages, so the owner's tag or reply works right away. Settings › Channels › Zalo gained per-chat settings (label, access, allowed users, busy mode) mirroring Telegram's, letting a chat be opened to specific members instead of the owner only.

## 0.22.3

### Patch Changes

- 2d38406: The app window now opens larger by default (1440×900 instead of 1100×780).
- 1354aaa: Sub agents now show their status while they work: every helper in a `delegate_task` call is listed with its working/finished/failed state and latest step, under the call and in a panel above the message box.

## 0.22.2

### Patch Changes

- d047082: An agent's skill list now also filters the skills a workspace carries in `.agents/skills`, so skills layer as global → workspace → agent. The agent editor lists workspace skills next to installed ones.
- d047082: The app now ships the `skill-creator` skill (Anthropic's, Apache-2.0): it is installed as a built-in skill and helps create, edit and test skills.

## 0.22.1

### Patch Changes

- 6320e34: Chatting through a gateway with a reasoning model no longer fails with "unknown variant `developer`": gateway requests always send the system prompt with the `system` role, which every OpenAI-compatible server accepts.

## 0.22.0

### Minor Changes

- f924df4: Added a local audit log for debugging. PP Agent now keeps a record of errors and key events (model failures with what the provider actually said and which model it was, approvals asked, background-service drops, app and page crashes) in `logs/audit.log` next to the app's data. It never holds the text of conversations, and keys, tokens, cookies and your account name in file paths are hidden. A failed answer now has a button to copy the provider's error, and Settings › General › Diagnostics exports the log together with the system details and the tail of the background service's log, so you can send one file when you hit "The model returned an error". You can also show the log folder or clear the log there.
- a5ec7aa: The Files tool in the side panel does more. Markdown files can be switched between the rendered preview and their text with the button next to the path. Cmd+W (Ctrl+W on Windows and Linux) closes the file tab in front; with no file tab showing it closes the window as before. Create a file or folder with the new buttons above the tree, and rename (also F2) or move to the trash (also Delete) any file or folder from its right-click menu. Cmd+K (Ctrl+K) opens the chat search from the sidebar, and closes it again.
- a5ec7aa: Added temporary chats. Press the dashed-bubble toggle in the top bar, or type `/temp`, to start a chat that is kept in memory only: it never appears in the chat list or search, is not summarized into long-term memory, cannot be exported or branched, and is deleted when you open another chat or start a new one. The toggle reads "Temporary" while it is on; press it again to leave for a normal chat. A note on the empty chat marks it too.

## 0.21.1

### Patch Changes

- 6ed582a: Importing cookies on Windows no longer sends you to the system tray. When the browser you import from is running, also in the background, the import dialog says so and its button becomes **Quit Chrome and import**: it closes the browser, waits until its cookies are free, and imports. If you quit the browser yourself, the note disappears on its own.

## 0.21.0

### Minor Changes

- b083fb6: Long-term memory is smarter and cheaper. The agent now reads a conversation for things worth remembering once it has been quiet for a few minutes or when you leave it, instead of after every reply, and it can correct or remove an outdated note instead of piling up contradictions. Each time it remembers something a "Remembered" notice appears with an **Undo** button. Notes can be pinned (Settings › Memory) so they are always in the agent's mind, and the notes a conversation starts with stay the same while it runs, which keeps replies fast. Searching notes now ignores accents ("tieng viet" finds "tiếng Việt"). A new **Fast model** setting (Settings › Models) chooses the model for conversation titles and memory; by default it is the cheapest model of the conversation's provider.

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

### Minor Changes

- d84023d: A conversation left in the background now gets two things for free once it settles: a short title generated from how it started (if you have not named it yourself), and, when long-term memory is on, any lasting facts or preferences it mentioned are saved automatically — on top of the agent still being able to save a note itself when asked. Both run as a separate, one-shot background call and never block or show up in the chat; a failure in either is silent and leaves the conversation as it was.

## 0.15.0

### Minor Changes

- 1028283: Chat with the agent from Zalo. Create a bot with "Zalo Bot Manager", paste its token in **Settings › Channels › Zalo**, and pair your account with a one-time code, as with Telegram. Send text, photos, or voice notes; approvals and questions are answered by replying with a number, since Zalo has no buttons.

## 0.14.0

### Minor Changes

- 4b19c02: Notes the agent remembers are now plain markdown files you can read and edit: `MEMORY.md` for notes that hold everywhere, and `.agents/MEMORY.md` in a workspace's folder for that project's notes. Your saved notes move there the first time the app starts. Deleting a workspace no longer deletes its notes. Searching notes matches whole words instead of any letters inside a word.
- 4b19c02: A workspace's rules are now the `AGENTS.md` in its folder, like in other coding agents: edit it in Settings › Workspaces or with any editor, and it applies to every chat there. Rules you had typed into a workspace move into that file the first time the app starts. Skills in the folder's `.agents/skills` are always available in its chats, whichever agent you use.

### Patch Changes

- 44ad2cd: Web search works without any setup. When no search service with a key is turned on, or all of them fail, the agent searches with Exa and then DuckDuckGo, which need no key (the words searched for are sent to them). Services you set up are always tried first, and the result says when no key was used.
- 44ad2cd: Web pages the agent opens now read as the article or documentation itself, without the menus, footers and sign-in banners around it, so more of a long page fits in one read. The app bundles the webclaw tool for this (AGPL-3.0, run as a separate program) and falls back to its own conversion where webclaw is not available.

## 0.13.0

### Minor Changes

- ba90ff2: A workspace now uses the skills in its folder's `.agents/skills`: the agent can read and follow them in that workspace's chats, and they appear in the `/` menu next to your installed skills.

### Patch Changes

- 0320be1: Buttons that destroy something now look the part: delete, clear, disconnect, sign out and the confirm button of every confirmation dialog use the red destructive style everywhere — notes, scheduled tasks, workspaces, gateways and providers, MCP servers, and the chat sidebar. Non-destructive actions (edit, reconnect, sign in, add) keep their neutral style.
- ba90ff2: Several chats can answer at the same time. Opening another chat or starting a new one no longer stops the answer in progress: it carries on in the background, shows a spinner (or a dot when it waits for your approval or an answer) in the sidebar, and is there in full when you open it again.
- ba90ff2: Sending a message in a long chat keeps the view on it instead of jumping back to the top, and opening another chat starts at its end.

## 0.12.0

### Minor Changes

- 9fd284c: Settings › Tools groups the tools by what they are for — files and folders, documents, web, memory, shell commands, tasks and conversations — each behind a compact header with its tool count, and one group per MCP server after them. The shell commands switch and the web search services summary sit inside their groups instead of separate blocks at the top, and the warning about commands running without asking is shown once, next to the switch. Click a header to open its tools; searching opens the groups that match.
- 9fd284c: The sidebar header now leads with the PP Agent logo and name, with a search button and the sidebar toggle on the right; the New workspace button is gone (workspaces are managed in Settings › Workspaces). Search opens as a command dialog over your chats — type to search, arrow keys and Enter to open a chat — instead of the search box that used to sit in the sidebar. The sidebar minimizes to an icon rail — logo and icons stay, chat lists fold away — where hovering the logo reveals the button that expands it again; the top bar keeps its sidebar toggle for mobile only. Search fields in the pickers no longer touch the entries below them.

## 0.11.1

### Patch Changes

- c09c64b: Updates the bundled OfficeCLI to 1.0.159 (Word, Excel and PowerPoint support).

## 0.11.0

### Minor Changes

- 5342a98: The agent now uses "Scheduled tasks" (`schedule_manage`) to create one-shot reminders and recurring jobs, list or update tasks, pause/resume them, run them now, and remove them. It accepts conversation targets and result-delivery destinations, including the paired Telegram owner or an explicitly configured chat. Schedule approvals disclose the action, time, target, delivery, and run controls. Scheduled runs cannot create further tasks; their result delivery is handled by the host, not a separate Telegram notification tool. "See other conversations" lets the agent inspect saved sessions, with member chats restricted to their own conversation.

  Schedules now has its own navigation item beside Settings in the sidebar footer, opening a dedicated management page in the main panel. Workspace sessions use the full sidebar content area again, with no inline schedules or fixed height split. The Workspace management icon matches the muted group label color.

  Fix one-shot editing and re-arming, preserve delivery options and outcomes, and keep Telegram chat access settings and session history across restarts. Telegram chat configuration supports adding the first private/group ID and clearing saved fields. Session commands now dispatch correctly; busy steering falls back to the queue when it cannot accept the input. Delivery honors the selected configured chat and preserves concurrent delivery-ledger updates.

## 0.10.1

### Patch Changes

- 888ea72: The export menu in the chat header no longer wraps: it is wide enough for "Web page (.html, printable)", and each format shows its own icon. The sidebar search box shows a search icon.
- 888ea72: The agent's questions now replace the message box in the chat, one at a time, with numbered options you can pick with the keys 1-9, the arrows, Enter, and Esc to skip. The message box folds into two rows when the window is narrow. The app uses the Geist font. Voice input has its own section in Settings, and the Settings menu is reordered: Tools, MCP servers and Skills now sit together.

## 0.10.0

### Minor Changes

- 7286076: The agent can now ask you a question with options to pick from, in the chat window and in Telegram, instead of guessing. You can choose one or several options or type an answer of your own, or skip the question. It asks only when your choice really changes the result. Agents that have their own tool list need "Ask you questions" ticked in the agent's tools; Settings › Tools can switch it off. Scheduled tasks never ask.

## 0.9.2

### Patch Changes

- 41e508e: "Restart to update" now really restarts: with the tray icon on, the app hid itself instead of quitting, so the update never installed and the app never came back. If an update is already stuck this way, quit the app from its tray icon and install this version once by hand; the next updates restart on their own.

## 0.9.1

### Patch Changes

- 6991c9d: A sent message now appears in the chat right away, with a "Sending" note until the conversation takes it and a "Thinking" note until the agent starts answering, so a slow start no longer looks like the message never left.

## 0.9.0

### Minor Changes

- 7da39e8: Voice input now prefers a local model: the microphone button turns speech into text with whisper.cpp on your own computer, with nothing sent anywhere and no key needed. Settings › General › Voice input offers "This computer (whisper.cpp)" by default with a model to download (tiny to medium, 74 MB–1.4 GB); whisper.cpp is found on the PATH (`brew install whisper-cpp`) or bundled with the app. A transcription service with a key is still available as a choice. Recordings are converted to 16 kHz wav in the app, and formats whisper cannot read itself (Telegram voice notes) go through ffmpeg when it is installed. Telegram voice messages use the same setting.
- 7da39e8: Long-term memory is now scoped: every note lives either everywhere or in one workspace only, so project facts no longer leak into other projects. `memory_save` takes a `scope` (`global` or `workspace`), the tools and the `## Memory` prompt section show a conversation every workspace's notes plus its own, and Settings › Memory groups the notes by place with a place picker when adding (editing can move a note). The workspace editor manages that workspace's notes directly. Each place holds its own 200 notes; deleting a workspace forgets its notes.

### Patch Changes

- 7da39e8: Settings › Tools keeps a short page again: the web search services now live in their own page, Settings › Tools › Web search, which opens from a summary row showing which services are on and which still need setup — like the Telegram setup in Settings › Channels.

## 0.8.1

### Patch Changes

- 7d19406: PP Agent now has its own logo: app icon, tray icon, browser favicon, and a light/dark mark on the empty chat screen.

## 0.8.0

### Minor Changes

- 0988f5a: The agent can now keep running in the background after you close or quit the app, and you can chat with it from Telegram. Turn on Settings › Background to keep it running, and set up Telegram in Settings › Channels; scheduled tasks keep running too. Saved sign-ins move to a new encrypted store automatically.

  Workspaces no longer have their own model or thinking level: a chat uses its agent's model, else the default model. A workspace's agent now also decides who answers on Telegram, unless you pick another with `/agent`.

## 0.7.1

### Patch Changes

- 507ba8e: Model context window can now be set to any positive number of tokens, not only multiples of 1000.

## 0.7.0

### Minor Changes

- f749f5a: Chat history. Search your conversations from the sidebar (titles and messages, ignoring case and accents), pin chats to a Pinned group, and export a conversation as Markdown or a printable web page. Messages now have actions: copy, edit and resend, regenerate the last answer, and branch into a new chat. The context popover shows tokens used and the estimated cost of the conversation.
- f749f5a: Custom gateways can now be marked as not needing an API key (Ollama, LM Studio, vLLM), so their models work right away, and the model picker lists the models of gateways that still need a key, marked "Needs key".
- f749f5a: Update macOS in the app. Signed macOS builds now download the update and restart into it from Settings › General › Updates, like Windows and Linux AppImage.
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
