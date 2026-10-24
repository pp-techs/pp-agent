import type { TaskSchedule } from "@workspace/shared";
import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import {
  decide,
  lastDue,
  nextRun,
  parseSchedule,
  parseTime,
  Scheduler,
  timerDelay,
  MAX_TIMER_MS,
  MIN_TIMER_MS,
  type Schedulable,
} from "./scheduler.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Local time; month is 1-based. */
function at(year: number, month: number, day: number, hours = 0, minutes = 0): number {
  return new Date(year, month - 1, day, hours, minutes).getTime();
}

function task(
  schedule: TaskSchedule,
  armedAt: number,
  extra: Partial<Schedulable> = {},
): Schedulable {
  return { enabled: true, schedule, armedAt, lastRunEnd: null, ...extra };
}

describe("parseTime / parseSchedule", () => {
  test("accepts HH:MM only", () => {
    expect(parseTime("09:05")).toEqual({ hours: 9, minutes: 5 });
    expect(parseTime("24:00")).toBeNull();
    expect(parseTime("9:05")).toBeNull();
    expect(parseTime(905)).toBeNull();
  });

  test("interval bounds", () => {
    expect(parseSchedule({ kind: "interval", every: 30, unit: "minutes" }).ok).toBe(true);
    expect(parseSchedule({ kind: "interval", every: 4, unit: "minutes" })).toEqual({
      ok: false,
      problem: "interval",
    });
    expect(parseSchedule({ kind: "interval", every: 1.5, unit: "hours" }).ok).toBe(false);
    expect(parseSchedule({ kind: "interval", every: 169, unit: "hours" }).ok).toBe(false);
    expect(parseSchedule({ kind: "interval", every: 2, unit: "days" }).ok).toBe(false);
  });

  test("weekly days are deduplicated, sorted, and required", () => {
    expect(parseSchedule({ kind: "weekly", days: [5, 1, 1], time: "08:00" })).toEqual({
      ok: true,
      schedule: { kind: "weekly", days: [1, 5], time: "08:00" },
    });
    expect(parseSchedule({ kind: "weekly", days: [], time: "08:00" })).toEqual({
      ok: false,
      problem: "days",
    });
    expect(parseSchedule({ kind: "weekly", days: [7], time: "08:00" }).ok).toBe(false);
    expect(parseSchedule({ kind: "daily", time: "nope" })).toEqual({ ok: false, problem: "time" });
    expect(parseSchedule(null)).toEqual({ ok: false, problem: "kind" });
  });
});

describe("nextRun", () => {
  test("disabled tasks never run", () => {
    const disabled = task({ kind: "daily", time: "09:00" }, 0, { enabled: false });
    expect(nextRun(disabled, at(2026, 3, 4, 8))).toBeNull();
  });

  test("interval counts from the last run, else from arming", () => {
    const schedule: TaskSchedule = { kind: "interval", every: 30, unit: "minutes" };
    const armed = at(2026, 3, 4, 8);
    expect(nextRun(task(schedule, armed), armed + 10 * MINUTE)).toBe(armed + 30 * MINUTE);
    const ran = task(schedule, armed, { lastRunEnd: armed + 45 * MINUTE });
    expect(nextRun(ran, armed + 50 * MINUTE)).toBe(armed + 75 * MINUTE);
  });

  test("an interval task that is overdue is due now", () => {
    const schedule: TaskSchedule = { kind: "interval", every: 1, unit: "hours" };
    const armed = at(2026, 3, 4, 8);
    const now = armed + 5 * HOUR;
    expect(nextRun(task(schedule, armed), now)).toBe(now);
  });

  test("daily: later today, else tomorrow", () => {
    const schedule: TaskSchedule = { kind: "daily", time: "09:30" };
    expect(nextRun(task(schedule, 0), at(2026, 3, 4, 8))).toBe(at(2026, 3, 4, 9, 30));
    expect(nextRun(task(schedule, 0), at(2026, 3, 4, 9, 30))).toBe(at(2026, 3, 5, 9, 30));
    expect(nextRun(task(schedule, 0), at(2026, 3, 4, 23, 59))).toBe(at(2026, 3, 5, 9, 30));
  });

  test("daily rolls over month and year ends", () => {
    const schedule: TaskSchedule = { kind: "daily", time: "00:15" };
    expect(nextRun(task(schedule, 0), at(2026, 12, 31, 12))).toBe(at(2027, 1, 1, 0, 15));
  });

  test("weekly picks the next chosen weekday", () => {
    // 2026-03-04 is a Wednesday (3). Monday = 1, Friday = 5.
    const schedule: TaskSchedule = { kind: "weekly", days: [1, 5], time: "07:00" };
    expect(nextRun(task(schedule, 0), at(2026, 3, 4, 12))).toBe(at(2026, 3, 6, 7));
    expect(nextRun(task(schedule, 0), at(2026, 3, 6, 7))).toBe(at(2026, 3, 9, 7));
    expect(nextRun(task(schedule, 0), at(2026, 3, 6, 6, 59))).toBe(at(2026, 3, 6, 7));
  });

  test("weekly with a single day waits a full week after its slot", () => {
    const schedule: TaskSchedule = { kind: "weekly", days: [3], time: "07:00" };
    expect(nextRun(task(schedule, 0), at(2026, 3, 4, 7, 1))).toBe(at(2026, 3, 11, 7));
  });
});

describe("lastDue / decide (catch-up)", () => {
  const daily: TaskSchedule = { kind: "daily", time: "09:00" };

  test("nothing is due before the first slot after arming", () => {
    const armed = at(2026, 3, 4, 10);
    expect(lastDue(task(daily, armed), at(2026, 3, 5, 8))).toBeNull();
    expect(decide(task(daily, armed), at(2026, 3, 5, 8))).toEqual({ action: "wait" });
  });

  test("a slot missed while the app was closed runs once, within 24 hours", () => {
    const lastRunEnd = at(2026, 3, 4, 9, 1);
    const closed = task(daily, 0, { lastRunEnd });
    const now = at(2026, 3, 5, 10);
    expect(decide(closed, now)).toEqual({ action: "run", dueAt: at(2026, 3, 5, 9) });
  });

  test("several missed slots collapse into one run", () => {
    const closed = task(daily, 0, { lastRunEnd: at(2026, 3, 1, 9, 1) });
    const now = at(2026, 3, 5, 9, 30);
    expect(decide(closed, now)).toEqual({ action: "run", dueAt: at(2026, 3, 5, 9) });
  });

  test("a slot older than 24 hours is skipped", () => {
    const weekly = task({ kind: "weekly", days: [3], time: "09:00" }, 0, {
      lastRunEnd: at(2026, 2, 25, 9, 1),
    });
    // The Wednesday 2026-03-04 09:00 slot, checked on Thursday 10:00 (25 hours later).
    expect(decide(weekly, at(2026, 3, 5, 10))).toEqual({ action: "skip" });
    // Still inside the window the same day.
    expect(decide(weekly, at(2026, 3, 4, 20))).toEqual({
      action: "run",
      dueAt: at(2026, 3, 4, 9),
    });
  });

  test("a slot already covered by a run is not due again", () => {
    const done = task(daily, 0, { lastRunEnd: at(2026, 3, 5, 9, 2) });
    expect(decide(done, at(2026, 3, 5, 12))).toEqual({ action: "wait" });
  });

  test("interval tasks catch up once when overdue", () => {
    const hourly = task({ kind: "interval", every: 1, unit: "hours" }, at(2026, 3, 4, 8));
    expect(decide(hourly, at(2026, 3, 4, 8, 30))).toEqual({ action: "wait" });
    expect(decide(hourly, at(2026, 3, 4, 14))).toEqual({
      action: "run",
      dueAt: at(2026, 3, 4, 9),
    });
    expect(decide(hourly, at(2026, 3, 8, 14))).toEqual({ action: "skip" });
  });

  test("disabled tasks are never due", () => {
    expect(decide(task(daily, 0, { enabled: false }), at(2026, 3, 5, 12))).toEqual({
      action: "wait",
    });
  });
});

describe("timerDelay", () => {
  test("is clamped between one second and one minute", () => {
    const now = 1_000_000;
    expect(timerDelay(now - 5, now)).toBe(MIN_TIMER_MS);
    expect(timerDelay(now + 10 * HOUR, now)).toBe(MAX_TIMER_MS);
    expect(timerDelay(now + 20_000, now)).toBe(20_000);
  });
});

describe("daylight saving time (America/New_York)", () => {
  const previous = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = "America/New_York";
  });
  afterAll(() => {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  });

  test("daily 09:00 stays at 09:00 local across spring forward (2026-03-08)", () => {
    const schedule: TaskSchedule = { kind: "daily", time: "09:00" };
    const saturday = at(2026, 3, 7, 10);
    const next = nextRun(task(schedule, 0), saturday);
    expect(next).toBe(at(2026, 3, 8, 9));
    expect(new Date(next ?? 0).getHours()).toBe(9);
    // Only 22 hours after Saturday 10:00 EST, because the clock jumped.
    expect((next ?? 0) - saturday).toBe(22 * HOUR);
  });

  test("daily 09:00 stays at 09:00 local across fall back (2026-11-01)", () => {
    const schedule: TaskSchedule = { kind: "daily", time: "09:00" };
    const saturday = at(2026, 10, 31, 10);
    const next = nextRun(task(schedule, 0), saturday);
    expect(new Date(next ?? 0).getHours()).toBe(9);
    expect(new Date(next ?? 0).getDate()).toBe(1);
    // 23 hours on the wall clock, 24 elapsed because the clock went back.
    expect((next ?? 0) - saturday).toBe(24 * HOUR);
  });

  test("weekly across spring forward keeps the local time", () => {
    const schedule: TaskSchedule = { kind: "weekly", days: [1], time: "06:30" };
    const next = nextRun(task(schedule, 0), at(2026, 3, 6, 12));
    expect(next).toBe(at(2026, 3, 9, 6, 30));
    expect(new Date(next ?? 0).getHours()).toBe(6);
  });

  test("a slot inside the skipped hour is still found once", () => {
    const schedule: TaskSchedule = { kind: "daily", time: "02:30" };
    const next = nextRun(task(schedule, 0), at(2026, 3, 8, 0, 30));
    // 02:30 does not exist on 2026-03-08; JS resolves it to 03:30, which is still on that day.
    expect(new Date(next ?? 0).getDate()).toBe(8);
    expect(next).toBeGreaterThan(at(2026, 3, 8, 0, 30));
  });
});

/** Lets queued promise callbacks run, so the scheduler advances after a gate opens. */
async function flush(): Promise<void> {
  for (let tick = 0; tick < 10; tick += 1) await Promise.resolve();
}

describe("Scheduler queue", () => {
  function setup() {
    let now = at(2026, 3, 4, 9, 0);
    const tasks = ["a", "b"].map((id) => ({
      id,
      name: id,
      prompt: "p",
      agentId: "default",
      workspaceId: "default",
      enabled: true,
      armedAt: at(2026, 3, 4, 8),
      lastRun: null,
      schedule: { kind: "interval" as const, every: 30, unit: "minutes" as const },
    }));
    const log: string[] = [];
    const gates: Array<() => void> = [];
    const scheduler = new Scheduler({
      now: () => now,
      tasks: () => tasks,
      rearm: (id) => log.push(`rearm ${id}`),
      run: async (running) => {
        log.push(`start ${running.id}`);
        const gate = Promise.withResolvers<void>();
        gates.push(gate.resolve);
        await gate.promise;
        log.push(`end ${running.id}`);
      },
      changed: () => undefined,
    });
    return {
      scheduler,
      log,
      gates,
      advance: (ms: number) => {
        now += ms;
      },
    };
  }

  test("runs one task at a time and never queues a task twice", async () => {
    const { scheduler, log, gates } = setup();
    expect(scheduler.runNow("a")).toBe(true);
    expect(scheduler.runNow("a")).toBe(false);
    expect(scheduler.runNow("b")).toBe(true);
    expect(scheduler.state("a")).toBe("running");
    expect(scheduler.state("b")).toBe("queued");
    expect(log).toEqual(["start a"]);
    gates.shift()?.();
    await flush();
    expect(log).toEqual(["start a", "end a", "start b"]);
    gates.shift()?.();
    await flush();
    expect(scheduler.state("b")).toBe("idle");
    scheduler.stop();
  });

  test("unknown tasks are ignored", () => {
    const { scheduler } = setup();
    expect(scheduler.runNow("zzz")).toBe(false);
    scheduler.stop();
  });

  test("start queues tasks that are overdue within the catch-up window", async () => {
    const { scheduler, log, gates, advance } = setup();
    advance(2 * HOUR);
    scheduler.start();
    expect(log).toEqual(["start a"]);
    expect(scheduler.state("b")).toBe("queued");
    gates.shift()?.();
    await flush();
    gates.shift()?.();
    await flush();
    expect(log).toEqual(["start a", "end a", "start b", "end b"]);
    scheduler.stop();
  });

  test("start skips tasks overdue by more than a day", () => {
    const { scheduler, log, advance } = setup();
    advance(3 * 24 * HOUR);
    scheduler.start();
    expect(log).toEqual(["rearm a", "rearm b"]);
    scheduler.stop();
  });
});
