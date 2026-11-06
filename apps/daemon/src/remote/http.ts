import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { networkInterfaces, hostname } from "node:os";
import { extname, join, resolve, sep } from "node:path";

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
  const stream = createReadStream(file);
  stream.on("error", () => res.destroy());
  stream.pipe(res);
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
