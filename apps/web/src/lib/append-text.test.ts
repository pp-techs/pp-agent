import type { ChatMessage } from "@workspace/shared";
import { expect, it } from "vite-plus/test";

import { appendGap, appendText } from "./append-text";

const reply = (text: string): ChatMessage => ({
  id: "m1",
  role: "assistant",
  parts: [{ type: "text", text }],
});
const add = (index: number, offset: number, text: string) =>
  ({ type: "message_append", id: "m1", index, offset, text }) as const;

it("adds the text at the end of the part, leaving the other messages as they were", () => {
  const other: ChatMessage = { id: "m0", role: "user", parts: [{ type: "text", text: "hi" }] };
  const messages = [other, reply("Hello")];
  const next = appendText(messages, add(0, 5, ", world"));
  expect(next?.[1]).toEqual(reply("Hello, world"));
  expect(next?.[0]).toBe(other);
  expect(messages[1]).toEqual(reply("Hello"));
});

it("keeps only the new part of text a snapshot already showed", () => {
  const next = appendText([reply("Hello, wor")], add(0, 5, ", world!"));
  expect(next?.[0]).toEqual(reply("Hello, world!"));
});

it("ignores text that is already there, a gap, and a message or part that is missing", () => {
  const messages = [reply("Hello")];
  expect(appendText(messages, add(0, 0, "Hel"))).toBeNull();
  expect(appendText(messages, add(0, 9, "x"))).toBeNull();
  expect(appendText(messages, add(2, 5, "x"))).toBeNull();
  expect(appendText(messages, { ...add(0, 5, "x"), id: "gone" })).toBeNull();
});

it("adds to a thinking part too", () => {
  const messages: ChatMessage[] = [
    { id: "m1", role: "assistant", parts: [{ type: "thinking", text: "Let me" }] },
  ];
  expect(appendText(messages, add(0, 6, " see"))?.[0]?.parts[0]).toEqual({
    type: "thinking",
    text: "Let me see",
  });
});

it("tells a missed update from one that is only already shown", () => {
  const messages = [reply("Hello")];
  expect(appendGap(messages, add(0, 5, "!"))).toBe(false);
  expect(appendGap(messages, add(0, 0, "Hel"))).toBe(false);
  expect(appendGap(messages, add(0, 9, "x"))).toBe(true);
  expect(appendGap(messages, add(3, 0, "x"))).toBe(true);
  expect(appendGap(messages, { ...add(0, 0, "x"), id: "gone" })).toBe(true);
});
