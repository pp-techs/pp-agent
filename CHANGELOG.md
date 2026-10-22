# Changelog

All notable changes to PP Agent are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

<!-- `vp run version-packages` adds each release's section from its changesets; edit it in the Version Packages PR. -->

## [0.1.0] — 2026-10-22

First public release of PP Agent, a desktop AI agent for business teams.

- Chat with streaming answers, saved conversation history, and approvals before the agent changes anything.
- Attach files and images; the agent reads PDF, Word, Excel, PowerPoint, and other documents.
- Connect Pi's built-in AI providers with an API key, or your own OpenAI- or Anthropic-compatible gateways; pick the model and thinking level per conversation.
- Agents: profiles with their own rules, tools, MCP servers, skills, model, starter prompts, and workspace folder, with import and export.
- Business systems through MCP servers, managed in Settings, with per-tool approval policies and OAuth sign-in.
- Skills: import, write, and use them with `/skill:<name>`; slash commands `/new` and `/compact`.
- Installers for macOS (Apple silicon and Intel), Windows, and Linux.
