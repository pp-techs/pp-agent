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
import type {
  DownloadedFile,
  SendOptions,
  TelegramApi,
  TelegramUpdate,
  TelegramUser,
} from "./api.ts";
import type { TelegramTranslate } from "./text.ts";

/** Test double of the Bot API: records what was sent and serves queued updates to `getUpdates`. */
export class FakeApi implements TelegramApi {
  me: TelegramUser = { id: 1, is_bot: true, first_name: "Bot", username: "pp_bot" };
  getMeError: Error | null = null;
  sent: { chatId: number; text: string; options?: SendOptions; id: number }[] = [];
  edits: { chatId: number; messageId: number; text: string; options?: SendOptions }[] = [];
  deleted: number[] = [];
  actions: number[] = [];
  answers: { id: string; text?: string }[] = [];
  offsets: number[] = [];
  webhookDeleted = 0;
  files = new Map<string, Uint8Array>();
  downloadError: Error | null = null;
  /** Makes `editMessageText` throw for matching texts. */
  editError: ((text: string) => Error | null) | null = null;
  sendError: ((text: string, options?: SendOptions) => Error | null) | null = null;
  private nextId = 100;
  private queue: TelegramUpdate[] = [];
  private waiter: PromiseWithResolvers<void> | null = null;

  push(update: TelegramUpdate): void {
    this.queue.push(update);
    this.waiter?.resolve();
  }

  async getMe(): Promise<TelegramUser> {
    if (this.getMeError) throw this.getMeError;
    return this.me;
  }

  async deleteWebhook(): Promise<void> {
    this.webhookDeleted++;
  }

  commands: { command: string; description: string }[] = [];
  setCommandsError: Error | null = null;

  async setMyCommands(
    commands: readonly { command: string; description: string }[],
  ): Promise<void> {
    if (this.setCommandsError) throw this.setCommandsError;
    this.commands = [...commands];
  }

  async getUpdates(offset: number, signal?: AbortSignal): Promise<TelegramUpdate[]> {
    this.offsets.push(offset);
    while (this.queue.length === 0) {
      this.waiter = Promise.withResolvers<void>();
      const aborted = new Promise<never>((_, reject) => {
        if (signal?.aborted) reject(signal.reason);
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
      await Promise.race([this.waiter.promise, aborted]);
    }
    return this.queue.splice(0);
  }

  async sendMessage(chatId: number, text: string, options?: SendOptions) {
    const error = this.sendError?.(text, options);
    if (error) throw error;
    const id = this.nextId++;
    this.sent.push({ chatId, text, options, id });
    return { message_id: id };
  }

  async editMessageText(chatId: number, messageId: number, text: string, options?: SendOptions) {
    const error = this.editError?.(text);
    if (error) throw error;
    this.edits.push({ chatId, messageId, text, options });
  }

  async deleteMessage(_chatId: number, messageId: number): Promise<void> {
    this.deleted.push(messageId);
  }

  async sendChatAction(chatId: number): Promise<void> {
    this.actions.push(chatId);
  }

  async answerCallbackQuery(id: string, text?: string): Promise<void> {
    this.answers.push({ id, text });
  }

  async downloadFile(fileId: string): Promise<DownloadedFile> {
    if (this.downloadError) throw this.downloadError;
    const data = this.files.get(fileId);
    if (!data) throw new Error(`no such file ${fileId}`);
    return { data, path: `files/${fileId}` };
  }

  /** Texts of plain (non-HTML) messages. */
  get plainTexts(): string[] {
    return this.sent.filter((message) => !message.options?.parseMode).map((m) => m.text);
  }
}

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

/** Shows the key and variables, so tests can check which sentence was chosen. */
export const fakeT: TelegramTranslate = (key, vars) =>
  vars ? `${key} ${JSON.stringify(vars)}` : key;

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

export function textUpdate(
  id: number,
  text: string,
  from = 7,
  chatType: "private" | "group" = "private",
): TelegramUpdate {
  return {
    update_id: id,
    message: {
      message_id: id,
      chat: { id: from, type: chatType },
      from: { id: from, first_name: "Ann", last_name: "Lee" },
      text,
    },
  };
}
