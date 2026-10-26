import { describe, expect, it } from "vite-plus/test";
import { encodeFrame, FrameDecoder, FrameError } from "./framing.ts";

describe("encodeFrame", () => {
  it("ends with one newline and keeps newlines in strings escaped", () => {
    const line = encodeFrame({ text: "a\nb" });
    expect(line.endsWith("\n")).toBe(true);
    expect(line.slice(0, -1)).not.toContain("\n");
    expect(JSON.parse(line)).toEqual({ text: "a\nb" });
  });
});

describe("FrameDecoder", () => {
  it("returns a frame split across chunks only when it is complete", () => {
    const decoder = new FrameDecoder();
    const line = encodeFrame({ kind: "event", n: 1 });
    expect(decoder.push(line.slice(0, 5))).toEqual([]);
    expect(decoder.push(line.slice(5, 12))).toEqual([]);
    expect(decoder.push(line.slice(12))).toEqual([{ kind: "event", n: 1 }]);
  });

  it("returns several frames from one chunk and keeps the unfinished tail", () => {
    const decoder = new FrameDecoder();
    const chunk = encodeFrame({ n: 1 }) + encodeFrame({ n: 2 }) + encodeFrame({ n: 3 }).slice(0, 3);
    expect(decoder.push(chunk)).toEqual([{ n: 1 }, { n: 2 }]);
    expect(decoder.push(encodeFrame({ n: 3 }).slice(3))).toEqual([{ n: 3 }]);
  });

  it("does not cut a multi-byte character split between chunks", () => {
    const decoder = new FrameDecoder();
    const bytes = Buffer.from(encodeFrame({ text: "Xin chào – 你好 🙂" }));
    const results: unknown[] = [];
    for (const byte of bytes) results.push(...decoder.push(Buffer.from([byte])));
    expect(results).toEqual([{ text: "Xin chào – 你好 🙂" }]);
  });

  it("skips blank lines", () => {
    const decoder = new FrameDecoder();
    expect(decoder.push(`\n\r\n${encodeFrame({ n: 1 })}`)).toEqual([{ n: 1 }]);
  });

  it("rejects a frame larger than the limit, split or whole", () => {
    const split = new FrameDecoder(16);
    expect(split.push("x".repeat(10))).toEqual([]);
    expect(() => split.push("x".repeat(10))).toThrow(FrameError);

    const whole = new FrameDecoder(16);
    expect(() => whole.push(`${"x".repeat(32)}\n`)).toThrow(FrameError);
  });

  it("accepts a frame exactly at the limit", () => {
    const decoder = new FrameDecoder(10);
    expect(decoder.push('"abcdefgh"\n')).toEqual(["abcdefgh"]);
  });

  it("rejects a line that is not JSON", () => {
    expect(() => new FrameDecoder().push("not json\n")).toThrow(FrameError);
  });
});
