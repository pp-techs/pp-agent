---
"@workspace/desktop": minor
---

The agent can now keep running in the background after you close or quit the app, and you can chat with it from Telegram. Turn on Settings › Background to keep it running, and set up Telegram in Settings › Channels; scheduled tasks keep running too. Saved sign-ins move to a new encrypted store automatically.

Workspaces no longer have their own model or thinking level: a chat uses its agent's model, else the default model. A workspace's agent now also decides who answers on Telegram, unless you pick another with `/agent`.
