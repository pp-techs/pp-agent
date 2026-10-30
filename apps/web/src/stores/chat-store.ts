import type {
  AgentEvent,
  AgentSnapshot,
  ContextUsage,
  AgentSummary,
  AgentStatus,
  ApprovalRequest,
  ChatMessage,
  QuestionRequest,
  ModelSummary,
  SessionActivity,
  WorkspaceSummary,
} from "@workspace/shared";
import { create } from "zustand";

interface ChatState {
  status: AgentStatus;
  messages: ChatMessage[];
  /**
   * Optimistic copy of the message just sent, shown until the conversation echoes the saved one
   * back. Cleared when that user message arrives (or on a snapshot, which already contains it).
   */
  pending: ChatMessage | null;
  setPending: (message: ChatMessage | null) => void;
  /**
   * For a sent message, the id of the optimistic copy it replaced, by message id. The thread keeps
   * the row under that key, so the scroller sees one row where the copy was, not a new one.
   */
  echoKeys: Record<string, string>;
  /** Pending approvals keyed by request id. */
  approvals: Record<string, ApprovalRequest>;
  /** Pending questions of `ask_user` keyed by request id. */
  questions: Record<string, QuestionRequest>;
  /** Model of the open conversation. */
  model: ModelSummary | null;
  /** Agent of the open conversation. */
  agent: AgentSummary | null;
  thinking: AgentSnapshot["thinking"];
  /** Yolo mode of the open conversation: whether it is active now, and why. */
  yolo: AgentSnapshot["yolo"];
  /** Goal the open conversation is working toward, if any. */
  goal: AgentSnapshot["goal"];
  /** Workspace of the open conversation. */
  workspace: WorkspaceSummary | null;
  /** Folder the open conversation works in. */
  workspaceDir: string | null;
  sessionPath: string | null;
  /** Context window usage of the open conversation. */
  context: ContextUsage | null;
  /** Conversations that are answering, including those the person has moved away from. */
  activity: SessionActivity;
  apply: (event: AgentEvent) => void;
}

export const useChatStore = create<ChatState>()((set) => ({
  status: "starting",
  messages: [],
  pending: null,
  setPending: (message) => set({ pending: message }),
  echoKeys: {},
  approvals: {},
  questions: {},
  model: null,
  agent: null,
  thinking: { level: "off", available: [] },
  yolo: { active: false, source: "conversation" },
  goal: null,
  workspace: null,
  workspaceDir: null,
  context: null,
  sessionPath: null,
  activity: { running: [], waiting: [] },

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
            pending: null,
            echoKeys: snapshot.sessionPath === state.sessionPath ? state.echoKeys : {},
            approvals: Object.fromEntries(
              snapshot.approvals.map((request) => [request.requestId, request]),
            ),
            questions: Object.fromEntries(
              snapshot.questions.map((request) => [request.requestId, request]),
            ),
            model: snapshot.model,
            agent: snapshot.agent,
            thinking: snapshot.thinking,
            yolo: snapshot.yolo,
            goal: snapshot.goal,
            workspace: snapshot.workspace,
            workspaceDir: snapshot.workspaceDir,
            sessionPath: snapshot.sessionPath,
            context: snapshot.context,
            activity: snapshot.activity,
          };
        }
        case "message": {
          // The conversation's copy of the message just sent: drop the optimistic one with it.
          const echo =
            event.message.role === "user"
              ? {
                  pending: null,
                  ...(state.pending
                    ? { echoKeys: { ...state.echoKeys, [event.message.id]: state.pending.id } }
                    : {}),
                }
              : {};
          const index = state.messages.findLastIndex((message) => message.id === event.message.id);
          if (index === -1) return { messages: [...state.messages, event.message], ...echo };
          const messages = state.messages.slice();
          messages[index] = event.message;
          return { messages, ...echo };
        }
        case "approval_requested":
          return {
            approvals: { ...state.approvals, [event.request.requestId]: event.request },
          };
        case "approval_resolved": {
          const { [event.requestId]: _resolved, ...approvals } = state.approvals;
          return { approvals };
        }
        case "question_requested":
          return {
            questions: { ...state.questions, [event.request.requestId]: event.request },
          };
        case "question_resolved": {
          const { [event.requestId]: _resolved, ...questions } = state.questions;
          return { questions };
        }
        case "context":
          return { context: event.context };
        case "activity":
          return { activity: event.activity };
        case "sessions_changed":
        case "settings_changed":
        case "auth_prompt":
        case "auth_prompt_closed":
        case "auth_info":
          return {};
        // The run died before it echoed the message being sent: drop its optimistic copy so the
        // composer does not stay blocked behind a send that never happened.
        case "error":
          return { pending: null };
      }
    }),
}));
