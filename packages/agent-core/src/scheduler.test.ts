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

const cron = (expr: string): TaskSchedule => ({ kind: "cron", expr });

describe("parseTime / parseSchedule", () => {
  test("parseTime accepts HH:MM only", () => {
    expect(parseTime("09:05")).toEqual({ hours: 9, minutes: 5 });
    expect(parseTime("24:00")).toBeNull();
    expect(parseTime("9:05")).toBeNull();
    expect(parseTime(905)).toBeNull();
  });

  test("cron schedules are normalized and validated", () => {
    expect(parseSchedule({ kind: "cron", expr: " 0  9 * * MON-FRI " })).toEqual({
      ok: true,
      schedule: cron("0 9 * * MON-FRI"),
    });
    expect(parseSchedule({ kind: "cron", expr: "nope" })).toEqual({ ok: false, problem: "cron" });
    expect(parseSchedule({ kind: "cron", expr: "0 0 31 2 *" })).toEqual({
      ok: false,
      problem: "cronNever",
    });
    expect(parseSchedule({ kind: "cron", expr: "* * * * *" })).toEqual({
      ok: false,
      problem: "cronTooFrequent",
    });
    expect(parseSchedule(null)).toEqual({ ok: false, problem: "kind" });
    expect(parseSchedule({ kind: "yearly" })).toEqual({ ok: false, problem: "kind" });
  });

  test("daily and weekly schedules saved earlier become the same cron time", () => {
    expect(parseSchedule({ kind: "daily", time: "09:05" })).toEqual({
      ok: true,
      schedule: cron("5 9 * * *"),
    });
    expect(parseSchedule({ kind: "weekly", days: [5, 1, 1], time: "08:00" })).toEqual({
      ok: true,
      schedule: cron("0 8 * * 1,5"),
    });
    expect(parseSchedule({ kind: "weekly", days: [], time: "08:00" }).ok).toBe(false);
    expect(parseSchedule({ kind: "weekly", days: [7], time: "08:00" }).ok).toBe(false);
    expect(parseSchedule({ kind: "daily", time: "nope" }).ok).toBe(false);
  });

  test("intervals saved earlier become the nearest clock-aligned cron", () => {
    const expr = (every: unknown, unit: unknown) => {
      const result = parseSchedule({ kind: "interval", every, unit });
      return result.ok && result.schedule.kind === "cron" ? result.schedule.expr : null;
    };
    expect(expr(5, "minutes")).toBe("*/5 * * * *");
    expect(expr(30, "minutes")).toBe("*/30 * * * *");
    expect(expr(45, "minutes")).toBe("0 * * * *");
    expect(expr(1, "hours")).toBe("0 * * * *");
    expect(expr(2, "hours")).toBe("0 */2 * * *");
    // Halfway between two gaps, the longer one wins: it never runs more often than before.
    expect(expr(5, "hours")).toBe("0 */6 * * *");
    expect(expr(4, "hours")).toBe("0 */4 * * *");
    expect(expr(24, "hours")).toBe("0 0 * * *");
    expect(expr(168, "hours")).toBe("0 0 */7 * *");
    expect(expr(1_440, "minutes")).toBe("0 0 * * *");
    expect(expr(1.5, "hours")).toBeNull();
    expect(expr(0, "hours")).toBeNull();
    expect(expr(2, "days")).toBeNull();
  });
});

describe("nextRun", () => {
  test("disabled tasks never run", () => {
    const disabled = task(cron("0 9 * * *"), 0, { enabled: false });
    expect(nextRun(disabled, at(2026, 3, 4, 8))).toBeNull();
  });

  test("a daily slot is later today, else tomorrow", () => {
    const schedule = cron("30 9 * * *");
    expect(nextRun(task(schedule, 0), at(2026, 3, 4, 8))).toBe(at(2026, 3, 4, 9, 30));
    expect(nextRun(task(schedule, 0), at(2026, 3, 4, 9, 30))).toBe(at(2026, 3, 5, 9, 30));
    expect(nextRun(task(schedule, 0), at(2026, 3, 4, 23, 59))).toBe(at(2026, 3, 5, 9, 30));
  });

  test("a daily slot rolls over month and year ends", () => {
    expect(nextRun(task(cron("15 0 * * *"), 0), at(2026, 12, 31, 12))).toBe(at(2027, 1, 1, 0, 15));
  });

  test("chosen weekdays pick the next one", () => {
    // 2026-03-04 is a Wednesday (3). Monday = 1, Friday = 5.
    const schedule = cron("0 7 * * 1,5");
    expect(nextRun(task(schedule, 0), at(2026, 3, 4, 12))).toBe(at(2026, 3, 6, 7));
    expect(nextRun(task(schedule, 0), at(2026, 3, 6, 7))).toBe(at(2026, 3, 9, 7));
    expect(nextRun(task(schedule, 0), at(2026, 3, 6, 6, 59))).toBe(at(2026, 3, 6, 7));
  });

  test("a single weekday waits a full week after its slot", () => {
    expect(nextRun(task(cron("0 7 * * 3"), 0), at(2026, 3, 4, 7, 1))).toBe(at(2026, 3, 11, 7));
  });

  test("a step runs on the clock, not from the last run", () => {
    const schedule = cron("*/20 * * * *");
    const ran = task(schedule, 0, { lastRunEnd: at(2026, 3, 4, 8, 7) });
    expect(nextRun(ran, at(2026, 3, 4, 8, 7))).toBe(at(2026, 3, 4, 8, 20));
  });

  test("an expression that cannot be read never runs", () => {
    expect(nextRun(task(cron("not cron"), 0), at(2026, 3, 4, 8))).toBeNull();
    expect(lastDue(task(cron("not cron"), 0), at(2026, 3, 4, 8))).toBeNull();
  });
});

describe("one-shot schedules", () => {
  const slot = at(2026, 3, 4, 9);

  test("accepts finite one-shot times", () => {
    expect(parseSchedule({ kind: "once", at: slot })).toEqual({
      ok: true,
      schedule: { kind: "once", at: slot },
    });
    expect(parseSchedule({ kind: "once", at: Number.NaN }).ok).toBe(false);
  });

  test("waits for its slot, catches up once, and expires after the catch-up window", () => {
    const once = task({ kind: "once", at: slot }, slot - HOUR);
    expect(nextRun(once, slot - MINUTE)).toBe(slot);
    expect(lastDue(once, slot - MINUTE)).toBeNull();
    expect(decide(once, slot)).toEqual({ action: "run", dueAt: slot });
    expect(nextRun(once, slot + MINUTE)).toBe(slot + MINUTE);
    expect(decide(once, slot + MINUTE)).toEqual({ action: "run", dueAt: slot });
    expect(nextRun(once, slot + 25 * HOUR)).toBeNull();
    expect(decide(once, slot + 25 * HOUR)).toEqual({ action: "skip" });
  });

  test("a completed slot is not repeated just because the task was re-enabled", () => {
    const completed = task({ kind: "once", at: slot }, slot + 2 * MINUTE, {
      lastRunEnd: slot + MINUTE,
    });
    expect(nextRun(completed, slot + 2 * MINUTE)).toBeNull();
    expect(lastDue(completed, slot + 2 * MINUTE)).toBeNull();
    expect(decide(completed, slot + 2 * MINUTE)).toEqual({ action: "wait" });
  });
});

describe("lastDue / decide (catch-up)", () => {
  const daily = cron("0 9 * * *");

  test("nothing is due before the first slot after arming", () => {
    const armed = at(2026, 3, 4, 10);
    expect(lastDue(task(daily, armed), at(2026, 3, 5, 8))).toBeNull();
    expect(decide(task(daily, armed), at(2026, 3, 5, 8))).toEqual({ action: "wait" });
  });

  test("a slot is due once its moment has come", () => {
    const t = task(daily, at(2026, 3, 4, 8));
    expect(decide(t, at(2026, 3, 4, 8, 30))).toEqual({ action: "wait" });
    expect(decide(t, at(2026, 3, 4, 9))).toEqual({ action: "run", dueAt: at(2026, 3, 4, 9) });
  });

  test("a slot missed while the app was closed runs once, within 24 hours", () => {
    const closed = task(daily, 0, { lastRunEnd: at(2026, 3, 4, 9, 1) });
    expect(decide(closed, at(2026, 3, 5, 10))).toEqual({ action: "run", dueAt: at(2026, 3, 5, 9) });
  });

  test("several missed slots collapse into one run", () => {
    const closed = task(daily, 0, { lastRunEnd: at(2026, 3, 1, 9, 1) });
    expect(decide(closed, at(2026, 3, 5, 9, 30))).toEqual({
      action: "run",
      dueAt: at(2026, 3, 5, 9),
    });
  });

  test("a slot older than 24 hours is skipped", () => {
    const weekly = task(cron("0 9 * * 3"), 0, { lastRunEnd: at(2026, 2, 25, 9, 1) });
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
    expect(nextRun(done, at(2026, 3, 5, 12))).toBe(at(2026, 3, 6, 9));
  });

  test("frequent schedules catch up once, with the latest slot, however long the app was closed", () => {
    const hourly = task(cron("0 * * * *"), at(2026, 3, 4, 8));
    expect(decide(hourly, at(2026, 3, 4, 8, 30))).toEqual({ action: "wait" });
    expect(decide(hourly, at(2026, 3, 4, 14, 20))).toEqual({
      action: "run",
      dueAt: at(2026, 3, 4, 14),
    });
    expect(decide(hourly, at(2026, 3, 8, 14, 20))).toEqual({
      action: "run",
      dueAt: at(2026, 3, 8, 14),
    });
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
    const schedule = cron("0 9 * * *");
    const saturday = at(2026, 3, 7, 10);
    const next = nextRun(task(schedule, 0), saturday);
    expect(next).toBe(at(2026, 3, 8, 9));
    expect(new Date(next ?? 0).getHours()).toBe(9);
    // Only 22 hours after Saturday 10:00 EST, because the clock jumped.
    expect((next ?? 0) - saturday).toBe(22 * HOUR);
  });

  test("daily 09:00 stays at 09:00 local across fall back (2026-11-01)", () => {
    const schedule = cron("0 9 * * *");
    const saturday = at(2026, 10, 31, 10);
    const next = nextRun(task(schedule, 0), saturday);
    expect(new Date(next ?? 0).getHours()).toBe(9);
    expect(new Date(next ?? 0).getDate()).toBe(1);
    // 23 hours on the wall clock, 24 elapsed because the clock went back.
    expect((next ?? 0) - saturday).toBe(24 * HOUR);
  });

  test("weekly across spring forward keeps the local time", () => {
    const schedule = cron("30 6 * * 1");
    const next = nextRun(task(schedule, 0), at(2026, 3, 6, 12));
    expect(next).toBe(at(2026, 3, 9, 6, 30));
    expect(new Date(next ?? 0).getHours()).toBe(6);
  });

  test("a slot inside the skipped hour is still found once", () => {
    const schedule = cron("30 2 * * *");
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
  function setup(expr = "*/30 * * * *") {
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
      schedule: { kind: "cron" as const, expr },
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
    // Wednesdays at 09:00; the app starts on the Saturday after the last slot.
    const { scheduler, log, advance } = setup("0 9 * * 3");
    advance(3 * 24 * HOUR);
    scheduler.start();
    expect(log).toEqual(["rearm a", "rearm b"]);
    scheduler.stop();
  });

  test("a one-shot that is overdue by more than a day is handed back once, not re-armed", () => {
    const now = at(2026, 3, 4, 9, 0);
    const once = {
      id: "o",
      name: "o",
      prompt: "p",
      agentId: "default",
      workspaceId: "default",
      enabled: true,
      armedAt: now - 5 * 24 * HOUR,
      lastRun: null,
      schedule: { kind: "once" as const, at: now - 3 * 24 * HOUR },
    };
    const skipped: string[] = [];
    const scheduler = new Scheduler({
      now: () => now,
      tasks: () => [once],
      rearm: (id) => skipped.push(id),
      run: async () => undefined,
      changed: () => undefined,
    });
    scheduler.start();
    expect(skipped).toEqual(["o"]);
    scheduler.stop();
  });
});
