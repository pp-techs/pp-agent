/**
 * What the agent knows about saved conversations (sessions): a stable id, what kind each is, which
 * chat it belongs to, and the prompt section that tells the model where it is. Pure functions; the
 * host feeds them the files Pi saved.
 */
import { basename } from "node:path";
import { contentText, typedText } from "./history.ts";

/** `chat`: a chat channel's conversation; `task`: a scheduled run; `window`: the desktop window. */
export type SessionKind = "chat" | "task" | "window";

/** `all`: every saved session; `self`: only the one the model is running in. */
export type SessionVisibility = "all" | "self";

/** A session as `sessions` lists it. */
export interface SessionRow {
  /** Stable id: the file name without `.jsonl`. */
  id: string;
  title: string;
  kind: SessionKind;
  /** Chat key such as `telegram:123` for a chat session. */
  peer: string | null;
  workspaceId: string;
  /** Last change, epoch milliseconds. */
  modified: number;
  messageCount: number;
  /** The start of the first thing the person said. */
  preview: string;
  isCurrent: boolean;
}

export const PREVIEW_LENGTH = 120;
export const HISTORY_LIMIT = { default: 20, max: 50 } as const;
export const HISTORY_TEXT_LENGTH = 2_000;

/** The id of the session saved at `path`. */
export function sessionRef(path: string): string {
  return basename(path).replace(/\.jsonl$/, "");
}

/**
 * Kind and chat of a session file. `chatFiles` maps a session file to its chat key and `taskFiles`
 * holds the files scheduled runs wrote; anything else was opened in the window.
 */
export function classifySession(
  path: string,
  chatFiles: ReadonlyMap<string, string>,
  taskFiles: ReadonlySet<string>,
): { kind: SessionKind; peer: string | null } {
  const peer = chatFiles.get(path);
  if (peer !== undefined) return { kind: "chat", peer };
  if (taskFiles.has(path)) return { kind: "task", peer: null };
  return { kind: "window", peer: null };
}

/** One line of what the person first typed, without skill or attached-file blocks. */
export function previewOf(firstMessage: string): string {
  const text = typedText(firstMessage).text.replace(/\s+/g, " ").trim();
  return text.length > PREVIEW_LENGTH ? `${text.slice(0, PREVIEW_LENGTH - 1)}…` : text;
}

export interface SessionFilter {
  kind?: SessionKind;
  /** Chat key, for example `telegram:123`. */
  peer?: string;
  /** Words that must all occur in the title or the preview (case-insensitive). */
  search?: string;
  limit?: number;
}

export const SESSION_LIST_LIMIT = { default: 20, max: 100 } as const;

/** Rows the model may see, filtered and cut to the limit; `rows` are expected newest first. */
export function selectSessions(
  rows: readonly SessionRow[],
  visibility: SessionVisibility,
  filter: SessionFilter,
): SessionRow[] {
  const words = (filter.search ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const limit = Math.min(
    Math.max(1, Math.trunc(filter.limit ?? SESSION_LIST_LIMIT.default)),
    SESSION_LIST_LIMIT.max,
  );
  return rows
    .filter((row) => visibility === "all" || row.isCurrent)
    .filter((row) => !filter.kind || row.kind === filter.kind)
    .filter((row) => !filter.peer || row.peer === filter.peer)
    .filter((row) => {
      const haystack = `${row.title} ${row.preview}`.toLowerCase();
      return words.every((word) => haystack.includes(word));
    })
    .slice(0, limit);
}

/** The model's view of a list: one block per session, so ids can be copied exactly. */
export function formatSessions(rows: readonly SessionRow[], locale: string): string {
  if (rows.length === 0) return "No sessions.";
  return rows
    .map((row) => {
      const at = new Date(row.modified).toLocaleString(locale, {
        dateStyle: "medium",
        timeStyle: "short",
      });
      const where = row.peer ? `${row.kind}, ${row.peer}` : row.kind;
      return [
        `- id: ${row.id}${row.isCurrent ? "  (this session)" : ""}`,
        `  title: ${row.title}`,
        `  kind: ${where}; workspace: ${row.workspaceId}; ${row.messageCount} messages; last change ${at}`,
        ...(row.preview ? [`  first message: ${row.preview}`] : []),
      ].join("\n");
    })
    .join("\n");
}

/** A stored message reduced to what `history` shows. */
export interface HistoryLine {
  role: "user" | "assistant";
  text: string;
  at: number | null;
}

/**
 * The user and assistant messages of a branch as plain text (no tool traffic), each cut to
 * `HISTORY_TEXT_LENGTH`. Messages that carry no text are skipped.
 */
export function historyLines(items: readonly unknown[]): HistoryLine[] {
  const lines: HistoryLine[] = [];
  for (const item of items) {
    if (typeof item !== "object" || item === null) continue;
    const message = item as { role?: unknown; content?: unknown; timestamp?: unknown };
    if (message.role !== "user" && message.role !== "assistant") continue;
    const raw = contentText(message.content);
    const text = (message.role === "user" ? typedText(raw).text : raw).trim();
    if (!text) continue;
    lines.push({
      role: message.role,
      text: text.length > HISTORY_TEXT_LENGTH ? `${text.slice(0, HISTORY_TEXT_LENGTH - 1)}…` : text,
      at: typeof message.timestamp === "number" ? message.timestamp : null,
    });
  }
  return lines;
}

/** The last `limit` lines, as text the model can read. */
export function formatHistory(
  lines: readonly HistoryLine[],
  limit: number,
  locale: string,
): string {
  const count = Math.min(Math.max(1, Math.trunc(limit)), HISTORY_LIMIT.max);
  const tail = lines.slice(-count);
  if (tail.length === 0) return "This session has no messages.";
  const omitted = lines.length - tail.length;
  const body = tail
    .map((line) => {
      const at = line.at
        ? ` (${new Date(line.at).toLocaleString(locale, { dateStyle: "short", timeStyle: "short" })})`
        : "";
      return `[${line.role}${at}]\n${line.text}`;
    })
    .join("\n\n");
  return omitted > 0 ? `(${omitted} earlier messages not shown)\n\n${body}` : body;
}

/** Where the model is running, for its system prompt. */
export interface SessionContext {
  now: Date;
  timeZone: string;
  /** Id of the session being run; null before the first message is saved. */
  sessionId: string | null;
  kind: SessionKind;
  /** Words for the surface: "the desktop window", "a Telegram chat", "a scheduled run". */
  surface: string;
  /** The person's own chat on a channel, such as "Telegram (Nhat)"; null when none is paired. */
  home: string | null;
  /** Whether the `sessions` tool is active. */
  sessionsTool: boolean;
}

/**
 * The prompt section that says what day it is, which session this is and where it runs. The date
 * (not the time) is given so the prompt stays the same all day; `current_datetime` has the time.
 */
export function sessionContextSection(context: SessionContext): string {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: context.timeZone,
    weekday: "long",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(context.now);
  return [
    "## Where you are",
    `- Today is ${date} (time zone ${context.timeZone}). Call current_datetime for the exact time.`,
    `- This conversation is ${context.surface}${context.sessionId ? `, session id ${context.sessionId}` : ""}.`,
    context.home
      ? `- The user's own chat is ${context.home}.`
      : "- The user has no chat channel paired.",
    ...(context.sessionsTool
      ? [
          "- Use the sessions tool to find other conversations (action list, history) and the places a message can be delivered (action peers). Ids come from its results; never invent one.",
        ]
      : []),
  ].join("\n");
}
