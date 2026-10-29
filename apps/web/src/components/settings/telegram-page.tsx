import * as React from "react";
import { type DesktopBridge, type TelegramStatus } from "@workspace/shared";
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
import { TriangleAlertIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import {
  ConnectStep,
  PairStep,
  RepliesStep,
  SetupStep,
  StatusLine,
  telegramView,
} from "@/components/settings/channel-setup";
import { ConfirmModal } from "@/components/modals/confirm-modal";
import { useSettingsSubPage } from "@/components/settings/settings-subpage";
import {
  telegramAllowedUsers,
  telegramChatId,
  telegramChatSettings,
  type TelegramChatDraft,
} from "@/components/settings/telegram-chat-fields";
import { telegramStatusQuery, useBackgroundCommands } from "@/lib/extension-queries";

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
    <SetupStep
      title={t("channels.telegram.steps.chats.title")}
      description={t("channels.telegram.steps.chats.description")}
    >
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
    </SetupStep>
  );
}

/** Settings › Channels › Telegram: connect the bot, pair the owner, choose who answers. */
export function TelegramPage({ bridge }: { bridge: DesktopBridge }) {
  const { t } = useTranslation("settings");
  useSettingsSubPage(t("channels.telegram.title"));
  const query = useQuery(telegramStatusQuery(bridge));
  const { saveTelegram, startPairing, forgetTelegram } = useBackgroundCommands(bridge);
  const status = query.data;
  const view = status && telegramView(status);
  const actions = { save: saveTelegram, startPairing };

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
      {status && view && (
        <>
          <StatusLine channel="telegram" view={view} />
          <ConnectStep channel="telegram" view={view} actions={actions} />
          <PairStep channel="telegram" view={view} actions={actions} />
          <RepliesStep channel="telegram" view={view} actions={actions} bridge={bridge} />
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
