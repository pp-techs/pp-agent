import type {
  AgentEvent,
  AgentSnapshot,
  AgentSummary,
  AgentStatus,
  ApprovalRequest,
  ChatMessage,
  ModelSummary,
} from "@workspace/shared";
import { create } from "zustand";

interface ChatState {
  status: AgentStatus;
  messages: ChatMessage[];
  /** Pending approvals keyed by request id. */
  approvals: Record<string, ApprovalRequest>;
  /** Model of the open conversation. */
  model: ModelSummary | null;
  /** Agent of the open conversation. */
  agent: AgentSummary | null;
  /** Thinking level of the open conversation and the levels its model offers. */
  thinking: AgentSnapshot["thinking"];
  /** Workspace of the open conversation (its agent's folder). */
  workspaceDir: string | null;
  sessionPath: string | null;
  apply: (event: AgentEvent) => void;
}

export const useChatStore = create<ChatState>()((set) => ({
  status: "starting",
  messages: [],
  approvals: {},
  model: null,
  agent: null,
  thinking: { level: "off", available: [] },
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
            agent: snapshot.agent,
            thinking: snapshot.thinking,
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
        case "settings_changed":
        case "auth_prompt":
        case "auth_prompt_closed":
        case "auth_info":
        case "error":
          return {};
      }
    }),
}));
