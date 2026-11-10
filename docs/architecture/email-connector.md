# Email connector (IMAP and SMTP)

The agent reads, searches, sends and files mail in a mailbox the person configures, over the
mailbox's own IMAP and SMTP servers. It is a set of built-in tools (`email_*`), not an MCP server,
because the password must stay on the computer in the vault and the tools must follow the same
approval rules as the other built-in tools.

## Files

- `packages/agent-core/src/email/config.ts`: `<agentDir>/email.json` — `{ accounts: { <name>: {
  address, label?, displayName?, imap, smtp } } }`, written `0600` like `mcp.json`. No password ever
  goes in this file.
- `packages/agent-core/src/email/client.ts`: `openMailSession` (one IMAP connection per call,
  mailbox lock per operation) and `testMailAccount` (SMTP `verify()`, then an IMAP sign-in).
  `imapflow` speaks IMAP, `mailparser` turns a message source into headers, text, HTML and
  attachments, `nodemailer` sends.
- `packages/agent-core/src/email/tools.ts`: the nine tools, created per session with the workspace
  folder, so attachments are read from and written to it only.
- `packages/agent-core/src/email/names.ts`: tool names, the read/write tiers, and the vault id
  (`email:<name>`).
- `apps/web/src/components/settings/email-account-form.tsx` and `apps/web/src/lib/email-form.ts`:
  the form and its draft logic (provider presets, name from the address, validation).
- `apps/web/src/components/settings/connectors-section.tsx`: the Email card inside Connectors, next
  to the MCP presets.

## Tools

| Tool                    | Tier  | What it does                                                                |
| ----------------------- | ----- | --------------------------------------------------------------------------- |
| `email_accounts`        | read  | Lists the mailboxes and the name to use in the others                       |
| `email_folders`         | read  | Folder paths of one mailbox, with the server's special-use labels           |
| `email_search`          | read  | Newest first; text, from, subject, since, before, unseen, limit             |
| `email_read`            | read  | Headers, text (clipped), attachments with the index used to save them       |
| `email_send`            | write | Recipients, subject, text or HTML, files from the workspace as attachments  |
| `email_reply`           | write | Replies to the sender (or all), `Re:` subject, `In-Reply-To` thread headers |
| `email_mark`            | write | Read/unread and flagged                                                     |
| `email_move`            | write | Moves messages to another folder                                            |
| `email_save_attachment` | write | Writes one attachment into the workspace                                    |

`account` is optional with one mailbox and required with several; it accepts the name, the label
(“Công việc”) or the address. Approvals name the recipient and the subject
(`describeToolCall`), so sending asks with a readable card under `auto`.

## Turns

- `list_email_accounts` returns the accounts with `hasPassword` (from the vault) and the last
  sign-in failure this app saw (`test_email_account`), which the card shows.
- `save_email_account` writes `email.json`, moves the password on a rename, and stores a new one in
  the vault (`email:<name>`, an `api_key` credential). `delete_email_account` removes both.
- `test_email_account` signs in to SMTP and IMAP with the saved password and keeps the failure for
  the card. The form runs it right after saving, so a wrong app password shows up immediately.
- A phone may list the mailboxes but not change them (`REMOTE_LOCAL_ONLY_COMMANDS`).

## Providers

`EMAIL_PROVIDERS` in `packages/shared` holds the servers of Zoho Mail, Gmail, Outlook/Microsoft
365, Yahoo Mail and iCloud Mail, with the page where the person creates an app password. Most
providers refuse the account password over IMAP/SMTP; the form says so and links to that page.
`email.json` stores the resulting hosts, so a company server is just "Other" with its own host and
port.

## Limits

- One password per mailbox, used for IMAP and SMTP; a server that needs a different one for each is
  not supported yet.
- Attachments: at most 20 MB and 10 files per message, inside the workspace only.
- A message body is given to the model clipped at 20,000 characters (`maxChars`).
- Text-only reading: HTML mail is converted to text by `mailparser`; a message with no text part
  shows a note instead of the HTML.
