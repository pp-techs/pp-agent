import * as React from "react";
import type {
  DesktopBridge,
  ExportFormat,
  SessionSearchHit,
  SessionSummary,
  WorkspaceProfile,
} from "@workspace/shared";
import { DEFAULT_WORKSPACE_ID } from "@workspace/shared";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
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
  SidebarInput,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
} from "@workspace/ui/components/sidebar";
import { useQuery } from "@tanstack/react-query";
import {
  DownloadIcon,
  FolderPlusIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  SettingsIcon,
  SquarePenIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { UpdateNotice } from "@/components/chat/update-notice";
import { ConfirmModal } from "@/components/modals/confirm-modal";
import { PromptModal } from "@/components/modals/prompt-modal";
import { SettingsModal } from "@/components/modals/settings-modal";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useExportSession } from "@/hooks/use-export-session";
import { useDeleteWorkspace, useSaveWorkspace } from "@/lib/extension-queries";
import { i18n } from "@/lib/i18n";
import {
  MIN_SEARCH_LENGTH,
  searchSessionsQuery,
  sessionsQuery,
  useAgentCommands,
  workspacesQuery,
} from "@/lib/queries";
import { useChatStore } from "@/stores/chat-store";

/** Chats listed per workspace before "Show more". */
const VISIBLE_CHATS = 6;
const NEW_WORKSPACE_ICON = "📁";
/** Wait for a pause in typing before searching, so one search runs per word, not per key. */
const SEARCH_DEBOUNCE_MS = 250;

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

/** `text` with the [start, end) ranges in bold. */
function Highlighted({ text, ranges }: { text: string; ranges: ReadonlyArray<[number, number]> }) {
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (const [start, end] of ranges) {
    if (start < at) continue;
    if (start > at) parts.push(text.slice(at, start));
    parts.push(
      <mark key={start} className="rounded-sm bg-primary/20 text-foreground">
        {text.slice(start, end)}
      </mark>,
    );
    at = end;
  }
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}

export function ChatSidebar({ bridge }: { bridge: DesktopBridge }) {
  const sessions = useQuery(sessionsQuery(bridge));
  const workspaces = useQuery(workspacesQuery(bridge));
  const sessionPath = useChatStore((state) => state.sessionPath);
  const status = useChatStore((state) => state.status);
  const hasMessages = useChatStore((state) => state.messages.length > 0);
  const currentWorkspaceId = useChatStore((state) => state.workspace?.id);
  const { newChat, openSession, renameSession, deleteSession, pinSession } =
    useAgentCommands(bridge);
  const exportSession = useExportSession(bridge);
  const saveWorkspace = useSaveWorkspace(bridge);
  const deleteWorkspace = useDeleteWorkspace(bridge);
  const [collapsed, setCollapsed] = React.useState<ReadonlySet<string>>(new Set());
  const [expanded, setExpanded] = React.useState<ReadonlySet<string>>(new Set());
  const [query, setQuery] = React.useState("");
  const searchTerm = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS);
  const searching = query.trim().length > 0;
  const search = useQuery(searchSessionsQuery(bridge, searchTerm));
  const ready = status === "idle" || status === "running";
  const { t } = useTranslation(["chat", "common"]);
  const onError = (error: Error) => toast.error(error.message);

  const pinned = React.useMemo(
    () => (sessions.data ?? []).filter((session) => session.pinned),
    [sessions.data],
  );

  // Pinned chats are listed in their own group, not again under their workspace.
  const byWorkspace = React.useMemo(() => {
    const map = new Map<string, SessionSummary[]>();
    for (const session of sessions.data ?? []) {
      if (session.pinned) continue;
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

  function openFound(hit: SessionSearchHit) {
    if (hit.path !== sessionPath) openSession.mutate(hit.path, { onError });
  }

  function exportAs(session: SessionSummary, format: ExportFormat) {
    exportSession.mutate({ path: session.path, format });
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
          <DropdownMenuContent side="right" align="start" className="w-40">
            <DropdownMenuItem
              onClick={() =>
                pinSession.mutate({ path: session.path, pinned: !session.pinned }, { onError })
              }
            >
              {session.pinned ? <PinOffIcon /> : <PinIcon />}
              {session.pinned ? t("sidebar.session.unpin") : t("sidebar.session.pin")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void rename(session)}>
              <PencilIcon />
              {t("sidebar.session.rename")}
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <DownloadIcon />
                {t("sidebar.session.export")}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem onClick={() => exportAs(session, "md")}>
                  {t("sidebar.session.exportMarkdown")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportAs(session, "html")}>
                  {t("sidebar.session.exportHtml")}
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
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
      workspace.id === currentWorkspaceId &&
      !(sessions.data ?? []).some((session) => session.path === sessionPath);
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

  function renderSearchResults() {
    if (query.trim().length < MIN_SEARCH_LENGTH) {
      return (
        <p className="px-3 py-1.5 text-xs text-muted-foreground">
          {t("sidebar.search.tooShort", { count: MIN_SEARCH_LENGTH })}
        </p>
      );
    }
    if (search.isError)
      return <p className="px-3 py-1.5 text-xs text-destructive">{t("sidebar.search.failed")}</p>;
    // The list for the previous words stays until the new ones arrive, so it does not flicker.
    if (!search.data || searchTerm !== query.trim()) {
      return (
        <p className="px-3 py-1.5 text-xs text-muted-foreground">{t("sidebar.search.searching")}</p>
      );
    }
    if (search.data.length === 0) {
      return (
        <p className="px-3 py-1.5 text-xs text-muted-foreground">
          {t("sidebar.search.noResults", { query: searchTerm })}
        </p>
      );
    }
    return (
      <SidebarMenu>
        {search.data.map((hit) => (
          <SidebarMenuItem key={hit.path}>
            <SidebarMenuButton
              isActive={hit.path === sessionPath}
              disabled={!ready}
              className="h-auto flex-col items-start gap-0.5 py-1.5"
              onClick={() => openFound(hit)}
            >
              <span className="flex w-full min-w-0 items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate">
                  <Highlighted text={hit.title} ranges={hit.titleMatches} />
                </span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {relativeTime(hit.modified)}
                </span>
              </span>
              {hit.snippet && (
                <span className="line-clamp-2 w-full text-xs font-normal break-words text-muted-foreground">
                  <Highlighted text={hit.snippet} ranges={hit.snippetMatches} />
                </span>
              )}
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
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
        <div className="relative">
          <SidebarInput
            type="search"
            value={query}
            placeholder={t("sidebar.search.placeholder")}
            aria-label={t("sidebar.search.label")}
            className="pr-8 [&::-webkit-search-cancel-button]:hidden"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setQuery("");
            }}
          />
          {searching && (
            <button
              type="button"
              aria-label={t("sidebar.search.clear")}
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
              onClick={() => setQuery("")}
            >
              <XIcon className="size-3.5" />
            </button>
          )}
        </div>
      </SidebarHeader>
      <SidebarContent>
        {searching ? (
          <SidebarGroup>
            <SidebarGroupLabel>{t("sidebar.search.results")}</SidebarGroupLabel>
            <SidebarGroupContent>{renderSearchResults()}</SidebarGroupContent>
          </SidebarGroup>
        ) : (
          <>
            {pinned.length > 0 && (
              <SidebarGroup>
                <SidebarGroupLabel>{t("sidebar.pinned")}</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>{pinned.map(renderSession)}</SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            )}
            <SidebarGroup>
              <SidebarGroupLabel>{t("sidebar.workspaces")}</SidebarGroupLabel>
              <SidebarGroupContent className="flex flex-col gap-1">
                {(sessions.isError && !sessions.data) ||
                (workspaces.isError && !workspaces.data) ? (
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
          </>
        )}
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
