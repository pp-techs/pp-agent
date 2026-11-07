import { isIP } from "node:net";
import type { CookieSite } from "@workspace/shared";
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

/** Labels under which country domains hand out names: `example.co.uk`, `example.com.vn`. */
const SECOND_LEVEL: Record<string, true> = {
  ac: true,
  biz: true,
  co: true,
  com: true,
  edu: true,
  go: true,
  gob: true,
  gov: true,
  info: true,
  ltd: true,
  mil: true,
  ne: true,
  net: true,
  nom: true,
  or: true,
  org: true,
  plc: true,
  sch: true,
};

/**
 * The site a cookie belongs to, as the person picks it: the registered name of its host
 * (`google.com` for `.mail.google.com`, `example.co.uk` for `www.example.co.uk`). IP addresses and
 * single-label hosts are their own site. A heuristic (no public suffix list): hosting domains such
 * as `github.io` count as one site.
 */
export function cookieSite(domain: string): string {
  const host = domain.replace(/^\./, "").replace(/\.$/, "").toLowerCase();
  if (isIP(host.replace(/^\[|\]$/g, "")) !== 0 || !host.includes(".")) return host;
  const labels = host.split(".");
  const top = labels[labels.length - 1] ?? "";
  const second = labels[labels.length - 2] ?? "";
  const take =
    labels.length >= 3 && top.length === 2 && Object.hasOwn(SECOND_LEVEL, second) ? 3 : 2;
  return labels.slice(-take).join(".");
}

/** Counts cookies per site, most cookies first (then by name). */
export function groupSites(hosts: readonly { host: string; count: number }[]): CookieSite[] {
  const counts = new Map<string, number>();
  for (const { host, count } of hosts) {
    const site = cookieSite(host);
    if (site) counts.set(site, (counts.get(site) ?? 0) + count);
  }
  return [...counts]
    .map(([site, count]) => ({ site, count }))
    .sort((a, b) => b.count - a.count || a.site.localeCompare(b.site));
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
