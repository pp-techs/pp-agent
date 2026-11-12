import { parseCron } from "@workspace/shared";
import { describe, expect, test } from "vite-plus/test";

import {
  buildCron,
  describeCron,
  HOUR_STEPS,
  MINUTE_STEPS,
  type ScheduleBuilder,
} from "./schedule-builder";

describe("buildCron", () => {
  test("writes each choice as cron", () => {
    expect(buildCron({ kind: "minutes", every: 15 })).toBe("*/15 * * * *");
    expect(buildCron({ kind: "hourly", every: 1, minute: 30 })).toBe("30 * * * *");
    expect(buildCron({ kind: "hourly", every: 4, minute: 0 })).toBe("0 */4 * * *");
    expect(buildCron({ kind: "daily", time: "09:05" })).toBe("5 9 * * *");
    expect(buildCron({ kind: "weekly", days: [5, 1, 1], time: "16:00" })).toBe("0 16 * * 1,5");
    expect(buildCron({ kind: "monthly", day: 15, time: "07:30" })).toBe("30 7 15 * *");
  });

  test("refuses a time that is not HH:MM", () => {
    expect(buildCron({ kind: "daily", time: "9:00" })).toBeNull();
    expect(buildCron({ kind: "weekly", days: [1], time: "24:00" })).toBeNull();
    expect(buildCron({ kind: "monthly", day: 1, time: "" })).toBeNull();
  });
});

describe("describeCron", () => {
  const roundTrip = (choice: ScheduleBuilder) => {
    const expr = buildCron(choice);
    expect(expr).not.toBeNull();
    expect(parseCron(expr).ok).toBe(true);
    expect(describeCron(expr ?? "")).toEqual(choice);
  };

  test("reads back every choice the form can make", () => {
    for (const every of MINUTE_STEPS) roundTrip({ kind: "minutes", every });
    for (const every of HOUR_STEPS) roundTrip({ kind: "hourly", every, minute: 0 });
    roundTrip({ kind: "hourly", every: 3, minute: 45 });
    roundTrip({ kind: "daily", time: "00:00" });
    roundTrip({ kind: "daily", time: "23:59" });
    roundTrip({ kind: "weekly", days: [0, 6], time: "10:15" });
    roundTrip({ kind: "weekly", days: [1, 2, 3, 4, 5], time: "09:00" });
    for (const day of [1, 15, 29, 31]) roundTrip({ kind: "monthly", day, time: "08:00" });
  });

  test("reads expressions written another way", () => {
    expect(describeCron("0 9 * * MON-FRI")).toEqual({
      kind: "weekly",
      days: [1, 2, 3, 4, 5],
      time: "09:00",
    });
    expect(describeCron("  0   9  *  *  7 ")).toEqual({ kind: "weekly", days: [0], time: "09:00" });
    expect(describeCron("0 9 * JAN-DEC *")).toEqual({ kind: "daily", time: "09:00" });
    expect(describeCron("0 9 * * 0-6")).toEqual({ kind: "daily", time: "09:00" });
    expect(describeCron("0,15,30,45 * * * *")).toEqual({ kind: "minutes", every: 15 });
    expect(describeCron("0 0,6,12,18 * * *")).toEqual({ kind: "hourly", every: 6, minute: 0 });
  });

  test("leaves what the form cannot express to the advanced editor", () => {
    for (const expr of [
      "*/45 * * * *", // not a round step
      "*/7 * * * *",
      "0 9,17 * * *", // twice a day
      "0 9 * 6-8 *", // some months
      "0 9 15 * MON", // a day of the month or a weekday
      "0 9 1-31 * MON", // looks weekly, but runs every day
      "0 9 1 * 0-6", // looks monthly, but runs every day
      "0 9 1,15 * *", // two days of the month
      "0 9-17 * * *", // every hour of the day, but only from 09:00
      "*/5 9 * * *", // every five minutes during one hour
      "not cron",
      "",
    ])
      expect(describeCron(expr), expr).toBeNull();
  });
});
