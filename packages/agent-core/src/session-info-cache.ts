/**
 * What the conversation list needs from each saved session file, kept per file and read again
 * only when the file's size or modification time changed. Listing hundreds of conversations then
 * costs one `stat` per file instead of parsing every line of every file (screenshots and tool
 * output included) on each refresh.
 */
import { createReadStream } from "node:fs";
import { open, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
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

/**
 * Where a scan of a session file stopped, so the next one can pick up there. Session files are
 * only ever appended to, and the open conversation's file grows after every message: reading just
 * the new lines keeps a long chat (screenshots and tool output included) from being read again.
 */
interface ScanState {
  header: Record<string, unknown>;
  name: string | undefined;
  messageCount: number;
  firstMessage: string;
  lastActivity: number | undefined;
  /** Bytes consumed, up to and including the last newline. */
  offset: number;
  /** The bytes just before `offset`: the file is appended to only if they are still there. */
  guard: Buffer;
}

interface ScanResult {
  info: SavedSession | null;
  /** Kept for a file that is a session; `null` for anything else. */
  state: ScanState | null;
}

interface CachedFile {
  mtimeMs: number;
  size: number;
  /** Shared by concurrent listings, so a changed file is read once. */
  scan: Promise<ScanResult>;
}

/** Session files read at the same time. */
const CONCURRENT_FILES = 6;
/** Bytes before the resume point that must be unchanged for a scan to continue from it. */
const GUARD_BYTES = 64;

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
        const previous = this.#files.get(file.path);
        // A file that grew continues from where the last scan stopped.
        const scan = (async () => {
          const prior = previous && file.size >= previous.size ? (await previous.scan).state : null;
          return scanSession(file.path, file.mtimeMs, prior);
        })();
        this.#files.set(file.path, { mtimeMs: file.mtimeMs, size: file.size, scan });
        return scan;
      });
      await Promise.all(batch);
    }
    const infos = await Promise.all(
      [...present].map(
        async (path) => (await this.#files.get(path)?.scan.catch(() => null))?.info ?? null,
      ),
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

/** Reads the bytes `[start, start + length)` of a file, fewer if it ends sooner. */
async function readBytes(path: string, start: number, length: number): Promise<Buffer> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/** Whether the bytes before `prior.offset` are the ones the scan saw: the file was only appended to. */
async function stillAppended(path: string, prior: ScanState): Promise<boolean> {
  if (prior.guard.length === 0) return true;
  const now = await readBytes(path, prior.offset - prior.guard.length, prior.guard.length).catch(
    () => null,
  );
  return now !== null && now.equals(prior.guard);
}

/**
 * Folds one line into the running totals the way Pi's session list reads a file, parsing only the
 * lines it needs: tool results, the bulk of a file, are counted without being parsed. `false` for a
 * file whose first line is not a session header.
 */
function applyLine(
  state: Omit<ScanState, "header"> & { header: ScanState["header"] | null },
  line: string,
): boolean {
  if (!state.header) {
    if (!line.trim()) return true;
    const first = parseObject(line);
    if (!first) return true;
    if (first.type !== "session") return false;
    state.header = first;
    return true;
  }
  if (line.includes('"type":"session_info"')) {
    const entry = parseObject(line);
    if (entry?.type === "session_info") {
      state.name =
        typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : undefined;
      return true;
    }
  }
  if (!line.includes('"type":"message"')) return true;
  // Pi writes `type` first: another entry kind only quotes a message somewhere inside.
  if (line.startsWith('{"type":"') && !line.startsWith('{"type":"message"')) return true;
  if (!line.includes('"role":"user"') && !line.includes('"role":"assistant"')) {
    state.messageCount += 1;
    return true;
  }
  const entry = parseObject(line);
  if (entry?.type !== "message") return true;
  state.messageCount += 1;
  const message = asRecord(entry.message);
  const role = message?.role;
  if (!message || (role !== "user" && role !== "assistant")) return true;
  const stamp =
    typeof message.timestamp === "number"
      ? message.timestamp
      : typeof entry.timestamp === "string"
        ? new Date(entry.timestamp).getTime()
        : Number.NaN;
  if (!Number.isNaN(stamp)) state.lastActivity = Math.max(state.lastActivity ?? 0, stamp);
  if (state.firstMessage || role !== "user") return true;
  state.firstMessage = contentText(message.content);
  return true;
}

function infoOf(
  path: string,
  mtimeMs: number,
  state: Omit<ScanState, "header"> & { header: ScanState["header"] },
): SavedSession {
  const { header, lastActivity } = state;
  const created = typeof header.timestamp === "string" ? new Date(header.timestamp).getTime() : NaN;
  return {
    path,
    cwd: typeof header.cwd === "string" ? header.cwd : "",
    name: state.name,
    modified: new Date(
      lastActivity !== undefined && lastActivity > 0
        ? lastActivity
        : Number.isNaN(created)
          ? mtimeMs
          : created,
    ),
    messageCount: state.messageCount,
    firstMessage: state.firstMessage || "(no messages)",
  };
}

/**
 * Reads one session file, from where `prior` stopped when the file has only grown since. The
 * result has no info for a file that is not a session or cannot be read.
 */
async function scanSession(
  path: string,
  mtimeMs: number,
  prior: ScanState | null,
): Promise<ScanResult> {
  const resume = prior !== null && (await stillAppended(path, prior)) ? prior : null;
  const state: Omit<ScanState, "header"> & { header: ScanState["header"] | null } = resume
    ? { ...resume }
    : {
        header: null,
        name: undefined,
        messageCount: 0,
        firstMessage: "",
        lastActivity: undefined,
        offset: 0,
        guard: Buffer.alloc(0),
      };
  // The pieces of the line being read, joined once it is complete: a line that spans many chunks
  // (a screenshot) is copied once, not again with every chunk.
  let pieces: Buffer[] = [];
  try {
    for await (const chunk of createReadStream(path, {
      start: state.offset,
    }) as AsyncIterable<Buffer>) {
      let from = 0;
      for (let end = chunk.indexOf(10, from); end !== -1; end = chunk.indexOf(10, from)) {
        pieces.push(chunk.subarray(from, end));
        const raw = pieces.length === 1 ? pieces[0]! : Buffer.concat(pieces);
        if (!applyLine(state, raw.toString("utf8").replace(/\r$/, "")))
          return { info: null, state: null };
        state.offset += raw.length + 1;
        pieces = [];
        from = end + 1;
      }
      if (from < chunk.length) pieces.push(chunk.subarray(from));
    }
  } catch {
    return { info: null, state: null };
  }
  const carry = pieces.length > 1 ? Buffer.concat(pieces) : (pieces[0] ?? Buffer.alloc(0));
  // The bytes before the resume point, which the next scan checks. Without them there is nothing to
  // check a resume against, so this listing stands but the next one reads the file whole.
  const guard = await readBytes(
    path,
    Math.max(0, state.offset - GUARD_BYTES),
    Math.min(GUARD_BYTES, state.offset),
  ).catch(() => null);
  state.guard = guard ?? Buffer.alloc(0);
  const { header } = state;
  if (!header) return { info: null, state: null };
  // The last line may have no newline yet (it is still being written): it counts for the list, but
  // the next scan reads it again, whole.
  let shown = { ...state, header };
  if (carry.length > 0) {
    const partial = { ...state };
    if (applyLine(partial, carry.toString("utf8").replace(/\r$/, "")) && partial.header)
      shown = { ...partial, header: partial.header };
  }
  return { info: infoOf(path, mtimeMs, shown), state: guard ? { ...state, header } : null };
}
