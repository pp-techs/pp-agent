import { type ChildProcess, spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import type { Readable, Writable } from "node:stream";
import type { PortableCookie } from "./portable.ts";

const COMMAND_TIMEOUT_MS = 20_000;

/** A cookie as the DevTools protocol's `Storage.getCookies` returns it. */
interface CdpCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  /** Epoch seconds; -1 for a session cookie. */
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  session: boolean;
  sameSite?: "Strict" | "Lax" | "None";
}

export function fromCdpCookie(cookie: CdpCookie): PortableCookie {
  return {
    domain: cookie.domain,
    hostOnly: !cookie.domain.startsWith("."),
    name: cookie.name,
    value: cookie.value,
    path: cookie.path || "/",
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite:
      cookie.sameSite === "Strict"
        ? "strict"
        : cookie.sameSite === "Lax"
          ? "lax"
          : cookie.sameSite === "None"
            ? "no_restriction"
            : "unspecified",
    expires: cookie.session || cookie.expires < 0 ? null : Math.floor(cookie.expires),
  };
}

/**
 * The DevTools protocol over `--remote-debugging-pipe`: the browser reads commands from file
 * descriptor 3 and writes replies to 4, each message JSON ended by a NUL byte. Unlike a debugging
 * port, no other program on the computer can connect.
 */
class CdpPipe {
  private nextId = 1;
  private buffer = "";
  private readonly waiting = new Map<number, (message: CdpMessage) => void>();

  constructor(
    private readonly input: Writable,
    output: Readable,
  ) {
    // A browser that exits breaks the pipe; its `exit` event reports that, so stream errors (EPIPE)
    // must not become uncaught exceptions.
    input.on("error", () => {});
    output.on("error", () => {});
    output.setEncoding("utf8");
    output.on("data", (chunk: string) => {
      this.buffer += chunk;
      for (let end = this.buffer.indexOf("\0"); end >= 0; end = this.buffer.indexOf("\0")) {
        const message = JSON.parse(this.buffer.slice(0, end)) as CdpMessage;
        this.buffer = this.buffer.slice(end + 1);
        if (message.id !== undefined) this.waiting.get(message.id)?.(message);
      }
    });
  }

  call(method: string): Promise<unknown> {
    const id = this.nextId++;
    const { promise, resolve, reject } = Promise.withResolvers<unknown>();
    const timer = setTimeout(() => {
      this.waiting.delete(id);
      reject(new Error(`${method} timed out.`));
    }, COMMAND_TIMEOUT_MS);
    this.waiting.set(id, (message) => {
      this.waiting.delete(id);
      clearTimeout(timer);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    });
    this.input.write(`${JSON.stringify({ id, method })}\0`);
    return promise;
  }
}

interface CdpMessage {
  id?: number;
  result?: unknown;
  error?: { message: string };
}

/**
 * Reads every cookie of a profile through the browser itself. Windows Chrome, Edge and Brave
 * encrypt cookies with a key only their own program may unwrap ("app-bound"), so the app copies the
 * profile's cookie database into a throwaway user data folder, starts the browser headless on that
 * copy with remote debugging over a pipe (allowed for a non-default folder), and asks it over the
 * DevTools protocol. The person's own profile is never opened.
 */
export async function readCookiesThroughBrowser(
  executable: string,
  userData: string,
  profileDir: string,
  cookieDb: string,
): Promise<PortableCookie[]> {
  const dir = await mkdtemp(join(tmpdir(), "pp-agent-browser-"));
  let started: ChildProcess | null = null;
  try {
    await copyFile(join(userData, "Local State"), join(dir, "Local State"));
    const target = join(dir, relative(userData, cookieDb));
    await mkdir(dirname(target), { recursive: true });
    await copyFile(cookieDb, target);
    const browser = spawn(
      executable,
      [
        `--user-data-dir=${dir}`,
        `--profile-directory=${profileDir}`,
        "--headless=new",
        "--remote-debugging-pipe",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        "--disable-sync",
        "--disable-background-networking",
        "about:blank",
      ],
      { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"], windowsHide: true },
    );
    started = browser;
    // A browser that cannot start (missing, blocked by security software) reports an `error`
    // event, or exits; without a listener that would be an uncaught exception of the main process.
    const { promise: failed, reject: fail } = Promise.withResolvers<never>();
    browser.once("error", fail);
    browser.once("exit", (code) => fail(new Error(`The browser exited (code ${code}).`)));
    failed.catch(() => {});
    const pipe = new CdpPipe(browser.stdio[3] as Writable, browser.stdio[4] as Readable);
    // The first command waits until the browser listens on the pipe.
    const result = (await Promise.race([pipe.call("Storage.getCookies"), failed])) as {
      cookies: CdpCookie[];
    };
    await Promise.race([pipe.call("Browser.close"), failed]).catch(() => {});
    return result.cookies.map(fromCdpCookie);
  } finally {
    started?.kill();
    // The browser may still hold files for a moment after it closes.
    await new Promise((resolve) => setTimeout(resolve, 500));
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }).catch(() => {});
  }
}
