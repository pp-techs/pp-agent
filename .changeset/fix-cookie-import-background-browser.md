---
"@workspace/desktop": patch
"@workspace/web": patch
---

Fixed importing cookies on Windows telling you to quit a browser you had already closed. The message now explains that Chrome, Edge and Brave can keep running in the background (system tray, “Continue running background apps”) and hold the cookies locked. When the browser is not running at all, it shows the real reason (security software or file permissions) instead.
