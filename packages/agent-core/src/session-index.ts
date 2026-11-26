/**
 * What the agent knows about saved conversations (sessions): a stable id, what kind each is, which
 * chat it belongs to, and the prompt section that tells the model where it is. Pure functions; the
 * host feeds them the files Pi saved.
 */
import { basename } from "node:path";
import { contentText, fold, typedText } from "./history.ts";
import { redactSecrets } from "./redact.ts";

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
    .map((line, offset) => {
      const index = omitted + offset;
      const at = line.at
        ? ` (${new Date(line.at).toLocaleString(locale, { dateStyle: "short", timeStyle: "short" })})`
        : "";
      return `[#${index} ${line.role}${at}]\n${redactSecrets(line.text)}`;
    })
    .join("\n\n");
  return omitted > 0 ? `(${omitted} earlier messages not shown)\n\n${body}` : body;
}

/**
 * A window of `limit` messages centered on 0-based `around` (scroll mode around a search hit).
 */
export function formatHistoryAround(
  lines: readonly HistoryLine[],
  around: number,
  limit: number,
  locale: string,
): string {
  if (lines.length === 0) return "This session has no messages.";
  const count = Math.min(Math.max(1, Math.trunc(limit)), HISTORY_LIMIT.max);
  const anchor = Math.min(Math.max(0, Math.trunc(around)), lines.length - 1);
  const half = Math.floor(count / 2);
  let start = Math.max(0, anchor - half);
  const end = Math.min(lines.length, start + count);
  start = Math.max(0, end - count);
  const slice = lines.slice(start, end);
  const after = lines.length - end;
  const body = slice
    .map((line, offset) => {
      const index = start + offset;
      const mark = index === anchor ? " *" : "";
      const at = line.at
        ? ` (${new Date(line.at).toLocaleString(locale, { dateStyle: "short", timeStyle: "short" })})`
        : "";
      return `[#${index}${mark} ${line.role}${at}]\n${redactSecrets(line.text)}`;
    })
    .join("\n\n");
  const head = start > 0 ? `(${start} earlier messages not shown)\n\n` : "";
  const tail = after > 0 ? `\n\n(${after} later messages not shown)` : "";
  return `${head}${body}${tail}`;
}

const RELATIVE_BOUND = /^(\d+)\s*(h|d|w)$/i;
const RELATIVE_UNIT_MS: Record<string, number> = {
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};
const WORD = /[\p{L}\p{N}]+/gu;
const SNIPPET_RADIUS = 120;

/**
 * Parses a relative bound (`"24h"`, `"7d"`, `"2w"`) or ISO date/datetime into epoch milliseconds.
 * Returns null for empty or unrecognized strings.
 */
export function parseTimeBound(value: string | undefined, now: number = Date.now()): number | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const rel = RELATIVE_BOUND.exec(trimmed);
  if (rel) {
    const amount = Number(rel[1]);
    const unit = RELATIVE_UNIT_MS[rel[2]!.toLowerCase()];
    if (Number.isFinite(amount) && unit) return now - amount * unit;
  }
  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
}

/** One full-text hit inside a saved session. */
export interface SessionSearchMatch {
  session: SessionRow;
  /** 0-based index into the session's `historyLines`, passable to `history` (`around`). */
  messageIndex: number;
  role: "user" | "assistant";
  at: number | null;
  snippet: string;
  score: number;
}

function snippetAround(text: string, words: readonly string[]): string {
  const clean = redactSecrets(text).replace(/\s+/g, " ").trim();
  if (clean.length <= SNIPPET_RADIUS * 2) return clean;
  const folded = fold(clean.normalize("NFC"));
  let hit = -1;
  for (const word of words) {
    const pos = folded.indexOf(word);
    if (pos !== -1 && (hit === -1 || pos < hit)) hit = pos;
  }
  const center = hit === -1 ? 0 : hit;
  const start = Math.max(0, center - SNIPPET_RADIUS);
  const end = Math.min(clean.length, start + SNIPPET_RADIUS * 2);
  return `${start > 0 ? "…" : ""}${clean.slice(start, end)}${end < clean.length ? "…" : ""}`;
}

/**
 * Finds the best-matching message inside `lines` for `query` (accent-insensitive word match).
 * Returns null when no message matches.
 */
export function searchSessionHistory(
  session: SessionRow,
  lines: readonly HistoryLine[],
  query: string,
  bounds?: { after?: number | null; before?: number | null },
): SessionSearchMatch | null {
  const wanted = [...new Set(fold(query.normalize("NFC")).match(WORD) ?? [])];
  if (wanted.length === 0) return null;
  let best: SessionSearchMatch | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const stamp = line.at ?? session.modified;
    if (bounds?.after != null && stamp < bounds.after) continue;
    if (bounds?.before != null && stamp > bounds.before) continue;
    const words = fold(line.text.normalize("NFC")).match(WORD) ?? [];
    const score = wanted.filter((word) =>
      words.some((have) => have === word || (word.length >= 3 && have.startsWith(word))),
    ).length;
    if (score === 0) continue;
    if (!best || score > best.score || (score === best.score && index > best.messageIndex)) {
      best = {
        session,
        messageIndex: index,
        role: line.role,
        at: line.at,
        snippet: snippetAround(line.text, wanted),
        score,
      };
    }
  }
  return best;
}

/**
 * Ranks cross-session search hits: interactive sessions (`window`, `chat`) always rank ahead of
 * scheduled runs (`task`) so repetitive cron vocabulary never causes recall blindness; within each
 * tier, higher match score then newer session wins.
 */
export function rankSessionMatches(
  matches: readonly SessionSearchMatch[],
  limit: number,
): SessionSearchMatch[] {
  const cap = Math.min(Math.max(1, Math.trunc(limit)), SESSION_LIST_LIMIT.max);
  return matches
    .toSorted((a, b) => {
      const aDemoted = a.session.kind === "task" ? 1 : 0;
      const bDemoted = b.session.kind === "task" ? 1 : 0;
      if (aDemoted !== bDemoted) return aDemoted - bDemoted;
      if (b.score !== a.score) return b.score - a.score;
      return b.session.modified - a.session.modified;
    })
    .slice(0, cap);
}

/** Renders cross-session search hits with session id and `around` message index for scrolling. */
export function formatSearchMatches(
  matches: readonly SessionSearchMatch[],
  locale: string,
): string {
  if (matches.length === 0) return "No matching messages found.";
  return matches
    .map((hit) => {
      const at = new Date(hit.at ?? hit.session.modified).toLocaleString(locale, {
        dateStyle: "medium",
        timeStyle: "short",
      });
      const where = hit.session.peer
        ? `${hit.session.kind}, ${hit.session.peer}`
        : hit.session.kind;
      return [
        `- sessionId: ${hit.session.id}${hit.session.isCurrent ? "  (this session)" : ""}`,
        `  title: ${hit.session.title} (${where}; ${at})`,
        `  match at #${hit.messageIndex} (${hit.role}) — call action "history" with sessionId and around=${hit.messageIndex} to read surrounding context`,
        `  snippet: ${hit.snippet}`,
      ].join("\n");
    })
    .join("\n");
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
          "- Use the sessions tool to search past conversations (action search), list them (action list), read or scroll around a message (action history), and see delivery chats (action peers). Ids come from its results; never invent one.",
        ]
      : []),
  ].join("\n");
}
