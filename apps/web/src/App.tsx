import * as React from "react";
import type { DesktopBridge } from "@workspace/shared";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty";
import { MessageScrollerProvider } from "@workspace/ui/components/message-scroller";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@workspace/ui/components/sidebar";
import { Spinner } from "@workspace/ui/components/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip";
import {
  FileUpIcon,
  MessageCircleDashedIcon,
  MonitorIcon,
  MoonIcon,
  PlugIcon,
  SunIcon,
} from "lucide-react";
import { toast } from "sonner";

import { ChatSidebar } from "@/components/chat/chat-sidebar";
import { ChatThread } from "@/components/chat/chat-thread";
import { PromptComposer } from "@/components/chat/prompt-composer";
import { SettingsModal } from "@/components/modals/settings-modal";
import { useTheme } from "@/components/theme-provider";
import { useAgentConnection } from "@/hooks/use-agent-connection";
import { bridge } from "@/lib/bridge";
import { useChatStore } from "@/stores/chat-store";
import { toAttachments, useComposerStore } from "@/stores/composer-store";

const THEME_ORDER = ["system", "light", "dark"] as const;
const THEME_ICONS = { system: MonitorIcon, light: SunIcon, dark: MoonIcon };

function ThemeButton() {
  const { theme, setTheme } = useTheme();
  const Icon = THEME_ICONS[theme];
  const next = THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length];
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label="Change theme"
            onClick={() => setTheme(next)}
          />
        }
      >
        <Icon />
      </TooltipTrigger>
      <TooltipContent>Theme: {theme}</TooltipContent>
    </Tooltip>
  );
}

function Header() {
  const model = useChatStore((state) => state.model);
  const status = useChatStore((state) => state.status);
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
      <SidebarTrigger />
      <span className="font-heading font-medium">PP Agent</span>
      {model && <Badge variant="secondary">{model}</Badge>}
      {status === "running" && <Spinner className="text-muted-foreground" />}
      <div className="ml-auto">
        <ThemeButton />
      </div>
    </header>
  );
}

function ChatBody({ bridge }: { bridge: DesktopBridge }) {
  const status = useChatStore((state) => state.status);
  const empty = useChatStore((state) => state.messages.length === 0);
  const workspaceDir = useChatStore((state) => state.workspaceDir);

  if (status === "starting") {
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Spinner />
          </EmptyMedia>
          <EmptyTitle>Starting the agent…</EmptyTitle>
        </EmptyHeader>
      </Empty>
    );
  }
  if (status === "unconfigured") {
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <PlugIcon />
          </EmptyMedia>
          <EmptyTitle>Connect a model</EmptyTitle>
          <EmptyDescription>
            Add your team's AI gateway and pick a model to start chatting.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={() => void SettingsModal.show({ bridge })}>Open settings</Button>
        </EmptyContent>
      </Empty>
    );
  }
  if (empty) {
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <MessageCircleDashedIcon />
          </EmptyMedia>
          <EmptyTitle>What can I help with?</EmptyTitle>
          <EmptyDescription>
            I can read and search the files in {workspaceDir ?? "your workspace"}, including PDF,
            Word, Excel, and PowerPoint. Attach files or images to a message, and I'll save new
            files after you approve.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return <ChatThread bridge={bridge} />;
}

function ChatScreen({ bridge }: { bridge: DesktopBridge }) {
  useAgentConnection(bridge);
  const status = useChatStore((state) => state.status);
  const ready = status === "idle" || status === "running";
  // Counts nested dragenter/dragleave pairs so the overlay does not flicker over child elements.
  const [dragDepth, setDragDepth] = React.useState(0);

  async function onDrop(event: React.DragEvent) {
    event.preventDefault();
    setDragDepth(0);
    if (!ready) return;
    try {
      useComposerStore
        .getState()
        .add(await toAttachments(bridge, Array.from(event.dataTransfer.files)));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <SidebarProvider>
      <ChatSidebar bridge={bridge} />
      <SidebarInset
        className="relative h-svh"
        onDragEnter={(event) => {
          if (event.dataTransfer.types.includes("Files")) setDragDepth((depth) => depth + 1);
        }}
        onDragLeave={() => setDragDepth((depth) => Math.max(0, depth - 1))}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => void onDrop(event)}
      >
        <MessageScrollerProvider autoScroll>
          <Header />
          <div className="min-h-0 flex-1">
            <ChatBody bridge={bridge} />
          </div>
          <PromptComposer bridge={bridge} disabled={!ready} />
        </MessageScrollerProvider>
        {dragDepth > 0 && ready && (
          <div className="pointer-events-none absolute inset-2 z-50 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-primary/40 bg-background/80 text-sm font-medium">
            <FileUpIcon className="size-6" />
            Drop files to attach them
          </div>
        )}
      </SidebarInset>
    </SidebarProvider>
  );
}

export function App() {
  if (!bridge) {
    return (
      <Empty className="h-svh">
        <EmptyHeader>
          <EmptyTitle>Open PP Agent from the desktop app</EmptyTitle>
          <EmptyDescription>
            This page is the app's interface and needs the desktop shell to run.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return <ChatScreen bridge={bridge} />;
}
