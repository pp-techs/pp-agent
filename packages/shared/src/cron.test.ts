import { describe, expect, test } from "vite-plus/test";
import { nextCronRun, parseCron, previousCronRun, type CronSpec } from "./cron.ts";

/** Local time; month is 1-based. */
const at = (y: number, mo: number, d: number, h = 0, mi = 0) =>
  new Date(y, mo - 1, d, h, mi).getTime();

function spec(expr: string, minGap = 1): CronSpec {
  const result = parseCron(expr, minGap);
  if (!result.ok) throw new Error(`${expr}: ${result.problem}`);
  return result.spec;
}

describe("parseCron", () => {
  test("accepts lists, ranges, steps and names", () => {
    expect(spec("*/15 8-18 * * MON-FRI").times).toHaveLength(4 * 11);
    expect(spec("0 9 1,15 JAN,JUL *").daysOfMonth).toEqual(new Set([1, 15]));
    expect(spec("5/20 0 * * 7").daysOfWeek).toEqual(new Set([0]));
    expect(spec("  0   9 * * *  ").expr).toBe("0 9 * * *");
  });

  test.each(["", "* * * *", "* * * * * *", "60 * * * *", "* 24 * * *", "* * 0 * *", "* * * 13 *"])(
    "rejects %j",
    (expr) => expect(parseCron(expr)).toEqual({ ok: false, problem: "syntax" }),
  );

  test.each(["*/0 * * * *", "1-/2 * * * *", "5-1 * * * *", "a * * * *", "1,,2 * * * *"])(
    "rejects malformed field %j",
    (expr) => expect(parseCron(expr).ok).toBe(false),
  );

  test("rejects non-strings", () => {
    expect(parseCron(undefined)).toEqual({ ok: false, problem: "syntax" });
    expect(parseCron(5)).toEqual({ ok: false, problem: "syntax" });
  });

  test("rejects dates that never exist but allows 29 February", () => {
    expect(parseCron("0 0 31 2 *")).toEqual({ ok: false, problem: "never" });
    expect(parseCron("0 0 31 4,6 *")).toEqual({ ok: false, problem: "never" });
    expect(parseCron("0 0 29 2 *").ok).toBe(true);
  });

  test("enforces the minimum gap, including across midnight", () => {
    expect(parseCron("* * * * *", 5)).toEqual({ ok: false, problem: "tooFrequent" });
    expect(parseCron("*/5 * * * *", 5).ok).toBe(true);
    expect(parseCron("0,3 * * * *", 5)).toEqual({ ok: false, problem: "tooFrequent" });
    expect(parseCron("58 23 * * *", 5).ok).toBe(true);
    expect(parseCron("58,59 23 * * *", 5)).toEqual({ ok: false, problem: "tooFrequent" });
  });
});

describe("nextCronRun", () => {
  test("is strictly after the given moment", () => {
    const s = spec("30 9 * * *");
    expect(nextCronRun(s, at(2026, 11, 12, 9, 29))).toBe(at(2026, 11, 12, 9, 30));
    expect(nextCronRun(s, at(2026, 11, 12, 9, 30))).toBe(at(2026, 11, 13, 9, 30));
  });

  test("skips weekends", () => {
    // 13 Nov 2026 is a Friday.
    expect(nextCronRun(spec("0 9 * * MON-FRI"), at(2026, 11, 13, 10))).toBe(at(2026, 11, 16, 9));
  });

  test("day-of-month and day-of-week match either when both are restricted", () => {
    const s = spec("0 9 15 * MON");
    expect(nextCronRun(s, at(2026, 11, 12, 10))).toBe(at(2026, 11, 15, 9)); // the 15th (Sunday)
    expect(nextCronRun(s, at(2026, 11, 15, 10))).toBe(at(2026, 11, 16, 9)); // a Monday
  });

  test("a restricted month with a wildcard day narrows both", () => {
    expect(nextCronRun(spec("0 0 * DEC SUN"), at(2026, 11, 12))).toBe(at(2026, 12, 6));
  });

  test("finds 29 February", () => {
    expect(nextCronRun(spec("0 0 29 2 *"), at(2026, 3, 1))).toBe(at(2028, 2, 29));
  });

  test("finds a 29 February on a chosen weekday", () => {
    const next = nextCronRun(spec("0 0 29 2 MON"), at(2026, 3, 1));
    expect(next).not.toBeNull();
  });

  test("runs repeatedly without drifting", () => {
    const s = spec("*/20 22-23 * * *");
    const runs: number[] = [];
    for (let after = at(2026, 11, 12, 21); runs.length < 7;) {
      const next = nextCronRun(s, after);
      if (next === null) break;
      runs.push(next);
      after = next;
    }
    expect(runs).toEqual([
      at(2026, 11, 12, 22, 0),
      at(2026, 11, 12, 22, 20),
      at(2026, 11, 12, 22, 40),
      at(2026, 11, 12, 23, 0),
      at(2026, 11, 12, 23, 20),
      at(2026, 11, 12, 23, 40),
      at(2026, 11, 13, 22, 0),
    ]);
  });
});

describe("previousCronRun", () => {
  test("returns the latest run at or before the moment and after the baseline", () => {
    const s = spec("0 9 * * *");
    expect(previousCronRun(s, at(2026, 11, 12, 9, 0), at(2026, 11, 1))).toBe(at(2026, 11, 12, 9));
    expect(previousCronRun(s, at(2026, 11, 12, 8, 59), at(2026, 11, 1))).toBe(at(2026, 11, 11, 9));
  });

  test("returns null when the run is already covered by the baseline", () => {
    const s = spec("0 9 * * *");
    expect(previousCronRun(s, at(2026, 11, 12, 10), at(2026, 11, 12, 9))).toBeNull();
    expect(previousCronRun(s, at(2026, 11, 12, 10), at(2026, 11, 12, 9, 1))).toBeNull();
    expect(previousCronRun(s, at(2026, 11, 12, 10), at(2026, 11, 12, 8))).toBe(at(2026, 11, 12, 9));
  });

  test("terminates for rare schedules", () => {
    expect(previousCronRun(spec("0 0 29 2 *"), at(2026, 11, 12), at(2026, 11, 1))).toBeNull();
  });
});
