---
"@workspace/desktop": patch
"@workspace/daemon": patch
"@workspace/shared": patch
---

Quitting the app (including from the tray) now stops the daemon it started, even when the daemon was left behind by an earlier, crashed app and reused. The daemon tells clients in its handshake whether an app started it (`hello_ok.spawnedByApp`), and main shuts it down on quit in that case. A daemon started by the login service or from a terminal still keeps running, so background work is unaffected.
