---
"@workspace/shared": patch
"@workspace/agent-core": patch
---

Added `/id` for Telegram and Zalo: the paired owner sends it in any chat to get that chat's id and type back, including a group not yet added in Settings. This makes it easy to find the id to configure per-chat access for a group, without needing to call the Bot API by hand. Telegram's `/id` works in an unconfigured group (unlike every other command there); Zalo's needs the owner to tag or reply to the bot first, since that is the only way Zalo forwards a group message to the bot.
