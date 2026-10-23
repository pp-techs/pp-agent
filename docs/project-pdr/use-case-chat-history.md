# Use case: chat history management

- Each conversation is a Pi session file (JSONL) in `<user-data>/sessions/`.
- The sidebar groups saved conversations by workspace (collapsible, the built-in workspace first); inside each workspace they are listed by date. The `+` on a workspace starts a new chat there; the user opens, renames, or deletes chats from the list.
- Titles are derived from the first message and cut to 80 characters (`TITLE_LENGTH` in `apps/desktop/src/agent/index.ts`).
- Each conversation remembers its model, agent, and thinking level; opening it restores them (model only if still available; deleted agent → default agent).
- `/new` and the sidebar's **New chat** start a new conversation in the open conversation's workspace; new chats use that workspace's agent and thinking level when it sets them, else the last-picked ones (see `business-rules.md`).

Pi writes a session file only once the conversation has an assistant message, so a chat with no answer yet does not appear in history. Entries added before that (such as the `pp-agent` agent entry) are kept in memory and written with the first answer.
