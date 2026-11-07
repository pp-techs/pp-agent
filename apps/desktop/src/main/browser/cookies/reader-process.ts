import { join } from "node:path";
import { utilityProcess } from "electron";
import { LockedError } from "./database.ts";
import type { PortableCookie } from "./portable.ts";

/** One read of a cookie database, done in the cookie reader process. */
export type ReaderJob =
  | { kind: "chromium-hosts"; file: string }
  | { kind: "firefox-hosts"; profileDir: string }
  | {
      kind: "chromium";
      file: string;
      /** Base64 of the decryption key. */
      key: string;
      platform: "darwin" | "win32";
      sites: string[];
    }
  | { kind: "firefox"; profileDir: string; sites: string[] };

export type HostCount = { host: string; count: number };

export interface ReaderResults {
  "chromium-hosts": HostCount[];
  "firefox-hosts": HostCount[];
  chromium: { cookies: PortableCookie[]; unreadable: number; appBound: number };
  firefox: PortableCookie[];
}

export type ReaderReply =
  | { ok: true; data: unknown }
  | { ok: false; error: string; locked: boolean };

/** The reader's bundle, next to main's (`cookieReader` entry in vite.config.ts). */
const READER_SCRIPT = join(import.meta.dirname, "cookieReader.mjs");

/**
 * Runs one job in a short-lived utility process: opening the SQLite copy and decrypting thousands
 * of cookies would otherwise hold up main, and with it the window and the side panel pages.
 */
export function readInBackground<J extends ReaderJob>(job: J): Promise<ReaderResults[J["kind"]]> {
  const child = utilityProcess.fork(READER_SCRIPT, [], {
    serviceName: "PP Agent cookie reader",
    stdio: "ignore",
  });
  const { promise, resolve, reject } = Promise.withResolvers<ReaderResults[J["kind"]]>();
  child.once("message", (reply: ReaderReply) => {
    child.kill();
    if (reply.ok) resolve(reply.data as ReaderResults[J["kind"]]);
    else reject(reply.locked ? new LockedError(reply.error) : new Error(reply.error));
  });
  // Settles nothing once the reply arrived; otherwise the reader crashed or was killed.
  child.once("exit", (code) => reject(new Error(`The cookie reader stopped (code ${code}).`)));
  child.postMessage(job);
  return promise;
}
