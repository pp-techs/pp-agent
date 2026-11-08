import { RESEARCH_DEPTHS, type ResearchDepth } from "@workspace/shared";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { InputGroupButton } from "@workspace/ui/components/input-group";
import { SearchIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { researchDepthKey } from "@/lib/research";

/**
 * The message box's research switch: pick a depth to research the next message, or turn it off.
 * It turns itself off after a run starts, so a normal message follows.
 */
export function ResearchToggle({
  depth,
  on,
  onChange,
  disabled,
}: {
  depth: ResearchDepth;
  on: boolean;
  onChange: (next: { on: boolean; depth: ResearchDepth }) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation("chat");
  const time = { quick: "2–5 min", standard: "5–15 min", deep: "15–30 min" } as const;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <InputGroupButton
            size="sm"
            variant={on ? "secondary" : "ghost"}
            className="h-9 gap-1.5 rounded-full px-3"
            aria-label={t("research.toggle")}
            aria-pressed={on}
            disabled={disabled}
          />
        }
      >
        <SearchIcon />
        <span className="max-sm:hidden">
          {on ? t(researchDepthKey(depth)) : t("research.toggle")}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>{t("research.toggle")}</DropdownMenuLabel>
        {RESEARCH_DEPTHS.map((value) => (
          <DropdownMenuItem key={value} onClick={() => onChange({ on: true, depth: value })}>
            <div className="flex flex-col">
              <span>{t(researchDepthKey(value))}</span>
              <span className="text-xs text-muted-foreground">{time[value]}</span>
            </div>
          </DropdownMenuItem>
        ))}
        {on && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onChange({ on: false, depth })}>
              {t("research.off")}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
