import * as React from "react";
import type { ChannelState } from "@workspace/shared";
import { Badge } from "@workspace/ui/components/badge";

export const STATE_VARIANT: Record<ChannelState, React.ComponentProps<typeof Badge>["variant"]> = {
  off: "outline",
  connecting: "secondary",
  online: "default",
  error: "destructive",
};

/** Current time, refreshed every second while `active`. */
export function useNow(active: boolean) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

export function formatCountdown(ms: number) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
