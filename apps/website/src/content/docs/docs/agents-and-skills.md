---
title: Assistants and skills
description: Create an assistant for each kind of work, switch when needed, and use ready-made skills.
---

An **assistant** is the “person” you talk to in PP Agent. Each assistant is prepared for one kind of work.

## What an assistant carries

- A friendly name and description.
- Its own instructions, such as “always answer briefly in Vietnamese”.
- The software and tools it may use.
- Its own document folder.
- Suggested starter questions.

A finance assistant sees finance documents; a support assistant sees only what it needs for customer work.

## Create an assistant

1. Open **Settings › Agents**.
2. Choose **New assistant**.
3. Give it a name and write instructions in plain language.
4. Pick its tools, folder, and starter questions.
5. Save it, then select it from the top bar.

You can switch assistants mid-conversation. The history stays; the instructions and tools change with the new assistant.

## What is a skill?

A skill is a ready-made process for one job, such as your company’s report format. Use it with `/skill:<name>`, or let the assistant choose it when it fits.

Your IT team can install more skills for each team.

## Common commands

| Command     | What it does                              |
| ----------- | ----------------------------------------- |
| `/new`      | Start a new conversation                  |
| `/compact`  | Summarize the conversation to keep it short |
| `/goal`     | Keep working until a job is finished      |
| `/research` | Research a question and return sources    |
| `/yolo`     | Stop asking for tools that are already allowed |

Type `/` in the message box to see the list.

:::caution[An assistant does not change permissions]
An assistant only sees the tools it is given, but an enabled tool still follows its approval rules. See
[Permissions and approvals](/docs/tools-and-approvals/).
:::
