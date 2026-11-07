import type { AgentMessage } from "@earendil-works/pi-agent-core";

type ToolResult = Extract<AgentMessage, { role: "toolResult" }>;

/** Newest tool output (in tokens) that is always sent in full. */
export const PROTECT_RECENT_TOKENS = 40_000;
/** Older output is only replaced when that frees at least this many tokens, so small chats are left alone. */
export const MIN_SAVINGS_TOKENS = 20_000;
/** A result smaller than this costs about as much as its placeholder; keep it. */
export const MIN_PRUNE_TOKENS = 50;
/** Newest tool results with images (screenshots) whose images are always sent. */
export const KEEP_RECENT_IMAGES = 3;
/** What an image of an older tool result is replaced with. */
export const IMAGE_PLACEHOLDER = "[Image omitted - an older screenshot or image]";

/** Rough estimate of about 4 characters per token; only used to decide what to prune. */
const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

/** Tokens of the placeholder that replaces a pruned result. */
const PLACEHOLDER_TOKENS = 8;

/** Text of a result made only of text; null when it carries images, which are pruned apart. */
function textOnly(result: ToolResult): string | null {
  let text = "";
  for (const block of result.content) {
    if (block.type !== "text") return null;
    text += block.text;
  }
  return text;
}

/**
 * Calls that read a skill's instructions; the model must keep following them. `readsSkill`
 * remembers the answer by call id: Pi hands over a fresh copy of the messages on each model call,
 * and a call's arguments (a whole file body for `write`) never change.
 */
function skillCallIds(
  messages: readonly AgentMessage[],
  readsSkill: Map<string, boolean>,
): Set<string> {
  const ids = new Set<string>();
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const block of message.content) {
      if (block.type !== "toolCall") continue;
      let skill = readsSkill.get(block.id);
      if (skill === undefined) {
        skill = JSON.stringify(block.arguments).includes("SKILL.md");
        readsSkill.set(block.id, skill);
      }
      if (skill) ids.add(block.id);
    }
  }
  return ids;
}

/**
 * The messages the model sees, with the output of old tool calls replaced by a short note. The
 * newest `PROTECT_RECENT_TOKENS` of output stay whole, and text output changes only when pruning
 * frees `MIN_SAVINGS_TOKENS`. Images of tool results older than the newest `KEEP_RECENT_IMAGES`
 * that carry one are always replaced by a placeholder; their text stays. The conversation itself is
 * untouched; only this copy sent to the model shrinks. `readsSkill` caches per tool call whether it
 * read a skill (see `createContextPruner`).
 */
export function pruneToolOutputs(
  messages: AgentMessage[],
  readsSkill: Map<string, boolean> = new Map(),
): AgentMessage[] {
  const skills = skillCallIds(messages, readsSkill);
  const prunable = new Map<number, number>();
  const withoutImages = new Set<number>();
  let images = 0;
  let recent = 0;
  let savings = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "toolResult") continue;
    const text = textOnly(message);
    if (text === null) {
      if (images < KEEP_RECENT_IMAGES) images += 1;
      else withoutImages.add(index);
      continue;
    }
    const tokens = estimateTokens(text);
    if (recent < PROTECT_RECENT_TOKENS) {
      recent += tokens;
      continue;
    }
    if (tokens < MIN_PRUNE_TOKENS || skills.has(message.toolCallId)) continue;
    prunable.set(index, tokens);
    savings += tokens - PLACEHOLDER_TOKENS;
  }
  if (savings < MIN_SAVINGS_TOKENS) prunable.clear();
  if (prunable.size === 0 && withoutImages.size === 0) return messages;
  return messages.map((message, index) => {
    if (message.role !== "toolResult") return message;
    if (withoutImages.has(index))
      return {
        ...message,
        content: message.content.map((block) =>
          block.type === "image" ? { type: "text" as const, text: IMAGE_PLACEHOLDER } : block,
        ),
      };
    const tokens = prunable.get(index);
    if (tokens === undefined) return message;
    return {
      ...message,
      content: [{ type: "text", text: `[Output truncated - ${tokens} tokens]` }],
    };
  });
}

/**
 * The pruner of one session: it remembers which tool calls read a skill, so a long history is not
 * re-serialized on every model call.
 */
export function createContextPruner(): (messages: AgentMessage[]) => AgentMessage[] {
  const readsSkill = new Map<string, boolean>();
  return (messages) => pruneToolOutputs(messages, readsSkill);
}
