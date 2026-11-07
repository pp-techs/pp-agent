import { closeSync, mkdirSync, openSync, readSync, statSync } from "node:fs";
import { appendFile, readFile, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { AgentEvent } from "@workspace/shared";

/** The log is rotated once it passes this, so the current file and its predecessor stay under 2×. */
const MAX_LOG_BYTES = 1024 * 1024;
/** Longest text kept in one field; a provider's error page or a stack trace is cut here. */
const MAX_FIELD_CHARS = 4_000;
/** How deep a field's objects are followed before they are cut off. */
const MAX_DEPTH = 4;
/** Model errors already logged, so an event sent again does not log twice. */
const MAX_SEEN_ERRORS = 500;

const REDACTED = "[redacted]";

/**
 * Hides what must not leave the machine in a log the person sends away: keys, tokens, sign-in
 * cookies, inline files, and the account name inside file paths.
 */
export function redact(text: string, home?: string): string {
  let result = text;
  if (home && home.length > 1) result = result.split(home).join("~");
  return result
    .replace(/data:[\w/+.-]+;base64,[A-Za-z0-9+/=]{64,}/g, "data:[base64 omitted]")
    .replace(/\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]+/g, REDACTED)
    .replace(/\b(Bearer|Basic)\s+[\w.~+/=-]{8,}/gi, `$1 ${REDACTED}`)
    .replace(/\b(?:sk|pk|rk)-[\w-]{16,}/g, REDACTED)
    .replace(
      /("?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|token|secret|password|passwd|authorization|cookie|set-cookie)"?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;&}]+)/gi,
      `$1${REDACTED}`,
    )
    .replace(
      /([?&](?:key|api_?key|token|access_token|auth|code|signature|sig)=)[^&\s"']+/gi,
      `$1${REDACTED}`,
    );
}

function sanitize(value: unknown, home: string | undefined, depth = 0): unknown {
  if (typeof value === "string") {
    const clipped =
      value.length > MAX_FIELD_CHARS ? `${value.slice(0, MAX_FIELD_CHARS)}… [cut]` : value;
    return redact(clipped, home);
  }
  if (typeof value !== "object" || value === null) return value;
  if (depth >= MAX_DEPTH) return "[cut]";
  if (Array.isArray(value)) return value.map((item) => sanitize(item, home, depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, sanitize(item, home, depth + 1)]),
  );
}

/** What the audit log keeps of an event the agent sent; null for the ones that are not worth a line. */
export function auditEntryFor(
  event: AgentEvent,
): { kind: string; data: Record<string, unknown> } | null {
  switch (event.type) {
    case "status":
      return { kind: "status", data: { status: event.status } };
    case "message":
      // The text of messages is the conversation; only a failed turn is kept, as the model said it.
      return event.message.errorDetail
        ? {
            kind: "model_error",
            data: {
              messageId: event.message.id,
              shown: event.message.error,
              detail: event.message.errorDetail,
            },
          }
        : null;
    case "approval_requested":
      return {
        kind: "approval_requested",
        data: {
          requestId: event.request.requestId,
          tool: event.request.toolName,
          tier: event.request.tier,
        },
      };
    case "approval_resolved":
      return { kind: "approval_resolved", data: { requestId: event.requestId } };
    case "settings_changed":
      return { kind: "settings_changed", data: { scopes: event.scopes } };
    case "error":
      return { kind: "agent_error", data: { message: event.message } };
    default:
      return null;
  }
}

export interface AuditLogOptions {
  /** Folder for the log files; created when missing. */
  dir: string;
  /** The person's home folder, written as `~` in the log. */
  home?: string;
  maxBytes?: number;
}

/**
 * A local record, one JSON object per line, of what went wrong or changed while the app ran: for
 * the person to hand to whoever debugs it. Writing never throws; a log that cannot be written
 * must not break the app. Lines are written off the main thread's critical path: `record` queues
 * them and one write at a time appends everything queued so far.
 */
export class AuditLog {
  readonly file: string;
  private readonly previous: string;
  private readonly home: string | undefined;
  private readonly maxBytes: number;
  private size = 0;
  private readonly seenErrors = new Set<string>();
  /** Lines recorded but not yet handed to a write. */
  private pending: string[] = [];
  /** A write of `pending` is queued and has not started yet. */
  private writeQueued = false;
  /** Every file operation runs after the previous one, so lines stay in order. */
  private queue: Promise<void> = Promise.resolve();

  constructor(options: AuditLogOptions) {
    this.file = join(options.dir, "audit.log");
    this.previous = join(options.dir, "audit.1.log");
    this.home = options.home;
    this.maxBytes = options.maxBytes ?? MAX_LOG_BYTES;
    try {
      mkdirSync(options.dir, { recursive: true });
      this.size = statSync(this.file).size;
    } catch {
      // No file yet.
    }
  }

  record(kind: string, data: Record<string, unknown> = {}): void {
    try {
      this.pending.push(
        `${JSON.stringify({
          time: new Date().toISOString(),
          kind,
          ...(sanitize(data, this.home) as Record<string, unknown>),
        })}\n`,
      );
    } catch (error) {
      console.error("Could not write the audit log:", error);
      return;
    }
    if (this.writeQueued) return;
    this.writeQueued = true;
    void this.enqueue(() => this.writePending());
  }

  /** Runs `task` after every queued file operation; a failure is reported, never thrown at `record`. */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task);
    this.queue = result.then(
      () => undefined,
      (error: unknown) => console.error("Could not write the audit log:", error),
    );
    return result;
  }

  private async writePending(): Promise<void> {
    this.writeQueued = false;
    const lines = this.pending;
    this.pending = [];
    let chunk = "";
    for (const line of lines) {
      const bytes = Buffer.byteLength(line);
      if (this.size > 0 && this.size + bytes > this.maxBytes) {
        if (chunk) await appendFile(this.file, chunk);
        chunk = "";
        await rename(this.file, this.previous);
        this.size = 0;
      }
      chunk += line;
      this.size += bytes;
    }
    if (chunk) await appendFile(this.file, chunk);
  }

  /** Logs what an event from the agent means for the audit log, if anything. */
  event(event: AgentEvent, context: Record<string, unknown> = {}): void {
    const entry = auditEntryFor(event);
    if (!entry) return;
    // Message ids restart in every conversation, so the same id in another one is a new failure.
    // A temporary conversation has no session to tell it apart by and is never deduplicated.
    if (event.type === "message" && typeof context.session === "string") {
      const key = `${context.session}\n${event.message.id}\n${event.message.errorDetail}`;
      if (this.seenErrors.has(key)) return;
      if (this.seenErrors.size >= MAX_SEEN_ERRORS) this.seenErrors.clear();
      this.seenErrors.add(key);
    }
    this.record(entry.kind, { ...entry.data, ...context });
  }

  /** The older file first, then the current one, once queued lines are written. */
  read(): Promise<string> {
    return this.enqueue(async () => {
      const parts = await Promise.all(
        [this.previous, this.file].map((path) => readFile(path, "utf8").catch(() => "")),
      );
      return parts.join("");
    });
  }

  /** Bytes the log files take, once queued lines are written. */
  bytes(): Promise<number> {
    return this.enqueue(async () => {
      const sizes = await Promise.all(
        [this.previous, this.file].map((path) =>
          stat(path).then(
            (stats) => stats.size,
            () => 0,
          ),
        ),
      );
      return sizes.reduce((sum, size) => sum + size, 0);
    });
  }

  /** Removes both files; lines recorded before this call are removed with them. */
  clear(): Promise<void> {
    this.seenErrors.clear();
    return this.enqueue(async () => {
      await rm(this.previous, { force: true });
      await rm(this.file, { force: true });
      this.size = 0;
    });
  }
}

/** The last `bytes` of a text file, cut at a line start; "" when it cannot be read. */
export function readTail(path: string, bytes: number): string {
  let fd: number | null = null;
  try {
    fd = openSync(path, "r");
    const { size } = statSync(path);
    const length = Math.min(size, bytes);
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, size - length);
    const text = buffer.toString("utf8");
    if (length === size) return text;
    const firstLine = text.indexOf("\n");
    return firstLine === -1 ? text : text.slice(firstLine + 1);
  } catch {
    return "";
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

export interface ReportInput {
  /** Facts about the app and the system, one line each. */
  facts: Record<string, string>;
  /** The daemon's own log, whose tail is included. */
  daemonLog: string;
  daemonLogBytes: number;
  home?: string;
}

/** The text a person sends to whoever debugs a problem: system facts, the audit log, the daemon's log tail. */
export async function buildReport(audit: AuditLog, input: ReportInput): Promise<string> {
  const facts = Object.entries(input.facts)
    .map(([name, value]) => `${name}: ${redact(value, input.home)}`)
    .join("\n");
  const daemon = redact(readTail(input.daemonLog, input.daemonLogBytes), input.home);
  const auditText = await audit.read();
  return [
    "PP Agent diagnostics",
    facts,
    "",
    "=== Audit log (one JSON object per line) ===",
    auditText.trim() || "(empty)",
    "",
    `=== Background service log (last ${Math.round(input.daemonLogBytes / 1024)} KB) ===`,
    daemon.trim() || "(empty)",
    "",
  ].join("\n");
}
