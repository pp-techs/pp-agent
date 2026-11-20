import { describe, expect, it } from "vite-plus/test";
import {
  cookieFromFileEntry,
  dropDeviceBound,
  isDeviceBoundCookie,
  parseCookieFile,
  undecryptableWarning,
} from "./file-import.ts";
import type { PortableCookie } from "./portable.ts";

const cookie = (domain: string, name: string): PortableCookie => ({
  domain,
  hostOnly: false,
  name,
  value: "v",
  path: "/",
  secure: true,
  httpOnly: false,
  sameSite: "lax",
  expires: null,
});

describe("device-bound Google cookies", () => {
  it("recognises the source-bound names on google.com and its subdomains only", () => {
    expect(isDeviceBoundCookie({ domain: ".google.com", name: "SIDCC" })).toBe(true);
    expect(isDeviceBoundCookie({ domain: "accounts.google.com", name: "AEC" })).toBe(true);
    expect(isDeviceBoundCookie({ domain: ".google.com", name: "SID" })).toBe(false);
    expect(isDeviceBoundCookie({ domain: ".notgoogle.com", name: "SIDCC" })).toBe(false);
    expect(isDeviceBoundCookie({ domain: ".youtube.com", name: "AEC" })).toBe(false);
  });

  it("drops them and counts them", () => {
    const result = dropDeviceBound([
      cookie(".google.com", "SIDCC"),
      cookie(".google.com", "SID"),
      cookie(".example.com", "AEC"),
    ]);
    expect(result.notTransplantable).toBe(1);
    expect(result.cookies.map((entry) => entry.name)).toEqual(["SID", "AEC"]);
  });
});

describe("undecryptableWarning", () => {
  it("blames app-bound encryption when such cookies were found", () => {
    expect(undecryptableWarning(5, 5)).toEqual({
      reason: "app-bound-encryption",
      failedCookies: 5,
    });
  });
  it("says unknown for other failures, and nothing when all was readable", () => {
    expect(undecryptableWarning(3, 0)).toEqual({ reason: "unknown", failedCookies: 3 });
    expect(undecryptableWarning(0, 0)).toBeUndefined();
  });
});

describe("cookie files", () => {
  it("reads an exported cookie entry", () => {
    expect(
      cookieFromFileEntry({
        domain: ".example.com",
        name: "a",
        value: "b",
        path: "/x",
        secure: true,
        httpOnly: 1,
        sameSite: "None",
        expirationDate: 1900000000.5,
      }),
    ).toEqual({
      domain: ".example.com",
      hostOnly: false,
      name: "a",
      value: "b",
      path: "/x",
      secure: true,
      httpOnly: true,
      sameSite: "no_restriction",
      expires: 1900000000,
    });
  });

  it("rejects entries without a domain, a name or a text value", () => {
    expect(cookieFromFileEntry({ name: "a", value: "b" })).toBeNull();
    expect(cookieFromFileEntry({ domain: "x.com", value: "b" })).toBeNull();
    expect(cookieFromFileEntry({ domain: "x.com", name: "a", value: 1 })).toBeNull();
    expect(cookieFromFileEntry(null)).toBeNull();
  });

  it("parses a file and counts the entries it cannot use", () => {
    const text = JSON.stringify([{ domain: "x.com", name: "a", value: "b" }, { name: "bad" }, 7]);
    const result = parseCookieFile(text);
    expect(result).toMatchObject({ ok: true, skipped: 2 });
    expect(result.ok && result.cookies).toHaveLength(1);
  });

  it("explains why a file cannot be used", () => {
    expect(parseCookieFile("nope")).toEqual({ ok: false, reason: "invalid-json" });
    expect(parseCookieFile("{}")).toEqual({ ok: false, reason: "not-array" });
    expect(parseCookieFile("[]")).toEqual({ ok: false, reason: "empty" });
    expect(parseCookieFile('[{"a":1}]')).toEqual({ ok: false, reason: "no-valid-cookies" });
  });
});
