---
"@workspace/desktop": patch
---

"Restart to update" now really restarts: with the tray icon on, the app hid itself instead of quitting, so the update never installed and the app never came back. If an update is already stuck this way, quit the app from its tray icon and install this version once by hand; the next updates restart on their own.
