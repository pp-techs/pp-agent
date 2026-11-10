import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { EmailAccountSettings, EmailServerSettings } from "@workspace/shared";
import { t } from "../i18n.ts";

type JsonObject = Record<string, unknown>;

const NAME = /^[A-Za-z0-9_-]+$/;

function asObject(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

/** A server as saved: host and port must be there, `secure` defaults to on. */
function readServer(value: unknown): EmailServerSettings | null {
  const object = asObject(value);
  if (!object || typeof object.host !== "string") return null;
  const server: EmailServerSettings = {
    host: object.host,
    port: typeof object.port === "number" ? object.port : 993,
    secure: object.secure !== false,
  };
  if (typeof object.user === "string" && object.user !== "") server.user = object.user;
  return server;
}

function readAccount(name: string, value: unknown): EmailAccountSettings | null {
  const object = asObject(value);
  const imap = readServer(object?.imap);
  const smtp = readServer(object?.smtp);
  if (!object || typeof object.address !== "string" || !imap || !smtp) return null;
  const account: EmailAccountSettings = { name, address: object.address, imap, smtp };
  if (typeof object.label === "string" && object.label !== "") account.label = object.label;
  if (typeof object.displayName === "string" && object.displayName !== "")
    account.displayName = object.displayName;
  return account;
}

function port(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error(t("email.badPort"));
  return value;
}

function checkServer(server: EmailServerSettings): EmailServerSettings {
  const host = server.host.trim();
  if (host === "") throw new Error(t("email.hostRequired"));
  const checked: EmailServerSettings = { host, port: port(server.port), secure: server.secure };
  const user = server.user?.trim();
  if (user) checked.user = user;
  return checked;
}

/**
 * `<agentDir>/email.json`: the mailboxes the agent may use, without their passwords (those are in
 * the vault, under `email:<name>`). Older versions have no such file.
 */
export class EmailConfigFile {
  constructor(readonly path: string) {}

  /** Accounts in file order. */
  accounts(): EmailAccountSettings[] {
    const accounts = asObject(this.read().accounts) ?? {};
    return Object.entries(accounts).flatMap(([name, value]) => {
      const account = readAccount(name, value);
      return account ? [account] : [];
    });
  }

  get(name: string): EmailAccountSettings | null {
    const value = (asObject(this.read().accounts) ?? {})[name];
    return value === undefined ? null : readAccount(name, value);
  }

  saveAccount(originalName: string | undefined, account: EmailAccountSettings): void {
    const name = account.name.trim();
    if (!NAME.test(name)) throw new Error(t("email.nameFormat"));
    const address = account.address.trim();
    if (!/^[^\s@]+@[^\s@]+$/.test(address)) throw new Error(t("email.addressInvalid"));
    const file = this.read();
    const accounts = asObject(file.accounts) ?? {};
    if (originalName !== undefined && !(originalName in accounts))
      throw new Error(t("email.accountNotFound", { name: originalName }));
    if (name !== originalName && name in accounts) throw new Error(t("email.nameTaken", { name }));

    const saved: JsonObject = { address };
    const label = account.label?.trim();
    if (label) saved.label = label;
    const displayName = account.displayName?.trim();
    if (displayName) saved.displayName = displayName;
    saved.imap = checkServer(account.imap);
    saved.smtp = checkServer(account.smtp);

    // Rebuild so a renamed account keeps its place in the file.
    const next: JsonObject = {};
    let placed = false;
    for (const [key, value] of Object.entries(accounts)) {
      if (key === originalName) {
        next[name] = saved;
        placed = true;
      } else {
        next[key] = value;
      }
    }
    if (!placed) next[name] = saved;
    this.write({ ...file, accounts: next });
  }

  deleteAccount(name: string): void {
    const file = this.read();
    const accounts = { ...asObject(file.accounts) };
    if (!(name in accounts)) throw new Error(t("email.accountNotFound", { name }));
    delete accounts[name];
    this.write({ ...file, accounts });
  }

  private read(): JsonObject {
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.path, "utf8").replace(/^\uFEFF/, ""));
      const object = asObject(parsed);
      if (!object) throw new Error(t("email.fileInvalid"));
      return object;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { accounts: {} };
      throw error instanceof SyntaxError ? new Error(t("email.fileInvalid")) : error;
    }
  }

  private write(content: JsonObject): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const temp = `${this.path}.tmp`;
    writeFileSync(temp, `${JSON.stringify(content, null, 2)}\n`, { mode: 0o600 });
    renameSync(temp, this.path);
  }
}
