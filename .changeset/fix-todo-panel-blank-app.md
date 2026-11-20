---
"@workspace/web": patch
---

Fix the whole app going blank when opening a conversation that has a checklist. The checklist panel read the newest checklist call through a selector that built a new object on every read, so React saw a changing snapshot and stopped with "Maximum update depth exceeded". The selector now returns the call itself.
