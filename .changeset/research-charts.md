---
"@workspace/desktop": patch
"@workspace/daemon": patch
"@workspace/agent-core": patch
---

A research report that compares numbers now includes a chart: a mermaid chart (`pie`, `xychart-beta`, `quadrantChart`, `sankey-beta`, `treemap-beta`) in the Markdown, which the app draws in the Files panel, and the same chart as inline SVG in the HTML report (mermaid does not run there). The plan card also no longer fails with "An answer … is not one of the options" when a clarifying question reuses the id `depth` or `start`, and the prompt says the report goes into `research/` through `research_report`, never `write`.
