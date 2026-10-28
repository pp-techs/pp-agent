# Use case: scheduled tasks

**Goal.** A person asks the agent to do the same job regularly ("every Friday at 16:00, summarize the files in Reports") without opening a chat. Each run is saved as a normal conversation they can read later from the sidebar.

Paths are under `packages/agent-core/src/` unless noted. Limits are also listed in [business-rules.md](business-rules.md).

## What a task is

Settings › Scheduled tasks lists the tasks with an on/off switch, the schedule, the agent and workspace, the next run, the last run (finished or failed, when, and how many actions were skipped) and **Run now**. A task has:

| Field     | Rule                                                                                                               |
| --------- | ------------------------------------------------------------------------------------------------------------------ |
| Name      | Unique (case-insensitive), at most 60 characters.                                                                  |
| Prompt    | What the agent should do, at most 20000 characters.                                                                |
| Agent     | Any agent. A deleted agent falls back to the default agent when the task runs.                                     |
| Workspace | Any workspace. A deleted workspace falls back to the default workspace.                                            |
| Schedule  | Every 5–1440 minutes, every 1–168 hours, daily at `HH:MM`, or on chosen weekdays at `HH:MM`. Times are local time. |
| Enabled   | Off keeps the task but never starts it by itself; **Run now** still works.                                         |

At most 50 tasks. The editor opens inside the pane (breadcrumb sub-page) and checks the same limits as the agent (`SCHEDULE_LIMITS` in `packages/shared`).

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

- The run uses its **own** Pi session (`runScheduledTask`), apart from the conversation the person has open; that one is neither read nor disturbed. Runs go **one at a time**, in the order they became due; a task that is queued or running is never queued again (Run now then fails with a message).
- The conversation is titled `⏰ <task name> – <date>` and is listed in the sidebar like any other. `lastRun.sessionPath` points to it.
- A run that takes longer than 30 minutes is stopped and recorded as failed. Deleting a task stops its run in progress; the conversation stays.
- The scheduler (`scheduler.ts`) is pure local-time arithmetic: a day's slot is built from calendar fields, never by adding 24 hours, so daylight-saving changes do not shift "daily at 09:00". One timer points at the earliest next run and wakes at least once a minute, so a computer that slept does not run tasks much too late. It is re-armed after every run and on every settings change.
- **Catch-up.** Tasks run while the **daemon** runs, not only while the window is open. With **Run in background** on (Settings › Background, see [Background and Telegram](use-case-background-and-telegram.md)) the daemon starts when the person signs in and keeps running with the app closed. Without it, the app starts the daemon and stops it when the app quits, so nothing runs after that; the tray option keeps the app, and so the daemon, running with the window closed (see the shell settings). When the daemon starts, or the computer wakes, a slot missed within the last 24 hours runs **once**; older slots are skipped and counting restarts from now. A task created, switched on, or whose schedule changed is counted from that moment, so it never "catches up" for the time before.

## Headless approval rule

Nobody is at the keyboard during a run, so the approval gate cannot ask. For scheduled runs it works like this:

- Tools that run without asking under the tool policy (read tier under `auto`, or any tool whose policy is `allow`) run normally.
- Any tool call that would ask for approval is **denied automatically**, never approved. The model receives a plain reason in the tool result and a note in its system prompt saying the run is unattended, so it can explain what it could not do.
- The run counts denied calls (`lastRun.deniedTools`); Settings shows "N actions skipped".
- Tools with policy `off` stay unavailable, as always.
- `ask_user` and `schedule_task` are not offered at all: nobody can answer, and a task cannot create tasks.
- `telegram_notify` is offered but asks (write tier), so a run can message the person only when its policy is **Allow** in Settings › Tools (see [Background and Telegram](use-case-background-and-telegram.md)).

To let a scheduled task write files or use a business system, set that tool's policy to **Allow** in Settings › Tools (and in the agent's tool list). The editor and the section repeat this rule in an alert.

## Created by the agent (`schedule_task`)

In a conversation (the window or Telegram) the agent can create a task when the person asks for something recurring ("every Friday at 16:00, summarize Reports"). `schedule_task` (`schedule-tool.ts`) takes a name, a prompt and a schedule (`interval` with `every` + `unit`, `daily` with `time`, or `weekly` with `days` + `time`), and goes through the same validation and limits as the editor. It is a write-tier tool, so it asks first and shows the schedule and prompt. The task starts **enabled**, with the agent and workspace of that conversation, and appears in Settings › Scheduled tasks. The tool can only create: editing, disabling and deleting stay in Settings. Switch it off in Settings › Tools or in an agent's tool list.

## Data and events

- Stored in `settings.json` as `scheduledTasks` (see [data-storage.md](../architecture/data-storage.md)); the transcript of each run is an ordinary session file.
- Commands: `list_scheduled_tasks`, `save_scheduled_task`, `delete_scheduled_task`, `set_scheduled_task_enabled`, `run_scheduled_task`. The agent emits `settings_changed` with scope `scheduledTasks` when a task is queued, starts, or finishes (the list shows "Running" / "Waiting"), and `sessions_changed` when a run adds a conversation.
- Read-only fields `state` and `nextRun` of `ScheduledTaskView` are computed on every list; they are not stored.
