import * as React from "react";
import type { ApprovalRequest, ComputerAppRemember, DesktopBridge } from "@workspace/shared";

import type { MessageEdit } from "@/components/chat/message-editor";

/**
 * What the messages of a thread share, so each one asks for it instead of being handed it down
 * through every level: `state` to read, `actions` to run, `meta` for what never changes.
 * `actions` keep their identity across renders, and the value only changes with `state`, so a
 * streamed reply does not re-render every message that reads it.
 */
export interface ChatThreadContextValue {
  state: {
    /** An answer is being written, so commands that change the conversation wait. */
    busy: boolean;
    approvals: ApprovalRequest[];
    /** An approval answer is on its way. */
    responding: boolean;
    regenerating: boolean;
    branching: boolean;
    /** An edited message is on its way. */
    editing: boolean;
  };
  /** Each reports its own failure; callers only react to success. */
  actions: {
    /** `remember` keeps an app the agent asked to use allowed for the chat, or always. */
    respondApproval: (requestId: string, approved: boolean, remember?: ComputerAppRemember) => void;
    regenerate: () => void;
    branchSession: (entryId: string) => void;
    editMessage: (entryId: string, edit: MessageEdit, onSuccess: () => void) => void;
  };
  meta: { bridge: DesktopBridge };
}

const ChatThreadContext = React.createContext<ChatThreadContextValue | null>(null);

/** Supplies the thread's state and commands; `ChatThread` is the only place that knows where they come from. */
export function ChatThreadProvider({
  value,
  children,
}: {
  value: ChatThreadContextValue;
  children: React.ReactNode;
}) {
  return <ChatThreadContext value={value}>{children}</ChatThreadContext>;
}

export function useChatThread(): ChatThreadContextValue {
  const context = React.use(ChatThreadContext);
  if (!context) throw new Error("useChatThread must be used within a ChatThreadProvider.");
  return context;
}
