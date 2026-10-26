import type { ApprovalRequest } from "@workspace/shared";
import type { TelegramApi, TelegramCallbackQuery } from "./api.ts";
import { escapeHtml } from "./format.ts";
import type { TelegramTranslate } from "./text.ts";

export const APPROVAL_TIMEOUT_MS = 10 * 60_000;
const MAX_DETAIL_LENGTH = 1500;
const CALLBACK = /^ap:(.+):([01])$/;

interface Pending {
  chatId: number;
  settle(approved: boolean, label: string): void;
}

/**
 * Asks the person to approve a tool call with an inline keyboard. Only the owner's tap counts,
 * and a request nobody answers is denied after ten minutes.
 */
export class TelegramApprovals {
  private readonly pending = new Map<string, Pending>();

  constructor(
    private readonly api: TelegramApi,
    private readonly t: TelegramTranslate,
    private readonly timeoutMs = APPROVAL_TIMEOUT_MS,
  ) {}

  /** Sends the question and resolves with the decision (false on timeout or when cancelled). */
  async ask(chatId: number, request: ApprovalRequest): Promise<boolean> {
    const detail = request.detail.trim().slice(0, MAX_DETAIL_LENGTH);
    const html =
      `<b>${escapeHtml(this.t("channels.telegram.approvalTitle"))}</b>\n${escapeHtml(request.title)}` +
      (detail ? `\n<pre>${escapeHtml(detail)}</pre>` : "");
    let messageId: number;
    try {
      ({ message_id: messageId } = await this.api.sendMessage(chatId, html, {
        parseMode: "HTML",
        replyMarkup: {
          inline_keyboard: [
            [
              {
                text: this.t("channels.telegram.approve"),
                callback_data: `ap:${request.requestId}:1`,
              },
              {
                text: this.t("channels.telegram.deny"),
                callback_data: `ap:${request.requestId}:0`,
              },
            ],
          ],
        },
      }));
    } catch (error) {
      console.warn("[telegram] Could not ask for approval:", (error as Error).message);
      return false;
    }

    const { promise, resolve } = Promise.withResolvers<boolean>();
    const timer = setTimeout(
      () => this.settle(request.requestId, false, "channels.telegram.expired"),
      this.timeoutMs,
    );
    this.pending.set(request.requestId, {
      chatId,
      settle: (approved, label) => {
        clearTimeout(timer);
        resolve(approved);
        this.api
          .editMessageText(chatId, messageId, `${html}\n\n<b>${escapeHtml(label)}</b>`, {
            parseMode: "HTML",
            replyMarkup: { inline_keyboard: [] },
          })
          .catch(() => {});
      },
    });
    return promise;
  }

  private settle(
    requestId: string,
    approved: boolean,
    key: "channels.telegram.approved" | "channels.telegram.denied" | "channels.telegram.expired",
  ): boolean {
    const entry = this.pending.get(requestId);
    if (!entry) return false;
    this.pending.delete(requestId);
    const icon = approved ? "✅" : key === "channels.telegram.expired" ? "⌛" : "❌";
    entry.settle(approved, `${icon} ${this.t(key)}`);
    return true;
  }

  /** Handles a button tap. Returns false when the callback is not an approval answer. */
  async handleCallback(query: TelegramCallbackQuery, ownerId: number | null): Promise<boolean> {
    const match = CALLBACK.exec(query.data ?? "");
    if (!match) return false;
    if (ownerId === null || query.from.id !== ownerId) {
      await this.api.answerCallbackQuery(query.id).catch(() => {});
      return true;
    }
    const approved = match[2] === "1";
    const found = this.settle(
      match[1]!,
      approved,
      approved ? "channels.telegram.approved" : "channels.telegram.denied",
    );
    await this.api
      .answerCallbackQuery(query.id, found ? undefined : this.t("channels.telegram.expired"))
      .catch(() => {});
    return true;
  }

  /** Denies every open question of a chat (or of all chats), for example on /stop. */
  denyAll(chatId?: number): void {
    for (const [requestId, entry] of [...this.pending])
      if (chatId === undefined || entry.chatId === chatId)
        this.settle(requestId, false, "channels.telegram.denied");
  }
}
