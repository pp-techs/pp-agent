import { describe, expect, test } from "vite-plus/test";
import { cleanTitle, transcriptStart } from "./session-title.ts";

describe("transcriptStart", () => {
  test("renders user and assistant text blocks as labeled lines", () => {
    const messages = [
      { role: "user" as const, content: "how do I deploy this app?", timestamp: 0 },
      {
        role: "assistant" as const,
        content: [{ type: "text" as const, text: "Here is how..." }],
        timestamp: 0,
      },
    ];
    expect(transcriptStart(messages as never)).toBe(
      "User: how do I deploy this app?\nAssistant: Here is how...",
    );
  });

  test("skips messages with no text (tool-only turns)", () => {
    const messages = [
      { role: "user" as const, content: "hello", timestamp: 0 },
      { role: "assistant" as const, content: [], timestamp: 0 },
    ];
    expect(transcriptStart(messages as never)).toBe("User: hello");
  });

  test("keeps the oldest slice when the transcript is very long", () => {
    const big = "x".repeat(5_000);
    const messages = [{ role: "user" as const, content: big, timestamp: 0 }];
    const result = transcriptStart(messages as never);
    expect(result.length).toBe(4_000);
    expect(result.startsWith("User: x")).toBe(true);
  });
});

describe("cleanTitle", () => {
  test("strips surrounding quotes and trailing punctuation", () => {
    expect(cleanTitle('"Deploying a Next.js app."')).toBe("Deploying a Next.js app");
  });

  test("collapses internal whitespace", () => {
    expect(cleanTitle("Fixing   the\n\nbuild   error")).toBe("Fixing the build error");
  });

  test("returns null for an empty reply", () => {
    expect(cleanTitle("   ")).toBeNull();
    expect(cleanTitle("")).toBeNull();
  });

  test("truncates a title longer than the max length", () => {
    const long = "word ".repeat(30).trim();
    const result = cleanTitle(long);
    expect(result?.length).toBe(60);
    expect(result?.endsWith("…")).toBe(true);
  });
});
