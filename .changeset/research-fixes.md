---
"@workspace/desktop": patch
"@workspace/daemon": patch
"@workspace/agent-core": patch
---

Research fixes. The plan card no longer fails with "An answer … is not one of the options" when a clarifying question reuses the id `depth` or `start`: those ids are made unique and the clarifying questions are validated. Reports are always written into the workspace's `research/` folder by the app (the prompt says not to use `write` for them), and a report that compares numbers now includes a chart — an `svg` block in the Markdown that the app draws, and the same chart inline in the HTML.
