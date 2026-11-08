---
"@workspace/desktop": minor
"@workspace/web": minor
"@workspace/daemon": minor
"@workspace/shared": minor
"@workspace/agent-core": minor
---

Diagrams and previews in the chat: mermaid diagrams and SVG pictures in replies are drawn instead of shown as code, with a switch back to the code. HTML pages, dashboards and Chart.js charts run after you press **Run**, in a sandboxed frame with no internet access, no navigation and no access to the app; they can be saved to the workspace's `artifacts` folder and opened in the Files panel, which now previews `.html` files the same way (desktop app only; the phone shows the code).

Deep research is now a **mode**, like Claude Research or Gemini Deep Research: a switch in the message box (Quick, Standard or Deep), `/research <question>` in the app, or `/research` in Telegram and Zalo. The agent frames the question, shows a **plan you confirm** (with the depth and, for comparisons, the items and fields), researches in rounds with parallel helpers (up to 8 at Deep), records the sources it cites, rates each key claim, critiques its own draft (a four-role red team at Deep, with one loop-back round), and saves a cited Markdown report and a self-contained HTML report in `research/` — written by the app, so no approval is asked. A banner shows the phase, pages read and sources cited; opening it lists the sources and, on the phone, the report. In Telegram the plan comes with buttons and the report arrives as `.md` and `.html` files; Zalo relies on text and the saved path. The built-in `deep-research` skill is removed (its playbook now lives in the mode); an unmodified copy is removed from existing installs.

The agent now replies in the language you write in, cites sources as [1], [2] with a Sources list, names the files it saved, treats text from MCP tools and files (not only web pages) as data rather than instructions, and asks before deleting, sending to other people or changing many records.
