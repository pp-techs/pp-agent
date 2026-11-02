---
"@workspace/desktop": minor
"@workspace/web": minor
---

Added a local audit log for debugging. PP Agent now keeps a record of errors and key events (model failures with what the provider actually said and which model it was, approvals asked, background-service drops, app and page crashes) in `logs/audit.log` next to the app's data. It never holds the text of conversations, and keys, tokens, cookies and your account name in file paths are hidden. A failed answer now has a button to copy the provider's error, and Settings › General › Diagnostics exports the log together with the system details and the tail of the background service's log, so you can send one file when you hit "The model returned an error". You can also show the log folder or clear the log there.
