# @workspace/desktop

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
