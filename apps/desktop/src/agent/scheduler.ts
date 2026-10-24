/**
 * Scheduled tasks: when a task is due (pure functions, local time) and the queue that runs them.
 *
 * Times are wall-clock times of the computer. A day's slot is built from calendar fields
 * (`new Date(y, m, d + n, h, min)`), never by adding 24 hours, so daylight-saving changes do not
 * shift "daily at 09:00". A slot inside a skipped hour (spring forward) happens right after the gap.
 */
import type { ScheduledTask, TaskSchedule } from "@workspace/shared";
import { SCHEDULE_LIMITS } from "@workspace/shared";

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

export type ScheduleProblem = "interval" | "time" | "days" | "kind";

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

/** A schedule from untrusted input (settings.json or the UI), normalized, or why it does not fit. */
export function parseSchedule(raw: unknown): ParsedSchedule {
  if (typeof raw !== "object" || raw === null) return { ok: false, problem: "kind" };
  const value = raw as Record<string, unknown>;
  switch (value.kind) {
    case "interval": {
      const { every, unit } = value;
      if (unit !== "minutes" && unit !== "hours") return { ok: false, problem: "interval" };
      const [min, max] =
        unit === "minutes"
          ? [SCHEDULE_LIMITS.minMinutes, SCHEDULE_LIMITS.maxMinutes]
          : [1, SCHEDULE_LIMITS.maxHours];
      if (typeof every !== "number" || !Number.isInteger(every) || every < min || every > max)
        return { ok: false, problem: "interval" };
      return { ok: true, schedule: { kind: "interval", every, unit } };
    }
    case "daily":
      if (!parseTime(value.time)) return { ok: false, problem: "time" };
      return { ok: true, schedule: { kind: "daily", time: value.time as string } };
    case "weekly": {
      if (!parseTime(value.time)) return { ok: false, problem: "time" };
      const days = Array.isArray(value.days)
        ? [...new Set(value.days)].filter(
            (day): day is number => Number.isInteger(day) && day >= 0 && day <= 6,
          )
        : [];
      if (days.length === 0) return { ok: false, problem: "days" };
      return {
        ok: true,
        schedule: { kind: "weekly", days: days.sort((a, b) => a - b), time: value.time as string },
      };
    }
    default:
      return { ok: false, problem: "kind" };
  }
}

// ---------------------------------------------------------------------------------------------
// When is a task due
// ---------------------------------------------------------------------------------------------

function intervalMs(schedule: Extract<TaskSchedule, { kind: "interval" }>): number {
  return schedule.every * (schedule.unit === "minutes" ? MINUTE_MS : HOUR_MS);
}

/** Epoch ms of `time` on the calendar day `offset` days from `day`'s date, in local time. */
function slotAt(day: Date, offset: number, time: string): number {
  const { hours, minutes } = parseTime(time) ?? { hours: 0, minutes: 0 };
  return new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate() + offset,
    hours,
    minutes,
    0,
    0,
  ).getTime();
}

/** Runs before this moment are already accounted for. */
function since(task: Schedulable): number {
  return Math.max(task.armedAt, task.lastRunEnd ?? 0);
}

function runsOn(task: Schedulable, day: Date, offset: number): boolean {
  const { schedule } = task;
  if (schedule.kind === "daily") return true;
  if (schedule.kind === "weekly") {
    const weekday = new Date(day.getFullYear(), day.getMonth(), day.getDate() + offset).getDay();
    return schedule.days.includes(weekday);
  }
  return false;
}

/**
 * The next time the task is scheduled to run, strictly after `now`; null while it is disabled.
 * An interval task that is already due returns `now`.
 */
export function nextRun(task: Schedulable, now: number): number | null {
  if (!task.enabled) return null;
  const { schedule } = task;
  if (schedule.kind === "interval") return Math.max(since(task) + intervalMs(schedule), now);
  const day = new Date(now);
  // A week and a day cover every weekday, including today's slot already being past.
  for (let offset = 0; offset <= 7; offset += 1) {
    if (!runsOn(task, day, offset)) continue;
    const slot = slotAt(day, offset, schedule.time);
    if (slot > now) return slot;
  }
  return null;
}

/** The latest scheduled moment at or before `now` that no run has covered yet; null if none. */
export function lastDue(task: Schedulable, now: number): number | null {
  if (!task.enabled) return null;
  const { schedule } = task;
  const baseline = since(task);
  if (schedule.kind === "interval") {
    const due = baseline + intervalMs(schedule);
    return due <= now ? due : null;
  }
  const day = new Date(now);
  for (let offset = 0; offset >= -7; offset -= 1) {
    if (!runsOn(task, day, offset)) continue;
    const slot = slotAt(day, offset, schedule.time);
    if (slot > now) continue;
    return slot > baseline ? slot : null;
  }
  return null;
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
