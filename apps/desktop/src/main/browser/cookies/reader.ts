/**
 * Entry of the cookie reader utility process (bundled as `cookieReader.mjs`): answers one
 * `ReaderJob` from main and is killed after its reply. Decrypted values only travel back to main.
 */
import { chromiumCookieHosts, readChromiumCookies } from "./chromium.ts";
import { LockedError } from "./database.ts";
import { firefoxCookieHosts, readFirefoxCookies } from "./firefox.ts";
import type { ReaderJob, ReaderReply } from "./reader-process.ts";

async function answer(job: ReaderJob): Promise<unknown> {
  switch (job.kind) {
    case "chromium-hosts":
      return chromiumCookieHosts(job.file);
    case "firefox-hosts":
      return firefoxCookieHosts(job.profileDir);
    case "chromium":
      return readChromiumCookies(
        job.file,
        Buffer.from(job.key, "base64"),
        job.platform,
        new Set(job.sites),
      );
    case "firefox":
      return readFirefoxCookies(job.profileDir, new Set(job.sites));
  }
}

process.parentPort.once("message", (event) => {
  void answer(event.data as ReaderJob).then(
    (data) => process.parentPort.postMessage({ ok: true, data } satisfies ReaderReply),
    (error: unknown) =>
      process.parentPort.postMessage({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        locked: error instanceof LockedError,
      } satisfies ReaderReply),
  );
});
