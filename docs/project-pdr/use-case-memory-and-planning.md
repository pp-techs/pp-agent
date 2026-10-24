# Use case: memory, checklists and helpers

Three features that make the agent more useful over long or repeated work. Paths are under `apps/desktop/src/agent/` unless noted. Limits and tiers are listed in [business-rules.md](business-rules.md).

## Long-term memory

**Goal.** The agent remembers lasting facts and preferences ("answer in Vietnamese", "our fiscal year starts in April") in every new conversation.

**Flow.**

1. The person asks the agent to remember something, or the agent notices a lasting preference. It calls `memory_save`; the approval card shows the note (the call is write tier, so it asks under the default `auto` policy).
2. The note is written to `<user-data>/memory.json` (`MemoryStore`, atomic rename). Saving the same note again refreshes it instead of adding a copy.
3. On every message, `before_agent_start` puts a `## Memory` section into the system prompt: rules that mark the notes as data, then the newest notes up to 4000 characters. Notes that do not fit are found with `memory_search`.
4. `memory_list`, `memory_search` (read tier) and `memory_forget` (write tier, the card shows the note's text) complete the set.

**Controls.**

- Settings › Memory: global switch, list, add, edit, delete, clear all (commands `get_memory`, `set_memory_enabled`, `save_memory_entry`, `delete_memory_entry`, `clear_memory`; scope `memory`).
- Per agent: the "Use long-term memory" switch (`AgentProfile.memory`, default on; agent files without the field count as on). With either switch off there is no `## Memory` section and the four memory tools are not offered.
- Settings › Tools and the agent's tool list can still turn single memory tools off or on.

**Safety.** Notes are user-provided data: the section tells the model not to follow commands inside them, and a note cannot close its own `<memory>` tag. The tool descriptions tell the model not to save secrets or text copied from web pages.

## Checklist (`todo_write`)

For work with three or more steps the model writes a checklist and updates it as it goes. The chat shows the newest list as a card with one icon per status and a "done of total" count; older versions of the list collapse to one-line steps. The list is the tool call's own arguments, so nothing extra is stored and it reappears when a saved conversation is reopened. The tool needs no approval.

## Helpers (`delegate_task`)

For research that would fill the conversation with raw material (many files or pages), the model hands a focused task to a helper. The helper starts with an empty context and cannot see the conversation, so the task must carry everything it needs. It can read files and, when enabled, search and fetch the web; it cannot change anything, use memory or MCP tools, or delegate again. It uses the conversation's model unless the call names another available model. Only its final summary returns to the conversation. While it works, the chat shows its steps (tool and target) under the step; stopping the run aborts it.
