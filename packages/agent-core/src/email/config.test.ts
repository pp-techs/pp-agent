import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import type { EmailAccountSettings } from "@workspace/shared";
import { EmailConfigFile } from "./config.ts";

let dir: string;
let config: EmailConfigFile;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pp-email-"));
  config = new EmailConfigFile(join(dir, "email.json"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const account = (overrides: Partial<EmailAccountSettings> = {}): EmailAccountSettings => ({
  name: "work",
  address: "nhat@monback.app",
  imap: { host: "imap.zoho.com", port: 993, secure: true },
  smtp: { host: "smtp.zoho.com", port: 465, secure: true },
  ...overrides,
});

describe("EmailConfigFile", () => {
  test("starts empty and saves an account without its password", () => {
    expect(config.accounts()).toEqual([]);
    config.saveAccount(undefined, account({ label: "Work", displayName: "Nhật" }));
    expect(config.accounts()).toEqual([
      {
        name: "work",
        label: "Work",
        displayName: "Nhật",
        address: "nhat@monback.app",
        imap: { host: "imap.zoho.com", port: 993, secure: true },
        smtp: { host: "smtp.zoho.com", port: 465, secure: true },
      },
    ]);
    const file = readFileSync(join(dir, "email.json"), "utf8");
    expect(file).not.toContain("password");
    expect(file).toContain("imap.zoho.com");
  });

  test("saves port and TLS per server, and a sign-in name only when given", () => {
    config.saveAccount(
      undefined,
      account({
        imap: { host: "imap.local", port: 143, secure: false, user: "nhat" },
        smtp: { host: "smtp.local", port: 587, secure: false },
      }),
    );
    const [saved] = config.accounts();
    expect(saved?.imap).toEqual({ host: "imap.local", port: 143, secure: false, user: "nhat" });
    expect(saved?.smtp).toEqual({ host: "smtp.local", port: 587, secure: false });
  });

  test("a rename keeps the account's place in the file", () => {
    config.saveAccount(undefined, account({ name: "a", address: "a@x.vn" }));
    config.saveAccount(undefined, account({ name: "b", address: "b@x.vn" }));
    config.saveAccount("a", account({ name: "aa", address: "a@x.vn" }));
    expect(config.accounts().map((item) => item.name)).toEqual(["aa", "b"]);
    expect(config.get("aa")?.address).toBe("a@x.vn");
  });

  test("refuses bad names, addresses, ports and unknown accounts", () => {
    expect(() => config.saveAccount(undefined, account({ name: "bad name" }))).toThrow();
    expect(() => config.saveAccount(undefined, account({ address: "not-an-address" }))).toThrow();
    expect(() =>
      config.saveAccount(undefined, account({ imap: { host: "imap.x", port: 0, secure: true } })),
    ).toThrow();
    expect(() => config.saveAccount("missing", account())).toThrow();
    config.saveAccount(undefined, account());
    expect(() => config.saveAccount(undefined, account())).toThrow();
    expect(() => config.deleteAccount("missing")).toThrow();
  });

  test("deletes an account and keeps the others", () => {
    config.saveAccount(undefined, account({ name: "a", address: "a@x.vn" }));
    config.saveAccount(undefined, account({ name: "b", address: "b@x.vn" }));
    config.deleteAccount("a");
    expect(config.accounts().map((item) => item.name)).toEqual(["b"]);
  });
});
