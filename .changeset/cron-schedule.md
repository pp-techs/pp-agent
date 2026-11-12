---
"@workspace/web": patch
"@workspace/shared": patch
"@workspace/agent-core": patch
---

Scheduled tasks now run once or repeat. Pick how often (every few minutes or hours, every day, on chosen weekdays, once a month) and the time, and the editor shows the next three runs; for anything else, "Advanced" takes a cron expression such as `0 9 1,15 * *`. The agent schedules the same way. Tasks you already have keep running: every day and chosen-days tasks keep their exact time, and "every N hours/minutes" tasks are rounded to the nearest gap that fits the clock, for example every 5 hours becomes every 6.
