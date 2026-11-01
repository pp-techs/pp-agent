# Design brief: long-term memory and session titles

Status: implemented. Paths are under `packages/agent-core/src/` unless noted.

## Problem

- Titles and memory extraction run on the conversation's main model.
- Memory extraction runs after every turn and can only add notes: an updated fact leaves the old note behind, and a full place silently drops new notes.
- The `## Memory` section is rebuilt every turn, so a note saved mid-conversation changes the system prompt and drops the prompt cache.
- The model has no clear rules for when to read or write memory, or which place a note belongs in.

## Reference behavior

- opencode: hidden title agent on `small_model` after the first user message.
- omp: title as a side turn on the cached prefix, tiny-model fallback; memory pipelines that extract, then consolidate; lessons apply from the next session so the prompt cache is kept.
- Claude Code: `MEMORY.md` index (first 200 lines / 25 KB) loaded at session start, topic files read on demand.
- Gemini CLI: `save_memory` appends bullets to `GEMINI.md`.
- mem0: extraction proposes `ADD / UPDATE / DELETE / NOOP` against existing memories.

## Decisions (confirmed)

1. A **fast model** setting serves titles and memory extraction.
2. Memory is written by `memory_save` when the person asks, and by a background extraction pass when a conversation goes idle.
3. Auto-saved notes show a toast with **Undo**.
4. The prompt carries a fixed **profile** taken once per session; `memory_search` finds the rest.
5. The notes stay the single source of truth; extraction returns operations (approach A).
6. Notes can be **pinned** (`!` after the bullet).
7. In the built-in **Personal** workspace every extracted note is global.
8. A full place is never trimmed automatically: extraction may only update, and Settings warns.
9. Channel chats, scheduled runs and helpers are never extracted from.

## Fast model

- `settings.json` gains `fastModel: ModelRef | null` (Settings › Models picker "Fast model").
- `chooseFastModel(main)`: `fastModel` when available, else the cheapest available model (by `cost.input`, then `cost.output`) of the main model's provider, else the main model.
- `one-shot.ts` holds the shared one-shot call and transcript helpers used by titles and extraction.

## Titles

Same triggers as today (first message, then after the reply when the first message was too short), on the fast model. Named conversations are never touched.

## Memory extraction

- **Trigger.** A per-conversation idle timer (5 minutes, reset by every settled turn) or the conversation being released (switched away from, closed, background run settled). Only window conversations whose agent and the global switch have memory on.
- **Cursor.** A `pp-agent-memory` custom entry `{ lastEntryId }` in the session file; when that entry is no longer on the branch the pass reads the newest 20,000 characters again.
- **Input.** Visible notes with short ids (`n1…`), their place and pin state; the workspace name (or "Personal"); the unread messages.
- **Output.** `<memories>[…]</memories>`, at most 5 operations: `{op:"add",text,tag,scope}`, `{op:"update",id,text,tag?,scope?}`, `{op:"delete",id}`.
- **Checks.** Unknown ids and notes outside this conversation's places are dropped; pinned notes are read-only to extraction; in Personal every scope is global; a full place refuses `add` (the prompt says so up front).
- **Undo.** Each applied pass is announced with `memory_auto_saved { passId, changes }`; `undo_memory_pass { passId }` reverses changes whose note is still as the pass left it. Kept in memory for 10 minutes.

## Reading memory

- The `## Memory` section is taken at the first turn of a session and kept for the session's life.
- Budget 2,000 characters, in order: pinned workspace notes, pinned global notes, `identity`/`preference` notes, then newest workspace notes, then newest global notes; a line names how many more notes `memory_search` can find.
- Rules: search when the request refers to earlier work, a named person or project, or a preference not in the profile; save with `memory_save` only when the person asks to remember or correct something.
- `memory_search` matches without accents (Vietnamese "tieng viet" finds "tiếng việt").

## Delivery

- Unit tests: operation parsing and checks, pin parsing, profile order and budget, accent-free search, cursor by entry id, undo after a later edit.
- Session tests: idle timer runs one pass; chats and scheduled runs are skipped; the system prompt stays the same after a note is saved.
- Docs: `use-case-memory-and-planning.md`, `business-rules.md`, `data-storage.md`, `model-and-thinking-selection.md`; a changeset; strings in `en` and `vi`.
