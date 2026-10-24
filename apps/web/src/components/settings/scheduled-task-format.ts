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

/** "Every 2 hours", "Every day at 09:00", "Mon, Wed at 09:00". */
export function formatSchedule(schedule: TaskSchedule, t: TFunction<"settings">, locale: string) {
  switch (schedule.kind) {
    case "interval":
      return schedule.unit === "minutes"
        ? t("scheduledTasks.schedule.intervalMinutes", { count: schedule.every })
        : t("scheduledTasks.schedule.intervalHours", { count: schedule.every });
    case "daily":
      return t("scheduledTasks.schedule.daily", { time: schedule.time });
    case "weekly":
      return t("scheduledTasks.schedule.weekly", {
        days: WEEKDAY_ORDER.filter((day) => schedule.days.includes(day))
          .map((day) => weekdayName(day, locale))
          .join(", "),
        time: schedule.time,
      });
  }
}
