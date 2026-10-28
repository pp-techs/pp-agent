import { execFileSync } from "node:child_process";
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

type OnceInput = { value: string; original?: { kind: "once"; at: number } };

/** Keep TZ out of the test worker: changing it there can leak into other suites. */
function timestampsInTimezone(timeZone: string, inputs: OnceInput[]): Array<number | null> {
  const moduleUrl = new URL("./scheduled-task-fields.ts", import.meta.url).href;
  const output = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `
        import { onceTimestamp } from ${JSON.stringify(moduleUrl)};
        const inputs = ${JSON.stringify(inputs)};
        console.log(JSON.stringify(inputs.map(({ value, original }) => onceTimestamp(value, original))));
      `,
    ],
    { encoding: "utf8", env: { ...process.env, TZ: timeZone } },
  );
  // JSON represents rejected NaN timestamps as null.
  return JSON.parse(output);
}

describe.each([
  {
    zone: "America/New_York",
    repeatedStart: "2026-11-01T01:00",
    repeatedEnd: "2026-11-01T01:59:59.999",
    repeated: "2026-11-01T01:30:12.12",
    changed: "2026-11-01T01:45",
    first: "2026-11-01T05:30:12.120Z",
    second: "2026-11-01T06:30:12.120Z",
    before: "2026-11-01T00:59:59.999",
    beforeInstant: "2026-11-01T04:59:59.999Z",
    after: "2026-11-01T02:00",
    afterInstant: "2026-11-01T07:00:00Z",
    skippedStart: "2026-03-08T02:00",
    skippedEnd: "2026-03-08T02:59:59.999",
  },
  {
    zone: "Australia/Lord_Howe",
    repeatedStart: "2026-04-05T01:30",
    repeatedEnd: "2026-04-05T01:59:59.999",
    repeated: "2026-04-05T01:45:12.12",
    changed: "2026-04-05T01:50",
    first: "2026-04-04T14:45:12.120Z",
    second: "2026-04-04T15:15:12.120Z",
    before: "2026-04-05T01:29:59.999",
    beforeInstant: "2026-04-04T14:29:59.999Z",
    after: "2026-04-05T02:00",
    afterInstant: "2026-04-04T15:30:00Z",
    skippedStart: "2026-10-04T02:00",
    skippedEnd: "2026-10-04T02:29:59.999",
  },
])("one-shot daylight-saving validation ($zone)", (times) => {
  test("rejects newly entered times throughout the repeated interval", () => {
    expect(
      timestampsInTimezone(times.zone, [
        { value: times.repeatedStart },
        { value: times.repeated },
        { value: times.repeatedEnd },
      ]),
    ).toEqual([null, null, null]);
  });

  test("rejects edits into a repeated interval, including edits to an existing second occurrence", () => {
    expect(
      timestampsInTimezone(times.zone, [
        {
          value: times.repeated,
          original: { kind: "once", at: Date.parse(times.beforeInstant) },
        },
        {
          value: times.changed,
          original: { kind: "once", at: Date.parse(times.second) },
        },
      ]),
    ).toEqual([null, null]);
  });

  test("preserves either unchanged occurrence, including browser-normalized precision", () => {
    const first = Date.parse(times.first);
    const second = Date.parse(times.second);
    expect(
      timestampsInTimezone(times.zone, [
        { value: times.repeated, original: { kind: "once", at: first } },
        { value: times.repeated, original: { kind: "once", at: second } },
        { value: `${times.repeated}0`, original: { kind: "once", at: second } },
      ]),
    ).toEqual([first, second, second]);
  });

  test("accepts unambiguous boundary times and edits away from a repeated interval", () => {
    expect(
      timestampsInTimezone(times.zone, [
        { value: times.before },
        { value: times.after },
        { value: times.after, original: { kind: "once", at: Date.parse(times.second) } },
      ]),
    ).toEqual([
      Date.parse(times.beforeInstant),
      Date.parse(times.afterInstant),
      Date.parse(times.afterInstant),
    ]);
  });

  test("continues rejecting the entire skipped interval", () => {
    expect(
      timestampsInTimezone(times.zone, [
        { value: times.skippedStart },
        { value: times.skippedEnd },
      ]),
    ).toEqual([null, null]);
  });
});
