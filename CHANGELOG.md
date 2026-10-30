# Changelog

All notable changes to PP Agent are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

<!-- `vp run version-packages` adds each release's section from its changesets; edit it in the Version Packages PR. -->

## [0.20.0] — 2026-10-30

Added the `/goal` command. Type `/goal` and what you want done: the agent starts on it and keeps working turn after turn by itself until it reports the goal done. A banner above the message box shows the goal with pause, resume and clear (`/goal pause`, `/goal resume` and `/goal clear` do the same). Stopping the answer pauses the goal, and a turn where the agent only answers or asks something waits for your reply. A conversation opened again shows its goal paused.

Sub agents. The agent can now hand up to five research tasks to sub agents in one go and they work at the same time, each showing its own steps in the chat. A task can name one of your Agents, and its sub agent then follows that agent's rules, model and tool list. Sub agents are still read-only: they can read, search and use the web, but cannot change anything.

A new conversation is titled as soon as you send its first message, without waiting for the reply. Lasting memory notes are now picked up after every reply, including ones you watch to the end, and without you asking: who you are, people you mention, how you want answers, your tools and projects. Notes already saved are not repeated. Before, both only happened when you moved to another conversation while it was still answering.

Fixed importing cookies on Windows telling you to quit a browser you had already closed. The message now explains that Chrome, Edge and Brave can keep running in the background (system tray, “Continue running background apps”) and hold the cookies locked. When the browser is not running at all, it shows the real reason (security software or file permissions) instead.

The agent's built-in instructions now only explain how to use its tools and skills, without describing the user as an office or non-technical audience.

The right panel's buttons are now ordered Files, Browser, Terminal.

## [0.19.0] — 2026-10-30

Added yolo mode: skips the approval step for every tool that is already allowed, including shell commands once "Allow shell commands" is on, and skips the first-use "Let the agent use X?" card for an app the computer tool opens (protected apps still refuse). Turn it on for every conversation in Settings › Tools, or for just the open chat with the rabbit button in its header or the `/yolo` command. It does not turn on anything by itself, and locked or off tools stay off.

Added "Clear all chats" to each workspace's menu in the sidebar, to delete every saved conversation of that workspace at once.

Fixed the chat view jumping to the top whenever a tool call finished. The patched `@shadcn/react` message scroller no longer re-anchors an already-seen historical turn when a loader swaps for its result in the same render.

When the model fails (timeout, rate limit, server error), the chat now shows one short sentence instead of the raw error text from the provider.

## [0.18.0] — 2026-10-30

The agent can use desktop apps on macOS and Windows. Turn it on in **Settings › Computer use** (on macOS, grant Accessibility and Screen Recording there first), then ask it to work in an app: it reads the app's windows, clicks, types, presses keys and uses menus, usually without taking over your screen. The first time it uses an app in a chat, it asks: allow once, in this chat, or always. Looking at a window runs on its own; clicking and typing ask first unless you change that in **Settings › Tools**. It never uses PP Agent itself, terminals, or password and privacy settings, and you can block any other app. It works while the PP Agent window is open.

## [0.17.0] — 2026-10-30

The agent can use the browser in the side panel. Ask it to fill in a form, check a dashboard you are signed in to, or collect information from a site, and it opens tabs (in the profile you name, otherwise the default one), reads the page, clicks, types, picks options, and takes screenshots, while the panel shows every step. It can also work in tabs you already opened. The browser tool runs without asking by default; switch it to ask or off in **Settings › Tools**. It works while the PP Agent window is open.

A side panel next to the chat (the panel button in the top bar, or Cmd+J / Ctrl+J) with three tools; drag its edge to resize it, or expand it over the chat. **Terminal** opens your own shell in the conversation's workspace folder, with several terminals per workspace. **Files** lists the workspace folder, refreshes as files change, opens files in tabs with a preview of text, code, Markdown and images, and attaches a file to your message. **Browser** opens web pages in tabs, each tab in a profile with its own sign-ins. Manage profiles in **Settings › Browser** and import every cookie of a Chrome, Edge, Brave, Arc or Chromium profile (macOS), of Chrome, Edge, Brave or Chromium (Windows), or of Firefox, so you stay signed in to the same sites. Deleting a profile removes its sign-ins from PP Agent only.

## [0.16.0] — 2026-10-29

A conversation left in the background now gets two things for free once it settles: a short title generated from how it started (if you have not named it yourself), and, when long-term memory is on, any lasting facts or preferences it mentioned are saved automatically — on top of the agent still being able to save a note itself when asked. Both run as a separate, one-shot background call and never block or show up in the chat; a failure in either is silent and leaves the conversation as it was.

## [0.15.0] — 2026-10-29

Settings › Models no longer grows the whole panel when editing a gateway. Add/Edit gateway now opens in its own dialog with a fixed header and footer, so only the model list scrolls. Fixed a duplicate card for gateways that are both connected and listed under Custom gateways, and added a delete action for connected gateways.

Chat with the agent from Zalo. Create a bot with "Zalo Bot Manager", paste its token in **Settings › Channels › Zalo**, and pair your account with a one-time code, as with Telegram. Send text, photos, or voice notes; approvals and questions are answered by replying with a number, since Zalo has no buttons.

## [0.14.0] — 2026-10-28

Web search works without any setup. When no search service with a key is turned on, or all of them fail, the agent searches with Exa and then DuckDuckGo, which need no key (the words searched for are sent to them). Services you set up are always tried first, and the result says when no key was used.

Notes the agent remembers are now plain markdown files you can read and edit: `MEMORY.md` for notes that hold everywhere, and `.agents/MEMORY.md` in a workspace's folder for that project's notes. Your saved notes move there the first time the app starts. Deleting a workspace no longer deletes its notes. Searching notes matches whole words instead of any letters inside a word.

Web pages the agent opens now read as the article or documentation itself, without the menus, footers and sign-in banners around it, so more of a long page fits in one read. The app bundles the webclaw tool for this (AGPL-3.0, run as a separate program) and falls back to its own conversion where webclaw is not available.

A workspace's rules are now the `AGENTS.md` in its folder, like in other coding agents: edit it in Settings › Workspaces or with any editor, and it applies to every chat there. Rules you had typed into a workspace move into that file the first time the app starts. Skills in the folder's `.agents/skills` are always available in its chats, whichever agent you use.

## [0.13.0] — 2026-10-28

Buttons that destroy something now look the part: delete, clear, disconnect, sign out and the confirm button of every confirmation dialog use the red destructive style everywhere — notes, scheduled tasks, workspaces, gateways and providers, MCP servers, and the chat sidebar. Non-destructive actions (edit, reconnect, sign in, add) keep their neutral style.

Several chats can answer at the same time. Opening another chat or starting a new one no longer stops the answer in progress: it carries on in the background, shows a spinner (or a dot when it waits for your approval or an answer) in the sidebar, and is there in full when you open it again.

Sending a message in a long chat keeps the view on it instead of jumping back to the top, and opening another chat starts at its end.

A workspace now uses the skills in its folder's `.agents/skills`: the agent can read and follow them in that workspace's chats, and they appear in the `/` menu next to your installed skills.

## [0.12.0] — 2026-10-28

Settings › Tools groups the tools by what they are for — files and folders, documents, web, memory, shell commands, tasks and conversations — each behind a compact header with its tool count, and one group per MCP server after them. The shell commands switch and the web search services summary sit inside their groups instead of separate blocks at the top, and the warning about commands running without asking is shown once, next to the switch. Click a header to open its tools; searching opens the groups that match.

The sidebar header now leads with the PP Agent logo and name, with a search button and the sidebar toggle on the right; the New workspace button is gone (workspaces are managed in Settings › Workspaces). Search opens as a command dialog over your chats — type to search, arrow keys and Enter to open a chat — instead of the search box that used to sit in the sidebar. The sidebar minimizes to an icon rail — logo and icons stay, chat lists fold away — where hovering the logo reveals the button that expands it again; the top bar keeps its sidebar toggle for mobile only. Search fields in the pickers no longer touch the entries below them.

## [0.11.1] — 2026-10-28

Updates the bundled OfficeCLI to 1.0.159 (Word, Excel and PowerPoint support).

## [0.11.0] — 2026-10-28

The agent now uses "Scheduled tasks" (`schedule_manage`) to create one-shot reminders and recurring jobs, list or update tasks, pause/resume them, run them now, and remove them. It accepts conversation targets and result-delivery destinations, including the paired Telegram owner or an explicitly configured chat. Schedule approvals disclose the action, time, target, delivery, and run controls. Scheduled runs cannot create further tasks; their result delivery is handled by the host, not a separate Telegram notification tool. "See other conversations" lets the agent inspect saved sessions, with member chats restricted to their own conversation.

Schedules now has its own navigation item beside Settings in the sidebar footer, opening a dedicated management page in the main panel. Workspace sessions use the full sidebar content area again, with no inline schedules or fixed height split. The Workspace management icon matches the muted group label color.

Fix one-shot editing and re-arming, preserve delivery options and outcomes, and keep Telegram chat access settings and session history across restarts. Telegram chat configuration supports adding the first private/group ID and clearing saved fields. Session commands now dispatch correctly; busy steering falls back to the queue when it cannot accept the input. Delivery honors the selected configured chat and preserves concurrent delivery-ledger updates.

## [0.10.1] — 2026-10-27

The export menu in the chat header no longer wraps: it is wide enough for "Web page (.html, printable)", and each format shows its own icon. The sidebar search box shows a search icon.

The agent's questions now replace the message box in the chat, one at a time, with numbered options you can pick with the keys 1-9, the arrows, Enter, and Esc to skip. The message box folds into two rows when the window is narrow. The app uses the Geist font. Voice input has its own section in Settings, and the Settings menu is reordered: Tools, MCP servers and Skills now sit together.

## [0.10.0] — 2026-10-27

The agent can now ask you a question with options to pick from, in the chat window and in Telegram, instead of guessing. You can choose one or several options or type an answer of your own, or skip the question. It asks only when your choice really changes the result. Agents that have their own tool list need "Ask you questions" ticked in the agent's tools; Settings › Tools can switch it off. Scheduled tasks never ask.

## [0.9.2] — 2026-10-27

"Restart to update" now really restarts: with the tray icon on, the app hid itself instead of quitting, so the update never installed and the app never came back. If an update is already stuck this way, quit the app from its tray icon and install this version once by hand; the next updates restart on their own.

## [0.9.1] — 2026-10-27

A sent message now appears in the chat right away, with a "Sending" note until the conversation takes it and a "Thinking" note until the agent starts answering, so a slow start no longer looks like the message never left.

## [0.9.0] — 2026-10-26

Voice input now prefers a local model: the microphone button turns speech into text with whisper.cpp on your own computer, with nothing sent anywhere and no key needed. Settings › General › Voice input offers "This computer (whisper.cpp)" by default with a model to download (tiny to medium, 74 MB–1.4 GB); whisper.cpp is found on the PATH (`brew install whisper-cpp`) or bundled with the app. A transcription service with a key is still available as a choice. Recordings are converted to 16 kHz wav in the app, and formats whisper cannot read itself (Telegram voice notes) go through ffmpeg when it is installed. Telegram voice messages use the same setting.

Long-term memory is now scoped: every note lives either everywhere or in one workspace only, so project facts no longer leak into other projects. `memory_save` takes a `scope` (`global` or `workspace`), the tools and the `## Memory` prompt section show a conversation every workspace's notes plus its own, and Settings › Memory groups the notes by place with a place picker when adding (editing can move a note). The workspace editor manages that workspace's notes directly. Each place holds its own 200 notes; deleting a workspace forgets its notes.

Settings › Tools keeps a short page again: the web search services now live in their own page, Settings › Tools › Web search, which opens from a summary row showing which services are on and which still need setup — like the Telegram setup in Settings › Channels.

## [0.8.1] — 2026-10-26

PP Agent now has its own logo: app icon, tray icon, browser favicon, and a light/dark mark on the empty chat screen.

## [0.8.0] — 2026-10-26

The agent can now keep running in the background after you close or quit the app, and you can chat with it from Telegram. Turn on Settings › Background to keep it running, and set up Telegram in Settings › Channels; scheduled tasks keep running too. Saved sign-ins move to a new encrypted store automatically.

Workspaces no longer have their own model or thinking level: a chat uses its agent's model, else the default model. A workspace's agent now also decides who answers on Telegram, unless you pick another with `/agent`.

## [0.7.1] — 2026-10-25

Model context window can now be set to any positive number of tokens, not only multiples of 1000.

## [0.7.0] — 2026-10-24

Chat history. Search your conversations from the sidebar (titles and messages, ignoring case and accents), pin chats to a Pinned group, and export a conversation as Markdown or a printable web page. Messages now have actions: copy, edit and resend, regenerate the last answer, and branch into a new chat. The context popover shows tokens used and the estimated cost of the conversation.

macOS builds are signed with a Developer ID and notarized when the maintainers have configured certificates, so they open without Gatekeeper warnings.

Custom gateways can now be marked as not needing an API key (Ollama, LM Studio, vLLM), so their models work right away, and the model picker lists the models of gateways that still need a key, marked "Needs key".

Update macOS in the app. Signed macOS builds now download the update and restart into it from Settings › General › Updates, like Windows and Linux AppImage.

Memory, checklists and helpers. The agent can keep short notes across conversations (Settings › Memory lets you view, edit, delete and switch them off, and each agent has its own switch). For tasks with several steps it shows a live checklist in the chat. It can also hand a research task to a read-only helper that returns only a summary.

Word, Excel, and PowerPoint files. The agent can now create, read, and edit .docx, .xlsx, and .pptx files in your workspace with the bundled OfficeCLI, including charts and tables. Saving or changing a file asks first. Ready-made Office skills are built in.

Scheduled tasks and voice input. Settings › Scheduled tasks lets you set prompts that run by themselves every few minutes or hours, daily, or on chosen weekdays, each in the agent and workspace you pick; every run is saved as a conversation in the sidebar. Runs have nobody to approve actions, so anything that needs approval is skipped and noted unless its tool is set to Allow. The microphone button in the message box records up to 5 minutes and writes your speech into the draft; choose the speech-to-text provider, model and language in Settings › General › Voice input.

## [0.6.0] — 2026-10-23

Context. Compact now works on shorter conversations instead of saying there is nothing to summarize. The chat keeps showing every message after a compaction, with a divider where earlier messages were summarized. Old tool results are replaced with a short note in what the model reads, so long tool-heavy chats fill the context window more slowly; what you see in the chat does not change.

MCP servers that run a local command (`npx`, `uvx`, and similar) now work when the app is opened from Finder or the Dock. The app reads `PATH` from your login shell at startup.

## [0.5.0] — 2026-10-23

Languages. The whole app, including errors, approval cards, and dialogs, is now available in English and Tiếng Việt. Choose the language in Settings › General; "System" follows your computer's language.

## [0.4.0] — 2026-10-23

Web search. The agent can search the web (`web_search`) and read pages, PDFs and Office files from the internet (`web_fetch`; private-network addresses are refused). Settings › Tools › Web search picks and orders the search services: SearXNG, Serper, Tavily, Brave, Exa, and webclaw. Keys stay in the encrypted vault. Shell commands can now be set to run without asking, after a confirmation, with a warning shown in Settings while that is on.

## [0.3.0] — 2026-10-23

Context window and model names. The chat's top bar shows how full the model's context window is, with a button to compact the conversation, and a shortcut to the workspace folder. Gateway models now get their context window, reply limit, and display name from the gateway or Pi's model list instead of always 128k, and you can edit both per model. Model names are shown short and readable (`anthropic-subscription/claude-sonnet-5-5` appears as "Claude Sonnet 5.5"), with the id added when two models in a provider share a name.

Workspaces. The chat list is grouped by workspace, and each workspace (Settings › Workspaces) has its own folder, instructions, and defaults for new chats: agent, model, and thinking level. The working folder moved from agents to workspaces; folders agents used before become workspaces that start with that agent.

## [0.2.0] — 2026-10-22

Check for updates. The app looks for a new version when it starts and under Settings › General › Updates, and shows a notice in the sidebar. Windows and Linux (AppImage) download and install the update from inside the app; on macOS and with the `.deb` package it opens the download page.

## [0.1.0] — 2026-10-22

First public release of PP Agent, a desktop AI agent for business teams.

- Chat with streaming answers, saved conversation history, and approvals before the agent changes anything.
- Attach files and images; the agent reads PDF, Word, Excel, PowerPoint, and other documents.
- Connect Pi's built-in AI providers with an API key, or your own OpenAI- or Anthropic-compatible gateways; pick the model and thinking level per conversation.
- Agents: profiles with their own rules, tools, MCP servers, skills, model, starter prompts, and workspace folder, with import and export.
- Business systems through MCP servers, managed in Settings, with per-tool approval policies and OAuth sign-in.
- Skills: import, write, and use them with `/skill:<name>`; slash commands `/new` and `/compact`.
- Installers for macOS (Apple silicon and Intel), Windows, and Linux.
