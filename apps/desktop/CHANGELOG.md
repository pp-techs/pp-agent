# @workspace/desktop

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
