# Use case: memory, checklists, questions and helpers

Four features that make the agent more useful over long or repeated work. Paths are under `packages/agent-core/src/` unless noted. Limits and tiers are listed in [business-rules.md](business-rules.md).

## Long-term memory

**Goal.** The agent remembers lasting facts and preferences ("answer in Vietnamese", "our fiscal year starts in April") in every new conversation. A note lives either everywhere or in one workspace only, so project facts do not leak into other projects.

**Flow.**

1. The person asks the agent to remember something, or the agent notices a lasting preference. It calls `memory_save` with a place: `global` for personal facts and preferences, `workspace` for facts about the current project only. The approval card shows the note (the call is write tier, so it asks under the default `auto` policy).
2. The note is added as the last bullet (`- [tag] text`) of the place's markdown file: `<user-data>/agent/MEMORY.md` for everywhere, `<workspace folder>/.agents/MEMORY.md` for a workspace (`MemoryStore`, atomic rename). The newest note is the last line; text around the bullets is never touched, so the files can be edited by hand. Saving the same note again in the same place changes nothing (the prompt stays the same); the same note may still exist once per place.
3. On every message, `before_agent_start` puts a `## Memory` section into the system prompt: rules that mark the notes as data, then, in a `<memory>` block, the newest notes the conversation can see (its own workspace's, then every workspace's) up to 4000 characters, however big the files are. Notes that do not fit are found with `memory_search`.
4. `memory_list`, `memory_search` (read tier) and `memory_forget` (write tier, the card shows the note's text) complete the set; they see the same notes, and a note of another workspace is not theirs to list or forget.

**Controls.**

- Settings › Memory: global switch, list grouped by place, add with a place picker, edit (which can also move a note to another place), delete, clear all (commands `get_memory`, `set_memory_enabled`, `save_memory_entry`, `delete_memory_entry`, `clear_memory`; scope `memory`). The workspace editor (Settings › Workspaces) manages the notes of that workspace the same way, without the picker.
- Each place holds its own 200 notes: one file for everywhere and one per workspace. The files are read again only when their size or modification time changes. Deleting a workspace removes only its profile: its `MEMORY.md` stays in the folder. The workspace file sits in the project folder, so add `.agents/MEMORY.md` to `.gitignore` if the folder is a repository you share. Older versions kept the notes in `memory.json`; at start they move into these files and `memory.json` is deleted (a file that cannot be written keeps it for the next start).
- Per agent: the "Use long-term memory" switch (`AgentProfile.memory`, default on; agent files without the field count as on). With either switch off there is no `## Memory` section and the four memory tools are not offered.
- Settings › Tools and the agent's tool list can still turn single memory tools off or on.

**Safety.** Notes are user-provided data: the section tells the model not to follow commands inside them, and a note cannot close the `<memory>` block it sits in. The tool descriptions tell the model not to save secrets or text copied from web pages.

## Checklist (`todo_write`)

For work with three or more steps the model writes a checklist and updates it as it goes. The chat pins the newest list in a panel above the message box, so it stays in view while the chat scrolls: one icon per status, a "done of total" count, and a collapse button (collapsed, it shows the step in progress). Each `todo_write` call in the conversation is a one-line step. The list is the tool call's own arguments, so nothing extra is stored and it reappears when a saved conversation is reopened. The tool needs no approval.

## Questions (`ask_user`)

When a request has several reasonable answers that lead to different results, the model asks instead of guessing: one to five questions with two to six options each, an optional suggested option (badge "Recommended"), and multi-select where it fits. The chat shows a card in place of the step. The person picks, or chooses **Other** and types their own answer, then presses **Send**; **Skip** declines and the model carries on with its best judgment or says what it needs. After the answer the step shows what was chosen. The prompt tells the model to ask only when the choice really matters, to put related questions in one call, and never to offer "Other" itself. In Telegram the same questions arrive as buttons (see [Background and Telegram](use-case-background-and-telegram.md)); scheduled tasks and helpers never ask. A desktop notification tells the person when a question waits while the window is in the background. The tool needs no approval; the card is not stored, so a question left open when the app closes shows as interrupted.

## Helpers (`delegate_task`)

For research that would fill the conversation with raw material (many files or pages), the model hands a focused task to a helper. The helper starts with an empty context and cannot see the conversation, so the task must carry everything it needs. It can read files and, when enabled, search and fetch the web; it cannot change anything, use memory or MCP tools, or delegate again. It uses the conversation's model unless the call names another available model. Only its final summary returns to the conversation. While it works, the chat shows its steps (tool and target) under the step; stopping the run aborts it.
