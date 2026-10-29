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

/** Shows the key and variables, so tests can check which sentence was chosen. */
export const fakeT: TelegramTranslate = (key, vars) =>
  vars ? `${key} ${JSON.stringify(vars)}` : key;

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
