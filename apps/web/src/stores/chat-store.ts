import type {
  AgentEvent,
  AgentSnapshot,
  ContextUsage,
  AgentSummary,
  AgentStatus,
  ApprovalRequest,
  ChatMessage,
  ModelSummary,
  WorkspaceSummary,
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
  /** Workspace of the open conversation. */
  workspace: WorkspaceSummary | null;
  /** Folder the open conversation works in. */
  workspaceDir: string | null;
  sessionPath: string | null;
  /** Context window usage of the open conversation. */
  context: ContextUsage | null;
  apply: (event: AgentEvent) => void;
}

export const useChatStore = create<ChatState>()((set) => ({
  status: "starting",
  messages: [],
  approvals: {},
  model: null,
  agent: null,
  thinking: { level: "off", available: [] },
  workspace: null,
  workspaceDir: null,
  context: null,
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
            workspace: snapshot.workspace,
            workspaceDir: snapshot.workspaceDir,
            sessionPath: snapshot.sessionPath,
            context: snapshot.context,
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
        case "context":
          return { context: event.context };
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
