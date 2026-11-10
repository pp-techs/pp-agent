---
"@workspace/desktop": patch
---

A research run now saves its report in a folder of its own: `research/<question>-<date>/report.md` and `report.html`, instead of loose files directly in `research/`. Each run gets its own folder (`-2`, `-3`… when the name is taken), so reports no longer mix.
