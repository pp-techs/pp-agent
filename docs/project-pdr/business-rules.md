# Business rules

Rules enforced in code. Paths are under `apps/desktop/src/agent/` unless noted.

## Approvals and tools (`tools.ts`)

| Tool tier | Tools                                                                                                             |
| --------- | ----------------------------------------------------------------------------------------------------------------- |
| read      | `read`, `ls`, `find`, `grep`, `read_document`, `current_datetime`, discovery tools, MCP tools with `readOnlyHint` |
| write     | `write`, `edit`, MCP tools without `readOnlyHint`                                                                 |
| exec      | `bash`, `powershell`, and any tool without a tier                                                                 |

| Tool policy    | Effect                                                    |
| -------------- | --------------------------------------------------------- |
| auto (default) | read tier runs; write and exec ask                        |
| ask            | always asks                                               |
| allow          | runs without asking                                       |
| off            | removed from the session and blocked in the approval gate |

- The shell (`bash`; `powershell` on Windows) is off by default. When **Settings › Tools** turns it on, every command still asks; its policy cannot be changed. The other platform's shell is always off.
- `edit` is off by default; non-developers use `write`.
- Discovery tools (`codemode`, `tool_search`, MCP resource tools) are always allowed; the calls they make pass the gate individually.
- Stopping a run denies all pending approvals first.

## Agents (`agents.ts`)

- The default agent (id `default`, "PP Agent", 🤖) always exists, can be edited, and cannot be deleted. If the active agent points nowhere, it falls back to the default.
- Deleting an agent: conversations using it fall back to the default; if it was the active agent or the open conversation's agent, those switch to the default.
- Names are unique (case-insensitive), at most 60 characters. Icon ≤ 8 characters (one emoji). Description ≤ 1000 characters. Instructions ≤ 20000 characters. At most 20 starter prompts, each ≤ 300 characters. Ids are `ag-<slug>`.
- Workspace folder must be an absolute path; it is created when missing; files are refused. If it cannot be used at runtime, the default folder is used with a notice.
- Effective availability is Settings ∩ agent: an app tool is usable only if not off in Settings and in the agent's tools (`null` = all); MCP servers and skills likewise. Unavailable tools are blocked with "not available to <agent name>".

## Skills (`skills.ts`)

- Name: lowercase letters, digits, single hyphens (`^[a-z0-9]+(-[a-z0-9]+)*$`), at most 64 characters — the same rule Pi applies.
- Description required, at most 1024 characters.
- Duplicate names are refused on import; archives > 100 MB expanded are refused.

## MCP servers (`mcp.ts`)

- Server names: letters, digits, `_`, and `-` only (`^[A-Za-z0-9_-]+$`).
- Unknown keys in `mcp.json` entries are preserved.

## Conversations and defaults (`index.ts`)

- Attachments that are not model images are copied into `<workspace>/attachments/`.
- Each conversation remembers its model, agent, and thinking level.
- New chats use the last-picked agent (`activeAgentId`) and thinking level; the model is agent model → default model → first available.
- Settings changes apply to the open conversation without losing it; if the agent is busy, they apply when it finishes.
- Removing a provider that holds the default model clears the default model.
