import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";
import { parseSkillBlock, type SessionManager } from "@earendil-works/pi-coding-agent";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionSearchHit, SessionUsage } from "@workspace/shared";
import { splitAttachedFiles } from "./attachments.ts";
import type { TranscriptEntry } from "./transcript.ts";

/** Search hits returned at most; the person narrows the query rather than paging. */
export const MAX_HITS = 40;
/** Shortest query that is searched; a single letter matches nearly everything. */
export const MIN_QUERY_LENGTH = 2;
/** Session files read at the same time. */
const CONCURRENT_FILES = 6;
/** Characters of a message shown around the first match. */
const SNIPPET_LENGTH = 140;
/** Characters of context kept before the first match in a snippet. */
const SNIPPET_LEAD = 40;

export type Range = [number, number];

// -------------------------------------------------------------------------------------------
// Matching: ignore case and accents (including Vietnamese, where đ has no decomposition)
// -------------------------------------------------------------------------------------------

const MARKS = /\p{M}+/gu;

/** Lower case without accents: "Việt Nam" → "viet nam". */
export function fold(text: string): string {
  return text.normalize("NFD").replace(MARKS, "").toLowerCase().replaceAll("đ", "d");
}

/** The search words of a query, folded and de-duplicated. */
export function queryWords(query: string): string[] {
  return [...new Set(fold(query).split(/\s+/).filter(Boolean))];
}

/**
 * Where the words occur in `text`, as [start, end) ranges of the original text, overlapping ranges
 * merged. Empty unless every word occurs (a message matches a query only as a whole).
 */
export function findMatches(text: string, words: readonly string[]): Range[] {
  if (words.length === 0) return [];
  // Cheap rejection first: most messages of most conversations do not match.
  const quick = fold(text);
  if (!words.every((word) => quick.includes(word))) return [];

  // Fold character by character, remembering which original character each folded one came from.
  let folded = "";
  const origin: number[] = [];
  let index = 0;
  for (const char of text) {
    const piece = fold(char);
    for (let i = 0; i < piece.length; i += 1) origin.push(index);
    folded += piece;
    index += char.length;
  }
  origin.push(text.length);

  const ranges: Range[] = [];
  for (const word of words) {
    let from = 0;
    for (;;) {
      const at = folded.indexOf(word, from);
      if (at === -1) break;
      const start = origin[at] ?? 0;
      const end = origin[at + word.length] ?? text.length;
      ranges.push([start, end]);
      from = at + word.length;
    }
  }
  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: Range[] = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([range[0], range[1]]);
  }
  return merged;
}

/** A one-line excerpt around the first match, with the matches' ranges inside the excerpt. */
export function snippetAround(
  text: string,
  matches: readonly Range[],
): { snippet: string; matches: Range[] } {
  const flat = text.replace(/\s/g, " ");
  const first = matches[0]?.[0] ?? 0;
  const start = Math.max(0, first - SNIPPET_LEAD);
  const end = Math.min(flat.length, start + SNIPPET_LENGTH);
  const lead = start > 0 ? "…" : "";
  const tail = end < flat.length ? "…" : "";
  const shift = lead.length - start;
  return {
    snippet: `${lead}${flat.slice(start, end)}${tail}`,
    matches: matches
      .filter(([from, to]) => to > start && from < end)
      .map(([from, to]): Range => [Math.max(from, start) + shift, Math.min(to, end) + shift]),
  };
}

// -------------------------------------------------------------------------------------------
// Titles
// -------------------------------------------------------------------------------------------

const TITLE_LENGTH = 80;

/** What the person typed in a stored user message: no skill instructions, no attached-files block. */
export function typedText(raw: string): { text: string; files: string[]; skill: string | null } {
  const skill = parseSkillBlock(raw);
  const { text, files } = splitAttachedFiles(skill ? (skill.userMessage ?? "") : raw);
  return { text, files: files.map((file) => file.name), skill: skill?.name ?? null };
}

/**
 * Title of a conversation: its name, else the first thing the person said. `skillTitle` and
 * `untitled` are the translated fallbacks.
 */
export function sessionTitle(
  name: string | undefined,
  firstMessage: string,
  fallbacks: { skillTitle: (name: string) => string; untitled: string },
): string {
  const { text, skill } = typedText(firstMessage);
  const typed = text.replace(/\s+/g, " ").trim();
  const title = name?.trim() || typed || (skill ? fallbacks.skillTitle(skill) : fallbacks.untitled);
  return title.length > TITLE_LENGTH ? `${title.slice(0, TITLE_LENGTH - 1)}…` : title;
}

// -------------------------------------------------------------------------------------------
// Searching saved conversations
// -------------------------------------------------------------------------------------------

function record(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const fields: Record<string, unknown> = { ...value };
  return fields;
}

function parseLine(line: string): Record<string, unknown> | null {
  try {
    return record(JSON.parse(line));
  } catch {
    // A damaged line is skipped, like Pi does.
    return null;
  }
}

/** Text of a stored message's content: a string, or the text blocks of a block list. */
function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const texts: string[] = [];
  for (const block of content) {
    const fields = record(block);
    if (fields?.type === "text" && typeof fields.text === "string") texts.push(fields.text);
  }
  return texts.join("\n");
}

/** What the person would search for in a stored message: their own words and attached file names. */
function searchableText(role: "user" | "assistant", raw: string): string {
  if (role !== "user") return raw;
  const { text, files } = typedText(raw);
  return files.length > 0 ? `${text}\n${files.join("\n")}` : text;
}

interface SearchedFile {
  title: string;
  titleMatches: Range[];
  modified: number;
  cwd: string;
  /** First message that matches the query. */
  excerpt: { snippet: string; matches: Range[] } | null;
}

/** Reads one session file line by line, keeping nothing but what the search needs. */
async function searchFile(
  path: string,
  words: readonly string[],
  fallbacks: Parameters<typeof sessionTitle>[2],
): Promise<SearchedFile | null> {
  let cwd = "";
  let name: string | undefined;
  let firstMessage = "";
  let messageCount = 0;
  let modified = 0;
  let excerpt: SearchedFile["excerpt"] = null;
  let header = false;

  const lines = createInterface({
    input: createReadStream(path, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  try {
    for await (const line of lines) {
      if (!header) {
        header = true;
        const first = parseLine(line);
        if (first?.type !== "session") return null;
        if (typeof first.cwd === "string") cwd = first.cwd;
        continue;
      }
      // Tool results are the bulk of a file and never searched: skip them without parsing.
      if (line.includes('"type":"session_info"')) {
        const info = parseLine(line);
        name = typeof info?.name === "string" && info.name.trim() ? info.name : undefined;
        continue;
      }
      if (!line.includes('"type":"message"')) continue;
      messageCount += 1;
      if (!line.includes('"role":"user"') && !line.includes('"role":"assistant"')) continue;
      const entry = parseLine(line);
      const message = record(entry?.message);
      const role = message?.role;
      if (!entry || !message || (role !== "user" && role !== "assistant")) continue;
      const stamp =
        typeof message.timestamp === "number"
          ? message.timestamp
          : typeof entry.timestamp === "string"
            ? new Date(entry.timestamp).getTime()
            : Number.NaN;
      if (!Number.isNaN(stamp)) modified = Math.max(modified, stamp);
      const raw = contentText(message.content);
      if (!raw) continue;
      if (!firstMessage && role === "user") firstMessage = raw;
      if (excerpt) continue;
      const text = searchableText(role, raw);
      const matches = findMatches(text, words);
      if (matches.length > 0) excerpt = snippetAround(text, matches);
    }
  } catch {
    return null;
  } finally {
    lines.close();
  }
  if (messageCount === 0) return null;
  const title = sessionTitle(name, firstMessage, fallbacks);
  return {
    title,
    titleMatches: findMatches(title, words),
    modified:
      modified ||
      (await stat(path).then(
        (info) => info.mtimeMs,
        () => 0,
      )),
    cwd,
    excerpt,
  };
}

/**
 * Conversations whose title or messages contain every word of `query`, newest first, at most
 * `MAX_HITS`. Files are read newest first and a few at a time, and reading stops once enough
 * conversations matched, so a search stays quick with hundreds of saved conversations.
 */
export async function searchSessions(
  sessionDir: string,
  query: string,
  workspaceIdFor: (cwd: string) => string,
  fallbacks: Parameters<typeof sessionTitle>[2],
): Promise<SessionSearchHit[]> {
  const words = queryWords(query);
  if (fold(query).trim().length < MIN_QUERY_LENGTH) return [];

  const names = (await readdir(sessionDir).catch(() => [] as string[])).filter((file) =>
    file.endsWith(".jsonl"),
  );
  const files = (
    await Promise.all(
      names.map(async (file) => {
        const path = join(sessionDir, file);
        const info = await stat(path).catch(() => null);
        return info?.isFile() ? { path, mtime: info.mtimeMs } : null;
      }),
    )
  )
    .filter((file) => file !== null)
    .sort((a, b) => b.mtime - a.mtime);

  const hits: SessionSearchHit[] = [];
  for (let index = 0; index < files.length && hits.length < MAX_HITS; index += CONCURRENT_FILES) {
    const batch = await Promise.all(
      files.slice(index, index + CONCURRENT_FILES).map(async ({ path }) => {
        const found = await searchFile(path, words, fallbacks);
        return found && (found.excerpt || found.titleMatches.length > 0) ? { path, found } : null;
      }),
    );
    for (const entry of batch) {
      if (!entry) continue;
      const { path, found } = entry;
      hits.push({
        path,
        workspaceId: workspaceIdFor(found.cwd),
        title: found.title,
        titleMatches: found.titleMatches,
        modified: found.modified,
        snippet: found.excerpt?.snippet ?? "",
        snippetMatches: found.excerpt?.matches ?? [],
      });
    }
  }
  return hits.sort((a, b) => b.modified - a.modified).slice(0, MAX_HITS);
}

// -------------------------------------------------------------------------------------------
// Pins
// -------------------------------------------------------------------------------------------

/** Pins are stored by file name so they survive moving the user-data folder. */
export function pinKey(path: string): string {
  return basename(path);
}

// -------------------------------------------------------------------------------------------
// Branch of a conversation
// -------------------------------------------------------------------------------------------

/**
 * Every message on the conversation's branch, including those a compaction summarized away, with a
 * marker where each compaction happened and the id of each message's entry.
 */
export function branchEntries(manager: SessionManager): TranscriptEntry[] {
  return manager.getBranch().flatMap((entry): TranscriptEntry[] => {
    if (entry.type === "message") return [{ item: entry.message, entryId: entry.id }];
    return entry.type === "compaction" ? [{ item: { role: "compaction" } }] : [];
  });
}

/** Entry ids of the branch's user and assistant messages, in order: the ones the chat shows. */
export function chatEntryIds(manager: SessionManager): string[] {
  return manager
    .getBranch()
    .flatMap((entry) =>
      entry.type === "message" &&
      (entry.message.role === "user" || entry.message.role === "assistant")
        ? [entry.id]
        : [],
    );
}

/**
 * The entry a branch or a regeneration should end at so the kept conversation is complete: an
 * assistant message that called tools is followed by their results, which must stay with it.
 */
export function endOfTurnEntry(manager: SessionManager, entryId: string): string {
  const branch = manager.getBranch();
  const at = branch.findIndex((entry) => entry.id === entryId);
  if (at === -1) throw new Error(`Entry ${entryId} not found`);
  let end = at;
  const entry = branch[at];
  if (entry?.type === "message" && entry.message.role === "assistant") {
    while (true) {
      const next = branch[end + 1];
      if (next?.type === "message" && next.message.role === "toolResult") end += 1;
      else break;
    }
  }
  return branch[end]?.id ?? entryId;
}

/** Text and images of a stored user message, as they were sent to the model. */
export function userContent(message: AgentMessage): {
  text: string;
  images: Array<{ type: "image"; data: string; mimeType: string }>;
} {
  if (message.role !== "user") return { text: "", images: [] };
  if (typeof message.content === "string") return { text: message.content, images: [] };
  return {
    text: message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n"),
    images: message.content.filter((block) => block.type === "image"),
  };
}

// -------------------------------------------------------------------------------------------
// Usage and cost
// -------------------------------------------------------------------------------------------

/**
 * Sums the token usage of every assistant reply. A reply that used tokens but has no cost came from
 * a model without a known price: it is left out of `cost`, and `costPartial` says so.
 */
export function summarizeUsage(messages: readonly AgentMessage[]): SessionUsage {
  const usage: SessionUsage = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
    costPartial: false,
  };
  let priced = 0;
  let unpriced = 0;
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    const reply = message.usage;
    if (!reply) continue;
    const { input, output, cacheRead, cacheWrite } = reply;
    usage.input += input;
    usage.output += output;
    usage.cacheRead += cacheRead;
    usage.cacheWrite += cacheWrite;
    const total = reply.cost?.total ?? 0;
    if (total > 0) {
      usage.cost = (usage.cost ?? 0) + total;
      priced += 1;
    } else if (input + output + cacheRead + cacheWrite > 0) {
      unpriced += 1;
    }
  }
  if (unpriced > 0) {
    usage.costPartial = priced > 0;
    if (priced === 0) usage.cost = null;
  }
  return usage;
}
