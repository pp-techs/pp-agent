---
"@workspace/desktop": patch
"@workspace/web": patch
---

A skill the agent creates (for example with skill-creator) now goes into the workspace's `.agents/skills` and can be used from your next message, `/` menu included, without restarting the chat. The Personal workspace now always loads the skills in its `.agents/skills`; other workspaces still need "Use the skills this folder carries" turned on.
