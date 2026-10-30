# Use case: thinking levels and slash commands

## Thinking level

- For models that can reason, the message box offers a thinking level (off, minimal, low, medium, high, … as the model allows). Pi clamps the level to what the model offers; models without thinking show `off` (`packages/agent-core/src/index.ts`, `thinking()`).
- Each conversation keeps its own level; new chats start with the last one picked (`AppSettings.thinkingLevel`).
- Gateway models need the reasoning toggle on in their gateway settings.

## Slash commands

Typing `/` suggests commands and the skills the current agent may use; arrows and Enter or Tab pick one, Escape hides the list. The same items appear in the **+** menu.

| Command             | Effect                                                                                                                                                                                                                                                                                                                                                    |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/new`              | Start a new conversation.                                                                                                                                                                                                                                                                                                                                 |
| `/compact`          | Summarize a long conversation to free context. Refused while an answer is streaming. Pi keeps the newest 20,000 tokens, so when that covers the whole chat the command retries keeping 2,000; only a conversation of a single exchange reports "This conversation is still short, so there is nothing to summarize yet."                                  |
| `/goal <objective>` | Set a goal for the conversation. The objective is sent as the first message, then the agent keeps working turn after turn on its own until it calls `complete_goal`. `/goal pause`, `/goal resume` and `/goal clear` manage it (also the buttons of the banner above the message box); a bare `/goal` shows the current goal, or starts typing a new one. |
| `/skill:<name>`     | Run a skill with optional arguments.                                                                                                                                                                                                                                                                                                                      |

Automatic compaction is also on, with up to 2 retries for failed model calls (session settings in `packages/agent-core/src/index.ts`).

## Goals

- One goal per conversation, kept in memory (`ConversationState.goal`) and recorded on the saved branch as a `pp-agent-goal` custom entry. A conversation opened again shows its goal **paused**; nothing carries on by itself in a closed conversation.
- While the goal is active the agent gets the `complete_goal` tool (read tier, so no approval) and a `## Goal` section in its system prompt. When a run settles, `AgentHost.afterGoalTurn` starts the next turn with a hidden message (`pp-agent-goal-continue`, not shown in the chat).
- A turn that ends in an error or is stopped (Stop, or leaving the conversation while it answers) **pauses** the goal. A turn with no tool call **waits** for the person (the banner says so); writing to the agent again, or resuming, carries on.
- Goals exist only in the window's conversations, not in scheduled runs or chat channels. There is no token or turn budget; pause or stop it from the banner.
