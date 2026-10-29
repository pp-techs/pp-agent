import type * as React from "react";
import { Button } from "@workspace/ui/components/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip";
import { PlusIcon, XIcon } from "lucide-react";

/** The row of tabs at the top of a side panel tool; scrolls sideways when it overflows. */
export function PanelTabs({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex shrink-0 items-center gap-1 overflow-x-auto px-2 pb-1">{children}</div>
  );
}

/** One tab: an icon and a label, an optional badge, and a close button unless it is pinned. */
export function PanelTab({
  active,
  icon,
  label,
  title,
  badge,
  closeLabel,
  onSelect,
  onClose,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  title?: string;
  badge?: React.ReactNode;
  closeLabel?: string;
  onSelect: () => void;
  /** Omitted for a tab that cannot be closed. */
  onClose?: () => void;
}) {
  return (
    <div
      data-active={active || undefined}
      className="group flex h-7 max-w-48 min-w-0 shrink-0 items-center rounded-lg text-xs text-muted-foreground data-active:bg-muted data-active:text-foreground"
    >
      <button
        type="button"
        title={title ?? label}
        aria-pressed={active}
        className={`flex h-full min-w-0 items-center gap-1.5 rounded-lg pl-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 [&_svg]:size-3.5 [&_svg]:shrink-0 ${onClose ? "pr-1" : "pr-2.5"}`}
        onClick={onSelect}
        onAuxClick={(event) => {
          // Middle click closes, as in browsers and editors.
          if (event.button === 1 && onClose) onClose();
        }}
      >
        {icon}
        <span className="truncate">{label}</span>
        {badge}
      </button>
      {onClose && (
        <Button
          variant="ghost"
          size="icon-xs"
          className="mr-0.5 shrink-0 opacity-60 group-hover:opacity-100"
          aria-label={closeLabel}
          onClick={onClose}
        >
          <XIcon />
        </Button>
      )}
    </div>
  );
}

/** The "+" at the end of a tab row. */
export function NewTabButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Button variant="ghost" size="icon-sm" aria-label={label} onClick={onClick} />}
      >
        <PlusIcon />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
