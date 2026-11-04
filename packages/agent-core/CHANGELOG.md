# @workspace/agent-core

## 0.0.1

### Patch Changes

- b3fe6fb: Added `/id` for Telegram and Zalo: the paired owner sends it in any chat to get that chat's id and type back, including a group not yet added in Settings. This makes it easy to find the id to configure per-chat access for a group, without needing to call the Bot API by hand. Telegram's `/id` works in an unconfigured group (unlike every other command there); Zalo's needs the owner to tag or reply to the bot first, since that is the only way Zalo forwards a group message to the bot.
- b3fe6fb: Zalo now answers group chats, not just private ones: Zalo only forwards a group message to the bot when someone @-mentions it or replies to one of its messages, so the owner's tag or reply works right away. Settings › Channels › Zalo gained per-chat settings (label, access, allowed users, busy mode) mirroring Telegram's, letting a chat be opened to specific members instead of the owner only.
- Updated dependencies [b3fe6fb]
- Updated dependencies [b3fe6fb]
  - @workspace/shared@0.0.1
