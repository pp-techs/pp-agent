---
"@workspace/desktop": patch
"@workspace/web": patch
---

Scheduled tasks are sturdier. A one-time task whose moment passed more than a day ago is switched off (or removed, if it was set to be removed) instead of rewriting settings every minute, and shows **Finished** in Settings. A run that hangs is given up on after the time limit so it no longer blocks the other tasks. "Delete after run" only applies to one-time tasks and keeps a task whose run failed. "Stay silent when empty" now tells the model to reply `[SILENT]` and also treats an empty answer as nothing to report. Tasks created from a Telegram or Zalo chat remember that chat. A result that could not be sent at first updates the task's last run once it goes out. The agent can set a one-time task with `afterMinutes` or a local time, and the interval limits in its tool now match the real ones.
