import { useMutation } from "@tanstack/react-query";
import type { ConfigImportReport, DesktopBridge } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { OptionGroup } from "@/components/settings/option-group";

/** Settings › Advanced: export the app setup as one file, or apply one, so copies get set up alike. */
export function ConfigBundleGroup({ bridge }: { bridge: DesktopBridge }) {
  const { t } = useTranslation("settings");
  const onError = (error: Error) => toast.error(error.message);

  const exportConfig = useMutation({
    mutationFn: async () => {
      const json = await bridge.agent.command({ type: "export_config" });
      return bridge.files.saveConfigFile("pp-agent-config", json);
    },
    onSuccess: (saved) => {
      if (saved) toast.success(t("advanced.configGroup.exported"));
    },
    onError,
  });
  const importConfig = useMutation({
    mutationFn: async (): Promise<ConfigImportReport | null> => {
      const json = await bridge.files.openConfigFile();
      return json ? bridge.agent.command({ type: "import_config", json }) : null;
    },
    onSuccess: (report) => {
      if (!report) return;
      toast.success(
        t("advanced.configGroup.imported", {
          gateways: report.gateways,
          agents: report.agents,
          servers: report.mcpServers,
        }),
      );
    },
    onError,
  });

  return (
    <OptionGroup
      legend={t("advanced.configGroup.legend")}
      description={t("advanced.configGroup.description")}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          disabled={exportConfig.isPending}
          onClick={() => exportConfig.mutate()}
        >
          {t("advanced.configGroup.export")}
        </Button>
        <Button
          variant="outline"
          disabled={importConfig.isPending}
          onClick={() => importConfig.mutate()}
        >
          {t("advanced.configGroup.import")}
        </Button>
      </div>
    </OptionGroup>
  );
}
