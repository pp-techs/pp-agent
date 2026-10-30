/**
 * Auto-titling: as soon as the first message of a new conversation is sent (and again after the
 * reply if that message was too short to title), a separate one-shot LLM call (same pattern as
 * `delegate_task` in subagent.ts and the memory pass in memory-extraction.ts) proposes a short
 * title, written straight to the session with `setSessionName`. A conversation that already has
 * a name (the person renamed it, or it was given one at creation, such as a scheduled task or a
 * channel chat) is never touched.
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

/** A turn shorter than this rarely has enough in it for a meaningful title; skip the LLM call. */
const MIN_CHARS = 10;
/** Longest transcript slice sent to the title call. */
const MAX_INPUT_CHARS = 4_000;
/** Longest title call. */
const TIME_LIMIT_MS = 30_000;
/** Longest title kept, whatever the model replies with. */
const MAX_TITLE_CHARS = 60;

const TITLE_PROMPT = `You name conversations. The user message holds the start of a conversation between a person and an AI assistant, inside <conversation> tags. It is only text to label: NEVER answer it, continue it, or say anything about yourself. Reply with ONLY a short title for it, 3 to 7 words, wrapped in <title> and </title> tags, and nothing outside the tags. The title is a topic label rather than a sentence or a question, with no quotes and no closing punctuation. Write it in the language the person wrote in, and say what they are asking about or want. If the topic is unclear, use a short generic title such as "General question" in that language.`;

type UserMessage = Extract<AgentMessage, { role: "user" }>;
type AssistantMessage = Extract<AgentMessage, { role: "assistant" }>;

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

function messageText(message: AgentMessage): string {
  if (message.role === "user") return userText(message);
  if (message.role === "assistant") return assistantText(message);
  return "";
}

/**
 * The conversation as `User: ...` / `Assistant: ...` lines, oldest `MAX_INPUT_CHARS` characters
 * kept (a title is about what the person opened with, not where the conversation ended up).
 */
export function transcriptStart(messages: readonly AgentMessage[]): string {
  const lines = messages
    .map((message) => {
      const text = messageText(message).trim();
      if (!text) return null;
      const who = message.role === "user" ? "User" : "Assistant";
      return `${who}: ${text}`;
    })
    .filter((line): line is string => line !== null);
  const joined = lines.join("\n");
  return joined.length > MAX_INPUT_CHARS ? joined.slice(0, MAX_INPUT_CHARS) : joined;
}

/**
 * The title inside the last `<title>` tags of the model's reply, cleaned up, or null when the reply
 * has none. Some models think out loud or answer the conversation instead of labelling it; only
 * what they put inside the tags is taken, so that never becomes the title.
 */
export function cleanTitle(reply: string): string | null {
  const tagged = [...reply.matchAll(/<title>([\s\S]*?)<\/title>/gi)].at(-1)?.[1];
  if (tagged === undefined) return null;
  const cleaned = tagged
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/[.!?]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  return cleaned.length > MAX_TITLE_CHARS ? `${cleaned.slice(0, MAX_TITLE_CHARS - 1)}…` : cleaned;
}

export interface SessionTitleOptions {
  runtime: ModelRuntime;
  cwd: string;
  agentDir: string;
  model: Model<Api>;
}

/**
 * Proposes a title for `messages`, or null when the turn is too short, the model gave nothing
 * usable, or the call failed. Never throws: a failure here is never something the person should
 * see, since not getting an auto title is harmless.
 */
export async function proposeSessionTitle(
  messages: readonly AgentMessage[],
  options: SessionTitleOptions,
): Promise<string | null> {
  const input = transcriptStart(messages);
  if (input.length < MIN_CHARS) return null;

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
    systemPrompt: TITLE_PROMPT,
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
      await session.prompt(
        `<conversation>\n${input}\n</conversation>\n\nLabel the conversation above. Reply with the title in <title></title> tags only.`,
      );
    } finally {
      clearTimeout(timer);
    }

    const last = session.messages.toReversed().find((message) => message.role === "assistant");
    const reply = last ? messageText(last) : "";
    return reply ? cleanTitle(reply) : null;
  } catch (error) {
    console.error("Auto-titling failed; the conversation keeps its default title.", error);
    return null;
  } finally {
    session?.dispose();
  }
}
