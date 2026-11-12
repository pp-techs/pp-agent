---
"@workspace/desktop": minor
"@workspace/web": minor
---

Telegram and Zalo can have **more than one account**. In Settings › Channels each app opens a list of accounts: add another bot with its own token and an optional name, then pair and configure it like the first. Every account keeps its own owner, agent, workspace, per-chat settings and conversations, and can be turned off or forgotten on its own; the same bot token cannot be used twice. Your existing bot becomes the first account and keeps its conversations. Scheduled results can be sent to another account's owner or chats with `peer:telegram:<account>:<chat>`.
