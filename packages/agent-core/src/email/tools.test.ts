import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import type { EmailAccountSettings } from "@workspace/shared";
import type { MailBody, MailSession, MailSummary, OutgoingMail } from "./client.ts";
import {
  EMAIL_ACCOUNTS_TOOL,
  EMAIL_ATTACHMENT_TOOL,
  EMAIL_READ_TOOL,
  EMAIL_REPLY_TOOL,
  EMAIL_SEARCH_TOOL,
  EMAIL_SEND_TOOL,
} from "./names.ts";
import { createEmailTools } from "./tools.ts";

const work: EmailAccountSettings = {
  name: "work",
  label: "Công việc",
  address: "nhat@monback.app",
  imap: { host: "imap.zoho.com", port: 993, secure: true },
  smtp: { host: "smtp.zoho.com", port: 465, secure: true },
};
const personal = { ...work, name: "personal", label: "Cá nhân", address: "nhat@gmail.com" };

const summary: MailSummary = {
  uid: 42,
  subject: "Hoá đơn tháng 11",
  from: [{ name: "Kế toán", address: "ketoan@monback.app" }],
  date: "2026-11-09T08:00:00.000Z",
  seen: false,
  size: 20_480,
};

const body: MailBody = {
  uid: 42,
  subject: "Hoá đơn tháng 11",
  from: [{ address: "ketoan@monback.app" }],
  to: [{ address: "nhat@monback.app" }],
  cc: [],
  date: "2026-11-09T08:00:00.000Z",
  text: "Đính kèm hoá đơn.",
  attachments: [{ index: 0, filename: "hoa-don.pdf", contentType: "application/pdf", size: 1024 }],
  messageId: "<abc@monback.app>",
};

/** A mailbox that records what the tools asked for and answers from the constants above. */
function fakeSession(calls: { sent: OutgoingMail[]; searched: unknown[] }): MailSession {
  return {
    folders: async () => [{ path: "INBOX", name: "INBOX", specialUse: "\\Inbox" }],
    search: async (query) => {
      calls.searched.push(query);
      return [summary];
    },
    read: async () => body,
    mark: async () => undefined,
    move: async () => undefined,
    attachment: async () => ({
      filename: "hoa-don.pdf",
      contentType: "application/pdf",
      content: Buffer.from("%PDF-1.4"),
    }),
    send: async (mail) => {
      calls.sent.push(mail);
    },
    close: async () => undefined,
  };
}

let workspace: string;
let calls: { sent: OutgoingMail[]; searched: unknown[] };

function tools(accounts: EmailAccountSettings[] = [work]) {
  return Object.fromEntries(
    createEmailTools({
      accounts: () => accounts,
      password: async () => "app-password",
      workspaceDir: workspace,
      open: async () => fakeSession(calls),
    }).map((tool) => [tool.name, tool]),
  );
}

async function run(tool: { execute: (...args: never[]) => Promise<unknown> }, params: unknown) {
  const result = (await (tool.execute as (...args: unknown[]) => Promise<unknown>)(
    "call",
    params,
    undefined,
    undefined,
    undefined,
  )) as { content: { type: string; text: string }[] };
  return result.content.map((part) => part.text).join("\n");
}

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "pp-email-tools-"));
  calls = { sent: [], searched: [] };
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe("email tools", () => {
  test("lists the mailboxes, and asks which one when there are several", async () => {
    const list = tools([work, personal]);
    expect(await run(list[EMAIL_ACCOUNTS_TOOL]!, {})).toContain("nhat@gmail.com");
    await expect(run(list[EMAIL_SEARCH_TOOL]!, {})).rejects.toThrow(/Công việc, Cá nhân/);
    await expect(run(list[EMAIL_SEARCH_TOOL]!, { account: "personal" })).resolves.toContain("42");
    // A label works as well as the name.
    await expect(run(list[EMAIL_SEARCH_TOOL]!, { account: "Cá nhân" })).resolves.toContain("42");
    await expect(run(list[EMAIL_SEARCH_TOOL]!, { account: "nope" })).rejects.toThrow();
  });

  test("search passes the filters through and marks unread mail", async () => {
    await run(tools()[EMAIL_SEARCH_TOOL]!, {
      query: "hoá đơn",
      from: "ketoan@",
      since: "2026-11-01",
      unseen: true,
      limit: 5,
    });
    expect(calls.searched[0]).toEqual({
      folder: "INBOX",
      text: "hoá đơn",
      from: "ketoan@",
      since: "2026-11-01",
      unseen: true,
      limit: 5,
    });
  });

  test("read shows the headers, the text and the attachments", async () => {
    const text = await run(tools()[EMAIL_READ_TOOL]!, { uid: 42 });
    expect(text).toContain("From: ketoan@monback.app");
    expect(text).toContain("Đính kèm hoá đơn.");
    expect(text).toContain("[0] hoa-don.pdf (application/pdf, 1 KB)");
  });

  test("send carries recipients, subject, text and workspace attachments", async () => {
    writeFileSync(join(workspace, "bao-cao.pdf"), "%PDF");
    await run(tools()[EMAIL_SEND_TOOL]!, {
      to: ["a@x.vn"],
      cc: ["b@x.vn"],
      subject: "Báo cáo",
      body: "Kính gửi anh/chị.",
      attachments: ["bao-cao.pdf"],
    });
    expect(calls.sent[0]).toMatchObject({
      to: ["a@x.vn"],
      cc: ["b@x.vn"],
      subject: "Báo cáo",
      text: "Kính gửi anh/chị.",
    });
    expect(calls.sent[0]?.attachments?.[0]).toMatchObject({ filename: "bao-cao.pdf" });
  });

  test("an attachment outside the workspace is refused", async () => {
    await expect(
      run(tools()[EMAIL_SEND_TOOL]!, {
        to: ["a@x.vn"],
        subject: "x",
        body: "y",
        attachments: ["../outside.pdf"],
      }),
    ).rejects.toThrow(/outside the workspace/);
    expect(calls.sent).toHaveLength(0);
  });

  test("a reply answers the sender, prefixes Re: and threads under the original", async () => {
    await run(tools()[EMAIL_REPLY_TOOL]!, { uid: 42, body: "Cảm ơn chị." });
    expect(calls.sent[0]).toMatchObject({
      to: ["ketoan@monback.app"],
      subject: "Re: Hoá đơn tháng 11",
      text: "Cảm ơn chị.",
      inReplyTo: "<abc@monback.app>",
      references: ["<abc@monback.app>"],
    });
    expect(calls.sent[0]?.cc).toBeUndefined();
  });

  test("saving an attachment writes it into the workspace", async () => {
    const text = await run(tools()[EMAIL_ATTACHMENT_TOOL]!, { uid: 42, index: 0 });
    expect(text).toContain("attachments/hoa-don.pdf");
    expect(readFileSync(join(workspace, "attachments", "hoa-don.pdf"), "utf8")).toBe("%PDF-1.4");
    await expect(
      run(tools()[EMAIL_ATTACHMENT_TOOL]!, { uid: 42, index: 0, path: "/tmp/escape.pdf" }),
    ).rejects.toThrow(/outside the workspace/);
  });
});
