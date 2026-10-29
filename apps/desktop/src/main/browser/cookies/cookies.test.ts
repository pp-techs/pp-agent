import { createCipheriv, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  decryptChromiumValue,
  macKey,
  profilesFromLocalState,
  readChromiumCookies,
} from "./chromium.ts";
import { fromCdpCookie } from "./chromium-cdp.ts";
import { parseProfilesIni, readFirefoxCookies } from "./firefox.ts";
import {
  fromChromiumSameSite,
  fromChromiumSeconds,
  fromFirefoxExpiry,
  type PortableCookie,
  toElectronCookie,
} from "./portable.ts";

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pp-agent-cookie-test-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** What Chromium on macOS writes: "v10" + AES-128-CBC with an IV of 16 spaces. */
function encryptMac(plain: Buffer, key: Buffer): Buffer {
  const cipher = createCipheriv("aes-128-cbc", key, Buffer.alloc(16, 0x20));
  return Buffer.concat([Buffer.from("v10"), cipher.update(plain), cipher.final()]);
}

/** What Chromium on Windows writes: "v10" + 12-byte nonce + AES-256-GCM text + 16-byte tag. */
function encryptWindows(plain: Buffer, key: Buffer): Buffer {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const text = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([Buffer.from("v10"), nonce, text, cipher.getAuthTag()]);
}

describe("Chromium times and flags", () => {
  it("converts seconds since 1601 to epoch seconds", () => {
    // 2030-01-01T00:00:00Z
    expect(fromChromiumSeconds(1_893_456_000 + 11_644_473_600)).toBe(1_893_456_000);
    expect(fromChromiumSeconds(0)).toBeNull();
  });

  it("maps SameSite", () => {
    expect([-1, 0, 1, 2].map(fromChromiumSameSite)).toEqual([
      "unspecified",
      "no_restriction",
      "lax",
      "strict",
    ]);
  });
});

describe("decryptChromiumValue", () => {
  it("decrypts macOS values", () => {
    const key = macKey("peanuts");
    const result = decryptChromiumValue(
      encryptMac(Buffer.from("secret"), key),
      key,
      "darwin",
      false,
    );
    expect(result).toEqual({ value: "secret" });
  });

  it("drops the host hash newer databases put in front", () => {
    const key = macKey("peanuts");
    const plain = Buffer.concat([randomBytes(32), Buffer.from("secret")]);
    expect(decryptChromiumValue(encryptMac(plain, key), key, "darwin", true)).toEqual({
      value: "secret",
    });
  });

  it("decrypts Windows values", () => {
    const key = randomBytes(32);
    const encrypted = encryptWindows(Buffer.from("token=1"), key);
    expect(decryptChromiumValue(encrypted, key, "win32", false)).toEqual({ value: "token=1" });
  });

  it("reports app-bound values and fails on a wrong key", () => {
    expect(decryptChromiumValue(Buffer.from("v20abc"), randomBytes(32), "win32", false)).toEqual({
      appBound: true,
    });
    const encrypted = encryptWindows(Buffer.from("x"), randomBytes(32));
    expect(decryptChromiumValue(encrypted, randomBytes(32), "win32", false)).toBeNull();
  });
});

it("reads profile names from Local State", () => {
  expect(
    profilesFromLocalState({
      profile: { info_cache: { Default: { name: "Work" }, "Profile 1": {} } },
    }),
  ).toEqual([
    { id: "Default", name: "Work" },
    { id: "Profile 1", name: "Profile 1" },
  ]);
  expect(profilesFromLocalState({})).toEqual([]);
});

it("reads a Chromium cookie database", async () => {
  const dir = tempDir();
  const file = join(dir, "Cookies");
  const key = macKey("peanuts");
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE meta (key TEXT, value TEXT);
    INSERT INTO meta VALUES ('version', '24');
    CREATE TABLE cookies (host_key TEXT, name TEXT, value TEXT, encrypted_value BLOB, path TEXT,
      expires_utc INTEGER, is_secure INTEGER, is_httponly INTEGER, samesite INTEGER,
      has_expires INTEGER);`);
  const insert = db.prepare("INSERT INTO cookies VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  const expires = (1_893_456_000 + 11_644_473_600) * 1_000_000;
  const encrypted = encryptMac(Buffer.concat([randomBytes(32), Buffer.from("abc")]), key);
  insert.run(".example.com", "sid", "", encrypted, "/", expires, 1, 1, 0, 1);
  insert.run("app.example.com", "plain", "visible", null, "/x", 0, 0, 0, -1, 0);
  insert.run("bad.example.com", "broken", "", Buffer.from("v10garbage"), "/", 0, 0, 0, 1, 0);
  db.close();

  const read = await readChromiumCookies(file, key, "darwin");
  expect(read.unreadable).toBe(1);
  expect(read.cookies).toEqual([
    {
      domain: ".example.com",
      hostOnly: false,
      name: "sid",
      value: "abc",
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "no_restriction",
      expires: 1_893_456_000,
    },
    {
      domain: "app.example.com",
      hostOnly: true,
      name: "plain",
      value: "visible",
      path: "/x",
      secure: false,
      httpOnly: false,
      sameSite: "unspecified",
      expires: null,
    },
  ]);
});

describe("Firefox", () => {
  it("parses profiles.ini", () => {
    const ini = [
      "[General]",
      "StartWithLastProfile=1",
      "",
      "[Profile1]",
      "Name=work",
      "IsRelative=0",
      "Path=/Users/me/ff-work",
      "",
      "[Profile0]",
      "Name=default-release",
      "IsRelative=1",
      "Path=Profiles/abc.default-release",
      "",
      "[Install4F96D1932A9F858E]",
      "Default=Profiles/abc.default-release",
    ].join("\r\n");
    expect(parseProfilesIni(ini)).toEqual([
      { name: "work", path: "/Users/me/ff-work", isRelative: false },
      { name: "default-release", path: "Profiles/abc.default-release", isRelative: true },
    ]);
  });

  it("reads expiry in seconds or milliseconds", () => {
    expect(fromFirefoxExpiry(1_893_456_000)).toBe(1_893_456_000);
    expect(fromFirefoxExpiry(1_893_456_000_000)).toBe(1_893_456_000);
    expect(fromFirefoxExpiry(0)).toBeNull();
  });

  it("reads ordinary cookies and skips container ones", async () => {
    const dir = tempDir();
    const db = new DatabaseSync(join(dir, "cookies.sqlite"));
    db.exec(`CREATE TABLE moz_cookies (host TEXT, name TEXT, value TEXT, path TEXT, expiry INTEGER,
      isSecure INTEGER, isHttpOnly INTEGER, sameSite INTEGER, originAttributes TEXT);`);
    const insert = db.prepare("INSERT INTO moz_cookies VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    insert.run(".github.com", "user", "me", "/", 1_893_456_000, 1, 1, 1, "");
    insert.run(".github.com", "user", "other", "/", 1_893_456_000, 1, 1, 1, "^userContextId=1");
    db.close();
    expect(await readFirefoxCookies(dir)).toEqual([
      {
        domain: ".github.com",
        hostOnly: false,
        name: "user",
        value: "me",
        path: "/",
        secure: true,
        httpOnly: true,
        sameSite: "lax",
        expires: 1_893_456_000,
      },
    ]);
  });
});

it("maps DevTools protocol cookies", () => {
  expect(
    fromCdpCookie({
      name: "a",
      value: "b",
      domain: "example.com",
      path: "/",
      expires: -1,
      httpOnly: false,
      secure: true,
      session: true,
      sameSite: "None",
    }),
  ).toMatchObject({ hostOnly: true, sameSite: "no_restriction", expires: null });
});

describe("toElectronCookie", () => {
  const base: PortableCookie = {
    domain: ".example.com",
    hostOnly: false,
    name: "sid",
    value: "1",
    path: "/",
    secure: true,
    httpOnly: true,
    sameSite: "lax",
    expires: 2_000,
  };

  it("keeps the domain of a domain cookie and drops it for a host-only one", () => {
    expect(toElectronCookie(base, 1_000)).toMatchObject({
      url: "https://example.com/",
      domain: ".example.com",
      expirationDate: 2_000,
    });
    const hostOnly = toElectronCookie(
      { ...base, domain: "app.example.com", hostOnly: true },
      1_000,
    );
    expect(hostOnly?.domain).toBeUndefined();
    expect(hostOnly?.url).toBe("https://app.example.com/");
  });

  it("skips expired cookies", () => {
    expect(toElectronCookie(base, 3_000)).toBeNull();
  });

  it("falls back from SameSite=None on an insecure cookie", () => {
    const cookie = toElectronCookie({ ...base, secure: false, sameSite: "no_restriction" }, 0);
    expect(cookie).toMatchObject({ url: "http://example.com/", sameSite: "unspecified" });
  });
});
