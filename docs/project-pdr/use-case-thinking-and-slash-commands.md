# Use case: thinking levels and slash commands

## Thinking level

- For models that can reason, the message box offers a thinking level (off, minimal, low, medium, high, … as the model allows). Pi clamps the level to what the model offers; models without thinking show `off` (`apps/desktop/src/agent/index.ts`, `thinking()`).
- Each conversation keeps its own level; new chats start with the last one picked (`AppSettings.thinkingLevel`).
- Gateway models need the reasoning toggle on in their gateway settings.

## Slash commands

Typing `/` suggests commands and the skills the current agent may use; arrows and Enter or Tab pick one, Escape hides the list. The same items appear in the **+** menu.

| Command         | Effect                                                                                                                                                                                                                                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/new`          | Start a new conversation.                                                                                                                                                                                                                                                                                                |
| `/compact`      | Summarize a long conversation to free context. Refused while an answer is streaming. Pi keeps the newest 20,000 tokens, so when that covers the whole chat the command retries keeping 2,000; only a conversation of a single exchange reports "This conversation is still short, so there is nothing to summarize yet." |
| `/skill:<name>` | Run a skill with optional arguments.                                                                                                                                                                                                                                                                                     |

Automatic compaction is also on, with up to 2 retries for failed model calls (session settings in `apps/desktop/src/agent/index.ts`).
