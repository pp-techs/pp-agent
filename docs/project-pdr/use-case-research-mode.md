# Use case: deep research mode

A conversation can run a **research** run: the person gives a question and a depth, the agent plans, asks the person to confirm the plan, researches in rounds with parallel helpers, cross-checks the sources, critiques its own draft, and saves a cited report. It works like Claude Research or Gemini Deep Research; the design and its sources are in [the design brief](../plans/research-mode.md) and `visual-output-and-research.md` (the playbook began as a skill). Code: `packages/agent-core/src/research.ts` (state, tools, prompt, report files), `research-guides.ts` (the guide texts), the wiring in `index.ts`, `apps/web/src/components/chat/research-banner.tsx` and `components/panel/research-panel.tsx` in the renderer.

## Starting a run

- **Window and phone:** the **Research** toggle in the message box (with a depth choice: quick 2–5 min, standard 5–15 min, deep 15–30 min) or `/research [quick|standard|deep] <question>`. Sending starts the run (`set_research { action: "start", question, depth }`) instead of a normal message; the toggle then turns itself off. Not available with attachments, while a goal or another run exists, or while the agent is answering. The depth last chosen is remembered.
- **Telegram and Zalo:** `/research [quick|standard|deep] <question>` in the owner's own private chat only.
- Not in scheduled runs (nobody can confirm a plan), not for helpers, and not in chats other people talk in.

## What happens

1. **Planning.** The agent frames the question (reader and decision, hypotheses, query type, search axes, a counter-evidence search; a comparison builds an items × fields matrix) and calls `research_plan`.
2. **Plan card.** The plan shows as Markdown above the questions (window, phone, Telegram and Zalo alike): up to two clarifying questions, the depth, and "Start with this plan?" with _Start_ (recommended), _Narrow the scope_, _Go broader_; the person can type changes. Anything but _Start_ makes the agent revise and ask again; skipping (or no answer in 10 minutes in a chat) pauses the run.
3. **Researching.** Rounds of one `delegate_task` call each (up to 5 helpers; **8 at deep depth**), with the helper instructions from `research_guide`. After each round the agent lists what is answered, missing, contradictory or stale and stops, or sends gap-only tasks; quick 1 round, standard up to 2, deep up to 3. It records what it cites with `research_sources` (numbered in order, one per URL); the pages the lead and the helpers opened are counted as **visited**.
4. **Triangulation and critique.** Key claims get a confidence (high, medium, low, contested). A draft is saved with `research_report` (`final: false`); standard critiques it itself, deep sends four red-team helpers (skeptic, contrarian, gap hunter, reader) to read the saved draft. One targeted extra round fixes critical gaps.
5. **Report.** `research_report` with `final: true` saves the final report and ends the run. The chat gets a 5–10 line summary with the main citations and the report's path.

## Progress and results

| Where                                           | Shows                                                                                                                                                                                    |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Banner above the message box (window and phone) | Phase, pages visited, sources cited; Pause, Resume, Stop; **Open report** when done. On the phone, tapping it opens the sources list.                                                    |
| Desktop side panel, **Research** tab            | **Sources** (live: number, title, publisher, date, type, link) and **Report** (the saved Markdown rendered, with a source toggle and the `.html` behind **Run**, as in the Files panel). |
| Phone                                           | A report sheet (the report text comes through `get_research_report`; the phone cannot read the workspace) and the sources sheet.                                                         |
| Telegram                                        | The status message while it works, the plan with buttons, then the summary and the `.md` and `.html` as documents.                                                                       |
| Zalo                                            | The plan as text (reply with a number or your changes), then the summary and where the report is saved on the computer (Zalo bots cannot send files).                                    |

## Files and approvals

- The report is written by the app, not by the model's `write` tool, so it **asks no approval**. It goes only to `research/<topic>-<YYYY-MM-DD>.md` (and `.html`) inside the workspace folder, as new files: later saves of the same run replace those files only, and a name that belongs to something else gets `-2`, `-3`… The path is resolved with `realpath` and refused through a link that leads out of the workspace. Markdown at most 300 KB, HTML at most 256 KB.
- The four research tools (`research_plan`, `research_sources`, `research_report`, `research_guide`) are read tier with a locked `allow` policy, exist only while a run is active, and cannot be switched off in Settings. Helpers keep their read-only tools; nothing else changes data.

## State

- Per conversation, kept in memory and saved on the branch as a `pp-agent-research` custom entry (only while the conversation is idle). A reopened conversation shows an unfinished run **paused** (Resume carries on); a finished run stays, with its sources and report paths, until cleared. At most one of a goal and a research run per conversation.
- The host starts every turn after the first with a hidden message until the final report is saved. A turn that ends in an error or is stopped pauses the run; a turn with no tool call, or a question left unanswered, waits for the person; a turn cap (60, 15 for quick) pauses with an error so a model that never finishes cannot loop. In a chat, the loop runs inside `ChannelGateway.runResearch`.
- Deep research uses many more model calls than a chat; there is no token budget, only Stop.
