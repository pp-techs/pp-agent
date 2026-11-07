import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

/** Schemes a side panel page may load or navigate to; everything else is refused. */
export function isWebUrl(url: string): boolean {
  if (url === "about:blank") return true;
  if (!URL.canParse(url)) return false;
  const { protocol } = new URL(url);
  return protocol === "https:" || protocol === "http:";
}

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/.*)?$/i;
/** `example.com`, `sub.example.co/path`, `10.0.0.1:8080`: a dot, no spaces. */
const HOST_LIKE = /^[^\s/?#]+\.[^\s/?#]+(:\d+)?([/?#]\S*)?$/;

/**
 * What the address bar typed means: a web address as is, a host without scheme (https, or http
 * for this computer), or else a web search.
 */
export function toAddress(input: string): string {
  const text = input.trim();
  if (!text) return "about:blank";
  if (/^https?:\/\//i.test(text) && URL.canParse(text)) return text;
  if (LOCAL_HOST.test(text)) return `http://${text}`;
  if (HOST_LIKE.test(text) && URL.canParse(`https://${text}`)) return `https://${text}`;
  return `https://www.google.com/search?q=${encodeURIComponent(text)}`;
}

/**
 * Address ranges the agent's browser tool may not take a page to: this computer, the local
 * network, cloud metadata. The same ranges `web_fetch` refuses (`packages/agent-core/src/web/fetch.ts`).
 */
const BLOCKED = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 3],
] as const)
  BLOCKED.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  // NAT64 carries an IPv4 address in disguise. IPv4-mapped forms are covered by the IPv4 rules.
  ["64:ff9b::", 96],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const)
  BLOCKED.addSubnet(network, prefix, "ipv6");

/** Whether an IP address is private, loopback, link-local, metadata or otherwise not public. */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return true;
  return BLOCKED.check(address, family === 4 ? "ipv4" : "ipv6");
}

export type HostResolver = (host: string) => Promise<readonly { address: string }[]>;

const resolveHost: HostResolver = (host) => lookup(host, { all: true });

/**
 * Whether a web address leads to this computer or the local network: an IP literal in a blocked
 * range, or a host name any of whose addresses is. A name that does not resolve is left to the
 * page load, which fails on its own.
 */
export async function isPrivateTarget(url: string, resolve = resolveHost): Promise<boolean> {
  if (!URL.canParse(url)) return false;
  const { protocol, hostname } = new URL(url);
  if (protocol !== "http:" && protocol !== "https:") return false;
  const host = hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) !== 0) return isBlockedAddress(host);
  // Chromium sends `*.localhost` to this computer without asking DNS.
  if (/(^|\.)localhost\.?$/i.test(host)) return true;
  const addresses = await resolve(host).catch(() => []);
  return addresses.some((entry) => isBlockedAddress(entry.address));
}

/**
 * A Chrome user agent without the `Electron/…` and app tokens: some sites (Google sign-in among
 * them) refuse browsers they do not recognize. Chrome itself reports only its major version.
 */
export function chromeUserAgent(platform: NodeJS.Platform, chromeVersion: string): string {
  const os =
    platform === "darwin"
      ? "Macintosh; Intel Mac OS X 10_15_7"
      : platform === "win32"
        ? "Windows NT 10.0; Win64; x64"
        : "X11; Linux x86_64";
  const major = chromeVersion.split(".")[0];
  return `Mozilla/5.0 (${os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}
