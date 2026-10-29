/**
 * A minimal Zalo Bot API client: only the calls the Zalo channel needs.
 * Docs: https://docs.zaloplatforms.com/docs/BOT
 */
import { abortableSleep } from "../shared/sleep.ts";

const API_ORIGIN = "https://bot-api.zaloplatforms.com";
/** Largest photo or voice note the bot downloads. */
export const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
const POLL_SECONDS = 30;
const MAX_RATE_RETRIES = 3;
const MAX_RATE_WAIT_SECONDS = 60;

export interface ZaloBotInfo {
  id: string;
  account_name?: string;
  account_type?: string;
  can_join_groups?: boolean;
}

export interface ZaloUser {
  id: string;
  display_name?: string;
  is_bot?: boolean;
}

/** `CHAT_TEXT`, `CHAT_PHOTO`, `CHAT_STICKER`, `CHAT_VOICE`; others may appear. */
export interface ZaloMessage {
  message_id: string;
  /** Unix time in milliseconds. */
  date?: number;
  message_type?: string;
  from?: ZaloUser;
  /** `PRIVATE`, or `GROUP` (beta); the bot answers private chats only. */
  chat: { id: string; chat_type: string };
  text?: string;
  photo_url?: string;
  caption?: string;
  voice_url?: string;
}

/** One event, as `getUpdates` returns it and as a webhook would receive it. */
export interface ZaloUpdate {
  /** `message.text.received`, `message.image.received`, `message.voice.received`, … */
  event_name: string;
  message?: ZaloMessage;
}

export interface DownloadedFile {
  data: Uint8Array;
  /** The `content-type` the server declared, without parameters; empty when none. */
  mimeType: string;
}

export type ZaloErrorKind =
  | "unauthorized"
  | "rate_limited"
  | "bad_request"
  | "timeout"
  | "network"
  | "too_large"
  | "api";

/** A failed Bot API call. The message never contains the bot token. */
export class ZaloApiError extends Error {
  constructor(
    readonly kind: ZaloErrorKind,
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "ZaloApiError";
  }
}

/** What the Zalo channel uses; the HTTP client below implements it, tests fake it. */
export interface ZaloApi {
  getMe(signal?: AbortSignal): Promise<ZaloBotInfo>;
  /** Makes polling possible: Zalo refuses `getUpdates` while a webhook is set. */
  deleteWebhook(signal?: AbortSignal): Promise<void>;
  /** Long polls; resolves with an empty list after about 30 s without news. */
  getUpdates(signal?: AbortSignal): Promise<ZaloUpdate[]>;
  /** `text` is 1 to 2000 characters. Resolves with the new message's id. */
  sendMessage(chatId: string, text: string): Promise<{ message_id: string }>;
  sendChatAction(chatId: string): Promise<void>;
  /** Rejects with kind `too_large` above `maxBytes`. */
  download(url: string, maxBytes?: number): Promise<DownloadedFile>;
}

interface ApiResponse {
  ok?: boolean;
  result?: unknown;
  description?: string;
  message?: string;
  error_code?: number;
  /** The rate-limit error of testWebhook is documented in camel case. */
  errorCode?: number;
}

export class HttpZaloApi implements ZaloApi {
  constructor(
    private readonly token: string,
    private readonly fetchFn: typeof fetch = (...args) => fetch(...args),
  ) {}

  /** Removes the token from text that may quote a request URL. */
  private redact(text: string): string {
    const masked = this.token ? text.split(this.token).join("***") : text;
    return masked.replace(/\/bot[^/\s]+\//g, "/bot***/");
  }

  private networkError(error: unknown): ZaloApiError {
    const cause = (error as { cause?: { message?: string } } | null)?.cause?.message;
    const message = error instanceof Error ? error.message : String(error);
    return new ZaloApiError("network", this.redact(cause ? `${message} (${cause})` : message));
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
      if (response.ok && body.ok !== false) return body.result;

      const status = body.error_code ?? body.errorCode ?? response.status;
      const description = this.redact(
        body.description ?? body.message ?? `HTTP ${response.status}`,
      );
      if (status === 408) throw new ZaloApiError("timeout", description, status);
      if (status === 429 || status === 426) {
        if (status === 429 && attempt < MAX_RATE_RETRIES) {
          await abortableSleep(Math.min(2 ** attempt, MAX_RATE_WAIT_SECONDS) * 1000, signal);
          continue;
        }
        throw new ZaloApiError("rate_limited", description, status);
      }
      if (status === 401 || status === 403 || status === 404)
        throw new ZaloApiError("unauthorized", description, status);
      if (status === 400) throw new ZaloApiError("bad_request", description, status);
      throw new ZaloApiError("api", description, status);
    }
  }

  getMe(signal?: AbortSignal): Promise<ZaloBotInfo> {
    return this.request("getMe", {}, signal, REQUEST_TIMEOUT_MS) as Promise<ZaloBotInfo>;
  }

  async deleteWebhook(signal?: AbortSignal): Promise<void> {
    await this.request("deleteWebhook", {}, signal, REQUEST_TIMEOUT_MS);
  }

  async getUpdates(signal?: AbortSignal): Promise<ZaloUpdate[]> {
    let result: unknown;
    try {
      result = await this.request(
        "getUpdates",
        { timeout: String(POLL_SECONDS) },
        signal,
        (POLL_SECONDS + 15) * 1000,
      );
    } catch (error) {
      // A poll that ends without news may be reported as a timeout; the next poll goes on.
      if (error instanceof ZaloApiError && error.kind === "timeout") return [];
      throw error;
    }
    // The documented reply holds one event; a list of events is accepted too.
    const events = Array.isArray(result) ? result : result ? [result] : [];
    return events.filter(
      (event): event is ZaloUpdate =>
        typeof event === "object" &&
        event !== null &&
        typeof (event as ZaloUpdate).event_name === "string",
    );
  }

  sendMessage(chatId: string, text: string): Promise<{ message_id: string }> {
    return this.request(
      "sendMessage",
      { chat_id: chatId, text },
      undefined,
      REQUEST_TIMEOUT_MS,
    ) as Promise<{ message_id: string }>;
  }

  async sendChatAction(chatId: string): Promise<void> {
    await this.request(
      "sendChatAction",
      { chat_id: chatId, action: "typing" },
      undefined,
      REQUEST_TIMEOUT_MS,
    );
  }

  async download(url: string, maxBytes = MAX_DOWNLOAD_BYTES): Promise<DownloadedFile> {
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      throw new ZaloApiError("api", "Zalo sent an invalid file address.");
    }
    if (target.protocol !== "https:")
      throw new ZaloApiError("api", "Zalo sent a file address that is not secure.");

    let response: Response;
    try {
      response = await this.fetchFn(target, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS * 2),
      });
    } catch (error) {
      throw this.networkError(error);
    }
    if (!response.ok)
      throw new ZaloApiError(
        "api",
        `The file could not be downloaded (HTTP ${response.status}).`,
        response.status,
      );
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes)
      throw new ZaloApiError("too_large", "The file is too large.");
    const mimeType = (response.headers.get("content-type") ?? "").split(";")[0]!.trim();

    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      const reader = response.body?.getReader();
      if (!reader) {
        const whole = new Uint8Array(await response.arrayBuffer());
        if (whole.byteLength > maxBytes)
          throw new ZaloApiError("too_large", "The file is too large.");
        return { data: whole, mimeType };
      }
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          void reader.cancel();
          throw new ZaloApiError("too_large", "The file is too large.");
        }
        chunks.push(value);
      }
    } catch (error) {
      if (error instanceof ZaloApiError) throw error;
      throw this.networkError(error);
    }
    const data = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      data.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { data, mimeType };
  }
}
