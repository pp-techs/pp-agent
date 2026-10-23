import type { AgentMessage } from "@earendil-works/pi-agent-core";

type ToolResult = Extract<AgentMessage, { role: "toolResult" }>;

/** Newest tool output (in tokens) that is always sent in full. */
export const PROTECT_RECENT_TOKENS = 40_000;
/** Older output is only replaced when that frees at least this many tokens, so small chats are left alone. */
export const MIN_SAVINGS_TOKENS = 20_000;
/** A result smaller than this costs about as much as its placeholder; keep it. */
export const MIN_PRUNE_TOKENS = 50;

/** Rough estimate of about 4 characters per token; only used to decide what to prune. */
const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

/** Tokens of the placeholder that replaces a pruned result. */
const PLACEHOLDER_TOKENS = 8;

/** Text of a result made only of text; null when it carries images, which are left untouched. */
function textOnly(result: ToolResult): string | null {
  let text = "";
  for (const block of result.content) {
    if (block.type !== "text") return null;
    text += block.text;
  }
  return text;
}

/** Calls that read a skill's instructions; the model must keep following them. */
function skillCallIds(messages: readonly AgentMessage[]): Set<string> {
  const ids = new Set<string>();
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const block of message.content) {
      if (block.type === "toolCall" && JSON.stringify(block.arguments).includes("SKILL.md"))
        ids.add(block.id);
    }
  }
  return ids;
}

/**
 * The messages the model sees, with the output of old tool calls replaced by a short note. The
 * newest `PROTECT_RECENT_TOKENS` of output stay whole, and nothing changes unless pruning frees
 * `MIN_SAVINGS_TOKENS`. The conversation itself is untouched; only this copy sent to the model shrinks.
 */
export function pruneToolOutputs(messages: AgentMessage[]): AgentMessage[] {
  const skills = skillCallIds(messages);
  const prunable = new Map<number, number>();
  let recent = 0;
  let savings = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "toolResult") continue;
    const text = textOnly(message);
    if (text === null) continue;
    const tokens = estimateTokens(text);
    if (recent < PROTECT_RECENT_TOKENS) {
      recent += tokens;
      continue;
    }
    if (tokens < MIN_PRUNE_TOKENS || skills.has(message.toolCallId)) continue;
    prunable.set(index, tokens);
    savings += tokens - PLACEHOLDER_TOKENS;
  }
  if (savings < MIN_SAVINGS_TOKENS) return messages;
  return messages.map((message, index) => {
    const tokens = prunable.get(index);
    if (tokens === undefined || message.role !== "toolResult") return message;
    return {
      ...message,
      content: [{ type: "text", text: `[Output truncated - ${tokens} tokens]` }],
    };
  });
}
