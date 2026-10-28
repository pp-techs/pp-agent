/**
 * Turns the HTML of a page into clean Markdown with the webclaw binary the app bundles. webclaw
 * only reads HTML from standard input here: the download stays in `fetch.ts`, which refuses
 * private-network addresses. The child starts with a scrubbed environment and never goes through
 * a shell. Anything that goes wrong returns `null` and the caller uses its own conversion.
 */
import { spawn } from "node:child_process";
import { platformKey, resourcePath, scrubbedEnv } from "../resources.ts";

/** Wall-clock limit for one page. */
const TIMEOUT_MS = 30_000;
/** Bytes kept from the output; a page that produces more is left to the fallback. */
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

/** The bundled binary, or `null` when this platform has none (Windows on ARM, a dev checkout). */
export function webclawBinary(): string | null {
  const name = process.platform === "win32" ? "webclaw.exe" : "webclaw";
  return resourcePath("webclaw", platformKey(), name);
}

export interface WebclawOptions {
  signal?: AbortSignal | undefined;
  /** Replaces the bundled binary; tests only. */
  binary?: string | null | undefined;
}

/** The page as Markdown with a short title header, or `null` when webclaw cannot be used. */
export async function extractWithWebclaw(
  html: string,
  options: WebclawOptions = {},
): Promise<string | null> {
  const binary = options.binary === undefined ? webclawBinary() : options.binary;
  if (!binary || options.signal?.aborted) return null;
  return new Promise<string | null>((resolve) => {
    const child = spawn(binary, ["--stdin", "--format", "llm"], {
      env: scrubbedEnv(),
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "ignore"],
    });
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const settle = (text: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onStop);
      child.kill("SIGKILL");
      resolve(text);
    };
    const onStop = () => settle(null);
    const timer = setTimeout(onStop, TIMEOUT_MS);
    options.signal?.addEventListener("abort", onStop, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_OUTPUT_BYTES) return settle(null);
      chunks.push(chunk);
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(html);
    child.on("error", () => settle(null));
    child.on("close", (code) => {
      const text = Buffer.concat(chunks).toString("utf8").trim();
      settle(code === 0 && text ? text : null);
    });
  });
}
