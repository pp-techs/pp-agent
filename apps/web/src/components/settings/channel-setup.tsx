import * as React from "react";
import {
  DEFAULT_WORKSPACE_ID,
  type ChannelState,
  type DesktopBridge,
  type TelegramStatus,
  type ZaloStatus,
} from "@workspace/shared";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { Spinner } from "@workspace/ui/components/spinner";
import { useQuery } from "@tanstack/react-query";
import { CheckIcon, CopyIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { formatCountdown, STATE_VARIANT, useNow } from "@/components/settings/channel-ui";
import { SwitchRow } from "@/components/settings/option-group";
import { agentsQuery, workspacesQuery } from "@/lib/queries";

/** The setup steps every chat app shares: connect the bot, pair the owner, choose who answers. */
export type ChannelId = "telegram" | "zalo";

/** What the steps show of a channel, whichever chat app it is. */
export interface ChannelView {
  enabled: boolean;
  hasToken: boolean;
  agentId: string | null;
  workspaceId: string;
  state: ChannelState;
  error: string | null;
  /** The bot as shown on screen (`@name` or its account name); null until Zalo/Telegram told us. */
  bot: string | null;
  /** The bot as the pairing instruction names it. */
  botForPairing: string | null;
  /** Name of the paired person; null when nobody is paired. */
  owner: string | null;
  pairingCode: string | null;
  pairingExpiresAt: number | null;
}

export function telegramView(status: TelegramStatus): ChannelView {
  return {
    enabled: status.enabled,
    hasToken: status.hasToken,
    agentId: status.agentId,
    workspaceId: status.workspaceId,
    state: status.state,
    error: status.error,
    bot: status.botUsername ? `@${status.botUsername}` : null,
    botForPairing: status.botUsername,
    owner: status.ownerId !== null ? (status.ownerName ?? String(status.ownerId)) : null,
    pairingCode: status.pairingCode,
    pairingExpiresAt: status.pairingExpiresAt,
  };
}

export function zaloView(status: ZaloStatus): ChannelView {
  return {
    enabled: status.enabled,
    hasToken: status.hasToken,
    agentId: status.agentId,
    workspaceId: status.workspaceId,
    state: status.state,
    error: status.error,
    bot: status.botName,
    botForPairing: status.botName,
    owner: status.ownerId !== null ? (status.ownerName ?? status.ownerId) : null,
    pairingCode: status.pairingCode,
    pairingExpiresAt: status.pairingExpiresAt,
  };
}

/** What a step saves; the channel's own input type accepts it as is. */
export interface SaveChannelInput {
  token?: string;
  enabled: boolean;
  agentId: string | null;
  workspaceId: string;
}

/** The two commands the steps send, as the channel's mutations offer them. */
export interface ChannelActions {
  save: {
    mutate(input: SaveChannelInput, options?: { onSuccess?: () => void }): void;
    isPending: boolean;
  };
  startPairing: { mutate(): void; isPending: boolean };
}

interface StepProps {
  channel: ChannelId;
  view: ChannelView;
  actions: ChannelActions;
}

/** One numbered step of the setup, with its own title and explanation. */
export function SetupStep({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4 rounded-2xl border p-4">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

export function StatusLine({ channel, view }: Pick<StepProps, "channel" | "view">) {
  const { t } = useTranslation("settings");
  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <div className="flex items-center gap-2">
        <Badge variant={STATE_VARIANT[view.state]}>
          {view.state === "connecting" && <Spinner data-icon="inline-start" />}
          {t(`channels.${channel}.state.${view.state}`)}
        </Badge>
        {view.state === "error" && view.error && (
          <span className="text-xs text-destructive">{view.error}</span>
        )}
      </div>
      <p className="text-muted-foreground">
        {t(`channels.${channel}.bot`)}:{" "}
        <span className="text-foreground">{view.bot ?? t(`channels.${channel}.botUnknown`)}</span>
      </p>
      <p className="text-muted-foreground">
        {t(`channels.${channel}.owner`)}:{" "}
        <span className="text-foreground">{view.owner ?? t(`channels.${channel}.notPaired`)}</span>
      </p>
    </div>
  );
}

export function ConnectStep({ channel, view, actions }: StepProps) {
  const { t } = useTranslation(["settings", "common"]);
  const [token, setToken] = React.useState("");
  const [enabled, setEnabled] = React.useState<boolean | null>(null);

  const wanted = enabled ?? view.enabled;
  const trimmed = token.trim();
  const dirty = trimmed !== "" || wanted !== view.enabled;
  const needsToken = wanted && !view.hasToken && trimmed === "";

  function save() {
    actions.save.mutate(
      {
        ...(trimmed !== "" && { token: trimmed }),
        enabled: wanted,
        agentId: view.agentId,
        workspaceId: view.workspaceId,
      },
      {
        onSuccess: () => {
          setToken("");
          setEnabled(null);
          toast.success(t(`channels.${channel}.saved`));
        },
      },
    );
  }

  return (
    <SetupStep
      title={t(`channels.${channel}.steps.connect.title`)}
      description={t(`channels.${channel}.steps.connect.description`)}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (dirty && !needsToken) save();
        }}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={`${channel}-token`}>
              {t(`channels.${channel}.token.label`)}
            </FieldLabel>
            <Input
              id={`${channel}-token`}
              type="password"
              autoComplete="off"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder={
                view.hasToken
                  ? t(`channels.${channel}.token.placeholder`)
                  : t(`channels.${channel}.token.placeholderEmpty`)
              }
            />
            <FieldDescription>
              {needsToken
                ? t(`channels.${channel}.token.required`)
                : t(`channels.${channel}.token.help`)}
            </FieldDescription>
          </Field>
          <SwitchRow
            id={`${channel}-enabled`}
            label={t(`channels.${channel}.enabled.label`)}
            description={t(`channels.${channel}.enabled.description`)}
            checked={wanted}
            onCheckedChange={setEnabled}
          />
        </FieldGroup>
        <div>
          <Button type="submit" disabled={!dirty || needsToken || actions.save.isPending}>
            {actions.save.isPending && <Spinner data-icon="inline-start" />}
            {t("common:actions.save")}
          </Button>
        </div>
      </form>
    </SetupStep>
  );
}

export function PairStep({ channel, view, actions }: StepProps) {
  const { t } = useTranslation("settings");
  const [copied, setCopied] = React.useState(false);
  const code = view.pairingCode;
  const expiresAt = view.pairingExpiresAt;
  const now = useNow(code !== null && expiresAt !== null);
  const expired = code !== null && expiresAt !== null && expiresAt <= now;
  const open = code !== null && !expired;
  const command = open ? `/pair ${code}` : "";
  // The bot only hears the code once it is switched on with a saved token.
  const ready = view.enabled && view.hasToken && view.state !== "off" && view.state !== "error";

  function copy() {
    navigator.clipboard.writeText(command).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      (error: unknown) => toast.error(error instanceof Error ? error.message : String(error)),
    );
  }

  return (
    <SetupStep
      title={t(`channels.${channel}.steps.pair.title`)}
      description={t(`channels.${channel}.steps.pair.description`)}
    >
      {open && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <code className="rounded-lg bg-muted px-3 py-1.5 font-mono text-lg tracking-widest">
              {code}
            </code>
            <Button variant="outline" size="sm" onClick={copy}>
              {copied ? (
                <CheckIcon data-icon="inline-start" />
              ) : (
                <CopyIcon data-icon="inline-start" />
              )}
              {copied
                ? t(`channels.${channel}.pairing.copied`)
                : t(`channels.${channel}.pairing.copy`)}
            </Button>
          </div>
          <p className="text-sm">
            {view.botForPairing
              ? t(`channels.${channel}.pairing.instruction`, { command, bot: view.botForPairing })
              : t(`channels.${channel}.pairing.instructionNoBot`, { command })}
          </p>
          {expiresAt !== null && (
            <p className="text-xs text-muted-foreground">
              {t(`channels.${channel}.pairing.expiresIn`, {
                time: formatCountdown(expiresAt - now),
              })}
            </p>
          )}
        </div>
      )}
      {expired && (
        <p className="text-xs text-muted-foreground">{t(`channels.${channel}.pairing.expired`)}</p>
      )}
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          disabled={!ready || actions.startPairing.isPending}
          onClick={() => actions.startPairing.mutate()}
        >
          {actions.startPairing.isPending && <Spinner data-icon="inline-start" />}
          {view.owner !== null || open || expired
            ? t(`channels.${channel}.pairing.again`)
            : t(`channels.${channel}.pairing.start`)}
        </Button>
        {!ready && (
          <span className="text-xs text-muted-foreground">
            {t(`channels.${channel}.pairing.needsSetup`)}
          </span>
        )}
      </div>
    </SetupStep>
  );
}

/** Select value for "follow the workspace's agent". */
const FOLLOW_WORKSPACE = "follow-workspace";

export function RepliesStep({
  channel,
  view,
  actions,
  bridge,
}: StepProps & { bridge: DesktopBridge }) {
  const { t } = useTranslation(["settings", "common"]);
  const agents = useQuery(agentsQuery(bridge));
  const workspaces = useQuery(workspacesQuery(bridge));
  const [draft, setDraft] = React.useState<{ agentId?: string | null; workspaceId?: string }>({});

  const agentItems = [
    { value: FOLLOW_WORKSPACE, label: t(`channels.${channel}.agentFollow`) },
    ...(agents.data ?? []).map((agent) => ({
      value: agent.id,
      label: `${agent.icon} ${agent.name}`,
    })),
  ];
  const workspaceItems = (workspaces.data ?? []).map((workspace) => ({
    value: workspace.id,
    label: `${workspace.icon} ${workspace.name}`,
  }));
  const wantedAgent = draft.agentId === undefined ? view.agentId : draft.agentId;
  const wantedWorkspace = draft.workspaceId ?? view.workspaceId;
  // A deleted agent is replaced by "follow the workspace", a deleted workspace by the built-in one.
  const agentValue =
    wantedAgent !== null && agentItems.some((item) => item.value === wantedAgent)
      ? wantedAgent
      : null;
  const workspaceValue = workspaceItems.some((item) => item.value === wantedWorkspace)
    ? wantedWorkspace
    : DEFAULT_WORKSPACE_ID;
  const dirty = agentValue !== view.agentId || workspaceValue !== view.workspaceId;

  function save() {
    actions.save.mutate(
      { enabled: view.enabled, agentId: agentValue, workspaceId: workspaceValue },
      {
        onSuccess: () => {
          setDraft({});
          toast.success(t(`channels.${channel}.saved`));
        },
      },
    );
  }

  return (
    <SetupStep
      title={t(`channels.${channel}.steps.replies.title`)}
      description={t(`channels.${channel}.steps.replies.description`)}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (dirty) save();
        }}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={`${channel}-workspace`}>
              {t(`channels.${channel}.workspace`)}
            </FieldLabel>
            <Select
              items={workspaceItems}
              value={workspaceValue}
              onValueChange={(next) =>
                next !== null && setDraft((current) => ({ ...current, workspaceId: next }))
              }
            >
              <SelectTrigger id={`${channel}-workspace`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {workspaceItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>{t(`channels.${channel}.workspaceHelp`)}</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor={`${channel}-agent`}>{t(`channels.${channel}.agent`)}</FieldLabel>
            <Select
              items={agentItems}
              value={agentValue ?? FOLLOW_WORKSPACE}
              onValueChange={(next) =>
                next !== null &&
                setDraft((current) => ({
                  ...current,
                  agentId: next === FOLLOW_WORKSPACE ? null : next,
                }))
              }
            >
              <SelectTrigger id={`${channel}-agent`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {agentItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>{t(`channels.${channel}.agentHelp`)}</FieldDescription>
          </Field>
        </FieldGroup>
        <div>
          <Button type="submit" disabled={!dirty || actions.save.isPending}>
            {actions.save.isPending && <Spinner data-icon="inline-start" />}
            {t("common:actions.save")}
          </Button>
        </div>
      </form>
    </SetupStep>
  );
}
