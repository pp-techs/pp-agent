import * as React from "react";
import { Button } from "@workspace/ui/components/button";
import { XIcon } from "lucide-react";

/** The row of tabs at the top of a main-area group; scrolls sideways when it overflows. */
export function PanelTabs({
  children,
  className = "shrink-0",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex items-center gap-1 overflow-x-auto px-1.5 [scrollbar-color:var(--border)_transparent] [scrollbar-width:thin] ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * One tab: an icon and a label, an optional badge, and a close button unless it is pinned. A tab
 * that becomes the active one scrolls into view in a crowded row; `emphasized` marks the tab the
 * rest hang off (the chat).
 */
export function PanelTab({
  active,
  icon,
  label,
  title,
  badge,
  closeLabel,
  emphasized,
  onSelect,
  onClose,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  title?: string;
  badge?: React.ReactNode;
  closeLabel?: string;
  emphasized?: boolean;
  onSelect: () => void;
  /** Omitted for a tab that cannot be closed. */
  onClose?: () => void;
}) {
  const element = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (active) element.current?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [active]);

  return (
    <div
      ref={element}
      data-active={active || undefined}
      className={`group flex h-7 max-w-48 min-w-0 shrink-0 items-center rounded-lg text-xs data-active:bg-muted data-active:text-foreground ${emphasized ? "bg-muted/50 font-medium text-foreground" : "text-muted-foreground"}`}
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
