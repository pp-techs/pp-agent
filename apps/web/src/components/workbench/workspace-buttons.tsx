import type { DesktopBridge } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip";
import { FolderOpenIcon, PanelRightIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { IS_MAC } from "@/hooks/use-panel-shortcut";
import { useChatStore } from "@/stores/chat-store";
import { usePanelStore } from "@/stores/panel-store";

/** Opens the folder the open conversation works in (its workspace's folder). */
export function OpenFolderButton({ bridge }: { bridge: DesktopBridge }) {
  const workspaceDir = useChatStore((state) => state.workspaceDir);
  const { t } = useTranslation("chat");
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("header.openFolder")}
            disabled={!workspaceDir}
            onClick={() => {
              if (workspaceDir)
                bridge.files
                  .openWorkspace(workspaceDir)
                  .catch((error: Error) => toast.error(error.message));
            }}
          />
        }
      >
        <FolderOpenIcon />
      </TooltipTrigger>
      <TooltipContent>{t("header.openFolder")}</TooltipContent>
    </Tooltip>
  );
}

/** Opens and closes the side panel (the file tree). */
export function SidePanelButton() {
  const open = usePanelStore((state) => state.open);
  const toggle = usePanelStore((state) => state.toggle);
  const { t } = useTranslation("chat");
  const label = open ? t("panel.close") : t("panel.open");
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="max-md:hidden"
            aria-label={label}
            aria-pressed={open}
            onClick={toggle}
          />
        }
      >
        <PanelRightIcon />
      </TooltipTrigger>
      <TooltipContent>
        {t("panel.toggleWithShortcut", { label, shortcut: IS_MAC ? "⌘J" : "Ctrl+J" })}
      </TooltipContent>
    </Tooltip>
  );
}
