# Documentation Summary

PP Agent — a desktop chat agent for non-technical business teams: chat with documents, use business systems through MCP with approvals, and switch between purpose-built agents.
Electron 45 app with three processes (main, agent utility process running the Pi SDK, React 19 renderer) in a Vite+ (`vp`) pnpm monorepo: `apps/desktop`, `apps/web`, `packages/shared` (cross-process contract), `packages/ui` (shadcn components).

## Agent Context Guide

Before planning or implementing, read this `docs/SUMMARY.md` file first. Load only the detail docs relevant to the current task, and prioritize `Code Standard` docs for implementation conventions. If docs conflict with code or user intent, use the available question tool before making broad changes.

## Architecture

System design, component interactions, data flows, deployment, and external integrations.

| File                                                                            | Description                                                                                  |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| [process-model.md](architecture/process-model.md)                               | Main process, agent process, preload bridge, renderer: responsibilities, startup, hardening  |
| [ipc-and-messages.md](architecture/ipc-and-messages.md)                         | Renderer↔main channels, main↔agent messages, command ids, vault requests, event handling     |
| [data-storage.md](architecture/data-storage.md)                                 | userData files and owners, workspace and attachments, session entries, legacy migration      |
| [conversation-flows.md](architecture/conversation-flows.md)                     | Prompt with attachments and streaming; approval gate, tiers, policies, codemode nested calls |
| [agents-and-live-settings.md](architecture/agents-and-live-settings.md)         | Deferred live-apply of settings and switching agents mid-conversation                        |
| [model-and-thinking-selection.md](architecture/model-and-thinking-selection.md) | How a conversation's model and thinking level are chosen and kept                            |
| [providers-and-mcp.md](architecture/providers-and-mcp.md)                       | Provider sign-in with auth prompts, gateways, per-agent MCP registration, `/mcp` status      |
| [build-and-packaging.md](architecture/build-and-packaging.md)                   | `vp pack` bundles, renderer build and CSP, electron-builder, dev flow on port 47821          |

## Codebase

Directory structure, entry points, API patterns, and key modules.

| File                                                          | Description                                                                                |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [repository-layout.md](codebase/repository-layout.md)         | Monorepo packages, entry points, dev vs packaged renderer loading, scripts                 |
| [desktop-modules.md](codebase/desktop-modules.md)             | Responsibilities of each module in `apps/desktop/src/main` and `apps/desktop/src/agent`    |
| [renderer-and-contract.md](codebase/renderer-and-contract.md) | Renderer folders, the shared contract, adding an agent command end-to-end, shadcn workflow |

## Code Standard

Conventions, naming rules, tech stack versions, and development workflows.

| File                                                                     | Description                                                                                           |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| [toolchain-and-setup.md](code-standard/toolchain-and-setup.md)           | Requirements, `vp` commands, lint config, dependency catalog and version policy                       |
| [typescript-and-naming.md](code-standard/typescript-and-naming.md)       | Formatting, strict TypeScript, validation, naming for files, components, hooks, query keys            |
| [renderer-patterns.md](code-standard/renderer-patterns.md)               | Contract-first changes, commands vs events, Query/Zustand, modals, Settings patterns, UI copy         |
| [i18n.md](code-standard/i18n.md)                                         | Languages (en, vi), i18next namespaces per process, typed keys, what stays English, adding a language |
| [electron-security.md](code-standard/electron-security.md)               | Window hardening, external links, IPC input and path validation, keys only in main                    |
| [pi-sdk-integration.md](code-standard/pi-sdk-integration.md)             | Pi agent dir, explicit extensions, skills loading, deferred changes, reload vs active tools           |
| [verification-and-secrets.md](code-standard/verification-and-secrets.md) | `vp check`, Electron smoke tests over CDP with copied user data, secrets hygiene                      |
| [release-process.md](code-standard/release-process.md)                   | Changesets, Version Packages PR, installer builds, GitHub Releases, signing secrets                   |

## Project PDR

Product goals, use cases, business rules, and constraints.

| File                                                                                           | Description                                                               |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| [product-goals.md](project-pdr/product-goals.md)                                               | Goals, target users, non-goals, use case index                            |
| [use-case-documents-and-attachments.md](project-pdr/use-case-documents-and-attachments.md)     | Attaching files and images, reading office documents and PDFs             |
| [use-case-business-systems-mcp.md](project-pdr/use-case-business-systems-mcp.md)               | MCP server setup, exposure, OAuth, approvals                              |
| [use-case-models-providers-gateways.md](project-pdr/use-case-models-providers-gateways.md)     | Built-in providers, gateways, per-conversation model, vault, migration    |
| [use-case-agents.md](project-pdr/use-case-agents.md)                                           | Agent fields, building, import/export, switching                          |
| [use-case-skills.md](project-pdr/use-case-skills.md)                                           | Importing, writing, enabling, and invoking skills                         |
| [use-case-chat-history.md](project-pdr/use-case-chat-history.md)                               | Saved conversations and what each remembers                               |
| [use-case-memory-and-planning.md](project-pdr/use-case-memory-and-planning.md)                 | Long-term memory, the `todo_write` checklist, `delegate_task` helpers     |
| [use-case-scheduled-tasks.md](project-pdr/use-case-scheduled-tasks.md)                         | Tasks that run on a schedule, headless approval rule                      |
| [use-case-voice-input.md](project-pdr/use-case-voice-input.md)                                 | Microphone button and speech-to-text provider                             |
| [use-case-thinking-and-slash-commands.md](project-pdr/use-case-thinking-and-slash-commands.md) | Thinking levels, `/new`, `/compact`, `/skill:<name>`                      |
| [business-rules.md](project-pdr/business-rules.md)                                             | Tool tiers and policies, defaults, name and size limits, Settings ∩ agent |
| [constraints-and-limitations.md](project-pdr/constraints-and-limitations.md)                   | Known limitations and their evidence                                      |
| [key-decisions.md](project-pdr/key-decisions.md)                                               | Architecture and product decisions with rationale                         |
