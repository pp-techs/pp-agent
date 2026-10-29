/**
 * Background memory extraction: after a conversation settles unseen, a separate one-shot LLM call
 * (same pattern as `delegate_task` in subagent.ts) reads the turns the person was not watching and
 * proposes lasting facts or preferences. Notes are written straight to `MemoryStore.add`, the same
 * call `saveMemoryEntry` makes; the model never sees or calls the `memory_save` tool for this.
 *
 * This never runs on the person's behalf while they watch: it only looks at a background
 * conversation once it has settled (`agent_settled` with nobody looking), so it never slows down a
 * reply and never doubles as the model's own `memory_save` tool calls.
 */
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AgentSession, ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@earendil-works/pi-ai";
import { MEMORY_LIMITS } from "@workspace/shared";

type UserMessage = Extract<AgentMessage, { role: "user" }>;
type AssistantMessage = Extract<AgentMessage, { role: "assistant" }>;
import type { MemoryStore } from "./memory.ts";

/** Turns shorter than this are very unlikely to contain a lasting fact; skip the LLM call. */
const MIN_CHARS = 40;
/** Longest transcript slice sent to the extraction call. */
const MAX_INPUT_CHARS = 20_000;
/** Longest extraction call. */
const TIME_LIMIT_MS = 60_000;

const EXTRACTION_PROMPT = `You read one slice of a conversation between a person and an AI assistant. Find lasting facts or preferences about the person or their work that would be useful to remember in future, unrelated conversations: stable preferences ("reply in Vietnamese", "prefers terse commit messages"), durable facts ("our fiscal year starts in April", "the staging DB is on RDS"), or explicit requests to remember something.

Ignore anything that only matters for this one task, small talk, and anything already obviously tied to one conversation. Never invent facts that are not stated or clearly implied. Never capture secrets, passwords, tokens, keys, or long text copied from a file or web page.

Reply with ONLY a JSON array (no prose, no code fence). Each item: {"text": string, "tag": string | null, "scope": "global" | "workspace"}. "text" is one short plain sentence (at most ${MEMORY_LIMITS.maxEntryLength} characters). "tag" is an optional one-word label such as "preference" or "project", or null. "scope" is "workspace" only for a fact tied to this one project (e.g. "the staging DB is on RDS"); use "global" for anything about the person themselves that holds everywhere. If there is nothing worth remembering, reply with []. Reply with [] rather than guess.`;

interface ExtractedNote {
  text: string;
  tag: string | null;
  scope: "global" | "workspace";
}

/** A content block that carries plain text, shared by user and assistant message content. */
interface TextBlock {
  type: "text";
  text: string;
}

function isTextBlock(block: { type: string }): block is TextBlock {
  return block.type === "text";
}

function userText(message: UserMessage): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .filter(isTextBlock)
    .map((block) => block.text)
    .join("\n");
}

function assistantText(message: AssistantMessage): string {
  return message.content
    .filter(isTextBlock)
    .map((block) => block.text)
    .join("\n");
}

/** Plain text of a message's text blocks, in the order they appear; empty for tool-only turns. */
function messageText(message: AgentMessage): string {
  if (message.role === "user") return userText(message);
  if (message.role === "assistant") return assistantText(message);
  return "";
}

/**
 * The conversation as `User: ...` / `Assistant: ...` lines, newest `MAX_INPUT_CHARS` characters
 * kept (the extraction call cares about what was just said, not the whole history).
 */
export function transcriptText(messages: readonly AgentMessage[]): string {
  const lines = messages
    .map((message) => {
      const text = messageText(message).trim();
      if (!text) return null;
      const who = message.role === "user" ? "User" : "Assistant";
      return `${who}: ${text}`;
    })
    .filter((line): line is string => line !== null);
  const joined = lines.join("\n");
  return joined.length > MAX_INPUT_CHARS ? joined.slice(-MAX_INPUT_CHARS) : joined;
}

/** Parses the model's reply into notes; malformed or missing fields drop that one item. */
export function parseExtractedNotes(reply: string): ExtractedNote[] {
  const cleaned = reply
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  let raw: unknown;
  try {
    raw = JSON.parse(cleaned);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const notes: ExtractedNote[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const { text, tag, scope } = item as Record<string, unknown>;
    if (typeof text !== "string" || !text.trim()) continue;
    notes.push({
      text: text.trim().slice(0, MEMORY_LIMITS.maxEntryLength),
      tag: typeof tag === "string" && tag.trim() ? tag.trim() : null,
      scope: scope === "workspace" ? "workspace" : "global",
    });
  }
  return notes;
}

export interface MemoryExtractionOptions {
  runtime: ModelRuntime;
  cwd: string;
  agentDir: string;
  model: Model<Api>;
  store: MemoryStore;
  /** Notes with `scope: "workspace"` land here; null means there is no workspace to put them in. */
  workspaceId: string | null;
  /** Called once per note actually written, so the app can refresh Settings. */
  onSaved: (note: ExtractedNote) => void;
}

/**
 * Runs the extraction call over `messages` and writes whatever it finds to `options.store`.
 * Errors (model unavailable, bad JSON, the call failing) are swallowed: this is a best-effort
 * background pass, never something a failure should surface to the person.
 */
export async function extractMemory(
  messages: readonly AgentMessage[],
  options: MemoryExtractionOptions,
): Promise<void> {
  const input = transcriptText(messages);
  if (input.length < MIN_CHARS) return;

  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: false },
    retry: { enabled: true, maxRetries: 1 },
  });
  const resourceLoader = new DefaultResourceLoader({
    cwd: options.cwd,
    agentDir: options.agentDir,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    systemPrompt: EXTRACTION_PROMPT,
  });

  let session: AgentSession | undefined;
  try {
    await resourceLoader.reload();
    ({ session } = await createAgentSession({
      cwd: options.cwd,
      agentDir: options.agentDir,
      modelRuntime: options.runtime,
      model: options.model,
      thinkingLevel: "off",
      tools: [],
      customTools: [],
      resourceLoader,
      settingsManager,
      sessionManager: SessionManager.inMemory(options.cwd),
    }));
    await session.bindExtensions({ mode: "rpc" });

    const timer = setTimeout(() => void session?.abort(), TIME_LIMIT_MS);
    try {
      await session.prompt(input);
    } finally {
      clearTimeout(timer);
    }

    const last = session.messages.toReversed().find((message) => message.role === "assistant");
    const reply = last ? messageText(last) : "";
    if (!reply) return;

    for (const note of parseExtractedNotes(reply)) {
      const result = options.store.add({
        text: note.text,
        tag: note.tag,
        workspaceId: note.scope === "workspace" ? options.workspaceId : null,
      });
      if (result.ok && result.status === "added") options.onSaved(note);
    }
  } catch (error) {
    console.error(
      "Background memory extraction failed; no notes were saved from this pass.",
      error,
    );
  } finally {
    session?.dispose();
  }
}
