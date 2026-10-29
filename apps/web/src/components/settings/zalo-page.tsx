import { type DesktopBridge } from "@workspace/shared";
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert";
import { Button } from "@workspace/ui/components/button";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { TriangleAlertIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import {
  ConnectStep,
  PairStep,
  RepliesStep,
  StatusLine,
  zaloView,
} from "@/components/settings/channel-setup";
import { ConfirmModal } from "@/components/modals/confirm-modal";
import { useSettingsSubPage } from "@/components/settings/settings-subpage";
import { useBackgroundCommands, zaloStatusQuery } from "@/lib/extension-queries";

/** Settings › Channels › Zalo: connect the bot, pair the owner, choose who answers. */
export function ZaloPage({ bridge }: { bridge: DesktopBridge }) {
  const { t } = useTranslation("settings");
  useSettingsSubPage(t("channels.zalo.title"));
  const query = useQuery(zaloStatusQuery(bridge));
  const { saveZalo, startZaloPairing, forgetZalo } = useBackgroundCommands(bridge);
  const status = query.data;
  const view = status && zaloView(status);
  const actions = { save: saveZalo, startPairing: startZaloPairing };

  async function forget() {
    const confirmed = await ConfirmModal.show({
      title: t("channels.zalo.forget.title"),
      description: t("channels.zalo.forget.description"),
      confirmLabel: t("channels.zalo.forget.confirm"),
    });
    if (!confirmed) return;
    forgetZalo.mutate(undefined, {
      onSuccess: () => toast.success(t("channels.zalo.forget.done")),
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted-foreground">{t("channels.zalo.description")}</p>
      {query.isPending && (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-32 w-full rounded-2xl" />
        </div>
      )}
      {query.isError && (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>{t("channels.loadError")}</AlertTitle>
          <AlertDescription>{query.error.message}</AlertDescription>
        </Alert>
      )}
      {status && view && (
        <>
          <StatusLine channel="zalo" view={view} />
          <ConnectStep channel="zalo" view={view} actions={actions} />
          <PairStep channel="zalo" view={view} actions={actions} />
          <RepliesStep channel="zalo" view={view} actions={actions} bridge={bridge} />
          {(status.hasToken || status.ownerId !== null) && (
            <div>
              <Button
                variant="destructive"
                disabled={forgetZalo.isPending}
                onClick={() => void forget()}
              >
                {t("channels.zalo.forget.button")}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
