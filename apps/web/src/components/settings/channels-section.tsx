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
import type { ChannelId, ChannelView } from "@/components/settings/channel-setup";
import { telegramView, zaloView } from "@/components/settings/channel-setup";
import { TelegramPage } from "@/components/settings/telegram-page";
import { ZaloPage } from "@/components/settings/zalo-page";
import {
  serviceStatusQuery,
  telegramAccountsQuery,
  zaloAccountsQuery,
} from "@/lib/extension-queries";

type View = { kind: "list" } | { kind: "telegram" } | { kind: "zalo" };

/** The row of one chat app: how many accounts it has and the worst state among them. */
function ChannelRow({
  channel,
  icon,
  accounts,
  pending,
  onOpen,
}: {
  channel: ChannelId;
  icon: React.ReactNode;
  accounts: ChannelView[] | undefined;
  pending: boolean;
  onOpen: () => void;
}) {
  const { t } = useTranslation("settings");
  const configured = (accounts ?? []).filter((account) => account.hasToken);
  const first = configured[0];
  // One account reads like before ("Bot @x · Paired with Ann"); several are counted.
  const state = configured.some((a) => a.state === "error")
    ? "error"
    : configured.some((a) => a.state === "connecting")
      ? "connecting"
      : configured.some((a) => a.state === "online")
        ? "online"
        : "off";

  return (
    <Item variant="outline">
      <ItemMedia variant="icon">{icon}</ItemMedia>
      <ItemContent>
        <ItemTitle>
          {t(`channels.${channel}.title`)}
          {first && (
            <Badge variant={STATE_VARIANT[state]}>
              {state === "connecting" && <Spinner data-icon="inline-start" />}
              {t(`channels.${channel}.state.${state}`)}
            </Badge>
          )}
        </ItemTitle>
        <ItemDescription>
          {pending ? (
            <Skeleton className="h-4 w-40" />
          ) : configured.length > 1 ? (
            t("channels.accounts.count", { count: configured.length })
          ) : first ? (
            t("channels.accounts.summary", {
              bot: first.bot ?? t(`channels.${channel}.botUnknown`),
              owner: first.owner ?? t(`channels.${channel}.notPaired`),
            })
          ) : (
            t(`channels.${channel}.summaryEmpty`)
          )}
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <Button variant="outline" size="sm" disabled={pending} onClick={onOpen}>
          {first ? t(`channels.${channel}.manage`) : t(`channels.${channel}.setUp`)}
        </Button>
      </ItemActions>
    </Item>
  );
}

/** Settings › Channels: chat apps that reach the agent; each opens its own setup page. */
export function ChannelsSection({ bridge }: { bridge: DesktopBridge }) {
  const { t } = useTranslation("settings");
  const service = useQuery(serviceStatusQuery(bridge));
  const telegram = useQuery(telegramAccountsQuery(bridge));
  const zalo = useQuery(zaloAccountsQuery(bridge));
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
        <ChannelRow
          channel="telegram"
          icon={<SendIcon />}
          accounts={telegram.data?.map(telegramView)}
          pending={telegram.isPending}
          onOpen={() => setView({ kind: "telegram" })}
        />
        <ChannelRow
          channel="zalo"
          icon={<MessageCircleIcon />}
          accounts={zalo.data?.map(zaloView)}
          pending={zalo.isPending}
          onOpen={() => setView({ kind: "zalo" })}
        />
      </ItemGroup>
      <Alert>
        <ShieldCheckIcon />
        <AlertTitle>{t("channels.approval.title")}</AlertTitle>
        <AlertDescription>{t("channels.approval.description")}</AlertDescription>
      </Alert>
    </div>
  );
}
