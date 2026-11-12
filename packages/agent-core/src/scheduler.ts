/**
 * Scheduled tasks: when a task is due (pure functions, local time) and the queue that runs them.
 *
 * A task runs once (`once`) or on a cron expression (`cron`, see `@workspace/shared`'s `cron.ts`).
 * Times are wall-clock times of the computer, so daylight-saving changes do not shift
 * "every day at 09:00".
 */
import type { ScheduledTask, TaskSchedule } from "@workspace/shared";
import { nextCronRun, parseCron, previousCronRun, SCHEDULE_LIMITS } from "@workspace/shared";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** A slot missed while the app was closed (or the computer asleep) still runs when this recent. */
export const CATCH_UP_WINDOW_MS = 24 * HOUR_MS;
/** The timer wakes at least this often, so a computer that slept does not run tasks much too late. */
export const MAX_TIMER_MS = MINUTE_MS;
/** Never spin: the earliest the timer fires again. */
export const MIN_TIMER_MS = 1_000;

/** What the scheduling functions read from a task. */
export interface Schedulable {
  enabled: boolean;
  schedule: TaskSchedule;
  /** When the task was created, enabled, or its schedule last changed (epoch ms). */
  armedAt: number;
  /** End of the last run (epoch ms); null = never ran. */
  lastRunEnd: number | null;
}

export function schedulableOf(task: ScheduledTask): Schedulable {
  return {
    enabled: task.enabled,
    schedule: task.schedule,
    armedAt: task.armedAt,
    lastRunEnd: task.lastRun ? task.lastRun.at + task.lastRun.durationMs : null,
  };
}

// ---------------------------------------------------------------------------------------------
// Schedule validation
// ---------------------------------------------------------------------------------------------

export type ScheduleProblem = "kind" | "cron" | "cronNever" | "cronTooFrequent";

export type ParsedSchedule =
  | { ok: true; schedule: TaskSchedule }
  | { ok: false; problem: ScheduleProblem };

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Hours and minutes of an `HH:MM` time, or null. */
export function parseTime(value: unknown): { hours: number; minutes: number } | null {
  if (typeof value !== "string") return null;
  const match = TIME_PATTERN.exec(value);
  return match ? { hours: Number(match[1]), minutes: Number(match[2]) } : null;
}

/** Gaps in minutes that a cron expression can keep: they divide the hour or the day evenly. */
const CLOCK_GAPS = [5, 6, 10, 12, 15, 20, 30, 60, 120, 180, 240, 360, 480, 720, 1_440];

/** The gap closest to `minutes`; halfway between two, the longer one, so a task never runs more often. */
function nearestGap(minutes: number): number {
  return CLOCK_GAPS.reduce((best, gap) =>
    Math.abs(gap - minutes) <= Math.abs(best - minutes) ? gap : best,
  );
}

/**
 * The cron expression for a schedule saved before cron existed (`interval`, `daily`, `weekly`), or
 * null when it does not fit. A daily or weekly slot keeps its exact time. An interval counted
 * from the last run cannot be written in cron, so it is rounded to the nearest step of the clock:
 * every 45 minutes becomes every 30, every 5 hours every 4, every 2 days every 2nd day of the month.
 */
export function legacyToCron(value: Record<string, unknown>): string | null {
  if (value.kind === "daily") {
    const time = parseTime(value.time);
    return time ? `${time.minutes} ${time.hours} * * *` : null;
  }
  if (value.kind === "weekly") {
    const time = parseTime(value.time);
    const days = Array.isArray(value.days)
      ? [...new Set(value.days)]
          .filter((day): day is number => Number.isInteger(day) && day >= 0 && day <= 6)
          .sort((a, b) => a - b)
      : [];
    return time && days.length > 0 ? `${time.minutes} ${time.hours} * * ${days.join(",")}` : null;
  }
  if (value.kind === "interval") {
    const { every, unit } = value;
    if (typeof every !== "number" || !Number.isInteger(every) || every < 1) return null;
    if (unit !== "minutes" && unit !== "hours") return null;
    const minutes = unit === "minutes" ? every : every * 60;
    if (minutes >= 1_440) {
      const days = Math.min(Math.round(minutes / 1_440), 31);
      return days === 1 ? "0 0 * * *" : `0 0 */${days} * *`;
    }
    const gap = nearestGap(minutes);
    if (gap < 60) return `*/${gap} * * * *`;
    return gap === 60 ? "0 * * * *" : `0 */${gap / 60} * * *`;
  }
  return null;
}

/**
 * A schedule from untrusted input (settings.json, the UI or the agent), normalized, or why it does
 * not fit. Schedules saved before cron existed are converted to cron (see `legacyToCron`).
 */
export function parseSchedule(raw: unknown): ParsedSchedule {
  if (typeof raw !== "object" || raw === null) return { ok: false, problem: "kind" };
  let value = raw as Record<string, unknown>;
  if (value.kind === "interval" || value.kind === "daily" || value.kind === "weekly") {
    const expr = legacyToCron(value);
    if (expr === null) return { ok: false, problem: "kind" };
    value = { kind: "cron", expr };
  }
  switch (value.kind) {
    case "cron": {
      const cron = parseCron(value.expr, SCHEDULE_LIMITS.minMinutes);
      if (!cron.ok)
        return {
          ok: false,
          problem:
            cron.problem === "never"
              ? "cronNever"
              : cron.problem === "tooFrequent"
                ? "cronTooFrequent"
                : "cron",
        };
      return { ok: true, schedule: { kind: "cron", expr: cron.spec.expr } };
    }
    case "once": {
      const at = value.at;
      if (typeof at !== "number" || !Number.isFinite(at) || at <= 0)
        return { ok: false, problem: "kind" };
      return { ok: true, schedule: { kind: "once", at } };
    }
    default:
      return { ok: false, problem: "kind" };
  }
}

// ---------------------------------------------------------------------------------------------
// When is a task due
// ---------------------------------------------------------------------------------------------

/** Runs before this moment are already accounted for. */
function since(task: Schedulable): number {
  return Math.max(task.armedAt, task.lastRunEnd ?? 0);
}

/**
 * The next time the task is scheduled to run, strictly after `now`; null while it is disabled.
 */
export function nextRun(task: Schedulable, now: number): number | null {
  if (!task.enabled) return null;
  const { schedule } = task;
  if (schedule.kind === "once") {
    // Fires at `at` even if that moment is recent and was missed; null once past the window.
    return task.lastRunEnd !== null || now - schedule.at > CATCH_UP_WINDOW_MS
      ? null
      : Math.max(schedule.at, now);
  }
  const cron = parseCron(schedule.expr);
  return cron.ok ? nextCronRun(cron.spec, now) : null;
}

/** The latest scheduled moment at or before `now` that no run has covered yet; null if none. */
export function lastDue(task: Schedulable, now: number): number | null {
  if (!task.enabled) return null;
  const { schedule } = task;
  if (schedule.kind === "once") {
    if (task.lastRunEnd !== null) return null;
    return schedule.at <= now ? schedule.at : null;
  }
  const cron = parseCron(schedule.expr);
  return cron.ok ? previousCronRun(cron.spec, now, since(task)) : null;
}

export type Decision =
  | { action: "run"; dueAt: number }
  /** A slot was missed more than the catch-up window ago: forget it and count from now. */
  | { action: "skip" }
  | { action: "wait" };

/**
 * What to do with a task at `now`, also right after the app starts: a slot missed while the app
 * was closed runs once when it was within the last 24 hours, and is skipped otherwise.
 */
export function decide(task: Schedulable, now: number): Decision {
  const due = lastDue(task, now);
  if (due === null) return { action: "wait" };
  return now - due <= CATCH_UP_WINDOW_MS ? { action: "run", dueAt: due } : { action: "skip" };
}

/** Milliseconds until the timer should fire for a task due at `wakeAt`. */
export function timerDelay(wakeAt: number, now: number): number {
  return Math.min(Math.max(wakeAt - now, MIN_TIMER_MS), MAX_TIMER_MS);
}

// ---------------------------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------------------------

export type TaskState = "idle" | "queued" | "running";

export interface SchedulerHost {
  now(): number;
  tasks(): ScheduledTask[];
  /** Persists a new baseline for a task whose missed slot was skipped. */
  rearm(id: string, at: number): void;
  /** Runs the task and records its outcome; the scheduler waits for it. */
  run(task: ScheduledTask): Promise<void>;
  /** A task was queued, started, or finished. */
  changed(): void;
}

/**
 * Decides when tasks run and runs them one at a time, in the order they became due. A task that
 * is queued or running is never queued again. One timer points at the earliest next run and is
 * re-armed after every run, tick, and settings change.
 */
export class Scheduler {
  private timer: NodeJS.Timeout | undefined;
  private readonly queue: string[] = [];
  private current: string | null = null;
  private stopped = false;
  private pumping = false;

  constructor(private readonly host: SchedulerHost) {}

  state(id: string): TaskState {
    if (this.current === id) return "running";
    return this.queue.includes(id) ? "queued" : "idle";
  }

  /** App start: runs what was missed within the last day, then waits for the next slot. */
  start(): void {
    this.tick();
  }

  /** Tasks changed (created, edited, deleted, enabled): recompute the next wake-up. */
  refresh(): void {
    this.tick();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.queue.length = 0;
  }

  /** "Run now": queues the task even when it is disabled. False when it is already queued. */
  runNow(id: string): boolean {
    return this.enqueue(id);
  }

  private enqueue(id: string): boolean {
    if (this.stopped || this.state(id) !== "idle") return false;
    if (!this.host.tasks().some((task) => task.id === id)) return false;
    this.queue.push(id);
    this.host.changed();
    void this.pump();
    return true;
  }

  private tick(): void {
    if (this.stopped) return;
    const now = this.host.now();
    for (const task of this.host.tasks()) {
      if (this.state(task.id) !== "idle") continue;
      const decision = decide(schedulableOf(task), now);
      if (decision.action === "run") this.enqueue(task.id);
      else if (decision.action === "skip") this.host.rearm(task.id, now);
    }
    this.arm();
  }

  private arm(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.stopped) return;
    const now = this.host.now();
    let wakeAt: number | null = null;
    for (const task of this.host.tasks()) {
      if (this.state(task.id) !== "idle") continue;
      const next = nextRun(schedulableOf(task), now);
      if (next !== null && (wakeAt === null || next < wakeAt)) wakeAt = next;
    }
    if (wakeAt === null) return;
    this.timer = setTimeout(() => this.tick(), timerDelay(wakeAt, now));
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      for (let id = this.queue.shift(); id !== undefined; id = this.queue.shift()) {
        const task = this.host.tasks().find((candidate) => candidate.id === id);
        if (!task) {
          this.host.changed();
          continue;
        }
        this.current = id;
        this.host.changed();
        try {
          await this.host.run(task);
        } catch {
          // The host records failures itself; the queue must keep going either way.
        }
        this.current = null;
      }
    } finally {
      this.pumping = false;
      this.current = null;
    }
    this.host.changed();
    this.arm();
  }
}
