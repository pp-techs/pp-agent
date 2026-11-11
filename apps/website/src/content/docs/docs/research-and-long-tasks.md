---
title: Research and long jobs
description: Hand PP Agent a multi-step job, ask for research with sources, and follow progress with a checklist.
---

Some work does not fit in one answer. PP Agent has two ways to stay with it: `/goal` for a long job and `/research` for a question that needs sources.

## Long jobs with `/goal`

Type `/goal` with what you want finished. PP Agent keeps working across turns until it is done.

- You can pause, resume, or clear the goal at any time.
- A checklist stays above the message box so you can see what is finished.
- If needed, PP Agent asks helpers to look things up in parallel.

Examples: *“Prepare the renewal packet from these contracts”* or *“Audit this spreadsheet and write down every mismatch.”*

## Research with `/research`

`/research` also works on your phone through Telegram or Zalo.

1. You ask a question.
2. PP Agent shows a plan for you to approve.
3. It reads sources and cross-checks the information.
4. You get a report with sources you can check.

Choose **quick**, **standard**, or **deep** before it starts. Deep suits complicated topics or questions with competing answers.

### What the report contains

- The question and scope you approved.
- Findings organized by part.
- Sources for the main points.
- Anything uncertain or worth a second look.

Reports are saved in the `research/` folder on your computer.

## Which one to use

| You need…                                  | Use          |
| ------------------------------------------ | ------------ |
| An answer with sources you can check       | `/research`  |
| A long, multi-step job that must finish    | `/goal`      |
| A quick answer from one document           | Just ask     |
| A job that repeats daily or weekly         | Scheduled task |

Related: [Chat and documents](/docs/chat-and-documents/),
[Scheduled tasks](/docs/scheduled-tasks/),
[Remote access and chat channels](/docs/remote-access-and-channels/).
