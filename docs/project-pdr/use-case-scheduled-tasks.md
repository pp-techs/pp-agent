# Use case: scheduled tasks

**Goal.** A person asks the agent to do the same job regularly ("every Friday at 16:00, summarize the files in Reports") without opening a chat. Each run is saved as a normal conversation they can read later from the sidebar.

Paths are under `packages/agent-core/src/` unless noted. Limits are also listed in [business-rules.md](business-rules.md).

## What a task is

The **Schedules** navigation item beside Settings opens the management page with an on/off switch, schedule, agent and workspace, next run, last run (finished or failed, when, and how many actions were skipped), and **Run now**. A task has:

| Field     | Rule                                                                                                                                    |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Name      | Unique (case-insensitive), at most 60 characters.                                                                                       |
| Prompt    | What the agent should do, at most 20000 characters.                                                                                     |
| Agent     | Any agent. A deleted agent falls back to the default agent when the task runs.                                                          |
| Workspace | Any workspace. A deleted workspace falls back to the default workspace.                                                                 |
| Schedule  | Once at a date/time, every 5–1440 minutes, every 1–168 hours, daily at `HH:MM`, or on chosen weekdays at `HH:MM`. Times are local time. |
| Enabled   | Off keeps the task but never starts it by itself; **Run now** still works.                                                              |

At most 50 tasks. The editor opens inside the page and checks the same limits as the agent (`SCHEDULE_LIMITS` in `packages/shared`). Editing a one-shot task preserves its exact instant unless the date/time is changed. Changing a completed one-shot task to a new time re-arms that slot; changing its name or toggling it does not repeat a completed slot. Existing target, delivery, origin, and run controls survive edits.

## How a run works

```mermaid
sequenceDiagram
  participant S as Scheduler (timer)
  participant A as AgentHost
  participant P as Task's own Pi session
  S->>A: task is due (or Run now)
  A->>P: new saved conversation, task's agent and workspace, tools and MCP of that agent
  P->>P: prompt; tools that would ask are denied
  P-->>A: reply (or error / 30 min limit)
  A->>A: record lastRun in settings.json
  A-->>UI: settings_changed(scheduledTasks), sessions_changed
```

- **Execution target.**
  - `new` (default): The run uses its own fresh Pi session (`runScheduledTask`), titled `⏰ <task name> – <date>`, apart from the conversation open in the window; `lastRun.sessionPath` points to it.
  - `session:<id>`: Consecutive runs execute in the named conversation, building on prior runs and sharing conversation history across runs.
  - `current`: The run executes in an isolated run session so it cannot race an in-progress user turn, but receives the tail of the originating conversation as context. When `delivery: "session"` is chosen, its completed result is committed back into that originating conversation (or its peer chat fallback) as a labeled message.
- Runs go **one at a time**, in the order they became due; a task that is queued or running is never queued again (Run now then fails with a message).
- A run that takes longer than 30 minutes is stopped and recorded as failed. Deleting a task stops its run in progress; the conversation stays.
- The scheduler (`scheduler.ts`) is pure local-time arithmetic: a day's slot is built from calendar fields, never by adding 24 hours, so daylight-saving changes do not shift "daily at 09:00". One timer points at the earliest next run and wakes at least once a minute, so a computer that slept does not run tasks much too late. It is re-armed after every run and on every settings change.
- **Catch-up.** Tasks run while the **daemon** runs, not only while the window is open. With **Run in background** on (Settings › Background, see [Background and Telegram](use-case-background-and-telegram.md)) the daemon starts when the person signs in and keeps running with the app closed. Without it, the app starts the daemon and stops it when the app quits, so nothing runs after that; the tray option keeps the app, and so the daemon, running with the window closed (see the shell settings). When the daemon starts, or the computer wakes, a slot missed within the last 24 hours runs **once**; older slots are skipped and counting restarts from now. A task created, switched on, or whose schedule changed is counted from that moment, so it never "catches up" for the time before.

## Headless approval rule

Nobody is at the keyboard during a run, so the approval gate cannot ask. For scheduled runs it works like this:

- Tools that run without asking under the tool policy (read tier under `auto`, or any tool whose policy is `allow`) run normally.
- Any tool call that would ask for approval is **denied automatically**, never approved. The model receives a plain reason in the tool result and a note in its system prompt saying the run is unattended, so it can explain what it could not do.
- The run counts denied calls (`lastRun.deniedTools`); Settings shows "N actions skipped".
- Tools with policy `off` stay unavailable, as always.
- `ask_user` and `schedule_manage` are not offered at all: nobody can answer, and a task cannot create or manage other tasks.
- The host handles configured result delivery after a successful run. There is no separate `telegram_notify` tool or notification-tool policy.

To let a scheduled task write files or use a business system, set that tool's policy to **Allow** in Settings › Tools (and in the agent's tool list). The editor and the section repeat this rule in an alert.

## Managed by the agent (`schedule_manage`)

In a conversation (the window or Telegram), the agent can create a one-shot reminder ("at 21:00 today") or recurring work ("every Friday at 16:00, summarize Reports"). `schedule_manage` (`schedule-tool.ts`, shown as **Scheduled tasks** in Tools) accepts `create`, `list`, `update`, `pause`, `resume`, `run`, and `remove`. Create takes a name, standalone prompt, and `when`: `once` with epoch-millisecond `at`, `interval` with `every` + `unit`, `daily` with `time`, or `weekly` with `days` + `time`. Create and update accept `target`, `deliver`, `deleteAfterRun`, and `silentIfEmpty`. An explicit `current` target resolves to the originating saved session ID; malformed targets are rejected.

The management tool uses the write-tier approval gate. Approval details show the operation, supplied schedule, execution target, delivery destination, and run controls before the prompt. New tasks start enabled with the conversation's agent and workspace and appear on the Schedules page. Switch the tool off in Settings › Tools or an agent's tool list. Telegram destinations must be the paired owner (`home` or its explicit chat key) or an explicitly configured chat; unknown destinations fail rather than delivering to the owner.

## Data and events

- Stored in `settings.json` as `scheduledTasks` (see [data-storage.md](../architecture/data-storage.md)); the transcript of each run is an ordinary session file.
- Commands: `list_scheduled_tasks`, `save_scheduled_task`, `delete_scheduled_task`, `set_scheduled_task_enabled`, `run_scheduled_task`. The agent emits `settings_changed` with scope `scheduledTasks` when a task is queued, starts, or finishes (the list shows "Running" / "Waiting"), and `sessions_changed` when a run adds a conversation.
- Read-only fields `state` and `nextRun` of `ScheduledTaskView` are computed on every list; they are not stored.
