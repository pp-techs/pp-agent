import type { TaskSchedule } from "@workspace/shared";
import type { TFunction } from "i18next";

/** Weekdays as the editor lists them, Monday first. Numbers follow `Date.getDay()`: 0 = Sunday. */
export const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

/** "Mon" / "Thứ Hai" in the app language. 4 January 2026 is a Sunday. */
export function weekdayName(day: number, locale: string, width: "short" | "long" = "short") {
  return new Intl.DateTimeFormat(locale, { weekday: width }).format(new Date(2026, 0, 4 + day));
}

/** "24 Oct 2026, 9:30 AM" in the app language. */
export function formatWhen(epochMs: number, locale: string) {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
    epochMs,
  );
}

/** "Cron: 0 9 * * MON-FRI", or the date of a one-time task. */
export function formatSchedule(schedule: TaskSchedule, t: TFunction<"settings">, locale: string) {
  return schedule.kind === "cron"
    ? t("scheduledTasks.schedule.cron", { expr: schedule.expr })
    : t("scheduledTasks.schedule.once", { when: formatWhen(schedule.at, locale) });
}
