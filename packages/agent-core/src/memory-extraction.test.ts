import { describe, expect, test } from "vite-plus/test";
import { parseExtractedNotes, transcriptText } from "./memory-extraction.ts";

describe("transcriptText", () => {
  test("renders user and assistant text blocks as labeled lines", () => {
    const messages = [
      { role: "user" as const, content: "hello", timestamp: 0 },
      {
        role: "assistant" as const,
        content: [{ type: "text" as const, text: "hi there" }],
        timestamp: 0,
      },
    ];
    expect(transcriptText(messages as never)).toBe("User: hello\nAssistant: hi there");
  });

  test("skips messages with no text (tool-only turns)", () => {
    const messages = [
      { role: "user" as const, content: "hello", timestamp: 0 },
      { role: "assistant" as const, content: [], timestamp: 0 },
      { role: "toolResult" as const, content: [], timestamp: 0 } as never,
    ];
    expect(transcriptText(messages as never)).toBe("User: hello");
  });

  test("keeps only the newest slice when the transcript is very long", () => {
    const big = "x".repeat(25_000);
    const messages = [{ role: "user" as const, content: big, timestamp: 0 }];
    const result = transcriptText(messages as never);
    expect(result.length).toBe(20_000);
    expect(result.endsWith("x")).toBe(true);
  });
});

describe("parseExtractedNotes", () => {
  test("parses a plain JSON array", () => {
    expect(
      parseExtractedNotes(
        '[{"text":"likes Vietnamese replies","tag":"preference","scope":"global"}]',
      ),
    ).toEqual([{ text: "likes Vietnamese replies", tag: "preference", scope: "global" }]);
  });

  test("strips a markdown code fence around the array", () => {
    const reply = '```json\n[{"text":"fact"}]\n```';
    expect(parseExtractedNotes(reply)).toEqual([{ text: "fact", tag: null, scope: "global" }]);
  });

  test("returns an empty list for an empty array, prose, or malformed JSON", () => {
    expect(parseExtractedNotes("[]")).toEqual([]);
    expect(parseExtractedNotes("Nothing to remember here.")).toEqual([]);
    expect(parseExtractedNotes("[{broken")).toEqual([]);
  });

  test("drops items without usable text and defaults scope to global", () => {
    const reply = JSON.stringify([
      { text: "", tag: "x" },
      { tag: "no-text" },
      { text: "kept", scope: "workspace" },
      { text: "also kept" },
    ]);
    expect(parseExtractedNotes(reply)).toEqual([
      { text: "kept", tag: null, scope: "workspace" },
      { text: "also kept", tag: null, scope: "global" },
    ]);
  });

  test("truncates text to the max entry length", () => {
    const reply = JSON.stringify([{ text: "y".repeat(600) }]);
    const [note] = parseExtractedNotes(reply);
    expect(note?.text.length).toBe(500);
  });
});
