import { parseCron } from "@workspace/shared";

/**
 * The plain choices the task form offers for a repeating schedule, and how they are written as a
 * cron expression. The agent stores only the cron expression; this turns what a person picks into
 * one (`buildCron`) and an expression back into what the form shows (`describeCron`), so a task is
 * shown as "Every day at 09:00" instead of `0 9 * * *` whenever the form can express it.
 */
export type ScheduleBuilder =
  /** Every N minutes, on the clock (`:00`, `:15`, `:30`, `:45` for 15). */
  | { kind: "minutes"; every: number }
  /** Every N hours at a minute past the hour, from midnight on. */
  | { kind: "hourly"; every: number; minute: number }
  | { kind: "daily"; time: string }
  /** Weekdays are numbered like `Date.getDay()`: 0 = Sunday. */
  | { kind: "weekly"; days: number[]; time: string }
  | { kind: "monthly"; day: number; time: string };

/** Gaps the form offers: each divides the hour (minutes) or the day (hours) evenly. */
export const MINUTE_STEPS = [5, 10, 15, 20, 30] as const;
export const HOUR_STEPS = [1, 2, 3, 4, 6, 8, 12] as const;

export const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

const pad = (value: number) => String(value).padStart(2, "0");

function hoursAndMinutes(time: string): { hours: number; minutes: number } | null {
  const match = TIME_PATTERN.exec(time);
  return match ? { hours: Number(match[1]), minutes: Number(match[2]) } : null;
}

/** The cron expression for a choice, or null when its time is not an `HH:MM` time. */
export function buildCron(choice: ScheduleBuilder): string | null {
  switch (choice.kind) {
    case "minutes":
      return `*/${choice.every} * * * *`;
    case "hourly":
      return choice.every === 1
        ? `${choice.minute} * * * *`
        : `${choice.minute} */${choice.every} * * *`;
    case "daily":
    case "weekly":
    case "monthly": {
      const time = hoursAndMinutes(choice.time);
      if (!time) return null;
      const days =
        choice.kind === "daily"
          ? "* * *"
          : choice.kind === "monthly"
            ? `${choice.day} * *`
            : `* * ${[...new Set(choice.days)].sort((a, b) => a - b).join(",")}`;
      return `${time.minutes} ${time.hours} ${days}`;
    }
  }
}

/**
 * What the form shows for a cron expression, or null when it needs the advanced editor (a gap that
 * is not a round step, several times a day, a day of the month together with weekdays, ...). Equal
 * meaning is enough: `0 9 * * MON-FRI` and `0 9 * * 1,2,3,4,5` are the same weekly choice.
 */
export function describeCron(expr: string): ScheduleBuilder | null {
  const parsed = parseCron(expr);
  if (!parsed.ok) return null;
  const { times, months, daysOfMonth, daysOfWeek, anyDayOfMonth, anyDayOfWeek } = parsed.spec;
  if (months.size !== 12 || times.length === 0) return null;
  const everyDayOfMonth = daysOfMonth.size === 31;
  const everyWeekday = daysOfWeek.size === 7;
  const first = times[0] ?? 0;
  const time = `${pad(Math.floor(first / 60))}:${pad(first % 60)}`;

  if (everyDayOfMonth && everyWeekday) {
    if (times.length === 1) return { kind: "daily", time };
    for (const every of MINUTE_STEPS)
      if (times.length === 1440 / every && times.every((at, index) => at === index * every))
        return { kind: "minutes", every };
    const minute = first;
    for (const every of HOUR_STEPS)
      if (
        minute < 60 &&
        times.length === 24 / every &&
        times.every((at, index) => at === index * every * 60 + minute)
      )
        return { kind: "hourly", every, minute };
    return null;
  }
  if (times.length !== 1) return null;
  // A day of the week with a day of the month (neither `*`) means either one; the form cannot.
  if (everyDayOfMonth && anyDayOfMonth && !everyWeekday)
    return { kind: "weekly", days: [...daysOfWeek].sort((a, b) => a - b), time };
  if (everyWeekday && anyDayOfWeek && !everyDayOfMonth && daysOfMonth.size === 1)
    return { kind: "monthly", day: [...daysOfMonth][0] ?? 1, time };
  return null;
}
