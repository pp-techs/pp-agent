import { cn } from "cn";
import { Loader2Icon } from "lucide-react";

import { useUiLabels } from "@workspace/ui/components/ui-labels";

function Spinner({
  className,
  label,
  ...props
}: React.ComponentProps<"svg"> & {
  /** Accessible name announced for the status icon. */
  label?: string;
}) {
  const labels = useUiLabels();
  return (
    <Loader2Icon
      data-slot="spinner"
      role="status"
      aria-label={label ?? labels.loading}
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  );
}

export { Spinner };
