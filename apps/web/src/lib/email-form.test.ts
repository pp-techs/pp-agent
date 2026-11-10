import { describe, expect, test } from "vite-plus/test";

import { draftOf, emailAccountFromDraft, emailAccountName, withProvider } from "./email-form";

describe("email form", () => {
  test("switching the provider fills in its servers and keeps the address", () => {
    const draft = withProvider(draftOf(), "zoho");
    expect(draft.address).toBe("");
    expect(draft.imapHost).toBe("imap.zoho.com");
    expect(draft.smtpHost).toBe("smtp.zoho.com");
    expect(draft.imapPort).toBe("993");
    const outlook = withProvider({ ...draft, address: "a@b.c" }, "outlook");
    expect(outlook.address).toBe("a@b.c");
    expect(outlook.smtpPort).toBe("587");
    expect(outlook.smtpSecure).toBe(false);
  });

  test("a saved account keeps its provider when it has that provider's servers", () => {
    const zoho = emailAccountFromDraft(
      { ...withProvider(draftOf(), "zoho"), address: "nhat@monback.app" },
      "work",
    );
    if ("error" in zoho) throw new Error(zoho.error);
    expect(draftOf(zoho.account).provider).toBe("zoho");
    const other = { ...zoho.account, smtp: { ...zoho.account.smtp, host: "mail.example.com" } };
    expect(draftOf(other).provider).toBe("custom");
  });

  test("the name comes from the address and never clashes", () => {
    expect(emailAccountName("nhat@monback.app", [])).toBe("nhat");
    expect(emailAccountName("Nhật.Bùi@x.vn", [])).toBe("nhat-bui");
    expect(emailAccountName("@", [])).toBe("mail");
    expect(emailAccountName("nhat@x.vn", ["nhat"])).toBe("nhat-2");
    expect(emailAccountName("nhat@x.vn", ["nhat", "nhat-2"])).toBe("nhat-3");
  });

  test("a draft names what is missing before anything is saved", () => {
    const empty = draftOf();
    expect(emailAccountFromDraft(empty, "mail")).toEqual({ error: "address" });
    const base = withProvider({ ...empty, address: "nhat@monback.app" }, "zoho");
    const good = emailAccountFromDraft({ ...base, password: "x" }, "nhat");
    if ("error" in good) throw new Error(good.error);
    expect(good.account).toEqual({
      name: "nhat",
      address: "nhat@monback.app",
      imap: { host: "imap.zoho.com", port: 993, secure: true },
      smtp: { host: "smtp.zoho.com", port: 465, secure: true },
    });
    expect(emailAccountFromDraft({ ...base, imapHost: " " }, "nhat")).toEqual({ error: "imap" });
    expect(emailAccountFromDraft({ ...base, smtpPort: "0" }, "nhat")).toEqual({ error: "port" });
  });
});
