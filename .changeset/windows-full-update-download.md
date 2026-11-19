---
"@workspace/desktop": patch
---

Windows updates now always download the full installer instead of a differential (binary-diff) patch. A differential patch interrupted by security software, a full disk, or the app closing mid-write could leave `app.asar` corrupted in a way that only showed up later as "Cannot find package" errors inside the app. Updates now download a bit more data each time, but can no longer corrupt the existing install this way.
