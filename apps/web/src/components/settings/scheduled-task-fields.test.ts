import { describe, expect, test } from "vite-plus/test";

import { localDateTime, onceTimestamp } from "./scheduled-task-fields";

describe("one-shot schedule fields", () => {
  test("display local time and preserve the exact existing instant", () => {
    const at = new Date(2030, 5, 15, 9, 30, 12, 123).getTime();
    const value = localDateTime(at);
    expect(value).toBe("2030-06-15T09:30:12.123");
    expect(onceTimestamp(value, { kind: "once", at })).toBe(at);
  });

  test("accept browser-normalized precision without losing milliseconds", () => {
    const at = new Date(2030, 5, 15, 9, 0, 0, 120).getTime();
    expect(localDateTime(at)).toBe("2030-06-15T09:00:00.12");
    expect(onceTimestamp("2030-06-15T09:00:00.120")).toBe(at);
    expect(onceTimestamp("2030-06-15T09:00:00.000")).toBe(new Date(2030, 5, 15, 9).getTime());
    expect(onceTimestamp("2030-06-15T09:00")).toBe(new Date(2030, 5, 15, 9).getTime());
  });

  test("applies an edited date and time instead of keeping the original", () => {
    const original = { kind: "once" as const, at: new Date(2030, 5, 15, 9).getTime() };
    expect(onceTimestamp("2030-06-16T14:30", original)).toBe(
      new Date(2030, 5, 16, 14, 30).getTime(),
    );
  });

  test("rejects empty, malformed and nonexistent calendar dates", () => {
    for (const value of ["", "not a date", "2030-02-30T09:00", "2030-06-15T25:00", "2030-06-15"]) {
      expect(onceTimestamp(value)).toBeNaN();
    }
  });
});
