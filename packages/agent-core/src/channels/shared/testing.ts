import type { ApprovalRequest, QuestionRequest } from "@workspace/shared";
import type {
  ChannelGateway,
  ChannelInput,
  ChatChoices,
  ChatPick,
  ChatPickKind,
  TurnHooks,
  TurnResult,
} from "../types.ts";

/** Test double of the agent gateway, shared by the channel tests. */
export class FakeGateway implements ChannelGateway {
  turns: { chatKey: string; input: ChannelInput; hooks: TurnHooks }[] = [];
  aborted: string[] = [];
  fresh: string[] = [];
  transcripts: { size: number; mimeType: string }[] = [];
  transcript: string | Error = "spoken words";
  choices: ChatChoices = {
    agents: [
      { id: "default", label: "🤖 PP Agent" },
      { id: "agent-finance", label: "💰 Finance" },
      { id: "agent-hr", label: "🧑‍💼 HR Helper" },
    ],
    workspaces: [
      { id: "default", label: "📁 Personal" },
      { id: "ws-reports", label: "📊 Reports" },
    ],
    agentId: "default",
    workspaceId: "default",
  };
  chosen: { chatKey: string; agentId?: string; workspaceId?: string }[] = [];
  chooseError: Error | null = null;
  picks: Record<"model" | "thinking", ChatPick> = {
    model: {
      options: [
        { id: "m1", label: "Opus 5.5 · Anthropic" },
        { id: "m2", label: "Sonnet 5 · Anthropic" },
        { id: "m3", label: "Gemini Flash · Google" },
      ],
      currentId: "m1",
    },
    thinking: {
      options: ["off", "low", "medium", "high"].map((id) => ({ id, label: id })),
      currentId: "medium",
    },
  };
  picked: { chatKey: string; kind: ChatPickKind; id: string }[] = [];
  sessions: Array<{ id: string; title: string; isCurrent: boolean }> = [];
  sessionLists: string[] = [];
  resumed: { chatKey: string; sessionId: string }[] = [];
  steered: { chatKey: string; input: ChannelInput }[] = [];
  steerHandler: (input: ChannelInput) => Promise<boolean> = async () => false;
  /** What a turn does; the default answers "ok". */
  handler: (input: ChannelInput, hooks: TurnHooks) => Promise<TurnResult> = async () => ({
    text: "ok",
    status: "done",
  });

  runTurn(chatKey: string, input: ChannelInput, hooks: TurnHooks): Promise<TurnResult> {
    this.turns.push({ chatKey, input, hooks });
    return this.handler(input, hooks);
  }

  async newConversation(chatKey: string): Promise<void> {
    this.fresh.push(chatKey);
  }

  async abort(chatKey: string): Promise<void> {
    this.aborted.push(chatKey);
  }

  async options(): Promise<ChatChoices> {
    return this.choices;
  }

  async choose(chatKey: string, choice: { agentId?: string; workspaceId?: string }): Promise<void> {
    if (this.chooseError) throw this.chooseError;
    this.chosen.push({ chatKey, ...choice });
  }

  async pickOptions(_chatKey: string, kind: ChatPickKind): Promise<ChatPick> {
    return this.picks[kind];
  }

  async pick(chatKey: string, kind: ChatPickKind, id: string): Promise<void> {
    if (this.chooseError) throw this.chooseError;
    this.picked.push({ chatKey, kind, id });
  }

  async listChatSessions(chatKey: string): Promise<typeof this.sessions> {
    this.sessionLists.push(chatKey);
    return this.sessions;
  }

  async resumeChatSession(chatKey: string, sessionId: string): Promise<void> {
    this.resumed.push({ chatKey, sessionId });
  }

  async steerTurn(chatKey: string, input: ChannelInput): Promise<boolean> {
    this.steered.push({ chatKey, input });
    return this.steerHandler(input);
  }
  async transcribe(data: Uint8Array, mimeType: string): Promise<string> {
    this.transcripts.push({ size: data.byteLength, mimeType });
    if (this.transcript instanceof Error) throw this.transcript;
    return this.transcript;
  }
}

export function approvalRequest(requestId = "req1"): ApprovalRequest {
  return {
    requestId,
    toolCallId: "call1",
    anchorToolCallId: "call1",
    toolName: "bash",
    tier: "exec",
    title: "Run a command",
    detail: "rm -rf <tmp>",
  };
}

/** One single-select question and one multi-select question. */
export function questionRequest(requestId = "q1"): QuestionRequest {
  return {
    requestId,
    toolCallId: "call1",
    questions: [
      {
        id: "scope",
        question: "Which <period>?",
        options: [
          { label: "Q3", description: "July to September" },
          { label: "Q4" },
          { label: "Year" },
        ],
        recommended: 1,
      },
      {
        id: "formats",
        question: "Which formats?",
        multi: true,
        options: [{ label: "PDF" }, { label: "Excel" }],
      },
    ],
  };
}
