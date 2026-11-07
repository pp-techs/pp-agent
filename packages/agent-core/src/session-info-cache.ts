/**
 * What the conversation list needs from each saved session file, kept per file and read again
 * only when the file's size or modification time changed. Listing hundreds of conversations then
 * costs one `stat` per file instead of parsing every line of every file (screenshots and tool
 * output included) on each refresh.
 */
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { contentText } from "./history.ts";

/** A saved session as the conversation list and the `sessions` tool show it. */
export interface SavedSession {
  path: string;
  /** Working directory the session was started in; empty for old sessions. */
  cwd: string;
  /** Latest name given to the session, if any. */
  name: string | undefined;
  /** Last user or assistant message, else when the session was created, else the file's mtime. */
  modified: Date;
  messageCount: number;
  /** Text of the first user message, `(no messages)` when there is none (as Pi lists it). */
  firstMessage: string;
}

interface CachedFile {
  mtimeMs: number;
  size: number;
  /** Shared by concurrent listings, so a changed file is read once. */
  info: Promise<SavedSession | null>;
}

/** Session files read at the same time. */
const CONCURRENT_FILES = 6;

export class SessionInfoCache {
  readonly #files = new Map<string, CachedFile>();

  constructor(readonly dir: string) {}

  /** Every readable session in the folder, newest first. Files gone since last time are forgotten. */
  async list(): Promise<SavedSession[]> {
    const names = (await readdir(this.dir).catch(() => [] as string[])).filter((name) =>
      name.endsWith(".jsonl"),
    );
    const files = await Promise.all(
      names.map(async (name) => {
        const path = join(this.dir, name);
        const stats = await stat(path).catch(() => null);
        return stats?.isFile() ? { path, mtimeMs: stats.mtimeMs, size: stats.size } : null;
      }),
    );
    const present = new Set<string>();
    const stale: { path: string; mtimeMs: number; size: number }[] = [];
    for (const file of files) {
      if (!file) continue;
      present.add(file.path);
      const cached = this.#files.get(file.path);
      if (cached?.mtimeMs !== file.mtimeMs || cached.size !== file.size) stale.push(file);
    }
    for (const path of this.#files.keys()) if (!present.has(path)) this.#files.delete(path);
    for (let index = 0; index < stale.length; index += CONCURRENT_FILES) {
      const batch = stale.slice(index, index + CONCURRENT_FILES).map((file) => {
        const info = readSessionInfo(file.path, file.mtimeMs);
        this.#files.set(file.path, { mtimeMs: file.mtimeMs, size: file.size, info });
        return info;
      });
      await Promise.all(batch);
    }
    const infos = await Promise.all(
      [...present].map((path) => this.#files.get(path)?.info ?? Promise.resolve(null)),
    );
    return infos
      .filter((info) => info !== null)
      .sort((a, b) => b.modified.getTime() - a.modified.getTime());
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? { ...value } : null;
}

function parseObject(line: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(line));
  } catch {
    // A damaged line is skipped, like Pi does.
    return null;
  }
}

/**
 * Reads one session file the way Pi's session list does, but parses only the lines it needs:
 * tool results, the bulk of a file, are counted without being parsed. `null` for a file that is
 * not a session or cannot be read.
 */
export async function readSessionInfo(path: string, mtimeMs: number): Promise<SavedSession | null> {
  let header: Record<string, unknown> | null = null;
  let name: string | undefined;
  let messageCount = 0;
  let firstMessage = "";
  let lastActivity: number | undefined;
  const lines = createInterface({
    input: createReadStream(path, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  try {
    for await (const line of lines) {
      if (!header) {
        if (!line.trim()) continue;
        const first = parseObject(line);
        if (!first) continue;
        if (first.type !== "session") return null;
        header = first;
        continue;
      }
      if (line.includes('"type":"session_info"')) {
        const entry = parseObject(line);
        if (entry?.type === "session_info") {
          name =
            typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : undefined;
          continue;
        }
      }
      if (!line.includes('"type":"message"')) continue;
      // Pi writes `type` first: another entry kind only quotes a message somewhere inside.
      if (line.startsWith('{"type":"') && !line.startsWith('{"type":"message"')) continue;
      if (!line.includes('"role":"user"') && !line.includes('"role":"assistant"')) {
        messageCount += 1;
        continue;
      }
      const entry = parseObject(line);
      if (entry?.type !== "message") continue;
      messageCount += 1;
      const message = asRecord(entry.message);
      const role = message?.role;
      if (!message || (role !== "user" && role !== "assistant")) continue;
      const stamp =
        typeof message.timestamp === "number"
          ? message.timestamp
          : typeof entry.timestamp === "string"
            ? new Date(entry.timestamp).getTime()
            : Number.NaN;
      if (!Number.isNaN(stamp)) lastActivity = Math.max(lastActivity ?? 0, stamp);
      if (firstMessage || role !== "user") continue;
      firstMessage = contentText(message.content);
    }
  } catch {
    return null;
  } finally {
    lines.close();
  }
  if (!header) return null;
  const created = typeof header.timestamp === "string" ? new Date(header.timestamp).getTime() : NaN;
  return {
    path,
    cwd: typeof header.cwd === "string" ? header.cwd : "",
    name,
    modified: new Date(
      lastActivity !== undefined && lastActivity > 0
        ? lastActivity
        : Number.isNaN(created)
          ? mtimeMs
          : created,
    ),
    messageCount,
    firstMessage: firstMessage || "(no messages)",
  };
}
