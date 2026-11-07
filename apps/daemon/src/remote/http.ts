import { createReadStream, createWriteStream } from "node:fs";
import { rm, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { isIP } from "node:net";
import { networkInterfaces, hostname } from "node:os";
import { extname, join, resolve, sep } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

/** A failure with the HTTP status to answer and a message the person may read. */
export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Sent with every answer: no framing, no sniffing, no referrer leaking the address. */
const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  // The page carries its own CSP meta tag; `frame-ancestors` only works as a header.
  "Content-Security-Policy": "frame-ancestors 'none'",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
};

export function applySecurityHeaders(res: ServerResponse): void {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
    "Cache-Control": "no-store",
  });
  res.end(text);
}

/** The request body, refused with 413 past `limit` bytes. */
export async function readBody(req: IncomingMessage, limit: number, tooLarge: string) {
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > limit) throw new HttpError(413, tooLarge);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, tooLarge);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Writes the request body to `path` (mode 0600) as it arrives, refused with 413 past `limit`
 * bytes; nothing is held in memory and a partial file is removed.
 */
export async function saveBody(
  req: IncomingMessage,
  path: string,
  limit: number,
  tooLarge: string,
): Promise<void> {
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > limit) throw new HttpError(413, tooLarge);
  let size = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      size += chunk.length;
      done(size > limit ? new HttpError(413, tooLarge) : null, chunk);
    },
  });
  try {
    await pipeline(req, counter, createWriteStream(path, { mode: 0o600 }));
  } catch (error) {
    await rm(path, { force: true }).catch(() => undefined);
    throw error;
  }
}

export function bearerToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (typeof header !== "string") return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match?.[1] ?? null;
}

/**
 * Whether a request comes from this app's own page. Browsers send `Origin` on cross-site requests
 * (and on every POST); a page elsewhere must not drive the agent, even with a token.
 */
export function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

/** Carrier-grade NAT (`100.64.0.0/10`): Tailscale addresses, but also some ISPs' WAN addresses. */
export function isCgnatAddress(address: string): boolean {
  const v4 = address.startsWith("::ffff:") ? address.slice(7) : address;
  if (isIP(v4) !== 4) return false;
  const [a = 0, b = 0] = v4.split(".").map(Number);
  return a === 100 && b >= 64 && b <= 127;
}

/** Addresses of this computer's network interfaces, loopback included, in lower case. */
export function ownAddresses(): string[] {
  const addresses: string[] = [];
  for (const entries of Object.values(networkInterfaces()))
    for (const entry of entries ?? []) addresses.push(entry.address.toLowerCase());
  return addresses;
}

/** The name in a `Host` header, without port or IPv6 brackets, in lower case. */
function hostName(header: string | undefined): string | null {
  if (!header) return null;
  try {
    return new URL(`http://${header}`).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Whether the `Host` header names this computer's loopback (`localhost`, `127.0.0.1`, `[::1]`):
 * what a browser or dev proxy on the computer itself sends. Tunnels to the internet (`tailscale
 * funnel`, `cloudflared`, `ngrok`) send their public name instead.
 */
export function isLoopbackHost(header: string | undefined): boolean {
  const name = hostName(header);
  return name === "localhost" || name === "::1" || (name?.startsWith("127.") ?? false);
}

/**
 * Whether the `Host` header names this computer: one of its own addresses, its name (with or
 * without `.local`), `localhost`, or a Tailscale name (`*.ts.net`) while it is on a tailnet.
 * Anything else is a page that rebound its own domain to this address (DNS rebinding), which must
 * not reach the pairing endpoint as if it were the app.
 */
export function isOwnHost(header: string | undefined, addresses: readonly string[]): boolean {
  const name = hostName(header);
  if (!name) return false;
  if (name === "localhost" || addresses.includes(name)) return true;
  const own = hostname().toLowerCase();
  const short = own.split(".")[0] ?? own;
  if (name === own || name === short || name === `${short}.local`) return true;
  return name.endsWith(".ts.net") && addresses.some(isCgnatAddress);
}

/**
 * Origins of the phone app (apps/mobile): its pages are `capacitor://localhost` on iOS and
 * `http://localhost` on Android, so its requests are cross-origin and need CORS. Only these exact
 * origins pass: a website can never have one, and the device token still guards every API call.
 */
const APP_ORIGINS = new Set(["capacitor://localhost", "http://localhost"]);

/** The phone app's origin when the request comes from it, else null. */
export function appOrigin(req: IncomingMessage): string | null {
  const origin = req.headers.origin;
  return typeof origin === "string" && APP_ORIGINS.has(origin) ? origin : null;
}

/** Lets the phone app at `origin` read answers and send the headers the API uses. */
export function applyCorsHeaders(req: IncomingMessage, res: ServerResponse, origin: string): void {
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  if (req.method !== "OPTIONS") return;
  res.setHeader("Access-Control-Allow-Methods", "GET, POST");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-File-Name");
  res.setHeader("Access-Control-Max-Age", "600");
  // Private Network Access: a WebView may ask before reaching a local-network address.
  if (req.headers["access-control-request-private-network"] === "true")
    res.setHeader("Access-Control-Allow-Private-Network", "true");
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
};

async function fileAt(path: string): Promise<number | null> {
  try {
    const stats = await stat(path);
    return stats.isFile() ? stats.size : null;
  } catch {
    return null;
  }
}

/**
 * Serves the built web app from `root`. Paths without an extension get `index.html`, so a reload
 * on any address still opens the app; files under `assets/` have hashed names and are cached.
 */
export async function serveStatic(
  req: IncomingMessage,
  res: ServerResponse,
  root: string,
  pathname: string,
): Promise<void> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    throw new HttpError(400, "Bad path.");
  }
  const base = resolve(root);
  let file = resolve(join(base, decoded));
  if (file !== base && !file.startsWith(base + sep)) throw new HttpError(404, "Not found.");
  let size = file === base ? null : await fileAt(file);
  if (size === null) {
    if (extname(decoded) !== "") throw new HttpError(404, "Not found.");
    file = join(base, "index.html");
    size = await fileAt(file);
    if (size === null) throw new HttpError(404, "Not found.");
  }
  const immutable = file.startsWith(join(base, "assets") + sep);
  res.writeHead(200, {
    "Content-Type": CONTENT_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
    "Content-Length": size,
    "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
  });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  await pipeline(createReadStream(file), res);
}

/** Private IPv4 ranges a phone on the same Wi-Fi can reach. */
function isPrivateIpv4(address: string): boolean {
  const [a = 0, b = 0] = address.split(".").map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/**
 * Addresses a phone on the local network may use: private IPv4 addresses first, then other
 * non-internal ones, and the `.local` name when the system has one (macOS).
 */
export function lanUrls(port: number): string[] {
  const addresses: string[] = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" || entry.internal || entry.address.startsWith("169.254."))
        continue;
      addresses.push(entry.address);
    }
  }
  const unique = [...new Set(addresses)].sort(
    (a, b) => Number(isPrivateIpv4(b)) - Number(isPrivateIpv4(a)),
  );
  const urls = unique.map((address) => `http://${address}:${port}`);
  const name = hostname();
  if (name.toLowerCase().endsWith(".local")) urls.push(`http://${name}:${port}`);
  return urls;
}
