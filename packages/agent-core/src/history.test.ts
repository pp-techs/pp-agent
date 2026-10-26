import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { describe, expect, test } from "vite-plus/test";
import { findMatches, fold, queryWords, snippetAround, summarizeUsage } from "./history.ts";

describe("fold", () => {
  test("ignores case and accents, including đ", () => {
    expect(fold("Việt Nam")).toBe("viet nam");
    expect(fold("Đường")).toBe("duong");
    expect(fold("CAFÉ")).toBe("cafe");
  });
});

describe("queryWords", () => {
  test("splits, folds, and de-duplicates", () => {
    expect(queryWords("  Hà  nội hà ")).toEqual(["ha", "noi"]);
  });
});

describe("findMatches", () => {
  test("returns ranges of the original text for an accent-insensitive match", () => {
    const text = "Chào Việt Nam";
    const [range] = findMatches(text, queryWords("viet"));
    expect(range && text.slice(range[0], range[1])).toBe("Việt");
  });

  test("needs every word to occur", () => {
    expect(findMatches("hello world", ["hello", "mars"])).toEqual([]);
    expect(findMatches("hello world", ["hello", "world"])).toEqual([
      [0, 5],
      [6, 11],
    ]);
  });

  test("merges overlapping ranges", () => {
    expect(findMatches("abcdef", ["abcd", "cdef"])).toEqual([[0, 6]]);
  });

  test("no words, no matches", () => {
    expect(findMatches("anything", [])).toEqual([]);
  });
});

describe("snippetAround", () => {
  test("keeps a short text whole and shifts nothing", () => {
    expect(snippetAround("find me here", [[5, 7]])).toEqual({
      snippet: "find me here",
      matches: [[5, 7]],
    });
  });

  test("cuts long text around the first match, with ellipses and shifted ranges", () => {
    const text = `${"a ".repeat(100)}needle${" b".repeat(100)}`;
    const start = text.indexOf("needle");
    const { snippet, matches } = snippetAround(text, [[start, start + 6]]);
    expect(snippet.startsWith("…")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
    const [range] = matches;
    expect(range && snippet.slice(range[0], range[1])).toBe("needle");
  });

  test("turns line breaks into spaces", () => {
    expect(snippetAround("a\nb", [[0, 1]]).snippet).toBe("a b");
  });
});

function reply(input: number, output: number, cost: number): AgentMessage {
  return {
    role: "assistant",
    content: [],
    usage: {
      input,
      output,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: input + output,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: cost },
    },
  } as unknown as AgentMessage;
}

describe("summarizeUsage", () => {
  test("sums tokens and cost", () => {
    expect(summarizeUsage([reply(10, 5, 0.25), reply(20, 5, 0.5)])).toMatchObject({
      input: 30,
      output: 10,
      cost: 0.75,
      costPartial: false,
    });
  });

  test("a model without a price gives an unknown cost", () => {
    expect(summarizeUsage([reply(10, 5, 0)])).toMatchObject({ cost: null, costPartial: false });
  });

  test("mixed replies give a partial cost", () => {
    expect(summarizeUsage([reply(10, 5, 0.25), reply(10, 5, 0)])).toMatchObject({
      cost: 0.25,
      costPartial: true,
    });
  });

  test("an empty conversation costs nothing", () => {
    expect(summarizeUsage([])).toMatchObject({ input: 0, cost: 0, costPartial: false });
  });
});
