---
"@workspace/desktop": patch
---

Chatting through a gateway with a reasoning model no longer fails with "unknown variant `developer`": gateway requests always send the system prompt with the `system` role, which every OpenAI-compatible server accepts.
