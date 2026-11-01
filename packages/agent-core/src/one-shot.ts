/**
 * One-shot background calls (conversation titles, memory): a throwaway in-memory Pi session with
 * one system prompt, no tools, extensions or skills, that answers one prompt. Also the transcript
 * helpers both calls read conversations with.
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

/** Plain text of a message's text blocks, in the order they appear; empty for tool-only turns. */
export function messageText(message: AgentMessage): string {
  if (message.role === "user") return userText(message);
  if (message.role === "assistant") return assistantText(message);
  return "";
}

/**
 * The conversation as `User: ...` / `Assistant: ...` lines, cut to `maxChars`: the oldest part
 * when `keep` is "start" (what a conversation opened with), the newest when "end" (what was just
 * said). Text that would close `closingTag` is escaped, so a message cannot end the block the
 * transcript sits in.
 */
export function transcript(
  messages: readonly AgentMessage[],
  options: { maxChars: number; keep: "start" | "end"; closingTag: string },
): string {
  const closing = new RegExp(`</(\\s*${options.closingTag}\\b)`, "gi");
  const joined = messages
    .map((message) => {
      const text = messageText(message).trim();
      if (!text) return null;
      return `${message.role === "user" ? "User" : "Assistant"}: ${text}`;
    })
    .filter((line): line is string => line !== null)
    .join("\n")
    .replace(closing, "<\\/$1");
  if (joined.length <= options.maxChars) return joined;
  return options.keep === "start"
    ? joined.slice(0, options.maxChars)
    : joined.slice(-options.maxChars);
}

export interface OneShotOptions {
  runtime: ModelRuntime;
  cwd: string;
  agentDir: string;
  model: Model<Api>;
  systemPrompt: string;
  prompt: string;
  timeoutMs: number;
}

/**
 * The model's reply text to `prompt` (empty when it gave none). Throws when the call fails; the
 * call is aborted after `timeoutMs`.
 */
export async function runOneShot(options: OneShotOptions): Promise<string> {
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
    systemPrompt: options.systemPrompt,
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

    const timer = setTimeout(() => void session?.abort(), options.timeoutMs);
    try {
      await session.prompt(options.prompt);
    } finally {
      clearTimeout(timer);
    }
    const last = session.messages.toReversed().find((message) => message.role === "assistant");
    return last ? messageText(last) : "";
  } finally {
    session?.dispose();
  }
}
