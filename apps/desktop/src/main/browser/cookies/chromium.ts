import { createDecipheriv, pbkdf2Sync } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CookieSourceBrowser, CookieSourceProfile } from "@workspace/shared";
import { readDatabaseCopy, run } from "./database.ts";
import { fromChromiumSameSite, fromChromiumSeconds, type PortableCookie } from "./portable.ts";

/** Where a Chromium-based browser keeps its profiles, and how it protects its cookies. */
export interface ChromiumBrowser {
  browser: CookieSourceBrowser;
  /** User data folder under `~/Library/Application Support` (macOS). */
  mac?: string;
  /** User data folder under `%LOCALAPPDATA%` (Windows). */
  win?: string;
  /** Keychain item holding the cookie password (macOS). */
  keychain: string;
  /** The browser's program under Program Files or `%LOCALAPPDATA%` (Windows). */
  exe?: string;
}

export const CHROMIUM_BROWSERS: ChromiumBrowser[] = [
  {
    browser: "chrome",
    mac: "Google/Chrome",
    win: "Google/Chrome/User Data",
    keychain: "Chrome Safe Storage",
    exe: "Google/Chrome/Application/chrome.exe",
  },
  {
    browser: "edge",
    mac: "Microsoft Edge",
    win: "Microsoft/Edge/User Data",
    keychain: "Microsoft Edge Safe Storage",
    exe: "Microsoft/Edge/Application/msedge.exe",
  },
  {
    browser: "brave",
    mac: "BraveSoftware/Brave-Browser",
    win: "BraveSoftware/Brave-Browser/User Data",
    keychain: "Brave Safe Storage",
    exe: "BraveSoftware/Brave-Browser/Application/brave.exe",
  },
  { browser: "arc", mac: "Arc/User Data", keychain: "Arc Safe Storage" },
  {
    browser: "chromium",
    mac: "Chromium",
    win: "Chromium/User Data",
    keychain: "Chromium Safe Storage",
    exe: "Chromium/Application/chrome.exe",
  },
];

/** The browser's user data folder on this computer; null where it does not run or is missing. */
export function userDataDir(definition: ChromiumBrowser): string | null {
  let dir: string | null = null;
  if (process.platform === "darwin" && definition.mac)
    dir = join(homedir(), "Library", "Application Support", definition.mac);
  else if (process.platform === "win32" && definition.win && process.env.LOCALAPPDATA)
    dir = join(process.env.LOCALAPPDATA, definition.win);
  return dir && existsSync(dir) ? dir : null;
}

/** Installed copy of the browser's program (Windows), for reading cookies through the browser. */
export function browserExecutable(definition: ChromiumBrowser): string | null {
  if (process.platform !== "win32" || !definition.exe) return null;
  const roots = [
    process.env.PROGRAMFILES,
    process.env["PROGRAMFILES(X86)"],
    process.env.LOCALAPPDATA,
  ];
  for (const root of roots) {
    if (!root) continue;
    const candidate = join(root, definition.exe);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** The cookie database of a profile: newer versions keep it in `Network/`. */
export function cookieFile(userData: string, profileDir: string): string | null {
  for (const file of [
    join(userData, profileDir, "Network", "Cookies"),
    join(userData, profileDir, "Cookies"),
  ]) {
    if (existsSync(file)) return file;
  }
  return null;
}

async function readLocalState(userData: string): Promise<Record<string, unknown>> {
  try {
    const raw: unknown = JSON.parse(await readFile(join(userData, "Local State"), "utf8"));
    return typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Profiles named in `Local State` (`profile.info_cache`): folder name and the name people see. */
export function profilesFromLocalState(localState: Record<string, unknown>): CookieSourceProfile[] {
  const profile = localState.profile as { info_cache?: unknown } | undefined;
  const cache = profile?.info_cache;
  if (typeof cache !== "object" || cache === null) return [];
  return Object.entries(cache as Record<string, unknown>).map(([id, info]) => {
    const name = (info as { name?: unknown } | null)?.name;
    return { id, name: typeof name === "string" && name.trim() ? name : id };
  });
}

export async function listChromiumProfiles(
  definition: ChromiumBrowser,
): Promise<CookieSourceProfile[]> {
  const userData = userDataDir(definition);
  if (!userData) return [];
  let profiles = profilesFromLocalState(await readLocalState(userData));
  if (profiles.length === 0) profiles = [{ id: "Default", name: "Default" }];
  return profiles
    .filter((profile) => cookieFile(userData, profile.id) !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------------------------
// Keys and decryption
// ---------------------------------------------------------------------------------------------

/** macOS: AES-128-CBC with a key derived from the password the browser keeps in the Keychain. */
export function macKey(password: string): Buffer {
  return pbkdf2Sync(password, "saltysalt", 1003, 16, "sha1");
}

/** Asks the Keychain for the browser's cookie password; macOS asks the person to allow it. */
export async function readMacPassword(service: string): Promise<string> {
  return (await run("security", ["find-generic-password", "-w", "-s", service])).trim();
}

/**
 * Windows: the AES-256-GCM key in `Local State`, protected with DPAPI for the signed-in user.
 * PowerShell unprotects it, so no native module is needed.
 */
export async function readWindowsKey(userData: string): Promise<Buffer> {
  const osCrypt = (await readLocalState(userData)).os_crypt as
    | { encrypted_key?: unknown }
    | undefined;
  if (typeof osCrypt?.encrypted_key !== "string") throw new Error("Local State has no cookie key.");
  const protectedKey = Buffer.from(osCrypt.encrypted_key, "base64");
  if (protectedKey.subarray(0, 5).toString() !== "DPAPI")
    throw new Error("Unknown cookie key format.");
  const script = [
    "Add-Type -AssemblyName System.Security",
    "$bytes = [Convert]::FromBase64String([Console]::In.ReadToEnd())",
    "$plain = [Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, 'CurrentUser')",
    "[Convert]::ToBase64String($plain)",
  ].join("; ");
  const output = await run(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    protectedKey.subarray(5).toString("base64"),
  );
  return Buffer.from(output.trim(), "base64");
}

export type DecryptResult = { value: string } | { appBound: true } | null;

/**
 * Decrypts one `encrypted_value`. Database version 24 and later prefix the plain text with the
 * SHA-256 of the cookie's host, which is dropped. `v20` values (Windows app-bound encryption) can
 * only be read by the browser itself; null means unreadable.
 */
export function decryptChromiumValue(
  encrypted: Uint8Array,
  key: Buffer,
  platform: "darwin" | "win32",
  hostPrefix: boolean,
): DecryptResult {
  const data = Buffer.from(encrypted);
  const version = data.subarray(0, 3).toString();
  if (version === "v20") return { appBound: true };
  if (version !== "v10" && version !== "v11") return null;
  try {
    let plain: Buffer;
    if (platform === "darwin") {
      const decipher = createDecipheriv("aes-128-cbc", key, Buffer.alloc(16, 0x20));
      plain = Buffer.concat([decipher.update(data.subarray(3)), decipher.final()]);
    } else {
      const nonce = data.subarray(3, 15);
      const tag = data.subarray(data.length - 16);
      const decipher = createDecipheriv("aes-256-gcm", key, nonce);
      decipher.setAuthTag(tag);
      plain = Buffer.concat([
        decipher.update(data.subarray(15, data.length - 16)),
        decipher.final(),
      ]);
    }
    return { value: (hostPrefix ? plain.subarray(32) : plain).toString("utf8") };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------------

interface CookieRow {
  host_key: string;
  name: string;
  value: string;
  encrypted_value: Uint8Array | null;
  path: string;
  /** `expires_utc` in whole seconds. */
  expires_seconds: number;
  is_secure: number;
  is_httponly: number;
  samesite: number;
  has_expires?: number;
}

export interface ChromiumRead {
  cookies: PortableCookie[];
  unreadable: number;
  /** Values only the browser itself can decrypt (Windows app-bound encryption). */
  appBound: number;
}

export async function readChromiumCookies(
  file: string,
  key: Buffer,
  platform: "darwin" | "win32",
): Promise<ChromiumRead> {
  return readDatabaseCopy(file, (db) => {
    const meta = db.prepare("SELECT value FROM meta WHERE key = 'version'").get() as
      | { value: string | number }
      | undefined;
    const hostPrefix = Number(meta?.value ?? 0) >= 24;
    const rows = db
      .prepare(
        "SELECT host_key, name, value, encrypted_value, path, expires_utc / 1000000 AS expires_seconds, is_secure, is_httponly, samesite, has_expires FROM cookies",
      )
      .all() as unknown as CookieRow[];
    const result: ChromiumRead = { cookies: [], unreadable: 0, appBound: 0 };
    for (const row of rows) {
      let value = row.value;
      if (!value && row.encrypted_value && row.encrypted_value.length > 0) {
        const decrypted = decryptChromiumValue(row.encrypted_value, key, platform, hostPrefix);
        if (decrypted === null) {
          result.unreadable += 1;
          continue;
        }
        if ("appBound" in decrypted) {
          result.appBound += 1;
          continue;
        }
        value = decrypted.value;
      }
      result.cookies.push({
        domain: row.host_key,
        hostOnly: !row.host_key.startsWith("."),
        name: row.name,
        value,
        path: row.path || "/",
        secure: row.is_secure === 1,
        httpOnly: row.is_httponly === 1,
        sameSite: fromChromiumSameSite(row.samesite),
        expires: row.has_expires === 0 ? null : fromChromiumSeconds(row.expires_seconds),
      });
    }
    return result;
  });
}
