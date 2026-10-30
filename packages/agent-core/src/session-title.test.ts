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
    expect(cleanTitle('<title>"Deploying a Next.js app."</title>')).toBe("Deploying a Next.js app");
  });

  test("collapses internal whitespace", () => {
    expect(cleanTitle("<title>Fixing   the\n\nbuild   error</title>")).toBe(
      "Fixing the build error",
    );
  });

  test("takes the last tagged title after the model thought out loud", () => {
    const reply =
      "<thinking_mode>enabled</thinking_mode>\n\nThe user asks who they are. I could wrap a title in <title>…</title>.\n\n<title>Câu hỏi về danh tính</title>";
    expect(cleanTitle(reply)).toBe("Câu hỏi về danh tính");
  });

  test("rejects a reply that answers the conversation instead of titling it", () => {
    expect(cleanTitle("Mình không có thông tin về bạn.")).toBeNull();
  });

  test("returns null for an empty reply or empty tags", () => {
    expect(cleanTitle("   ")).toBeNull();
    expect(cleanTitle("<title>  </title>")).toBeNull();
  });

  test("truncates a title longer than the max length", () => {
    const long = "word ".repeat(30).trim();
    const result = cleanTitle(`<title>${long}</title>`);
    expect(result?.length).toBe(60);
    expect(result?.endsWith("…")).toBe(true);
  });
});
