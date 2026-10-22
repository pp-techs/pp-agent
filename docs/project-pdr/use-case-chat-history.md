# Use case: chat history management

- Each conversation is a Pi session file (JSONL) in `<user-data>/sessions/`.
- The sidebar lists saved conversations by date across all workspaces; the user opens, renames, or deletes them.
- Titles are derived from the first message and cut to 80 characters (`TITLE_LENGTH` in `apps/desktop/src/agent/index.ts`).
- Each conversation remembers its model, agent, and thinking level; opening it restores them (model only if still available; deleted agent → default agent).
- `/new` starts a new conversation; new chats use the last-picked agent and thinking level and the default model (see `business-rules.md`).

Pi writes a session file only once the conversation has an assistant message, so a chat with no answer yet does not appear in history. Entries added before that (such as the `pp-agent` agent entry) are kept in memory and written with the first answer.
