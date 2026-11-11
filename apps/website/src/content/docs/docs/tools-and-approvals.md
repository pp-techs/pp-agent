---
title: Permissions and approvals
description: PP Agent asks before it saves files, changes data, or uses your computer. Here is how to set permissions for each tool.
---

The simplest rule in PP Agent: **looking and reading are free; changes ask first**.

## What does not ask?

- Reading a document.
- Searching the web.
- Looking at a dashboard or list.
- Looking up data in company software.

## What asks first?

- Saving or editing a file.
- Changing data in company software.
- Clicking or typing in another app.
- Running system commands.

## Set permissions for each tool

Open **Settings › Tools** (or an assistant’s settings). Each tool has four choices:

| Choice          | What it means                                      |
| --------------- | -------------------------------------------------- |
| **Automatic**   | Do it when needed, without asking                  |
| **Always ask**  | Show the action and wait for you to agree          |
| **Always allow**| Do not ask again; treat it as already approved     |
| **Off**         | The assistant cannot use this tool                 |

If something asks too often, allow that one tool rather than turning off approvals everywhere.

## System commands

System commands are off by default. Turn them on only when they are really needed; a wrong command can delete files or damage data.

## `/yolo`

`/yolo` skips the question for things that are **already allowed**. It does not turn on tools that are off or widen an assistant’s permissions.

## Automatic runs

Scheduled tasks and messages from your phone can run when nobody is at the computer. Anything that needs approval is skipped and recorded for you to review.

## Using your computer

PP Agent can look at the screen and use other apps if you turn this on. Looking does not ask; clicking and typing always ask first. PP Agent itself, the command window, and password settings are always blocked.

Related: [Connect company software](/docs/company-software/),
[Safety and privacy](/docs/security-and-privacy/).
