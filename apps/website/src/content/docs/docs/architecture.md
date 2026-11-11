---
title: How PP Agent works
description: A simple look at how PP Agent talks to you, uses AI, and works with company software.
---

PP Agent has a window for chatting and a background part that keeps working when the window is closed.

## Three parts

- **The PP Agent window:** where you chat, view documents, and approve changes.
- **The background part:** keeps long jobs, scheduled tasks, and phone messages running.
- **The connections:** the AI service, company software, and search tools set up by your IT team.

## What happens to a request?

1. You send a question or attach a document.
2. PP Agent sends the necessary content to the AI service.
3. If it needs to look something up or change something in company software, it prepares the action.
4. Anything that changes data asks you first.
5. The result comes back into the conversation and is saved on your computer.

## Why approvals matter

PP Agent can read documents and work with real company data. The approval step lets you control what gets saved or changed.

## For the IT team

Details about internal components, connections, and deployment are in the
[technical documentation](https://github.com/pp-techs/pp-agent/tree/main/docs). Everyday users do not need them.

Related: [Safety and privacy](/docs/security-and-privacy/),
[Permissions and approvals](/docs/tools-and-approvals/).
