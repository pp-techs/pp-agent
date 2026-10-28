import * as React from "react";
import type { DesktopBridge } from "@workspace/shared";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
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
  const echoKeys = useChatStore((state) => state.echoKeys);
  const sessionPath = useChatStore((state) => state.sessionPath);
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

  // A sent message keeps the key of its optimistic copy, and both sit in one list. The scroller
  // would otherwise take the swap for a new row and jump to the first message of the chat.
  const rows = [
    ...messages.map((message, index) => ({
      key: echoKeys[message.id] ?? message.id,
      message,
      last: index === messages.length - 1,
      sending: false,
    })),
    ...(pending ? [{ key: pending.id, message: pending, last: false, sending: true }] : []),
  ];

  return (
    <ChatThreadProvider value={thread}>
      {/* Each chat gets its own scroller state: it opens at the end, whatever was open before. */}
      <MessageScrollerProvider key={sessionPath} autoScroll>
        <MessageScroller>
          <MessageScrollerViewport>
            <MessageScrollerContent
              aria-busy={running}
              className="mx-auto w-full max-w-3xl gap-6 px-6 py-6"
            >
              {rows.map((row) => (
                <MessageScrollerItem
                  key={row.key}
                  messageId={row.key}
                  scrollAnchor={row.message.role === "user"}
                >
                  {row.sending ? (
                    <PendingMessageView message={row.message} />
                  ) : (
                    <ChatMessageView
                      message={row.message}
                      last={row.last}
                      streaming={running && row.last}
                    />
                  )}
                </MessageScrollerItem>
              ))}
              {(sending || waiting) && (
                <div
                  role="status"
                  className="flex items-center gap-2 text-sm text-muted-foreground"
                >
                  <Spinner className="size-4" />
                  <span>{sending ? t("message.sending") : t("message.thinking")}</span>
                </div>
              )}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>
    </ChatThreadProvider>
  );
}
