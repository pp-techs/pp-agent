import type { ChatMessage } from "@workspace/shared";
import { expect, it } from "vite-plus/test";

import { reuseMessages } from "./reuse-messages";

const text = (id: string, value: string): ChatMessage => ({
  id,
  role: "assistant",
  parts: [{ type: "text", text: value }],
});

it("keeps the array and the messages when nothing changed", () => {
  const previous = [text("1", "a"), text("2", "b")];
  const next = [text("1", "a"), text("2", "b")];
  expect(reuseMessages(previous, next)).toBe(previous);
});

it("keeps the unchanged messages and takes the changed or new ones", () => {
  const previous = [text("1", "a"), text("2", "b")];
  const next = [text("1", "a"), text("2", "b!"), text("3", "c")];
  const merged = reuseMessages(previous, next);
  expect(merged).not.toBe(previous);
  expect(merged[0]).toBe(previous[0]);
  expect(merged[1]).toBe(next[1]);
  expect(merged[2]).toBe(next[2]);
});

it("takes a shorter list, and reorders by the new list", () => {
  const previous = [text("1", "a"), text("2", "b")];
  const merged = reuseMessages(previous, [text("2", "b")]);
  expect(merged).toEqual([text("2", "b")]);
  expect(merged[0]).toBe(previous[1]);
});

it("sees a change deep inside a part", () => {
  const withTool = (status: "running" | "done"): ChatMessage => ({
    id: "1",
    role: "assistant",
    parts: [{ type: "tool", toolCallId: "c", name: "read", args: { path: "x" }, status }],
  });
  const previous = [withTool("running")];
  expect(reuseMessages(previous, [withTool("done")])[0]).not.toBe(previous[0]);
});
