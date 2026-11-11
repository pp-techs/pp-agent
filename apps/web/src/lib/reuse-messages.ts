import type { ChatMessage } from "@workspace/shared";

/** Structural equality of two JSON values, as they arrive from the conversation. */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keysA = Object.keys(a);
  if (keysA.length !== Object.keys(b).length) return false;
  return keysA.every(
    (key) =>
      Object.hasOwn(b, key) &&
      same((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  );
}

/**
 * The messages of a new snapshot of the chat that is already open, keeping the very objects (and
 * the array) of the ones that did not change. A snapshot is sent for any change to the chat's
 * settings, and every message in it is a new object: without this each one would draw again,
 * though a message only re-renders when it is not the same object.
 */
export function reuseMessages(previous: ChatMessage[], next: ChatMessage[]): ChatMessage[] {
  const known = new Map(previous.map((message) => [message.id, message]));
  let unchanged = previous.length === next.length;
  const merged = next.map((message, index) => {
    const old = known.get(message.id);
    const kept = old !== undefined && same(old, message) ? old : message;
    if (kept !== previous[index]) unchanged = false;
    return kept;
  });
  return unchanged ? previous : merged;
}
