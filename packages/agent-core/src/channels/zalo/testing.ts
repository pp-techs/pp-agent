import type { ZaloApi, ZaloBotInfo, ZaloUpdate, DownloadedFile } from "./api.ts";
import type { ZaloTranslate } from "./text.ts";

/** Test double of the Bot API: records what was sent and serves queued updates to `getUpdates`. */
export class FakeZaloApi implements ZaloApi {
  me: ZaloBotInfo = { id: "1", account_name: "bot.pp" };
  getMeError: Error | null = null;
  sent: { chatId: string; text: string; id: string }[] = [];
  actions: string[] = [];
  webhookDeleted = 0;
  deleteWebhookError: Error | null = null;
  downloads: string[] = [];
  files = new Map<string, DownloadedFile>();
  downloadError: Error | null = null;
  sendError: ((text: string) => Error | null) | null = null;
  private nextId = 1;
  private queue: ZaloUpdate[] = [];
  private waiter: PromiseWithResolvers<void> | null = null;

  push(update: ZaloUpdate): void {
    this.queue.push(update);
    this.waiter?.resolve();
  }

  async getMe(): Promise<ZaloBotInfo> {
    if (this.getMeError) throw this.getMeError;
    return this.me;
  }

  async deleteWebhook(): Promise<void> {
    this.webhookDeleted++;
    if (this.deleteWebhookError) throw this.deleteWebhookError;
  }

  async getUpdates(signal?: AbortSignal): Promise<ZaloUpdate[]> {
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

  async sendMessage(chatId: string, text: string) {
    const error = this.sendError?.(text);
    if (error) throw error;
    const id = `m${this.nextId++}`;
    this.sent.push({ chatId, text, id });
    return { message_id: id };
  }

  async sendChatAction(chatId: string): Promise<void> {
    this.actions.push(chatId);
  }

  async download(url: string): Promise<DownloadedFile> {
    this.downloads.push(url);
    if (this.downloadError) throw this.downloadError;
    const file = this.files.get(url);
    if (!file) throw new Error(`no such file ${url}`);
    return file;
  }

  get texts(): string[] {
    return this.sent.map((message) => message.text);
  }
}

/** Shows the key and variables, so tests can check which sentence was chosen. */
export const fakeT: ZaloTranslate = (key, vars) => (vars ? `${key} ${JSON.stringify(vars)}` : key);

export function textUpdate(
  id: number,
  text: string,
  from = "u7",
  chatType = "PRIVATE",
): ZaloUpdate {
  return {
    event_name: "message.text.received",
    message: {
      message_id: `msg${id}`,
      date: 1750316131602,
      message_type: "CHAT_TEXT",
      from: { id: from, display_name: "Ann", is_bot: false },
      chat: { id: from, chat_type: chatType },
      text,
    },
  };
}
