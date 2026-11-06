---
"@workspace/desktop": minor
"@workspace/web": minor
"@workspace/daemon": minor
"@workspace/shared": patch
"@workspace/agent-core": patch
"@workspace/ui": patch
---

Use several skills in one message: after picking a skill, type `/` again to add another. Picked skills (and `/goal`) now show as chips in the message box instead of raw `/skill:name` text, and the chat, titles, search and edit-and-resend all understand a message with several skills. The message box always has two rows (text, then controls), and the thinking level moved into the model menu as a slider. Arrow keys keep the highlighted slash command in view. The file tree and its tabs use vscode-icons file and folder icons. On a phone the sidebar covers the whole screen like Settings, and a chat's age no longer overlaps its title. Settings section actions stay on the title row, and the main and side panels lose their outline.
