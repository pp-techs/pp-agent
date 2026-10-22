import type { AgentEvent, AgentStatus, ApprovalRequest, ChatMessage } from "@workspace/shared";
import { create } from "zustand";

interface ChatState {
  status: AgentStatus;
  messages: ChatMessage[];
  /** Pending approvals keyed by request id. */
  approvals: Record<string, ApprovalRequest>;
  model: string | null;
  workspaceDir: string | null;
  sessionPath: string | null;
  apply: (event: AgentEvent) => void;
}

export const useChatStore = create<ChatState>()((set) => ({
  status: "starting",
  messages: [],
  approvals: {},
  model: null,
  workspaceDir: null,
  sessionPath: null,

  apply: (event) =>
    set((state): Partial<ChatState> => {
      switch (event.type) {
        case "status":
          return { status: event.status };
        case "snapshot": {
          const { snapshot } = event;
          return {
            status: snapshot.status,
            messages: snapshot.messages,
            approvals: Object.fromEntries(
              snapshot.approvals.map((request) => [request.requestId, request]),
            ),
            model: snapshot.model,
            workspaceDir: snapshot.workspaceDir,
            sessionPath: snapshot.sessionPath,
          };
        }
        case "message": {
          const index = state.messages.findLastIndex((message) => message.id === event.message.id);
          if (index === -1) return { messages: [...state.messages, event.message] };
          const messages = state.messages.slice();
          messages[index] = event.message;
          return { messages };
        }
        case "approval_requested":
          return {
            approvals: { ...state.approvals, [event.request.requestId]: event.request },
          };
        case "approval_resolved": {
          const { [event.requestId]: _resolved, ...approvals } = state.approvals;
          return { approvals };
        }
        case "sessions_changed":
        case "error":
          return {};
      }
    }),
}));
