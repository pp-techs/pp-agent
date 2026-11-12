import { ClockIcon } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { cn } from "@workspace/ui/lib/utils";

const pad = (value: number) => String(value).padStart(2, "0");
const HOURS = Array.from({ length: 24 }, (_, hour) => ({ value: pad(hour), label: pad(hour) }));
const MINUTES = Array.from({ length: 60 }, (_, minute) => ({
  value: pad(minute),
  label: pad(minute),
}));

/**
 * Picks a time of day as `HH:MM` (24 hours) from two lists, hours and minutes. The browser's own
 * time control opens a white list that ignores the app's theme, so this one is built from Select.
 */
export function TimeField({
  id,
  value,
  onChange,
  label,
  invalid,
  className,
}: {
  id?: string;
  /** `HH:MM`; anything else shows 09:00 until a part is picked. */
  value: string;
  onChange: (next: string) => void;
  /** Accessible name of the field; each list adds "hours" or "minutes" to it. */
  label: string;
  invalid?: boolean;
  className?: string;
}) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)/.exec(value);
  const hours = match?.[1] ?? "09";
  const minutes = match?.[2] ?? "00";

  return (
    <div role="group" aria-label={label} className={cn("flex items-center gap-1.5", className)}>
      <ClockIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <Select
        items={HOURS}
        value={hours}
        onValueChange={(next) => next !== null && onChange(`${next}:${minutes}`)}
      >
        <SelectTrigger id={id} aria-label={`${label} (HH)`} aria-invalid={invalid} className="w-18">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-64">
          {HOURS.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span aria-hidden className="text-muted-foreground">
        :
      </span>
      <Select
        items={MINUTES}
        value={minutes}
        onValueChange={(next) => next !== null && onChange(`${hours}:${next}`)}
      >
        <SelectTrigger aria-label={`${label} (MM)`} aria-invalid={invalid} className="w-18">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-64">
          {MINUTES.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
