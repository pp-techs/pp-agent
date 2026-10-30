import * as React from "react";
import type {
  DesktopBridge,
  ExportFormat,
  SessionSearchHit,
  SessionSummary,
  WorkspaceProfile,
} from "@workspace/shared";
import { DEFAULT_WORKSPACE_ID } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@workspace/ui/components/command";
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
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarTrigger,
  useSidebar,
} from "@workspace/ui/components/sidebar";
import { useUiLabels } from "@workspace/ui/components/ui-labels";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarClockIcon,
  DownloadIcon,
  EraserIcon,
  MoreHorizontalIcon,
  PanelLeftIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  SearchIcon,
  SettingsIcon,
  SquarePenIcon,
  Trash2Icon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Spinner } from "@workspace/ui/components/spinner";
import { UpdateNotice } from "@/components/chat/update-notice";
import { Logo } from "@/components/logo";
import { ConfirmModal } from "@/components/modals/confirm-modal";
import { PromptModal } from "@/components/modals/prompt-modal";
import { SettingsModal } from "@/components/modals/settings-modal";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useExportSession } from "@/hooks/use-export-session";
import { useDeleteWorkspace } from "@/lib/extension-queries";
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
/** Wait for a pause in typing before searching, so one search runs per word, not per key. */
const SEARCH_DEBOUNCE_MS = 250;

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
/** How often the ages beside the chats are worked out again. */
const CLOCK_TICK_MS = 30 * 1000;

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

/** Chat search as a command dialog (the sidebar's search button opens it); Enter opens a chat. */
function ChatSearchDialog({
  bridge,
  open,
  onOpenChange,
  onOpenHit,
  ready,
}: {
  bridge: DesktopBridge;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenHit: (hit: SessionSearchHit) => void;
  /** False while a reply is running: the hits are listed, but picking one waits. */
  ready: boolean;
}) {
  const { t } = useTranslation("chat");
  const [query, setQuery] = React.useState("");
  const searchTerm = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS);
  const search = useQuery(searchSessionsQuery(bridge, searchTerm));
  const tooShort = query.trim().length < MIN_SEARCH_LENGTH;
  // The hits for the previous words stay until the new ones arrive, so the list does not flicker.
  const stale = !search.data || searchTerm !== query.trim();

  let message = t("sidebar.search.noResults", { query: searchTerm });
  if (tooShort) message = t("sidebar.search.tooShort", { count: MIN_SEARCH_LENGTH });
  else if (search.isError) message = t("sidebar.search.failed");
  else if (stale) message = t("sidebar.search.searching");

  return (
    <CommandDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setQuery("");
        onOpenChange(next);
      }}
      title={t("sidebar.search.label")}
      description={t("sidebar.search.placeholder")}
    >
      <Command shouldFilter={false}>
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder={t("sidebar.search.placeholder")}
        />
        <CommandList>
          <CommandEmpty>{message}</CommandEmpty>
          {!tooShort && !stale && !search.isError && (
            <CommandGroup>
              {(search.data ?? []).map((hit) => (
                <CommandItem
                  key={hit.path}
                  value={hit.path}
                  disabled={!ready}
                  onSelect={() => onOpenHit(hit)}
                  className="h-auto flex-col items-start gap-0.5 py-1.5"
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
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}

export function ChatSidebar({
  bridge,
  page,
  onNavigate,
}: {
  bridge: DesktopBridge;
  page: "chat" | "schedules";
  onNavigate: (page: "chat" | "schedules") => void;
}) {
  const { setOpenMobile, toggleSidebar } = useSidebar();
  const labels = useUiLabels();
  const sessions = useQuery(sessionsQuery(bridge));
  const workspaces = useQuery(workspacesQuery(bridge));
  const sessionPath = useChatStore((state) => state.sessionPath);
  const status = useChatStore((state) => state.status);
  const hasMessages = useChatStore((state) => state.messages.length > 0);
  const activity = useChatStore((state) => state.activity);
  const [now, setNow] = React.useState(Date.now);
  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, []);
  const currentWorkspaceId = useChatStore((state) => state.workspace?.id);
  const { newChat, openSession, renameSession, deleteSession, clearSessions, pinSession } =
    useAgentCommands(bridge);
  const exportSession = useExportSession(bridge);
  const deleteWorkspace = useDeleteWorkspace(bridge);
  const [collapsed, setCollapsed] = React.useState<ReadonlySet<string>>(new Set());
  const [expanded, setExpanded] = React.useState<ReadonlySet<string>>(new Set());
  const [searchOpen, setSearchOpen] = React.useState(false);
  const ready = status === "idle" || status === "running";
  const { t } = useTranslation(["chat", "common"]);
  const onError = (error: Error) => toast.error(error.message);

  function navigate(nextPage: "chat" | "schedules") {
    onNavigate(nextPage);
    setOpenMobile(false);
  }

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

  async function removeWorkspace(workspace: WorkspaceProfile) {
    const confirmed = await ConfirmModal.show({
      title: t("sidebar.workspace.deleteTitle"),
      description: t("sidebar.workspace.deleteDescription", { name: workspace.name }),
      confirmLabel: t("common:actions.delete"),
    });
    if (confirmed) deleteWorkspace.mutate(workspace.id);
  }

  async function clearWorkspaceSessions(workspace: WorkspaceProfile) {
    const confirmed = await ConfirmModal.show({
      title: t("sidebar.workspace.clearSessionsTitle"),
      description: t("sidebar.workspace.clearSessionsDescription", { name: workspace.name }),
      confirmLabel: t("sidebar.workspace.clearSessions"),
    });
    if (confirmed) clearSessions.mutate(workspace.id, { onError });
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
    navigate("chat");
    if (hit.path !== sessionPath) openSession.mutate(hit.path, { onError });
  }

  function exportAs(session: SessionSummary, format: ExportFormat) {
    exportSession.mutate({ path: session.path, format });
  }

  function renderSession(session: SessionSummary) {
    return (
      <SidebarMenuItem key={session.path}>
        <SidebarMenuButton
          isActive={page === "chat" && session.path === sessionPath}
          disabled={!ready}
          title={session.title}
          onClick={() => {
            navigate("chat");
            if (session.path !== sessionPath) openSession.mutate(session.path, { onError });
          }}
        >
          <span className="min-w-0 flex-1 truncate">{session.title}</span>
        </SidebarMenuButton>
        <span className="pointer-events-none absolute inset-y-0 right-1 flex min-w-5 items-center justify-center text-xs text-muted-foreground tabular-nums group-hover/menu-item:invisible group-focus-within/menu-item:invisible">
          {activity.waiting.includes(session.path) ? (
            <span
              role="status"
              aria-label={t("sidebar.session.waiting")}
              className="size-2 rounded-full bg-primary"
            />
          ) : activity.running.includes(session.path) ? (
            <Spinner className="size-3.5" label={t("sidebar.session.answering")} />
          ) : (
            relativeTime(session.modified, now)
          )}
        </span>
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
      page === "chat" &&
      workspace.id === currentWorkspaceId &&
      !(sessions.data ?? []).some((session) => session.path === sessionPath);
    // An empty open chat here already is a new chat in this workspace.
    const canStart =
      ready && (page !== "chat" || hasMessages || workspace.id !== currentWorkspaceId);
    const hasSessions =
      list.length > 0 || pinned.some((session) => session.workspaceId === workspace.id);
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
              onClick={() =>
                newChat.mutate(workspace.id, { onError, onSuccess: () => navigate("chat") })
              }
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
                {hasSessions && (
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => void clearWorkspaceSessions(workspace)}
                  >
                    <EraserIcon />
                    {t("sidebar.workspace.clearSessions")}
                  </DropdownMenuItem>
                )}
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
    <Sidebar variant="inset" collapsible="icon">
      <SidebarHeader className="shrink-0">
        <div className="flex items-center gap-2 group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:gap-1">
          {/* The logo's own theme swap (`hidden dark:block`) outbids hide variants on its images. */}
          <span className="shrink-0 group-data-[collapsible=icon]:hidden">
            <Logo className="size-6" />
          </span>
          {/* Minimized rail: the logo stands in for the toggle button until hovered. */}
          <button
            type="button"
            aria-label={labels.toggleSidebar}
            title={labels.toggleSidebar}
            className="group/toggle hidden size-8 shrink-0 items-center justify-center rounded-xl hover:bg-sidebar-accent hover:text-sidebar-accent-foreground group-data-[collapsible=icon]:flex"
            onClick={toggleSidebar}
          >
            <span className="group-hover/toggle:hidden">
              <Logo className="size-6" />
            </span>
            <PanelLeftIcon className="hidden size-5 group-hover/toggle:block" />
          </button>
          <span className="truncate text-base font-semibold group-data-[collapsible=icon]:hidden">
            {t("sidebar.appName")}
          </span>
          <div className="ml-auto flex items-center gap-1 group-data-[collapsible=icon]:ml-0">
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-foreground"
              aria-label={t("sidebar.search.label")}
              title={t("sidebar.search.label")}
              onClick={() => setSearchOpen(true)}
            >
              <SearchIcon />
            </Button>
            <SidebarTrigger className="text-muted-foreground hover:text-foreground group-data-[collapsible=icon]:hidden" />
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent
        className="overscroll-contain group-data-[collapsible=icon]:hidden"
        role="region"
        aria-label={t("sidebar.workspaces")}
        tabIndex={0}
      >
        {pinned.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>{t("sidebar.pinned")}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>{pinned.map(renderSession)}</SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
        <SidebarGroup>
          <SidebarGroupLabel className="pr-8">{t("sidebar.workspaces")}</SidebarGroupLabel>
          <SidebarGroupAction
            className="text-sidebar-foreground/70"
            aria-label={t("sidebar.manageWorkspaces")}
            title={t("sidebar.manageWorkspaces")}
            onClick={() => void SettingsModal.show({ bridge, section: "workspaces" })}
          >
            <SettingsIcon aria-hidden />
          </SidebarGroupAction>
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
      <ChatSearchDialog
        bridge={bridge}
        open={searchOpen}
        onOpenChange={setSearchOpen}
        ready={ready}
        onOpenHit={(hit) => {
          openFound(hit);
          setSearchOpen(false);
        }}
      />
      <SidebarFooter className="shrink-0">
        <UpdateNotice bridge={bridge} />
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={page === "schedules"}
              aria-current={page === "schedules" ? "page" : undefined}
              onClick={() => navigate("schedules")}
            >
              <CalendarClockIcon />
              <span>{t("sidebar.scheduledTasks")}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
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
