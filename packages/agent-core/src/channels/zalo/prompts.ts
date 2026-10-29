import type { ApprovalRequest, QuestionAnswer, QuestionRequest } from "@workspace/shared";
import { ASK_LIMITS } from "../../ask.ts";
import type { ZaloTranslate } from "./text.ts";

export const PROMPT_TIMEOUT_MS = 10 * 60_000;
const MAX_DETAIL_LENGTH = 1200;
const YES = /^(1|y|yes|ok|approve|c[oó]|đồng ý|dong y|duyệt)$/iu;
const NO = /^(2|n|no|deny|kh[oô]ng|từ chối|tu choi)$/iu;
const SKIP = /^(0|skip|bỏ qua|bo qua)$/iu;
const NUMBERS = /^\d+(?:\s*[,\s]\s*\d+)*$/;

/** One question waiting for the owner's next message; `answer` returns true when it is settled. */
interface Pending {
  answer(text: string): boolean;
  /** Settles it as denied or skipped. */
  cancel(): void;
}

/**
 * Zalo bots have no buttons, so approvals and questions are plain messages and the owner answers
 * with the next message: a number, or words for "Other". The oldest open question of a chat takes
 * the answer. One nobody answers is denied or skipped after ten minutes.
 */
export class ZaloPrompts {
  private readonly pending = new Map<string, Pending[]>();

  constructor(
    private readonly send: (chatId: string, text: string) => Promise<unknown>,
    private readonly t: ZaloTranslate,
    private readonly timeoutMs = PROMPT_TIMEOUT_MS,
  ) {}

  /** Sends the question and resolves with the decision (false on timeout or when cancelled). */
  async askApproval(chatId: string, request: ApprovalRequest): Promise<boolean> {
    const detail = request.detail.trim().slice(0, MAX_DETAIL_LENGTH);
    const text = [
      `🔐 ${this.t("channels.zalo.approvalTitle")}`,
      request.title,
      ...(detail ? ["", detail] : []),
      "",
      this.t("channels.zalo.approvalHint"),
    ].join("\n");
    try {
      await this.send(chatId, text);
    } catch (error) {
      console.warn("[zalo] Could not ask for approval:", (error as Error).message);
      return false;
    }
    return this.wait<boolean>(chatId, false, (reply, settle) => {
      if (YES.test(reply)) settle(true);
      else if (NO.test(reply)) settle(false);
      else return false;
      return true;
    });
  }

  /** Resolves with one answer per question, or null when the person skips or does not answer. */
  async askQuestions(chatId: string, request: QuestionRequest): Promise<QuestionAnswer[] | null> {
    const answers: QuestionAnswer[] = [];
    for (let index = 0; index < request.questions.length; index++) {
      const answer = await this.askOne(chatId, request, index);
      if (!answer) return null;
      answers.push(answer);
    }
    return answers;
  }

  private async askOne(
    chatId: string,
    request: QuestionRequest,
    index: number,
  ): Promise<QuestionAnswer | null> {
    const question = request.questions[index]!;
    const total = request.questions.length;
    const counter =
      total > 1 ? ` (${this.t("channels.zalo.questionCount", { index: index + 1, total })})` : "";
    const options = question.options.map(
      (option, position) =>
        `${position + 1}. ${option.label}${question.recommended === position ? ` ${this.t("channels.zalo.questionRecommended")}` : ""}` +
        (option.description ? ` – ${option.description}` : ""),
    );
    const text = [
      `❓ ${this.t("channels.zalo.questionTitle")}${counter}`,
      question.question,
      "",
      ...options,
      "",
      this.t(question.multi ? "channels.zalo.questionHintMulti" : "channels.zalo.questionHint"),
    ].join("\n");
    try {
      await this.send(chatId, text);
    } catch (error) {
      console.warn("[zalo] Could not ask a question:", (error as Error).message);
      return null;
    }

    return this.wait<QuestionAnswer | null>(chatId, null, (reply, settle) => {
      if (SKIP.test(reply)) {
        settle(null);
        return true;
      }
      if (NUMBERS.test(reply)) {
        const positions = [...new Set(reply.split(/[,\s]+/).map((part) => Number(part) - 1))];
        const valid = positions.every((p) => p >= 0 && p < question.options.length);
        if (!valid || (!question.multi && positions.length !== 1)) return false;
        const selected = positions.sort((a, b) => a - b).map((p) => question.options[p]!.label);
        settle({ id: question.id, selected });
        return true;
      }
      settle({
        id: question.id,
        selected: [],
        custom: reply.slice(0, ASK_LIMITS.maxCustomLength),
      });
      return true;
    });
  }

  /**
   * Queues a waiting entry for the chat. `read` gets each reply and settles the entry, or returns
   * false when the reply is not an answer, in which case the person is told how to answer.
   */
  private wait<T>(
    chatId: string,
    fallback: T,
    read: (reply: string, settle: (value: T) => void) => boolean,
  ): Promise<T> {
    const { promise, resolve } = Promise.withResolvers<T>();
    const queue = this.pending.get(chatId) ?? [];
    this.pending.set(chatId, queue);
    const entry: Pending = {
      answer: (text) => {
        const reply = text.trim();
        if (reply === "") return true;
        if (read(reply, settle)) return true;
        this.send(chatId, this.t("channels.zalo.answerRetry")).catch(() => {});
        return true;
      },
      cancel: () => settle(fallback),
    };
    const timer = setTimeout(() => settle(fallback), this.timeoutMs);
    function settle(value: T): void {
      clearTimeout(timer);
      const index = queue.indexOf(entry);
      if (index < 0) return;
      queue.splice(index, 1);
      resolve(value);
    }
    queue.push(entry);
    return promise.finally(() => {
      if (queue.length === 0 && this.pending.get(chatId) === queue) this.pending.delete(chatId);
    });
  }

  /** True when a question of the chat is waiting; the message then answers it. */
  hasOpen(chatId: string): boolean {
    return (this.pending.get(chatId)?.length ?? 0) > 0;
  }

  /** Gives the owner's message to the oldest open question of the chat. */
  handleText(chatId: string, text: string): boolean {
    const head = this.pending.get(chatId)?.[0];
    return head ? head.answer(text) : false;
  }

  /** Denies or skips every open question of a chat (or of all chats), for example on /stop. */
  cancelAll(chatId?: string): void {
    for (const [id, queue] of [...this.pending])
      if (chatId === undefined || id === chatId) for (const entry of [...queue]) entry.cancel();
  }
}
