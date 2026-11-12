import * as React from "react";
import { Button } from "@workspace/ui/components/button";
import { Calendar } from "@workspace/ui/components/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover";
import { CalendarIcon } from "lucide-react";
import { enUS } from "react-day-picker/locale/en-US";
import { vi } from "react-day-picker/locale/vi";
import { useTranslation } from "react-i18next";

import { TimeField } from "@/components/settings/time-field";
import { formatWhen } from "@/components/settings/scheduled-task-format";
import { localDateTime, parseLocalDateTime } from "@/components/settings/scheduled-task-fields";

const pad = (value: number) => String(value).padStart(2, "0");
const dayOf = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/**
 * Picks a local date and time. The value is a `datetime-local` string (`2026-11-12T09:00`); an
 * existing value keeps its seconds and milliseconds until the person changes the time.
 */
export function DateTimePicker({
  id,
  value,
  onChange,
  invalid,
}: {
  id?: string;
  value: string;
  onChange: (next: string) => void;
  invalid?: boolean;
}) {
  const { t, i18n } = useTranslation("settings");
  const [open, setOpen] = React.useState(false);
  const parsed = parseLocalDateTime(value);
  const selectedDate = parsed ? new Date(parsed.year, parsed.month - 1, parsed.day) : undefined;
  const time = parsed?.time ?? "09:00";
  const [today] = React.useState(() => new Date(new Date().setHours(0, 0, 0, 0)));

  function pickDay(date: Date | undefined) {
    if (date) onChange(`${dayOf(date)}T${time}`);
  }

  function pickTime(next: string) {
    // An empty or half-typed time must not wipe the date.
    if (/^\d{2}:\d{2}$/.test(next)) onChange(`${dayOf(selectedDate ?? today)}T${next}`);
  }

  function preset(at: Date) {
    onChange(localDateTime(at.getTime()));
    setOpen(false);
  }

  function inOneHour() {
    const at = new Date();
    at.setHours(at.getHours() + 1, 0, 0, 0);
    return at;
  }

  function tomorrowMorning() {
    const at = new Date();
    at.setDate(at.getDate() + 1);
    at.setHours(9, 0, 0, 0);
    return at;
  }

  const label = parsed ? formatWhen(parsed.timestamp, i18n.language) : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        id={id}
        aria-invalid={invalid}
        render={
          <Button type="button" variant="outline" className="w-full justify-start font-normal" />
        }
      >
        <CalendarIcon data-icon="inline-start" />
        {label ?? (
          <span className="text-muted-foreground">{t("scheduledTasks.editor.when.pick")}</span>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 gap-3 p-3">
        <Calendar
          mode="single"
          selected={selectedDate}
          onSelect={pickDay}
          defaultMonth={selectedDate ?? today}
          disabled={{ before: today }}
          weekStartsOn={1}
          locale={i18n.language.startsWith("vi") ? vi : enUS}
        />
        <TimeField
          label={t("scheduledTasks.editor.when.time")}
          value={time.slice(0, 5)}
          onChange={pickTime}
        />
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={() => preset(inOneHour())}>
            {t("scheduledTasks.editor.when.inOneHour")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => preset(tomorrowMorning())}
          >
            {t("scheduledTasks.editor.when.tomorrow")}
          </Button>
        </div>
        <Button type="button" size="sm" onClick={() => setOpen(false)}>
          {t("scheduledTasks.editor.when.done")}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
