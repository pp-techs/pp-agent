# @workspace/web

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
