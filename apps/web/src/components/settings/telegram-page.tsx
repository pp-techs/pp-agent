import * as React from "react";
import {
  DEFAULT_WORKSPACE_ID,
  type ChannelState,
  type DesktopBridge,
  type TelegramStatus,
} from "@workspace/shared";
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { Spinner } from "@workspace/ui/components/spinner";
import { useQuery } from "@tanstack/react-query";
import { CheckIcon, CopyIcon, TriangleAlertIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { ConfirmModal } from "@/components/modals/confirm-modal";
import { SwitchRow } from "@/components/settings/option-group";
import { useSettingsSubPage } from "@/components/settings/settings-subpage";
import {
  telegramAllowedUsers,
  telegramChatId,
  telegramChatSettings,
  type TelegramChatDraft,
} from "@/components/settings/telegram-chat-fields";
import { telegramStatusQuery, useBackgroundCommands } from "@/lib/extension-queries";
import { agentsQuery, workspacesQuery } from "@/lib/queries";

export const STATE_VARIANT: Record<ChannelState, React.ComponentProps<typeof Badge>["variant"]> = {
  off: "outline",
  connecting: "secondary",
  online: "default",
  error: "destructive",
};

/** Current time, refreshed every second while `active`. */
function useNow(active: boolean) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

function formatCountdown(ms: number) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

type StepKey = "connect" | "pair" | "replies" | "chats";

/** One numbered step of the setup, with its own title and explanation. */
function Step({ step, children }: { step: StepKey; children: React.ReactNode }) {
  const { t } = useTranslation("settings");
  return (
    <section className="flex flex-col gap-4 rounded-2xl border p-4">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium">{t(`channels.telegram.steps.${step}.title`)}</h3>
        <p className="text-xs text-muted-foreground">
          {t(`channels.telegram.steps.${step}.description`)}
        </p>
      </div>
      {children}
    </section>
  );
}

function StatusLine({ status }: { status: TelegramStatus }) {
  const { t } = useTranslation("settings");
  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <div className="flex items-center gap-2">
        <Badge variant={STATE_VARIANT[status.state]}>
          {status.state === "connecting" && <Spinner data-icon="inline-start" />}
          {t(`channels.telegram.state.${status.state}`)}
        </Badge>
        {status.state === "error" && status.error && (
          <span className="text-xs text-destructive">{status.error}</span>
        )}
      </div>
      <p className="text-muted-foreground">
        {t("channels.telegram.bot")}:{" "}
        <span className="text-foreground">
          {status.botUsername ? `@${status.botUsername}` : t("channels.telegram.botUnknown")}
        </span>
      </p>
      <p className="text-muted-foreground">
        {t("channels.telegram.owner")}:{" "}
        <span className="text-foreground">
          {status.ownerId !== null
            ? (status.ownerName ?? String(status.ownerId))
            : t("channels.telegram.notPaired")}
        </span>
      </p>
    </div>
  );
}

function ConnectStep({ bridge, status }: { bridge: DesktopBridge; status: TelegramStatus }) {
  const { t } = useTranslation(["settings", "common"]);
  const { saveTelegram } = useBackgroundCommands(bridge);
  const [token, setToken] = React.useState("");
  const [enabled, setEnabled] = React.useState<boolean | null>(null);

  const wanted = enabled ?? status.enabled;
  const trimmed = token.trim();
  const dirty = trimmed !== "" || wanted !== status.enabled;
  const needsToken = wanted && !status.hasToken && trimmed === "";

  function save() {
    saveTelegram.mutate(
      {
        ...(trimmed !== "" && { token: trimmed }),
        enabled: wanted,
        agentId: status.agentId,
        workspaceId: status.workspaceId,
      },
      {
        onSuccess: () => {
          setToken("");
          setEnabled(null);
          toast.success(t("channels.telegram.saved"));
        },
      },
    );
  }

  return (
    <Step step="connect">
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (dirty && !needsToken) save();
        }}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="telegram-token">{t("channels.telegram.token.label")}</FieldLabel>
            <Input
              id="telegram-token"
              type="password"
              autoComplete="off"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder={
                status.hasToken
                  ? t("channels.telegram.token.placeholder")
                  : t("channels.telegram.token.placeholderEmpty")
              }
            />
            <FieldDescription>
              {needsToken
                ? t("channels.telegram.token.required")
                : t("channels.telegram.token.help")}
            </FieldDescription>
          </Field>
          <SwitchRow
            id="telegram-enabled"
            label={t("channels.telegram.enabled.label")}
            description={t("channels.telegram.enabled.description")}
            checked={wanted}
            onCheckedChange={setEnabled}
          />
        </FieldGroup>
        <div>
          <Button type="submit" disabled={!dirty || needsToken || saveTelegram.isPending}>
            {saveTelegram.isPending && <Spinner data-icon="inline-start" />}
            {t("common:actions.save")}
          </Button>
        </div>
      </form>
    </Step>
  );
}

function PairStep({ bridge, status }: { bridge: DesktopBridge; status: TelegramStatus }) {
  const { t } = useTranslation("settings");
  const { startPairing } = useBackgroundCommands(bridge);
  const [copied, setCopied] = React.useState(false);
  const code = status.pairingCode;
  const expiresAt = status.pairingExpiresAt;
  const now = useNow(code !== null && expiresAt !== null);
  const expired = code !== null && expiresAt !== null && expiresAt <= now;
  const open = code !== null && !expired;
  const command = open ? `/pair ${code}` : "";
  // The bot only hears the code once it is switched on with a saved token.
  const ready =
    status.enabled && status.hasToken && status.state !== "off" && status.state !== "error";

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
    <Step step="pair">
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
              {copied ? t("channels.telegram.pairing.copied") : t("channels.telegram.pairing.copy")}
            </Button>
          </div>
          <p className="text-sm">
            {status.botUsername
              ? t("channels.telegram.pairing.instruction", { command, bot: status.botUsername })
              : t("channels.telegram.pairing.instructionNoBot", { command })}
          </p>
          {expiresAt !== null && (
            <p className="text-xs text-muted-foreground">
              {t("channels.telegram.pairing.expiresIn", { time: formatCountdown(expiresAt - now) })}
            </p>
          )}
        </div>
      )}
      {expired && (
        <p className="text-xs text-muted-foreground">{t("channels.telegram.pairing.expired")}</p>
      )}
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          disabled={!ready || startPairing.isPending}
          onClick={() => startPairing.mutate()}
        >
          {startPairing.isPending && <Spinner data-icon="inline-start" />}
          {status.ownerId !== null || open || expired
            ? t("channels.telegram.pairing.again")
            : t("channels.telegram.pairing.start")}
        </Button>
        {!ready && (
          <span className="text-xs text-muted-foreground">
            {t("channels.telegram.pairing.needsSetup")}
          </span>
        )}
      </div>
    </Step>
  );
}

/** Select value for "follow the workspace's agent". */
const FOLLOW_WORKSPACE = "follow-workspace";

function RepliesStep({ bridge, status }: { bridge: DesktopBridge; status: TelegramStatus }) {
  const { t } = useTranslation(["settings", "common"]);
  const { saveTelegram } = useBackgroundCommands(bridge);
  const agents = useQuery(agentsQuery(bridge));
  const workspaces = useQuery(workspacesQuery(bridge));
  const [draft, setDraft] = React.useState<{ agentId?: string | null; workspaceId?: string }>({});

  const agentItems = [
    { value: FOLLOW_WORKSPACE, label: t("channels.telegram.agentFollow") },
    ...(agents.data ?? []).map((agent) => ({
      value: agent.id,
      label: `${agent.icon} ${agent.name}`,
    })),
  ];
  const workspaceItems = (workspaces.data ?? []).map((workspace) => ({
    value: workspace.id,
    label: `${workspace.icon} ${workspace.name}`,
  }));
  const wantedAgent = draft.agentId === undefined ? status.agentId : draft.agentId;
  const wantedWorkspace = draft.workspaceId ?? status.workspaceId;
  // A deleted agent is replaced by "follow the workspace", a deleted workspace by the built-in one.
  const agentValue =
    wantedAgent !== null && agentItems.some((item) => item.value === wantedAgent)
      ? wantedAgent
      : null;
  const workspaceValue = workspaceItems.some((item) => item.value === wantedWorkspace)
    ? wantedWorkspace
    : DEFAULT_WORKSPACE_ID;
  const dirty = agentValue !== status.agentId || workspaceValue !== status.workspaceId;

  function save() {
    saveTelegram.mutate(
      { enabled: status.enabled, agentId: agentValue, workspaceId: workspaceValue },
      {
        onSuccess: () => {
          setDraft({});
          toast.success(t("channels.telegram.saved"));
        },
      },
    );
  }

  return (
    <Step step="replies">
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (dirty) save();
        }}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="telegram-workspace">{t("channels.telegram.workspace")}</FieldLabel>
            <Select
              items={workspaceItems}
              value={workspaceValue}
              onValueChange={(next) =>
                next !== null && setDraft((current) => ({ ...current, workspaceId: next }))
              }
            >
              <SelectTrigger id="telegram-workspace" className="w-full">
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
            <FieldDescription>{t("channels.telegram.workspaceHelp")}</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="telegram-agent">{t("channels.telegram.agent")}</FieldLabel>
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
              <SelectTrigger id="telegram-agent" className="w-full">
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
            <FieldDescription>{t("channels.telegram.agentHelp")}</FieldDescription>
          </Field>
        </FieldGroup>
        <div>
          <Button type="submit" disabled={!dirty || saveTelegram.isPending}>
            {saveTelegram.isPending && <Spinner data-icon="inline-start" />}
            {t("common:actions.save")}
          </Button>
        </div>
      </form>
    </Step>
  );
}

/** Explicit chat-id entry also works before the bot has received any messages. */
function ChatsStep({ bridge, status }: { bridge: DesktopBridge; status: TelegramStatus }) {
  const { t } = useTranslation(["settings", "common"]);
  const { saveTelegram } = useBackgroundCommands(bridge);
  const chats = status.chats ?? {};
  const chatIds = Object.keys(chats);
  // An empty id means a new chat; null means the editor is closed.
  const [editing, setEditing] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<TelegramChatDraft>({
    chatId: "",
    label: "",
    access: "owner",
    busyMode: "queue",
    allowedUsers: "",
  });
  const [touched, setTouched] = React.useState(false);
  const chatId = telegramChatId(draft.chatId);
  const allowedUsers = telegramAllowedUsers(draft.allowedUsers);
  const chatIdError = !chatId
    ? t("channels.telegram.chats.errors.chatId")
    : editing === "" && Object.hasOwn(chats, chatId)
      ? t("channels.telegram.chats.errors.duplicate")
      : null;
  const allowedUsersError =
    allowedUsers === null ? t("channels.telegram.chats.errors.allowedUsers") : null;
  const valid = !chatIdError && !allowedUsersError;
  const accessItems = [
    { value: "owner", label: t("channels.telegram.chats.accessOwner") },
    { value: "members", label: t("channels.telegram.chats.accessMembers") },
  ];
  const busyItems = [
    { value: "queue", label: t("channels.telegram.chats.busyQueue") },
    { value: "steer", label: t("channels.telegram.chats.busySteer") },
    { value: "interrupt", label: t("channels.telegram.chats.busyInterrupt") },
  ];

  function startEdit(id: string) {
    const chat = chats[id];
    setEditing(id);
    setTouched(false);
    setDraft({
      chatId: id,
      access: chat?.access ?? "owner",
      busyMode: chat?.busyMode ?? "queue",
      allowedUsers: (chat?.allowedUsers ?? []).join(", "),
      label: chat?.label ?? "",
    });
  }

  function saveChat(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(true);
    if (!valid || chatId === null || allowedUsers === null) return;
    saveTelegram.mutate(
      {
        enabled: status.enabled,
        agentId: status.agentId,
        workspaceId: status.workspaceId,
        chats: {
          ...chats,
          [chatId]: telegramChatSettings(chats[chatId], draft, allowedUsers),
        },
      },
      {
        onSuccess: () => {
          setEditing(null);
          toast.success(t("channels.telegram.saved"));
        },
      },
    );
  }

  return (
    <Step step="chats">
      {editing === null ? (
        <div>
          <Button variant="outline" size="sm" onClick={() => startEdit("")}>
            {t("channels.telegram.chats.add")}
          </Button>
        </div>
      ) : (
        <form onSubmit={saveChat} className="flex flex-col gap-4">
          <FieldGroup>
            <Field data-invalid={touched && Boolean(chatIdError)}>
              <FieldLabel htmlFor="telegram-chat-id">
                {t("channels.telegram.chats.chatId")}
              </FieldLabel>
              <Input
                id="telegram-chat-id"
                value={draft.chatId}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, chatId: event.target.value }))
                }
                readOnly={editing !== ""}
                autoComplete="off"
                aria-invalid={touched && Boolean(chatIdError)}
              />
              {touched && chatIdError ? (
                <FieldError>{chatIdError}</FieldError>
              ) : (
                <FieldDescription>{t("channels.telegram.chats.chatIdHelp")}</FieldDescription>
              )}
            </Field>
            <Field>
              <FieldLabel htmlFor="telegram-chat-label">
                {t("channels.telegram.chats.label")}
              </FieldLabel>
              <Input
                id="telegram-chat-label"
                value={draft.label}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, label: event.target.value }))
                }
              />
              <FieldDescription>{t("channels.telegram.chats.labelHelp")}</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="telegram-chat-access">
                {t("channels.telegram.chats.access")}
              </FieldLabel>
              <Select
                items={accessItems}
                value={draft.access}
                onValueChange={(value) => {
                  if (value === "owner" || value === "members") {
                    setDraft((current) => ({ ...current, access: value }));
                  }
                }}
              >
                <SelectTrigger id="telegram-chat-access" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {accessItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="telegram-chat-busy">
                {t("channels.telegram.chats.busyMode")}
              </FieldLabel>
              <Select
                items={busyItems}
                value={draft.busyMode}
                onValueChange={(value) => {
                  if (value === "queue" || value === "steer" || value === "interrupt") {
                    setDraft((current) => ({ ...current, busyMode: value }));
                  }
                }}
              >
                <SelectTrigger id="telegram-chat-busy" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {busyItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field data-invalid={touched && Boolean(allowedUsersError)}>
              <FieldLabel htmlFor="telegram-chat-users">
                {t("channels.telegram.chats.allowedUsers")}
              </FieldLabel>
              <Input
                id="telegram-chat-users"
                value={draft.allowedUsers}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, allowedUsers: event.target.value }))
                }
                aria-invalid={touched && Boolean(allowedUsersError)}
                autoComplete="off"
              />
              {touched && allowedUsersError ? (
                <FieldError>{allowedUsersError}</FieldError>
              ) : (
                <FieldDescription>{t("channels.telegram.chats.allowedUsersHelp")}</FieldDescription>
              )}
            </Field>
          </FieldGroup>
          {saveTelegram.isError && <FieldError>{saveTelegram.error.message}</FieldError>}
          <div className="flex gap-2">
            <Button
              type="submit"
              size="sm"
              disabled={saveTelegram.isPending || (touched && !valid)}
            >
              {saveTelegram.isPending && <Spinner data-icon="inline-start" />}
              {editing === "" ? t("channels.telegram.chats.add") : t("common:actions.save")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={saveTelegram.isPending}
              onClick={() => setEditing(null)}
            >
              {t("common:actions.cancel")}
            </Button>
          </div>
        </form>
      )}
      {chatIds.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("channels.telegram.chats.empty")}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {chatIds.map((id) => {
            const chat = chats[id] ?? {};
            return (
              <div key={id} className="rounded-lg border p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span className="font-medium">{chat.label || id}</span>
                    <span className="ml-2 text-xs text-muted-foreground">#{id}</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={saveTelegram.isPending}
                    onClick={() => startEdit(id)}
                  >
                    {t("common:actions.edit")}
                  </Button>
                </div>
                <div className="mt-1 flex flex-wrap gap-2">
                  <Badge variant="outline">
                    {t(
                      chat.access === "members"
                        ? "channels.telegram.chats.accessMembers"
                        : "channels.telegram.chats.accessOwner",
                    )}
                  </Badge>
                  <Badge variant="outline">
                    {t(
                      chat.busyMode === "steer"
                        ? "channels.telegram.chats.busySteer"
                        : chat.busyMode === "interrupt"
                          ? "channels.telegram.chats.busyInterrupt"
                          : "channels.telegram.chats.busyQueue",
                    )}
                  </Badge>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Step>
  );
}

/** Settings › Channels › Telegram: connect the bot, pair the owner, choose who answers. */
export function TelegramPage({ bridge }: { bridge: DesktopBridge }) {
  const { t } = useTranslation("settings");
  useSettingsSubPage(t("channels.telegram.title"));
  const query = useQuery(telegramStatusQuery(bridge));
  const { forgetTelegram } = useBackgroundCommands(bridge);
  const status = query.data;

  async function forget() {
    const confirmed = await ConfirmModal.show({
      title: t("channels.telegram.forget.title"),
      description: t("channels.telegram.forget.description"),
      confirmLabel: t("channels.telegram.forget.confirm"),
    });
    if (!confirmed) return;
    forgetTelegram.mutate(undefined, {
      onSuccess: () => toast.success(t("channels.telegram.forget.done")),
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted-foreground">{t("channels.telegram.description")}</p>
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
      {status && (
        <>
          <StatusLine status={status} />
          <ConnectStep bridge={bridge} status={status} />
          <PairStep bridge={bridge} status={status} />
          <RepliesStep bridge={bridge} status={status} />
          <ChatsStep bridge={bridge} status={status} />
          {(status.hasToken || status.ownerId !== null) && (
            <div>
              <Button
                variant="destructive"
                disabled={forgetTelegram.isPending}
                onClick={() => void forget()}
              >
                {t("channels.telegram.forget.button")}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
