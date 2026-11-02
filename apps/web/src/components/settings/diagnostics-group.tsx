import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DesktopBridge } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { OptionGroup } from "@/components/settings/option-group";

const KIB = 1024;

function formatSize(bytes: number): string {
  if (bytes < KIB) return `${bytes} B`;
  if (bytes < KIB * KIB) return `${(bytes / KIB).toFixed(1)} KB`;
  return `${(bytes / KIB / KIB).toFixed(1)} MB`;
}

/** The audit log: export it to send to whoever helps with a problem, find it on disk, or clear it. */
export function DiagnosticsGroup({ bridge }: { bridge: DesktopBridge }) {
  const { t } = useTranslation("settings");
  const queryClient = useQueryClient();
  const info = useQuery({
    queryKey: ["diagnostics"],
    queryFn: () => bridge.diagnostics.info(),
  });
  const onError = (error: Error) => toast.error(error.message);

  const exportLog = useMutation({
    mutationFn: () => bridge.diagnostics.export(),
    onSuccess: (saved) => {
      if (saved) toast.success(t("general.diagnostics.exported"));
    },
    onError,
  });
  const clear = useMutation({
    mutationFn: () => bridge.diagnostics.clear(),
    onSuccess: () => {
      toast.success(t("general.diagnostics.cleared"));
      return queryClient.invalidateQueries({ queryKey: ["diagnostics"] });
    },
    onError,
  });

  return (
    <OptionGroup
      legend={t("general.diagnostics.legend")}
      description={t("general.diagnostics.description")}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" disabled={exportLog.isPending} onClick={() => exportLog.mutate()}>
          {t("general.diagnostics.export")}
        </Button>
        <Button
          variant="outline"
          onClick={() => bridge.diagnostics.reveal().catch((error: Error) => onError(error))}
        >
          {t("general.diagnostics.reveal")}
        </Button>
        <Button variant="ghost" disabled={clear.isPending} onClick={() => clear.mutate()}>
          {t("general.diagnostics.clear")}
        </Button>
        {info.data && (
          <span className="text-xs text-muted-foreground">
            {t("general.diagnostics.size", { size: formatSize(info.data.size) })}
          </span>
        )}
      </div>
    </OptionGroup>
  );
}
