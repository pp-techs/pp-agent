---
"@workspace/desktop": patch
"@workspace/web": patch
---

Fixed the chat view jumping to the top whenever a tool call finished. The patched `@shadcn/react` message scroller no longer re-anchors an already-seen historical turn when a loader swaps for its result in the same render.
