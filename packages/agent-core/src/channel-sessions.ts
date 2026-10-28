/**
 * Pure pieces of the chat-channel conversations the host keeps: which saved session belongs to
 * which chat, who runs next, who is idle, and how a finished turn reads back. The Pi side lives in
 * the host.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { TurnResult } from "./channels/types.ts";

/** A chat's Pi session is released from memory after this long without a turn. */
export const CHAT_IDLE_MS = 30 * 60_000;

/** Title of a chat's conversation: `💬 <channel> – <date>`, like a scheduled run's title. */
export function channelTitle(channel: string, at: Date, locale: string): string {
  const date = at.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
  return `💬 ${channel} – ${date}`;
}

/** What a person picked for one chat with `/agent` and `/workspace`. */
export interface ChatChoice {
  agentId?: string;
  workspaceId?: string;
}

/**
 * Chat → saved session file (`channels.json` next to settings.json), so a restarted daemon
 * continues each conversation. A chat has a file once its session has been saved; `/new` drops it.
 */
interface ChatEntry {
  current: string;
  history: string[];
}

export class ChatSessionMap {
  private chats: Record<string, ChatEntry>;
  private choices: Record<string, ChatChoice>;

  constructor(private readonly path: string) {
    this.chats = {};
    this.choices = {};
    try {
      const raw = JSON.parse(readFileSync(path, "utf8")) as {
        chats?: unknown;
        choices?: unknown;
      } | null;
      const chats = raw?.chats;
      if (typeof chats === "object" && chats !== null && !Array.isArray(chats))
        for (const [key, value] of Object.entries(chats)) {
          // Old format: string. New format: { current, history[] }.
          if (typeof value === "string" && value) this.chats[key] = { current: value, history: [] };
          else if (typeof value === "object" && value !== null) {
            const entry = value as Record<string, unknown>;
            const current = typeof entry.current === "string" ? entry.current : "";
            const history = Array.isArray(entry.history)
              ? entry.history.filter((f): f is string => typeof f === "string" && !!f)
              : [];
            if (current) this.chats[key] = { current, history };
          }
        }
      const choices = raw?.choices;
      if (typeof choices === "object" && choices !== null && !Array.isArray(choices))
        for (const [key, value] of Object.entries(choices)) {
          const { agentId, workspaceId } = (value ?? {}) as Record<string, unknown>;
          const choice: ChatChoice = {
            ...(typeof agentId === "string" && agentId && { agentId }),
            ...(typeof workspaceId === "string" && workspaceId && { workspaceId }),
          };
          if (choice.agentId || choice.workspaceId) this.choices[key] = choice;
        }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        console.error("channels.json could not be read; starting with no chats.", error);
    }
  }

  get(chatKey: string): string | undefined {
    return this.chats[chatKey]?.current;
  }

  /** Every chat with a saved conversation, as `[chatKey, file]`. */
  entries(): [string, string][] {
    return Object.entries(this.chats).map(([key, entry]) => [key, entry.current]);
  }

  set(chatKey: string, file: string): void {
    const entry = this.chats[chatKey];
    if (entry?.current === file) return;
    const history = entry ? [entry.current, ...entry.history].slice(0, 20) : [];
    this.chats = { ...this.chats, [chatKey]: { current: file, history } };
    this.save();
  }

  /** Previous sessions of a chat, newest first (excluding the current one). */
  history(chatKey: string): string[] {
    return this.chats[chatKey]?.history ?? [];
  }

  /** Switches a chat to a previous session; false when it is not in the history. */
  resume(chatKey: string, file: string): boolean {
    const entry = this.chats[chatKey];
    if (!entry || !entry.history.includes(file)) return false;
    this.chats = {
      ...this.chats,
      [chatKey]: {
        current: file,
        history: [entry.current, ...entry.history.filter((f) => f !== file)].slice(0, 20),
      },
    };
    this.save();
    return true;
  }

  /** The agent and workspace the person picked in this chat (unset fields follow Settings). */
  choice(chatKey: string): ChatChoice {
    return this.choices[chatKey] ?? {};
  }

  /** Remembers the pick; it outlives `/new` and restarts. */
  setChoice(chatKey: string, patch: ChatChoice): void {
    this.choices = { ...this.choices, [chatKey]: { ...this.choices[chatKey], ...patch } };
    this.save();
  }

  /** Forgets the chat's conversation; false when it had none. */
  drop(chatKey: string): boolean {
    if (!(chatKey in this.chats)) return false;
    const { [chatKey]: _dropped, ...rest } = this.chats;
    this.chats = rest;
    this.save();
    return true;
  }

  private save(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const temp = `${this.path}.tmp`;
    writeFileSync(temp, JSON.stringify({ chats: this.chats, choices: this.choices }, null, 2), {
      mode: 0o600,
    });
    renameSync(temp, this.path);
  }
}

/**
 * The agent a chat uses: what the person picked in the chat, else the one pinned for the channel,
 * else the workspace's own agent; the first that still exists. `fallback` when none does.
 */
export function chatAgentId(
  candidates: readonly (string | null | undefined)[],
  exists: (id: string) => boolean,
  fallback: string,
): string {
  return candidates.find((id): id is string => !!id && exists(id)) ?? fallback;
}

/** Runs the tasks of one key one at a time, in order; different keys run side by side. */
export class KeyedQueue {
  private readonly tails = new Map<string, Promise<unknown>>();

  /** True while a task of `key` is running or waiting. */
  busy(key: string): boolean {
    return this.tails.has(key);
  }

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const result = (this.tails.get(key) ?? Promise.resolve()).then(() => task());
    // The tail never rejects, so one failed task does not stop the ones queued behind it.
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return result;
  }
}

/** Chats whose session sat unused for `idleMs` and that are not in a turn. */
export function idleChats(
  lastUsed: ReadonlyMap<string, number>,
  isBusy: (chatKey: string) => boolean,
  now: number,
  idleMs: number = CHAT_IDLE_MS,
): string[] {
  const idle: string[] = [];
  for (const [key, at] of lastUsed) if (now - at >= idleMs && !isBusy(key)) idle.push(key);
  return idle;
}

/** The text blocks of an assistant message, joined. */
export function assistantText(message: Pick<AssistantMessage, "content">): string {
  return message.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("")
    .trim();
}

/**
 * The outcome of a turn from the last assistant message it produced (undefined when it produced
 * none). `aborted` is set when the person stopped the turn.
 */
export function turnResult(
  reply: AssistantMessage | undefined,
  aborted: boolean,
  fallbacks: { failed: string; noAnswer: string },
): TurnResult {
  const text = reply ? assistantText(reply) : "";
  if (aborted || reply?.stopReason === "aborted") return { text, status: "aborted" };
  if (!reply) return { text, status: "error", error: fallbacks.noAnswer };
  if (reply.stopReason === "error")
    return { text, status: "error", error: reply.errorMessage || fallbacks.failed };
  return { text, status: "done" };
}
