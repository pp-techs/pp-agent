import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import type { PortableCookie } from "./portable.ts";

const START_TIMEOUT_MS = 20_000;
const COMMAND_TIMEOUT_MS = 15_000;

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

async function waitForFile(file: string, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const text = await readFile(file, "utf8").catch(() => "");
    if (text.includes("\n")) return text;
    if (Date.now() > deadline) throw new Error("The browser did not start in time.");
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

function cdpCall(socket: WebSocket, id: number, method: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${method} timed out.`)), COMMAND_TIMEOUT_MS);
    socket.addEventListener("message", function onMessage(event: MessageEvent) {
      const message = JSON.parse(String(event.data)) as {
        id?: number;
        result?: unknown;
        error?: { message: string };
      };
      if (message.id !== id) return;
      socket.removeEventListener("message", onMessage);
      clearTimeout(timer);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    });
    socket.send(JSON.stringify({ id, method }));
  });
}

/**
 * Reads every cookie of a profile through the browser itself. Windows Chrome, Edge and Brave
 * encrypt cookies with a key only their own program may unwrap ("app-bound"), so the app copies the
 * profile's cookie database into a throwaway user data folder, starts the browser headless on that
 * copy with remote debugging (allowed for a non-default folder), and asks it over the DevTools
 * protocol. The person's own profile is never opened.
 */
export async function readCookiesThroughBrowser(
  executable: string,
  userData: string,
  profileDir: string,
  cookieDb: string,
): Promise<PortableCookie[]> {
  const dir = await mkdtemp(join(tmpdir(), "pp-agent-browser-"));
  const child = { process: null as ReturnType<typeof spawn> | null };
  try {
    await copyFile(join(userData, "Local State"), join(dir, "Local State"));
    const target = join(dir, relative(userData, cookieDb));
    await mkdir(dirname(target), { recursive: true });
    await copyFile(cookieDb, target);
    child.process = spawn(
      executable,
      [
        `--user-data-dir=${dir}`,
        `--profile-directory=${profileDir}`,
        "--headless=new",
        "--remote-debugging-port=0",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        "--disable-sync",
        "--disable-background-networking",
        "about:blank",
      ],
      { stdio: "ignore", windowsHide: true },
    );
    // A browser that cannot start (missing, blocked by security software) reports an `error`
    // event; without a listener that would be an uncaught exception of the main process.
    const failed = new Promise<never>((_, reject) => child.process?.once("error", reject));
    failed.catch(() => {});
    const started = await Promise.race([
      waitForFile(join(dir, "DevToolsActivePort"), START_TIMEOUT_MS),
      failed,
    ]);
    const [port, path] = started.trim().split("\n");
    const socket = new WebSocket(`ws://127.0.0.1:${port}${path}`);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error("No connection to the browser.")), {
        once: true,
      });
    });
    try {
      const result = (await cdpCall(socket, 1, "Storage.getCookies")) as { cookies: CdpCookie[] };
      await cdpCall(socket, 2, "Browser.close").catch(() => {});
      return result.cookies.map(fromCdpCookie);
    } finally {
      socket.close();
    }
  } finally {
    child.process?.kill();
    // The browser may still hold files for a moment after it closes.
    await new Promise((resolve) => setTimeout(resolve, 500));
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }).catch(() => {});
  }
}
