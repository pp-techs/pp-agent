import { cn } from "@workspace/ui/lib/utils";
import { SparklesIcon, TerminalIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { SlashItem } from "@/lib/slash-commands";
import { slashText } from "@/lib/slash-commands";

/**
 * Commands and skills matching what follows `/` in the message box. Keyboard handling stays in the
 * textarea (arrows, Enter/Tab, Escape), so this only renders the list and handles pointer picks.
 */
export function SlashSuggestions({
  items,
  activeIndex,
  onHover,
  onPick,
}: {
  items: SlashItem[];
  activeIndex: number;
  onHover: (index: number) => void;
  onPick: (item: SlashItem) => void;
}) {
  const { t } = useTranslation("chat");
  return (
    <div
      id="slash-suggestions"
      role="listbox"
      aria-label={t("slash.ariaLabel")}
      className="absolute inset-x-6 bottom-full z-20 mb-2 max-h-72 overflow-y-auto rounded-2xl bg-popover p-1 text-popover-foreground shadow-lg ring-1 ring-foreground/10"
    >
      {items.map((item, index) => {
        const Icon = item.kind === "skill" ? SparklesIcon : TerminalIcon;
        return (
          <div
            key={`${item.kind}:${item.name}`}
            id={`slash-option-${index}`}
            role="option"
            aria-selected={index === activeIndex}
            className={cn(
              "flex cursor-default items-start gap-2.5 rounded-xl px-2.5 py-2 text-sm",
              index === activeIndex && "bg-accent text-accent-foreground",
            )}
            onMouseEnter={() => onHover(index)}
            // Pick on mouse down so the textarea keeps focus.
            onMouseDown={(event) => {
              event.preventDefault();
              onPick(item);
            }}
          >
            <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="flex items-baseline gap-2">
                <span className="font-mono text-xs">{slashText(item).trim()}</span>
                {item.kind === "command" && (
                  <span className="truncate text-xs text-muted-foreground">{item.label}</span>
                )}
              </span>
              <span className="line-clamp-1 text-xs text-muted-foreground">{item.description}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
