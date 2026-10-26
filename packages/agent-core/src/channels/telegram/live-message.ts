import { isNotModified, type TelegramApi } from "./api.ts";
import {
  editFormatted,
  escapeHtml,
  type FormattedChunk,
  formatMessage,
  sendFormatted,
} from "./format.ts";

export const EDIT_INTERVAL_MS = 1100;
export const TYPING_INTERVAL_MS = 4000;
const MAX_STATUS_LENGTH = 200;

/**
 * Streams one turn into a chat: the first update sends a message, later ones edit it at most once
 * per `EDIT_INTERVAL_MS` (Telegram throttles edits), and text beyond one message rolls over into
 * new messages. `finish` renders the exact final text. A one-line tool status stands in for the
 * answer until the first text arrives, and the typing indicator runs while the turn does.
 */
export class LiveMessage {
  private text = "";
  private status: string | null = null;
  /** Telegram message id and the HTML last sent, per chunk. */
  private readonly ids: number[] = [];
  private readonly sent: string[] = [];
  private dirty = false;
  private closed = false;
  private lastFlush = 0;
  private timer: NodeJS.Timeout | undefined;
  private typing: NodeJS.Timeout | undefined;
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly api: TelegramApi,
    private readonly chatId: number,
    private readonly intervalMs = EDIT_INTERVAL_MS,
  ) {}

  /** Starts the typing indicator. */
  start(): void {
    const send = () => void this.api.sendChatAction(this.chatId).catch(() => {});
    send();
    this.typing = setInterval(send, TYPING_INTERVAL_MS);
  }

  /** Everything the assistant has written so far. */
  update(text: string): void {
    if (this.closed) return;
    this.text = text;
    this.requestFlush();
  }

  /** A short line about the tool that is running; shown only until text arrives. */
  setStatus(summary: string): void {
    if (this.closed) return;
    this.status = summary.trim().slice(0, MAX_STATUS_LENGTH) || null;
    if (this.text.trim() === "") this.requestFlush();
  }

  /** Stops timers without touching the chat. */
  dispose(): void {
    this.closed = true;
    this.stopTimers();
  }

  /** Renders the final text exactly and removes the tool status. Rejects when Telegram fails. */
  async finish(text: string): Promise<void> {
    this.closed = true;
    this.stopTimers();
    await this.chain;
    const chunks = text.trim() === "" ? [] : formatMessage(text);
    await this.render(chunks);
    // Messages beyond the final chunk (or a status line with no answer) are removed.
    while (this.ids.length > chunks.length) {
      const id = this.ids.pop()!;
      this.sent.pop();
      await this.api.deleteMessage(this.chatId, id).catch(() => {});
    }
  }

  private stopTimers(): void {
    clearTimeout(this.timer);
    clearInterval(this.typing);
    this.timer = undefined;
    this.typing = undefined;
  }

  private requestFlush(): void {
    this.dirty = true;
    if (this.timer) return;
    const wait =
      this.ids.length === 0 ? 0 : Math.max(0, this.lastFlush + this.intervalMs - Date.now());
    if (wait === 0) {
      this.flush();
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.flush();
    }, wait);
  }

  private flush(): void {
    this.chain = this.chain.then(async () => {
      if (!this.dirty || this.closed) return;
      this.dirty = false;
      this.lastFlush = Date.now();
      try {
        await this.render(this.current());
      } catch (error) {
        // The next update tries again; the final render reports a lasting failure.
        console.warn("[telegram] Could not update the reply:", (error as Error).message);
      }
      if (this.dirty && !this.closed) this.requestFlush();
    });
  }

  private current(): FormattedChunk[] {
    if (this.text.trim() !== "") return formatMessage(this.text);
    if (!this.status) return [];
    return [{ html: `<i>${escapeHtml(this.status)}</i>`, plain: this.status }];
  }

  private async render(chunks: FormattedChunk[]): Promise<void> {
    for (const [index, chunk] of chunks.entries()) {
      const id = this.ids[index];
      if (id === undefined) {
        const message = await sendFormatted(this.api, this.chatId, chunk);
        this.ids[index] = message.message_id;
        this.sent[index] = chunk.html;
      } else if (this.sent[index] !== chunk.html) {
        try {
          await editFormatted(this.api, this.chatId, id, chunk);
        } catch (error) {
          if (!isNotModified(error)) throw error;
        }
        this.sent[index] = chunk.html;
      }
    }
  }
}
