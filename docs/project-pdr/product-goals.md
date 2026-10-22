# Product goals and users

PP Agent is a desktop chat agent for business teams (`README.md`). Non-technical people chat with it; models, tools, skills, agents, and business systems are managed in the app's **Settings**.

## Target users

| Role                          | What they do                                                                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Business user (non-developer) | Chats, attaches documents, approves actions, picks an agent, model, and thinking level, manages chat history.                                          |
| Tech team / power user        | Connects providers and gateways, sets tool policies, installs or writes skills, adds MCP servers, builds and exports agents, deploys `agent/mcp.json`. |

Everyone may edit everything in Settings; there is no admin lock (product owner's decision).

## Goals

- Let business users work with their documents and business systems in plain language, without a terminal.
- Keep the user in control of anything that changes data: every non-read-only action passes the approval gate unless Settings allows it.
- Keep secrets safe: API keys are encrypted with the OS keychain and only handed to the agent process.
- Let the tech team package know-how as agents and skills that business users pick from a menu.
- Work with any model: Pi built-in providers or custom gateways.

## Non-goals (evidenced)

- No subscription OAuth sign-in for LLM providers; providers use API keys (product owner's decision).
- No separate "chat mode"; agents cover that need (see `key-decisions.md`).
- The renderer has no network access; all I/O goes through the preload bridge (`README.md`).

## Use cases

- `use-case-documents-and-attachments.md`
- `use-case-business-systems-mcp.md`
- `use-case-models-providers-gateways.md`
- `use-case-agents.md`
- `use-case-skills.md`
- `use-case-chat-history.md`
- `use-case-thinking-and-slash-commands.md`

Rules across all use cases: `business-rules.md`. Known limits: `constraints-and-limitations.md`. Rationale: `key-decisions.md`.
