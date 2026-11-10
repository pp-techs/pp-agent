import type { EmailAccountSettings } from "@workspace/shared";
import { t } from "../i18n.ts";
import { ImapFlow } from "imapflow";
import type { AddressObject, ParsedMail } from "mailparser";
import { simpleParser } from "mailparser";
import { createTransport } from "nodemailer";

/** One address in a `From`, `To` or `Cc` header. */
export interface MailAddress {
  name?: string;
  address: string;
}

export interface MailFolder {
  path: string;
  name: string;
  specialUse?: string;
}

export interface MailQuery {
  folder: string;
  /** Any text in headers or body. */
  text?: string;
  from?: string;
  subject?: string;
  /** ISO dates: received on or after `since`, before `before`. */
  since?: string;
  before?: string;
  /** Only unread messages. */
  unseen?: boolean;
  /** Newest first, at most this many; the caller clamps it. */
  limit: number;
}

export interface MailSummary {
  uid: number;
  subject: string;
  from: MailAddress[];
  date?: string;
  seen: boolean;
  /** Bytes, from the server. */
  size?: number;
}

export interface MailAttachment {
  /** Position in `mail_read`'s list, used to save it. */
  index: number;
  filename: string;
  contentType: string;
  size: number;
}

export interface MailBody {
  uid: number;
  subject: string;
  from: MailAddress[];
  to: MailAddress[];
  cc: MailAddress[];
  date?: string;
  /** Plain text, from the message or converted from its HTML. */
  text: string;
  attachments: MailAttachment[];
  messageId?: string;
}

export interface OutgoingMail {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text?: string;
  html?: string;
  inReplyTo?: string;
  references?: string[];
  attachments?: { filename: string; content: Buffer; contentType?: string }[];
}

/** What the email tools need from a mailbox; the real one is an IMAP and an SMTP connection. */
export interface MailSession {
  folders(): Promise<MailFolder[]>;
  search(query: MailQuery): Promise<MailSummary[]>;
  read(uid: number, folder: string): Promise<MailBody>;
  mark(uids: number[], folder: string, flags: { seen?: boolean; flagged?: boolean }): Promise<void>;
  move(uids: number[], folder: string, to: string): Promise<void>;
  attachment(
    uid: number,
    folder: string,
    index: number,
  ): Promise<{ filename: string; contentType: string; content: Buffer }>;
  send(mail: OutgoingMail): Promise<void>;
  close(): Promise<void>;
}

/** The parts of an IMAP envelope this app reads. */
interface Envelope {
  subject?: string;
  date?: Date;
  from?: { address?: string; name?: string }[];
  to?: { address?: string; name?: string }[];
  cc?: { address?: string; name?: string }[];
}

function addresses(list: unknown): MailAddress[] {
  if (!Array.isArray(list)) return [];
  return list.flatMap((entry) => {
    const value = entry as { address?: unknown; name?: unknown };
    if (typeof value?.address !== "string") return [];
    return [
      {
        address: value.address,
        ...(typeof value.name === "string" && value.name !== "" ? { name: value.name } : {}),
      },
    ];
  });
}

/** A parsed header (`To`, `Cc`) as addresses; mailparser can return one object or a list. */
function parsedAddresses(value: AddressObject | AddressObject[] | undefined): MailAddress[] {
  if (!value) return [];
  const objects = Array.isArray(value) ? value : [value];
  return objects.flatMap((object) => addresses(object.value));
}

function iso(date: unknown): string | undefined {
  const value = date instanceof Date ? date : typeof date === "string" ? new Date(date) : null;
  return value && !Number.isNaN(value.getTime()) ? value.toISOString() : undefined;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** IMAP servers say little ("Command failed"); the refused password is the useful part. */
function imapMessage(host: string, error: unknown): string {
  const detail = error as { authenticationFailed?: boolean; responseText?: string };
  if (detail?.authenticationFailed)
    return t("email.imapRefused", {
      host,
      reason: detail.responseText?.trim() || message(error),
    });
  return `${host}: ${message(error)}`;
}

/** Sign-in names: the account's own, unless a server needs another. */
function usersOf(account: EmailAccountSettings) {
  return {
    imap: account.imap.user ?? account.address,
    smtp: account.smtp.user ?? account.address,
  };
}

function transportOf(account: EmailAccountSettings, password: string) {
  return createTransport({
    host: account.smtp.host,
    port: account.smtp.port,
    // TLS from the start on 465; a server on 587 upgrades with STARTTLS.
    secure: account.smtp.secure,
    requireTLS: !account.smtp.secure,
    auth: { user: usersOf(account).smtp, pass: password },
    tls: { minVersion: "TLSv1.2" },
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 60_000,
  });
}

/**
 * A mailbox over IMAP: one connection per session, closed by `close()`. Each call selects its
 * folder under a mailbox lock, so two calls on one session can never read another's folder.
 */
class ImapSession implements MailSession {
  private readonly client: ImapFlow;
  private readonly outgoing: ReturnType<typeof transportOf>;
  private readonly from: string;

  constructor(account: EmailAccountSettings, password: string) {
    const imapUser = usersOf(account).imap;
    this.client = new ImapFlow({
      host: account.imap.host,
      port: account.imap.port,
      secure: account.imap.secure,
      auth: { user: imapUser, pass: password },
      // IMAP servers log every command when this is on.
      logger: false,
      tls: { minVersion: "TLSv1.2" },
      connectionTimeout: 20_000,
      greetingTimeout: 20_000,
      socketTimeout: 120_000,
    });
    this.outgoing = transportOf(account, password);
    this.from = account.displayName
      ? `${account.displayName} <${account.address}>`
      : account.address;
  }

  /** Connects and authenticates, so a wrong password fails before any tool does work. */
  async open(): Promise<this> {
    await this.client.connect();
    return this;
  }

  async folders(): Promise<MailFolder[]> {
    const list = await this.client.list();
    return list.map((folder) => ({
      path: folder.path,
      name: folder.name,
      ...(typeof folder.specialUse === "string" ? { specialUse: folder.specialUse } : {}),
    }));
  }

  async search(query: MailQuery): Promise<MailSummary[]> {
    const lock = await this.client.getMailboxLock(query.folder);
    try {
      const uids = await this.client.search(
        {
          ...(query.text ? { text: query.text } : {}),
          ...(query.from ? { from: query.from } : {}),
          ...(query.subject ? { subject: query.subject } : {}),
          ...(query.since ? { since: query.since } : {}),
          ...(query.before ? { before: query.before } : {}),
          ...(query.unseen ? { seen: false } : {}),
        },
        { uid: true },
      );
      if (!Array.isArray(uids) || uids.length === 0) return [];
      const newest = uids.slice(-query.limit).reverse();
      const found: MailSummary[] = [];
      for (const uid of newest) {
        const fetched = await this.client.fetchOne(
          String(uid),
          { envelope: true, flags: true, size: true },
          { uid: true },
        );
        if (!fetched) continue;
        const envelope = (fetched.envelope ?? {}) as Envelope;
        const date = iso(envelope.date);
        found.push({
          uid,
          subject: envelope.subject ?? "",
          from: addresses(envelope.from),
          ...(date ? { date } : {}),
          seen: fetched.flags?.has("\\Seen") ?? false,
          ...(typeof fetched.size === "number" ? { size: fetched.size } : {}),
        });
      }
      return found;
    } finally {
      lock.release();
    }
  }

  private async parse(uid: number, folder: string): Promise<ParsedMail> {
    const lock = await this.client.getMailboxLock(folder);
    try {
      const fetched = await this.client.fetchOne(String(uid), { source: true }, { uid: true });
      if (fetched === false || !fetched.source)
        throw new Error(`Message ${uid} is no longer in ${folder}.`);
      return await simpleParser(fetched.source);
    } finally {
      lock.release();
    }
  }

  async read(uid: number, folder: string): Promise<MailBody> {
    const parsed = await this.parse(uid, folder);
    const date = iso(parsed.date);
    return {
      uid,
      subject: parsed.subject ?? "",
      from: parsedAddresses(parsed.from),
      to: parsedAddresses(parsed.to),
      cc: parsedAddresses(parsed.cc),
      ...(date ? { date } : {}),
      text: parsed.text ?? "",
      attachments: parsed.attachments.map((attachment, index) => ({
        index,
        filename: attachment.filename ?? `attachment-${index + 1}`,
        contentType: attachment.contentType,
        size: attachment.size,
      })),
      ...(parsed.messageId ? { messageId: parsed.messageId } : {}),
    };
  }

  async mark(
    uids: number[],
    folder: string,
    flags: { seen?: boolean; flagged?: boolean },
  ): Promise<void> {
    const lock = await this.client.getMailboxLock(folder);
    try {
      const range = uids.join(",");
      for (const [flag, wanted] of [
        ["\\Seen", flags.seen],
        ["\\Flagged", flags.flagged],
      ] as const) {
        if (wanted === undefined) continue;
        if (wanted) await this.client.messageFlagsAdd(range, [flag], { uid: true });
        else await this.client.messageFlagsRemove(range, [flag], { uid: true });
      }
    } finally {
      lock.release();
    }
  }

  async move(uids: number[], folder: string, to: string): Promise<void> {
    const lock = await this.client.getMailboxLock(folder);
    try {
      const moved = await this.client.messageMove(uids.join(","), to, { uid: true });
      if (moved === false) throw new Error(`The server did not move the message to ${to}.`);
    } finally {
      lock.release();
    }
  }

  async attachment(uid: number, folder: string, index: number) {
    const parsed = await this.parse(uid, folder);
    const attachment = parsed.attachments[index];
    if (!attachment)
      throw new Error(
        `Message ${uid} has no attachment ${index}; it has ${parsed.attachments.length}.`,
      );
    return {
      filename: attachment.filename ?? `attachment-${index + 1}`,
      contentType: attachment.contentType,
      content: attachment.content,
    };
  }

  async send(mail: OutgoingMail): Promise<void> {
    await this.outgoing.sendMail({
      from: this.from,
      to: mail.to,
      ...(mail.cc ? { cc: mail.cc } : {}),
      ...(mail.bcc ? { bcc: mail.bcc } : {}),
      subject: mail.subject,
      ...(mail.text ? { text: mail.text } : {}),
      ...(mail.html ? { html: mail.html } : {}),
      ...(mail.inReplyTo ? { inReplyTo: mail.inReplyTo } : {}),
      ...(mail.references ? { references: mail.references } : {}),
      ...(mail.attachments
        ? {
            attachments: mail.attachments.map((attachment) => ({
              filename: attachment.filename,
              content: attachment.content,
              ...(attachment.contentType ? { contentType: attachment.contentType } : {}),
            })),
          }
        : {}),
    });
  }

  async close(): Promise<void> {
    this.outgoing.close();
    await this.client.logout().catch(() => undefined);
  }
}

/**
 * Signs in to `account` and returns a session the caller must `close()`. A refused sign-in throws
 * with the server's own message and the host it came from.
 */
export async function openMailSession(
  account: EmailAccountSettings,
  password: string,
): Promise<MailSession> {
  const session = new ImapSession(account, password);
  try {
    return await session.open();
  } catch (error) {
    await session.close();
    throw new Error(imapMessage(account.imap.host, error));
  }
}

/**
 * Checks that the password works for both servers: signs in to IMAP, and asks SMTP whether it
 * would accept the same sign-in. Throws with the server's message when either refuses.
 */
export async function testMailAccount(
  account: EmailAccountSettings,
  password: string,
): Promise<void> {
  const transport = transportOf(account, password);
  try {
    await transport.verify();
  } catch (error) {
    throw new Error(t("email.smtpRefused", { host: account.smtp.host, reason: message(error) }));
  } finally {
    transport.close();
  }
  const session = await openMailSession(account, password);
  await session.close();
}
