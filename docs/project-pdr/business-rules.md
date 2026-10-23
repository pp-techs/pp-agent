# Business rules

Rules enforced in code. Paths are under `apps/desktop/src/agent/` unless noted.

## Approvals and tools (`tools.ts`)

| Tool tier | Tools                                                                                                                                        |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| read      | `read`, `ls`, `find`, `grep`, `read_document`, `current_datetime`, `web_search`, `web_fetch`, discovery tools, MCP tools with `readOnlyHint` |
| write     | `write`, `edit`, MCP tools without `readOnlyHint`                                                                                            |
| exec      | `bash`, `powershell`, and any tool without a tier                                                                                            |

| Tool policy    | Effect                                                    |
| -------------- | --------------------------------------------------------- |
| auto (default) | read tier runs; write and exec ask                        |
| ask            | always asks                                               |
| allow          | runs without asking                                       |
| off            | removed from the session and blocked in the approval gate |

- The shell (`bash`; `powershell` on Windows) is off by default. When **Settings › Tools** turns it on, every command asks, unless its policy is set to `allow` ("Run without asking"). The shell takes only `ask` or `allow`; choosing `allow` needs a confirmation that spells out the risk, and while it is set the Tools page shows a warning. The other platform's shell is always off.
- **Web search** (`web/`): `web_search` tries the enabled providers (SearXNG, Serper, Tavily, Brave, Exa, webclaw) in the saved order and moves on when one fails; none enabled → an error that points to Settings › Tools. Keys sit in the vault under `websearch:<provider>`, never in `settings.json` and never in the renderer. `web_fetch` refuses non-http(s) addresses, embedded credentials, and any host that resolves to a private, loopback, link-local or metadata address (checked at connect time and on every redirect, up to 5); it reads at most 8 MB and returns Markdown (HTML, PDF, Office). Both tools wrap results in `<web_results>`/`<web_page>` and the system prompt tells the model that web text is data, not instructions.
- `edit` is off by default; non-developers use `write`.
- Discovery tools (`codemode`, `tool_search`, MCP resource tools) are always allowed; the calls they make pass the gate individually.
- Stopping a run denies all pending approvals first.

## Agents (`agents.ts`)

- The default agent (id `default`, "PP Agent", 🤖) always exists, can be edited, and cannot be deleted. If the active agent points nowhere, it falls back to the default.
- Deleting an agent: conversations using it fall back to the default; if it was the active agent or the open conversation's agent, those switch to the default.
- Names are unique (case-insensitive), at most 60 characters. Icon ≤ 8 characters (one emoji). Description ≤ 1000 characters. Instructions ≤ 20000 characters. At most 20 starter prompts, each ≤ 300 characters. Ids are `ag-<slug>`.
- Effective availability is Settings ∩ agent: an app tool is usable only if not off in Settings and in the agent's tools (`null` = all); MCP servers and skills likewise. Unavailable tools are blocked with "not available to <agent name>".

## Workspaces (`workspaces.ts`)

- A workspace is a folder plus defaults and rules for the chats started in it: name, icon, folder, instructions, agent, model, thinking level. The built-in workspace (id `default`, "Personal", 📁) uses the app's folder, can be edited, and cannot be deleted.
- A chat belongs to the workspace whose folder is its working directory. The folder is set when the workspace is created and cannot change afterwards; it must be an absolute path, is created when missing, files are refused, and no two workspaces share a folder. If it cannot be used at runtime, the default folder is used with a notice.
- Names are unique (case-insensitive), at most 60 characters. Icon ≤ 8 characters. Instructions ≤ 20000 characters. Ids are `ws-<slug>`.
- New chats in a workspace start with its agent (else the agent picked last), its thinking level (else the level picked last), and a model chosen in this order: the agent's model, the workspace's model, the default model.
- Its instructions are added to the system prompt as `## Workspace: <icon> <name>`, next to the agent's section, from the next prompt.
- Deleting a workspace removes only the profile: its chats and files stay, and its chats are listed under the built-in workspace. Agents are not affected; deleting an agent clears it from the workspaces that started with it.

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
