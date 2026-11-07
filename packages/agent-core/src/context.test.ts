import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { describe, expect, test } from "vite-plus/test";
import {
  IMAGE_PLACEHOLDER,
  KEEP_RECENT_IMAGES,
  MIN_SAVINGS_TOKENS,
  PROTECT_RECENT_TOKENS,
  pruneToolOutputs,
} from "./context.ts";

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

function screenshot(toolCallId: string): AgentMessage {
  return {
    role: "toolResult",
    toolCallId,
    toolName: "computer",
    content: [
      { type: "text", text: `clicked ${toolCallId}` },
      { type: "image", mimeType: "image/png", data: "x".repeat(200_000) },
    ],
    isError: false,
    timestamp: 0,
  };
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

  test("leaves the images of recent results alone", () => {
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

  test("replaces the images of older results, keeping the newest ones and all text", () => {
    const messages = ["s1", "s2", "s3", "s4", "s5"].map(screenshot);
    const pruned = pruneToolOutputs(messages);
    const old = messages.length - KEEP_RECENT_IMAGES;
    for (const [index, message] of pruned.entries()) {
      if (index >= old) {
        expect(message).toBe(messages[index]);
        continue;
      }
      expect(message.role === "toolResult" && message.content).toEqual([
        { type: "text", text: `clicked s${index + 1}` },
        { type: "text", text: IMAGE_PLACEHOLDER },
      ]);
    }
    // The conversation itself is not modified.
    expect(messages[0]?.role === "toolResult" && messages[0].content[1]?.type).toBe("image");
  });

  test("remembers per call whether it read a skill", () => {
    const readsSkill = new Map<string, boolean>();
    const messages = [
      call("skill-read", "/skills/report/SKILL.md"),
      result("skill-read", MIN_SAVINGS_TOKENS + 5_000),
      result("new", PROTECT_RECENT_TOKENS),
    ];
    expect(pruneToolOutputs(messages, readsSkill)).toBe(messages);
    expect(readsSkill.get("skill-read")).toBe(true);
  });
});
