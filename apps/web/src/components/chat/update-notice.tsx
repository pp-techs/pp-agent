import type { DesktopBridge } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Spinner } from "@workspace/ui/components/spinner";
import { DownloadIcon } from "lucide-react";

import { describeUpdate, updateAction } from "@/components/update-actions";
import { useUpdateStore } from "@/stores/update-store";

/** Sidebar card shown only while a newer version is waiting, downloading, or ready to install. */
export function UpdateNotice({ bridge }: { bridge: DesktopBridge }) {
  const update = useUpdateStore((state) => state.update);
  if (!update) return null;
  if (update.status !== "available" && update.status !== "downloading" && update.status !== "ready")
    return null;

  const action = updateAction(bridge, update);
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-card p-3 text-xs" role="status">
      <div className="flex items-start gap-2">
        {update.status === "downloading" ? (
          <Spinner className="mt-0.5 shrink-0" />
        ) : (
          <DownloadIcon className="mt-0.5 size-4 shrink-0" />
        )}
        <span>{describeUpdate(update)}</span>
      </div>
      {action && (
        <Button size="sm" onClick={action.run}>
          {action.label}
        </Button>
      )}
    </div>
  );
}
