/**
 * Five-field cron expressions (`minute hour day-of-month month day-of-week`), read in the
 * computer's local time. Supported per field: `*`, numbers, lists (`1,15`), ranges (`1-5`), steps
 * (every tenth: star, slash, 10; also `1-30/5` and `5/15`) and, for months and weekdays, three-letter English names
 * (`JAN`, `MON-FRI`). Weekdays are 0-6 from Sunday; 7 also means Sunday. As in classic cron, when
 * both day-of-month and day-of-week are restricted, a day matching either one runs.
 *
 * Slots are built from calendar fields (`new Date(y, m, d, h, min)`), so daylight-saving changes do
 * not shift them; a slot inside a skipped hour happens right after the gap.
 */

export type CronProblem =
  /** Not five fields, or a field that does not parse or is out of range. */
  | "syntax"
  /** Valid, but no date ever matches (for example `0 0 31 2 *`). */
  | "never"
  /** Two runs can be closer than the minimum gap. */
  | "tooFrequent";

export interface CronSpec {
  /** The expression, trimmed with single spaces between fields. */
  expr: string;
  /** Minutes of the day (0-1439) that run on a matching date, ascending. */
  times: number[];
  months: ReadonlySet<number>;
  daysOfMonth: ReadonlySet<number>;
  daysOfWeek: ReadonlySet<number>;
  /** The field starts with `*`: it does not narrow the match. */
  anyDayOfMonth: boolean;
  anyDayOfWeek: boolean;
}

export type CronResult = { ok: true; spec: CronSpec } | { ok: false; problem: CronProblem };

export const CRON_MAX_LENGTH = 100;

const MONTH_NAMES = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];
const WEEKDAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
/** How far ahead a search goes; covers a 29 February that falls on a chosen weekday. */
const SEARCH_DAYS = 366 * 8;
const DAY_MINUTES = 24 * 60;

function parseValue(text: string, names: string[], offset: number): number | null {
  if (/^\d+$/.test(text)) return Number(text);
  const index = names.indexOf(text.toLowerCase());
  return index === -1 ? null : index + offset;
}

function parseField(
  text: string,
  min: number,
  max: number,
  names: string[] = [],
  nameOffset = 0,
): Set<number> | null {
  const values = new Set<number>();
  for (const part of text.split(",")) {
    const [range, step, ...rest] = part.split("/");
    if (rest.length > 0 || range === undefined || range === "") return null;
    let size = 1;
    if (step !== undefined) {
      if (!/^\d+$/.test(step)) return null;
      size = Number(step);
      if (size < 1) return null;
    }
    let from: number | null;
    let to: number | null;
    if (range === "*") {
      from = min;
      to = max;
    } else if (range.includes("-")) {
      const [first, last, ...extra] = range.split("-");
      if (extra.length > 0 || first === undefined || last === undefined) return null;
      from = parseValue(first, names, nameOffset);
      to = parseValue(last, names, nameOffset);
    } else {
      from = parseValue(range, names, nameOffset);
      // `5/15` runs from 5 to the end of the field; a plain `5` is only 5.
      to = step === undefined ? from : max;
    }
    if (from === null || to === null || from < min || to > max || from > to) return null;
    for (let value = from; value <= to; value += size) values.add(value);
  }
  return values.size > 0 ? values : null;
}

const LONG_MONTHS = new Set([1, 3, 5, 7, 8, 10, 12]);

/** Whether some chosen month has a chosen day of month (29 February counts). */
function hasCalendarDay(months: ReadonlySet<number>, days: ReadonlySet<number>): boolean {
  for (const month of months) {
    const last = month === 2 ? 29 : LONG_MONTHS.has(month) ? 31 : 30;
    for (const day of days) if (day <= last) return true;
  }
  return false;
}

/** The smallest gap in minutes between two runs, assuming consecutive days both match. */
function smallestGap(times: number[]): number {
  let gap = DAY_MINUTES;
  for (let index = 0; index < times.length; index += 1) {
    const next = times[index + 1] ?? (times[0] ?? 0) + DAY_MINUTES;
    gap = Math.min(gap, next - (times[index] ?? 0));
  }
  return gap;
}

/** Reads a cron expression; `minGapMinutes` rejects expressions that can run more often. */
export function parseCron(raw: unknown, minGapMinutes = 1): CronResult {
  if (typeof raw !== "string" || raw.length > CRON_MAX_LENGTH)
    return { ok: false, problem: "syntax" };
  const fields = raw.trim().split(/\s+/);
  if (fields.length !== 5) return { ok: false, problem: "syntax" };
  const [minuteText, hourText, domText, monthText, dowText] = fields as [
    string,
    string,
    string,
    string,
    string,
  ];
  const minutes = parseField(minuteText, 0, 59);
  const hours = parseField(hourText, 0, 23);
  const daysOfMonth = parseField(domText, 1, 31);
  const months = parseField(monthText, 1, 12, MONTH_NAMES, 1);
  const weekdays = parseField(dowText, 0, 7, WEEKDAY_NAMES, 0);
  if (!minutes || !hours || !daysOfMonth || !months || !weekdays)
    return { ok: false, problem: "syntax" };
  const daysOfWeek = new Set([...weekdays].map((day) => day % 7));
  const anyDayOfMonth = domText.startsWith("*");
  const anyDayOfWeek = dowText.startsWith("*");
  if (!anyDayOfMonth && anyDayOfWeek && !hasCalendarDay(months, daysOfMonth))
    return { ok: false, problem: "never" };
  const times = [...hours]
    .flatMap((hour) => [...minutes].map((minute) => hour * 60 + minute))
    .sort((a, b) => a - b);
  if (smallestGap(times) < minGapMinutes) return { ok: false, problem: "tooFrequent" };
  return {
    ok: true,
    spec: {
      expr: fields.join(" "),
      times,
      months,
      daysOfMonth,
      daysOfWeek,
      anyDayOfMonth,
      anyDayOfWeek,
    },
  };
}

function dayMatches(spec: CronSpec, day: Date): boolean {
  if (!spec.months.has(day.getMonth() + 1)) return false;
  const ofMonth = spec.daysOfMonth.has(day.getDate());
  const ofWeek = spec.daysOfWeek.has(day.getDay());
  if (spec.anyDayOfMonth || spec.anyDayOfWeek) return ofMonth && ofWeek;
  return ofMonth || ofWeek;
}

function slot(day: Date, offset: number, minuteOfDay: number): number {
  return new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate() + offset,
    Math.floor(minuteOfDay / 60),
    minuteOfDay % 60,
  ).getTime();
}

/** The first run strictly after `after` (epoch ms), or null when none falls within eight years. */
export function nextCronRun(spec: CronSpec, after: number): number | null {
  const start = new Date(after);
  for (let offset = 0; offset <= SEARCH_DAYS; offset += 1) {
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset);
    if (!dayMatches(spec, day)) continue;
    for (const minuteOfDay of spec.times) {
      const at = slot(day, 0, minuteOfDay);
      if (at > after) return at;
    }
  }
  return null;
}

/** The latest run at or before `atOrBefore` and after `notBefore` (epoch ms), or null. */
export function previousCronRun(
  spec: CronSpec,
  atOrBefore: number,
  notBefore: number,
): number | null {
  const start = new Date(atOrBefore);
  for (let offset = 0; offset >= -SEARCH_DAYS; offset -= 1) {
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset);
    // Midnight after this day is the earliest moment that can no longer matter.
    if (slot(day, 1, 0) <= notBefore) return null;
    if (!dayMatches(spec, day)) continue;
    for (let index = spec.times.length - 1; index >= 0; index -= 1) {
      const at = slot(day, 0, spec.times[index] ?? 0);
      if (at > atOrBefore) continue;
      return at > notBefore ? at : null;
    }
  }
  return null;
}
