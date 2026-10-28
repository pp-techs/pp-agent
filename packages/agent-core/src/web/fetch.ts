import { lookup as dnsLookup } from "node:dns";
import { BlockList, isIP } from "node:net";
import http from "node:http";
import https from "node:https";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import { OfficeParser } from "officeparser";
import { extractWithWebclaw } from "./webclaw.ts";

/** Address ranges a web page must never make the app reach: this computer, the local network, cloud metadata. */
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

export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return true;
  return BLOCKED.check(address, family === 4 ? "ipv4" : "ipv6");
}

export class FetchRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FetchRefused";
  }
}

/**
 * Resolves a host and refuses it when any address is private. Node calls this when it connects, so
 * the checked address is the one used (no gap for DNS rebinding).
 */
function guardedLookup(
  hostname: string,
  options: { all?: boolean; family?: number; hints?: number },
  callback: (
    error: Error | null,
    address: string | { address: string; family: number }[],
    family?: number,
  ) => void,
): void {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, "");
    if (addresses.some((entry) => isBlockedAddress(entry.address)))
      return callback(new FetchRefused("That address is on a private network."), "");
    if (options.all) return callback(null, addresses);
    const first = addresses[0];
    if (!first) return callback(new Error("The address has no IP."), "");
    return callback(null, first.address, first.family);
  });
}

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 25_000;

interface RawResponse {
  url: URL;
  status: number;
  contentType: string;
  body: Buffer;
  /** The body ended early because it reached the size limit. */
  clipped: boolean;
}

function parseTarget(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new FetchRefused("That is not a valid web address.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new FetchRefused("Only http and https addresses can be opened.");
  if (url.username || url.password)
    throw new FetchRefused("Addresses with a user name or password are not opened.");
  // Node skips the lookup for IP literals, so they are checked here.
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) !== 0 && isBlockedAddress(host))
    throw new FetchRefused("That address is on a private network.");
  return url;
}

function requestOnce(url: URL, signal: AbortSignal): Promise<RawResponse & { location?: string }> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const request = client.request(
      url,
      {
        method: "GET",
        lookup: guardedLookup as never,
        signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; PP-Agent/1.0)",
          Accept: "text/html,application/xhtml+xml,application/pdf,text/plain;q=0.9,*/*;q=0.5",
          "Accept-Encoding": "gzip, deflate, br",
        },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const location = response.headers.location;
        if (status >= 300 && status < 400 && location) {
          response.resume();
          resolve({
            url,
            status,
            contentType: "",
            body: Buffer.alloc(0),
            clipped: false,
            location,
          });
          return;
        }
        const encoding = String(response.headers["content-encoding"] ?? "").toLowerCase();
        const stream =
          encoding === "gzip" || encoding === "x-gzip"
            ? response.pipe(createGunzip())
            : encoding === "deflate"
              ? response.pipe(createInflate())
              : encoding === "br"
                ? response.pipe(createBrotliDecompress())
                : response;
        const chunks: Buffer[] = [];
        let size = 0;
        let clipped = false;
        const finish = () =>
          resolve({
            url,
            status,
            contentType: String(response.headers["content-type"] ?? ""),
            body: Buffer.concat(chunks),
            clipped,
          });
        stream.on("data", (chunk: Buffer) => {
          if (clipped) return;
          size += chunk.length;
          chunks.push(
            size > MAX_BYTES ? chunk.subarray(0, chunk.length - (size - MAX_BYTES)) : chunk,
          );
          if (size > MAX_BYTES) {
            clipped = true;
            response.destroy();
            finish();
          }
        });
        stream.on("end", () => {
          if (!clipped) finish();
        });
        stream.on("error", (error) => {
          if (!clipped) reject(error);
        });
      },
    );
    request.on("error", reject);
    request.end();
  });
}

/** GET with every hop checked: the address, each redirect target, the size, the time. */
async function fetchGuarded(input: string, outer: AbortSignal | undefined): Promise<RawResponse> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const signal = outer ? AbortSignal.any([outer, timeout]) : timeout;
  let url = parseTarget(input);
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const response = await requestOnce(url, signal);
      if (response.location === undefined) return response;
      url = parseTarget(new URL(response.location, url).href);
    }
  } catch (error) {
    if (outer?.aborted) throw error;
    if (timeout.aborted) throw new Error("The page did not answer in time.");
    if (error instanceof FetchRefused) throw error;
    throw new Error(`The page could not be opened (${describeNetworkError(error)}).`);
  }
  throw new Error("The page redirected too many times.");
}

/** Node reports a failed connection to several addresses as an AggregateError with no message. */
function describeNetworkError(error: unknown): string {
  if (error instanceof AggregateError && error.errors[0] instanceof Error)
    return error.errors[0].message;
  return error instanceof Error ? error.message : String(error);
}

const OFFICE_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
};

function officeType(response: RawResponse): string | undefined {
  const type = response.contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (OFFICE_TYPES[type]) return OFFICE_TYPES[type];
  const extension = /\.(pdf|docx|xlsx|pptx)$/i.exec(response.url.pathname)?.[1]?.toLowerCase();
  return type === "application/octet-stream" || type === "" ? extension : undefined;
}

function charsetOf(contentType: string): string {
  const charset = /charset=["']?([\w-]+)/i.exec(contentType)?.[1]?.toLowerCase();
  return charset ?? "utf-8";
}

function decode(body: Buffer, contentType: string): string {
  try {
    return new TextDecoder(charsetOf(contentType)).decode(body);
  } catch {
    return body.toString("utf8");
  }
}

/** webclaw output shorter than this may have cut away the real content of an unusual page. */
const SHORT_EXTRACTION = 500;

/**
 * The text of an HTML page as Markdown. webclaw keeps the main content and drops menus and
 * footers; when it is missing, fails or returns very little, the whole page is converted instead
 * and the longer of the two wins.
 */
export async function htmlToText(
  html: string,
  signal?: AbortSignal,
  binary?: string | null,
): Promise<string> {
  const extracted = await extractWithWebclaw(html, { signal, binary });
  if (extracted !== null && extracted.length >= SHORT_EXTRACTION) return extracted;
  const ast = await OfficeParser.parseOffice(Buffer.from(html, "utf8"), {
    fileType: "html" as never,
  });
  const whole = (await ast.to("md")).value;
  return extracted !== null && extracted.length > whole.length ? extracted : whole;
}

export interface FetchedPage {
  url: string;
  contentType: string;
  /** Page text as Markdown (or plain text). */
  text: string;
  clipped: boolean;
}

/** Opens a public web page and returns its text. Refuses private-network addresses. */
export async function fetchPage(input: string, signal?: AbortSignal): Promise<FetchedPage> {
  const response = await fetchGuarded(input, signal);
  if (response.status < 200 || response.status >= 300)
    throw new Error(`The page answered with status ${response.status}.`);
  const url = response.url.href;
  const base = { url, contentType: response.contentType, clipped: response.clipped };
  const office = officeType(response);
  if (office) {
    const ast = await OfficeParser.parseOffice(response.body, {
      fileType: office as never,
      ignoreComments: true,
      abortSignal: signal ?? null,
    });
    return { ...base, text: (await ast.to("md")).value };
  }
  const type = response.contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  const body = decode(response.body, response.contentType);
  const looksHtml =
    type === "text/html" || type === "application/xhtml+xml" || /^\s*<(!doctype|html)/i.test(body);
  if (looksHtml) return { ...base, text: await htmlToText(body, signal) };
  if (type.startsWith("text/") || type.includes("json") || type.includes("xml") || type === "")
    return { ...base, text: body };
  throw new Error(`Pages of type ${type} cannot be read.`);
}
