---
"@workspace/shared": patch
"@workspace/agent-core": patch
"@workspace/web": patch
"@workspace/desktop": patch
---

Zalo now answers group chats, not just private ones: Zalo only forwards a group message to the bot when someone @-mentions it or replies to one of its messages, so the owner's tag or reply works right away. Settings › Channels › Zalo gained per-chat settings (label, access, allowed users, busy mode) mirroring Telegram's, letting a chat be opened to specific members instead of the owner only.
