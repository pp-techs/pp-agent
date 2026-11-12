import { type ChannelState } from "@workspace/shared";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@workspace/ui/components/item";
import { Spinner } from "@workspace/ui/components/spinner";
import { ArrowLeftIcon, PlusIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { STATE_VARIANT } from "@/components/settings/channel-ui";
import type { ChannelId, ChannelView } from "@/components/settings/channel-setup";

/** What the page has open: the list of accounts, one account, or the form for a new one. */
export type AccountSelection = { kind: "list" } | { kind: "account"; id: string } | { kind: "new" };

/** The name of an account on screen: the one the person gave it, else the bot, else a number. */
export function accountTitle(
  view: Pick<ChannelView, "label" | "bot">,
  index: number,
  fallback: string,
): string {
  return view.label || view.bot || `${fallback} ${index + 1}`;
}

/** Every account of one chat app, with a button to add another. */
export function AccountList({
  channel,
  views,
  canAdd,
  onOpen,
  onAdd,
}: {
  channel: ChannelId;
  views: ChannelView[];
  canAdd: boolean;
  onOpen: (id: string) => void;
  onAdd: () => void;
}) {
  const { t } = useTranslation("settings");
  return (
    <div className="flex flex-col gap-3">
      {views.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("channels.accounts.empty")}</p>
      ) : (
        <ItemGroup>
          {views.map((view, index) => (
            <Item key={view.id} variant="outline">
              <ItemContent>
                <ItemTitle>
                  {accountTitle(view, index, t(`channels.${channel}.title`))}
                  <StateBadge channel={channel} state={view.state} />
                </ItemTitle>
                <ItemDescription>
                  {t("channels.accounts.summary", {
                    bot: view.bot ?? t(`channels.${channel}.botUnknown`),
                    owner: view.owner ?? t(`channels.${channel}.notPaired`),
                  })}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <Button variant="outline" size="sm" onClick={() => view.id && onOpen(view.id)}>
                  {t(`channels.${channel}.manage`)}
                </Button>
              </ItemActions>
            </Item>
          ))}
        </ItemGroup>
      )}
      {canAdd && (
        <div>
          <Button variant="outline" size="sm" onClick={onAdd}>
            <PlusIcon data-icon="inline-start" />
            {t("channels.accounts.add")}
          </Button>
        </div>
      )}
    </div>
  );
}

function StateBadge({ channel, state }: { channel: ChannelId; state: ChannelState }) {
  const { t } = useTranslation("settings");
  return (
    <Badge variant={STATE_VARIANT[state]}>
      {state === "connecting" && <Spinner data-icon="inline-start" />}
      {t(`channels.${channel}.state.${state}`)}
    </Badge>
  );
}

/** Back to the list of accounts, above the page of one account. */
export function BackToAccounts({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation("settings");
  return (
    <div>
      <Button variant="ghost" size="sm" onClick={onClick}>
        <ArrowLeftIcon data-icon="inline-start" />
        {t("channels.accounts.back")}
      </Button>
    </div>
  );
}
