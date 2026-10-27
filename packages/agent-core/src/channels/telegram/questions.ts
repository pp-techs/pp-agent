import type { Question, QuestionAnswer, QuestionRequest } from "@workspace/shared";
import { ASK_LIMITS } from "../../ask.ts";
import type { InlineKeyboard, TelegramApi, TelegramCallbackQuery } from "./api.ts";
import { escapeHtml } from "./format.ts";
import type { TelegramTranslate } from "./text.ts";

export const QUESTION_TIMEOUT_MS = 10 * 60_000;
/** `q:<request id>:<question position>:<option position | o (other) | d (done) | s (skip)>`; at most 64 bytes. */
const CALLBACK = /^q:([^:]+):(\d+):(\d+|o|d|s)$/;

/** How a question ended. */
type Outcome = { answer: QuestionAnswer } | "skipped" | "expired";

/** The question on screen: one per request, since a request's questions are asked one by one. */
interface Open {
  chatId: number;
  requestId: string;
  index: number;
  question: Question;
  /** Positions of the options ticked so far (multi-select). */
  selected: Set<number>;
  /** The person tapped "Other"; their next text message is the answer. */
  awaitingText: boolean;
  html: string;
  messageId: number;
  finish(outcome: Outcome): void;
}

/**
 * Asks the questions of `ask_user` with inline keyboards, one question per message. Only the
 * owner's taps and text count. A question nobody answers is skipped after ten minutes.
 */
export class TelegramQuestions {
  private readonly open = new Map<string, Open>();

  constructor(
    private readonly api: TelegramApi,
    private readonly t: TelegramTranslate,
    private readonly timeoutMs = QUESTION_TIMEOUT_MS,
  ) {}

  /** Resolves with one answer per question, or null when the person skips or does not answer. */
  async ask(chatId: number, request: QuestionRequest): Promise<QuestionAnswer[] | null> {
    const answers: QuestionAnswer[] = [];
    for (let index = 0; index < request.questions.length; index++) {
      const answer = await this.askOne(chatId, request, index);
      if (!answer) return null;
      answers.push(answer);
    }
    return answers;
  }

  private body(request: QuestionRequest, index: number): string {
    const question = request.questions[index]!;
    const total = request.questions.length;
    const title = this.t("channels.telegram.questionTitle");
    const counter =
      total > 1
        ? ` (${this.t("channels.telegram.questionCount", { index: index + 1, total })})`
        : "";
    const described = question.options.some((option) => option.description);
    const options = described
      ? "\n\n" +
        question.options
          .map(
            (option, position) =>
              `${position + 1}. <b>${escapeHtml(option.label)}</b>` +
              (option.description ? ` – ${escapeHtml(option.description)}` : ""),
          )
          .join("\n")
      : "";
    return `<b>${escapeHtml(title)}${escapeHtml(counter)}</b>\n${escapeHtml(question.question)}${options}`;
  }

  private keyboard(open: Open): InlineKeyboard {
    const { question, requestId, index } = open;
    const data = (suffix: string | number) => `q:${requestId}:${index}:${suffix}`;
    const rows = question.options.map((option, position) => {
      const mark = question.multi ? (open.selected.has(position) ? "☑ " : "☐ ") : "";
      const hint =
        question.recommended === position
          ? ` ${this.t("channels.telegram.questionRecommended")}`
          : "";
      return [{ text: `${mark}${option.label}${hint}`, callback_data: data(position) }];
    });
    if (question.multi)
      rows.push([{ text: this.t("channels.telegram.questionDone"), callback_data: data("d") }]);
    rows.push([
      { text: this.t("channels.telegram.questionOther"), callback_data: data("o") },
      { text: this.t("channels.telegram.questionSkip"), callback_data: data("s") },
    ]);
    return { inline_keyboard: rows };
  }

  private async askOne(
    chatId: number,
    request: QuestionRequest,
    index: number,
  ): Promise<QuestionAnswer | null> {
    const question = request.questions[index]!;
    const html = this.body(request, index);
    const open: Omit<Open, "messageId" | "finish"> = {
      chatId,
      requestId: request.requestId,
      index,
      question,
      selected: new Set(),
      awaitingText: false,
      html,
    };
    let messageId: number;
    try {
      ({ message_id: messageId } = await this.api.sendMessage(chatId, html, {
        parseMode: "HTML",
        replyMarkup: this.keyboard({ ...open, messageId: 0, finish: () => {} }),
      }));
    } catch (error) {
      console.warn("[telegram] Could not ask a question:", (error as Error).message);
      return null;
    }

    const { promise, resolve } = Promise.withResolvers<QuestionAnswer | null>();
    const timer = setTimeout(() => entry.finish("expired"), this.timeoutMs);
    const entry: Open = {
      ...open,
      messageId,
      finish: (outcome) => {
        if (this.open.get(request.requestId) !== entry) return;
        this.open.delete(request.requestId);
        clearTimeout(timer);
        const answer = typeof outcome === "object" ? outcome.answer : null;
        resolve(answer);
        this.api
          .editMessageText(
            chatId,
            messageId,
            `${html}\n\n<b>${escapeHtml(this.label(outcome))}</b>`,
            {
              parseMode: "HTML",
              replyMarkup: { inline_keyboard: [] },
            },
          )
          .catch(() => {});
      },
    };
    this.open.set(request.requestId, entry);
    return promise;
  }

  /** What the message shows once the question is over. */
  private label(outcome: Outcome): string {
    if (outcome === "skipped") return `⏭ ${this.t("channels.telegram.questionSkipped")}`;
    if (outcome === "expired") return `⌛ ${this.t("channels.telegram.questionExpired")}`;
    const { selected, custom } = outcome.answer;
    const parts = [...selected];
    if (custom) parts.push(this.t("channels.telegram.questionOtherAnswer", { text: custom }));
    return `✅ ${parts.join(", ")}`;
  }

  private answerOf(open: Open, custom?: string): QuestionAnswer {
    const labels = [...open.selected]
      .sort((a, b) => a - b)
      .map((position) => open.question.options[position]!.label);
    return { id: open.question.id, selected: labels, ...(custom ? { custom } : {}) };
  }

  /** Handles a button tap. Returns false when the callback does not belong to a question. */
  async handleCallback(query: TelegramCallbackQuery, ownerId: number | null): Promise<boolean> {
    const match = CALLBACK.exec(query.data ?? "");
    if (!match) return false;
    if (ownerId === null || query.from.id !== ownerId) {
      await this.api.answerCallbackQuery(query.id).catch(() => {});
      return true;
    }
    const [, requestId, index, action] = match as unknown as [string, string, string, string];
    const open = this.open.get(requestId);
    if (!open || open.index !== Number(index)) {
      await this.api
        .answerCallbackQuery(query.id, this.t("channels.telegram.questionExpired"))
        .catch(() => {});
      return true;
    }
    let notice: string | undefined;
    if (action === "s") {
      open.finish("skipped");
    } else if (action === "o") {
      open.awaitingText = true;
      await this.api
        .sendMessage(open.chatId, this.t("channels.telegram.questionTypeAnswer"))
        .catch(() => {});
    } else if (action === "d") {
      if (open.selected.size === 0) notice = this.t("channels.telegram.questionPickOne");
      else open.finish({ answer: this.answerOf(open) });
    } else {
      const position = Number(action);
      if (position < open.question.options.length) {
        open.awaitingText = false;
        if (open.question.multi) {
          if (!open.selected.delete(position)) open.selected.add(position);
          await this.api
            .editMessageText(open.chatId, open.messageId, open.html, {
              parseMode: "HTML",
              replyMarkup: this.keyboard(open),
            })
            .catch(() => {});
        } else {
          open.selected = new Set([position]);
          open.finish({ answer: this.answerOf(open) });
        }
      }
    }
    await this.api.answerCallbackQuery(query.id, notice).catch(() => {});
    return true;
  }

  /**
   * Takes `text` as the answer to "Other". Returns false when no question of the chat waits for
   * it. A blank text is taken (it must not queue behind the turn that waits) but leaves the
   * question open.
   */
  handleText(chatId: number, text: string): boolean {
    const custom = text.trim().slice(0, ASK_LIMITS.maxCustomLength);
    for (const open of this.open.values()) {
      if (open.chatId !== chatId || !open.awaitingText) continue;
      if (custom === "") return true;
      open.finish({ answer: this.answerOf(open, custom) });
      return true;
    }
    return false;
  }

  /** Skips every open question of a chat (or of all chats), for example on /stop. */
  skipAll(chatId?: number): void {
    for (const open of [...this.open.values()])
      if (chatId === undefined || open.chatId === chatId) open.finish("skipped");
  }
}
