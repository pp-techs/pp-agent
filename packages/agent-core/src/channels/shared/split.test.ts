import { describe, expect, test } from "vite-plus/test";
import { splitText } from "./split.ts";

describe("splitText", () => {
  test("keeps short text whole", () => {
    expect(splitText("hello", 4096)).toEqual(["hello"]);
  });

  test("prefers paragraph boundaries and respects the limit", () => {
    const paragraph = "word ".repeat(150).trim();
    const text = Array.from({ length: 10 }, () => paragraph).join("\n\n");
    const chunks = splitText(text, 1000);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(1000);
      expect(chunk.endsWith(paragraph)).toBe(true);
    }
    expect(chunks.join("\n\n")).toBe(text);
  });

  test("falls back to lines, then spaces, then a hard cut", () => {
    const lines = Array.from({ length: 50 }, (_, i) => `line ${i}`).join("\n");
    const byLine = splitText(lines, 100);
    expect(byLine.join("\n")).toBe(lines);
    const words = "abc ".repeat(100).trim();
    for (const chunk of splitText(words, 50)) expect(chunk.endsWith("abc")).toBe(true);
    const solid = "x".repeat(250);
    const hard = splitText(solid, 100);
    expect(hard.join("")).toBe(solid);
    expect(Math.max(...hard.map((chunk) => chunk.length))).toBeLessThanOrEqual(100);
  });

  test("never splits a surrogate pair", () => {
    const text = "😀".repeat(200);
    const chunks = splitText(text, 101);
    expect(chunks.join("")).toBe(text);
    for (const chunk of chunks) expect(chunk.length % 2).toBe(0);
  });

  test("keeps a code block whole when it fits in a chunk", () => {
    const code = [
      "```ts",
      ...Array.from({ length: 10 }, (_, i) => `const a${i} = ${i};`),
      "```",
    ].join("\n");
    const text = `${"intro ".repeat(40).trim()}\n\n${code}\n\n${"outro ".repeat(10).trim()}`;
    const chunks = splitText(text, code.length + 20);
    expect(chunks.some((chunk) => chunk.includes(code))).toBe(true);
  });

  test("closes and re-opens a fence when a block must be cut", () => {
    const code = ["```python", ...Array.from({ length: 60 }, (_, i) => `print(${i})`), "```"].join(
      "\n",
    );
    const chunks = splitText(code, 200);
    expect(chunks.length).toBeGreaterThan(2);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(200);
      expect(chunk.startsWith("```python\n")).toBe(true);
      expect(chunk.trimEnd().endsWith("```")).toBe(true);
      expect(chunk.match(/^```/gm)?.length).toBe(2);
    }
    const printed = chunks.join("\n").match(/print\(\d+\)/g);
    expect(printed).toEqual(Array.from({ length: 60 }, (_, i) => `print(${i})`));
  });
});
