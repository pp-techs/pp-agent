---
title: Data on your computer
description: Where PP Agent keeps conversations, documents, and settings; how to back up, move, or delete them.
---

## Workspace folder

By default, PP Agent works in a **PP Agent** folder inside **Documents**. Attachments, reports, and generated documents are kept there.

Each assistant can have its own folder.

## Settings and history

Settings, conversations, and security details live in the app’s data folder:

| Computer | Location                                        |
| -------- | ----------------------------------------------- |
| Mac      | `~/Library/Application Support/PP Agent`        |
| Windows  | `%APPDATA%\PP Agent`                            |
| Linux    | `~/.config/PP Agent`                            |

You do not need to open this folder for everyday work.

## Back up

- Back up the workspace folder to keep your documents.
- Back up the data folder to keep conversation history and settings.
- Encrypted sign-in details may not move to another computer. If they do not, sign in to the AI service again.

## Move to a new computer

1. Install PP Agent on the new computer.
2. Quit the app on both computers.
3. Copy the workspace folder and the data folder across.
4. Open the app; if asked, sign in to the AI service again.

## Delete data

Quitting the app does not delete anything. To remove your data, delete the workspace folder and the data folder. To remove the encryption key too, ask IT to clear its entry in the computer’s secure storage.

:::note[For IT]
Use `PP_AGENT_HOME` to change the data location. On a server or in Docker, set `PP_AGENT_MASTER_KEY` so the key does not depend on the desktop keychain. Details are in the
[technical documentation](https://github.com/pp-techs/pp-agent/blob/main/docs/architecture/data-storage.md).
:::

Related: [Safety and privacy](/docs/security-and-privacy/),
[Install PP Agent](/docs/install/).
