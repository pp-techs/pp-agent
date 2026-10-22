import type { DesktopBridge, SessionSummary } from "@workspace/shared";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
  FolderOpenIcon,
  MoreHorizontalIcon,
  PencilIcon,
  SettingsIcon,
  SquarePenIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";

import { UpdateNotice } from "@/components/chat/update-notice";
import { ConfirmModal } from "@/components/modals/confirm-modal";
import { PromptModal } from "@/components/modals/prompt-modal";
import { SettingsModal } from "@/components/modals/settings-modal";
import { sessionsQuery, useAgentCommands } from "@/lib/queries";
import { useChatStore } from "@/stores/chat-store";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Buckets sessions the way chat apps do: Today, Yesterday, Previous 7 days, Older. */
function groupByDate(sessions: SessionSummary[]) {
  const startOfToday = new Date().setHours(0, 0, 0, 0);
  const groups: Array<[string, SessionSummary[]]> = [
    ["Today", []],
    ["Yesterday", []],
    ["Previous 7 days", []],
    ["Older", []],
  ];
  for (const session of sessions) {
    const index =
      session.modified >= startOfToday
        ? 0
        : session.modified >= startOfToday - DAY_MS
          ? 1
          : session.modified >= startOfToday - 7 * DAY_MS
            ? 2
            : 3;
    groups[index]![1].push(session);
  }
  return groups.filter(([, list]) => list.length > 0);
}

export function ChatSidebar({ bridge }: { bridge: DesktopBridge }) {
  const sessions = useQuery(sessionsQuery(bridge));
  const sessionPath = useChatStore((state) => state.sessionPath);
  const status = useChatStore((state) => state.status);
  const hasMessages = useChatStore((state) => state.messages.length > 0);
  const workspaceDir = useChatStore((state) => state.workspaceDir);
  const { newChat, openSession, renameSession, deleteSession } = useAgentCommands(bridge);
  const ready = status === "idle" || status === "running";
  const onError = (error: Error) => toast.error(error.message);

  async function rename(session: SessionSummary) {
    const name = await PromptModal.show({
      title: "Rename chat",
      label: "Chat name",
      initialValue: session.title,
      confirmLabel: "Rename",
    });
    if (name) renameSession.mutate({ path: session.path, name }, { onError });
  }

  async function remove(session: SessionSummary) {
    const confirmed = await ConfirmModal.show({
      title: "Delete this chat?",
      description: `“${session.title}” will be removed from your history. Files it saved stay in your workspace.`,
      confirmLabel: "Delete",
    });
    if (confirmed) deleteSession.mutate(session.path, { onError });
  }

  return (
    <Sidebar variant="inset">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              disabled={!ready || !hasMessages}
              onClick={() => newChat.mutate(undefined, { onError })}
            >
              <SquarePenIcon />
              <span>New chat</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {sessions.isPending ? (
          <SidebarGroup>
            <SidebarMenu>
              {Array.from({ length: 5 }, (_, index) => (
                <SidebarMenuItem key={index}>
                  <SidebarMenuSkeleton />
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        ) : sessions.data?.length === 0 ? (
          <SidebarGroup>
            <p className="px-2 text-xs text-muted-foreground">Your chats will appear here.</p>
          </SidebarGroup>
        ) : (
          groupByDate(sessions.data ?? []).map(([label, list]) => (
            <SidebarGroup key={label}>
              <SidebarGroupLabel>{label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {list.map((session) => (
                    <SidebarMenuItem key={session.path}>
                      <SidebarMenuButton
                        isActive={session.path === sessionPath}
                        disabled={!ready}
                        title={session.title}
                        onClick={() => {
                          if (session.path !== sessionPath)
                            openSession.mutate(session.path, { onError });
                        }}
                      >
                        <span className="truncate">{session.title}</span>
                      </SidebarMenuButton>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={<SidebarMenuAction showOnHover aria-label="Chat actions" />}
                        >
                          <MoreHorizontalIcon />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent side="right" align="start" className="w-36">
                          <DropdownMenuItem onClick={() => void rename(session)}>
                            <PencilIcon />
                            Rename
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => void remove(session)}
                          >
                            <Trash2Icon />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))
        )}
      </SidebarContent>
      <SidebarFooter>
        <UpdateNotice bridge={bridge} />
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              disabled={!workspaceDir}
              title={workspaceDir ?? undefined}
              onClick={() => {
                if (workspaceDir) bridge.files.openWorkspace(workspaceDir).catch(onError);
              }}
            >
              <FolderOpenIcon />
              <span>Open workspace folder</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={() => void SettingsModal.show({ bridge })}>
              <SettingsIcon />
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
