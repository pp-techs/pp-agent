import type { CookieImportWarning } from "@workspace/shared";
import type { PortableCookie } from "./portable.ts";

/** Google sign-in cookies tied to the device that made them: copied elsewhere they only log out. */
const GOOGLE_DEVICE_BOUND_NAMES = new Set([
  "SIDCC",
  "__Secure-1PSIDCC",
  "__Secure-3PSIDCC",
  "__Secure-STRP",
  "AEC",
]);

function isGoogleHost(domain: string): boolean {
  const host = domain.replace(/^\./, "").toLowerCase();
  return host === "google.com" || host.endsWith(".google.com");
}

/** Cookies Chrome ties to the source device; importing them would only break the Google session. */
export function isDeviceBoundCookie(cookie: Pick<PortableCookie, "domain" | "name">): boolean {
  return GOOGLE_DEVICE_BOUND_NAMES.has(cookie.name) && isGoogleHost(cookie.domain);
}

/** Splits off the device-bound cookies; the rest are imported. */
export function dropDeviceBound(cookies: readonly PortableCookie[]): {
  cookies: PortableCookie[];
  notTransplantable: number;
} {
  const kept = cookies.filter((cookie) => !isDeviceBoundCookie(cookie));
  return { cookies: kept, notTransplantable: cookies.length - kept.length };
}

/**
 * The warning for cookies that could not be decrypted: `app-bound-encryption` when they are the
 * reason (Windows Chrome/Edge/Brave `v20` values only the browser can open), else `unknown`.
 */
export function undecryptableWarning(
  unreadable: number,
  appBound: number,
): CookieImportWarning | undefined {
  if (appBound > 0) return { reason: "app-bound-encryption", failedCookies: appBound };
  if (unreadable > 0) return { reason: "unknown", failedCookies: unreadable };
  return undefined;
}

function sameSite(raw: unknown): PortableCookie["sameSite"] {
  if (typeof raw === "number") {
    if (raw === 0) return "no_restriction";
    if (raw === 1) return "lax";
    if (raw === 2) return "strict";
    return "unspecified";
  }
  if (typeof raw !== "string") return "unspecified";
  const lower = raw.toLowerCase();
  if (lower === "lax") return "lax";
  if (lower === "strict") return "strict";
  if (lower === "none" || lower === "no_restriction") return "no_restriction";
  return "unspecified";
}

/** One entry of an exported cookie file, or null when it lacks a domain, a name or a text value. */
export function cookieFromFileEntry(entry: unknown): PortableCookie | null {
  if (typeof entry !== "object" || entry === null) return null;
  const raw = entry as Record<string, unknown>;
  if (typeof raw.domain !== "string" || !raw.domain.trim()) return null;
  if (typeof raw.name !== "string" || !raw.name.trim()) return null;
  if (typeof raw.value !== "string") return null;
  const domain = raw.domain.trim();
  const expiry = raw.expirationDate ?? raw.expires;
  return {
    domain,
    hostOnly: typeof raw.hostOnly === "boolean" ? raw.hostOnly : !domain.startsWith("."),
    name: raw.name.trim(),
    value: raw.value,
    path: typeof raw.path === "string" && raw.path.startsWith("/") ? raw.path : "/",
    secure: raw.secure === true || raw.secure === 1,
    httpOnly: raw.httpOnly === true || raw.httpOnly === 1,
    sameSite: sameSite(raw.sameSite),
    expires: typeof expiry === "number" && expiry > 0 ? Math.floor(expiry) : null,
  };
}

export type CookieFileParse =
  | { ok: true; cookies: PortableCookie[]; skipped: number }
  | { ok: false; reason: "invalid-json" | "not-array" | "empty" | "no-valid-cookies" };

/** One line of a Netscape `cookies.txt`: seven tab-separated fields; null for anything else. */
function cookieFromNetscapeLine(line: string): PortableCookie | null {
  let text = line.trim();
  let httpOnly = false;
  if (text.startsWith("#HttpOnly_")) {
    httpOnly = true;
    text = text.slice("#HttpOnly_".length);
  } else if (text.startsWith("#")) return null;
  const fields = text.split("\t");
  if (fields.length < 7) return null;
  const [domain, subdomains, path, secure, expires, name, ...rest] = fields as [
    string,
    string,
    string,
    string,
    string,
    string,
    ...string[],
  ];
  const expiry = Number(expires);
  return cookieFromFileEntry({
    domain,
    hostOnly: subdomains.toUpperCase() !== "TRUE",
    path,
    secure: secure.toUpperCase() === "TRUE",
    httpOnly,
    expirationDate: Number.isFinite(expiry) ? expiry : undefined,
    name,
    value: rest.join("\t"),
  });
}

function parseNetscape(text: string): CookieFileParse {
  const lines = text
    .split(/\r?\n/)
    .filter((line) => line.trim() && (!line.startsWith("#") || line.startsWith("#HttpOnly_")));
  const cookies: PortableCookie[] = [];
  for (const line of lines) {
    const cookie = cookieFromNetscapeLine(line);
    if (cookie) cookies.push(cookie);
  }
  if (cookies.length === 0) return { ok: false, reason: "invalid-json" };
  return { ok: true, cookies, skipped: lines.length - cookies.length };
}

/**
 * Reads the text of a cookie export: a JSON array of `{ domain, name, value, … }` entries (also
 * inside a `{ "cookies": [...] }` object), or a Netscape `cookies.txt`.
 */
export function parseCookieFile(text: string): CookieFileParse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return parseNetscape(text);
  }
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    !Array.isArray(parsed) &&
    Array.isArray((parsed as { cookies?: unknown }).cookies)
  ) {
    parsed = (parsed as { cookies: unknown[] }).cookies;
  }
  if (!Array.isArray(parsed)) return { ok: false, reason: "not-array" };
  if (parsed.length === 0) return { ok: false, reason: "empty" };
  const cookies: PortableCookie[] = [];
  for (const entry of parsed) {
    const cookie = cookieFromFileEntry(entry);
    if (cookie) cookies.push(cookie);
  }
  if (cookies.length === 0) return { ok: false, reason: "no-valid-cookies" };
  return { ok: true, cookies, skipped: parsed.length - cookies.length };
}
