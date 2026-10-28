# Design brief: channel sessions and scheduling (steps 1–2)

Status: approved in brainstorm; not implemented. Paths are under `packages/agent-core/src/` unless noted.

## Problem

- Settings and routing for channels are per channel, not per chat (one `ownerId`, no group, no roles).
- A chat's session is invisible to the agent and unclear to the person (`telegram:<chatId>`, `/new` drops the way back).
- Scheduled tasks can only recur, and the only way to reach Telegram is `telegram_notify`: write tier, denied in unattended runs, and the sent text is not in any session, so a reply has no context.

## Reference behavior (OpenClaw, Hermes)

- Session choice and result destination are separate. OpenClaw: `--session main | current | isolated | session:<id>`; Hermes: `deliver: origin | local | <platform>:<chat>`.
- The system delivers the final result; the agent does not call a send tool.
- A delivered result lives in the target conversation, so a reply continues with context.
- Agents get session tools (`sessions_list`, `sessions_history`, ...) and one management tool for jobs.

## Decisions (confirmed)

1. A task created in a conversation defaults to `target: current`, `delivery: session`.
2. A message delivered to a peer is written into that peer's chat session, then pushed out.
3. A member's chat session sees only itself; it cannot list other sessions.

## Step 1: sessions the agent can see

**Session identity.** A session id is the Pi session file path (as the sidebar uses today). Kind is derived, no new store:

| Kind     | Rule                                                               |
| -------- | ------------------------------------------------------------------ |
| `chat`   | path is a value in `channels.json` (reverse lookup gives the peer) |
| `task`   | path equals some task's `lastRun.sessionPath` (title starts `⏰`)  |
| `window` | everything else                                                    |

**Peer key.** `channel:account:kind:id[:thread]`, for example `telegram:default:dm:123`. `ChatSessionMap` reads old `telegram:<id>` keys as aliases and rewrites them on save.

**Context block** added to the system prompt of every turn (window, chat, task): local time and time zone, current session id and kind, surface (`window` or `telegram dm <name>`), home peer or none.

**Tools** (read-only, read tier, no approval):

- `sessions_list({ kind?, peer?, search?, limit })`: id, title, kind, peer label, agent, workspace, modified, `isCurrent`, short preview. Built on `listSessions` plus the derivation above.
- `sessions_history({ sessionId, limit })`: tail of one session, text only, long blocks truncated.
- `peers_list()`: destinations a task can deliver to: `home` and configured chats, each with a label.

**Visibility.** `all` for the window and the owner's DM; `self` for member chats; a scheduled run sees only its target session. Enforced in the tool, not in the prompt.

## Step 2: schedule target and delivery

**Types** (`packages/shared`):

```ts
type ScheduleTarget =
  | { mode: "current"; sessionId: string } // own run, reads the tail of the origin session
  | { mode: "new" } // fresh ⏰ session each run (today's behavior)
  | { mode: "session"; sessionId: string }; // one named session reused across runs

type ScheduleDelivery =
  | { to: "session" } // into the target session
  | { to: "peer"; peer: string } // peer key or "home"
  | { to: "none" };

// schedule gains: { kind: "once"; at: number }
// task gains: target, delivery, origin?: sessionId, deleteAfterRun, silentIfEmpty
```

Old tasks load as `target: new`, `delivery: none` (no behavior change).

**Run semantics.**

- `current`: the run uses its own run session (never inside the origin session, so it cannot race a turn the person is typing). It receives the last N origin messages as context. The final text is committed to the origin session through `KeyedQueue`, after any running turn.
- `session`: runs in the named session; consecutive runs see each other.
- `new`: unchanged.
- Origin session gone (`/new`, deleted): fall back to the same peer's current chat session; if none, record `lastRun.delivery = failed(reason)` and keep the run.
- `delivery.to = peer`: `gateway.deliver(peer, text)` appends an assistant message labeled `⏰ <task>` to the peer's chat session (creating it if missing) and sends it through the channel adapter. Delivery failures are stored in `lastRun.delivery` and retried once when the channel is online again.
- `silentIfEmpty`: a final text that is exactly `[SILENT]` records the run and delivers nothing.
- `once`: at-least-once for delivery; the run start is stored before the run so a restart does not run it twice. A one-shot slot missed within 24 h fires late with a "late by N minutes" note. The task is disabled (or deleted with `deleteAfterRun`) after the run.

**Tool: `schedule_manage`** replaces `schedule_task`. Actions: `create`, `list`, `update`, `pause`, `resume`, `run`, `remove` (name or id; ambiguous names are refused). `create` takes `name`, `prompt`, `when` (`once` with `at` or `in`, `interval`, `daily`, `weekly`), `target`, `deliver`, `deleteAfterRun`, `silentIfEmpty`. The tool description tells the model: reminders use `current`; recurring reports use `session` with a stable name and a `deliver`; write standalone prompts. `create`, `update`, `remove` and `run` are write tier; `list` is read tier. Not offered in scheduled runs (a task cannot create tasks, as today).

**Approval.** The create/update dialog shows schedule, run target and delivery. Approving it covers the later write into that session and the push to that peer; no approval at run time. The headless rule for other tools is unchanged.

**Removal of `telegram_notify`.** Delete `channels/telegram/tool.ts`, `TELEGRAM_NOTIFY_TOOL` and `TelegramService.notify` callers. Migrate saved agent tool lists and tool policies that name it (drop the entry, no replacement). An immediate message to Telegram becomes a `once` task with `at` = now.

## Out of scope here

Gateway core extraction, per-chat access settings and roles, group support, `/sessions` and `/resume`, busy modes, durable inbox. They follow in steps 3–5; step 2 only adds `gateway.deliver` and uses the existing Telegram adapter behind it.

## Risks and checks

- The working tree has uncommitted changes in `index.ts`, `tools.ts`, `channels/names.ts`, `channels/telegram/channel.ts`, `service.ts` and several i18n files. Land or stash them before step 2, which edits the same files.
- Reverse lookup from path to peer must stay cheap (`channels.json` is small; build the map once per list call).
- `current` context tail can carry secrets from the origin session into a run; it stays inside the same install and the same agent policy, but cap N and truncate.
- Time handling: store `at` as epoch ms; resolve "in 5 minutes" and "21:00 today" in the tool from the clock in the context block, and reject a time in the past.

## Verification

- Unit: `once` due/late/catch-up with a fake clock; derivation of session kind; visibility matrix (window, owner DM, member chat, scheduled run); target fallback when the origin session is gone; `[SILENT]`; migration of old tasks and old chat keys.
- Integration: fake clock plus fake Telegram API: "remind me at 21:00" from the window with `deliver: home` ends as a Telegram message, the same text is in the chat session, and a reply reaches the agent with that text in context.
- Tool tests next to `schedule-tool.session.test.ts`; Telegram tests in `channels/telegram/service.test.ts`.
- Docs to update with the code: `use-case-scheduled-tasks.md`, `use-case-background-and-telegram.md`, `conversation-flows.md`, `business-rules.md`, `data-storage.md`, `CHANGELOG.md`; strings in both locales (`en`, `vi`).
