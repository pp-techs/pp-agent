import * as React from "react";
import type { DesktopBridge } from "@workspace/shared";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerViewport,
} from "@workspace/ui/components/message-scroller";
import { Spinner } from "@workspace/ui/components/spinner";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { ChatMessageView, PendingMessageView } from "@/components/chat/chat-message";
import {
  ChatThreadProvider,
  type ChatThreadContextValue,
} from "@/components/chat/chat-thread-context";
import { useAgentCommands } from "@/lib/queries";
import { useChatStore } from "@/stores/chat-store";

export function ChatThread({ bridge }: { bridge: DesktopBridge }) {
  const messages = useChatStore((state) => state.messages);
  const pending = useChatStore((state) => state.pending);
  const approvalsById = useChatStore((state) => state.approvals);
  const approvals = React.useMemo(() => Object.values(approvalsById), [approvalsById]);
  const running = useChatStore((state) => state.status === "running");
  const { t } = useTranslation("chat");
  const { respondApproval, regenerate, branchSession, editMessage } = useAgentCommands(bridge);
  const respondToApproval = respondApproval.mutate;
  const responding = respondApproval.isPending;

  // Mutation results change with their state, so the value is rebuilt each render, as the props were.
  const thread: ChatThreadContextValue = {
    state: { busy: running, approvals, responding },
    actions: {
      respondApproval: (requestId, approved) =>
        respondToApproval(
          { requestId, approved },
          { onError: (error) => toast.error(error.message) },
        ),
      regenerate,
      branchSession,
      editMessage,
    },
    meta: { bridge },
  };

  const sending = pending !== null;
  // The run has nothing on screen yet while the answer is still just a working agent: no reply
  // yet, or the last step has finished (a tool, or the person's answer to a question) and the
  // model has not written anything after it.
  const last = pending ?? messages.at(-1);
  const lastPart = last?.role === "assistant" ? last.parts.at(-1) : undefined;
  const waiting =
    running &&
    (last === undefined ||
      last.role !== "assistant" ||
      lastPart === undefined ||
      (lastPart.type === "tool" &&
        (lastPart.status === "done" ||
          lastPart.status === "error" ||
          lastPart.status === "denied")));

  return (
    <ChatThreadProvider value={thread}>
      <MessageScroller>
        <MessageScrollerViewport>
          <MessageScrollerContent
            aria-busy={running}
            className="mx-auto w-full max-w-3xl gap-6 px-6 py-6"
          >
            {messages.map((message, index) => (
              <MessageScrollerItem
                key={message.id}
                messageId={message.id}
                scrollAnchor={message.role === "user"}
              >
                <ChatMessageView
                  message={message}
                  last={index === messages.length - 1}
                  streaming={running && index === messages.length - 1}
                />
              </MessageScrollerItem>
            ))}
            {pending && (
              <MessageScrollerItem key={pending.id} messageId={pending.id} scrollAnchor>
                <PendingMessageView message={pending} />
              </MessageScrollerItem>
            )}
            {(sending || waiting) && (
              <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                <Spinner className="size-4" />
                <span>{sending ? t("message.sending") : t("message.thinking")}</span>
              </div>
            )}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </ChatThreadProvider>
  );
}
