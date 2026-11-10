import type { ToolTier } from "@workspace/shared";

/** Vault id of an account's password: `email:<name>`. */
export const EMAIL_KEY_PREFIX = "email:";

export const EMAIL_ACCOUNTS_TOOL = "email_accounts";
export const EMAIL_FOLDERS_TOOL = "email_folders";
export const EMAIL_SEARCH_TOOL = "email_search";
export const EMAIL_READ_TOOL = "email_read";
export const EMAIL_SEND_TOOL = "email_send";
export const EMAIL_REPLY_TOOL = "email_reply";
export const EMAIL_MARK_TOOL = "email_mark";
export const EMAIL_MOVE_TOOL = "email_move";
export const EMAIL_ATTACHMENT_TOOL = "email_save_attachment";

/** Every mail tool, in the order Settings lists them. */
export const EMAIL_TOOLS = [
  EMAIL_ACCOUNTS_TOOL,
  EMAIL_FOLDERS_TOOL,
  EMAIL_SEARCH_TOOL,
  EMAIL_READ_TOOL,
  EMAIL_SEND_TOOL,
  EMAIL_REPLY_TOOL,
  EMAIL_MARK_TOOL,
  EMAIL_MOVE_TOOL,
  EMAIL_ATTACHMENT_TOOL,
] as const;

export type EmailTool = (typeof EMAIL_TOOLS)[number];

/** Tools that only read the mailbox (or the saved account list). */
const READ_TOOLS: readonly string[] = [
  EMAIL_ACCOUNTS_TOOL,
  EMAIL_FOLDERS_TOOL,
  EMAIL_SEARCH_TOOL,
  EMAIL_READ_TOOL,
];

/** Reading runs on its own; sending, replying, moving, flagging and saving attachments ask under `auto`. */
export function emailToolTier(name: string): ToolTier {
  return READ_TOOLS.includes(name) ? "read" : "write";
}

/** The vault id under which an account's password is kept. */
export function emailSecretId(name: string) {
  return `${EMAIL_KEY_PREFIX}${name}`;
}
