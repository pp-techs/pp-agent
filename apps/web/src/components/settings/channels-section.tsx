import * as React from "react";
import { type DesktopBridge } from "@workspace/shared";
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@workspace/ui/components/item";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { Spinner } from "@workspace/ui/components/spinner";
import { useQuery } from "@tanstack/react-query";
import { MessageCircleIcon, MoonStarIcon, SendIcon, ShieldCheckIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { SectionHeading } from "@/components/settings/section-heading";
import { STATE_VARIANT } from "@/components/settings/channel-ui";
import { TelegramPage } from "@/components/settings/telegram-page";
import { ZaloPage } from "@/components/settings/zalo-page";
import { serviceStatusQuery, telegramStatusQuery, zaloStatusQuery } from "@/lib/extension-queries";

type View = { kind: "list" } | { kind: "telegram" } | { kind: "zalo" };

function TelegramRow({ bridge, onOpen }: { bridge: DesktopBridge; onOpen: () => void }) {
  const { t } = useTranslation("settings");
  const query = useQuery(telegramStatusQuery(bridge));
  const status = query.data;
  const configured = status !== undefined && status.hasToken;
  const owner =
    status && status.ownerId !== null
      ? (status.ownerName ?? String(status.ownerId))
      : t("channels.telegram.notPaired");

  return (
    <Item variant="outline">
      <ItemMedia variant="icon">
        <SendIcon />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>
          {t("channels.telegram.title")}
          {status && configured && (
            <Badge variant={STATE_VARIANT[status.state]}>
              {status.state === "connecting" && <Spinner data-icon="inline-start" />}
              {t(`channels.telegram.state.${status.state}`)}
            </Badge>
          )}
        </ItemTitle>
        <ItemDescription>
          {query.isPending ? (
            <Skeleton className="h-4 w-40" />
          ) : configured ? (
            t("channels.telegram.summary", {
              bot: status.botUsername
                ? `@${status.botUsername}`
                : t("channels.telegram.botUnknown"),
              owner,
            })
          ) : (
            t("channels.telegram.summaryEmpty")
          )}
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <Button variant="outline" size="sm" disabled={query.isPending} onClick={onOpen}>
          {configured ? t("channels.telegram.manage") : t("channels.telegram.setUp")}
        </Button>
      </ItemActions>
    </Item>
  );
}

function ZaloRow({ bridge, onOpen }: { bridge: DesktopBridge; onOpen: () => void }) {
  const { t } = useTranslation("settings");
  const query = useQuery(zaloStatusQuery(bridge));
  const status = query.data;
  const configured = status !== undefined && status.hasToken;
  const owner =
    status && status.ownerId !== null
      ? (status.ownerName ?? status.ownerId)
      : t("channels.zalo.notPaired");

  return (
    <Item variant="outline">
      <ItemMedia variant="icon">
        <MessageCircleIcon />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>
          {t("channels.zalo.title")}
          {status && configured && (
            <Badge variant={STATE_VARIANT[status.state]}>
              {status.state === "connecting" && <Spinner data-icon="inline-start" />}
              {t(`channels.zalo.state.${status.state}`)}
            </Badge>
          )}
        </ItemTitle>
        <ItemDescription>
          {query.isPending ? (
            <Skeleton className="h-4 w-40" />
          ) : configured ? (
            t("channels.zalo.summary", {
              bot: status.botName ?? t("channels.zalo.botUnknown"),
              owner,
            })
          ) : (
            t("channels.zalo.summaryEmpty")
          )}
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <Button variant="outline" size="sm" disabled={query.isPending} onClick={onOpen}>
          {configured ? t("channels.zalo.manage") : t("channels.zalo.setUp")}
        </Button>
      </ItemActions>
    </Item>
  );
}

/** Settings › Channels: chat apps that reach the agent; each opens its own setup page. */
export function ChannelsSection({ bridge }: { bridge: DesktopBridge }) {
  const { t } = useTranslation("settings");
  const service = useQuery(serviceStatusQuery(bridge));
  const [view, setView] = React.useState<View>({ kind: "list" });

  if (view.kind === "telegram") return <TelegramPage bridge={bridge} />;
  if (view.kind === "zalo") return <ZaloPage bridge={bridge} />;

  const stopsWithApp = service.data?.supported === true && !service.data.installed;

  return (
    <div className="flex flex-col gap-6">
      <SectionHeading title={t("channels.title")} description={t("channels.description")} />
      {stopsWithApp && (
        <Alert>
          <MoonStarIcon />
          <AlertTitle>{t("channels.needsBackground.title")}</AlertTitle>
          <AlertDescription>{t("channels.needsBackground.description")}</AlertDescription>
        </Alert>
      )}
      <ItemGroup>
        <TelegramRow bridge={bridge} onOpen={() => setView({ kind: "telegram" })} />
        <ZaloRow bridge={bridge} onOpen={() => setView({ kind: "zalo" })} />
      </ItemGroup>
      <Alert>
        <ShieldCheckIcon />
        <AlertTitle>{t("channels.approval.title")}</AlertTitle>
        <AlertDescription>{t("channels.approval.description")}</AlertDescription>
      </Alert>
    </div>
  );
}
