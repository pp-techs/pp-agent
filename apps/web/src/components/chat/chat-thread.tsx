import * as React from "react";
import type { DesktopBridge } from "@workspace/shared";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerViewport,
} from "@workspace/ui/components/message-scroller";
import { toast } from "sonner";

import { ChatMessageView } from "@/components/chat/chat-message";
import { useAgentCommands } from "@/lib/queries";
import { useChatStore } from "@/stores/chat-store";

export function ChatThread({ bridge }: { bridge: DesktopBridge }) {
  const messages = useChatStore((state) => state.messages);
  const approvalsById = useChatStore((state) => state.approvals);
  const approvals = React.useMemo(() => Object.values(approvalsById), [approvalsById]);
  const running = useChatStore((state) => state.status === "running");
  const { respondApproval, regenerate, branchSession, editMessage } = useAgentCommands(bridge);
  const commands = { regenerate, branchSession, editMessage };

  const onRespond = (requestId: string, approved: boolean) =>
    respondApproval.mutate(
      { requestId, approved },
      { onError: (error) => toast.error(error.message) },
    );

  return (
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
                bridge={bridge}
                commands={commands}
                message={message}
                last={index === messages.length - 1}
                busy={running}
                streaming={running && index === messages.length - 1}
                approvals={approvals}
                onRespond={onRespond}
                responding={respondApproval.isPending}
              />
            </MessageScrollerItem>
          ))}
        </MessageScrollerContent>
      </MessageScrollerViewport>
      <MessageScrollerButton />
    </MessageScroller>
  );
}
