---
"@workspace/agent-core": patch
---

Keep the checklist up to date: the prompt and the `todo_write` result now tell the agent to mark items done as it goes, and when a run ends with a checklist that still has open items the agent is asked once (with a message the chat does not show) to update it.
