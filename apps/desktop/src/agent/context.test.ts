import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { describe, expect, test } from "vite-plus/test";
import { MIN_SAVINGS_TOKENS, PROTECT_RECENT_TOKENS, pruneToolOutputs } from "./context.ts";

const CHARS_PER_TOKEN = 4;

function result(toolCallId: string, tokens: number): AgentMessage {
  return {
    role: "toolResult",
    toolCallId,
    toolName: "read",
    content: [{ type: "text", text: "x".repeat(tokens * CHARS_PER_TOKEN) }],
    isError: false,
    timestamp: 0,
  };
}

function call(id: string, path: string): AgentMessage {
  return {
    role: "assistant",
    content: [{ type: "toolCall", id, name: "read", arguments: { path } }],
  } as unknown as AgentMessage;
}

const text = (message: AgentMessage | undefined): string =>
  message?.role === "toolResult" && message.content[0]?.type === "text"
    ? message.content[0].text
    : "";

describe("pruneToolOutputs", () => {
  test("keeps everything when pruning would free too little", () => {
    const messages = [result("a", 1_000), result("b", PROTECT_RECENT_TOKENS)];
    expect(pruneToolOutputs(messages)).toBe(messages);
  });

  test("replaces old output once enough would be freed, keeping the newest whole", () => {
    const old = MIN_SAVINGS_TOKENS + 5_000;
    const messages = [result("old", old), result("new", PROTECT_RECENT_TOKENS)];
    const pruned = pruneToolOutputs(messages);
    expect(text(pruned[0])).toBe(`[Output truncated - ${old} tokens]`);
    expect(pruned[1]).toBe(messages[1]);
    // The conversation itself is not modified.
    expect(text(messages[0]).length).toBe(old * CHARS_PER_TOKEN);
  });

  test("never prunes what a skill's instructions were read from", () => {
    const messages = [
      call("skill-read", "/skills/report/SKILL.md"),
      result("skill-read", MIN_SAVINGS_TOKENS + 5_000),
      result("new", PROTECT_RECENT_TOKENS),
    ];
    expect(pruneToolOutputs(messages)).toBe(messages);
  });

  test("leaves results that carry images alone", () => {
    const withImage: AgentMessage = {
      role: "toolResult",
      toolCallId: "img",
      toolName: "read",
      content: [{ type: "image", mimeType: "image/png", data: "x".repeat(200_000) }],
      isError: false,
      timestamp: 0,
    };
    const messages = [withImage, result("new", PROTECT_RECENT_TOKENS)];
    expect(pruneToolOutputs(messages)).toBe(messages);
  });
});
