import * as React from "react";
import type { DesktopBridge, SessionSummary, WorkspaceProfile } from "@workspace/shared";
import { DEFAULT_WORKSPACE_ID } from "@workspace/shared";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
} from "@workspace/ui/components/sidebar";
import { useQuery } from "@tanstack/react-query";
import {
  FolderPlusIcon,
  MoreHorizontalIcon,
  PencilIcon,
  SettingsIcon,
  SquarePenIcon,
  Trash2Icon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { UpdateNotice } from "@/components/chat/update-notice";
import { ConfirmModal } from "@/components/modals/confirm-modal";
import { PromptModal } from "@/components/modals/prompt-modal";
import { SettingsModal } from "@/components/modals/settings-modal";
import { useDeleteWorkspace, useSaveWorkspace } from "@/lib/extension-queries";
import { i18n } from "@/lib/i18n";
import { sessionsQuery, useAgentCommands, workspacesQuery } from "@/lib/queries";
import { useChatStore } from "@/stores/chat-store";

/** Chats listed per workspace before "Show more". */
const VISIBLE_CHATS = 6;
const NEW_WORKSPACE_ICON = "📁";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** "now", "5m", "3h", "2d", "4w", then the date: compact enough to sit beside a chat title. */
function relativeTime(modified: number, now = Date.now()) {
  const age = Math.max(0, now - modified);
  const label = (unit: "minutes" | "hours" | "days" | "weeks", value: number) =>
    i18n.t(`chat:sidebar.relativeTime.${unit}`, { value });
  if (age < MINUTE_MS) return i18n.t("chat:sidebar.relativeTime.now");
  if (age < HOUR_MS) return label("minutes", Math.floor(age / MINUTE_MS));
  if (age < DAY_MS) return label("hours", Math.floor(age / HOUR_MS));
  if (age < 7 * DAY_MS) return label("days", Math.floor(age / DAY_MS));
  if (age < 30 * DAY_MS) return label("weeks", Math.floor(age / (7 * DAY_MS)));
  return new Date(modified).toLocaleDateString(i18n.language, { month: "short", day: "numeric" });
}

/** Last segment of a folder path, the suggested name of a new workspace. */
const folderName = (dir: string) => dir.split(/[\\/]/).filter(Boolean).pop() ?? "";

export function ChatSidebar({ bridge }: { bridge: DesktopBridge }) {
  const sessions = useQuery(sessionsQuery(bridge));
  const workspaces = useQuery(workspacesQuery(bridge));
  const sessionPath = useChatStore((state) => state.sessionPath);
  const status = useChatStore((state) => state.status);
  const hasMessages = useChatStore((state) => state.messages.length > 0);
  const currentWorkspaceId = useChatStore((state) => state.workspace?.id);
  const { newChat, openSession, renameSession, deleteSession } = useAgentCommands(bridge);
  const saveWorkspace = useSaveWorkspace(bridge);
  const deleteWorkspace = useDeleteWorkspace(bridge);
  const [collapsed, setCollapsed] = React.useState<ReadonlySet<string>>(new Set());
  const [expanded, setExpanded] = React.useState<ReadonlySet<string>>(new Set());
  const ready = status === "idle" || status === "running";
  const { t } = useTranslation(["chat", "common"]);
  const onError = (error: Error) => toast.error(error.message);

  const byWorkspace = React.useMemo(() => {
    const map = new Map<string, SessionSummary[]>();
    for (const session of sessions.data ?? []) {
      const list = map.get(session.workspaceId);
      if (list) list.push(session);
      else map.set(session.workspaceId, [session]);
    }
    return map;
  }, [sessions.data]);

  const toggle = (set: ReadonlySet<string>, id: string) => {
    const next = new Set(set);
    if (!next.delete(id)) next.add(id);
    return next;
  };

  async function createWorkspace() {
    let dir: string | null;
    try {
      dir = await bridge.files.pickFolder();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
      return;
    }
    if (!dir) return;
    const name = await PromptModal.show({
      title: t("sidebar.newWorkspace"),
      label: t("sidebar.workspaceName"),
      initialValue: folderName(dir),
      confirmLabel: t("common:actions.create"),
    });
    if (!name) return;
    try {
      const created = await saveWorkspace.mutateAsync({
        name,
        icon: NEW_WORKSPACE_ICON,
        dir,
        instructions: "",
        agentId: null,
        model: null,
        thinkingLevel: null,
      });
      newChat.mutate(created.id, { onError });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function removeWorkspace(workspace: WorkspaceProfile) {
    const confirmed = await ConfirmModal.show({
      title: t("sidebar.workspace.deleteTitle"),
      description: t("sidebar.workspace.deleteDescription", { name: workspace.name }),
      confirmLabel: t("common:actions.delete"),
    });
    if (confirmed) deleteWorkspace.mutate(workspace.id);
  }

  async function rename(session: SessionSummary) {
    const name = await PromptModal.show({
      title: t("sidebar.session.renameTitle"),
      label: t("sidebar.session.name"),
      initialValue: session.title,
      confirmLabel: t("sidebar.session.rename"),
    });
    if (name) renameSession.mutate({ path: session.path, name }, { onError });
  }

  async function remove(session: SessionSummary) {
    const confirmed = await ConfirmModal.show({
      title: t("sidebar.session.deleteTitle"),
      description: t("sidebar.session.deleteDescription", { title: session.title }),
      confirmLabel: t("common:actions.delete"),
    });
    if (confirmed) deleteSession.mutate(session.path, { onError });
  }

  function renderSession(session: SessionSummary) {
    return (
      <SidebarMenuItem key={session.path}>
        <SidebarMenuButton
          isActive={session.path === sessionPath}
          disabled={!ready}
          title={session.title}
          onClick={() => {
            if (session.path !== sessionPath) openSession.mutate(session.path, { onError });
          }}
        >
          <span className="min-w-0 flex-1 truncate">{session.title}</span>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums group-hover/menu-item:invisible group-focus-within/menu-item:invisible">
            {relativeTime(session.modified)}
          </span>
        </SidebarMenuButton>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<SidebarMenuAction showOnHover aria-label={t("sidebar.session.actions")} />}
          >
            <MoreHorizontalIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="start" className="w-36">
            <DropdownMenuItem onClick={() => void rename(session)}>
              <PencilIcon />
              {t("sidebar.session.rename")}
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={() => void remove(session)}>
              <Trash2Icon />
              {t("common:actions.delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    );
  }

  function renderWorkspace(workspace: WorkspaceProfile) {
    const list = byWorkspace.get(workspace.id) ?? [];
    const open = !collapsed.has(workspace.id);
    const showAll = expanded.has(workspace.id);
    const visible = showAll
      ? list
      : list.filter((session, index) => index < VISIBLE_CHATS || session.path === sessionPath);
    const hidden = list.length - visible.length;
    // The open chat is not listed yet (no reply so far): mark its workspace instead.
    const holdsEmptyChat =
      workspace.id === currentWorkspaceId && !list.some((session) => session.path === sessionPath);
    // An empty open chat here already is a new chat in this workspace.
    const canStart = ready && (hasMessages || workspace.id !== currentWorkspaceId);
    return (
      <React.Fragment key={workspace.id}>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={holdsEmptyChat}
              aria-expanded={open}
              title={workspace.dir ?? undefined}
              className="group-has-data-[sidebar=menu-action]/menu-item:pr-14"
              onClick={() => setCollapsed((previous) => toggle(previous, workspace.id))}
            >
              <span aria-hidden className="flex size-4 shrink-0 items-center justify-center">
                {workspace.icon}
              </span>
              <span className="truncate font-medium">{workspace.name}</span>
            </SidebarMenuButton>
            <SidebarMenuAction
              showOnHover
              className="right-7"
              title={t("sidebar.workspace.newChat", { name: workspace.name })}
              aria-label={t("sidebar.workspace.newChat", { name: workspace.name })}
              disabled={!canStart}
              onClick={() => newChat.mutate(workspace.id, { onError })}
            >
              <SquarePenIcon />
            </SidebarMenuAction>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <SidebarMenuAction
                    showOnHover
                    aria-label={t("sidebar.workspace.actions", { name: workspace.name })}
                  />
                }
              >
                <MoreHorizontalIcon />
              </DropdownMenuTrigger>
              <DropdownMenuContent side="right" align="start" className="w-44">
                <DropdownMenuItem
                  onClick={() => void SettingsModal.show({ bridge, section: "workspaces" })}
                >
                  <PencilIcon />
                  {t("sidebar.workspace.editInSettings")}
                </DropdownMenuItem>
                {workspace.id !== DEFAULT_WORKSPACE_ID && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => void removeWorkspace(workspace)}
                    >
                      <Trash2Icon />
                      {t("sidebar.workspace.delete")}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
        {open && (
          // Chat titles line up with the workspace name: row padding + icon + gap.
          <SidebarMenu className="pl-6">
            {list.length === 0 ? (
              <li className="px-3 py-1.5 text-xs text-muted-foreground">{t("sidebar.noChats")}</li>
            ) : (
              visible.map(renderSession)
            )}
            {(hidden > 0 || (showAll && list.length > VISIBLE_CHATS)) && (
              <SidebarMenuItem>
                <SidebarMenuButton
                  className="text-xs text-muted-foreground"
                  onClick={() => setExpanded((previous) => toggle(previous, workspace.id))}
                >
                  {showAll ? t("sidebar.showLess") : t("sidebar.showMore", { hidden })}
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
          </SidebarMenu>
        )}
      </React.Fragment>
    );
  }

  return (
    <Sidebar variant="inset">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              disabled={saveWorkspace.isPending}
              onClick={() => void createWorkspace()}
            >
              <FolderPlusIcon />
              <span>{t("sidebar.newWorkspace")}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>{t("sidebar.workspaces")}</SidebarGroupLabel>
          <SidebarGroupContent className="flex flex-col gap-1">
            {(sessions.isError && !sessions.data) || (workspaces.isError && !workspaces.data) ? (
              <p className="px-3 py-1.5 text-xs text-destructive">{t("sidebar.loadError")}</p>
            ) : sessions.isPending || workspaces.isPending ? (
              <SidebarMenu>
                {Array.from({ length: 5 }, (_, index) => (
                  <SidebarMenuItem key={index}>
                    <SidebarMenuSkeleton />
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            ) : (
              (workspaces.data ?? []).map(renderWorkspace)
            )}
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <UpdateNotice bridge={bridge} />
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={() => void SettingsModal.show({ bridge })}>
              <SettingsIcon />
              <span>{t("sidebar.settings")}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
