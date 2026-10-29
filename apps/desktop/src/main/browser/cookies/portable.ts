import type { CookiesSetDetails } from "electron";

/**
 * A cookie as every reader produces it and every writer takes it, whatever browser it came from.
 * Electron sessions take it today; a headless Chromium driven over CDP (`Network.setCookies`) can
 * take the same list, so a profile's sign-ins can move to a future background browser.
 */
export interface PortableCookie {
  /** Host of a host-only cookie, or `.example.com` for a cookie of a domain and its subdomains. */
  domain: string;
  hostOnly: boolean;
  name: string;
  value: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: "unspecified" | "no_restriction" | "lax" | "strict";
  /** Epoch seconds; null for a cookie that ends with the browser session. */
  expires: number | null;
}

/** Seconds between 1601-01-01 (Windows FILETIME, Chromium's epoch) and 1970-01-01. */
const CHROMIUM_EPOCH_OFFSET = 11_644_473_600;

/**
 * Chromium stores expiry in microseconds since 1601 (0 for a session cookie). Those exceed what a
 * JavaScript number holds exactly, so readers divide in SQL and pass whole seconds since 1601.
 */
export function fromChromiumSeconds(seconds: number): number | null {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return Math.floor(seconds - CHROMIUM_EPOCH_OFFSET);
}

export function fromChromiumSameSite(value: number): PortableCookie["sameSite"] {
  if (value === 0) return "no_restriction";
  if (value === 1) return "lax";
  if (value === 2) return "strict";
  return "unspecified";
}

/** Firefox moved `expiry` from seconds to milliseconds; anything past year 5138 is milliseconds. */
export function fromFirefoxExpiry(value: number): number | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.floor(value > 1e11 ? value / 1000 : value);
}

export function fromFirefoxSameSite(value: number): PortableCookie["sameSite"] {
  if (value === 1) return "lax";
  if (value === 2) return "strict";
  return value === 0 ? "no_restriction" : "unspecified";
}

/**
 * The details Electron's `cookies.set` takes, or null for a cookie it cannot hold (expired, or
 * without a host). A `SameSite=None` cookie must be secure, so an insecure one falls back to the
 * browser's default.
 */
export function toElectronCookie(
  cookie: PortableCookie,
  nowSeconds: number,
): CookiesSetDetails | null {
  const host = cookie.domain.replace(/^\./, "");
  if (!host || (cookie.expires !== null && cookie.expires <= nowSeconds)) return null;
  const path = cookie.path.startsWith("/") ? cookie.path : "/";
  const details: CookiesSetDetails = {
    url: `${cookie.secure ? "https" : "http"}://${host}${path}`,
    name: cookie.name,
    value: cookie.value,
    path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite:
      cookie.sameSite === "no_restriction" && !cookie.secure ? "unspecified" : cookie.sameSite,
  };
  if (!cookie.hostOnly) details.domain = cookie.domain;
  if (cookie.expires !== null) details.expirationDate = cookie.expires;
  return details;
}
