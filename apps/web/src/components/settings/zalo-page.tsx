import * as React from "react";
import { type DesktopBridge, type ZaloStatus } from "@workspace/shared";
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
  zaloView,
} from "@/components/settings/channel-setup";
import { ConfirmModal } from "@/components/modals/confirm-modal";
import { useSettingsSubPage } from "@/components/settings/settings-subpage";
import {
  zaloAllowedUsers,
  zaloChatId,
  zaloChatSettings,
  type ZaloChatDraft,
} from "@/components/settings/zalo-chat-fields";
import { useBackgroundCommands, zaloStatusQuery } from "@/lib/extension-queries";

/** Explicit chat-id entry also works before the bot has received any messages. */
function ChatsStep({ bridge, status }: { bridge: DesktopBridge; status: ZaloStatus }) {
  const { t } = useTranslation(["settings", "common"]);
  const { saveZalo } = useBackgroundCommands(bridge);
  const chats = status.chats ?? {};
  const chatIds = Object.keys(chats);
  // An empty id means a new chat; null means the editor is closed.
  const [editing, setEditing] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<ZaloChatDraft>({
    chatId: "",
    label: "",
    access: "owner",
    busyMode: "queue",
    allowedUsers: "",
  });
  const [touched, setTouched] = React.useState(false);
  const chatId = zaloChatId(draft.chatId);
  const allowedUsers = zaloAllowedUsers(draft.allowedUsers);
  const chatIdError = !chatId
    ? t("channels.zalo.chats.errors.chatId")
    : editing === "" && Object.hasOwn(chats, chatId)
      ? t("channels.zalo.chats.errors.duplicate")
      : null;
  const allowedUsersError =
    allowedUsers === null ? t("channels.zalo.chats.errors.allowedUsers") : null;
  const valid = !chatIdError && !allowedUsersError;
  const accessItems = [
    { value: "owner", label: t("channels.zalo.chats.accessOwner") },
    { value: "members", label: t("channels.zalo.chats.accessMembers") },
  ];
  const busyItems = [
    { value: "queue", label: t("channels.zalo.chats.busyQueue") },
    { value: "steer", label: t("channels.zalo.chats.busySteer") },
    { value: "interrupt", label: t("channels.zalo.chats.busyInterrupt") },
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
    saveZalo.mutate(
      {
        enabled: status.enabled,
        agentId: status.agentId,
        workspaceId: status.workspaceId,
        chats: {
          ...chats,
          [chatId]: zaloChatSettings(chats[chatId], draft, allowedUsers),
        },
      },
      {
        onSuccess: () => {
          setEditing(null);
          toast.success(t("channels.zalo.saved"));
        },
      },
    );
  }

  return (
    <SetupStep
      title={t("channels.zalo.steps.chats.title")}
      description={t("channels.zalo.steps.chats.description")}
    >
      {editing === null ? (
        <div>
          <Button variant="outline" size="sm" onClick={() => startEdit("")}>
            {t("channels.zalo.chats.add")}
          </Button>
        </div>
      ) : (
        <form onSubmit={saveChat} className="flex flex-col gap-4">
          <FieldGroup>
            <Field data-invalid={touched && Boolean(chatIdError)}>
              <FieldLabel htmlFor="zalo-chat-id">{t("channels.zalo.chats.chatId")}</FieldLabel>
              <Input
                id="zalo-chat-id"
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
                <FieldDescription>{t("channels.zalo.chats.chatIdHelp")}</FieldDescription>
              )}
            </Field>
            <Field>
              <FieldLabel htmlFor="zalo-chat-label">{t("channels.zalo.chats.label")}</FieldLabel>
              <Input
                id="zalo-chat-label"
                value={draft.label}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, label: event.target.value }))
                }
              />
              <FieldDescription>{t("channels.zalo.chats.labelHelp")}</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="zalo-chat-access">{t("channels.zalo.chats.access")}</FieldLabel>
              <Select
                items={accessItems}
                value={draft.access}
                onValueChange={(value) => {
                  if (value === "owner" || value === "members") {
                    setDraft((current) => ({ ...current, access: value }));
                  }
                }}
              >
                <SelectTrigger id="zalo-chat-access" className="w-full">
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
              <FieldLabel htmlFor="zalo-chat-busy">{t("channels.zalo.chats.busyMode")}</FieldLabel>
              <Select
                items={busyItems}
                value={draft.busyMode}
                onValueChange={(value) => {
                  if (value === "queue" || value === "steer" || value === "interrupt") {
                    setDraft((current) => ({ ...current, busyMode: value }));
                  }
                }}
              >
                <SelectTrigger id="zalo-chat-busy" className="w-full">
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
              <FieldLabel htmlFor="zalo-chat-users">
                {t("channels.zalo.chats.allowedUsers")}
              </FieldLabel>
              <Input
                id="zalo-chat-users"
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
                <FieldDescription>{t("channels.zalo.chats.allowedUsersHelp")}</FieldDescription>
              )}
            </Field>
          </FieldGroup>
          {saveZalo.isError && <FieldError>{saveZalo.error.message}</FieldError>}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={saveZalo.isPending || (touched && !valid)}>
              {saveZalo.isPending && <Spinner data-icon="inline-start" />}
              {editing === "" ? t("channels.zalo.chats.add") : t("common:actions.save")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={saveZalo.isPending}
              onClick={() => setEditing(null)}
            >
              {t("common:actions.cancel")}
            </Button>
          </div>
        </form>
      )}
      {chatIds.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("channels.zalo.chats.empty")}</p>
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
                    disabled={saveZalo.isPending}
                    onClick={() => startEdit(id)}
                  >
                    {t("common:actions.edit")}
                  </Button>
                </div>
                <div className="mt-1 flex flex-wrap gap-2">
                  <Badge variant="outline">
                    {t(
                      chat.access === "members"
                        ? "channels.zalo.chats.accessMembers"
                        : "channels.zalo.chats.accessOwner",
                    )}
                  </Badge>
                  <Badge variant="outline">
                    {t(
                      chat.busyMode === "steer"
                        ? "channels.zalo.chats.busySteer"
                        : chat.busyMode === "interrupt"
                          ? "channels.zalo.chats.busyInterrupt"
                          : "channels.zalo.chats.busyQueue",
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
          <ChatsStep bridge={bridge} status={status} />
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
