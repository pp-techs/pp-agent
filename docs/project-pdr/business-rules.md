# Business rules

Rules enforced in code. Paths are under `packages/agent-core/src/` unless noted.

## Approvals and tools (`tools.ts`)

| Tool tier | Tools                                                                                                                                                                                                       |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| read      | `read`, `ls`, `find`, `grep`, `read_document`, `current_datetime`, `web_search`, `web_fetch`, `memory_list`, `memory_search`, `todo_write`, `delegate_task`, discovery tools, MCP tools with `readOnlyHint` |
| write     | `write`, `edit`, `memory_save`, `memory_forget`, MCP tools without `readOnlyHint`                                                                                                                           |
| exec      | `bash`, `powershell`, and any tool without a tier                                                                                                                                                           |

| Tool policy    | Effect                                                    |
| -------------- | --------------------------------------------------------- |
| auto (default) | read tier runs; write and exec ask                        |
| ask            | always asks                                               |
| allow          | runs without asking                                       |
| off            | removed from the session and blocked in the approval gate |

- The shell (`bash`; `powershell` on Windows) is off by default. When **Settings › Tools** turns it on, every command asks, unless its policy is set to `allow` ("Run without asking"). The shell takes only `ask` or `allow`; choosing `allow` needs a confirmation that spells out the risk, and while it is set the Tools page shows a warning. The other platform's shell is always off.
- **Web search** (`web/`): `web_search` tries the enabled providers (SearXNG, Serper, Tavily, Brave, Exa, webclaw) in the saved order and moves on when one fails; none enabled → an error that points to Settings › Tools. Keys sit in the vault under `websearch:<provider>`, never in `settings.json` and never in the renderer. `web_fetch` refuses non-http(s) addresses, embedded credentials, and any host that resolves to a private, loopback, link-local or metadata address (checked at connect time and on every redirect, up to 5); it reads at most 8 MB and returns Markdown (HTML, PDF, Office). Both tools wrap results in `<web_results>`/`<web_page>` and the system prompt tells the model that web text is data, not instructions.
- **Memory** (`memory.ts`): notes live in `<user-data>/memory.json` (atomic write, mode 0600), each in a place: everywhere (`workspaceId: null`) or one workspace, which is what a conversation sees (every workspace's notes plus its own). Each place holds at most 200 notes of 500 characters, labels of 30; the same note (ignoring case, spacing, closing punctuation) is stored once per place. `memory_save` takes `scope` (`global` or `workspace`) and the tools never see another workspace's notes. The newest notes that fit in 4000 characters go into a `## Memory` prompt section marked as user-provided data, never instructions. Memory is on when Settings › Memory is on **and** the agent's `memory` field is true (missing = true); otherwise the section is absent, the memory tools are removed from the session and they refuse to run. `memory_save` and `memory_forget` are write tier, so they ask under `auto`; the forget card shows the note's text. Deleting a workspace forgets its notes.
- **Checklist** (`todo.ts`): `todo_write` replaces the whole list (≤ 30 items, status `pending`/`in_progress`/`done`). The chat reads the list from the call's arguments, so it is live while streaming and returns with the saved conversation. No approval.
- **Helpers** (`subagent.ts`): `delegate_task` runs one task in an in-memory Pi session with its own short prompt, no extensions or skills, and only the read tools that run without asking under the current settings and agent (`read`, `ls`, `find`, `grep`, `read_document`, `current_datetime`, `web_search`, `web_fetch`). Anything else, including memory, MCP and `delegate_task`, is blocked by a `tool_call` guard. Limits: 25 tool calls, 12 tool turns, 5 minutes, then one wrap-up reply without tools; the summary is cut to 12000 characters. Stopping the parent run aborts the helper. Its steps stream to the chat as lines under the step.
- `edit` is off by default; non-developers use `write`.
- Discovery tools (`codemode`, `tool_search`, MCP resource tools) are always allowed; the calls they make pass the gate individually.
- Stopping a run denies all pending approvals first.

## Agents (`agents.ts`)

- The default agent (id `default`, "PP Agent", 🤖) always exists, can be edited, and cannot be deleted. If the active agent points nowhere, it falls back to the default.
- Deleting an agent: conversations using it fall back to the default; if it was the active agent or the open conversation's agent, those switch to the default.
- Names are unique (case-insensitive), at most 60 characters. Icon ≤ 8 characters (one emoji). Description ≤ 1000 characters. Instructions ≤ 20000 characters. At most 20 starter prompts, each ≤ 300 characters. Ids are `ag-<slug>`.
- Effective availability is Settings ∩ agent: an app tool is usable only if not off in Settings and in the agent's tools (`null` = all); MCP servers and skills likewise. Unavailable tools are blocked with "not available to <agent name>".

## Workspaces (`workspaces.ts`)

- A workspace is a folder plus defaults and rules for the chats started in it: name, icon, folder, instructions, and the agent new chats start with. (Earlier versions also kept a model and a thinking level per workspace; they were removed, and files that still have them are read without them.) The built-in workspace (id `default`, "Personal", 📁) uses the app's folder, can be edited, and cannot be deleted.
- A chat belongs to the workspace whose folder is its working directory. The folder is set when the workspace is created and cannot change afterwards; it must be an absolute path, is created when missing, files are refused, and no two workspaces share a folder. If it cannot be used at runtime, the default folder is used with a notice.
- Names are unique (case-insensitive), at most 60 characters. Icon ≤ 8 characters. Instructions ≤ 20000 characters. Ids are `ws-<slug>`.
- New chats in a workspace start with its agent (else the agent picked last), the thinking level picked last, and a model chosen in this order: the agent's model, the default model.
- Its instructions are added to the system prompt as `## Workspace: <icon> <name>`, next to the agent's section, from the next prompt.
- Deleting a workspace removes only the profile: its chats and files stay, and its chats are listed under the built-in workspace. Agents are not affected; deleting an agent clears it from the workspaces that started with it.

## Scheduled tasks (`scheduled-tasks.ts`, `scheduler.ts`)

- At most 50 tasks. Name unique (case-insensitive), at most 60 characters; prompt required, at most 20000 characters. Ids are `task-<random>`. An agent or workspace that no longer exists is replaced by the default one when the task runs.
- Schedules (local time): every 5–1440 minutes, every 1–168 hours, daily at `HH:MM` (24 h), or weekly on one or more weekdays at `HH:MM`. Anything else is refused.
- Runs happen one at a time, never twice for the same task at once, each in its own Pi session and saved conversation titled `⏰ <name> – <date>`, apart from the open conversation. A run is stopped after 30 minutes and recorded as failed.
- Unattended runs never approve anything: a tool call that would ask is denied (counted in `lastRun.deniedTools`) and the model is told. Only tools that run without asking (read tier under `auto`, or policy `allow`) run. Tools with policy `off` stay off.
- A slot missed while the app was closed runs once when the app starts if it was due within the last 24 hours; older ones are skipped. A task that is created, switched on, or whose schedule changes counts from that moment. Deleting a task stops its run in progress.

## Voice input (`transcription.ts`)

- Off until a provider is chosen in Settings › General › Voice input. Only a provider or gateway that has a key and an OpenAI-style address can be chosen; model ≤ 100 characters (default `whisper-1`); language `app` (the app's language, default), `auto`, or a two- or three-letter code.
- Recording: at most 5 minutes (a few seconds of slack), at most 20 MB, formats webm, ogg, mp4/m4a, mp3, wav. Longer or larger audio is refused with a message.
- The audio goes to `{provider base address}/audio/transcriptions` with the provider's key from the vault; the key and the audio never reach the settings file, and the renderer only receives the text. The text is inserted into the draft and never sent by itself.
- The app window may use the audio microphone permission only (`main/permissions.ts`); video and all other web permissions are refused.

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
