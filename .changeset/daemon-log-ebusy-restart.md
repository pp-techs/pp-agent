---
"@workspace/desktop": patch
---

Restarting the agent on Windows right after it stops (manually, or when an update replaces it) no longer fails with a raw `EBUSY: resource busy or locked` error when the log file is still momentarily locked by the daemon that just exited; it now retries briefly before giving up.
