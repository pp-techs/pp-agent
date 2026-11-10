import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { EmailAccountSettings } from "@workspace/shared";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { t } from "../i18n.ts";
import { isInside, realpathOfExistingPart } from "../office/files.ts";
import {
  type MailAddress,
  type MailBody,
  type MailSession,
  type MailSummary,
  openMailSession,
} from "./client.ts";
import {
  EMAIL_ACCOUNTS_TOOL,
  EMAIL_ATTACHMENT_TOOL,
  EMAIL_FOLDERS_TOOL,
  EMAIL_MARK_TOOL,
  EMAIL_MOVE_TOOL,
  EMAIL_READ_TOOL,
  EMAIL_REPLY_TOOL,
  EMAIL_SEARCH_TOOL,
  EMAIL_SEND_TOOL,
} from "./names.ts";

/** Longest body the model is given, in characters. */
const MAX_BODY = 20_000;
/** Most messages one search returns. */
const MAX_RESULTS = 50;
const DEFAULT_RESULTS = 20;
/** Most an email may carry in attachments, in bytes. */
const MAX_ATTACHMENTS_BYTES = 20 * 1024 * 1024;
const MAX_ATTACHMENTS = 10;

export interface EmailToolsOptions {
  /** The mailboxes from `email.json`, in file order. */
  accounts: () => EmailAccountSettings[];
  /** The password kept in the vault for `name`; null when there is none. */
  password: (name: string) => Promise<string | null>;
  /** Attachments are saved inside this folder and read only from it. */
  workspaceDir: string;
  /** How a session is opened; tests pass a fake mailbox. */
  open?: (account: EmailAccountSettings, password: string) => Promise<MailSession>;
}

function who(list: MailAddress[]) {
  return list.map((address) =>
    address.name ? `${address.name} <${address.address}>` : address.address,
  );
}

function line(summary: MailSummary, folder: string) {
  const date = summary.date?.slice(0, 16).replace("T", " ") ?? "?";
  const size = summary.size === undefined ? "" : ` · ${Math.round(summary.size / 1024)} KB`;
  const seen = summary.seen ? "" : " · unread";
  return `${folder}#${summary.uid} · ${date} · ${who(summary.from).join(", ") || "?"} · ${summary.subject || "(no subject)"}${seen}${size}`;
}

function body(message: MailBody, maxChars: number) {
  const text = message.text.trim();
  const clipped =
    text.length > maxChars
      ? `${text.slice(0, maxChars)}\n\n[The rest of this message is cut here; it is ${text.length} characters.]`
      : text;
  const attachments = message.attachments.map(
    (attachment) =>
      `- [${attachment.index}] ${attachment.filename} (${attachment.contentType}, ${Math.round(attachment.size / 1024)} KB)`,
  );
  return [
    `From: ${who(message.from).join(", ") || "?"}`,
    `To: ${who(message.to).join(", ") || "?"}`,
    ...(message.cc.length > 0 ? [`Cc: ${who(message.cc).join(", ")}`] : []),
    `Date: ${message.date ?? "?"}`,
    `Subject: ${message.subject || "(no subject)"}`,
    "",
    clipped || "(no text; the message may hold only HTML that could not be read)",
    ...(attachments.length > 0 ? ["", "Attachments:", ...attachments] : []),
  ].join("\n");
}

function text(value: string) {
  return { content: [{ type: "text" as const, text: value }], details: undefined };
}

/**
 * Tools that read a mailbox over IMAP and send through SMTP, one mailbox of `email.json` per
 * account. The password comes from the vault at call time, so a changed password needs no reload;
 * the socket is closed after every call, so an idle agent holds no connection open.
 */
export function createEmailTools(options: EmailToolsOptions) {
  const open = options.open ?? openMailSession;

  function resolveAccount(requested?: string): EmailAccountSettings {
    const accounts = options.accounts();
    if (accounts.length === 0) throw new Error(t("email.noAccounts"));
    if (requested) {
      const wanted = requested.trim().toLowerCase();
      const found = accounts.find(
        (account) =>
          account.name.toLowerCase() === wanted ||
          account.label?.toLowerCase() === wanted ||
          account.address.toLowerCase() === wanted,
      );
      if (!found)
        throw new Error(t("email.accountUnknown", { name: requested, names: labels(accounts) }));
      return found;
    }
    if (accounts.length === 1) return accounts[0]!;
    throw new Error(t("email.chooseAccount", { names: labels(accounts) }));
  }

  async function withSession<T>(
    account: EmailAccountSettings,
    run: (mail: MailSession) => Promise<T>,
  ) {
    const password = await options.password(account.name);
    if (!password) throw new Error(t("email.passwordMissing", { name: labelOf(account) }));
    const session = await open(account, password);
    try {
      return await run(session);
    } finally {
      await session.close().catch(() => undefined);
    }
  }

  const accountParam = Type.Optional(
    Type.String({
      description:
        "Which mailbox (its name or label), when more than one is set up. Leave out with one.",
    }),
  );
  const folderParam = Type.Optional(
    Type.String({
      description: "IMAP folder path, such as INBOX or INBOX/Receipts. INBOX by default.",
    }),
  );

  const accounts = defineTool({
    name: EMAIL_ACCOUNTS_TOOL,
    label: "Mailboxes",
    description:
      "Lists the mailboxes the agent may read and send from, with the name to use in other email tools.",
    promptSnippet: "List the mailboxes the agent may use",
    parameters: Type.Object({}),
    async execute() {
      const list = options.accounts();
      if (list.length === 0) return text(t("email.noAccounts"));
      return text(
        list
          .map(
            (account) =>
              `${account.name}${account.label ? ` (“${account.label}”)` : ""} · ${account.address}`,
          )
          .join("\n"),
      );
    },
  });

  const folders = defineTool({
    name: EMAIL_FOLDERS_TOOL,
    label: "Mail folders",
    description:
      "Lists the folders of a mailbox (INBOX, Sent, Archive, …), with the server's special-use label.",
    promptSnippet: "List mail folders",
    parameters: Type.Object({ account: accountParam }),
    async execute(_id, params) {
      const account = resolveAccount(params.account);
      const list = await withSession(account, (mail) => mail.folders());
      if (list.length === 0) return text(t("email.noFolders", { name: labelOf(account) }));
      return text(
        list
          .map((folder) => `${folder.path}${folder.specialUse ? ` (${folder.specialUse})` : ""}`)
          .join("\n"),
      );
    },
  });

  const search = defineTool({
    name: EMAIL_SEARCH_TOOL,
    label: "Search mail",
    description:
      "Finds messages in one folder, newest first. `query` matches any text (sender, subject, body); narrow it with from, subject, since and before (ISO dates). Returns one line per message with its uid for email_read.",
    promptSnippet: "Search a mailbox",
    parameters: Type.Object({
      account: accountParam,
      folder: folderParam,
      query: Type.Optional(
        Type.String({ description: "Text to look for anywhere in the message." }),
      ),
      from: Type.Optional(Type.String({ description: "Only messages from this address or name." })),
      subject: Type.Optional(
        Type.String({ description: "Only messages whose subject holds this text." }),
      ),
      since: Type.Optional(
        Type.String({ description: "Received on or after this date (YYYY-MM-DD)." }),
      ),
      before: Type.Optional(
        Type.String({ description: "Received before this date (YYYY-MM-DD)." }),
      ),
      unseen: Type.Optional(
        Type.Boolean({ description: "Only messages that have not been read." }),
      ),
      limit: Type.Optional(
        Type.Integer({
          minimum: 1,
          maximum: MAX_RESULTS,
          description: "How many to return (20 by default).",
        }),
      ),
    }),
    async execute(_id, params) {
      const account = resolveAccount(params.account);
      const folder = params.folder?.trim() || "INBOX";
      const found = await withSession(account, (mail) =>
        mail.search({
          folder,
          ...(params.query ? { text: params.query } : {}),
          ...(params.from ? { from: params.from } : {}),
          ...(params.subject ? { subject: params.subject } : {}),
          ...(params.since ? { since: params.since } : {}),
          ...(params.before ? { before: params.before } : {}),
          ...(params.unseen ? { unseen: true } : {}),
          limit: Math.min(params.limit ?? DEFAULT_RESULTS, MAX_RESULTS),
        }),
      );
      if (found.length === 0) return text(t("email.noMatches", { folder }));
      return text(
        `${labelOf(account)} · ${folder}\n${found.map((summary) => line(summary, folder)).join("\n")}`,
      );
    },
  });

  const read = defineTool({
    name: EMAIL_READ_TOOL,
    label: "Read mail",
    description:
      "Reads one message by its uid: sender, recipients, date, subject, the text, and the attachments it holds (with the index email_save_attachment takes).",
    promptSnippet: "Read one message",
    parameters: Type.Object({
      account: accountParam,
      folder: folderParam,
      uid: Type.Integer({ minimum: 1, description: "The uid from email_search." }),
      maxChars: Type.Optional(
        Type.Integer({
          minimum: 500,
          maximum: MAX_BODY,
          description: "How much of the text to show (20000 by default).",
        }),
      ),
    }),
    async execute(_id, params) {
      const account = resolveAccount(params.account);
      const folder = params.folder?.trim() || "INBOX";
      const message = await withSession(account, (mail) => mail.read(params.uid, folder));
      return text(body(message, Math.min(params.maxChars ?? MAX_BODY, MAX_BODY)));
    },
  });

  const send = defineTool({
    name: EMAIL_SEND_TOOL,
    label: "Send mail",
    description:
      "Sends a message from the mailbox. Ask the person before sending unless they asked for this message to be sent. Attachments must be files inside the workspace folder.",
    promptSnippet: "Send an email",
    promptGuidelines: [
      "- Before email_send or email_reply, show the person the recipients, subject and text and send only after they agree, unless they already told you to send it.",
      "- Write the body as plain text, in the language the person asked for; do not add a signature the mailbox already adds.",
    ],
    parameters: Type.Object({
      account: accountParam,
      to: Type.Array(Type.String({ description: "Address, or “Name <address>”." }), {
        minItems: 1,
        description: "Recipients.",
      }),
      cc: Type.Optional(Type.Array(Type.String())),
      bcc: Type.Optional(Type.Array(Type.String())),
      subject: Type.String({ description: "Subject line." }),
      body: Type.String({ description: "The message, as plain text." }),
      html: Type.Optional(
        Type.String({ description: "The same message as HTML, when formatting matters." }),
      ),
      attachments: Type.Optional(
        Type.Array(Type.String({ description: "File path inside the workspace." }), {
          maxItems: MAX_ATTACHMENTS,
        }),
      ),
    }),
    async execute(_id, params) {
      const account = resolveAccount(params.account);
      const attachments = params.attachments?.length
        ? await readAttachments(options.workspaceDir, params.attachments)
        : undefined;
      await withSession(account, (mail) =>
        mail.send({
          to: params.to,
          ...(params.cc?.length ? { cc: params.cc } : {}),
          ...(params.bcc?.length ? { bcc: params.bcc } : {}),
          subject: params.subject,
          text: params.body,
          ...(params.html ? { html: params.html } : {}),
          ...(attachments ? { attachments } : {}),
        }),
      );
      return text(
        t("email.sent", {
          to: params.to.join(", "),
          subject: params.subject,
          name: labelOf(account),
        }),
      );
    },
  });

  const reply = defineTool({
    name: EMAIL_REPLY_TOOL,
    label: "Reply to mail",
    description:
      "Replies to a message by its uid: the sender becomes the recipient (with `all`, the other recipients too), the subject gets “Re:”, and the reply is threaded under the original. Ask the person before sending.",
    promptSnippet: "Reply to a message",
    parameters: Type.Object({
      account: accountParam,
      folder: folderParam,
      uid: Type.Integer({ minimum: 1, description: "The uid from email_search or email_read." }),
      body: Type.String({ description: "The reply, as plain text." }),
      html: Type.Optional(Type.String({ description: "The same reply as HTML." })),
      all: Type.Optional(
        Type.Boolean({ description: "Reply to every recipient of the original." }),
      ),
    }),
    async execute(_id, params) {
      const account = resolveAccount(params.account);
      const folder = params.folder?.trim() || "INBOX";
      const original = await withSession(account, (mail) => mail.read(params.uid, folder));
      const sender = original.from[0]?.address;
      if (!sender) throw new Error(t("email.noSender", { uid: params.uid }));
      const others = params.all
        ? [...original.to, ...original.cc]
            .map((address) => address.address)
            .filter((address) => address !== account.address && address !== sender)
        : [];
      await withSession(account, (mail) =>
        mail.send({
          to: [sender],
          ...(others.length > 0 ? { cc: [...new Set(others)] } : {}),
          subject: original.subject.toLowerCase().startsWith("re:")
            ? original.subject
            : `Re: ${original.subject}`,
          text: params.body,
          ...(params.html ? { html: params.html } : {}),
          ...(original.messageId
            ? { inReplyTo: original.messageId, references: [original.messageId] }
            : {}),
        }),
      );
      return text(
        t("email.sent", {
          to: sender,
          subject: original.subject,
          name: labelOf(account),
        }),
      );
    },
  });

  const mark = defineTool({
    name: EMAIL_MARK_TOOL,
    label: "Mark mail",
    description: "Marks messages as read or unread, or flags them (starred) or clears the flag.",
    promptSnippet: "Mark messages read or flagged",
    parameters: Type.Object({
      account: accountParam,
      folder: folderParam,
      uids: Type.Array(Type.Integer({ minimum: 1 }), {
        minItems: 1,
        description: "Uids from email_search.",
      }),
      seen: Type.Optional(Type.Boolean({ description: "true marks read, false marks unread." })),
      flagged: Type.Optional(Type.Boolean({ description: "true stars, false clears the star." })),
    }),
    async execute(_id, params) {
      if (params.seen === undefined && params.flagged === undefined)
        throw new Error(t("email.markNothing"));
      const account = resolveAccount(params.account);
      const folder = params.folder?.trim() || "INBOX";
      await withSession(account, (mail) =>
        mail.mark(params.uids, folder, {
          ...(params.seen !== undefined ? { seen: params.seen } : {}),
          ...(params.flagged !== undefined ? { flagged: params.flagged } : {}),
        }),
      );
      return text(t("email.marked", { count: params.uids.length, folder }));
    },
  });

  const move = defineTool({
    name: EMAIL_MOVE_TOOL,
    label: "Move mail",
    description:
      "Moves messages to another folder of the same mailbox (INBOX → Archive, Trash, or a folder from email_folders).",
    promptSnippet: "Move messages between folders",
    parameters: Type.Object({
      account: accountParam,
      folder: folderParam,
      uids: Type.Array(Type.Integer({ minimum: 1 }), { minItems: 1 }),
      to: Type.String({ description: "Destination folder path, from email_folders." }),
    }),
    async execute(_id, params) {
      const account = resolveAccount(params.account);
      const folder = params.folder?.trim() || "INBOX";
      const to = params.to.trim();
      await withSession(account, (mail) => mail.move(params.uids, folder, to));
      return text(t("email.moved", { count: params.uids.length, to }));
    },
  });

  const attachment = defineTool({
    name: EMAIL_ATTACHMENT_TOOL,
    label: "Save attachment",
    description:
      "Saves one attachment of a message into the workspace folder, so it can be read or sent on. `index` comes from email_read; `path` defaults to a folder named after the attachment.",
    promptSnippet: "Save an email attachment into the workspace",
    parameters: Type.Object({
      account: accountParam,
      folder: folderParam,
      uid: Type.Integer({ minimum: 1 }),
      index: Type.Integer({ minimum: 0, description: "The attachment's index from email_read." }),
      path: Type.Optional(
        Type.String({
          description: "Where to save it, inside the workspace; “attachments/<name>” by default.",
        }),
      ),
    }),
    async execute(_id, params) {
      const account = resolveAccount(params.account);
      const folder = params.folder?.trim() || "INBOX";
      const saved = await withSession(account, (mail) =>
        mail.attachment(params.uid, folder, params.index),
      );
      const target = params.path?.trim()
        ? await resolveInWorkspace(options.workspaceDir, params.path.trim())
        : await resolveInWorkspace(
            options.workspaceDir,
            `attachments/${basename(saved.filename).replace(/[/\\]/g, "_")}`,
          );
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, saved.content);
      return text(
        t("email.saved", {
          name: saved.filename,
          path: relative(options.workspaceDir, target).split(sep).join("/"),
        }),
      );
    },
  });

  return [accounts, folders, search, read, send, reply, mark, move, attachment];
}

function labelOf(account: EmailAccountSettings) {
  return account.label ?? account.address;
}

function labels(accounts: EmailAccountSettings[]) {
  return accounts.map(labelOf).join(", ");
}

/** Resolves a path that must stay inside the workspace, following symbolic links. */
async function resolveInWorkspace(workspace: string, path: string): Promise<string> {
  const root = resolve(workspace);
  const absolute = isAbsolute(path) ? resolve(path) : resolve(root, path);
  if (!isInside(root, absolute)) throw new Error(t("email.attachmentOutside", { path }));
  if (!isInside(await realpath(root), await realpathOfExistingPart(absolute)))
    throw new Error(t("email.attachmentOutside", { path }));
  return absolute;
}

async function readAttachments(workspace: string, paths: string[]) {
  let total = 0;
  const files: { filename: string; content: Buffer }[] = [];
  for (const path of paths) {
    const absolute = await resolveInWorkspace(workspace, path);
    const content = await readFile(absolute);
    total += content.byteLength;
    if (total > MAX_ATTACHMENTS_BYTES) throw new Error(t("email.attachmentsTooLarge"));
    files.push({ filename: basename(absolute), content });
  }
  return files;
}
