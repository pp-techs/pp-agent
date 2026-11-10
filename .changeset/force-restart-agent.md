---
"@workspace/desktop": patch
"@workspace/web": patch
---

Settings › Advanced has a **Restart agent** button: it stops the background agent and starts one from this version, for when the agent does not know a command the app just sent (an older daemon that answered on the same version). It asks first, since conversations answering now stop and scheduled tasks and bots pause for a few seconds.
