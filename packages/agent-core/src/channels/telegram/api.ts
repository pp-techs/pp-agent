/** A minimal Telegram Bot API client: only the calls the Telegram channel needs. */
import { abortableSleep } from "../shared/sleep.ts";

const API_ORIGIN = "https://api.telegram.org";
/** Telegram's own limit for files a bot may download. */
export const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
const POLL_SECONDS = 30;
const MAX_FLOOD_RETRIES = 3;
const MAX_FLOOD_WAIT_SECONDS = 60;

export interface TelegramUser {
  id: number;
  is_bot?: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
}

export interface TelegramPhotoSize {
  file_id: string;
  width: number;
  height: number;
  file_size?: number;
}

export interface TelegramFileRef {
  file_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramMessage {
  message_id: number;
  chat: { id: number; type: "private" | "group" | "supergroup" | "channel" };
  from?: TelegramUser;
  text?: string;
  caption?: string;
  photo?: TelegramPhotoSize[];
  document?: TelegramFileRef;
  voice?: TelegramFileRef;
  audio?: TelegramFileRef;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  data?: string;
  message?: { message_id: number; chat: { id: number } };
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface InlineKeyboard {
  inline_keyboard: { text: string; callback_data: string }[][];
}

export interface SendOptions {
  parseMode?: "HTML";
  replyMarkup?: InlineKeyboard;
}

export interface DownloadedFile {
  data: Uint8Array;
  /** Path on Telegram's servers, whose extension hints at the format. */
  path: string;
}

export type TelegramErrorKind =
  | "unauthorized"
  | "conflict"
  | "rate_limited"
  | "bad_request"
  | "network"
  | "too_large"
  | "api";

/** A failed Bot API call. The message never contains the bot token. */
export class TelegramApiError extends Error {
  constructor(
    readonly kind: TelegramErrorKind,
    message: string,
    readonly status: number | null = null,
    /** Seconds Telegram asked us to wait (flood control). */
    readonly retryAfter: number | null = null,
  ) {
    super(message);
    this.name = "TelegramApiError";
  }
}

/** Telegram rejected the formatting of a message, so the plain text should be sent instead. */
export function isParseError(error: unknown): boolean {
  return (
    error instanceof TelegramApiError &&
    error.kind === "bad_request" &&
    /can't parse entities|can't find end of the entity/i.test(error.message)
  );
}

export function isNotModified(error: unknown): boolean {
  return (
    error instanceof TelegramApiError &&
    error.kind === "bad_request" &&
    /message is not modified/i.test(error.message)
  );
}

/** What the Telegram channel uses; the HTTP client below implements it, tests fake it. */
export interface TelegramApi {
  getMe(signal?: AbortSignal): Promise<TelegramUser>;
  /** Makes long polling possible: Telegram refuses `getUpdates` while a webhook is set. */
  deleteWebhook(signal?: AbortSignal): Promise<void>;
  /** The command list Telegram shows when the person types `/`. */
  setMyCommands(
    commands: readonly { command: string; description: string }[],
    signal?: AbortSignal,
  ): Promise<void>;
  /** Long polls; resolves with an empty list after about 30 s without news. */
  getUpdates(offset: number, signal?: AbortSignal): Promise<TelegramUpdate[]>;
  sendMessage(chatId: number, text: string, options?: SendOptions): Promise<{ message_id: number }>;
  editMessageText(
    chatId: number,
    messageId: number,
    text: string,
    options?: SendOptions,
  ): Promise<void>;
  deleteMessage(chatId: number, messageId: number): Promise<void>;
  sendChatAction(chatId: number, action?: "typing"): Promise<void>;
  answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void>;
  /** Rejects with kind `too_large` above `maxBytes` (the Bot API allows 20 MiB). */
  downloadFile(fileId: string, maxBytes?: number): Promise<DownloadedFile>;
}

interface ApiResponse {
  ok?: boolean;
  result?: unknown;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number };
}

export class HttpTelegramApi implements TelegramApi {
  constructor(
    private readonly token: string,
    private readonly fetchFn: typeof fetch = (...args) => fetch(...args),
  ) {}

  /** Removes the token from text that may quote a request URL. */
  private redact(text: string): string {
    const masked = this.token ? text.split(this.token).join("***") : text;
    return masked.replace(/bot\d+:[\w-]+/g, "bot***");
  }

  private networkError(error: unknown): TelegramApiError {
    const cause = (error as { cause?: { message?: string } } | null)?.cause?.message;
    const message = error instanceof Error ? error.message : String(error);
    return new TelegramApiError("network", this.redact(cause ? `${message} (${cause})` : message));
  }

  private async request(
    method: string,
    params: Record<string, unknown>,
    signal: AbortSignal | undefined,
    timeoutMs: number,
  ): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      const timeout = AbortSignal.timeout(timeoutMs);
      let response: Response;
      try {
        response = await this.fetchFn(`${API_ORIGIN}/bot${this.token}/${method}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(params),
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
      } catch (error) {
        if (signal?.aborted) throw error;
        throw this.networkError(error);
      }
      let body: ApiResponse = {};
      try {
        body = (await response.json()) as ApiResponse;
      } catch {
        // Not JSON (a proxy error page, say): the status code below says enough.
      }
      if (response.ok && body.ok) return body.result;

      const status = body.error_code ?? response.status;
      const description = this.redact(body.description ?? `HTTP ${response.status}`);
      const retryAfter = body.parameters?.retry_after ?? null;
      if (status === 429) {
        if (attempt < MAX_FLOOD_RETRIES) {
          await abortableSleep(
            Math.min(Math.max(retryAfter ?? 1, 1), MAX_FLOOD_WAIT_SECONDS) * 1000,
            signal,
          );
          continue;
        }
        throw new TelegramApiError("rate_limited", description, status, retryAfter);
      }
      if (status === 401 || status === 404)
        throw new TelegramApiError("unauthorized", description, status);
      if (status === 409) throw new TelegramApiError("conflict", description, status);
      if (status === 400) throw new TelegramApiError("bad_request", description, status);
      throw new TelegramApiError("api", description, status);
    }
  }

  private call<T>(
    method: string,
    params: Record<string, unknown> = {},
    signal?: AbortSignal,
    timeoutMs = REQUEST_TIMEOUT_MS,
  ): Promise<T> {
    return this.request(method, params, signal, timeoutMs) as Promise<T>;
  }

  getMe(signal?: AbortSignal): Promise<TelegramUser> {
    return this.call("getMe", {}, signal);
  }

  async deleteWebhook(signal?: AbortSignal): Promise<void> {
    await this.call("deleteWebhook", { drop_pending_updates: false }, signal);
  }

  async setMyCommands(
    commands: readonly { command: string; description: string }[],
    signal?: AbortSignal,
  ): Promise<void> {
    await this.call("setMyCommands", { commands }, signal);
  }

  getUpdates(offset: number, signal?: AbortSignal): Promise<TelegramUpdate[]> {
    return this.call(
      "getUpdates",
      { offset, timeout: POLL_SECONDS, allowed_updates: ["message", "callback_query"] },
      signal,
      (POLL_SECONDS + 15) * 1000,
    );
  }

  sendMessage(
    chatId: number,
    text: string,
    options: SendOptions = {},
  ): Promise<{ message_id: number }> {
    return this.call("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: options.parseMode,
      reply_markup: options.replyMarkup,
      link_preview_options: { is_disabled: true },
    });
  }

  async editMessageText(
    chatId: number,
    messageId: number,
    text: string,
    options: SendOptions = {},
  ): Promise<void> {
    await this.call("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: options.parseMode,
      reply_markup: options.replyMarkup,
      link_preview_options: { is_disabled: true },
    });
  }

  async deleteMessage(chatId: number, messageId: number): Promise<void> {
    await this.call("deleteMessage", { chat_id: chatId, message_id: messageId });
  }

  async sendChatAction(chatId: number, action: "typing" = "typing"): Promise<void> {
    await this.call("sendChatAction", { chat_id: chatId, action });
  }

  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
    await this.call("answerCallbackQuery", { callback_query_id: callbackQueryId, text });
  }

  async downloadFile(fileId: string, maxBytes = MAX_DOWNLOAD_BYTES): Promise<DownloadedFile> {
    const file = await this.call<{ file_path?: string; file_size?: number }>("getFile", {
      file_id: fileId,
    });
    if (!file.file_path) throw new TelegramApiError("api", "Telegram sent no path for the file.");
    if (file.file_size !== undefined && file.file_size > maxBytes)
      throw new TelegramApiError("too_large", "The file is too large.");

    let response: Response;
    try {
      response = await this.fetchFn(`${API_ORIGIN}/file/bot${this.token}/${file.file_path}`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS * 2),
      });
    } catch (error) {
      throw this.networkError(error);
    }
    if (!response.ok)
      throw new TelegramApiError(
        "api",
        `The file could not be downloaded (HTTP ${response.status}).`,
        response.status,
      );
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes)
      throw new TelegramApiError("too_large", "The file is too large.");

    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      const reader = response.body?.getReader();
      if (!reader) {
        const whole = new Uint8Array(await response.arrayBuffer());
        if (whole.byteLength > maxBytes)
          throw new TelegramApiError("too_large", "The file is too large.");
        return { data: whole, path: file.file_path };
      }
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          void reader.cancel();
          throw new TelegramApiError("too_large", "The file is too large.");
        }
        chunks.push(value);
      }
    } catch (error) {
      if (error instanceof TelegramApiError) throw error;
      throw this.networkError(error);
    }
    const data = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      data.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { data, path: file.file_path };
  }
}
