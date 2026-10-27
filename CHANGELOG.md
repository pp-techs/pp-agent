# Changelog

All notable changes to PP Agent are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

<!-- `vp run version-packages` adds each release's section from its changesets; edit it in the Version Packages PR. -->

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
