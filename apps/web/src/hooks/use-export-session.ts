import type { DesktopBridge, ExportFormat } from "@workspace/shared";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

/** Renders a saved conversation in the agent, then asks main where to save it. */
export function useExportSession(bridge: DesktopBridge) {
  const { t } = useTranslation("chat");
  return useMutation({
    mutationFn: async (input: { path: string; format: ExportFormat }) => {
      const { suggestedName, content } = await bridge.agent.command({
        type: "export_session",
        ...input,
      });
      return bridge.files.saveExport(suggestedName, input.format, content);
    },
    onSuccess: (saved) => {
      if (saved) toast.success(t("export.saved"));
    },
    onError: (error: Error) => toast.error(error.message),
  });
}
