import type { AgentEvent, ChatMessage } from "@workspace/shared";

type Append = Extract<AgentEvent, { type: "message_append" }>;

/**
 * Whether `append` cannot be applied because something before it was missed: its message or part
 * is not there, or it starts past the end of the text shown. The caller then asks for a snapshot.
 */
export function appendGap(
  messages: readonly ChatMessage[],
  { id, index, offset }: Append,
): boolean {
  const part = messages.findLast((message) => message.id === id)?.parts[index];
  if (part?.type !== "text" && part?.type !== "thinking") return true;
  return offset > part.text.length;
}

/**
 * `messages` with the text of a `message_append` added to its part. `null` when there is nothing to
 * add: the message or part is not there, the text is already shown (a snapshot got ahead of it), or
 * there is a gap before it (an update was missed; the message's final update puts it right).
 */
export function appendText(
  messages: readonly ChatMessage[],
  { id, index, offset, text }: Append,
): ChatMessage[] | null {
  const position = messages.findLastIndex((message) => message.id === id);
  const message = messages[position];
  const part = message?.parts[index];
  if (!message || (part?.type !== "text" && part?.type !== "thinking")) return null;
  const have = part.text.length;
  if (offset > have || offset + text.length <= have) return null;
  const parts = message.parts.slice();
  parts[index] = { ...part, text: part.text + text.slice(have - offset) };
  const next = messages.slice();
  next[position] = { ...message, parts };
  return next;
}
