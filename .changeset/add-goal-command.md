---
"@workspace/desktop": minor
"@workspace/web": minor
---

Added the `/goal` command. Type `/goal` and what you want done: the agent starts on it and keeps working turn after turn by itself until it reports the goal done. A banner above the message box shows the goal with pause, resume and clear (`/goal pause`, `/goal resume` and `/goal clear` do the same). Stopping the answer pauses the goal, and a turn where the agent only answers or asks something waits for your reply. A conversation opened again shows its goal paused.
