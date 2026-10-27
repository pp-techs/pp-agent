import * as React from "react";
import type { ApprovalRequest, DesktopBridge } from "@workspace/shared";

import type { useAgentCommands } from "@/lib/queries";

type AgentCommands = ReturnType<typeof useAgentCommands>;

/**
 * What the messages of a thread share, so each one asks for it instead of being handed it down
 * through every level: `state` to read, `actions` to run, `meta` for what never changes.
 */
export interface ChatThreadContextValue {
  state: {
    /** An answer is being written, so commands that change the conversation wait. */
    busy: boolean;
    approvals: ApprovalRequest[];
    /** An approval answer is on its way. */
    responding: boolean;
  };
  actions: {
    respondApproval: (requestId: string, approved: boolean) => void;
    regenerate: AgentCommands["regenerate"];
    branchSession: AgentCommands["branchSession"];
    editMessage: AgentCommands["editMessage"];
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
