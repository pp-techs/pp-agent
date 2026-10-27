import * as React from "react";
import type { DesktopBridge } from "@workspace/shared";
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
import { FileUpIcon, PlugIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { AgentPicker } from "@/components/chat/agent-picker";
import { ChatHeaderActions } from "@/components/chat/chat-header-actions";
import { ChatSidebar } from "@/components/chat/chat-sidebar";
import { ChatThread } from "@/components/chat/chat-thread";
import { EmptyChat } from "@/components/chat/empty-chat";
import { PromptComposer } from "@/components/chat/prompt-composer";
import { AuthPromptModal } from "@/components/modals/auth-prompt-modal";
import { SettingsModal } from "@/components/modals/settings-modal";
import { useAgentConnection } from "@/hooks/use-agent-connection";
import { bridge } from "@/lib/bridge";
import { useChatStore } from "@/stores/chat-store";
import { toAttachments, useComposerStore } from "@/stores/composer-store";
import { connectUpdates } from "@/stores/update-store";

/** Top bar: the sidebar toggle and the agent on the left; context window and folder on the right. */
function Header({ bridge }: { bridge: DesktopBridge }) {
  const status = useChatStore((state) => state.status);
  return (
    <header className="flex h-12 shrink-0 items-center gap-1 px-3">
      <SidebarTrigger />
      <AgentPicker bridge={bridge} disabled={status === "starting"} />
      <ChatHeaderActions bridge={bridge} />
    </header>
  );
}

function ChatBody({ bridge }: { bridge: DesktopBridge }) {
  const { t } = useTranslation("modals");
  const status = useChatStore((state) => state.status);
  // The optimistic copy of a just-sent message counts: it is the thread the person is now in.
  const empty = useChatStore((state) => state.messages.length === 0 && state.pending === null);

  if (status === "starting") {
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Spinner />
          </EmptyMedia>
          <EmptyTitle>{t("app.starting")}</EmptyTitle>
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
          <EmptyTitle>{t("app.unconfigured.title")}</EmptyTitle>
          <EmptyDescription>{t("app.unconfigured.description")}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={() => void SettingsModal.show({ bridge, section: "models" })}>
            {t("app.unconfigured.action")}
          </Button>
        </EmptyContent>
      </Empty>
    );
  }
  if (empty) return <EmptyChat bridge={bridge} />;
  return <ChatThread bridge={bridge} />;
}

function ChatScreen({ bridge }: { bridge: DesktopBridge }) {
  const { t } = useTranslation("modals");
  useAgentConnection(bridge);
  React.useEffect(() => connectUpdates(bridge), [bridge]);
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
        // Inset leaves an 0.5rem gutter around the chat panel on desktop; keep it within the window.
        className="relative h-svh overflow-hidden md:h-[calc(100svh-(--spacing(4)))] md:ring-1 md:ring-foreground/5 dark:md:ring-foreground/10"
        onDragEnter={(event) => {
          if (event.dataTransfer.types.includes("Files")) setDragDepth((depth) => depth + 1);
        }}
        onDragLeave={() => setDragDepth((depth) => Math.max(0, depth - 1))}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => void onDrop(event)}
      >
        <MessageScrollerProvider autoScroll>
          <Header bridge={bridge} />
          <div className="min-h-0 flex-1">
            <ChatBody bridge={bridge} />
          </div>
          <PromptComposer bridge={bridge} disabled={!ready} />
        </MessageScrollerProvider>
        {dragDepth > 0 && ready && (
          <div className="pointer-events-none absolute inset-2 z-50 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-primary/40 bg-background/80 text-sm font-medium">
            <FileUpIcon className="size-6" />
            {t("app.dropFiles")}
          </div>
        )}
      </SidebarInset>
      <AuthPromptModal bridge={bridge} />
    </SidebarProvider>
  );
}

export function App() {
  const { t } = useTranslation("modals");
  if (!bridge) {
    return (
      <Empty className="h-svh">
        <EmptyHeader>
          <EmptyTitle>{t("app.desktopOnly.title")}</EmptyTitle>
          <EmptyDescription>{t("app.desktopOnly.description")}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return <ChatScreen bridge={bridge} />;
}
