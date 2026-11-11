---
"@workspace/desktop": patch
"@workspace/web": patch
---

The app is quicker and lighter. The window's first screen loads about 37% less JavaScript (the Markdown renderer now loads right after the first paint) and is ready about 15 ms sooner (about 30% sooner on a throttled phone). The agent starts about 130 ms faster, because the email and Office document libraries load the first time a mailbox or document is opened. A streaming reply now sends only the text it just added instead of the whole answer at every update, which saves a lot of data for the phone app and Remote access on long answers. Changing a chat's setting (model, thinking level, yolo mode, goal) no longer redraws every message in the chat, and no longer sends the whole conversation, screenshots included, to every connected device. A device that misses part of a streaming reply now fetches the chat again instead of showing stale text. Closing Remote access (or quitting) now finishes saving when each device was last seen, so that write is no longer cut off. The conversation list reads only the new lines of the open chat's file after each message instead of the whole file again.
