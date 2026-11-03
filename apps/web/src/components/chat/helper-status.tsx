import type { HelperProgress } from "@workspace/shared";
import { cn } from "@workspace/ui/lib/utils";
import { CircleCheckIcon, CircleXIcon, LoaderCircleIcon } from "lucide-react";

/** The icon beside a sub agent: spinning while it works, a check when it finishes, an x when it fails. */
export function HelperStatusIcon({
  status,
  className,
}: {
  status: HelperProgress["status"];
  className?: string;
}) {
  const classes = cn("size-3 shrink-0", className);
  if (status === "done") return <CircleCheckIcon aria-hidden className={classes} />;
  if (status === "failed")
    return <CircleXIcon aria-hidden className={cn(classes, "text-destructive")} />;
  return <LoaderCircleIcon aria-hidden className={cn(classes, "animate-spin")} />;
}
