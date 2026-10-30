---
"@workspace/desktop": minor
"@workspace/web": minor
---

Added yolo mode: skips the approval step for every tool that is already allowed, including shell commands once "Allow shell commands" is on, and skips the first-use "Let the agent use X?" card for an app the computer tool opens (protected apps still refuse). Turn it on for every conversation in Settings › Tools, or for just the open chat with the rabbit button in its header or the `/yolo` command. It does not turn on anything by itself, and locked or off tools stay off.
