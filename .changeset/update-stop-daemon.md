---
"@workspace/desktop": patch
---

Restarting to install an update on Windows no longer stops halfway with "close PP Agent to continue". The app now stops its background agent, and keeps the login service from starting it again, before the installer runs.
