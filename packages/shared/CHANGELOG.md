# @workspace/shared

## 0.0.2

### Patch Changes

- 6df5258: Phone access: use PP Agent from a phone (or another computer) on the same network, in its web browser. Turn it on in **Settings › Phone access**, scan the QR code, and the phone pairs in one step; then chat, attach photos and files, answer approvals, and change most settings from a layout made for small screens (full-screen Settings with a section list, actions always visible on touch, safe areas, add to home screen). The daemon serves the app, so it keeps working with the window closed when PP Agent runs in the background. Paired devices are listed with Unpair; pairing codes are one-time and expire after 10 minutes. The connection is plain HTTP, so Settings warns to use it only on trusted networks, and settings that let the agent run programs without asking (MCP servers, tool permissions, turning on the shell or yolo mode) can only be changed on the computer.

## 0.0.1

### Patch Changes

- b3fe6fb: Added `/id` for Telegram and Zalo: the paired owner sends it in any chat to get that chat's id and type back, including a group not yet added in Settings. This makes it easy to find the id to configure per-chat access for a group, without needing to call the Bot API by hand. Telegram's `/id` works in an unconfigured group (unlike every other command there); Zalo's needs the owner to tag or reply to the bot first, since that is the only way Zalo forwards a group message to the bot.
- b3fe6fb: Zalo now answers group chats, not just private ones: Zalo only forwards a group message to the bot when someone @-mentions it or replies to one of its messages, so the owner's tag or reply works right away. Settings › Channels › Zalo gained per-chat settings (label, access, allowed users, busy mode) mirroring Telegram's, letting a chat be opened to specific members instead of the owner only.
