---
"@workspace/desktop": patch
"@workspace/web": patch
---

MCP servers that run a local command (`npx`, `uvx`, and similar) now work when the app is opened from Finder or the Dock. The app reads `PATH` from your login shell at startup.
