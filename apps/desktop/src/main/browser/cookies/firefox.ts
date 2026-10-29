import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { CookieSourceProfile } from "@workspace/shared";
import { readDatabaseCopy } from "./database.ts";
import { fromFirefoxExpiry, fromFirefoxSameSite, type PortableCookie } from "./portable.ts";

/** Folders that may hold Firefox's `profiles.ini` on this computer. */
function firefoxRoots(): string[] {
  const home = homedir();
  if (process.platform === "darwin")
    return [join(home, "Library", "Application Support", "Firefox")];
  if (process.platform === "win32")
    return process.env.APPDATA ? [join(process.env.APPDATA, "Mozilla", "Firefox")] : [];
  return [
    join(home, ".mozilla", "firefox"),
    join(home, "snap", "firefox", "common", ".mozilla", "firefox"),
  ];
}

export interface IniProfile {
  name: string;
  path: string;
  isRelative: boolean;
}

/** The `[ProfileN]` sections of `profiles.ini`. */
export function parseProfilesIni(text: string): IniProfile[] {
  const profiles: IniProfile[] = [];
  let current: Partial<IniProfile> | null = null;
  const flush = () => {
    if (current?.path) {
      profiles.push({
        name: current.name || current.path,
        path: current.path,
        isRelative: current.isRelative !== false,
      });
    }
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const section = /^\[(.+)\]$/.exec(line);
    if (section) {
      flush();
      current = /^Profile\d+$/.test(section[1]) ? {} : null;
      continue;
    }
    if (!current) continue;
    const separator = line.indexOf("=");
    if (separator === -1) continue;
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (key === "Name") current.name = value;
    else if (key === "Path") current.path = value;
    else if (key === "IsRelative") current.isRelative = value !== "0";
  }
  flush();
  return profiles;
}

interface FirefoxProfile extends CookieSourceProfile {
  dir: string;
}

/**
 * Profiles with a cookie database. The id is the profile's folder as `profiles.ini` names it, and
 * an import looks it up again here, so a path from the renderer is never used as is.
 */
export async function listFirefoxProfiles(): Promise<FirefoxProfile[]> {
  const profiles: FirefoxProfile[] = [];
  for (const root of firefoxRoots()) {
    const text = await readFile(join(root, "profiles.ini"), "utf8").catch(() => null);
    if (text === null) continue;
    for (const entry of parseProfilesIni(text)) {
      const dir = entry.isRelative || !isAbsolute(entry.path) ? join(root, entry.path) : entry.path;
      if (!existsSync(join(dir, "cookies.sqlite"))) continue;
      profiles.push({ id: entry.path, name: entry.name, dir });
    }
  }
  return profiles.sort((a, b) => a.name.localeCompare(b.name));
}

interface FirefoxRow {
  host: string;
  name: string;
  value: string;
  path: string;
  expiry: number;
  isSecure: number;
  isHttpOnly: number;
  sameSite: number;
  originAttributes: string;
}

/**
 * Firefox stores cookies unencrypted. Cookies of containers and private windows carry
 * `originAttributes`; only the ordinary ones are taken.
 */
export async function readFirefoxCookies(profileDir: string): Promise<PortableCookie[]> {
  return readDatabaseCopy(join(profileDir, "cookies.sqlite"), (db) => {
    const rows = db
      .prepare(
        "SELECT host, name, value, path, expiry, isSecure, isHttpOnly, sameSite, originAttributes FROM moz_cookies",
      )
      .all() as unknown as FirefoxRow[];
    return rows
      .filter((row) => !row.originAttributes)
      .map((row) => ({
        domain: row.host,
        hostOnly: !row.host.startsWith("."),
        name: row.name,
        value: row.value,
        path: row.path || "/",
        secure: row.isSecure === 1,
        httpOnly: row.isHttpOnly === 1,
        sameSite: fromFirefoxSameSite(row.sameSite),
        expires: fromFirefoxExpiry(row.expiry),
      }));
  });
}
