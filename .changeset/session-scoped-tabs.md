---
"@workspace/web": patch
"@workspace/desktop": patch
---

Terminals, browser tabs and file tabs now belong to the conversation that opened them, not to the whole workspace: switching conversations shows that conversation's own tabs, and the agent's browser tool sees and uses only its own conversation's tabs. Deleting a conversation closes its terminals and browser tabs
