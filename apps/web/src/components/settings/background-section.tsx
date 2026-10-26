import { type DesktopBridge } from "@workspace/shared";
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@workspace/ui/components/item";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { Switch } from "@workspace/ui/components/switch";
import { useQuery } from "@tanstack/react-query";
import { TriangleAlertIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { SectionHeading } from "@/components/settings/section-heading";
import { serviceStatusQuery, useBackgroundCommands } from "@/lib/extension-queries";

function ServiceCard({ bridge }: { bridge: DesktopBridge }) {
  const { t } = useTranslation("settings");
  const status = useQuery(serviceStatusQuery(bridge));
  const { setInstalled } = useBackgroundCommands(bridge);
  const data = status.data;

  return (
    <Item variant="outline" className="flex-col items-stretch gap-3">
      <div className="flex items-start gap-3">
        <ItemContent>
          <ItemTitle>
            <label htmlFor="background-service">{t("background.service.title")}</label>
          </ItemTitle>
          <ItemDescription className="line-clamp-none">
            {t("background.service.description")}
          </ItemDescription>
          {data?.supported && (
            <>
              <ItemDescription className="text-xs">
                {data.installed ? t("background.service.on") : t("background.service.off")}
                {data.manager &&
                  ` · ${t("background.service.manager", {
                    manager: t(`background.service.managers.${data.manager}`),
                  })}`}
              </ItemDescription>
              {data.detail && (
                <ItemDescription className="text-xs line-clamp-none">{data.detail}</ItemDescription>
              )}
            </>
          )}
        </ItemContent>
        <ItemActions>
          {status.isPending ? (
            <Skeleton className="h-5 w-9 rounded-full" />
          ) : (
            <Switch
              id="background-service"
              checked={data?.installed ?? false}
              disabled={!data?.supported || setInstalled.isPending}
              aria-label={t("background.service.switchLabel")}
              onCheckedChange={(installed) => setInstalled.mutate(installed)}
            />
          )}
        </ItemActions>
      </div>
      {status.isError && (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>{t("background.loadError")}</AlertTitle>
          <AlertDescription>{status.error.message}</AlertDescription>
        </Alert>
      )}
      {data && !data.supported && (
        <Alert>
          <TriangleAlertIcon />
          <AlertTitle>{t("background.service.unsupported.title")}</AlertTitle>
          <AlertDescription>
            {data.detail ?? t("background.service.unsupported.fallback")}
          </AlertDescription>
        </Alert>
      )}
    </Item>
  );
}

/** Settings › Background: keep the agent running after the window is closed or the app is quit. */
export function BackgroundSection({ bridge }: { bridge: DesktopBridge }) {
  const { t } = useTranslation("settings");
  return (
    <div className="flex flex-col gap-6">
      <SectionHeading title={t("background.title")} description={t("background.description")} />
      <ServiceCard bridge={bridge} />
    </div>
  );
}
