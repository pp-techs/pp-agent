import type { TaskSchedule } from "@workspace/shared";

/** A datetime-local value, retaining seconds and milliseconds when present. */
export function localDateTime(at: number): string {
  const date = new Date(at);
  if (!Number.isFinite(date.getTime())) return "";
  const pad = (value: number, length = 2) => String(value).padStart(length, "0");
  const day = `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const seconds = date.getSeconds();
  const milliseconds = date.getMilliseconds();
  const fraction = milliseconds ? `.${pad(milliseconds, 3).replace(/0+$/, "")}` : "";
  return `${day}T${time}${seconds || milliseconds ? `:${pad(seconds)}${fraction}` : ""}`;
}

/** Preserve the original instant, including the later occurrence of a repeated DST hour. */
export function onceTimestamp(value: string, original?: TaskSchedule): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(value)) return NaN;
  const normalized = value.replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, "");
  const canonical = normalized.length > 16 ? normalized.replace(/:00$/, "") : normalized;
  if (original?.kind === "once" && canonical === localDateTime(original.at)) return original.at;
  const date = new Date(value);
  const at = date.getTime();
  // Reject invalid calendar dates and local times skipped by a daylight-saving change.
  if (!Number.isFinite(at) || at <= 0 || localDateTime(at) !== canonical) return NaN;
  // Date chooses the earlier instant during a repeated clock interval. Check the
  // next day's offset for another exact match, without assuming a one-hour change.
  const nextDay = new Date(at + 24 * 60 * 60 * 1_000);
  const repeatedMinutes = nextDay.getTimezoneOffset() - date.getTimezoneOffset();
  if (repeatedMinutes > 0 && localDateTime(at + repeatedMinutes * 60_000) === canonical) return NaN;
  return at;
}
